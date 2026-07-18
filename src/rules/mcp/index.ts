import type { Finding, McpRule, McpRuleContext, ProbeOutcome, Severity } from "../../core/types.js";
import { scanTextForInjection } from "../injection.js";
import { looksLikeInitGate } from "../../clients/rawprobe.js";
import { formatTokens, truncate } from "../../util/misc.js";

const RC = "2026-07-28";

function isOutcome(x: unknown): x is ProbeOutcome {
  return !!x && typeof x === "object" && "ok" in (x as object);
}

function capList<T>(items: T[], cap: number): { shown: T[]; more: number } {
  return { shown: items.slice(0, cap), more: Math.max(0, items.length - cap) };
}

function repoMatchesFinding(
  ctx: McpRuleContext,
  category: string,
  make: (detail: string, count: number) => Finding,
): Finding[] {
  const matches = ctx.repo?.matches.filter((m) => m.category === category) ?? [];
  if (!matches.length) return [];
  const { shown, more } = capList(matches, 3);
  const detail =
    shown.map((m) => `${m.file}:${m.line} ${m.excerpt}`).join("\n") +
    (more ? `\n(+${more} more)` : "") +
    "\n(pattern match; verify manually)";
  return [make(detail, matches.length)];
}

const matchStr = (c: number): string => `${c} match${c === 1 ? "" : "es"}`;

/* ------------------- 2026-07-28 readiness (E10x-E11x) ------------------- */

/**
 * Source-grep readiness rules that all share one shape: find deprecated/removed
 * primitives in the repo and report file:line. Declared as data, generated below.
 */
interface RepoRuleSpec {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  message: (count: number) => string;
  fixHint?: string;
}

const REPO_MATCH_RULES: RepoRuleSpec[] = [
  {
    id: "E102",
    category: "sampling",
    severity: "warn",
    title: "uses deprecated Sampling",
    message: (c) => `source references sampling/createMessage (${matchStr(c)}); Sampling is deprecated in ${RC} (SEP-2577)`,
    fixHint: "integrate directly with an LLM provider API instead of MCP Sampling",
  },
  {
    id: "E103",
    category: "roots",
    severity: "warn",
    title: "uses deprecated Roots",
    message: (c) => `source references roots/list (${matchStr(c)}); Roots is deprecated in ${RC} (SEP-2577)`,
    fixHint: "pass directories or files via tool parameters, resource URIs, or server configuration",
  },
  {
    id: "E108",
    category: "sse-resume",
    severity: "info",
    title: "relies on removed SSE resumability",
    message: (c) => `source references Last-Event-ID/resumability (${matchStr(c)}); stream resumability is removed in ${RC}`,
    fixHint: "persist cross-call state behind server-minted handles passed as tool arguments",
  },
  {
    id: "E110",
    category: "elicitation",
    severity: "warn",
    title: "uses legacy elicitation",
    message: (c) => `source references elicitation/create (${matchStr(c)}); replaced in ${RC} by MRTR results (resultType "input_required" with inputRequests)`,
    fixHint: "return input_required results and correlate retries via requestState (SEP-2322)",
  },
  {
    id: "E111",
    category: "session-state",
    severity: "info",
    title: "possible in-process session state",
    message: (c) => `source shows session-state patterns (${matchStr(c)}); ${RC} statelessness expects server-minted handles passed via tool arguments`,
  },
  {
    id: "E114",
    category: "ping",
    severity: "info",
    title: "uses removed ping",
    message: (c) => `source references the ping utility (${matchStr(c)}); ping is removed in ${RC}`,
  },
  {
    id: "E115",
    category: "subscribe",
    severity: "info",
    title: "uses replaced resource subscriptions",
    message: (c) => `source references resources/subscribe (${matchStr(c)}); replaced by subscriptions/listen in ${RC}`,
  },
];

