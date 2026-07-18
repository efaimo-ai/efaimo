import type { Finding, Severity } from "../core/types.js";
import { truncate } from "../util/misc.js";

interface InjectionPattern {
  key: string;
  re: RegExp;
  severity: Severity;
  label: string;
}

/**
 * Surface-level heuristics for instruction-injection patterns in text an agent
 * will read (tool descriptions, skill bodies). This is intentionally a linter,
 * not a security scanner: deep analysis belongs to dedicated tools
 * (Snyk agent-scan, Cisco MCP Scanner). Patterns favor precision over recall.
 */
export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    key: "override-instructions",
    re: /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|earlier|above)\s+(?:instructions|messages|rules|prompts)/i,
    severity: "error",
    label: "attempts to override prior instructions",
  },
  {
    key: "hide-from-user",
    re: /do\s+not\s+(?:tell|reveal|mention|inform|show|disclose)\b[\s\S]{0,40}\b(?:user|human|operator)/i,
    severity: "error",
    label: "instructs the agent to hide behavior from the user",
  },
  {
    key: "act-without-consent",
    re: /without\s+(?:telling|asking|notifying|informing)\s+(?:the\s+)?(?:user|human)/i,
    severity: "error",
    label: "instructs the agent to act without user consent",
  },
  {
    key: "credential-exfil",
    // "post" and "token" dropped: they match API documentation ("Token counting
    // POST /v1/...") far more than exfiltration.
    re: /\b(?:api[_-]?key|secret|password|credential)s?\b[\s\S]{0,40}\b(?:send|forward|exfiltrat|upload|leak|transmit|include\s+it)\b/i,
    severity: "error",
    label: "references sending credentials or secrets somewhere",
  },
  {
    key: "sensitive-file-read",
    re: /\b(?:read|open|cat|print|upload)\b[\s\S]{0,40}(?:\.env\b|\.ssh\b|id_rsa|credentials|\.aws\b|\.npmrc\b)/i,
    severity: "error",
    label: "references reading sensitive local files",
  },
  {
    key: "disable-safety",
    re: /\b(?:disable|bypass|ignore|remove)\s+(?:safety|guardrails?|filters?|restrictions?|policy|policies)\b/i,
    severity: "error",
    label: "asks to bypass safety or policy",
  },
  {
    key: "cross-tool-steering",
    re: /before\s+(?:using|calling|running)\b[^.?!]{0,40}?\btools?\b[\s,]{1,4}(?:always\s+|first\s+|please\s+)?(?:call|run|use|fetch|invoke)\b/i,
    severity: "warn",
    label: "steers the agent to call another tool first (cross-tool steering)",
  },
  {
    key: "templated-exfil-url",
    // Bounded runs (no adjacent unbounded same-class quantifiers) to avoid ReDoS.
    re: /https?:\/\/[^\s"'<>]{1,150}[?&][^\s"'<>]{0,150}(?:\$\{[^}]{1,60}\}|\{\{[^}]{1,60}\}\}|\{[^}]{1,60}\})/,
    severity: "warn",
    label: "URL with a templated query parameter (possible exfiltration channel)",
  },
  {
    key: "zero-width-chars",
    // eslint-disable-next-line no-control-regex
    re: /[​‌‍⁠﻿]/,
    severity: "warn",
    label: "zero-width or invisible characters present",
  },
  {
    key: "hidden-html-comment",
    re: /<!--[^>]{0,240}\b(?:must|always|never|call|run|fetch|send|ignore)\b[^>]{0,240}-->/i,
    severity: "warn",
    label: "HTML comment containing imperative instructions (hidden from rendered view)",
  },
  {
    key: "persona-override",
    re: /\byou\s+are\s+now\b|\bpretend\s+to\s+be\b|\bnew\s+system\s+prompt\b/i,
    severity: "warn",
    label: "persona or system-prompt override language",
  },
];

export function scanTextForInjection(
  text: string,
  opts: { ruleId: string; where: string; cap?: number },
): Finding[] {
  const findings: Finding[] = [];
  const cap = opts.cap ?? 10;
  // Bound the scanned text: these regexes are cheap but not worth running on
  // megabytes, and anything this long is its own finding (body-size rules).
  const scanned = text.length > 64 * 1024 ? text.slice(0, 64 * 1024) : text;
  for (const p of INJECTION_PATTERNS) {
    if (findings.length >= cap) break;
    const m = p.re.exec(scanned);
    if (m) {
      findings.push({
        ruleId: opts.ruleId,
        // Deliberately info: these are shallow heuristics an attacker evades
        // trivially. Surfacing them must never move a grade or fail CI, or a
        // clean report would read as a security pass (it is not one).
        //
        // `graded: false` is what makes the first half of that true. It used
        // to be a comment only, while gradeFindings charged every info finding
        // a point, so ten heuristic hits quietly cost a whole letter -- the
        // exact "clean report reads as a security verdict" failure this
        // comment was written to prevent, running in reverse.
        severity: "info",
        graded: false,
        title: "possible injection pattern (heuristic)",
        message: `${opts.where}: ${p.label}`,
        target: opts.where,
        detail: `matched: "${truncate(m[0].replace(/\s+/g, " "), 100)}". This is a shallow lint hint, not a security verdict.`,
        fixHint:
          "Remove instruction-like language from agent-readable text. efaimo is not a security scanner; for real supply-chain safety use a dedicated scanner (for example Snyk agent-scan).",
      });
    }
  }
  return findings;
}
