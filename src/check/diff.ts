import type { Finding } from "../core/types.js";

/**
 * What moved between two runs of the same audit.
 *
 * Why this exists. Everything else here measures a subject once. Nobody
 * publishes whether MCP servers and Agent Skills are getting heavier, or
 * whether their quality holds, because that needs the same thing measured
 * twice and nothing made that comparison cheap enough to bother. Two pinned
 * runs is the smallest artifact that can answer it.
 *
 * The reason it is a flag on `check` rather than a shell pipeline is that a delta
 * is exactly the shape a broken measurement takes. Change the ruler between
 * the two runs and every subject appears to move; pair the wrong items and
 * everything looks new. Both mistakes produce a plausible number and neither
 * announces itself, so the controls a careful person would run by hand are
 * enforced here instead of documented:
 *
 * 1. RULES DRIFT IS A HARD STOP. If the two reports carry different
 *    `rulesVersion` values, a grade that moved cannot be attributed to the
 *    subject, because the ruler moved too. `--allow-rules-drift` proceeds and
 *    every grade line is then marked unattributable, which is the honest
 *    output rather than a silent one.
 * 2. AN EMPTY PAIRING IS A FAILURE. If nothing pairs, that is not "no
 *    change", it is two reports about different things, and reporting "0
 *    changed" would be the same vacuous pass an empty grep gives.
 * 3. THE THREE TOKEN COSTS ARE NEVER SUMMED. Metadata sits in context
 *    permanently, the body loads on trigger, referenced files load on demand.
 *    Adding them produces a single headline percentage that is arithmetically
 *    true and tells the reader the wrong thing, because almost all of the
 *    movement usually lives in the column that costs the least to carry.
 * 4. A DOMINANT MOVER IS NAMED. When one item is most of a total's movement,
 *    the total describes that item and not the population, so it is called
 *    out beside the total rather than left for the reader to discover.
 */

export interface CheckDiffItem {
  name: string;
  score: number;
  letter: string;
  errors: number;
  warns: number;
  infos: number;
  ruleIds: string[];
  metadata?: number;
  body?: number;
  referenced?: number;
}

export interface CheckEnvelope {
  tool?: string;
  version?: string;
  rulesVersion?: string;
  kind?: string;
  data?: unknown;
}

export interface GradeMove {
  name: string;
  before: { score: number; letter: string };
  after: { score: number; letter: string };
}

export interface CostMove {
  name: string;
  before: number;
  after: number;
  delta: number;
}

export interface CostColumn {
  column: "metadata" | "body" | "referenced";
  when: string;
  before: number;
  after: number;
  delta: number;
  pct: number;
  moved: CostMove[];
  /** Set when a single item is more than half of the absolute movement. */
  dominatedBy?: { name: string; delta: number; shareOfMovement: number };
}

export interface CheckDiffResult {
  kind: string;
  versions: { before: string; after: string };
  rulesVersions: { before?: string; after?: string };
  rulesDrift: boolean;
  paired: number;
  added: string[];
  removed: string[];
  improved: GradeMove[];
  worsened: GradeMove[];
  held: number;
  findingCounts: { before: number; after: number };
  costs: CostColumn[];
  notes: string[];
}

export class CheckDiffRefused extends Error {}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Both shapes `check` emits, flattened to one list.
 *
 * A single target puts the report at `data` itself; a set puts one report per
 * entry in `data.perSkill` and the token counts in a parallel `data.weigh`
 * list. Pairing the two lists by name rather than by position matters: they
 * are built by different passes and nothing guarantees the orders agree, and
 * a positional join would silently attribute one skill's tokens to another.
 */
export function flattenCheck(envelope: CheckEnvelope): CheckDiffItem[] {
  const data = asRecord(envelope.data);
  if (!data) return [];

  const weighByName = new Map<string, Record<string, unknown>>();
  const weigh = asRecord(data.weigh);
  if (Array.isArray(weigh?.perSkill)) {
    for (const w of weigh.perSkill as unknown[]) {
      const r = asRecord(w);
      if (r && typeof r.name === "string") weighByName.set(r.name, r);
    }
  }

  const fromReport = (name: string, report: Record<string, unknown>): CheckDiffItem => {
    const grade = asRecord(report.grade) ?? {};
    const counts = asRecord(report.counts) ?? {};
    const findings = Array.isArray(report.findings) ? (report.findings as Finding[]) : [];
    const w = weighByName.get(name);
    return {
      name,
      score: num(grade.score),
      letter: typeof grade.letter === "string" ? grade.letter : "?",
      errors: num(counts.error),
      warns: num(counts.warn),
      infos: num(counts.info),
      ruleIds: findings.map((f) => f.ruleId).filter((r): r is string => typeof r === "string"),
      ...(w
        ? {
            metadata: num(w.metadataTokens),
            body: num(w.bodyTokens),
            referenced: num(w.refFileTokens),
          }
        : {}),
    };
  };

  if (Array.isArray(data.perSkill)) {
    const out: CheckDiffItem[] = [];
    for (const entry of data.perSkill as unknown[]) {
      const e = asRecord(entry);
      const report = asRecord(e?.report);
      const name = typeof e?.name === "string" ? e.name : undefined;
      if (name && report) out.push(fromReport(name, report));
    }
    return out;
  }

  const target = typeof data.target === "string" ? data.target : undefined;
  if (target && asRecord(data.grade)) return [fromReport(target, data)];
  return [];
}

export interface CheckDiffOptions {
  allowRulesDrift?: boolean;
}

