import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenario, armSystems, runScenario, type Runner } from "../src/testing/harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(here, "..", "examples", "scenario.example.yaml");

describe("efaimo test harness", () => {
  it("parses a scenario and loads the skill body", () => {
    const s = parseScenario(EXAMPLE);
    expect(s.skillName).toBe("csv-cleanup");
    expect(s.skillBody).toMatch(/deduplicate|duplicate|CSV/i);
    expect(s.trials).toBe(8);
    expect(s.task).toMatch(/Clean this CSV/);
    expect(s.judge).toMatch(/PASS only if/);
  });

  it("builds a with-skill system prompt that contains the skill, and a bare without arm", () => {
    const s = parseScenario(EXAMPLE);
    const arms = armSystems(s);
    expect(arms.withoutSkill).toBeUndefined();
    expect(arms.withSkill).toContain(s.skillBody);
    expect(arms.withSkill).toContain('name="csv-cleanup"');
  });

  it("measures the A/B delta with an injected mock runner (no API calls)", async () => {
    const s = parseScenario(EXAMPLE);
    // Mock: the model only succeeds ("DONE") when the skill is in context; the
    // judge passes an answer iff it is "DONE".
    const runner: Runner = async (req) => {
      if (req.system?.startsWith("You are a strict grader")) {
        return req.user.includes("ASSISTANT ANSWER:\nDONE") ? "PASS" : "FAIL";
      }
      return req.system?.includes("<skill") ? "DONE" : "unsure";
    };
    const report = await runScenario(s, runner);
    expect(report.withSkill.passes).toBe(8);
    expect(report.withoutSkill.passes).toBe(0);
    expect(report.deltaPoints).toBe(100);
    expect(report.verdict).toBe("helps");
  });

  it("reports no measurable effect when the skill changes nothing", async () => {
    const s = parseScenario(EXAMPLE);
    const runner: Runner = async (req) =>
      req.system?.startsWith("You are a strict grader") ? "PASS" : "answer";
    const report = await runScenario(s, runner);
    expect(report.deltaPoints).toBe(0);
    expect(report.verdict).toBe("no measurable effect");
  });

  it("rejects a scenario missing required fields", () => {
    expect(() => parseScenario(path.join(here, "fixtures", "does-not-exist.yaml"))).toThrow();
  });
});
