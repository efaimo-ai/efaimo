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
}

export type Runner = (req: RunnerRequest) => Promise<string>;

export interface ArmResult {
  trials: number;
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

  const trials = Math.min(50, Math.max(1, Math.round(num(doc.trials) ?? 5)));
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

async function judgeOne(runner: Runner, scenario: Scenario, answer: string): Promise<boolean> {
  const out = await runner({
    system: JUDGE_SYSTEM,
    user: `TASK:\n${scenario.task}\n\nRUBRIC:\n${scenario.judge}\n\nASSISTANT ANSWER:\n${answer}\n\nVerdict (PASS or FAIL):`,
    model: scenario.model,
  });
  return /\bpass\b/i.test(out) && !/\bfail\b/i.test(out);
}

async function runArm(runner: Runner, scenario: Scenario, system: string | undefined): Promise<ArmResult> {
  let passes = 0;
  for (let i = 0; i < scenario.trials; i++) {
    const answer = await runner({ system, user: scenario.task, model: scenario.model });
    if (await judgeOne(runner, scenario, answer)) passes++;
  }
  return { trials: scenario.trials, passes, passRate: (passes / scenario.trials) * 100 };
}

export async function runScenario(scenario: Scenario, runner: Runner): Promise<TestReport> {
  const systems = armSystems(scenario);
  const withoutSkill = await runArm(runner, scenario, systems.withoutSkill);
  const withSkill = await runArm(runner, scenario, systems.withSkill);
  const deltaPoints = Math.round((withSkill.passRate - withoutSkill.passRate) * 10) / 10;

  const notes: string[] = [
    `${scenario.trials} trials per arm; probabilistic. Treat small deltas as noise and raise trials for confidence.`,
  ];
  let verdict: TestReport["verdict"];
  if (scenario.trials < 5) {
    verdict = "inconclusive";
    notes.push("fewer than 5 trials: not enough signal to conclude.");
  } else if (deltaPoints >= 15) verdict = "helps";
  else if (deltaPoints <= -15) verdict = "hurts";
  else verdict = "no measurable effect";

  return {
    scenario: scenario.name,
    skill: scenario.skillName,
    model: scenario.model,
    withSkill,
    withoutSkill,
    deltaPoints,
    verdict,
    notes,
  };
}
