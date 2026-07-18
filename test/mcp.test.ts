import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkMcpTarget } from "../src/check/check.js";
import { weighServer } from "../src/weigh/weigh.js";
import { introspectServer } from "../src/clients/introspect.js";
import type { CheckReport } from "../src/core/types.js";
import type { ResolvedTarget } from "../src/targets/resolve.js";

/** Rule ids across BOTH the graded findings and the readiness diff. */
function allIds(report: CheckReport): Set<string> {
  return new Set([...report.findings, ...(report.readiness?.findings ?? [])].map((f) => f.ruleId));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "fixtures", "mcp-server", "server.mjs");
const RC_SERVER = path.join(here, "fixtures", "mcp-server", "server-rc.mjs");

function target(): Extract<ResolvedTarget, { kind: "stdio" }> {
  return { kind: "stdio", command: process.execPath, args: [SERVER], label: "fixture-server" };
}

function rcTarget(): Extract<ResolvedTarget, { kind: "stdio" }> {
  return { kind: "stdio", command: process.execPath, args: [RC_SERVER], label: "rc-fixture-server" };
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
    const ids = allIds(res.report);
    expect(ids.has("E104")).toBe(true);
    expect(ids.has("E121")).toBe(true); // echo: "echo"
    expect(ids.has("E123")).toBe(true); // no annotations, destructive delete_everything
  });

  it("readiness probes: fixture answers bare, so E105 stays silent but E106/E107/E118 fire", async () => {
    const res = await checkMcpTarget(target(), { timeoutMs: 15000, probe: true });
    const ids = allIds(res.report);
    // The fixture answers a bare tools/list (like the reference SDK), so it is
    // NOT flagged as requiring the initialize handshake...
    expect(ids.has("E105")).toBe(false);
    // ...but it lacks the RC-conformant shape, measured on the bare result.
    expect(ids.has("E106")).toBe(true); // no server/discover (-32601)
    expect(ids.has("E107")).toBe(true); // no resultType on the bare result
    expect(ids.has("E118")).toBe(true); // no ttlMs/cacheScope on the bare result
  });

  it("grades quality only; readiness is an ungraded migration diff", async () => {
    const res = await checkMcpTarget(target(), { timeoutMs: 15000, probe: true });
    // Quality findings on the fixture: E121 + E122 + E123 warns = -15 -> B (85).
    expect(res.report.grade.score).toBe(85);
    expect(res.report.grade.letter).toBe("B");
    expect(res.report.findings.every((f) => /^E1[23]\d$/.test(f.ruleId))).toBe(true);
    // Readiness findings live in the separate diff, not in the graded set.
    const readinessIds = new Set(res.report.readiness!.findings.map((f) => f.ruleId));
    expect(readinessIds.has("E104")).toBe(true);
    expect(readinessIds.has("E106")).toBe(true);
    expect(readinessIds.has("E118")).toBe(true);
    expect(res.report.readiness!.counts.warn).toBeGreaterThanOrEqual(3);
  });

  it("introspects a stateless (2026-07-28) server via the bare-request fallback", async () => {
    const intro = await introspectServer(rcTarget(), { timeoutMs: 15000 });
    expect(intro.tools.map((t) => t.name).sort()).toEqual(["get_record", "list_records"]);
    expect(intro.serverInfo?.name).toBe("rc-fixture");
    expect(intro.protocolVersion).toBe("2026-07-28");
    expect(intro.notes.join(" ")).toMatch(/stateless/);
  });

  it("audits a fully RC-conformant server clean (no readiness findings, grade A)", async () => {
    const res = await checkMcpTarget(rcTarget(), { timeoutMs: 15000, probe: true });
    const ids = allIds(res.report);
    for (const readiness of ["E104", "E105", "E106", "E107", "E112", "E116", "E118"]) {
      expect(ids.has(readiness), `${readiness} should not fire on an RC server`).toBe(false);
    }
    expect(res.report.counts.error).toBe(0);
    expect(res.report.readiness!.findings.length).toBe(0);
    expect(res.report.grade.letter).toBe("A");
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
