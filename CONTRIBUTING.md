# Contributing to efaimo

Thanks for helping. efaimo aims to be the accurate, honest measuring tool for what
agents load, so correctness and defensible claims matter more than feature count.

## Setup

```bash
git clone https://github.com/efaimo-ai/efaimo
cd efaimo
pnpm install
pnpm build      # tsc -> dist
pnpm test       # vitest (includes a live fixture MCP server)
pnpm typecheck  # strict tsc, no emit
```

Node >= 22 (the pnpm toolchain requires it). The build is a plain `tsc`, there is
no bundler.

## Adding a rule

Rules live in `src/rules/mcp/index.ts` and `src/rules/skill/index.ts`. Each has a
stable id (E1xx MCP readiness, E12x-E13x MCP quality, S1xx skills). When you add
one:

1. Give it the next free id and a one-line `title`.
2. Add it to the exported `MCP_RULES` / `SKILL_RULES` array.
3. Document it in `docs/RULES.md`, a test (`test/meta.test.ts`) fails if any rule
   id is missing from that file.
4. If it cites a spec change, link the SEP/PR and verify the wording against the
   primary source (the changelog at modelcontextprotocol.io, not a summary).
5. Add a test that proves it fires (and, ideally, that it does not false-positive).

A rule that reads a live server or repo must never throw; the engine wraps each
`check()` in try/catch, but return `[]` on anything you cannot assess rather than
guessing.

## Principles

- **A number you cannot defend is worse than no number.** Estimates are labeled;
  the method is in `docs/METHODOLOGY.md`.
- efaimo is a linter and cost profiler, **not a security scanner**. Injection
  checks are heuristics and say so.
- Heuristic (source-pattern) findings must say "verify manually"; live-probe
  findings reflect what the server actually did.

## Commits and PRs

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`). CI runs typecheck,
build, tests, dogfood, and a live smoke on Ubuntu and Windows across Node 22/24, green before review.
