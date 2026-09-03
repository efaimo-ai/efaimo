import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { SkillInfo, SkillSet } from "../core/types.js";
import { walkFiles, readTextSafe } from "../util/misc.js";

/**
 * Cap on a single SKILL.md. Referenced files were already capped at 512KB by
 * readTextSafe while the body itself went through an uncapped readFileSync:
 * the safer path had the limit and the main one did not. A 35MB SKILL.md
 * tokenized to 7.2 million tokens at 367MB resident, and auditing skills you
 * have NOT installed yet is the stated use case, so this is untrusted input
 * by construction. 2MB is far above any real skill (the largest in the graded
 * corpus is a few tens of KB) and far below a memory problem.
 */
const MAX_SKILL_BYTES = 2 * 1024 * 1024;

const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// Only backticked strings that look like a real intra-skill path: a directory
// separator, no glob star. A bare filename in prose (`package.json`, `*.py`) is
// an instruction, not a file the skill loads.
const BACKTICK_PATH_RE = /`([^`\s*]*\/[^`\s*]*\.(?:md|txt|py|js|ts|mjs|json|yaml|yml|sh|csv|html))`/g;

export function parseSkillFile(file: string): SkillInfo {
  const dir = path.dirname(file);
  const base: SkillInfo = {
    dir,
    file,
    frontmatter: {},
    frontmatterRaw: "",
    body: "",
    bodyLines: 0,
    referencedPaths: [],
    files: [],
  };
  let raw: string;
  try {
    // Capped, like the referenced files this same module already caps at 512KB
    // via readTextSafe. The body went through plain readFileSync with no limit
    // while the SAFER path had a cap, and the stated use case is auditing
    // skills BEFORE you install them, which is untrusted input by definition.
    // A 35MB SKILL.md tokenized to 7.2M tokens and 367MB resident.
    const capped = readTextSafe(file, MAX_SKILL_BYTES);
    if (capped === undefined) throw new Error("unreadable");
    raw = capped;
  } catch (e) {
    return { ...base, parseError: `cannot read file: ${(e as Error).message}` };
  }

  let body = raw;
  if (/^---\r?\n/.test(raw)) {
    const end = raw.slice(4).search(/^---\s*$/m);
    if (end !== -1) {
      base.frontmatterRaw = raw.slice(4, 4 + end);
      body = raw.slice(4 + end).replace(/^---\s*\r?\n?/, "");
      try {
        const parsed = YAML.parse(base.frontmatterRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          base.frontmatter = parsed as Record<string, unknown>;
        } else {
          base.parseError = "frontmatter is not a YAML mapping";
        }
      } catch (e) {
        base.parseError = `frontmatter YAML parse error: ${(e as Error).message}`;
      }
    } else {
      base.parseError = "frontmatter opened with --- but never closed";
    }
  } else {
    base.parseError = "missing YAML frontmatter (file must start with ---)";
  }

  base.body = body;
  base.bodyLines = body.split(/\r?\n/).length;
  if (typeof base.frontmatter.name === "string") base.name = base.frontmatter.name;
  if (typeof base.frontmatter.description === "string") base.description = base.frontmatter.description;

  const seen = new Set<string>();
  for (const [re, source] of [
    [MD_LINK_RE, "link"],
    [BACKTICK_PATH_RE, "code"],
  ] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const rawPath = m[1]!;
      if (
        /^[a-z][a-z0-9+.-]*:/i.test(rawPath) || // http:, mailto:, etc.
        rawPath.startsWith("#") ||
        rawPath.startsWith("/") ||
        rawPath.includes("*") || // a glob, not a file
        /^[A-Za-z]:[\\/]/.test(rawPath)
      ) {
        continue;
      }
      const cleaned = rawPath.split("#")[0]!;
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      const resolved = path.resolve(dir, cleaned);
      // Does this reference stay inside the skill? Absolute paths, URLs and
      // globs are already rejected above; `../` was not, and weigh.ts then
      // READ every referenced file to count its tokens. A skill fetched from
      // anywhere could point at ../../../.ssh/id_rsa and get back an
      // existence-and-size oracle, published if --md goes to a CI job summary.
      // S106 already knew this was wrong and warned about it - but only after
      // the read had happened, and `weigh` does not run S106 at all.
      //
      // Recorded here rather than filtered, so S106 can still report it and
      // the reader still learns the reference exists. weigh skips the read.
      const rel = path.relative(dir, resolved);
      const escapes = rel.startsWith("..") || path.isAbsolute(rel);
      base.referencedPaths.push({
        raw: cleaned,
        resolved,
        exists: fs.existsSync(resolved),
        escapes,
        source,
      });
    }
  }

  for (const f of walkFiles(dir, { maxDepth: 4 })) {
    try {
      base.files.push({ path: f, bytes: fs.statSync(f).size });
    } catch {
      /* ignore */
    }
  }
  return base;
}

