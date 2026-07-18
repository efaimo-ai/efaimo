import crossSpawn from "cross-spawn";
import type { ChildProcess } from "node:child_process";
import type { ProbeResults, ProbeOutcome } from "../core/types.js";
import type { ResolvedTarget } from "../targets/resolve.js";
import { minimalChildEnv } from "../util/childEnv.js";
import { truncate } from "../util/misc.js";
import { VERSION } from "../version.js";

/**
 * Hand-rolled, dependency-light JSON-RPC probes. The SDK client enforces the
 * legacy initialize handshake, so 2026-07-28 readiness experiments (bare
 * stateless requests, server/discover) need raw transport access.
 * Every probe fails soft into a { skipped } marker.
 */

export const RC_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-06-18";

interface RpcReply {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
  timeout?: boolean;
  procExit?: number | null;
}

export function rcMeta(): Record<string, unknown> {
  return {
    _meta: {
      "io.modelcontextprotocol/protocolVersion": RC_VERSION,
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  };
}

function toOutcome(reply: RpcReply, timeoutMessage: string): ProbeOutcome {
  if (reply.error) return { ok: false, kind: "error", errorCode: reply.error.code, errorMessage: reply.error.message };
  if (reply.procExit !== undefined) {
    return { ok: false, kind: "exit", errorMessage: `server process exited (code ${reply.procExit ?? "unknown"}) on bare request` };
  }
  if (reply.timeout) return { ok: false, kind: "timeout", errorMessage: timeoutMessage };
  // Neither error, exit, nor timeout: a JSON-RPC success (result may be null).
  return { ok: true, kind: "ok" };
}

/**
 * Only an explicit "not initialized" / "session required" error proves the
 * server requires the removed initialize handshake. A plain timeout is NOT proof
 * (the server may just be slow to start) and is reported separately as
 * inconclusive; a crash is its own signal. This keeps E105 from false-flagging a
 * healthy but slow server, the worst verdict a readiness checker can emit.
 *
 * Detection is by message, not by error code: the codes SDKs use here are
 * implementation-defined (TS StreamableHTTP sends -32000 for both "Server not
 * initialized" and "Mcp-Session-Id header is required", -32001 for "Session not
 * found"), -32002 means Resource-not-found in the 2025 specs, and the RC
 * reserves -32022 for UnsupportedProtocolVersion, so no code is diagnostic.
 */
export function looksLikeInitGate(o: ProbeOutcome): boolean {
  if (o.kind !== "error") return false;
  return /not\s*initiali|before\s+initiali|require[sd]?\s+initiali|no\s+valid\s+session|session[-\s]?id|session\s+(?:not\s+found|required)/i.test(
    o.errorMessage ?? "",
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function runProbes(
  target: Extract<ResolvedTarget, { kind: "stdio" | "http" }>,
  opts: { timeoutMs?: number } = {},
): Promise<ProbeResults> {
  const budget = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 45000;
  try {
    return target.kind === "stdio" ? await probeStdio(target, budget) : await probeHttp(target);
  } catch (e) {
    return {
      bareToolsList: { skipped: `probe crashed: ${(e as Error).message}` },
      serverDiscover: { skipped: "probe crashed" },
    };
  }
}

/* ------------------------------ stdio ------------------------------ */

export class StdioSession {
  private proc: ChildProcess;
  private buf = "";
  private pending = new Map<number, (r: RpcReply) => void>();
  private nextId = 1;
  noise: string[] = [];
  stderrTail = "";
  exited = false;
  exitCode: number | null = null;

  constructor(command: string, args: string[], env?: Record<string, string>) {
    this.proc = crossSpawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...minimalChildEnv(), ...(env ?? {}) },
      windowsHide: true,
    });
    this.proc.stdout?.on("data", (c: Buffer) => this.onData(c.toString("utf8")));
    this.proc.stderr?.on("data", (c: Buffer) => {
      if (this.stderrTail.length < 2048) this.stderrTail += c.toString("utf8");
    });
    const finish = (code: number | null) => {
      this.exited = true;
      this.exitCode = code;
      for (const resolve of this.pending.values()) resolve({ procExit: code });
      this.pending.clear();
    };
    this.proc.on("exit", finish);
    this.proc.on("error", () => finish(null));
  }

  private onData(s: string): void {
    this.buf += s;
    // Bound memory: a hostile server can stream endlessly with no newline. If the
    // pending line grows past the cap, drop it (it cannot be a real JSON-RPC line).
    if (this.buf.length > 4 * 1024 * 1024) {
      if (this.noise.length < 5) this.noise.push("[oversized line dropped: >4MB without a newline]");
      this.buf = "";
      return;
    }
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        if (this.noise.length < 5) this.noise.push(truncate(line, 160));
        continue;
      }
      const m = msg as { id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };
      if (typeof m.id === "number" && this.pending.has(m.id)) {
        const resolve = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        resolve({ result: m.result, error: m.error });
      }
    }
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<RpcReply> {
    if (this.exited) return Promise.resolve({ procExit: this.exitCode });
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ timeout: true });
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.write({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, ...(params !== undefined ? { params } : {}) });
  }

  private write(obj: unknown): void {
    try {
      this.proc.stdin?.write(JSON.stringify(obj) + "\n");
    } catch {
      /* ignore */
    }
  }

  kill(): void {
    try {
      this.proc.stdin?.end();
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => this.hardKill(), 200);
    t.unref();
  }

  private hardKill(): void {
    if (this.exited) return;
    const pid = this.proc.pid;
    // On Windows, npx/.cmd servers run under a cmd.exe wrapper; proc.kill()
    // ends only the wrapper and orphans the real server. taskkill /T kills the
    // whole tree. cross-spawn resolves taskkill without a shell.
    if (pid !== undefined && process.platform === "win32") {
      try {
        crossSpawn.sync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
        return;
      } catch {
        /* fall through to kill() */
      }
    }
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }
}

