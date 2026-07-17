import crossSpawn from "cross-spawn";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { ServerIntrospection, ToolDef, ResourceDef, PromptDef } from "../core/types.js";
import type { ResolvedTarget } from "../targets/resolve.js";
import { minimalChildEnv } from "../util/childEnv.js";
import { truncate, withTimeout } from "../util/misc.js";
import { VERSION } from "../version.js";

export interface IntrospectOptions {
  timeoutMs?: number;
}

const MAX_PAGES = 20;

export async function introspectServer(
  target: Extract<ResolvedTarget, { kind: "stdio" | "http" }>,
  opts: IntrospectOptions = {},
): Promise<ServerIntrospection> {
  const timeoutMs = opts.timeoutMs ?? 45000;
  const notes: string[] = [];
  let stderrTail = "";

  let transport: InstanceType<typeof StdioClientTransport> | InstanceType<typeof StreamableHTTPClientTransport> | InstanceType<typeof SSEClientTransport>;
  let httpTransport: ServerIntrospection["httpTransport"];

  const client = new Client({ name: "efaimo", version: VERSION }, { capabilities: {} });

  if (target.kind === "stdio") {
    const stdio = new StdioClientTransport({
      command: target.command,
      args: target.args,
      env: target.env ? { ...minimalChildEnv(), ...target.env } : undefined,
      stderr: "pipe",
    });
    transport = stdio;
    try {
      await withTimeout(client.connect(stdio), timeoutMs, "connect (stdio)");
    } catch (e) {
      await safeClose(client, stdio);
      throw connectError(e, target.label, stderrTail);
    }
    // The child is spawned by connect(); its stderr stream only exists now.
    const errStream = (stdio as unknown as { stderr?: NodeJS.ReadableStream }).stderr;
    errStream?.on("data", (chunk: Buffer) => {
      if (stderrTail.length < 2048) stderrTail += chunk.toString("utf8");
    });
  } else {
    const url = new URL(target.url);
    // redirect:"error" so a hostile target cannot bounce an authenticated request
    // to an internal host and replay the user's --header credentials.
    const requestInit: RequestInit = { redirect: "error", ...(target.headers ? { headers: target.headers } : {}) };
    const streamable = new StreamableHTTPClientTransport(url, { requestInit });
    try {
      await withTimeout(client.connect(streamable), timeoutMs, "connect (streamable http)");
      transport = streamable;
      httpTransport = "streamable";
    } catch (streamableErr) {
      await safeClose(client, streamable);
      const sse = new SSEClientTransport(url, { requestInit });
      const sseClient = new Client({ name: "efaimo", version: VERSION }, { capabilities: {} });
      try {
        await withTimeout(sseClient.connect(sse), timeoutMs, "connect (legacy sse)");
      } catch {
        await safeClose(sseClient, sse);
        throw connectError(streamableErr, target.label, "");
      }
      notes.push("connected via legacy HTTP+SSE transport (deprecated; Streamable HTTP failed)");
      return finishIntrospection(sseClient, sse, target.label, "http", "sse-legacy", notes, timeoutMs);
    }
    return finishIntrospection(client, transport, target.label, "http", httpTransport, notes, timeoutMs);
  }

  if (stderrTail.trim()) notes.push(`server stderr: ${truncate(stderrTail.trim(), 300)}`);
  return finishIntrospection(client, transport, target.label, "stdio", undefined, notes, timeoutMs);
}

async function finishIntrospection(
  client: Client,
  transport: { close(): Promise<void> },
  label: string,
  kind: "stdio" | "http",
  httpTransport: ServerIntrospection["httpTransport"],
  notes: string[],
  timeoutMs: number,
): Promise<ServerIntrospection> {
  try {
    const tools: ToolDef[] = [];
    let rawToolsListResult: unknown;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await withTimeout(
        client.listTools(cursor ? { cursor } : undefined),
        timeoutMs,
        "tools/list",
      );
      if (page === 0) rawToolsListResult = res;
      for (const t of res.tools) {
        tools.push({
          name: t.name,
          title: (t as { title?: string }).title,
          description: t.description,
          inputSchema: t.inputSchema,
          outputSchema: (t as { outputSchema?: unknown }).outputSchema,
          annotations: (t as { annotations?: Record<string, unknown> }).annotations,
        });
      }
      cursor = (res as { nextCursor?: string }).nextCursor;
      if (!cursor) break;
      if (page === MAX_PAGES - 1) notes.push(`tools/list pagination stopped at ${MAX_PAGES} pages`);
    }

    const serverInfo = client.getServerVersion();
    const capabilities = client.getServerCapabilities() as Record<string, unknown> | undefined;
    const instructions = client.getInstructions();

    // Only call resources/prompts when the server declares them, and surface a
    // note (rather than silently swallowing) if a declared capability fails.
    const resources: ResourceDef[] = [];
    if (capabilities?.resources) {
      try {
        let rCursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await withTimeout(
            client.listResources(rCursor ? { cursor: rCursor } : undefined),
            timeoutMs,
            "resources/list",
          );
          for (const r of res.resources) {
            resources.push({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType });
          }
          rCursor = (res as { nextCursor?: string }).nextCursor;
          if (!rCursor) break;
        }
      } catch (e) {
        notes.push(`resources/list failed: ${(e as Error).message}`);
      }
    }

    const prompts: PromptDef[] = [];
    if (capabilities?.prompts) {
      try {
        let pCursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const res = await withTimeout(
            client.listPrompts(pCursor ? { cursor: pCursor } : undefined),
            timeoutMs,
            "prompts/list",
          );
          for (const p of res.prompts) {
            prompts.push({ name: p.name, title: (p as { title?: string }).title, description: p.description });
          }
          pCursor = (res as { nextCursor?: string }).nextCursor;
          if (!pCursor) break;
        }
      } catch (e) {
        notes.push(`prompts/list failed: ${(e as Error).message}`);
      }
    }

    return {
      targetLabel: label,
      transport: kind,
      httpTransport,
      serverInfo: serverInfo
        ? { name: serverInfo.name, version: serverInfo.version, title: (serverInfo as { title?: string }).title }
        : undefined,
      instructions,
      capabilities,
      tools,
      resources,
      prompts,
      rawToolsListResult,
      notes,
    };
  } finally {
    // On Windows the SDK's close() kills only the cmd.exe wrapper for npx/.cmd
    // servers; tree-kill the child first so the real server is not orphaned.
    const pid = (transport as { pid?: number | null }).pid;
    if (pid && process.platform === "win32") {
      try {
        crossSpawn.sync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
    await safeClose(client, transport);
  }
}

async function safeClose(client: Client, transport: { close(): Promise<void> }): Promise<void> {
  try {
    await client.close();
  } catch {
    /* ignore */
  }
  try {
    await transport.close();
  } catch {
    /* ignore */
  }
}

function connectError(e: unknown, label: string, stderrTail: string): Error {
  const base = e instanceof Error ? e.message : String(e);
  const hint = stderrTail.trim()
    ? `\n  server stderr: ${truncate(stderrTail.trim(), 400)}`
    : "";
  return new Error(
    `could not connect to "${label}": ${base}${hint}\n  hints: check the command/URL, required env vars or auth headers; try --timeout for slow cold starts (npx downloads on first run).`,
  );
}
