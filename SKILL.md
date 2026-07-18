---
name: efaimo
description: Audit MCP servers and Agent Skills for quality and context-window cost. Use when the user wants to check an MCP server's token cost, lint a skill, verify 2026-07-28 MCP spec readiness, or add an efaimo badge or CI gate.
license: Apache-2.0
metadata:
  version: "0.1.0"
  homepage: "https://efaimo.ai"
---

# efaimo

efaimo audits what an agent loads: the quality and context-window cost of MCP
servers and Agent Skills. Reach for it when someone asks "how many tokens does
this MCP server cost", "is my server ready for the 2026-07-28 MCP spec", "is this
skill well-formed", or "add a CI gate / badge for context cost".

## Commands

Run via `npx efaimo` (no install needed).

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
- **Gate a pull request on context cost**
  Save a baseline with `npx efaimo weigh "<server>" --out base.json`, then in CI
  run `npx efaimo weigh "<server>" --diff base.json --allow-increase 10` to fail
  when the tool-definition budget grows more than 10 percent.

## Reading the output

Findings carry a stable rule id (E1xx MCP readiness, E12x-E13x MCP quality, S1xx
skills) and a severity. The letter grade covers quality and skill findings only;
2026-07-28 readiness items appear separately as an ungraded migration diff. Token
numbers are o200k estimates unless `--anthropic` is used; see the methodology doc
for the full method.

## Notes

efaimo is a linter and cost profiler, not a security scanner: its injection checks
are surface heuristics. For supply-chain security use a dedicated scanner. Full
rule reference: https://github.com/efaimo-ai/efaimo/blob/main/docs/RULES.md