function hasCacheFields(result: object): boolean {
  return (
    Object.prototype.hasOwnProperty.call(result, "ttlMs") &&
    Object.prototype.hasOwnProperty.call(result, "cacheScope")
  );
}

function toolOrder(result: unknown): string[] {
  const tools = (result as { tools?: { name?: string }[] } | null)?.tools ?? [];
  return tools.map((x) => x?.name).filter((n): n is string => typeof n === "string");
}

async function probeStdio(
  target: Extract<ResolvedTarget, { kind: "stdio" }>,
  budget: number,
): Promise<ProbeResults> {
  const results: ProbeResults = {};
  // A responsive server answers the bare request in well under a second, so a
  // generous cap only affects genuinely slow/hung servers (introspect already
  // proved the server starts and warmed the npx cache). A small --timeout is
  // honored rather than floored.
  const bareT = Math.min(Math.max(budget, 1), 15000);
  const discoverT = Math.min(Math.max(budget, 1), 10000);
  const sessions: StdioSession[] = [];

  // A bare stateless tools/list. BOTH legacy (the reference SDK has no init gate)
  // and RC servers answer it, so RC vs legacy is decided by the RESULT shape
  // (resultType, cache fields, server/discover), never by whether it answered.
  const s1 = new StdioSession(target.command, target.args, target.env);
  sessions.push(s1);
  const bare = await s1.request("tools/list", rcMeta(), bareT);
  const bareOutcome = toOutcome(
    bare,
    `no response within ${Math.round(bareT / 1000)}s (the server may require the removed initialize handshake)`,
  );
  results.bareToolsList = bareOutcome;

  let order1: string[] | undefined;
  if (bareOutcome.ok && bare.result) {
    results.resultTypePresent = Object.prototype.hasOwnProperty.call(bare.result, "resultType");
    results.cacheFieldsPresent = hasCacheFields(bare.result);
    order1 = toolOrder(bare.result);
  }

  // Probe server/discover only if the server is responsive (answered or errored,
  // not timed out), to avoid a second long wait on an unresponsive server.
  if (!s1.exited && bareOutcome.kind !== "timeout") {
    const d = await s1.request("server/discover", rcMeta(), discoverT);
    if (d.result) results.serverDiscover = { supported: true };
    else if (d.error && d.error.code === -32601) {
      results.serverDiscover = { supported: false, errorMessage: `${d.error.code} ${d.error.message}` };
    } else if (d.error) {
      results.serverDiscover = { skipped: `inconclusive (${d.error.code} ${d.error.message})` };
    } else {
      results.serverDiscover = { skipped: "no answer to server/discover" };
    }
  } else {
    results.serverDiscover = { skipped: "server did not answer the bare request" };
  }
  s1.kill();

  // Determinism (E112): a second fresh bare run, compared by tool order.
  if (order1 && order1.length > 1) {
    const s2 = new StdioSession(target.command, target.args, target.env);
    sessions.push(s2);
    const bare2 = await s2.request("tools/list", rcMeta(), bareT);
    s2.kill();
    if (bare2.result) {
      const order2 = toolOrder(bare2.result);
      if (order2.length) results.toolsOrderDeterministic = arraysEqual(order1, order2);
    }
  }

  const noise = [...new Set(sessions.flatMap((s) => s.noise))];
  if (noise.length) results.stdoutNoise = truncate(noise.join(" | "), 500);
  return results;
}

