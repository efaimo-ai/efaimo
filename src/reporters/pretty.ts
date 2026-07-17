import pc from "picocolors";
import type { CheckReport, Finding, ServerWeighResult, SkillSetWeighResult } from "../core/types.js";
import type { CheckSkillResult } from "../check/check.js";
import type { Scenario, TestReport } from "../testing/harness.js";
import type { WeighDiff } from "../weigh/diff.js";
import { sortFindings } from "../core/grade.js";
import { VERSION } from "../version.js";

const DOCS_RULES = "https://github.com/efaimo-ai/efaimo/blob/main/docs/RULES.md";

let colorOn = true;
export function setColor(on: boolean): void {
  colorOn = on;
}
function paint(fn: (s: string) => string, s: string): string {
  return colorOn ? fn(s) : s;
}

function sevGlyph(f: Finding): string {
  if (f.severity === "error") return paint(pc.red, "x");
  if (f.severity === "warn") return paint(pc.yellow, "!");
  return paint(pc.cyan, "i");
}

function gradeColor(letter: string, text: string): string {
  if (letter === "A") return paint(pc.green, text);
  if (letter === "B") return paint(pc.green, text);
  if (letter === "C") return paint(pc.yellow, text);
  if (letter === "D") return paint(pc.yellow, text);
  return paint(pc.red, text);
}

function n(x: number): string {
  return x.toLocaleString("en-US");
}

export function renderCheckPretty(report: CheckReport): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`check ${report.surface}  ${paint(pc.bold, report.target)}`);
  const g = report.grade;
  lines.push(
    `grade ${gradeColor(g.letter, `${g.letter} (${g.score})`)}   ` +
      `${paint(pc.red, String(report.counts.error))} error${report.counts.error === 1 ? "" : "s"}  ` +
      `${paint(pc.yellow, String(report.counts.warn))} warning${report.counts.warn === 1 ? "" : "s"}  ` +
      `${paint(pc.cyan, String(report.counts.info))} info`,
  );
  lines.push("");
  if (!report.findings.length) {
    lines.push(paint(pc.green, "  no findings. clean."));
  }
  for (const f of report.findings) {
    lines.push(`  ${sevGlyph(f)} ${paint(pc.bold, f.ruleId)}  ${f.message}`);
    if (f.detail) {
      for (const d of f.detail.split("\n")) lines.push(paint(pc.dim, `          ${d}`));
    }
    if (f.fixHint) lines.push(paint(pc.dim, `          fix: ${f.fixHint}`));
  }
  lines.push("");
  for (const note of report.notes) lines.push(paint(pc.dim, `note: ${note}`));
  lines.push(paint(pc.dim, `rules: ${DOCS_RULES}`));
  return lines.join("\n");
}

export function renderScenarioPlan(s: Scenario): string {
  const calls = s.trials * 2 * 2;
  const firstLine = s.task.split("\n")[0]!.slice(0, 60);
  return [
    paint(pc.dim, `efaimo v${VERSION}`),
    `test (dry run)  ${paint(pc.bold, s.name)}`,
    "",
    `  skill   ${s.skillName}`,
    `  model   ${s.model}`,
    `  plan    ${s.trials} trials x 2 arms x (task + judge) = ${paint(pc.bold, String(calls))} API calls`,
    `  task    ${paint(pc.dim, firstLine + (s.task.length > 60 ? "..." : ""))}`,
    "",
    paint(pc.yellow, "dry run: no API calls made. add --live to run it (Claude models need ANTHROPIC_API_KEY, GPT models need OPENAI_API_KEY)."),
  ].join("\n");
}

export function renderTestReportPretty(r: TestReport): string {
  const verdictColor =
    r.verdict === "helps" ? pc.green : r.verdict === "hurts" ? pc.red : pc.yellow;
  const sign = r.deltaPoints >= 0 ? "+" : "";
  const lines = [
    paint(pc.dim, `efaimo v${VERSION}`),
    `test  ${paint(pc.bold, r.scenario)}`,
    `skill ${r.skill}   model ${r.model}`,
    "",
    `  with skill     ${r.withSkill.passes}/${r.withSkill.trials} pass  (${r.withSkill.passRate.toFixed(0)}%)`,
    `  without skill  ${r.withoutSkill.passes}/${r.withoutSkill.trials} pass  (${r.withoutSkill.passRate.toFixed(0)}%)`,
    `  delta          ${paint(pc.bold, `${sign}${r.deltaPoints} points`)}   ${paint(verdictColor, r.verdict)}`,
    "",
  ];
  for (const n of r.notes) lines.push(paint(pc.dim, `note: ${n}`));
  return lines.join("\n");
}

