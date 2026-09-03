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
import { isReadinessRuleId } from "../rules/mcp/index.js";
import { SKILL_RULES } from "../rules/skill/index.js";
import { introspectServer } from "../clients/introspect.js";
import { runProbes } from "../clients/rawprobe.js";
import { scanRepo } from "../targets/repoScan.js";
import { findSkills } from "../skills/parse.js";
import { weighServer, weighSkills } from "../weigh/weigh.js";
import type { ResolvedTarget } from "../targets/resolve.js";
import { VERSION } from "../version.js";

function buildReport(surface: Surface, target: string, findings: Finding[], notes: string[]): CheckReport {
  // MCP readiness findings (E101-E118) are a migration diff for the 2026-07-28
  // spec: a migration not yet made is a to-do list, not a defect in what
  // shipped. Reported separately and never graded (ADR-014, reaffirmed in
  // ADR-027). That decision is CLOSED: the spec published on 2026-07-28 and
  // readiness still does not count toward a grade. This comment described it
  // as open for a day after ADR-027, in the file that implements the split.
  const readinessAll: Finding[] = [];
  const gradedAll: Finding[] = [];
  for (const f of findings) {
    (surface === "mcp" && isReadinessRuleId(f.ruleId) ? readinessAll : gradedAll).push(f);
  }
  const graded = sortFindings(gradedAll);
  const readiness = sortFindings(readinessAll);
  return {
    tool: "efaimo",
    version: VERSION,
    surface,
    target,
    findings: graded,
    counts: countBySeverity(graded),
    grade: gradeFindings(graded),
    ...(surface === "mcp" ? { readiness: { findings: readiness, counts: countBySeverity(readiness) } } : {}),
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
  // An empty result is a failure, never a pass. With no source files read and no
  // dependency manifest naming an MCP SDK, there was nothing to examine here, and
  // a clean A(100) would be a grade for a directory we never looked inside. Fail
  // loudly, the way checkSkillSet does for a missing SKILL.md.
  if (repo.filesScanned === 0 && !repo.sdk) {
    throw new Error(
      `no MCP server source found under "${repoPath}": no code files and no SDK dependency. ` +
        `Point --mcp at the server's run command, or at a directory that contains its source.`,
    );
  }
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

  // S107 is emitted here rather than by a SkillRule because its subject is a
  // file that is NOT a skill: no rule that takes a parsed skill could ever see
  // it. Set level and warn level on purpose, so it moves no grade, matching
  // how S103 treats a collision that belongs to a pair rather than to either
  // member.
  for (const file of set.miscasedSkillFiles ?? []) {
    setFindings.push({
      ruleId: "S107",
      severity: "warn",
      title: "filename is one capitalisation away from a skill",
      message: `"${path.relative(set.root, file)}" is not loaded here, because the spec names SKILL.md exactly. A case-insensitive filesystem (the macOS and Windows default) may still hand it to a host, so this can work on a laptop and be missing entirely in Linux CI.`,
      target: path.relative(set.root, file),
      fixHint: "rename it to SKILL.md, or delete it if it is not a skill",
    });
  }

  return { label, root: set.root, perSkill, setFindings, weigh };
}
