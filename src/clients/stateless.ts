import type { ServerIntrospection, ToolDef } from "../core/types.js";
import type { ResolvedTarget } from "../targets/resolve.js";
import { SPEC_VERSION, specMeta, postMessage, StdioSession } from "./rawprobe.js";

/**
 * 2026-07-28 introspection path: bare stateless requests, no initialize.
 * The SDK client enforces the legacy handshake, so a stateless RC server makes
 * client.connect() fail; this fallback lets weigh/check still work on exactly
 * the servers the readiness rules are about. Returns undefined when the server
 * does not answer the bare path either, so the caller can surface the original
 * connect error.
 */

const MAX_PAGES = 20;

interface Identity {
  name?: string;
  version?: string;
  title?: string;
}

interface DiscoverInfo {
  supportedVersions?: string[];
  capabilities?: Record<string, unknown>;
  /**
   * Locked-RC shape: identity as an ordinary DiscoverResult field. The spec
   * that published on 2026-07-28 deleted it, so this is read only as a
   * fallback for servers built against the RC.
   */
  serverInfo?: Identity;
  /**
   * Published-2026-07-28 shape: identity moved into _meta, where it is
   * OPTIONAL ("Servers SHOULD include this field"). Read first.
   */
  _meta?: { "io.modelcontextprotocol/serverInfo"?: Identity };
  instructions?: string;
}

/**
 * Newest shape first, then the RC's. Reading only the RC's field made efaimo
 * report "identity unknown" for precisely the servers that had finished
 * migrating, which is the worst direction for this error to point.
 */
function discoverIdentity(d: DiscoverInfo | undefined): Identity | undefined {
  const found = d?._meta?.["io.modelcontextprotocol/serverInfo"] ?? d?.serverInfo;
  return found ? { name: found.name, version: found.version, title: found.title } : undefined;
}

export async function introspectStateless(
  target: Extract<ResolvedTarget, { kind: "stdio" | "http" }>,
  opts: { timeoutMs?: number } = {},
): Promise<ServerIntrospection | undefined> {
  // The legacy path already burned the caller's timeout once; keep this
  // attempt tight so a genuinely dead server fails in bounded time.
  const budget = Math.min(Math.max(opts.timeoutMs ?? 15000, 1), 15000);
  try {
    return target.kind === "stdio" ? await statelessStdio(target, budget) : await statelessHttp(target);
  } catch {
    return undefined;
  }
}

async function statelessStdio(
  target: Extract<ResolvedTarget, { kind: "stdio" }>,
  budget: number,
): Promise<ServerIntrospection | undefined> {
  const session = new StdioSession(target.command, target.args, target.env);
  try {
    const pages: Record<string, unknown>[] = [];
    let rawFirst: unknown;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = cursor ? { ...specMeta(), cursor } : specMeta();
      const reply = await session.request("tools/list", params, budget);
      if (!reply.result) {
        if (page === 0) return undefined; // no bare answer: not a stateless server
        break;
      }
      if (page === 0) rawFirst = reply.result;
      pages.push(reply.result);
      cursor = (reply.result as { nextCursor?: string }).nextCursor;
      if (!cursor) break;
    }
    const discover = await session.request("server/discover", specMeta(), Math.min(budget, 10000));
    return buildIntrospection(target.label, "stdio", undefined, pages, rawFirst, discover.result);
  } finally {
    session.kill();
  }
}

async function statelessHttp(
  target: Extract<ResolvedTarget, { kind: "http" }>,
): Promise<ServerIntrospection | undefined> {
  const pages: Record<string, unknown>[] = [];
  let rawFirst: unknown;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = cursor ? { ...specMeta(), cursor } : specMeta();
    const reply = await postMessage(
      target.url,
      target.headers,
      { jsonrpc: "2.0", id: 100 + page, method: "tools/list", params },
      undefined,
      SPEC_VERSION,
    );
    const result = reply.body?.result;
    if (!result) {
      if (page === 0) return undefined;
      break;
    }
    if (page === 0) rawFirst = result;
    pages.push(result);
    cursor = (result as { nextCursor?: string }).nextCursor;
    if (!cursor) break;
  }
  const discover = await postMessage(
    target.url,
    target.headers,
    { jsonrpc: "2.0", id: 99, method: "server/discover", params: specMeta() },
    undefined,
    SPEC_VERSION,
  ).catch(() => undefined);
  return buildIntrospection(target.label, "http", "streamable", pages, rawFirst, discover?.body?.result);
}

function buildIntrospection(
  label: string,
  transport: "stdio" | "http",
  httpTransport: ServerIntrospection["httpTransport"],
  pages: Record<string, unknown>[],
  rawFirst: unknown,
  discoverResult: Record<string, unknown> | undefined,
): ServerIntrospection {
  const tools: ToolDef[] = [];
  for (const page of pages) {
    const list = Array.isArray((page as { tools?: unknown }).tools) ? ((page as { tools: unknown[] }).tools) : [];
    for (const raw of list) {
      const t = raw as Record<string, unknown>;
      if (typeof t.name !== "string") continue;
      tools.push({
        name: t.name,
        title: typeof t.title === "string" ? t.title : undefined,
        description: typeof t.description === "string" ? t.description : undefined,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        annotations:
          t.annotations && typeof t.annotations === "object" ? (t.annotations as Record<string, unknown>) : undefined,
      });
    }
  }
  const discover = (discoverResult ?? undefined) as DiscoverInfo | undefined;
  const notes = [
    "introspected via bare stateless requests (2026-07-28 path); the server does not accept the legacy initialize handshake",
  ];
  if (!discover) notes.push("server/discover did not answer, so server identity and capabilities are unknown");
  const caps = discover?.capabilities;
  if (caps && ("resources" in caps || "prompts" in caps)) {
    notes.push("server declares resources/prompts; they are not enumerated on the stateless path yet");
  }
  return {
    targetLabel: label,
    transport,
    httpTransport,
    serverInfo: discoverIdentity(discover),
    protocolVersion: discover?.supportedVersions?.includes(SPEC_VERSION) ? SPEC_VERSION : undefined,
    instructions: discover?.instructions,
    capabilities: caps,
    tools,
    resources: [],
    prompts: [],
    rawToolsListResult: rawFirst,
    notes,
  };
}