export function diffCheck(before: CheckEnvelope, after: CheckEnvelope, opts: CheckDiffOptions = {}): CheckDiffResult {
  for (const [label, env] of [
    ["before", before],
    ["after", after],
  ] as const) {
    if (env.tool !== "efaimo") {
      throw new CheckDiffRefused(
        `the ${label} file is not an efaimo report (its "tool" field is ${JSON.stringify(env.tool)}); diff compares two runs of this tool, so pass JSON produced by --json`,
      );
    }
  }
  if (before.kind !== after.kind) {
    throw new CheckDiffRefused(
      `these are different kinds of report (${before.kind} and ${after.kind}); comparing them would pair things that are not the same measurement`,
    );
  }
  if (before.kind !== "check") {
    throw new CheckDiffRefused(
      `diff currently compares "check" reports only, and these are "${before.kind}"; run \`efaimo check ... --json\` at both points`,
    );
  }

  const rulesDrift = Boolean(before.rulesVersion && after.rulesVersion && before.rulesVersion !== after.rulesVersion);
  if (rulesDrift && !opts.allowRulesDrift) {
    throw new CheckDiffRefused(
      `the two runs used different rulesets (${before.rulesVersion} and ${after.rulesVersion}). A grade that moved cannot be attributed to the subject, because the ruler moved too. Re-run both points with one version of efaimo, or pass --allow-rules-drift to compare anyway and have every grade line marked unattributable.`,
    );
  }

  const b = new Map(flattenCheck(before).map((i) => [i.name, i]));
  const a = new Map(flattenCheck(after).map((i) => [i.name, i]));
  const paired = [...b.keys()].filter((k) => a.has(k)).sort();

  if (!paired.length) {
    // An empty intersection and "nothing changed" are the same output, and
    // only one of them is worth printing.
    throw new CheckDiffRefused(
      `nothing pairs between the two reports (${b.size} items before, ${a.size} after, 0 in common). That is not "no change", it is two reports about different subjects.`,
    );
  }

  const improved: GradeMove[] = [];
  const worsened: GradeMove[] = [];
  let held = 0;
  for (const name of paired) {
    const x = b.get(name)!;
    const y = a.get(name)!;
    const move = { name, before: { score: x.score, letter: x.letter }, after: { score: y.score, letter: y.letter } };
    if (y.score > x.score) improved.push(move);
    else if (y.score < x.score) worsened.push(move);
    else held++;
  }

  const COLUMNS = [
    ["metadata", "always in context", (i: CheckDiffItem) => i.metadata],
    ["body", "loads on trigger", (i: CheckDiffItem) => i.body],
    ["referenced", "loads on demand", (i: CheckDiffItem) => i.referenced],
  ] as const;

  const costs: CostColumn[] = [];
  for (const [column, when, pick] of COLUMNS) {
    if (paired.some((n) => pick(b.get(n)!) === undefined || pick(a.get(n)!) === undefined)) continue;
    const beforeTotal = paired.reduce((s, n) => s + (pick(b.get(n)!) ?? 0), 0);
    const afterTotal = paired.reduce((s, n) => s + (pick(a.get(n)!) ?? 0), 0);
    const moved: CostMove[] = paired
      .map((n) => ({ name: n, before: pick(b.get(n)!) ?? 0, after: pick(a.get(n)!) ?? 0 }))
      .filter((m) => m.before !== m.after)
      .map((m) => ({ ...m, delta: m.after - m.before }))
      .sort((x, y) => y.delta - x.delta);

    const totalAbs = moved.reduce((s, m) => s + Math.abs(m.delta), 0);
    const biggest = [...moved].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0];
    const share = biggest && totalAbs ? Math.abs(biggest.delta) / totalAbs : 0;

    costs.push({
      column,
      when,
      before: beforeTotal,
      after: afterTotal,
      delta: afterTotal - beforeTotal,
      pct: beforeTotal ? ((afterTotal - beforeTotal) / beforeTotal) * 100 : 0,
      moved,
      ...(share > 0.5 && biggest
        ? { dominatedBy: { name: biggest.name, delta: biggest.delta, shareOfMovement: share * 100 } }
        : {}),
    });
  }

  const notes: string[] = [
    "the three token columns are reported separately on purpose: metadata is carried permanently, the body loads on trigger, and referenced files load on demand, so a single summed percentage would describe none of them",
  ];
  if (rulesDrift) {
    notes.push(
      `RULES DRIFT ACCEPTED (${before.rulesVersion} -> ${after.rulesVersion}): grade movement below cannot be attributed to the subjects, because the ruleset changed between the two runs`,
    );
  }
  if (before.version !== after.version) {
    notes.push(
      `the two runs used efaimo ${before.version} and ${after.version}; the rulesets matched, so grades are comparable, but token counts can move if the tokenizer or the walk changed`,
    );
  }

  return {
    kind: before.kind,
    versions: { before: before.version ?? "?", after: after.version ?? "?" },
    rulesVersions: { before: before.rulesVersion, after: after.rulesVersion },
    rulesDrift,
    paired: paired.length,
    added: [...a.keys()].filter((k) => !b.has(k)).sort(),
    removed: [...b.keys()].filter((k) => !a.has(k)).sort(),
    improved,
    worsened,
    held,
    findingCounts: {
      before: [...b.values()].reduce((s, i) => s + i.errors + i.warns + i.infos, 0),
      after: [...a.values()].reduce((s, i) => s + i.errors + i.warns + i.infos, 0),
    },
    costs,
    notes,
  };
}
