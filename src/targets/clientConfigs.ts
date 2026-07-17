import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResolvedTarget } from "./resolve.js";

export interface ClientServerEntry {
  name: string;
  target: Extract<ResolvedTarget, { kind: "stdio" | "http" }>;
}

export interface ClientConfigResult {
  entries: ClientServerEntry[];
  /** Config files that were found and parsed. */
  sources: string[];
  /** Paths that were checked but absent. */
  missing: string[];
}

export const SUPPORTED_CLIENTS = ["claude-code", "claude-desktop", "cursor", "vscode"] as const;
export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];

export function loadClientServers(client: string, cwd = process.cwd()): ClientConfigResult {
  const home = os.homedir();
  const candidates: { file: string; pick: (json: unknown) => Record<string, unknown> | undefined }[] = [];

  switch (client) {
    case "claude-code":
      candidates.push(
        { file: path.join(cwd, ".mcp.json"), pick: (j) => topLevel(j, "mcpServers") },
        { file: path.join(home, ".claude.json"), pick: (j) => claudeUserConfig(j, cwd) },
      );
      break;
    case "claude-desktop": {
      const file =
        process.platform === "win32"
          ? path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
          : process.platform === "darwin"
            ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
            : path.join(home, ".config", "Claude", "claude_desktop_config.json");
      candidates.push({ file, pick: (j) => topLevel(j, "mcpServers") });
      break;
    }
    case "cursor":
      candidates.push(
        { file: path.join(cwd, ".cursor", "mcp.json"), pick: (j) => topLevel(j, "mcpServers") },
        { file: path.join(home, ".cursor", "mcp.json"), pick: (j) => topLevel(j, "mcpServers") },
      );
      break;
    case "vscode":
      candidates.push({ file: path.join(cwd, ".vscode", "mcp.json"), pick: (j) => topLevel(j, "servers") });
      break;
    default:
      throw new Error(`unknown client "${client}" (supported: ${SUPPORTED_CLIENTS.join(", ")})`);
  }

  const result: ClientConfigResult = { entries: [], sources: [], missing: [] };
  const seen = new Set<string>();
  for (const { file, pick } of candidates) {
    if (!fs.existsSync(file)) {
      result.missing.push(file);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      result.missing.push(`${file} (unparseable JSON)`);
      continue;
    }
    const servers = pick(json);
    if (!servers) {
      result.missing.push(`${file} (no server map found)`);
      continue;
    }
    result.sources.push(file);
    for (const [name, valueRaw] of Object.entries(servers)) {
      if (seen.has(name)) continue;
      const target = entryToTarget(name, valueRaw, client);
      if (target) {
        seen.add(name);
        result.entries.push({ name, target });
      }
    }
  }
  return result;
}

function topLevel(j: unknown, key: string): Record<string, unknown> | undefined {
  if (j && typeof j === "object" && key in (j as Record<string, unknown>)) {
    const v = (j as Record<string, unknown>)[key];
    if (v && typeof v === "object") return v as Record<string, unknown>;
  }
  return undefined;
}

function samePath(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  // Windows paths are case-insensitive and the drive letter case varies between
  // process.cwd() (uppercase) and stored config keys (often lowercase).
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

function claudeUserConfig(j: unknown, cwd: string): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  const top = topLevel(j, "mcpServers");
  if (top) Object.assign(merged, top);
  const projects = topLevel(j, "projects");
  if (projects) {
    for (const [proj, conf] of Object.entries(projects)) {
      if (samePath(proj, cwd)) {
        const projServers = topLevel(conf, "mcpServers");
        if (projServers) Object.assign(merged, projServers);
      }
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function entryToTarget(
  name: string,
  raw: unknown,
  client: string,
): Extract<ResolvedTarget, { kind: "stdio" | "http" }> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Record<string, unknown>;
  const label = `${client}:${name}`;
  if (typeof v.url === "string") {
    const headers =
      v.headers && typeof v.headers === "object" ? (v.headers as Record<string, string>) : undefined;
    return { kind: "http", url: v.url, label, headers };
  }
  if (typeof v.command === "string") {
    const args = Array.isArray(v.args) ? v.args.map(String) : [];
    const env = v.env && typeof v.env === "object" ? (v.env as Record<string, string>) : undefined;
    return { kind: "stdio", command: v.command, args, label, env };
  }
  return undefined;
}
