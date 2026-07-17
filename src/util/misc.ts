import fs from "node:fs";
import path from "node:path";

/** Split a command string into command + args, honoring single/double quotes. */
export function parseCommandString(input: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (const ch of input.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  const [command, ...args] = tokens;
  return { command: command ?? "", args };
}

const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
  ".pnpm",
]);

export function* walkFiles(
  root: string,
  opts: { maxDepth?: number; skipDirs?: Set<string> } = {},
): Generator<string> {
  const maxDepth = opts.maxDepth ?? 8;
  const skip = opts.skipDirs ?? DEFAULT_SKIP_DIRS;
  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !skip.has(e.name) && !e.name.startsWith(".")) {
          stack.push({ dir: full, depth: depth + 1 });
        }
      } else if (e.isFile()) {
        yield full;
      }
    }
  }
}

export function readTextSafe(file: string, maxBytes = 512 * 1024): string | undefined {
  try {
    const stat = fs.statSync(file);
    if (stat.size > maxBytes) {
      const fd = fs.openSync(file, "r");
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, 0);
      fs.closeSync(fd);
      return buf.toString("utf8");
    }
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz",
  ".tar", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".mp3", ".wav",
  ".exe", ".dll", ".so", ".dylib", ".wasm", ".pyc", ".jar", ".class",
]);

export function isBinaryPath(file: string): boolean {
  return BINARY_EXTS.has(path.extname(file).toLowerCase());
}

export function extractVersion(s: string): number[] | undefined {
  const m = s.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 3)) + "...";
}

export function formatTokens(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
