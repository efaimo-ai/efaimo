---
name: efaimo
description: Audit MCP servers and Agent Skills for quality and context-window cost. Use when the user wants to check an MCP server's token cost, lint a skill, verify 2026-07-28 MCP spec readiness, find out whether a search can single out a server's tools under deferred tool loading, or add an efaimo badge or CI gate.
license: Apache-2.0
metadata:
  version: "0.6.0"
  homepage: "https://efaimo.ai"
---

# efaimo

efaimo audits what an agent loads: the quality and context-window cost of MCP
servers and Agent Skills. Reach for it when someone asks "how many tokens does
this MCP server cost", "is my server ready for the 2026-07-28 MCP spec", "is this
skill well-formed", or "add a CI gate / badge for context cost".

## Commands

Run via `npx efaimo` (no install needed).

**Before running any of these against a stdio server: auditing one means
executing it.** `weigh` and `check --mcp` start the command you pass as a child
process and speak MCP to it, because that is the only way to see the tool
definitions it would put in a context window. So only point them at commands
you would be willing to run yourself. A remote target (`https://...`) is not
executed and is the safe option for something you do not trust. `--client`
reads the MCP config files in the current directory as well as your user
config, so running it inside a repository you did not write means starting the
servers that repository configured. Until 2026-08-02 this warning lived only in
`SECURITY.md`, which was the wrong way round: the policy is where humans look,
and this file is where agents take orders.

- **Weigh context cost of an MCP server**
  `npx efaimo weigh "npx -y <server-package>"` for a stdio server, or
  `npx efaimo weigh https://host/mcp` for a remote one. Add `--json` for machine
  output, `--badge badge.svg` for a shields badge, `--anthropic` for Claude-exact
  token counts.
- **Weigh a skill or skill set**
  `npx efaimo weigh ./path/to/skill` reports the metadata / body / referenced-file
  token split.
- **Weigh everything a client loads**
  `npx efaimo weigh --client claude-code` (also `claude-desktop`, `cursor`,
  `vscode`) sums every configured server.
- **Audit an MCP server**
  `npx efaimo check --mcp "npx -y <server>"` prints a quality grade plus a
  separate 2026-07-28 migration diff (what breaks under the stateless spec and
  how to fix it). Add `--repo ./src` to also scan source for deprecated
  primitives, `--strict` to fail on warnings.
- **Lint a skill**
  `npx efaimo check --skill ./skills/` validates frontmatter, trigger quality,
  context budget, file references, and injection patterns.
- **Check whether a search can single a tool out**
  `npx efaimo find "npx -y <server>"` reports how many tools own a term no
  other tool in the catalog has. A tool that owns none cannot be matched by any
  query that does not also match a competitor, which matters once a host defers
  tool loading. `--min-distinct 100` is the CI gate.
- **Gate a pull request on context cost**
  Save a baseline with `npx efaimo weigh "<server>" --out base.json`, then in CI
  run `npx efaimo weigh "<server>" --diff base.json --allow-increase 10` to fail
  when the tool-definition budget grows more than 10 percent.

## Reading the output

Findings carry a stable rule id (E1xx MCP readiness, E12x-E13x MCP quality,
E14x findability, S1xx skills) and a severity. The letter grade
covers quality and skill findings only; 2026-07-28 readiness items appear
separately as an ungraded migration diff, and findability is a
separate command with no grade at all. Token numbers are o200k estimates unless
`--anthropic` is used, which names the model it measured against; see the
methodology doc for the full method.

## Notes

efaimo is a linter and cost profiler, not a security scanner: its injection checks
are surface heuristics. For supply-chain security use a dedicated scanner. Full
rule reference: https://github.com/efaimo-ai/efaimo/blob/main/docs/RULES.md

<!-- generated:siblings -->

## Siblings

Every skill in this set is about a report that was true about the wrong thing. The set: https://efaimo.ai/skills

- `denominator` - the counts efaimo prints are only worth as much as the sets they were taken over.
- `mcp-stateless-migration` - when `check --mcp` prints a readiness list and you want to work it.

<!-- /generated:siblings -->