export function renderSkillSetPretty(res: CheckSkillResult): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`check skills  ${paint(pc.bold, res.label)}   ${res.perSkill.length} skill${res.perSkill.length === 1 ? "" : "s"}`);

  const dist: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const s of res.perSkill) dist[s.report.grade.letter]!++;
  lines.push("");
  lines.push(
    "grades  " +
      (["A", "B", "C", "D", "F"] as const)
        .map((g) => (dist[g] ? `${gradeColor(g, g)}x${dist[g]}` : ""))
        .filter(Boolean)
        .join("   "),
  );
  lines.push("");

  const nameW = Math.min(34, Math.max(8, ...res.perSkill.map((s) => s.name.length)));
  for (const s of [...res.perSkill].sort((a, b) => a.report.grade.score - b.report.grade.score)) {
    const g = s.report.grade;
    const c = s.report.counts;
    lines.push(
      `  ${gradeColor(g.letter, `${g.letter} (${String(g.score).padStart(3)})`)}  ${s.name.padEnd(nameW)}  ` +
        `${paint(pc.red, String(c.error))}e ${paint(pc.yellow, String(c.warn))}w ${paint(pc.cyan, String(c.info))}i`,
    );
  }

  if (res.setFindings.length) {
    lines.push("");
    lines.push(paint(pc.bold, "across the set"));
    for (const f of sortFindings(res.setFindings)) {
      lines.push(`  ${sevGlyph(f)} ${paint(pc.bold, f.ruleId)}  ${f.message}`);
    }
  }

  const flagged = res.perSkill.filter((s) => s.report.findings.length);
  if (flagged.length) {
    lines.push("");
    for (const s of flagged) {
      lines.push(paint(pc.bold, `${s.name}  ${gradeColor(s.report.grade.letter, s.report.grade.letter)}`));
      for (const f of s.report.findings) {
        lines.push(`  ${sevGlyph(f)} ${paint(pc.bold, f.ruleId)}  ${f.message}`);
        if (f.fixHint) lines.push(paint(pc.dim, `          fix: ${f.fixHint}`));
      }
    }
  }
  lines.push("");
  lines.push(paint(pc.dim, `${res.perSkill.length} skills under ${res.root}`));
  lines.push(paint(pc.dim, `rules: ${DOCS_RULES}`));
  return lines.join("\n");
}

export function renderServerWeighPretty(w: ServerWeighResult): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`weigh mcp  ${paint(pc.bold, w.label)}`);
  lines.push(`tools ${w.toolCount}   resources ${w.resourceCount}   prompts ${w.promptCount}`);
  lines.push("");
  lines.push("context cost of tool definitions (o200k tokens, estimated)");
  const pct = ((w.totals.claudeStyle / 200000) * 100).toFixed(1);
  lines.push(`  raw JSON        ${n(w.totals.rawJson).padStart(8)}`);
  lines.push(`  Claude-style    ${n(w.totals.claudeStyle).padStart(8)}   (~${pct}% of a 200k window)`);
  lines.push(`  OpenAI tools    ${n(w.totals.openaiTools).padStart(8)}`);
  if (w.instructionsTokens > 0) lines.push(`  server instructions ${n(w.instructionsTokens).padStart(4)}`);
  if (w.anthropicExactTotal !== undefined) {
    lines.push(`  ${paint(pc.green, "anthropic exact")} ${n(w.anthropicExactTotal).padStart(8)}   (count_tokens API)`);
  }
  if (w.perTool.length) {
    lines.push("");
    lines.push("heaviest tools (Claude-style)");
    for (const [i, t] of w.perTool.slice(0, 8).entries()) {
      lines.push(
        `  ${String(i + 1).padStart(2)}. ${t.name.padEnd(28)} ${n(t.tokens.claudeStyle).padStart(7)}   desc ${n(t.descriptionTokens)} | schema ${n(t.schemaTokens)}`,
      );
    }
    if (w.perTool.length > 8) lines.push(paint(pc.dim, `      (+${w.perTool.length - 8} more)`));
  }
  lines.push("");
  for (const note of w.notes) lines.push(paint(pc.dim, `note: ${note}`));
  return lines.join("\n");
}

export function renderSkillWeighPretty(w: SkillSetWeighResult): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`weigh skills  ${paint(pc.bold, w.label)}   ${w.perSkill.length} skill${w.perSkill.length === 1 ? "" : "s"}`);
  lines.push("");
  lines.push(`  ${"skill".padEnd(28)} ${"metadata".padStart(8)} ${"body".padStart(9)} ${"lines".padStart(6)}  refs`);
  for (const s of w.perSkill) {
    lines.push(
      `  ${s.name.padEnd(28)} ${n(s.metadataTokens).padStart(8)} ${n(s.bodyTokens).padStart(9)} ${String(s.bodyLines).padStart(6)}  ${s.refFileCount ? `${s.refFileCount} files ${n(s.refFileTokens)}` : "-"}`,
    );
  }
  lines.push("");
  lines.push(
    `totals: metadata ${paint(pc.bold, n(w.totals.metadata))} (always loaded) | body ${n(w.totals.body)} (on trigger) | referenced ${n(w.totals.refFiles)} (on demand)`,
  );
  lines.push("");
  for (const note of w.notes) lines.push(paint(pc.dim, `note: ${note}`));
  return lines.join("\n");
}

export function renderDiffPretty(d: WeighDiff, opts: { maxTokens?: number; allowIncreasePct?: number }): string {
  const lines: string[] = [];
  const sign = d.delta >= 0 ? "+" : "";
  const deltaText = `${sign}${n(d.delta)} tokens (${sign}${d.pct.toFixed(1)}%)`;
  lines.push(
    `context budget diff (Claude-style): ${n(d.before)} -> ${n(d.after)}  ${d.delta > 0 ? paint(pc.yellow, deltaText) : paint(pc.green, deltaText)}`,
  );
  for (const t of d.toolChanges.slice(0, 10)) {
    const b = t.before === undefined ? "added" : n(t.before);
    const a = t.after === undefined ? "removed" : n(t.after);
    lines.push(`  ${t.name.padEnd(28)} ${b} -> ${a}`);
  }
  if (opts.maxTokens !== undefined && d.after > opts.maxTokens) {
    lines.push(paint(pc.red, `budget exceeded: ${n(d.after)} > --max-tokens ${n(opts.maxTokens)}`));
  }
  if (opts.allowIncreasePct !== undefined && d.pct > opts.allowIncreasePct) {
    lines.push(paint(pc.red, `increase ${d.pct.toFixed(1)}% > --allow-increase ${opts.allowIncreasePct}%`));
  }
  return lines.join("\n");
}
