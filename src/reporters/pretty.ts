import pc from "picocolors";
import type { CheckReport, Finding, FindResult, ServerWeighResult, SkillSetWeighResult } from "../core/types.js";
import type { CheckSkillResult } from "../check/check.js";
import type { Scenario, TestReport } from "../testing/harness.js";
import type { WeighDiff } from "../weigh/diff.js";
import { formatWindowShare } from "../weigh/window.js";
import { sortFindings } from "../core/grade.js";
import { minimumDetectableDelta } from "../testing/stats.js";
import { VERSION } from "../version.js";
import { safeText } from "../util/safeText.js";

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

/**
 * A value that has to stay inside one line of a table or one line of a
 * finding.
 *
 * `safeText` strips control characters but deliberately keeps newlines,
 * because a detail block is meant to be multi-line. That is the wrong default
 * for a single cell: a tool named
 * `nl_tool\n      9  forged_row      weather, forecast` renders as a SECOND
 * row byte-identical in shape to a real one, and under `--no-color`, which is
 * how CI logs read, there is no tell at all. The audited thing must not be
 * able to write rows in the auditor's table.
 */
function cell(s: string): string {
  return safeText(s).replace(/[\r\n]+/g, " ");
}

function renderFinding(lines: string[], f: Finding): void {
  lines.push(`  ${sevGlyph(f)} ${paint(pc.bold, f.ruleId)}  ${cell(f.message)}`);
  if (f.detail) {
    for (const d of safeText(f.detail).split("\n")) lines.push(paint(pc.dim, `          ${d}`));
  }
  if (f.fixHint) lines.push(paint(pc.dim, `          fix: ${safeText(f.fixHint)}`));
}

export function renderCheckPretty(report: CheckReport): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`check ${report.surface}  ${paint(pc.bold, safeText(report.target))}`);
  const g = report.grade;
  const qualityLabel = report.readiness ? "quality: " : "";
  lines.push(
    `grade ${gradeColor(g.letter, `${g.letter} (${g.score})`)}   ${qualityLabel}` +
      `${paint(pc.red, String(report.counts.error))} error${report.counts.error === 1 ? "" : "s"}  ` +
      `${paint(pc.yellow, String(report.counts.warn))} warning${report.counts.warn === 1 ? "" : "s"}  ` +
      `${paint(pc.cyan, String(report.counts.info))} info`,
  );
  lines.push("");
  if (!report.findings.length) {
    lines.push(paint(pc.green, report.readiness ? "  no quality findings. clean." : "  no findings. clean."));
  }
  for (const f of report.findings) renderFinding(lines, f);
  if (report.readiness) {
    const r = report.readiness;
    lines.push("");
    if (r.findings.length) {
      lines.push(
        paint(pc.bold, `2026-07-28 readiness`) +
          `  ${r.findings.length} item${r.findings.length === 1 ? "" : "s"} to migrate ` +
          paint(pc.dim, "(a migration diff, not graded)"),
      );
      for (const f of r.findings) renderFinding(lines, f);
    } else {
      lines.push(paint(pc.bold, `2026-07-28 readiness`) + paint(pc.green, "  clean, nothing to migrate"));
    }
  }
  lines.push("");
  for (const note of report.notes) lines.push(paint(pc.dim, `note: ${safeText(note)}`));
  lines.push(paint(pc.dim, `rules: ${DOCS_RULES}`));
  return lines.join("\n");
}

