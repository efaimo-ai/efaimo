import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkMcpTarget } from "../src/check/check.js";
import { weighServer } from "../src/weigh/weigh.js";
import { introspectServer } from "../src/clients/introspect.js";
import type { ResolvedTarget } from "../src/targets/resolve.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "fixtures", "mcp-server", "server.mjs");

function target(): Extract<ResolvedTarget, { kind: "stdio" }> {
  return { kind: "stdio", command: process.execPath, args: [SERVER], label: "fixture-server" };
}

describe("mcp introspection + rules (live fixture server)", () => {
  it("introspects tools over stdio", async () => {
    const intro = await introspectServer(target(), { timeoutMs: 15000 });
    const names = intro.tools.map((t) => t.name).sort();
    expect(names).toEqual(["add", "delete_everything", "echo"]);
    expect(intro.serverInfo?.name).toBe("fixture-server");
    expect(intro.capabilities).toHaveProperty("logging");
  });

  it("weighs the fixture server deterministically", async () => {
    const intro = await introspectServer(target(), { timeoutMs: 15000 });
    const w1 = await weighServer(intro);
    const w2 = await weighServer(intro);
    expect(w1.totals.claudeStyle).toBe(w2.totals.claudeStyle);
    expect(w1.totals.claudeStyle).toBeGreaterThan(0);
    // heaviest tool is sorted first
    expect(w1.perTool[0]!.tokens.claudeStyle).toBeGreaterThanOrEqual(w1.perTool[1]!.tokens.claudeStyle);
  });

  it("flags logging capability (E104), thin echo description (E121), and missing annotations (E123)", async () => {
    const res = await checkMcpTarget(target(), { timeoutMs: 15000, probe: false });
    const ids = new Set(res.report.findings.map((f) => f.ruleId));
    expect(ids.has("E104")).toBe(true);
    expect(ids.has("E121")).toBe(true); // echo: "echo"
    expect(ids.has("E123")).toBe(true); // no annotations, destructive delete_everything
  });

  it("readiness probes: fixture answers bare, so E105 stays silent but E106/E107/E118 fire", async () => {
    const res = await checkMcpTarget(target(), { timeoutMs: 15000, probe: true });
    const ids = new Set(res.report.findings.map((f) => f.ruleId));
    // The fixture answers a bare tools/list (like the reference SDK), so it is
    // NOT flagged as requiring the initialize handshake...
    expect(ids.has("E105")).toBe(false);
    // ...but it lacks the RC-conformant shape, measured on the bare result.
    expect(ids.has("E106")).toBe(true); // no server/discover (-32601)
    expect(ids.has("E107")).toBe(true); // no resultType on the bare result
    expect(ids.has("E118")).toBe(true); // no ttlMs/cacheScope on the bare result
  });

  it("errors clearly on an unreachable server", async () => {
    const bad: Extract<ResolvedTarget, { kind: "stdio" }> = {
      kind: "stdio",
      command: process.execPath,
      args: [path.join(here, "fixtures", "mcp-server", "does-not-exist.mjs")],
      label: "broken",
    };
    await expect(checkMcpTarget(bad, { timeoutMs: 10000, probe: false })).rejects.toThrow(/could not connect/i);
  });
});
