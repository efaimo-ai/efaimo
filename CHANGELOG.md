# Changelog

All notable changes to efaimo are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

The MCP specification published on 2026-07-28. The readiness rules had been
written against the Release Candidate locked 2026-05-21, and the two are not
the same document: `DiscoverResult.serverInfo` was deleted, `DiscoverResult`
became cacheable, and three error codes were renumbered.

### Added

- `npm run spec:drift`, plus a daily `spec-drift` workflow: fails when an MCP
  revision newer than the one efaimo targets publishes, or when the targeted
  revision changes under its own tag. The 2026-07-28 publication went unnoticed
  in this repo for four days because nothing watched the spec itself.

### Changed

- `check --conformance` pins `@modelcontextprotocol/conformance@0.2.0-alpha.10`
  rather than the floating `alpha` tag, which had moved off `alpha.9` on
  2026-07-27. A dist-tag is not a pin, and the old one meant reporting "the
  official conformance suite" for a build nobody here had run.
- Readiness output no longer claims the spec "finalizes 2026-07-28". It has
  published; the diff still prints ungraded.
- Rule detail lines name the revision by its date instead of calling it "the
  RC", which it no longer is.

### Fixed

- `check --mcp` and `weigh` lost server identity on servers that had finished
  migrating. The published spec deleted `DiscoverResult.serverInfo` and moved
  identity into `_meta["io.modelcontextprotocol/serverInfo"]`, and efaimo read
  only the Release Candidate's field. Both shapes are read now, newest first.
- E118 measured cache fields on `tools/list` only, while its own detail line
  already listed `server/discover`. The published spec made `DiscoverResult`
  extend `CacheableResult`, so that surface is required now, is measured now,
  and the message names whichever surface failed.

## [0.1.0]

First release.

### Added

- `efaimo weigh`: context-window cost of MCP tool definitions (stdio, remote, or a
  whole client config) and of Agent Skills, in three serializations, with an
  optional `--anthropic` exact Claude count. Per-tool numbers plus an explicit
  block-framing line reconcile exactly with the total. In a multi-server run a
  broken or auth-gated server is skipped with a reason, not fatal.
  `--out`/`--diff`/`--max-tokens`/`--allow-increase` for CI budget gates,
  `--badge` for a shields endpoint.
- `efaimo check --mcp`: a quality grade (E121-E130: descriptions, schemas,
  annotations, cost) plus a separate, ungraded 2026-07-28 migration diff
  (E101-E118: what the stateless spec breaks and how to fix it, each item naming
  its SEP). Speaks both the legacy handshake and bare stateless requests, so
  2026-07-28 servers audit fine. Optional `--repo` source scan and
  `--conformance` passthrough to the official suite.
- `efaimo check --skill`: Agent Skills linter against the agentskills.io spec
  (S101-S106): frontmatter and trigger quality, trigger collisions, context budget,
  reference integrity, injection heuristics. Per-skill grading over a directory, and
  a reproducible Skills Quality Index (`scripts/skills-corpus.mjs` pins the corpus
  to exact commits; `scripts/skills-index.mjs` grades it).
- `efaimo test` (experimental): an A/B outcome harness that measures whether a skill
  actually improves task completion. Dry-run by default (validates the scenario, no
  API calls); `--live` runs against the Anthropic or OpenAI API, and it fails clearly
  on an unsupported model provider.
- `efaimo mcp`: a small, read-only MCP server exposing `efaimo_check_skill` and
  `efaimo_weigh_skill`, so an agent can lint or weigh a skill mid-session. Reads
  files only; `test` is not exposed; tools are annotated read-only.
- `.env` loading for the commands that need a key (`test --live`,
  `weigh --anthropic`); a real shell variable always wins. See `.env.example`.
- Reporters: pretty, JSON, Markdown, SVG badge. GitHub Action (`action.yml`).
  Documented rule set (`docs/RULES.md`), token methodology (`docs/METHODOLOGY.md`),
  and integration guide (`docs/INTEGRATIONS.md`).

[Unreleased]: https://github.com/efaimo-ai/efaimo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.1.0
