import type { Finding, McpRuleContext } from "./types.js";
import { MCP_RULES } from "../rules/mcp/index.js";

/** Run a list of rules, isolating each: a broken rule must never break the audit. */
export function runRules<Ctx>(rules: readonly { check(ctx: Ctx): Finding[] }[], ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      findings.push(...rule.check(ctx));
    } catch {
      /* skip a throwing rule */
    }
  }
  return findings;
}

export function runMcpRules(ctx: McpRuleContext): Finding[] {
  return runRules(MCP_RULES, ctx);
}
