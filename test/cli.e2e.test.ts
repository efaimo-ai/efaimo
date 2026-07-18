import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const CLI = path.join(root, "dist", "cli.js");
const SKILLS = path.join(here, "fixtures", "skills");

function run(args: string[], cwd?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--no-color"], { encoding: "utf8", cwd });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// The e2e suite runs the built CLI; CI builds before testing. Skip if no build.
const built = fs.existsSync(CLI);

describe.skipIf(!built)("cli e2e (built dist)", () => {
  it("prints its version", () => {
    const r = run(["--version"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("0.1.0");
  });

  it("rejects a non-numeric --timeout with a clear error (exit 2)", () => {
    const r = run(["check", "--mcp", "node whatever.js", "--timeout", "30s"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--timeout/);
  });

  it("emits a valid JSON envelope and exits 1 on a failing skill", () => {
    const r = run(["check", "--skill", path.join(SKILLS, "bad-skill"), "--json"]);
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.out);
    expect(parsed.tool).toBe("efaimo");
    expect(parsed.data.surface).toBe("skill");
    expect(parsed.data.findings.length).toBeGreaterThan(0);
  });

  it("enforces --max-tokens on a skill weigh (exit 1)", () => {
    const r = run(["weigh", path.join(SKILLS, "good-skill"), "--max-tokens", "1"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/budget exceeded/);
  });

  it("weighs a skill under budget cleanly (exit 0)", () => {
    const r = run(["weigh", path.join(SKILLS, "good-skill"), "--max-tokens", "100000"]);
    expect(r.code).toBe(0);
  });

  it("weigh --client skips a broken server and still weighs the rest (exit 0)", () => {
    const cfgDir = path.join(here, "fixtures", "clientcfg-mixed");
    const r = run(["weigh", "--client", "vscode", "--timeout", "20"], cfgDir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/weigh mcp/); // the good fixture server produced a report
    expect(r.err).toMatch(/skipped vscode:broken/);
    expect(r.err).toMatch(/weighed 1 of 2 servers/);
  });

  it("weigh --client fails loudly when every server fails (exit 2)", () => {
    const cfgDir = path.join(here, "fixtures", "clientcfg-broken");
    const r = run(["weigh", "--client", "vscode", "--timeout", "20"], cfgDir);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/no server could be weighed/);
  });
});
