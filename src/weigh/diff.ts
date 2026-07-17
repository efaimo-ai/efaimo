import type { ServerWeighResult } from "../core/types.js";

export interface WeighDiff {
  before: number;
  after: number;
  delta: number;
  pct: number;
  toolChanges: { name: string; before?: number; after?: number }[];
}

/** Primary budget metric is the claudeStyle total (a realistic host template). */
export function diffServerWeigh(baseline: ServerWeighResult, current: ServerWeighResult): WeighDiff {
  const before = baseline.totals.claudeStyle;
  const after = current.totals.claudeStyle;
  const delta = after - before;
  const pct = before > 0 ? (delta / before) * 100 : after > 0 ? 100 : 0;

  const beforeMap = new Map(baseline.perTool.map((t) => [t.name, t.tokens.claudeStyle]));
  const afterMap = new Map(current.perTool.map((t) => [t.name, t.tokens.claudeStyle]));
  const names = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const toolChanges: WeighDiff["toolChanges"] = [];
  for (const name of names) {
    const b = beforeMap.get(name);
    const a = afterMap.get(name);
    if (b !== a) toolChanges.push({ name, before: b, after: a });
  }
  toolChanges.sort((x, y) => Math.abs((y.after ?? 0) - (y.before ?? 0)) - Math.abs((x.after ?? 0) - (x.before ?? 0)));
  return { before, after, delta, pct, toolChanges };
}
