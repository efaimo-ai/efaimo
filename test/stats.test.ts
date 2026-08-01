import { describe, it, expect } from "vitest";
import { fisherExactTwoSided, wilson, deltaInterval } from "../src/testing/stats.js";
import { runScenario, type Scenario, type Runner } from "../src/testing/harness.js";

describe("fisher exact", () => {
  it("is 1.0 when the arms are identical", () => {
    expect(fisherExactTwoSided(4, 8, 4, 8)).toBeCloseTo(1, 6);
  });

  // The case that motivated all of this: the old verdict called +20 points
  // "helps" at the old default of 5 trials per arm, and the actual two-sided
  // p is exactly 1.0000. The least significant result obtainable, reported as
  // a finding, with `hurts` wired to exit code 1.
  it("is 1.0 for 5/5 against 4/5, which the old threshold called helps", () => {
    expect(fisherExactTwoSided(5, 5, 4, 5)).toBeCloseTo(1, 4);
  });

  it("does not reach significance for 8/8 against 6/8", () => {
    expect(fisherExactTwoSided(8, 8, 6, 8)).toBeGreaterThan(0.05);
  });

  it("is significant for a total separation at 8 per arm", () => {
    expect(fisherExactTwoSided(8, 8, 0, 8)).toBeLessThan(0.001);
  });

  it("is symmetric in the direction of the effect", () => {
    expect(fisherExactTwoSided(8, 8, 2, 8)).toBeCloseTo(fisherExactTwoSided(2, 8, 8, 8), 10);
  });

  it("never returns a probability outside [0,1]", () => {
    for (let a = 0; a <= 6; a++)
      for (let c = 0; c <= 6; c++) {
        const p = fisherExactTwoSided(a, 6, c, 6);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
  });
});

describe("wilson interval", () => {
  // The reason for Wilson rather than the normal approximation: both committed
  // example runs land on a boundary (8/8 and 0/8), where the normal interval
  // has zero width and would claim perfect certainty from eight trials.
  it("has non-zero width at 8/8", () => {
    const w = wilson(8, 8);
    expect(w.hi).toBe(1);
    expect(w.lo).toBeLessThan(1);
    expect(w.lo).toBeGreaterThan(0.5);
  });

  it("has non-zero width at 0/8", () => {
    const w = wilson(0, 8);
    expect(w.lo).toBe(0);
    expect(w.hi).toBeGreaterThan(0);
    expect(w.hi).toBeLessThan(0.5);
  });
});

describe("delta interval", () => {
  it("straddles zero when the arms are identical", () => {
    const ci = deltaInterval(4, 8, 4, 8);
    expect(ci.lo).toBeLessThan(0);
    expect(ci.hi).toBeGreaterThan(0);
  });

  it("excludes zero for a total separation", () => {
    const ci = deltaInterval(8, 8, 0, 8);
    expect(ci.lo).toBeGreaterThan(0);
  });
});

// A runner that returns a scripted sequence, so the A/B logic is exercised
// with no API calls at all.
function scriptedRunner(subject: string[], judge: string[]): Runner {
  let s = 0;
  let j = 0;
  return async (req) => (req.deterministic ? judge[j++ % judge.length]! : subject[s++ % subject.length]!);
}

const scenario = (trials: number): Scenario => ({
  name: "t",
  skillPath: "/x",
  skillName: "x",
  skillBody: "body",
  model: "claude-sonnet-5",
  trials,
  task: "do the thing",
  judge: "did it do the thing",
});

describe("verdict is gated on significance, not on the gap", () => {
  it("calls a large but insignificant gap no measurable effect", async () => {
    // without: FAIL, FAIL, PASS, PASS ... with: all PASS. A visible gap at a
    // sample size that cannot support it.
    const r = runScenario(scenario(4), scriptedRunner(["a"], ["FAIL", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"]));
    const rep = await r;
    expect(rep.p).toBeGreaterThan(0.05);
    expect(rep.verdict).toBe("no measurable effect");
  });

  it("reports p and a delta interval on every report", async () => {
    const rep = await runScenario(scenario(4), scriptedRunner(["a"], ["PASS"]));
    expect(typeof rep.p).toBe("number");
    expect(rep.ci).toHaveProperty("lo");
    expect(rep.ci).toHaveProperty("hi");
    expect(rep.notes.join(" ")).toMatch(/Fisher exact p/);
  });

  it("excludes an unparseable judge verdict instead of scoring it FAIL", async () => {
    // The judge answers with something that is neither word. Old behaviour:
    // counted as a failed trial in whichever arm produced it.
    const rep = await runScenario(scenario(2), scriptedRunner(["a"], ["I cannot grade this"]));
    expect(rep.withSkill.unparseable).toBe(2);
    expect(rep.withSkill.scored).toBe(0);
    expect(rep.verdict).toBe("inconclusive");
  });
});
