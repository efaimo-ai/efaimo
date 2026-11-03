import fs from "node:fs";
import path from "node:path";
import { parseCommandString, walkFiles } from "../util/misc.js";

export type ResolvedTarget =
  | { kind: "stdio"; command: string; args: string[]; label: string; env?: Record<string, string> }
  | { kind: "http"; url: string; label: string; headers?: Record<string, string> }
  | { kind: "skillset"; path: string; label: string }
  | { kind: "repo"; path: string; label: string };

export interface ResolveOptions {
  forceStdio?: boolean;
  forceSkill?: boolean;
  forceRepo?: boolean;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export function resolveTarget(input: string, opts: ResolveOptions = {}): ResolvedTarget {
  if (opts.forceStdio) {
    const { command, args } = parseCommandString(input);
    if (!command) throw new Error(`empty stdio command: "${input}"`);
    return { kind: "stdio", command, args, label: input, env: opts.env };
  }
  if (/^https?:\/\//i.test(input)) {
    return { kind: "http", url: input, label: redactUrl(input), headers: opts.headers };
  }

  const abs = path.resolve(input);
  if (fs.existsSync(abs)) {
    const stat = fs.statSync(abs);
    if (opts.forceSkill) return { kind: "skillset", path: abs, label: input };
    if (opts.forceRepo) return { kind: "repo", path: abs, label: input };
    if (stat.isFile()) {
      if (abs.toLowerCase().endsWith(".md")) return { kind: "skillset", path: abs, label: input };
      throw new Error(
        `"${input}" is a file but not a SKILL.md; pass a skill file, a directory, a URL, or a stdio command (use --stdio to force command mode)`,
      );
    }
    if (hasSkillFile(abs)) return { kind: "skillset", path: abs, label: input };
    return { kind: "repo", path: abs, label: input };
  }

  // --skill / --repo assert a filesystem path. If it does not exist, that is an
  // error, never a stdio command to spawn: a read-only flag must not exec.
  if (opts.forceSkill || opts.forceRepo) {
    throw new Error(`"${input}" does not exist (pass an existing ${opts.forceSkill ? "skill" : "repo"} path)`);
  }

  const { command, args } = parseCommandString(input);
  if (!command) throw new Error(`cannot resolve target: "${input}"`);
  return { kind: "stdio", command, args, label: input, env: opts.env };
}

/**
 * A URL as it may be printed: the password and every query value become `***`.
 *
 * The label is what the report, an --out file and a diff all show, and a key
 * passed as `?api_key=` landed in all three verbatim. A URL with neither comes
 * back exactly as typed, because the label is also how check --diff pairs a
 * server with its baseline, and normalising it would orphan every baseline.
 */
export function redactUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return input;
  }
  if (!u.password && !u.search) return input;
  if (u.password) u.password = "***";
  if (u.search) u.search = new URLSearchParams([...u.searchParams].map(([k, v]) => [k, v ? "***" : ""])).toString();
  return u.href;
}

/** Every http(s) URL in a piece of text, through redactUrl. fetch quotes the whole URL when it refuses one. */
export function redactUrlsIn(text: string): string {
  return text.replace(/https?:\/\/[^\s"'<>]+/gi, (m) => redactUrl(m));
}

function hasSkillFile(dir: string): boolean {
  if (fs.existsSync(path.join(dir, "SKILL.md"))) return true;
  for (const f of walkFiles(dir, { maxDepth: 3 })) {
    if (path.basename(f) === "SKILL.md") return true;
  }
  return false;
}
