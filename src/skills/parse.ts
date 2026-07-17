import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { SkillInfo, SkillSet } from "../core/types.js";
import { walkFiles } from "../util/misc.js";

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
    raw = fs.readFileSync(file, "utf8");
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
      base.referencedPaths.push({ raw: cleaned, resolved, exists: fs.existsSync(resolved), source });
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
  const skills: SkillInfo[] = [];
  for (const f of walkFiles(abs, { maxDepth: 3 })) {
    if (path.basename(f) === "SKILL.md") skills.push(parseSkillFile(f));
  }
  skills.sort((a, b) => a.file.localeCompare(b.file));
  return { root: abs, skills };
}
