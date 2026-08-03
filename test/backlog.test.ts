import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkMcpRepoOnly, checkSkillSet } from "../src/check/check.js";
import { scanRepo } from "../src/targets/repoScan.js";
import { runScenario, withRetry, parseScenario, type Runner } from "../src/testing/harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `efaimo-${prefix}-`));
}

// Each test here pins a 0.1.2 fix by exercising the case its old behavior got
// wrong: an empty scan that passed, a grade inversion, a mislabeled SDK, a
// dropped transient retry, a false-positive escape, and a NaN in the report.

describe("0.1.2: an empty MCP scan is a failure, not a clean A(100)", () => {
  it("throws when a directory has no code and no MCP SDK dependency", () => {
    const dir = tmp("emptyscan");
    // no code files, no package.json/pyproject naming an SDK
    fs.writeFileSync(path.join(dir, "README.md"), "# nothing to audit here\n");
    expect(() => checkMcpRepoOnly(dir, "empty")).toThrow(/no MCP server source/i);
  });

  it("still reports on a directory whose manifest names the SDK", () => {
    const dir = tmp("hassdk");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { "@modelcontextprotocol/sdk": "^1.0.0" } }),
    );
    // Has an SDK signal even with zero code files: examined something, so no throw.
    expect(() => checkMcpRepoOnly(dir, "hassdk")).not.toThrow();
  });
});

describe("0.1.2: S101 does not let a missing frontmatter outscore a broken one", () => {
  it("reports the required fields as missing when there is no frontmatter", async () => {
    const dir = tmp("nofm");
    fs.writeFileSync(path.join(dir, "SKILL.md"), "# just a body\n\nNo frontmatter block at all.\n");
    const res = await checkSkillSet(dir, "nofm");
    const s101 = res.perSkill[0]!.report.findings.filter((f) => f.ruleId === "S101");
    // The old early-return stopped after one parse error, so `name`/`description`
    // missing were never reported and a bare body graded higher than a typo.
    expect(s101.some((f) => /name/i.test(f.message))).toBe(true);
    expect(s101.some((f) => /description/i.test(f.message))).toBe(true);
    expect(res.perSkill[0]!.report.counts.error).toBeGreaterThan(1);
  });
});

describe("0.1.2: a Poetry caret constraint is read as 2.x, not legacy", () => {
  it("classifies `mcp = \"^2.0\"` in pyproject.toml as a migrated (rc/2.x) SDK", () => {
    const dir = tmp("poetry");
    fs.writeFileSync(
      path.join(dir, "pyproject.toml"),
      `[tool.poetry.dependencies]\npython = "^3.11"\nmcp = "^2.0"\n`,
    );
    const scan = scanRepo(dir);
    const mcp = scan.sdk?.find((s) => s.package === "mcp");
    expect(mcp, "mcp dependency should be detected").toBeTruthy();
    // Old regex captured the `=` assignment and read the version as legacy.
    expect(mcp!.generation).toBe("rc");
  });

  it("still classifies `mcp==1.5` as legacy", () => {
    const dir = tmp("poetry-legacy");
    fs.writeFileSync(path.join(dir, "requirements.txt"), "mcp==1.5.0\n");
    const scan = scanRepo(dir);
    expect(scan.sdk?.find((s) => s.package === "mcp")?.generation).toBe("legacy");
  });
});

describe("0.1.2: the live harness retries a transient failure instead of discarding the run", () => {
  it("retries a 429 and then succeeds", async () => {
    let calls = 0;
    const flaky: Runner = async () => {
      calls++;
      if (calls === 1) throw new Error("openai API 429: rate limited");
      return "ok";
    };
    const out = await withRetry(flaky, 4, 1)({ user: "x", model: "gpt-4o-mini" });
    expect(out).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does NOT retry a non-transient error (bad key)", async () => {
    let calls = 0;
    const badKey: Runner = async () => {
      calls++;
      throw new Error("openai API 401: invalid api key");
    };
    await expect(withRetry(badKey, 4, 1)({ user: "x", model: "gpt-4o-mini" })).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });
});

describe("0.1.2: S106 uses a real escape check, not a `..` substring", () => {
  it("does not flag a file whose name merely contains `..` as escaping", async () => {
    const dir = tmp("dotdot");
    fs.writeFileSync(path.join(dir, "notes..md"), "notes\n");
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: dotdot\ndescription: A skill whose reference name contains dots but stays inside its own directory, used to verify the escape check is lexical and not a naive substring match.\n---\n\nSee [notes](notes..md).\n`,
    );
    const res = await checkSkillSet(dir, "dotdot");
    const escapeFindings = res.perSkill[0]!.report.findings.filter(
      (f) => f.ruleId === "S106" && /escapes/i.test(f.message),
    );
    expect(escapeFindings).toEqual([]);
  });
});

describe("0.1.2: the test report never prints NaN when an arm has no scored trial", () => {
  it("is inconclusive with a clean note, not '95% interval NaN to NaN'", async () => {
    const s = parseScenario(path.join(here, "..", "examples", "scenario.example.yaml"));
    // The judge never returns PASS or FAIL, so every trial is unparseable and
    // both arms have zero scored trials: 0/0 = NaN if printed unguarded.
    const runner: Runner = async (req) =>
      req.system?.startsWith("You are a strict grader") ? "cannot tell either way" : "answer";
    const report = await runScenario(s, runner);
    expect(report.verdict).toBe("inconclusive");
    expect(report.notes.join(" ")).not.toMatch(/NaN/);
    expect(report.withSkill.scored).toBe(0);
  });
});