export function renderScenarioPlan(s: Scenario): string {
  const calls = s.trials * 2 * 2;
  const firstLine = s.task.split("\n")[0]!.slice(0, 60);
  const mde = minimumDetectableDelta(s.trials);
  return [
    paint(pc.dim, `efaimo v${VERSION}`),
    `test (dry run)  ${paint(pc.bold, s.name)}`,
    "",
    `  skill   ${s.skillName}`,
    `  model   ${s.model}`,
    `  judge   ${s.judgeModel}${
      s.judgeModel === s.model
        ? paint(pc.yellow, "   (same model grades its own answers; set judge_model or --judge-model to separate them)")
        : ""
    }`,
    `  plan    ${s.trials} trials x 2 arms x (task + judge) = ${paint(pc.bold, String(calls))} API calls`,
    // What this plan cannot detect, before any tokens are spent. A run that
    // cannot reach significance produces a green that means nothing, and the
    // only useful moment to learn that is now.
    `  power   ${
      Number.isFinite(mde)
        ? `the smallest gap this size can call significant is ${paint(
            mde > 40 ? pc.yellow : pc.dim,
            `${mde.toFixed(0)} points`,
          )}${mde > 40 ? paint(pc.yellow, "   (raise trials)") : ""}`
        : paint(pc.red, "no outcome at this size can reach p < 0.05; raise trials")
    }`,
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
    `skill ${r.skill}   model ${r.model}   judge ${r.judgeModel}${r.judgeModel === r.model ? paint(pc.dim, " (same model)") : ""}`,
    "",
    `  with skill     ${r.withSkill.passes}/${r.withSkill.scored} pass  (${r.withSkill.passRate.toFixed(0)}%)`,
    `  without skill  ${r.withoutSkill.passes}/${r.withoutSkill.scored} pass  (${r.withoutSkill.passRate.toFixed(0)}%)`,
    `  delta          ${paint(pc.bold, `${sign}${r.deltaPoints} points`)}   ${paint(verdictColor, r.verdict)}`,
    Number.isFinite(r.ci.lo)
      ? `  significance   p = ${r.p < 0.0001 ? "<0.0001" : r.p.toFixed(4)}   95% CI ${r.ci.lo >= 0 ? "+" : ""}${r.ci.lo} to ${r.ci.hi >= 0 ? "+" : ""}${r.ci.hi} points`
      : `  significance   not computable: an arm produced no scoreable trial`,
    "",
  ];
  for (const n of r.notes) lines.push(paint(pc.dim, `note: ${safeText(n)}`));
  return lines.join("\n");
}

export function renderSkillSetPretty(res: CheckSkillResult): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`check skills  ${paint(pc.bold, safeText(res.label))}   ${res.perSkill.length} skill${res.perSkill.length === 1 ? "" : "s"}`);

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
      `  ${gradeColor(g.letter, `${g.letter} (${String(g.score).padStart(3)})`)}  ${cell(s.name).padEnd(nameW)}  ` +
        `${paint(pc.red, String(c.error))}e ${paint(pc.yellow, String(c.warn))}w ${paint(pc.cyan, String(c.info))}i`,
    );
  }

  if (res.setFindings.length) {
    lines.push("");
    lines.push(paint(pc.bold, "across the set"));
    for (const f of sortFindings(res.setFindings)) {
      lines.push(`  ${sevGlyph(f)} ${paint(pc.bold, f.ruleId)}  ${cell(f.message)}`);
    }
  }

  const flagged = res.perSkill.filter((s) => s.report.findings.length);
  if (flagged.length) {
    lines.push("");
    for (const s of flagged) {
      lines.push(paint(pc.bold, `${cell(s.name)}  ${gradeColor(s.report.grade.letter, s.report.grade.letter)}`));
      for (const f of s.report.findings) {
        lines.push(`  ${sevGlyph(f)} ${paint(pc.bold, f.ruleId)}  ${safeText(f.message)}`);
        if (f.fixHint) lines.push(paint(pc.dim, `          fix: ${safeText(f.fixHint)}`));
      }
    }
  }
  lines.push("");
  lines.push(paint(pc.dim, `${res.perSkill.length} skills under ${safeText(res.root)}`));
  lines.push(paint(pc.dim, `rules: ${DOCS_RULES}`));
  return lines.join("\n");
}

export function renderServerWeighPretty(w: ServerWeighResult): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`weigh mcp  ${paint(pc.bold, safeText(w.label))}`);
  lines.push(`tools ${w.toolCount}   resources ${w.resourceCount}   prompts ${w.promptCount}`);
  lines.push("");
  lines.push("context cost of tool definitions (o200k tokens, estimated)");
  lines.push(`  raw JSON        ${n(w.totals.rawJson).padStart(8)}`);
  lines.push(`  Claude-style    ${n(w.totals.claudeStyle).padStart(8)}   (${formatWindowShare(w.totals.claudeStyle)})`);
  lines.push(`  OpenAI tools    ${n(w.totals.openaiTools).padStart(8)}`);
  if (w.instructionsTokens > 0) lines.push(`  server instructions ${n(w.instructionsTokens).padStart(4)}`);
  if (w.anthropicExactTotal !== undefined) {
    lines.push(
      `  ${paint(pc.green, "anthropic exact")} ${n(w.anthropicExactTotal).padStart(8)}   (count_tokens, ${safeText(w.anthropicExactModel ?? "model not recorded")})`,
    );
  }
  if (w.perTool.length) {
    lines.push("");
    lines.push("heaviest tools (Claude-style)");
    // Derived from the rows actually printed, not a fixed 28. Against the
    // reference server - the target in --help, on /commands and in every
    // launch draft - "trigger-long-running-operation" is 30 characters, ate
    // the pad, and shifted the token column two places right for that one row.
    // A tool whose pitch is careful measurement was printing a crooked number
    // column in its own flagship demo. Capped so one pathological name cannot
    // push the numbers off a terminal.
    const shown = w.perTool.slice(0, 8);
    const toolW = Math.min(38, Math.max(20, ...shown.map((t) => cell(t.name).length)));
    for (const [i, t] of shown.entries()) {
      lines.push(
        `  ${String(i + 1).padStart(2)}. ${cell(t.name).padEnd(toolW)} ${n(t.tokens.claudeStyle).padStart(7)}   desc ${n(t.descriptionTokens)} | schema ${n(t.schemaTokens)}`,
      );
    }
    if (w.perTool.length > 8) lines.push(paint(pc.dim, `      (+${w.perTool.length - 8} more)`));
    if (w.framingTokens !== undefined && w.framingTokens > 0) {
      lines.push(
        paint(pc.dim, `      block framing ${" ".repeat(15)}${n(w.framingTokens).padStart(7)}   (<functions> wrapper; per-tool lines + this = total)`),
      );
    }
  }
  lines.push("");
  for (const note of w.notes) lines.push(paint(pc.dim, `note: ${safeText(note)}`));
  return lines.join("\n");
}

