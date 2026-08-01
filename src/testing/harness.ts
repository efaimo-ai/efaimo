import { fisherExactTwoSided, deltaInterval } from "./stats.js";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { findSkills } from "../skills/parse.js";

/**
 * efaimo test: does a skill actually improve task completion? A scenario runs a
 * task with and without the skill loaded, N trials each, and an LLM judge scores
 * each attempt. The runner is injected so the A/B logic is testable without any
 * API calls; the live runner (anthropicRunner) is used only with `--live`.
 */

export interface Scenario {
  name: string;
  skillPath: string;
  skillName: string;
  skillBody: string;
  model: string;
  trials: number;
  task: string;
  judge: string;
}

export interface RunnerRequest {
  system?: string;
  user: string;
  model: string;
  /**
   * Sample deterministically. Set for the JUDGE, never for the subject.
   * Neither runner set a temperature, so both defaulted to 1.0 and a "strict
   * grader" asked for one word was being sampled: the same answer could be
   * graded PASS on one trial and FAIL on the next, and that variance lands in
   * the measurement as if it came from the skill. The subject arm keeps
   * temperature 1 on purpose, because the thing being measured is how the
   * model behaves normally.
   */
  deterministic?: boolean;
}

export type Runner = (req: RunnerRequest) => Promise<string>;

export interface ArmResult {
  trials: number;
  /** Trials the judge actually answered PASS or FAIL on. */
  scored: number;
  /** Trials whose judge verdict was neither; excluded from passRate. */
  unparseable: number;
  passes: number;
  passRate: number;
}

export interface TestReport {
  scenario: string;
  skill: string;
  model: string;
  withSkill: ArmResult;
  withoutSkill: ArmResult;
  /** withSkill.passRate - withoutSkill.passRate, in percentage points. */
  deltaPoints: number;
  /** Two-sided Fisher exact p on the 2x2 of scored trials. */
  p: number;
  /** 95% interval on the delta, in percentage points (Newcombe). */
  ci: { lo: number; hi: number };
  verdict: "helps" | "hurts" | "no measurable effect" | "inconclusive";
  notes: string[];
}

const JUDGE_SYSTEM =
  "You are a strict grader. Read the task, the rubric, and the assistant's answer. " +
  "Reply with exactly one word: PASS or FAIL. No explanation.";

