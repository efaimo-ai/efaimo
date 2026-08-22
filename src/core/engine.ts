import type { Finding, FindRuleContext, McpRuleContext } from "./types.js";
import { MCP_RULES } from "../rules/mcp/index.js";
import { FIND_RULES } from "../rules/find/index.js";

/** Run a list of rules, isolating each: a broken rule must never break the audit. */
export function runRules<Ctx>(rules: readonly { check(ctx: Ctx): Finding[] }[], ctx: Ctx): Finding[] {
  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      findings.push(...rule.check(ctx));
    } catch (err) {
      // Say so. This used to be a bare `catch {}`, which meant a rule that
      // threw was indistinguishable from a rule that passed - and since the
      // grade is 100 minus the findings, a crashing rule silently RAISED the
      // score. That is this project's documented dominant failure mode ("green
      // because it checked nothing") sitting inside the engine every check
      // runs through.
      //
      // Reported ungraded on purpose: a broken rule is our defect, not the
      // target's, so it must not cost the target points. It must not be
      // invisible either.
      const id = (rule as { id?: string }).id ?? "unknown rule";
      findings.push({
        ruleId: "E000",
        severity: "warn",
        graded: false,
        message: `rule ${id} threw and was skipped; this report is incomplete`,
        detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        fixHint: "please report this at https://github.com/efaimo-ai/efaimo/issues",
      } as Finding);
    }
  }
  return findings;
}

export function runMcpRules(ctx: McpRuleContext): Finding[] {
  return runRules(MCP_RULES, ctx);
}

export function runFindRules(ctx: FindRuleContext): Finding[] {
  return runRules(FIND_RULES, ctx);
}
