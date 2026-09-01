# efaimo rules

Every finding carries a stable rule id so you can suppress, track, or link it.
Severities: **error** (will bite you), **warn** (should fix), **info** (worth knowing).

Grade starts at 100; each error costs 15, each warning 5, each info 1.
`A >= 90, B >= 80, C >= 70, D >= 60, else F`.

Every JSON report carries a `rulesVersion`. The tool version does not identify a ruleset on its own: a patch
release can change what a rule fires on, so a published grade is only
reproducible next to the ruleset that produced it.

MCP checks split into **2026-07-28 readiness** (E101-E118) and **quality**
(E121-E128 and E130, with no E129); skill checks are S1xx; **findability**
(E141-E145) is a third family reported by `efaimo find`.
**Only quality and skill findings are graded.** Readiness findings are reported as a separate, ungraded **migration
diff**: the two answer different questions. The grade is what a model
experiences from this tool surface; readiness is whether a 2026-07-28 client can
talk to this server. Combining them scored the official reference server a C(79)
for a tool surface that is an A(95), which is why they are two numbers printed
next to each other rather than one. Readiness severities still order the diff by
urgency, but the diff never affects the grade or the badge, and never affects
the exit code unless you ask for it with `--strict-readiness`. Source-pattern
rules are heuristics and say so in their detail line.

## MCP readiness (E101-E118)

| id | sev | what it catches | source of truth |
|---|---|---|---|
| E101 | warn | depends on a pre-`2026-07-28` SDK line (TS `@modelcontextprotocol/sdk` 1.x, Python `mcp` 1.x) instead of the stateless successors (TS `@modelcontextprotocol/server` 2.x, Python `mcp` 2.x) | changelog / SDK releases |
| E102 | warn | source uses **Sampling** (`sampling/createMessage`), deprecated (SEP-2577) | 2026-07-28 changelog |
| E103 | warn | source uses **Roots** (`roots/list`), deprecated (SEP-2577) | 2026-07-28 changelog |
| E104 | warn | server declares the **logging** capability or source uses MCP Logging, deprecated (SEP-2577); `logging/setLevel` is removed | 2026-07-28 changelog |
| E105 | warn | the server rejects a bare stateless `tools/list` with a not-initialized error, or exits on it, so it still requires the removed `initialize` handshake. A timeout is reported as unverified statelessness rather than as this warn, and a server that answers (even with another error) is judged by E106/E107/E118 instead | SEP-2567 / stateless core |
| E106 | warn | `server/discover` is not implemented (MUST in 2026-07-28, SEP-2575) | 2026-07-28 changelog |
| E107 | info | results omit the required `resultType` field (`"complete"` \| `"input_required"`) | 2026-07-28 changelog |
| E108 | info | source relies on removed SSE resumability (`Last-Event-ID`) | 2026-07-28 changelog |
| E109 | info | auth advertises deprecated DCR (RFC 7591) with no detected CIMD support | PR #2858 / CIMD |
| E110 | warn | source uses legacy elicitation (`elicitation/create`); replaced by MRTR `input_required` results (SEP-2322) | 2026-07-28 changelog |
| E111 | info | in-process session-state patterns; statelessness expects server-minted handles in tool args | stateless core |
| E112 | warn | `tools/list` order is nondeterministic across connections (hurts prompt-cache hits) | 2026-07-28 changelog |
| E113 | info | no Server Card found at `/.well-known/mcp` (discovery metadata; heuristic path) | roadmap / Server Card WG |
| E114 | info | source uses the removed `ping` utility | 2026-07-28 changelog |
| E115 | info | source uses `resources/subscribe`, replaced by `subscriptions/listen` | 2026-07-28 changelog |
| E116 | warn | server prints non-JSON noise on stdout (breaks stdio framing) | transport basics |
| E117 | warn | only the deprecated HTTP+SSE transport worked; Streamable HTTP failed | 2026-07-28 changelog |
| E118 | warn | a `tools/list` or `server/discover` result omits the required `ttlMs`/`cacheScope` cache fields (SEP-2549, CacheableResult; also required on prompts/list, resources/list, resources/read, resources/templates/list). Both surfaces efaimo calls are measured and the message names the ones that failed. `server/discover` counts only since the published spec made `DiscoverResult` extend `CacheableResult`; under the locked RC it did not | 2026-07-28 changelog |