const repoMatchRules: McpRule[] = REPO_MATCH_RULES.map((spec) => ({
  id: spec.id,
  title: spec.title,
  surface: "mcp",
  check(ctx) {
    return repoMatchesFinding(ctx, spec.category, (detail, count) => ({
      ruleId: spec.id,
      severity: spec.severity,
      title: spec.title,
      message: spec.message(count),
      detail,
      ...(spec.fixHint ? { fixHint: spec.fixHint } : {}),
    }));
  },
}));

const e101: McpRule = {
  id: "E101",
  title: "legacy SDK generation",
  surface: "mcp",
  check(ctx) {
    if (!ctx.repo?.sdk) return [];
    const findings: Finding[] = [];
    const hasRc = ctx.repo.sdk.some((s) => s.generation === "rc");
    if (hasRc) return [];
    for (const s of ctx.repo.sdk) {
      findings.push({
        ruleId: "E101",
        severity: "warn",
        title: "legacy SDK generation",
        message: `depends on ${s.package}${s.range ? `@${s.range}` : ""} (pre-${RC} line)`,
        detail:
          s.language === "ts"
            ? `the ${RC} revision ships as the new @modelcontextprotocol/server package (2.x beta since 2026-07)`
            : `the ${RC} revision ships as mcp 2.x (pre-releases on PyPI since 2026-06)`,
        fixHint: "upgrade to the 2.x SDK line to get stateless transport and MRTR support",
      });
    }
    return findings;
  },
};

const e104: McpRule = {
  id: "E104",
  title: "uses deprecated MCP Logging",
  surface: "mcp",
  check(ctx) {
    if (ctx.intro.capabilities && "logging" in ctx.intro.capabilities) {
      return [
        {
          ruleId: "E104",
          severity: "warn",
          title: "uses deprecated MCP Logging",
          message: `server declares the logging capability; MCP Logging is deprecated in ${RC} (SEP-2577) and logging/setLevel is removed`,
          fixHint: "log to stderr (stdio) or use OpenTelemetry; per-request level arrives via _meta io.modelcontextprotocol/logLevel",
        },
      ];
    }
    return repoMatchesFinding(ctx, "logging", (detail, count) => ({
      ruleId: "E104",
      severity: "warn",
      title: "uses deprecated MCP Logging",
      message: `source references MCP logging APIs (${matchStr(count)}); deprecated in ${RC} (SEP-2577)`,
      detail,
      fixHint: "log to stderr (stdio) or use OpenTelemetry",
    }));
  },
};

const e105: McpRule = {
  id: "E105",
  title: "requires the removed initialize handshake",
  surface: "mcp",
  check(ctx) {
    const bare = ctx.probes?.bareToolsList;
    if (!isOutcome(bare)) return [];
    if (looksLikeInitGate(bare)) {
      return [
        {
          ruleId: "E105",
          severity: "warn",
          title: "requires the removed initialize handshake",
          message: `the server rejected a bare stateless tools/list as not initialized (${bare.errorMessage ?? `code ${bare.errorCode}`})`,
          detail: `${RC} removes initialize and sessions; RC servers answer bare requests carrying version info in _meta. Whether an answering server is RC-conformant is judged separately (E107 resultType, E118 cache fields, E106 server/discover).`,
          fixHint: "upgrade to a 2.x SDK, or accept requests without a prior initialize",
        },
      ];
    }
    if (bare.kind === "timeout") {
      return [
        {
          ruleId: "E105",
          severity: "info",
          title: "statelessness not verified",
          message: `the bare stateless tools/list timed out; this is inconclusive, not proof of a handshake requirement (the server may simply be slow to start)`,
          fixHint: "re-run with a larger --timeout; if it still times out, confirm the server answers requests without a prior initialize",
        },
      ];
    }
    return [];
  },
};

