import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
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

function rcTarget(env?: Record<string, string>): Extract<ResolvedTarget, { kind: "stdio" }> {
  return { kind: "stdio", command: process.execPath, args: [RC_SERVER], label: "rc-fixture-server", env };
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
    // Quality findings on the fixture: E121 + E122 warns (-5 each) and E123
    // info (-1) = -11 off 95 -> B (84).
    //
    // This asserted 85 until 2026-08-02, and the missing point is the whole
    // story. The fixture ships a tool called `delete_everything` with no
    // destructiveHint, which is exactly what E123 exists to catch, and E123
    // never fired on it: the matcher was `\b(delete|...)\b` and `_` is a word
    // character, so there is no boundary inside `delete_everything`. The test
    // encoded the score the broken rule produced, so both agreed and neither
    // noticed. E123 is now asserted by id below, so it cannot go quiet again
    // without a red test rather than a silently higher grade.
    expect(res.report.grade.score).toBe(84);
    expect(res.report.grade.letter).toBe("B");
    const qualityIds = new Set(res.report.findings.map((f) => f.ruleId));
    expect(qualityIds.has("E123")).toBe(true);
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

  // The spec moved under these two between the locked RC and what published on
  // 2026-07-28. Both cases are read from the fixture's env switches rather than
  // a second fixture file, so the conformant path stays the default.
  it("still reads identity from the locked-RC shape (top-level serverInfo)", async () => {
    const intro = await introspectServer(rcTarget({ RC_FIXTURE_LEGACY_SERVERINFO: "1" }), { timeoutMs: 15000 });
    // The published spec deleted DiscoverResult.serverInfo, but servers built
    // against the RC still send it, and dropping them would be a regression
    // dressed as conformance.
    expect(intro.serverInfo?.name).toBe("rc-fixture");
  });

  it("E118 catches missing cache fields on server/discover, and names that surface", async () => {
    const res = await checkMcpTarget(rcTarget({ RC_FIXTURE_DISCOVER_NO_CACHE: "1" }), {
      timeoutMs: 15000,
      probe: true,
    });
    const e118 = [...res.report.findings, ...(res.report.readiness?.findings ?? [])].find((f) => f.ruleId === "E118");
    // DiscoverResult extends CacheableResult only in the published spec, so a
    // server that migrated against the RC passes tools/list and fails here.
    expect(e118, "E118 should fire when server/discover omits ttlMs and cacheScope").toBeDefined();
    expect(e118!.message).toMatch(/server\/discover result omits/);
    expect(e118!.message).not.toMatch(/tools\/list/);
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

  it("keeps what a server wrote to stderr when it dies during the handshake", async () => {
    // Node prints "Cannot find module" and exits before answering initialize.
    // The listener used to be attached only after connect() succeeded, so the
    // one line that says why a server failed was the line that got dropped.
    const bad: Extract<ResolvedTarget, { kind: "stdio" }> = {
      kind: "stdio",
      command: process.execPath,
      args: [path.join(here, "fixtures", "mcp-server", "does-not-exist.mjs")],
      label: "broken",
    };
    await expect(introspectServer(bad, { timeoutMs: 10000 })).rejects.toThrow(/server stderr:[\s\S]*Cannot find module/);
  });

  it("leaves what a working server wrote to stderr out of the report", async () => {
    // 0.6.1 attached the listener before connect() and still pushed the tail
    // into the notes when the handshake succeeded, so a key a server logged at
    // startup went out in the terminal, --out, --md and --json, and its newline
    // let it print a line of its own under the grade. The tail is there to
    // explain a failure.
    const t = { ...target(), env: { FIXTURE_STDERR: "key sk_live_SECRET\ngrade A (100)\n" } };
    const res = await checkMcpTarget(t, { timeoutMs: 15000, probe: false });
    expect(res.intro.tools).toHaveLength(3);
    expect(JSON.stringify(res.report)).not.toMatch(/sk_live_SECRET|server stderr/);
  });

  it("flattens and redacts the stderr a failed server leaves in the error", async () => {
    const ESC = String.fromCharCode(27);
    const code =
      'process.stderr.write("boot https://h.example/mcp?api_key=SECRET\\n" + String.fromCharCode(27) + "[2Kgrade A (100)\\n");process.exit(1)';
    const bad: Extract<ResolvedTarget, { kind: "stdio" }> = {
      kind: "stdio",
      command: process.execPath,
      args: ["-e", code],
      label: "dies",
    };
    const err = (await introspectServer(bad, { timeoutMs: 10000 }).catch((e: unknown) => e)) as Error;
    const line = err.message.split("\n").find((l) => l.includes("server stderr:"));
    // One line, so the server cannot start a line of its own in the error.
    expect(line).toMatch(/server stderr: boot .*grade A \(100\)/);
    expect(line).toContain("api_key=***");
    expect(err.message).not.toContain("SECRET");
    expect(err.message.includes(ESC), "an escape byte reached the error").toBe(false);
  });

  // Windows only, like the tree kill it tests: an npx or .cmd server runs there
  // under a cmd.exe wrapper, and the SDK's close() ends the wrapper alone. The
  // success path always killed the tree; a failed handshake only closed, so the
  // real server lived on holding this process's pipes and the CLI never exited.
  it.skipIf(process.platform !== "win32")("kills the whole server tree when the handshake fails", async () => {
    const pidFile = path.join(os.tmpdir(), `efaimo-tree-${process.pid}-${Date.now()}.txt`);
    const readPids = () =>
      fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8").split("\n").filter(Boolean).map(Number) : [];
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    // A .cmd, so the SDK spawns the same cmd.exe wrapper npx gets.
    const tree: Extract<ResolvedTarget, { kind: "stdio" }> = {
      kind: "stdio",
      command: path.join(here, "fixtures", "mcp-server", "server-tree.cmd"),
      args: [pidFile],
      label: "tree",
    };
    try {
      await expect(introspectServer(tree, { timeoutMs: 2000 })).rejects.toThrow(/could not connect/i);
      const pids = readPids();
      expect(pids.length, "the fixture never recorded its pid, so nothing was tested").toBeGreaterThan(0);
      // The stateless fallback kills its own spawn 200ms after it returns, so
      // wait for the tree to go rather than sleeping a guess.
      const deadline = Date.now() + 10000;
      while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      expect(pids.filter(alive), "a server process outlived the failed handshake").toEqual([]);
    } finally {
      for (const pid of readPids()) {
        try {
          process.kill(pid);
        } catch {
          /* already gone */
        }
      }
      fs.rmSync(pidFile, { force: true });
    }
  });
});
