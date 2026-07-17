import type { Finding, GradeInfo } from "./types.js";

const PENALTY: Record<string, number> = { error: 15, warn: 5, info: 1 };

export function gradeFindings(findings: Finding[]): GradeInfo {
  let score = 100;
  for (const f of findings) score -= PENALTY[f.severity] ?? 0;
  score = Math.max(0, score);
  const letter = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  return { score, letter };
}

export function countBySeverity(findings: Finding[]): { error: number; warn: number; info: number } {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

const SEV_ORDER = { error: 0, warn: 1, info: 2 } as const;

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId),
  );
}