export function renderSkillWeighPretty(w: SkillSetWeighResult): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`weigh skills  ${paint(pc.bold, safeText(w.label))}   ${w.perSkill.length} skill${w.perSkill.length === 1 ? "" : "s"}`);
  lines.push("");
  lines.push(`  ${"skill".padEnd(28)} ${"metadata".padStart(8)} ${"body".padStart(9)} ${"lines".padStart(6)}  refs`);
  for (const s of w.perSkill) {
    lines.push(
      `  ${cell(s.name).padEnd(28)} ${n(s.metadataTokens).padStart(8)} ${n(s.bodyTokens).padStart(9)} ${String(s.bodyLines).padStart(6)}  ${s.refFileCount ? `${s.refFileCount} files ${n(s.refFileTokens)}` : "-"}`,
    );
  }
  lines.push("");
  lines.push(
    `totals: metadata ${paint(pc.bold, n(w.totals.metadata))} (always loaded) | body ${n(w.totals.body)} (on trigger) | referenced ${n(w.totals.refFiles)} (on demand)`,
  );
  lines.push("");
  for (const note of w.notes) lines.push(paint(pc.dim, `note: ${safeText(note)}`));
  return lines.join("\n");
}

/**
 * `efaimo find`.
 *
 * Two numbers, both as fractions with their denominators printed, neither a
 * letter. The first is a property of the catalog; the second is a simulation
 * and is labelled as one on the line itself, because a saturated 100% next to
 * a real measurement reads like a good score unless the page says otherwise.
 */