const e106: McpRule = {
  id: "E106",
  title: "server/discover not implemented",
  surface: "mcp",
  check(ctx) {
    const d = ctx.probes?.serverDiscover;
    if (!d || !("supported" in d) || d.supported) return [];
    return [
      {
        ruleId: "E106",
        severity: "warn",
        title: "server/discover not implemented",
        message: `server/discover is not implemented (${d.errorMessage ?? "method not found"})`,
        detail: `${RC} servers MUST implement server/discover (SEP-2575) to advertise versions, capabilities, and identity; clients also use it as the back-compat probe.`,
        fixHint: "the 2.x SDKs implement server/discover for you",
      },
    ];
  },
};

const e107: McpRule = {
  id: "E107",
  title: "results missing resultType",
  surface: "mcp",
  check(ctx) {
    if (ctx.probes?.resultTypePresent !== false) return [];
    return [
      {
        ruleId: "E107",
        severity: "info",
        title: "results missing resultType",
        message: `results do not carry the resultType field required in ${RC} ("complete" | "input_required")`,
        detail: "the RC requires resultType on every result (SEP-2322); on list results the value must be \"complete\". RC clients treat missing resultType from earlier-protocol servers as \"complete\", so this is informational until you upgrade.",
      },
    ];
  },
};

const e109: McpRule = {
  id: "E109",
  title: "auth still on deprecated DCR",
  surface: "mcp",
  check(ctx) {
    const auth = ctx.probes?.httpAuth;
    if (!auth?.required) return [];
    if (auth.cimdSupported === true) return [];
    if (auth.dcrRegistrationEndpoint === true) {
      return [
        {
          ruleId: "E109",
          severity: "info",
          title: "authorization server advertises DCR",
          message: "the authorization server offers Dynamic Client Registration; the 2026-07-28 revision prefers Client ID Metadata Documents (CIMD). This does not mean your server uses DCR, only that the AS advertises it.",
          detail: "heuristic and informational: CIMD support was not detected in the authorization-server metadata, a field few servers publish yet",
        },
      ];
    }
    return [
      {
        ruleId: "E109",
        severity: "info",
        title: "auth metadata not assessable",
        message: "server requires authentication; OAuth metadata could not be fully assessed (checks skipped)",
      },
    ];
  },
};

const e112: McpRule = {
  id: "E112",
  title: "nondeterministic tools/list order",
  surface: "mcp",
  check(ctx) {
    if (ctx.probes?.toolsOrderDeterministic !== false) return [];
    return [
      {
        ruleId: "E112",
        severity: "warn",
        title: "nondeterministic tools/list order",
        message: "tool order differed across two fresh connections; deterministic ordering enables prompt-cache hits in RC hosts",
        fixHint: "sort tools stably before returning them",
      },
    ];
  },
};

const e113: McpRule = {
  id: "E113",
  title: "no Server Card",
  surface: "mcp",
  check(ctx) {
    const sc = ctx.probes?.serverCard;
    if (!sc || !("found" in sc) || sc.found) return [];
    return [
      {
        ruleId: "E113",
        severity: "info",
        title: "no Server Card",
        message: `no Server Card found at ${sc.url ?? "/.well-known/mcp"} (heuristic path; the Server Card working group is standardizing discovery metadata)`,
      },
    ];
  },
};

const e116: McpRule = {
  id: "E116",
  title: "stdout noise on stdio transport",
  surface: "mcp",
  check(ctx) {
    if (!ctx.probes?.stdoutNoise) return [];
    return [
      {
        ruleId: "E116",
        severity: "warn",
        title: "stdout noise on stdio transport",
        message: "server printed non-JSON output on stdout; stdio transport requires clean line-delimited JSON-RPC",
        detail: `observed: ${ctx.probes.stdoutNoise}`,
        fixHint: "write logs and banners to stderr, never stdout",
      },
    ];
  },
};

