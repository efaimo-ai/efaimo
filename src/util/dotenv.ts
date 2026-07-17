import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal, dependency-free .env loader for the two commands that need an API key
 * (`test --live`, `weigh --anthropic`). It reads KEY=VALUE lines from a .env file
 * and fills process.env only for keys that are not already set, so a real shell
 * environment always wins. A missing file is a silent no-op.
 *
 * Values are never logged; the return value is the list of key NAMES loaded, so a
 * caller can confirm "loaded X from .env" without ever printing a secret. Loaded
 * secrets are not forwarded to spawned MCP servers: minimalChildEnv() passes an
 * allowlist that excludes API keys.
 */
export function loadDotEnv(dir: string = process.cwd()): string[] {
  let text: string;
  try {
    text = readFileSync(resolve(dir, ".env"), "utf8");
  } catch {
    return [];
  }
  const loaded: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    const quote = val[0];
    if (val.length >= 2 && (quote === '"' || quote === "'") && val[val.length - 1] === quote) {
      val = val.slice(1, -1);
    } else {
      // Unquoted: a "#" preceded by whitespace starts an inline comment. Keys never
      // contain a space, so this cannot truncate a real value.
      const hash = val.search(/\s#/);
      if (hash !== -1) val = val.slice(0, hash).trimEnd();
    }
    process.env[key] = val;
    loaded.push(key);
  }
  return loaded;
}