export function renderFindPretty(f: FindResult): string {
  const lines: string[] = [];
  lines.push(paint(pc.dim, `efaimo v${VERSION}`));
  lines.push(`find mcp  ${paint(pc.bold, safeText(f.label))}`);
  lines.push(
    paint(
      pc.dim,
      `tools ${f.toolCount}   result window ${f.method.topK}   BM25 k1=${f.method.bm25.k1} b=${f.method.bm25.b}, ${f.method.queryTerms} query terms`,
    ),
  );
  lines.push("");

  // Coloured on the rule condition, not on invented cutoffs. An earlier
  // version banded this at 95 and 80 percent, two numbers that appear in no
  // rule, no doc and no ADR, inside the one command whose whole design note
  // says it does not grade. Red means E141 fired; that is a threshold the
  // ruleset already owns.
  const dpct = f.distinct.pct;
  const anyOwnsNothing = f.distinct.count < f.distinct.total;
  const dcolor = f.distinctVacuous ? pc.dim : anyOwnsNothing ? pc.red : pc.green;
  const dFrac = `${f.distinct.count}/${f.distinct.total} (${dpct}%)`;
  const pFrac = `${f.probe.returned}/${f.probe.total} (${f.probe.pct}%)`;
  // Pad on the plain text, never on the painted string: colour codes are bytes
  // that padEnd counts and a terminal does not, which is how a coloured column
  // ends up crooked in exactly the demo everyone screenshots.
  const fracW = Math.max(dFrac.length, pFrac.length);
  lines.push(
    `distinct  ${paint(dcolor, dFrac)}${" ".repeat(fracW - dFrac.length)}` +
      `   ${paint(pc.dim, "tools that own a word no other tool has")}`,
  );
  if (f.distinctVacuous) {
    lines.push(
      paint(pc.yellow, `          vacuous: a one-tool catalog has nothing to be distinct from, so this is 100% for any tool`),
    );
  }
  lines.push(
    `probe     ${paint(pc.dim, pFrac)}${" ".repeat(fracW - pFrac.length)}` +
      `   ${paint(pc.dim, "returned by a simulated search for their own description")}`,
  );
  if (f.windowCoversCatalog) {
    lines.push(
      paint(pc.yellow, `          vacuous: ${f.toolCount} tools fit inside a window of ${f.method.topK}, so none can fall outside it`),
    );
  }
  lines.push("");

  // Worst first. A reader scanning the top of the table should be looking at
  // the tools that cannot be told apart, not at an alphabetical list.
  const byWorst = [...f.perTool].sort((a, b) => {
    const ar = a.rank ?? Number.POSITIVE_INFINITY;
    const br = b.rank ?? Number.POSITIVE_INFINITY;
    return (
      a.ownTermCount - b.ownTermCount ||
      br - ar ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    );
  });
  const shown = byWorst.slice(0, 15);
  const nameW = Math.min(34, Math.max(12, ...shown.map((t) => cell(t.name).length)));
  lines.push(paint(pc.dim, `  words  ${"tool".padEnd(nameW)}  vocabulary no other tool has`));
  for (const t of shown) {
    const count =
      t.ownTermCount === 0
        ? paint(pc.red, "    0")
        : t.ownTermCount === 1
          ? paint(pc.yellow, "    1")
          : paint(pc.green, String(t.ownTermCount).padStart(5));
    let tail: string;
    if (t.ownTermCount === 0) {
      tail = paint(
        pc.red,
        t.sharedWith.length ? `none: every word also on ${cell(t.sharedWith.join(", "))}` : "none",
      );
    } else {
      const more = t.ownTermCount - t.ownTerms.length;
      tail = paint(pc.dim, cell(t.ownTerms.join(", ")) + (more > 0 ? ` (+${more})` : ""));
    }
    // The probe only ever appears as a flag on a row it failed. A column of
    // "1" down the whole table would be a number that never varies presented
    // as if it were a measurement.
    const probe =
      t.rank === undefined
        ? paint(pc.red, "   [probe: no description]")
        : t.reachable
          ? ""
          : paint(pc.red, `   [probe: rank ${t.rank}]`);
    lines.push(`  ${count}  ${cell(t.name).padEnd(nameW)}  ${tail}${probe}`);
  }
  // Describe the hidden rows from the hidden rows, never from an assumption.
  // This line used to read "(+N more, each owning at least one word)" without
  // checking: on a catalog where all 18 tools owned nothing it printed that
  // three lines under a `0/18` headline saying the opposite.
  const hiddenRows = byWorst.slice(shown.length);
  if (hiddenRows.length) {
    const hiddenAtZero = hiddenRows.filter((t) => t.ownTermCount === 0).length;
    lines.push(
      paint(
        pc.dim,
        `         (+${hiddenRows.length} more` +
          (hiddenAtZero ? `, ${hiddenAtZero} of them owning no word` : ", each owning at least one word") +
          `; --json for all of them)`,
      ),
    );
  }

  return lines.join("\n");
}

/** The findings half of `efaimo find`, printed under the table. */
export function renderFindFindingsPretty(f: FindResult, findings: Finding[]): string {
  const lines: string[] = [""];
  if (!findings.length) {
    lines.push(paint(pc.green, "  no findability findings."));
  } else {
    for (const x of sortFindings(findings)) renderFinding(lines, x);
  }
  lines.push("");
  for (const note of f.notes) {
    // The two vacuity notes are already printed inline, in yellow, on the row
    // the reader is looking at. Repeating them here as prose was the same
    // warning twice in one screen; the data still carries them for --json and
    // --md, where there is no inline row to carry it.
    if (note.startsWith("VACUOUS")) continue;
    for (const [i, line] of wrapNote(safeText(note)).entries()) {
      lines.push(paint(pc.dim, i === 0 ? `note: ${line}` : `      ${line}`));
    }
  }
  // What to do next. A clean run used to end on "no findability findings" and
  // a rules URL, which tells a first-time reader nothing about how to keep it
  // that way. `distinct` is named because it is the number that can fail at
  // any catalog size; the probe cannot.
  if (!f.distinctVacuous) {
    lines.push(
      paint(
        pc.dim,
        `gate it: efaimo find "<server>" --min-distinct ${Math.floor(f.distinct.pct)}` +
          (f.distinct.pct < 100 ? "   (raise it as you fix the tools above)" : ""),
      ),
    );
  }
  lines.push(paint(pc.dim, `rules: ${DOCS_RULES}`));
  return lines.join("\n");
}

/** Soft-wrap a long note at ~92 columns on word boundaries, so terminals do not ragged-wrap mid-number. */
function wrapNote(s: string, width = 92): string[] {
  const out: string[] = [];
  for (const paragraph of s.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out;
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