const e117: McpRule = {
  id: "E117",
  title: "only legacy HTTP+SSE transport",
  surface: "mcp",
  check(ctx) {
    if (ctx.intro.httpTransport !== "sse-legacy") return [];
    return [
      {
        ruleId: "E117",
        severity: "warn",
        title: "only legacy HTTP+SSE transport",
        message: "Streamable HTTP failed and only the legacy HTTP+SSE transport worked; HTTP+SSE is deprecated in the 2026-07-28 revision",
        fixHint: "migrate to Streamable HTTP (single POST endpoint)",
      },
    ];
  },
};

const e118: McpRule = {
  id: "E118",
  title: "missing cache fields (ttlMs, cacheScope)",
  surface: "mcp",
  check(ctx) {
    if (ctx.probes?.cacheFieldsPresent !== false) return [];
    return [
      {
        ruleId: "E118",
        severity: "warn",
        title: "missing cache fields (ttlMs, cacheScope)",
        message: `tools/list result omits ttlMs and/or cacheScope, which ${RC} requires on list and resource-read results (SEP-2549, CacheableResult)`,
        detail: "required on tools/list, prompts/list, resources/list, resources/read, resources/templates/list, and server/discover; cacheScope is \"public\" or \"private\"",
        fixHint: "return ttlMs and cacheScope on these results so clients can cache and stop polling; the 2.x SDKs add them for you",
      },
    ];
  },
};

/* ------------------------- quality (E12x-E13x) ------------------------- */

const PLACEHOLDER_RE = /^(todo|tbd|fixme|test|desc(ription)?|\.+|-+)$/i;

const e121: McpRule = {
  id: "E121",
  title: "missing or thin tool description",
  surface: "mcp",
  check(ctx) {
    const bad: Finding[] = [];
    for (const t of ctx.intro.tools) {
      const d = (t.description ?? "").trim();
      if (!d || PLACEHOLDER_RE.test(d)) {
        bad.push({
          ruleId: "E121",
          severity: "error",
          title: "missing or thin tool description",
          message: `tool "${t.name}": description is ${d ? `a placeholder ("${d}")` : "missing"}`,
          target: t.name,
          fixHint: "models choose tools by description; say what it does, when to use it, and what it returns",
        });
      } else if (d.length < 20) {
        bad.push({
          ruleId: "E121",
          severity: "warn",
          title: "missing or thin tool description",
          message: `tool "${t.name}": description is only ${d.length} chars ("${d}")`,
          target: t.name,
          fixHint: "expand to cover purpose, when to use, and return shape",
        });
      }
    }
    const { shown, more } = capList(bad, 8);
    if (more) {
      shown.push({
        ruleId: "E121",
        severity: "warn",
        title: "missing or thin tool description",
        message: `...and ${more} more tools with missing or thin descriptions`,
      });
    }
    return shown;
  },
};

const QUALITY_AXES: { key: string; test: (desc: string, t: { inputSchema?: unknown }) => boolean }[] = [
  { key: "length 40..600", test: (d) => d.length >= 40 && d.length <= 600 },
  { key: "says when to use it", test: (d) => /\buse (this|it|when|for)\b|\bwhen (the|you|a|to)\b|\buse cases?\b/i.test(d) },
  {
    key: "parameters documented",
    test: (_d, t) => {
      const props = (t.inputSchema as { properties?: Record<string, { description?: string }> } | undefined)?.properties;
      if (!props) return true;
      const entries = Object.values(props);
      if (!entries.length) return true;
      const documented = entries.filter((p) => typeof p?.description === "string" && p.description.length > 0).length;
      return documented / entries.length >= 0.7;
    },
  },
  { key: "mentions the result", test: (d) => /\breturns?\b|\bresponse\b|\boutput\b|\bresult\b/i.test(d) },
];

const e122: McpRule = {
  id: "E122",
  title: "weak description quality",
  surface: "mcp",
  check(ctx) {
    const findings: Finding[] = [];
    for (const t of ctx.intro.tools) {
      const d = (t.description ?? "").trim();
      if (!d || d.length < 20) continue; // E121 territory
      const failed = QUALITY_AXES.filter((a) => !a.test(d, t)).map((a) => a.key);
      if (failed.length >= 3) {
        findings.push({
          ruleId: "E122",
          severity: "warn",
          title: "weak description quality",
          message: `tool "${t.name}": description misses ${failed.length}/4 quality axes (${failed.join("; ")})`,
          target: t.name,
        });
      }
    }
    return capList(findings, 5).shown;
  },
};

