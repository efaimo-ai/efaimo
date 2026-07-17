import type { CheckReport, ServerWeighResult, SkillSetWeighResult } from "../core/types.js";
import { formatTokens } from "../util/misc.js";

/** Flat badge SVG in the shields style, self-contained (no external fonts). */
export function makeBadgeSvg(label: string, message: string, color: string): string {
  const charW = 6.5;
  const pad = 10;
  const lw = Math.round(label.length * charW + pad * 2);
  const mw = Math.round(message.length * charW + pad * 2);
  const w = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${label}: ${message}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${mw}" height="20" fill="${color}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14">${label}</text>
    <text x="${lw + mw / 2}" y="14">${message}</text>
  </g>
</svg>
`;
}

export interface BadgeSpec {
  label: string;
  message: string;
  color: string;
}

export function weighBadgeSpec(w: ServerWeighResult | SkillSetWeighResult): BadgeSpec {
  const total = w.kind === "mcp" ? w.totals.claudeStyle : w.totals.metadata + w.totals.body;
  const color = total < 2000 ? "#3fb950" : total < 8000 ? "#d29922" : total < 20000 ? "#db6d28" : "#f85149";
  return { label: "context cost", message: `${formatTokens(total)} tok (o200k)`, color };
}

export function gradeBadgeSpec(report: CheckReport): BadgeSpec {
  const g = report.grade;
  const color =
    g.letter === "A" ? "#3fb950" : g.letter === "B" ? "#7bc043" : g.letter === "C" ? "#d29922" : g.letter === "D" ? "#db6d28" : "#f85149";
  return { label: "efaimo", message: `${g.letter} (${g.score})`, color };
}

/** shields.io endpoint JSON (https://shields.io/badges/endpoint-badge). */
export function toShieldsEndpoint(spec: BadgeSpec): string {
  return JSON.stringify(
    { schemaVersion: 1, label: spec.label, message: spec.message, color: spec.color.replace("#", "") },
    null,
    2,
  );
}