export function parseScenario(file: string): Scenario {
  const raw = fs.readFileSync(file, "utf8");
  const doc = YAML.parse(raw) as Record<string, unknown>;
  if (!doc || typeof doc !== "object") throw new Error(`${file}: not a YAML mapping`);

  const name = str(doc.name) ?? path.basename(file);
  const skillRel = str(doc.skill);
  if (!skillRel) throw new Error(`${file}: 'skill' (path to a skill dir or SKILL.md) is required`);
  const task = str(doc.task);
  if (!task) throw new Error(`${file}: 'task' (the prompt to run) is required`);
  const judge = str(doc.judge);
  if (!judge) throw new Error(`${file}: 'judge' (a PASS/FAIL rubric) is required`);

  const skillPath = path.resolve(path.dirname(file), skillRel);
  const set = findSkills(skillPath);
  const skill = set.skills[0];
  if (!skill) throw new Error(`${file}: no SKILL.md found at '${skillRel}'`);

  // Default 20, not 5. At 5 per arm a total separation (5/5 vs 0/5) is the ONLY
  // outcome that reaches p < 0.05, so every partial result is uninterpretable
  // and the old default guaranteed a verdict nobody could stand behind.
  const trials = Math.min(50, Math.max(1, Math.round(num(doc.trials) ?? 20)));
  return {
    name,
    skillPath,
    skillName: skill.name ?? path.basename(skill.dir),
    skillBody: skill.body.trim(),
    model: str(doc.model) ?? "claude-sonnet-5",
    trials,
    task,
    judge,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** The two system prompts an A/B trial compares: base, and base + the skill. */
export function armSystems(scenario: Scenario): { withoutSkill: string | undefined; withSkill: string } {
  const withSkill = `You have access to the following skill. Use it if relevant.\n\n<skill name="${scenario.skillName}">\n${scenario.skillBody}\n</skill>`;
  return { withoutSkill: undefined, withSkill };
}

// PASS, FAIL, or neither. "Neither" used to be counted as FAIL: the old test
// was `/pass/i.test(out) && !/fail/i.test(out)`, so a refusal, an API
// error string, or a hedge like "passes on X but fails on Y" all became a
// failed trial. Those are not evidence about the skill, and quietly scoring
// them against whichever arm produced them biases the result.
async function judgeOne(runner: Runner, scenario: Scenario, answer: string): Promise<"pass" | "fail" | "unparseable"> {
  const out = await runner({
    system: JUDGE_SYSTEM,
    user: `TASK:\n${scenario.task}\n\nRUBRIC:\n${scenario.judge}\n\nASSISTANT ANSWER:\n${answer}\n\nVerdict (PASS or FAIL):`,
    model: scenario.model,
    deterministic: true,
  });
  const saysPass = /\bpass(ed|es)?\b/i.test(out);
  const saysFail = /\bfail(ed|s|ure)?\b/i.test(out);
  if (saysPass && !saysFail) return "pass";
  if (saysFail && !saysPass) return "fail";
  return "unparseable";
}

async function runArm(runner: Runner, scenario: Scenario, system: string | undefined): Promise<ArmResult> {
  let passes = 0;
  let unparseable = 0;
  for (let i = 0; i < scenario.trials; i++) {
    const answer = await runner({ system, user: scenario.task, model: scenario.model });
    const v = await judgeOne(runner, scenario, answer);
    if (v === "pass") passes++;
    else if (v === "unparseable") unparseable++;
  }
  // Scored trials exclude the ones the judge did not answer, so the rate is a
  // rate over evidence rather than over attempts.
  const scored = scenario.trials - unparseable;
  return {
    trials: scenario.trials,
    scored,
    unparseable,
    passes,
    passRate: scored > 0 ? (passes / scored) * 100 : 0,
  };
}

export async function runScenario(scenario: Scenario, runner: Runner): Promise<TestReport> {
  const systems = armSystems(scenario);
  const withoutSkill = await runArm(runner, scenario, systems.withoutSkill);
  const withSkill = await runArm(runner, scenario, systems.withSkill);
  const deltaPoints = Math.round((withSkill.passRate - withoutSkill.passRate) * 10) / 10;

  // The verdict is a significance test, not a threshold on the gap.
  //
  // It used to be `>= +15 points helps, <= -15 hurts`, with 5 trials per arm
  // as the default. At that size 5/5 against 4/5 is +20 points and a two-sided
  // Fisher p of 1.0000: the least significant result obtainable, reported as a
  // finding, and `hurts` set exit code 1. The +-15 band sits inside the noise
  // floor at every trial count below roughly 25 per arm, so the threshold was
  // measuring sample size more than it was measuring the skill.
  const p = fisherExactTwoSided(
    withSkill.passes, withSkill.scored,
    withoutSkill.passes, withoutSkill.scored,
  );
  const ci = deltaInterval(
    withSkill.passes, withSkill.scored,
    withoutSkill.passes, withoutSkill.scored,
  );

  const notes: string[] = [
    `${scenario.trials} trials per arm. Two-sided Fisher exact p = ${p < 0.0001 ? "<0.0001" : p.toFixed(4)}; ` +
      `95% interval on the delta ${ci.lo >= 0 ? "+" : ""}${ci.lo} to ${ci.hi >= 0 ? "+" : ""}${ci.hi} points.`,
  ];
  const unscored = withSkill.unparseable + withoutSkill.unparseable;
  if (unscored) {
    notes.push(
      `${unscored} trial(s) produced a judge verdict that was neither PASS nor FAIL and are excluded from the rates, not counted as failures.`,
    );
  }

  let verdict: TestReport["verdict"];
  if (withSkill.scored === 0 || withoutSkill.scored === 0) {
    verdict = "inconclusive";
    notes.push("an arm produced no scoreable trial; there is nothing to compare.");
  } else if (p >= 0.05) {
    verdict = "no measurable effect";
    if (Math.abs(deltaPoints) >= 15) {
      notes.push(
        `the ${deltaPoints >= 0 ? "+" : ""}${deltaPoints} point gap is not significant at this sample size (p = ${p.toFixed(4)}). ` +
          `Raise trials rather than reading the gap.`,
      );
    }
  } else if (deltaPoints > 0) verdict = "helps";
  else verdict = "hurts";

  return {
    scenario: scenario.name,
    skill: scenario.skillName,
    model: scenario.model,
    withSkill,
    withoutSkill,
    deltaPoints,
    p,
    ci,
    verdict,
    notes,
  };
}