const DESTRUCTIVE_NAME_RE = /\b(delete|remove|drop|purge|destroy|overwrite|truncate|erase|wipe|revoke|reset|format|deploy|kill)\b/i;

const e123: McpRule = {
  id: "E123",
  title: "missing tool annotations",
  surface: "mcp",
  check(ctx) {
    const tools = ctx.intro.tools;
    if (!tools.length) return [];
    const withAnnotations = tools.filter((t) => t.annotations && Object.keys(t.annotations).length > 0);
    const findings: Finding[] = [];
    if (withAnnotations.length === 0) {
      findings.push({
        ruleId: "E123",
        severity: "warn",
        title: "missing tool annotations",
        message: `none of ${tools.length} tools declare annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)`,
        fixHint: "annotations let hosts gate confirmations and parallelize safely",
      });
    }
    const risky = tools.filter(
      (t) => DESTRUCTIVE_NAME_RE.test(t.name) && !(t.annotations && "destructiveHint" in t.annotations),
    );
    for (const t of capList(risky, 5).shown) {
      findings.push({
        ruleId: "E123",
        severity: "info",
        title: "missing tool annotations",
        message: `tool "${t.name}" looks destructive but has no destructiveHint annotation`,
        target: t.name,
      });
    }
    return findings;
  },
};

const e124: McpRule = {
  id: "E124",
  title: "schema issues",
  surface: "mcp",
  check(ctx) {
    const findings: Finding[] = [];
    let undocumented = 0;
    let totalParams = 0;
    for (const t of ctx.intro.tools) {
      const schema = t.inputSchema as
        | { properties?: Record<string, { description?: string; enum?: unknown[] }> }
        | undefined;
      const props = schema?.properties ?? {};
      for (const [pname, p] of Object.entries(props)) {
        totalParams++;
        if (!p?.description) undocumented++;
        if (Array.isArray(p?.enum) && p.enum.length > 50) {
          findings.push({
            ruleId: "E124",
            severity: "warn",
            title: "schema issues",
            message: `tool "${t.name}" parameter "${pname}": enum with ${p.enum.length} values inflates every prompt`,
            target: t.name,
            fixHint: "accept a string and validate server-side, or document values in a resource",
          });
        }
      }
    }
    if (totalParams > 5 && undocumented / totalParams > 0.3) {
      findings.push({
        ruleId: "E124",
        severity: "warn",
        title: "schema issues",
        message: `${undocumented} of ${totalParams} parameters lack descriptions`,
        fixHint: "parameter descriptions are how models fill arguments correctly",
      });
    }
    return capList(findings, 5).shown;
  },
};

const e125: McpRule = {
  id: "E125",
  title: "tool count inflates context",
  surface: "mcp",
  check(ctx) {
    const n = ctx.intro.tools.length;
    if (n > 60) {
      return [
        {
          ruleId: "E125",
          severity: "warn",
          title: "tool count inflates context",
          message: `${n} tools is far past the point where selection accuracy and context cost degrade`,
          fixHint: "split into focused servers, or rely on hosts' deferred tool loading",
        },
      ];
    }
    if (n > 30) {
      return [
        {
          ruleId: "E125",
          severity: "warn",
          title: "tool count inflates context",
          message: `${n} tools; large toolsets inflate context and confuse tool routing`,
          fixHint: "consider splitting into focused servers",
        },
      ];
    }
    return [];
  },
};