/* ------------------------------ http ------------------------------- */

export interface HttpReply {
  status: number;
  headers: Headers;
  body?: { result?: Record<string, unknown>; error?: { code: number; message: string } };
  authHeader?: string;
}

export async function postMessage(
  url: string,
  extraHeaders: Record<string, string> | undefined,
  msg: Record<string, unknown>,
  sessionId?: string,
  protocolVersion: string = LEGACY_VERSION,
): Promise<HttpReply> {
  const method = typeof msg.method === "string" ? msg.method : undefined;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": protocolVersion,
      // Mcp-Method is well-defined (SEP-2243); Mcp-Name is required too but its
      // value is not the method name, so it is omitted rather than sent wrong.
      ...(method ? { "Mcp-Method": method } : {}),
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...(extraHeaders ?? {}),
    },
    body: JSON.stringify(msg),
    // Never follow redirects: a hostile target could redirect an authenticated
    // request to an internal host and replay the user's --header credentials.
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 401 || res.status === 403) {
    return { status: res.status, headers: res.headers, authHeader: res.headers.get("www-authenticate") ?? undefined };
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await res.json().catch(() => undefined)) as HttpReply["body"];
    return { status: res.status, headers: res.headers, body };
  }
  if (ct.includes("text/event-stream") && res.body) {
    // readSseForId cancels the reader (and thus the stream) in its finally.
    const body = await readSseForId(res.body, msg.id as number | undefined, 8000);
    return { status: res.status, headers: res.headers, body };
  }
  return { status: res.status, headers: res.headers };
}

async function readSseForId(
  stream: ReadableStream<Uint8Array>,
  id: number | undefined,
  timeoutMs: number,
): Promise<HttpReply["body"]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"TIMEOUT">((resolve) => {
    timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    timer.unref?.();
  });
  try {
    for (;;) {
      const r = await Promise.race([reader.read(), timeout]);
      if (r === "TIMEOUT" || r.done) break;
      buf += decoder.decode(r.value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const event = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const data = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          const msg = JSON.parse(data) as { id?: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };
          if (id === undefined || msg.id === id) return { result: msg.result, error: msg.error };
        } catch {
          /* ignore non-JSON data */
        }
      }
    }
  } catch {
    /* stream error */
  } finally {
    clearTimeout(timer);
    // cancel() releases the lock and tears down the stream cleanly, even with a
    // read() still pending (releaseLock() would throw in that case).
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function outcomeFromHttp(reply: HttpReply): ProbeOutcome {
  if (reply.body?.error) {
    // A stateful HTTP server rejecting a bare request (session/not-initialized)
    // shows up here; kind:"error" lets looksLikeInitGate classify it.
    return { ok: false, kind: "error", errorCode: reply.body.error.code, errorMessage: reply.body.error.message };
  }
  if (reply.body && "result" in reply.body) return { ok: true, kind: "ok" };
  return { ok: false, kind: "error", errorMessage: `HTTP ${reply.status} with no JSON-RPC result` };
}

/** Reject non-https and private/loopback/link-local hosts to bound SSRF via
 *  attacker-controlled OAuth metadata URLs (see the target's WWW-Authenticate). */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  // IPv4-mapped IPv6, e.g. ::ffff:169.254.169.254 or ::ffff:a9fe:a9fe
  const mapped = h.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1]!;
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tail)) return isPrivateHost(tail);
    const hx = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hx) {
      const n = ((parseInt(hx[1]!, 16) << 16) | parseInt(hx[2]!, 16)) >>> 0;
      return isPrivateHost(`${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`);
    }
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  return false;
}

