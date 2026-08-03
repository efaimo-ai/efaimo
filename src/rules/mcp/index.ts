import type { Finding, McpRule, McpRuleContext, ProbeOutcome, Severity } from "../../core/types.js";
import { scanTextForInjection } from "../injection.js";
import { looksLikeInitGate } from "../../clients/rawprobe.js";
import { formatTokens, truncate } from "../../util/misc.js";
import { formatWindowShare } from "../../weigh/window.js";

const SPEC = "2026-07-28";

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
    message: (c) => `source references sampling/createMessage (${matchStr(c)}); Sampling is deprecated in ${SPEC} (SEP-2577)`,
    fixHint: "integrate directly with an LLM provider API instead of MCP Sampling",
  },
  {
    id: "E103",
    category: "roots",
    severity: "warn",
    title: "uses deprecated Roots",
    message: (c) => `source references roots/list (${matchStr(c)}); Roots is deprecated in ${SPEC} (SEP-2577)`,
    fixHint: "pass directories or files via tool parameters, resource URIs, or server configuration",
  },
  {
    id: "E108",
    category: "sse-resume",
    severity: "info",
    title: "relies on removed SSE resumability",
    message: (c) => `source references Last-Event-ID/resumability (${matchStr(c)}); stream resumability is removed in ${SPEC}`,
    fixHint: "persist cross-call state behind server-minted handles passed as tool arguments",
  },
  {
    id: "E110",
    category: "elicitation",
    severity: "warn",
    title: "uses legacy elicitation",
    message: (c) => `source references elicitation/create (${matchStr(c)}); replaced in ${SPEC} by MRTR results (resultType "input_required" with inputRequests)`,
    fixHint: "return input_required results and correlate retries via requestState (SEP-2322)",
  },
  {
    id: "E111",
    category: "session-state",
    severity: "info",
    title: "possible in-process session state",
    message: (c) => `source shows session-state patterns (${matchStr(c)}); ${SPEC} statelessness expects server-minted handles passed via tool arguments`,
  },
  {
    id: "E114",
    category: "ping",
    severity: "info",
    title: "uses removed ping",
    message: (c) => `source references the ping utility (${matchStr(c)}); ping is removed in ${SPEC}`,
  },
  {
    id: "E115",
    category: "subscribe",
    severity: "info",
    title: "uses replaced resource subscriptions",
    message: (c) => `source references resources/subscribe (${matchStr(c)}); replaced by subscriptions/listen in ${SPEC}`,
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
        message: `depends on ${s.package}${s.range ? `@${s.range}` : ""} (pre-${SPEC} line)`,
        detail:
          s.language === "ts"
            ? // No maturity label here on purpose. This said "2.x beta since
              // 2026-07" and stayed saying it after both packages cut 2.0.0 on
              // 2026-07-27, which told people to migrate onto a beta that was
              // not one. The package name and major line are the durable facts.
              `the ${SPEC} revision ships as the new @modelcontextprotocol/server package (2.x)`
            : `the ${SPEC} revision ships as mcp 2.x on PyPI`,
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
          message: `server declares the logging capability; MCP Logging is deprecated in ${SPEC} (SEP-2577) and logging/setLevel is removed`,
          fixHint: "log to stderr (stdio) or use OpenTelemetry; per-request level arrives via _meta io.modelcontextprotocol/logLevel",
        },
      ];
    }
    return repoMatchesFinding(ctx, "logging", (detail, count) => ({
      ruleId: "E104",
      severity: "warn",
      title: "uses deprecated MCP Logging",
      message: `source references MCP logging APIs (${matchStr(count)}); deprecated in ${SPEC} (SEP-2577)`,
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
          detail: `${SPEC} removes initialize and sessions; stateless servers answer bare requests carrying version info in _meta. Whether an answering server is fully ${SPEC}-conformant is judged separately (E107 resultType, E118 cache fields, E106 server/discover).`,
          fixHint: "upgrade to a 2.x SDK, or accept requests without a prior initialize",
        },
      ];
    }
    if (bare.kind === "exit") {
      // A crash on the bare request is not a timeout and not a clean answer: the
      // server did not serve a stateless tools/list, so a 2026-07-28 client
      // cannot talk to it. Left unhandled, this outcome produced NO finding, so
      // a crashing server looked one item MORE migrated than one that answers
      // with a not-initialized error.
      return [
        {
          ruleId: "E105",
          severity: "warn",
          title: "requires the removed initialize handshake",
          message: `the server process exited on a bare stateless tools/list (${bare.errorMessage ?? "no reply"}), so it does not answer requests without a prior initialize`,
          detail: `${SPEC} removes initialize and sessions; a server that exits on a bare request cannot serve a ${SPEC} client. A server that answers, even with an error, is judged by E106/E107/E118 instead.`,
          fixHint: "upgrade to a 2.x SDK, or answer requests without a prior initialize instead of exiting",
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
        detail: `${SPEC} servers MUST implement server/discover (SEP-2575) to advertise versions, capabilities, and identity; clients also use it as the back-compat probe.`,
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
        message: `results do not carry the resultType field required in ${SPEC} ("complete" | "input_required")`,
        detail: `${SPEC} requires resultType on every result (SEP-2322); on list results the value must be "complete". ${SPEC} clients treat missing resultType from earlier-protocol servers as "complete", so this is informational until you upgrade.`,
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
        message: "tool order differed across two fresh connections; deterministic ordering enables prompt-cache hits in stateless hosts",
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
    // Two measured surfaces, not one. server/discover only became cacheable in
    // the spec that published on 2026-07-28 (DiscoverResult extends
    // CacheableResult); under the locked RC it extended plain Result, so a
    // server that migrated against the RC can pass tools/list and still miss
    // this. Undefined means the surface was never measured, which is not a
    // finding: E106 already owns "server/discover did not answer".
    const surfaces: string[] = [];
    if (ctx.probes?.cacheFieldsPresent === false) surfaces.push("tools/list");
    if (ctx.probes?.discoverCacheFieldsPresent === false) surfaces.push("server/discover");
    if (!surfaces.length) return [];
    const subject = surfaces.length > 1 ? `${surfaces.join(" and ")} results omit` : `${surfaces[0]} result omits`;
    return [
      {
        ruleId: "E118",
        severity: "warn",
        title: "missing cache fields (ttlMs, cacheScope)",
        message: `${subject} ttlMs and/or cacheScope, which ${SPEC} requires on list and resource-read results (SEP-2549, CacheableResult)`,
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

// "format" was in this list and is dropped. It only ever meant "format a
// disk" in the author's head, but `format_date`, `format_output` and
// `format_json` are among the most common tool names there are, and once the
// matcher below started working the word turned into pure noise. Nobody could
// have found that while the rule was firing on nothing.
const DESTRUCTIVE_WORDS = new Set([
  "delete", "remove", "drop", "purge", "destroy", "overwrite",
  "truncate", "erase", "wipe", "revoke", "reset", "deploy", "kill",
]);

/**
 * Does this tool name read as destructive?
 *
 * This was a single `\b(delete|remove|...)\b` regex, and `_` is a word
 * character, so `\bdelete\b` has no boundary inside `delete_file` - nor inside
 * `deleteFile`. Every conventional MCP tool name escaped it: delete_file,
 * deleteFile, drop_table, removeUser, kill_process, wipe_db all returned
 * false, while only a bare `delete` or `delete-file` matched. E123 is
 * documented in docs/RULES.md as catching "a destructive-looking tool lacking
 * destructiveHint" and it could not fire on essentially any real server.
 *
 * Split on separators AND on camelCase boundaries, then test each segment.
 */
export function readsDestructive(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .some((seg) => DESTRUCTIVE_WORDS.has(seg.toLowerCase()));
}

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
      (t) => readsDestructive(t.name) && !(t.annotations && "destructiveHint" in t.annotations),
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
      // Prepend, not append: capList keeps the first 5, and on the worst schemas
      // (5+ oversized enums) an appended summary was exactly the line that got
      // dropped. The aggregate is the headline, so it leads.
      findings.unshift({
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
          message: `tool definitions alone are ~${formatTokens(total)} tokens (${formatWindowShare(total)}, estimated) before any work happens`,
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
          message: `tool definitions are ~${formatTokens(total)} tokens (${formatWindowShare(total)})`,
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
