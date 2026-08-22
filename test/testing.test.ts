import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseScenario, armSystems, runScenario, type Runner } from "../src/testing/harness.js";
import { acceptsSamplingParams, anthropicRequestBody } from "../src/testing/anthropicRunner.js";

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

/**
 * The live request body.
 *
 * This block exists because of a specific failure: the runner is injected so
 * the A/B logic can be tested without spending tokens, which meant every test
 * in this repo exercised a fake and none of them had ever built the real
 * request. `temperature` was sent unconditionally, Claude removed sampling
 * parameters from the 4.7 line onward, and the scenario default model is
 * `claude-sonnet-5`, so `efaimo test --live` threw a 400 on its first call
 * with 136 tests green over it. See ADR-031.
 */
describe("anthropic request body", () => {
  // Derived, not typed. The bug was the INTERSECTION of two facts - which model
  // a run ends up on, and what the body sends - so the tests have to hold both
  // at once. Hardcoding "claude-sonnet-5" here would let a future change to
  // either side re-open the hole with these still green.
  it("sends no temperature on the model the shipped example scenarios use", () => {
    const model = parseScenario(EXAMPLE).model;
    expect(acceptsSamplingParams(model), `examples/ run on ${model}, which must not be sent sampling params`).toBe(false);
    expect(anthropicRequestBody({ model, user: "hi", deterministic: true })).not.toHaveProperty("temperature");
  });

  it("sends no temperature on the model parseScenario falls back to", () => {
    // A scenario with no `model:` key at all, which is the path a user takes
    // when they copy the minimum from the docs.
    const dir = path.join(here, "fixtures");
    const file = path.join(dir, "scenario-nomodel.tmp.yaml");
    fs.writeFileSync(
      file,
      "name: t\nskill: ./skills/good-skill\ntask: do the thing\njudge: PASS only if it did the thing\n",
    );
    try {
      const model = parseScenario(file).model;
      expect(acceptsSamplingParams(model), `the fallback model is ${model}`).toBe(false);
      expect(anthropicRequestBody({ model, user: "hi", deterministic: true })).not.toHaveProperty("temperature");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("still pins the judge on models that accept the parameter", () => {
    const body = anthropicRequestBody({ model: "claude-sonnet-4-6", user: "hi", deterministic: true });
    expect(body.temperature).toBe(0);
    expect(anthropicRequestBody({ model: "claude-sonnet-4-6", user: "hi" }).temperature).toBe(1);
  });

  it("knows which model lines removed sampling parameters", () => {
    for (const m of ["claude-sonnet-5", "claude-opus-5", "claude-opus-4-7", "claude-opus-4-8", "claude-fable-5"]) {
      expect(acceptsSamplingParams(m), `${m} removed sampling params`).toBe(false);
    }
    for (const m of ["claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4-5-20250929", "claude-haiku-4-5", "claude-opus-4-5", "claude-3-5-sonnet-20241022"]) {
      expect(acceptsSamplingParams(m), `${m} still accepts sampling params`).toBe(true);
    }
  });

  it("defaults an unknown future model to sending nothing", () => {
    // The allowlist is closed on purpose: a model released after it was
    // written must fall to the safe side, because omitting the parameter costs
    // determinism and sending it costs the whole run.
    expect(acceptsSamplingParams("claude-something-9")).toBe(false);
    expect(anthropicRequestBody({ model: "claude-something-9", user: "hi", deterministic: true }))
      .not.toHaveProperty("temperature");
  });

  it("carries the system prompt only when there is one", () => {
    expect(anthropicRequestBody({ model: "claude-sonnet-5", user: "hi" })).not.toHaveProperty("system");
    expect(anthropicRequestBody({ model: "claude-sonnet-5", user: "hi", system: "s" }).system).toBe("s");
    expect(anthropicRequestBody({ model: "claude-sonnet-5", user: "hi" }).messages)
      .toEqual([{ role: "user", content: "hi" }]);
  });
});
