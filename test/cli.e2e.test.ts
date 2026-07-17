import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const CLI = path.join(root, "dist", "cli.js");
const SKILLS = path.join(here, "fixtures", "skills");

function run(args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--no-color"], { encoding: "utf8" });
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
});