const e126: McpRule = {
  id: "E126",
  title: "naming inconsistencies",
  surface: "mcp",
  check(ctx) {
    const findings: Finding[] = [];
    const names = ctx.intro.tools.map((t) => t.name);
    const snake = names.filter((n) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(n)).length;
    const camel = names.filter((n) => /^[a-z]+[A-Z]/.test(n)).length;
    if (snake > 0 && camel > 0) {
      findings.push({
        ruleId: "E126",
        severity: "info",
        title: "naming inconsistencies",
        message: `mixed naming styles across tools (${snake} snake_case, ${camel} camelCase)`,
      });
    }
    for (const n of names.filter((n) => n.length > 64).slice(0, 3)) {
      findings.push({
        ruleId: "E126",
        severity: "warn",
        title: "naming inconsistencies",
        message: `tool name "${truncate(n, 70)}" exceeds 64 chars (breaks stricter clients)`,
      });
    }
    return findings;
  },
};

const e127: McpRule = {
  id: "E127",
  title: "heavyweight tool definition",
  surface: "mcp",
  check(ctx) {
    if (!ctx.weigh) return [];
    const heavy = ctx.weigh.perTool.filter((t) => t.tokens.claudeStyle > 800);
    return capList(heavy, 5).shown.map((t) => ({
      ruleId: "E127",
      severity: "warn" as const,
      title: "heavyweight tool definition",
      message: `tool "${t.name}" definition is ~${formatTokens(t.tokens.claudeStyle)} tokens (description ${formatTokens(t.descriptionTokens)}, schema ${formatTokens(t.schemaTokens)})`,
      target: t.name,
      fixHint: "move examples and long docs into resources; trim schema descriptions",
    }));
  },
};

const e128: McpRule = {
  id: "E128",
  title: "total context tax",
  surface: "mcp",
  check(ctx) {
    if (!ctx.weigh) return [];
    const total = ctx.weigh.totals.claudeStyle;
    // warn, not error: this is an estimated absolute (see docs/METHODOLOGY.md).
    // Hard CI failure on cost belongs to the user-chosen --max-tokens/--diff gate.
    if (total > 25000) {
      return [
        {
          ruleId: "E128",
          severity: "warn",
          title: "total context tax",
          message: `tool definitions alone are ~${formatTokens(total)} tokens (~${((total / 200000) * 100).toFixed(1)}% of a 200k window, estimated) before any work happens`,
          fixHint: "trim descriptions/schemas, split the server, or rely on deferred tool loading",
        },
      ];
    }
    if (total > 10000) {
      return [
        {
          ruleId: "E128",
          severity: "warn",
          title: "total context tax",
          message: `tool definitions are ~${formatTokens(total)} tokens (~${((total / 200000) * 100).toFixed(1)}% of a 200k window)`,
          fixHint: "run \`efaimo weigh\` for the per-tool breakdown",
        },
      ];
    }
    return [];
  },
};

const e130: McpRule = {
  id: "E130",
  title: "possible instruction injection",
  surface: "mcp",
  check(ctx) {
    const findings: Finding[] = [];
    for (const t of ctx.intro.tools) {
      if (findings.length >= 10) break;
      if (t.description) {
        findings.push(
          ...scanTextForInjection(t.description, {
            ruleId: "E130",
            where: `tool "${t.name}" description`,
            cap: 10 - findings.length,
          }),
        );
      }
    }
    if (ctx.intro.instructions && findings.length < 10) {
      findings.push(
        ...scanTextForInjection(ctx.intro.instructions, {
          ruleId: "E130",
          where: "server instructions",
          cap: 10 - findings.length,
        }),
      );
    }
    return findings;
  },
};

export const MCP_RULES: McpRule[] = [
  e101, e104, e105, e106, e107, e109, e112, e113, e116, e117, e118,
  ...repoMatchRules,
  e121, e122, e123, e124, e125, e126, e127, e128, e130,
];

/** E101-E118 are 2026-07-28 readiness rules: reported as a migration diff, not graded. */
export function isReadinessRuleId(id: string): boolean {
  return /^E1(0|1)\d$/.test(id);
}