/** Resolve a path (SKILL.md file, skill dir, or a directory of skills) into a SkillSet. */
/**
 * How deep skill discovery walks. See the note inside `findSkills`: measured
 * against the public corpus, where the deepest real skill is four directories
 * below a directory of repositories.
 */
export const SKILL_WALK_MAX_DEPTH = 6;

export function findSkills(input: string): SkillSet {
  const abs = path.resolve(input);
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    return { root: path.dirname(abs), skills: [parseSkillFile(abs)] };
  }
  const direct = path.join(abs, "SKILL.md");
  if (fs.existsSync(direct)) {
    return { root: abs, skills: [parseSkillFile(direct)] };
  }
  // Discovery is deliberate rather than incidental, because two walkers with
  // different rules is what produced the 2026-09-03 defect: this found 34
  // skills in a corpus where `scripts/skills-index.mjs` found 38, and both
  // reported their own number with confidence.
  //
  // maxDepth 6 is measured, not picked. In the public corpus the deepest real
  // skill sits 4 directories below a directory-of-repositories
  // (`<corpus>/<repo>/skills/custom_skills/<name>/SKILL.md`) and 3 below a
  // repository root. Six leaves two levels of headroom and keeps an accidental
  // `check --skill /` from walking a disk. When the bound does bite it is
  // reported rather than swallowed, in `truncatedAt`.
  //
  // Dot directories are entered here and nowhere else in this codebase:
  // `.claude/skills/<name>/` is where a project keeps its own skills, so
  // skipping them made this blind to the most common real layout. `.git` is
  // still excluded by DEFAULT_SKIP_DIRS.
  const skills: SkillInfo[] = [];
  const truncatedAt: string[] = [];
  const miscased: string[] = [];
  for (const f of walkFiles(abs, {
    maxDepth: SKILL_WALK_MAX_DEPTH,
    includeDotDirs: true,
    onDepthLimit: (d) => truncatedAt.push(d),
  })) {
    const base = path.basename(f);
    if (base === "SKILL.md") skills.push(parseSkillFile(f));
    // A file that is only a capitalisation away from being a skill. The spec
    // names SKILL.md exactly, and this comparison is exact, so `skill.md` is
    // invisible here on every platform. It is not invisible everywhere: a
    // case-insensitive filesystem, which is the default on macOS and Windows,
    // may hand it to a host that opens it by name, so the same repository has
    // a working skill on the author's laptop and no skill at all in Linux CI.
    // Nothing else in this tool would ever mention it, which is the worst
    // property a near miss can have.
    else if (base.toLowerCase() === "skill.md") miscased.push(f);
  }
  skills.sort((a, b) => a.file.localeCompare(b.file));
  return {
    root: abs,
    skills,
    ...(truncatedAt.length ? { truncatedAt } : {}),
    ...(miscased.length ? { miscasedSkillFiles: miscased.sort() } : {}),
  };
}