async function safeMetadataFetch(raw: string): Promise<Response> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "https:") throw new Error("non-https metadata url refused");
  if (isPrivateHost(u.hostname)) throw new Error("private-host metadata url refused");
  // Resolve the name and reject if it points at a private address (a DNS name
  // with an A record for 169.254.169.254 defeats a hostname-only check).
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(u.hostname, { all: true });
    if (addrs.some((r) => isPrivateHost(r.address))) throw new Error("metadata host resolves to a private address");
  } catch (e) {
    if ((e as Error).message.includes("private address")) throw e;
    // a plain DNS failure is left for fetch to surface
  }
  return fetch(u, { signal: AbortSignal.timeout(6000), redirect: "error", headers: { accept: "application/json" } });
}

async function analyzeAuth(
  wwwAuthenticate: string | undefined,
): Promise<NonNullable<ProbeResults["httpAuth"]>> {
  const out: NonNullable<ProbeResults["httpAuth"]> = { required: true, wwwAuthenticate };
  if (!wwwAuthenticate) return out;
  const m = wwwAuthenticate.match(/resource_metadata="?([^",\s]+)"?/i);
  if (!m) return out;
  out.resourceMetadataUrl = m[1];
  try {
    const res = await safeMetadataFetch(m[1]!);
    if (!res.ok) return out;
    const meta = (await res.json()) as { authorization_servers?: string[] };
    const as = meta.authorization_servers?.[0];
    if (!as) return out;
    out.authorizationServer = as;
    for (const candidate of [
      `${as.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
      `${new URL(as).origin}/.well-known/oauth-authorization-server`,
    ]) {
      try {
        const asRes = await safeMetadataFetch(candidate);
        if (!asRes.ok) continue;
        const asMeta = (await asRes.json()) as Record<string, unknown>;
        out.dcrRegistrationEndpoint = typeof asMeta.registration_endpoint === "string";
        const cimd = asMeta.client_id_metadata_document_supported;
        out.cimdSupported = typeof cimd === "boolean" ? cimd : undefined;
        break;
      } catch {
        /* try next candidate */
      }
    }
  } catch {
    /* leave partial info */
  }
  return out;
}

async function probeHttp(
  target: Extract<ResolvedTarget, { kind: "http" }>,
): Promise<ProbeResults> {
  const results: ProbeResults = {};
  const url = target.url;
  const headers = target.headers;

  const bare = await postMessage(
    url,
    headers,
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: rcMeta() },
    undefined,
    RC_VERSION,
  ).catch(
    (e) => ({ status: 0, headers: new Headers(), authHeader: undefined, body: undefined, error: e as Error }) as HttpReply & { error?: Error },
  );
  if ((bare as { error?: Error }).error) {
    const err = (bare as { error?: Error }).error!;
    const isTimeout = /timeout|timed out|aborted/i.test(`${err.name} ${err.message}`);
    results.bareToolsList = isTimeout
      ? { ok: false, kind: "timeout", errorMessage: `request timed out: ${err.message}` }
      : { skipped: `request failed: ${err.message}` };
  } else if (bare.authHeader !== undefined || bare.status === 401 || bare.status === 403) {
    results.httpAuth = await analyzeAuth(bare.authHeader);
    results.bareToolsList = { skipped: "authentication required" };
  } else {
    results.bareToolsList = outcomeFromHttp(bare);
    // Measure RC fields on the bare stateless result, the same way stdio does.
    if (bare.body && "result" in bare.body && bare.body.result) {
      results.resultTypePresent = Object.prototype.hasOwnProperty.call(bare.body.result, "resultType");
      results.cacheFieldsPresent = hasCacheFields(bare.body.result);
    }
  }

  // Probe server/discover on the bare stateless path too, exactly like stdio: a
  // 2026-07-28 server has no initialize, so waiting for the legacy branch would
  // leave E106 (a MUST rule) unmeasured on precisely the servers it targets.
  if (results.bareToolsList && "ok" in results.bareToolsList && results.bareToolsList.ok) {
    try {
      const d = await postMessage(
        url,
        headers,
        { jsonrpc: "2.0", id: 7, method: "server/discover", params: rcMeta() },
        undefined,
        RC_VERSION,
      );
      if (d.body?.result) results.serverDiscover = { supported: true };
      else if (d.body?.error && d.body.error.code === -32601) {
        results.serverDiscover = { supported: false, errorMessage: `${d.body.error.code} ${d.body.error.message}` };
      } else if (d.body?.error) {
        results.serverDiscover = { skipped: `inconclusive (${d.body.error.code} ${d.body.error.message})` };
      }
    } catch {
      /* leave for the legacy branch to try */
    }
    // Determinism (E112) on the bare path: a second bare request, like stdio.
    const bareTools = toolOrder(bare.body && "result" in bare.body ? bare.body.result : undefined);
    if (bareTools.length > 1) {
      try {
        const again = await postMessage(
          url,
          headers,
          { jsonrpc: "2.0", id: 8, method: "tools/list", params: rcMeta() },
          undefined,
          RC_VERSION,
        );
        const order2 = toolOrder(again.body?.result);
        if (order2.length) results.toolsOrderDeterministic = arraysEqual(bareTools, order2);
      } catch {
        /* inconclusive */
      }
    }
  }

  if (!results.httpAuth) {
    try {
      const init = await postMessage(url, headers, {
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: { name: "efaimo-probe", version: VERSION } },
      });
      if (init.authHeader !== undefined) {
        results.httpAuth = await analyzeAuth(init.authHeader);
      } else if (init.body?.result) {
        const sessionId = init.headers.get("mcp-session-id") ?? undefined;
        await postMessage(url, headers, { jsonrpc: "2.0", method: "notifications/initialized" }, sessionId).catch(() => undefined);
        const t1 = await postMessage(url, headers, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }, sessionId);
        let order1: string[] | undefined;
        if (t1.body?.result) {
          // Never overwrite what the bare stateless path already measured: a
          // dual-stack server legitimately answers legacy-version requests with
          // legacy-shaped results, and clobbering the RC measurements here
          // would fabricate readiness findings on the best-migrated servers.
          results.resultTypePresent ??= Object.prototype.hasOwnProperty.call(t1.body.result, "resultType");
          results.cacheFieldsPresent ??= hasCacheFields(t1.body.result);
          const tools = (t1.body.result as { tools?: { name?: string }[] }).tools ?? [];
          order1 = tools.map((x) => x?.name).filter((n): n is string => typeof n === "string");
        }
        if (results.serverDiscover === undefined) {
          const d = await postMessage(url, headers, { jsonrpc: "2.0", id: 4, method: "server/discover", params: {} }, sessionId);
          if (d.body?.result) results.serverDiscover = { supported: true };
          else if (d.body?.error && d.body.error.code === -32601) {
            results.serverDiscover = { supported: false, errorMessage: `${d.body.error.code} ${d.body.error.message}` };
          } else if (d.body?.error) {
            results.serverDiscover = { skipped: `inconclusive (${d.body.error.code} ${d.body.error.message})` };
          } else results.serverDiscover = { skipped: "no answer to server/discover" };
        }

        if (order1 && order1.length > 1 && results.toolsOrderDeterministic === undefined) {
          const init2 = await postMessage(url, headers, {
            jsonrpc: "2.0",
            id: 5,
            method: "initialize",
            params: { protocolVersion: LEGACY_VERSION, capabilities: {}, clientInfo: { name: "efaimo-probe", version: VERSION } },
          });
          if (init2.body?.result) {
            const session2 = init2.headers.get("mcp-session-id") ?? undefined;
            await postMessage(url, headers, { jsonrpc: "2.0", method: "notifications/initialized" }, session2).catch(() => undefined);
            const t2 = await postMessage(url, headers, { jsonrpc: "2.0", id: 6, method: "tools/list", params: {} }, session2);
            if (t2.body?.result) {
              const tools2 = (t2.body.result as { tools?: { name?: string }[] }).tools ?? [];
              const order2 = tools2.map((x) => x?.name).filter((n): n is string => typeof n === "string");
              results.toolsOrderDeterministic = arraysEqual(order1, order2);
            }
          }
        }
      }
    } catch (e) {
      results.serverDiscover = results.serverDiscover ?? { skipped: `legacy session failed: ${(e as Error).message}` };
    }
  }

  try {
    const origin = new URL(url).origin;
    const cardUrl = `${origin}/.well-known/mcp`;
    // redirect:"error" so a hostile target cannot bounce this to an internal host.
    const sc = await fetch(cardUrl, { signal: AbortSignal.timeout(5000), redirect: "error", headers: { accept: "application/json" } });
    results.serverCard = {
      found: sc.ok && (sc.headers.get("content-type") ?? "").includes("json"),
      url: cardUrl,
    };
  } catch {
    results.serverCard = { skipped: "well-known lookup failed" };
  }

  return results;
}