## MCP quality (E121-E128, E130)

There is no E129. The range used to be written "E121-E130", which implies a
contiguous block and invites a lookup that finds nothing; ids are stable and
never reused, so a gap is permanent and is better stated than smoothed over.

| id | sev | what it catches |
|---|---|---|
| E000 | warn | a rule threw and was skipped, so this report is incomplete. **Reported but never scored**: a broken rule is our defect, not the target's, and must not cost it points. It exists because `runRules` used to swallow the exception silently, which made a crashing rule indistinguishable from a passing one and silently RAISED the grade |
| E121 | error/warn | tool description missing, a placeholder, or under ~20 chars |
| E122 | warn | description misses 3+ of 4 quality axes (length, when-to-use, params documented, mentions result), mirrors Glama's tool-definition-quality dimensions, computed locally |
| E123 | warn/info | no tools declare annotations; a destructive-looking tool lacks `destructiveHint` |
| E124 | warn | many undocumented parameters, or an oversized `enum` inflating every prompt |
| E125 | warn | tool count high enough (30+, 60+) to degrade routing and inflate context. The lower boundary is not ours: Anthropic's tool search documentation states that "Claude's ability to pick the right tool degrades once you exceed 30-50 available tools". The 60 boundary is ours, and has no published source |
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

## Findability (E141-E145)

Reported by `efaimo find`, never by `check`, and **never graded**. They answer a
question the other two families do not: when a host marks tools
`defer_loading: true`, the definitions stay out of the context window until a
search finds them, so a tool nothing surfaces costs nothing and does nothing.
Anthropic recommends turning that on once definitions pass ~10k tokens.

`find` prints two measured proportions, not a letter grade (ADR-030), and they
are different kinds of claim:

- **`distinct`** is a property of the catalog. A tool that owns no term the
  other tools lack cannot be matched by any query that does not also match a
  competitor. No model of how anyone searches is involved. This is the headline
  and the number `--min-distinct` gates on.
- **`probe`** is a simulation: BM25 over the four searchable fields, each tool
  queried with the top terms of its own description. It reads 100% on the
  official reference server and on `@playwright/mcp`, so it is a floor test
  that catches an empty description or a literal duplicate, not a ranking. The
  output says so every run.

Method, parameters and limits: [METHODOLOGY.md](./METHODOLOGY.md).

| id | sev | what it catches |
|---|---|---|
| E141 | warn | the tool owns no term that no other tool has, so no search returns it without also returning a competitor. The one rule here that is not a heuristic |
| E142 | warn | the probe does not return the tool inside the result window (default 5), or its description offers no word to search for at all |
| E143 | warn | two tools score identically for one of their own queries, so only the alphabetical tie-break separates them |
| E144 | info | the tool name is built only from generic words (`run`, `execute_query`), so a broad pattern search reaches it only through its description |
| E145 | warn | Anthropic's guidance recommends tool search for a catalog this shape (10 or more tools, or over 10k tokens of definitions) **and** some tools cannot be singled out: once the catalog is deferred, those tools cost nothing and do nothing |
| E146 | info | every word the tool owns comes from its own name, so nothing in its description is unique. Names are searchable, so this is not E141; it means only someone who already knows the name can single it out |

## Notes on heuristics

Rules that scan **source code** (E101-E104, E108, E110, E111, E114, E115) are
pattern matches over your repo and can produce false positives; each finding says
so and points at the file:line so you can confirm. Rules that scan **a live
server** (E105-E107, E112, E116, E117) and the token rules (E127, E128) reflect
what the server actually did. `efaimo` is a linter, not a security scanner:
E130/S105 are surface heuristics, for real supply-chain security use a dedicated
tool such as Snyk agent-scan or the Cisco MCP Scanner.
