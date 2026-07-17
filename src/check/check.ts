import type {
  CheckReport,
  Finding,
  ProbeResults,
  ServerIntrospection,
  ServerWeighResult,
  SkillSetWeighResult,
  Surface,
} from "../core/types.js";
import path from "node:path";
import { countBySeverity, gradeFindings, sortFindings } from "../core/grade.js";
import { runMcpRules, runRules } from "../core/engine.js";
import { SKILL_RULES } from "../rules/skill/index.js";
import { introspectServer } from "../clients/introspect.js";
import { runProbes } from "../clients/rawprobe.js";
import { scanRepo } from "../targets/repoScan.js";
import { findSkills } from "../skills/parse.js";
import { weighServer, weighSkills } from "../weigh/weigh.js";
import type { ResolvedTarget } from "../targets/resolve.js";
import { VERSION } from "../version.js";

function buildReport(surface: Surface, target: string, findings: Finding[], notes: string[]): CheckReport {
  const sorted = sortFindings(findings);
  return {
    tool: "efaimo",
    version: VERSION,
    surface,
    target,
    findings: sorted,
    counts: countBySeverity(sorted),
    grade: gradeFindings(sorted),
    notes,
  };
}

export interface CheckMcpResult {
  report: CheckReport;
  intro: ServerIntrospection;
  weigh: ServerWeighResult;
  probes?: ProbeResults;
}

export async function checkMcpTarget(
  target: Extract<ResolvedTarget, { kind: "stdio" | "http" }>,
  opts: { timeoutMs?: number; probe?: boolean; repoPath?: string; anthropicApiKey?: string } = {},
): Promise<CheckMcpResult> {
  const intro = await introspectServer(target, { timeoutMs: opts.timeoutMs });
  const weigh = await weighServer(intro, { anthropicApiKey: opts.anthropicApiKey });
  const probes = opts.probe === false ? undefined : await runProbes(target, { timeoutMs: opts.timeoutMs });
  const repo = opts.repoPath ? scanRepo(opts.repoPath) : undefined;
  const findings = runMcpRules({ intro, probes, repo, weigh });
  const notes = [...intro.notes];
  if (opts.probe === false) notes.push("readiness probes skipped (--no-probe)");
  if (repo) notes.push(`repo scan: ${repo.filesScanned} files in ${repo.root}`);
  return { report: buildReport("mcp", target.label, findings, notes), intro, weigh, probes };
}

export function checkMcpRepoOnly(repoPath: string, label: string): CheckReport {
  const repo = scanRepo(repoPath);
  const emptyIntro: ServerIntrospection = {
    targetLabel: label,
    transport: "stdio",
    tools: [],
    resources: [],
    prompts: [],
    notes: [],
  };
  const findings = runMcpRules({ intro: emptyIntro, repo });
  return buildReport("mcp", label, findings, [
    `static repo scan only (${repo.filesScanned} files); run against the live server for transport, probe, and quality checks`,
  ]);
}

export interface SkillReport {
  name: string;
  dir: string;
  report: CheckReport;
}

export interface CheckSkillResult {
  label: string;
  root: string;
  perSkill: SkillReport[];
  /** Set-level findings (e.g. trigger collisions across skills). */
  setFindings: Finding[];
  weigh: SkillSetWeighResult;
}

export async function checkSkillSet(pathInput: string, label: string): Promise<CheckSkillResult> {
  const set = findSkills(pathInput);
  if (!set.skills.length) {
    throw new Error(`no SKILL.md found under "${pathInput}"`);
  }
  const weigh = await weighSkills(set);
  const perSkillRules = SKILL_RULES.filter((r) => r.id !== "S103");
  const setRules = SKILL_RULES.filter((r) => r.id === "S103");

  const perSkill: SkillReport[] = set.skills.map((skill) => {
    const name = skill.name ?? path.basename(skill.dir);
    const findings = runRules(perSkillRules, { skill, set, weigh });
    return { name, dir: skill.dir, report: buildReport("skill", name, findings, []) };
  });

  const setFindings = set.skills.flatMap((skill) => runRules(setRules, { skill, set, weigh }));

  return { label, root: set.root, perSkill, setFindings, weigh };
}
