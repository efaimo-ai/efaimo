# efaimo rules

Every finding carries a stable rule id so you can suppress, track, or link it.
Severities: **error** (will bite you), **warn** (should fix), **info** (worth knowing).

Grade starts at 100; each error costs 15, each warning 5, each info 1.
`A >= 90, B >= 80, C >= 70, D >= 60, else F`.

MCP checks split into **2026-07-28 readiness** (E101-E118) and **quality**
(E121-E130); skill checks are S1xx. **Only quality and skill findings are
graded.** Readiness findings are reported as a separate, ungraded **migration
diff**: the stateless revision they target is a locked Release Candidate
(2026-05-21) that does not finalize until 2026-07-28, and not yet migrating to
an unreleased spec is a to-do, not a defect. Readiness severities still order
the diff by urgency, but the diff never affects the grade, the badge, or the
exit code (including `--strict`). Once the spec ratifies, expect readiness to
start counting in a minor release. Source-pattern rules are heuristics and say
so in their detail line.

## MCP readiness (E101-E118)

| id | sev | what it catches | source of truth |
|---|---|---|---|
| E101 | warn | depends on a pre-`2026-07-28` SDK line (TS `@modelcontextprotocol/sdk` 1.x, Python `mcp` 1.x) instead of the 2.x stateless line | changelog / SDK releases |
| E102 | warn | source uses **Sampling** (`sampling/createMessage`), deprecated (SEP-2577) | draft changelog |
| E103 | warn | source uses **Roots** (`roots/list`), deprecated (SEP-2577) | draft changelog |
| E104 | warn | server declares the **logging** capability or source uses MCP Logging, deprecated (SEP-2577); `logging/setLevel` is removed | draft changelog |
| E105 | warn | the server does not answer a bare stateless `tools/list` (timeout, crash, or a not-initialized error), so it requires the removed `initialize` handshake. A server that answers (even with an error) is judged by E106/E107/E118 instead | SEP-2567 / stateless core |
| E106 | warn | `server/discover` is not implemented (MUST in the RC, SEP-2575) | draft changelog |
| E107 | info | results omit the required `resultType` field (`"complete"` \| `"input_required"`) | draft changelog |
| E108 | info | source relies on removed SSE resumability (`Last-Event-ID`) | draft changelog |
| E109 | info | auth advertises deprecated DCR (RFC 7591) with no detected CIMD support | PR #2858 / CIMD |
| E110 | warn | source uses legacy elicitation (`elicitation/create`); replaced by MRTR `input_required` results (SEP-2322) | draft changelog |
| E111 | info | in-process session-state patterns; statelessness expects server-minted handles in tool args | stateless core |
| E112 | warn | `tools/list` order is nondeterministic across connections (hurts prompt-cache hits) | draft changelog |
| E113 | info | no Server Card found at `/.well-known/mcp` (discovery metadata; heuristic path) | roadmap / Server Card WG |
| E114 | info | source uses the removed `ping` utility | draft changelog |
| E115 | info | source uses `resources/subscribe`, replaced by `subscriptions/listen` | draft changelog |
| E116 | warn | server prints non-JSON noise on stdout (breaks stdio framing) | transport basics |
| E117 | warn | only the deprecated HTTP+SSE transport worked; Streamable HTTP failed | draft changelog |
| E118 | warn | `tools/list` result omits the now-required `ttlMs`/`cacheScope` cache fields (SEP-2549, CacheableResult; also required on prompts/list, resources/list, resources/read, resources/templates/list, server/discover) | draft changelog |

## MCP quality (E121-E130)

| id | sev | what it catches |
|---|---|---|
| E121 | error/warn | tool description missing, a placeholder, or under ~20 chars |
| E122 | warn | description misses 3+ of 4 quality axes (length, when-to-use, params documented, mentions result), mirrors Glama's tool-definition-quality dimensions, computed locally |
| E123 | warn/info | no tools declare annotations; a destructive-looking tool lacks `destructiveHint` |
| E124 | warn | many undocumented parameters, or an oversized `enum` inflating every prompt |
| E125 | warn | tool count high enough (30+, 60+) to degrade routing and inflate context |
| E126 | warn/info | tool names mix conventions or exceed 64 chars |
| E127 | warn | a single tool definition costs 800+ tokens (needs `weigh` data) |
| E128 | warn | total tool-definition tax over ~10k / ~25k tokens, estimated (needs `weigh` data); hard CI failure is left to the `--max-tokens`/`--diff` gate |
| E130 | info | instruction-injection patterns in a tool description or server instructions (shallow heuristic, never a security verdict; use a dedicated scanner for depth). **Reported but never scored** |

## Skills (S101-S106)

| id | sev | what it catches | spec |
|---|---|---|---|
| S101 | error/warn/info | frontmatter invalid: missing `name`/`description`, `name` not matching the directory, over length limits, `metadata` not a string map, non-standard fields | agentskills.io |
| S102 | warn/info | description too thin or never says when to use the skill | agentskills.io |
| S103 | error/warn | duplicate skill names, or two skills with heavily overlapping descriptions (trigger collision) | internal |
| S104 | warn/info | metadata over ~100 tokens, body over ~5k tokens or 500 lines, or long body with no progressive disclosure | agentskills.io |
| S105 | info | instruction-injection patterns in the skill body or description (shallow heuristic, never a security verdict). **Reported but never scored** | internal |
| S106 | error/warn/info | referenced file missing, escaping the skill dir (`..`), or nested more than one level deep | agentskills.io |

## Notes on heuristics

Rules that scan **source code** (E101-E104, E108, E110, E111, E114, E115) are
pattern matches over your repo and can produce false positives; each finding says
so and points at the file:line so you can confirm. Rules that scan **a live
server** (E105-E107, E112, E116, E117) and the token rules (E127, E128) reflect
what the server actually did. `efaimo` is a linter, not a security scanner:
E130/S105 are surface heuristics, for real supply-chain security use a dedicated
tool such as Snyk agent-scan or the Cisco MCP Scanner.
