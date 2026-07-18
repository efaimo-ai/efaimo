import { describe, it, expect } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { looksLikeInitGate, runProbes } from "../src/clients/rawprobe.js";
import type { ProbeOutcome } from "../src/core/types.js";

function err(errorMessage: string, errorCode?: number): ProbeOutcome {
  return { ok: false, kind: "error", errorCode, errorMessage };
}

describe("looksLikeInitGate", () => {
  it("matches the messages real SDKs use for the init/session gate", () => {
    expect(looksLikeInitGate(err("Bad Request: Server not initialized", -32000))).toBe(true);
    expect(looksLikeInitGate(err("Bad Request: Mcp-Session-Id header is required", -32000))).toBe(true);
    expect(looksLikeInitGate(err("Session not found", -32001))).toBe(true);
    expect(looksLikeInitGate(err("Received request before initialization was complete"))).toBe(true);
    expect(looksLikeInitGate(err("No valid session ID provided"))).toBe(true);
  });

  it("does not treat unrelated errors, codes, or timeouts as an init gate", () => {
    // -32002 is Resource-not-found in the 2025 specs, -32022 is
    // UnsupportedProtocolVersion in the RC; neither proves an init gate.
    expect(looksLikeInitGate(err("Resource not found", -32002))).toBe(false);
    expect(looksLikeInitGate(err("Unsupported protocol version", -32022))).toBe(false);
    expect(looksLikeInitGate(err("Method not found", -32601))).toBe(false);
    expect(looksLikeInitGate({ ok: false, kind: "timeout", errorMessage: "no response" })).toBe(false);
    expect(looksLikeInitGate({ ok: true, kind: "ok" })).toBe(false);
  });
});

describe("http probes against a mock stateless server", () => {
  it("measures server/discover and RC fields on the bare stateless path", async () => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        let msg: { id?: number; method?: string } = {};
        try {
          msg = JSON.parse(body || "{}") as { id?: number; method?: string };
        } catch {
          /* GET /.well-known/mcp has no body */
        }
        const reply = (result: object) =>
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        if (msg.method === "tools/list") {
          reply({
            tools: [{ name: "alpha" }, { name: "beta" }],
            resultType: "complete",
            ttlMs: 60000,
            cacheScope: "public",
          });
        } else if (msg.method === "server/discover") {
          reply({
            supportedVersions: ["2026-07-28"],
            capabilities: { tools: {} },
            serverInfo: { name: "mock-rc" },
            resultType: "complete",
            ttlMs: 60000,
            cacheScope: "public",
          });
        } else {
          res.end(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } }),
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const probes = await runProbes(
        { kind: "http", url: `http://127.0.0.1:${port}/mcp`, label: "mock" },
        { timeoutMs: 10000 },
      );
      expect(probes.bareToolsList).toMatchObject({ ok: true });
      // The regression this guards: server/discover must be probed on the bare
      // stateless path, not only inside the legacy-initialize branch.
      expect(probes.serverDiscover).toMatchObject({ supported: true });
      expect(probes.resultTypePresent).toBe(true);
      expect(probes.cacheFieldsPresent).toBe(true);
      expect(probes.toolsOrderDeterministic).toBe(true);
    } finally {
      server.close();
    }
  }, 30000);

  it("keeps bare-path RC measurements when a dual-stack server also speaks legacy", async () => {
    // A well-migrated dual-stack server: RC-version requests get RC-shaped
    // results and a working server/discover; legacy-version requests (which
    // efaimo's legacy-session branch sends after a successful initialize) get
    // 2025-shaped results and no server/discover. The legacy branch must not
    // clobber what the bare stateless path measured.
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        let msg: { id?: number; method?: string } = {};
        try {
          msg = JSON.parse(body || "{}") as { id?: number; method?: string };
        } catch {
          /* no body */
        }
        const rc = req.headers["mcp-protocol-version"] === "2026-07-28";
        const reply = (result: object) =>
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
        const rpcError = (code: number, message: string) =>
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code, message } }));
        if (msg.method === "initialize") {
          reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "dual" } });
        } else if (msg.method === "tools/list") {
          if (rc) {
            reply({
              tools: [{ name: "alpha" }, { name: "beta" }],
              resultType: "complete",
              ttlMs: 60000,
              cacheScope: "public",
            });
          } else {
            reply({ tools: [{ name: "alpha" }, { name: "beta" }] }); // legacy shape: no RC fields
          }
        } else if (msg.method === "server/discover") {
          if (rc) {
            reply({
              supportedVersions: ["2026-07-28", "2025-06-18"],
              capabilities: { tools: {} },
              serverInfo: { name: "dual" },
              resultType: "complete",
              ttlMs: 60000,
              cacheScope: "public",
            });
          } else rpcError(-32601, "Method not found");
        } else if (msg.method === "notifications/initialized") {
          res.end("{}");
        } else {
          rpcError(-32601, "Method not found");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const probes = await runProbes(
        { kind: "http", url: `http://127.0.0.1:${port}/mcp`, label: "dual" },
        { timeoutMs: 10000 },
      );
      expect(probes.bareToolsList).toMatchObject({ ok: true });
      // These were measured on the bare RC path; the legacy branch (which sees
      // legacy-shaped results and a -32601 discover) must not overwrite them.
      expect(probes.serverDiscover).toMatchObject({ supported: true });
      expect(probes.resultTypePresent).toBe(true);
      expect(probes.cacheFieldsPresent).toBe(true);
      expect(probes.toolsOrderDeterministic).toBe(true);
    } finally {
      server.close();
    }
  }, 30000);
});
