# Changelog

All notable changes to efaimo are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-02

### Added

- **`efaimo find`**: does anything actually surface these tools? A host can
  mark tools `defer_loading: true`, which keeps their definitions out of the
  context window until a search returns them, and Anthropic recommends that
  once definitions pass ~10k tokens. Under deferral a tool nothing surfaces
  costs no context and provides no capability. Two numbers, offline and
  deterministic, no API key:
  - `distinct`, the headline: how many tools own a term no other tool in the
    catalog has. A tool with none cannot be matched by any query that does not
    also match a competitor, which follows from the index rather than from a
    model of how anyone searches. Measured on `@playwright/mcp` 0.0.78: 22 of
    24, with `browser_close` and `browser_navigate` owning nothing.
  - `probe`, secondary and labelled: a simulated BM25 search over the four
    fields the tool search documentation names as searchable. It reads 100% on
    both the official reference server and playwright, so the output says on
    the page that it is a floor test and not a ranking.
  - New ungraded rule family E141-E145, `--min-distinct` as the CI gate,
    `--top` to change the simulated result window, `--json` / `--md`.
    Reasoning in ADR-030; method and its limits in docs/METHODOLOGY.md.
- `rulesVersion` in every JSON envelope, because the tool version does not
  identify a ruleset: a patch release can change what a rule fires on, and a
  published grade is only reproducible next to the rules that produced it. The
  rule inventory is pinned by a test (ADR-032).
- `--judge-model` and scenario key `judge_model` for `efaimo test`, so the
  model under test no longer has to grade its own answers. Subject and judge
  are routed independently and may be different providers.
- `--no-timestamp` on `weigh`, `check` and `find`.

### Fixed

- **`efaimo test --live` could not run on its own default model.** The runner
  sent `temperature` on every request, and Claude removed sampling parameters
  from the 4.7 line onward, so `claude-sonnet-5` rejected the first call with a
  400 that is correctly not retried. Sampling parameters now go only to models
  that still accept them, the request body is a pure function with a test
  against it, and where the judge cannot be pinned the report says so instead
  of implying a determinism it does not have. ADR-031.
- `efaimo test` reports a Fisher exact p on the **unparseable** counts as well
  as on the passes, and calls a run `inconclusive` when the excluded trials are
  skewed across the arms: two pass rates computed over different populations
  cannot be subtracted.
- `--anthropic` names the model it measured against, in the output and in the
  JSON. Claude model lines do not share a tokenizer, so a count without its
  model cannot be reproduced. This is the rule `--window` already followed for
  the context-window denominator.
- `weigh --out` no longer writes `generatedAt` into the baseline. A baseline
  exists to be compared against, and a field that differs on every write is the
  one field a comparison must ignore.

### Changed

- docs/RULES.md now cites Anthropic's tool search documentation for E125's
  lower threshold, which previously carried no source at all (the MCP quality
  table has never had a source column). The thresholds themselves are
  unchanged, and the citation covers the 30 boundary only: Anthropic writes
  that tool selection "degrades once you exceed 30-50 available tools", which
  says nothing about the 60 boundary, and the table says so.

## [0.1.2] - 2026-08-03

The 0.1.2 code backlog: edge-case fixes surfaced by the five-agent review, none
of which changes a published number or the documented command surface, plus the
security and CI hardening already staged.

### Fixed

- `check --mcp <directory>` with no source files and no MCP SDK dependency now
  fails instead of returning a clean A(100): an empty scan is a failure, never a
  pass.
- S101: a skill with no frontmatter reports its missing `name` and `description`
  as errors, so a total absence no longer grades higher than a broken one.
- E105: a server that exits on a bare stateless `tools/list` is flagged. The
  crash outcome was unhandled, so a crashing server looked more migrated than
  one that answers with a not-initialized error.
- E124: the "N of M parameters lack descriptions" summary is no longer dropped
  by the display cap on schemas with five or more oversized enums.
- S106: the escape check is lexical (the resolved path), not a `..` substring,
  so a file merely named `notes..md` is not flagged as escaping.
- A Poetry `mcp = "^2.0"` constraint in `pyproject.toml` is read as the 2.x
  line, not legacy; the version regex had captured the `=` assignment.
- `weigh --diff` with a skill baseline fails with a clear message instead of a
  raw TypeError; a server baseline is required.
- `--max-tokens` and `--allow-increase` reject non-positive / negative values
  instead of turning the gate into an always-fail with a nonsense message.
- `efaimo test --live` against an OpenAI o-series reasoning model no longer
  sends an unsupported `temperature` (a 400) and gives it token headroom.
- The live test harness retries a transient 429 or 5xx with backoff instead of
  discarding every already-paid trial on the first blip.
- The test report prints a clean note instead of "95% interval NaN to NaN" when
  an arm produces no scoreable trial.
- A dead stdio target fails in about one `--timeout`, not two: the legacy
  handshake and the stateless fallback now share the budget.
- Internal: dropped a dead exported constant and the unused per-pattern
  `severity` on the injection heuristics (every hit is info + ungraded by
  design).

### Security

- The lockfile was re-resolved so the dev/CI tree carries
  `@hono/node-server` 2.0.12 instead of the 1.19.x line that
  GHSA-frvp-7c67-39w9 covers (moderate, path traversal in `serve-static`, in
  the half of the MCP SDK this CLI never executes). A fresh `npx efaimo`
  install already resolved the patched line; this aligns the committed tree
  with what users actually get, and `pnpm audit --prod` is clean again.

### Changed

- `@modelcontextprotocol/sdk` floor moved within-range from ^1.29.0 to ^1.30.0
  (what a fresh install resolves anyway). The full suite (136 tests) is green.
- CI: the reference-server smoke is pinned to
  `@modelcontextprotocol/server-everything@2026.7.4`. Per-commit CI should be
  deterministic; news about the reference server's latest belongs to a
  scheduled run, not to a push.
- CI: `spec-drift.yml` and the example workflow now pin actions by commit SHA
  like the other workflows, and the example declares least-privilege
  `permissions`.

## [0.1.1] - 2026-08-02

Everything below was on `main` and unpublished. That gap was itself the
problem: `efaimo@0.1.0` still tells every user "the spec finalizes
2026-07-28" (a future tense about a date that has passed), the README
documents `--strict-readiness` and `--window`, and neither flag exists in
0.1.0. Cutting this release is what makes the documentation true.

The MCP specification published on 2026-07-28. The readiness rules here had
been written against the Release Candidate locked 2026-05-21, and the two are
not the same document: `DiscoverResult.serverInfo` was deleted,
`DiscoverResult` became cacheable, and three error codes were renumbered. The
entries below that name the published spec are the repairs, plus the tooling
that notices the next revision by itself.

### Security

- `--client` now prints the actual command of every server it is about to
  spawn, and warns by name when a config came from the CURRENT DIRECTORY
  rather than your user config. It reads `.mcp.json`, `.cursor/mcp.json` and
  `.vscode/mcp.json` from the working directory and executes what it finds, so
  running the audit inside a repository you cloned was arbitrary code
  execution, announced only by a friendly config key.
- Terminal control characters are stripped from anything the audited target
  supplied, at the render boundary of the pretty and markdown reporters. A
  hostile server could put ESC[1A ESC[2K in a tool name and rewrite the grade
  line printed above its own finding, so the reader saw "grade A (100), 0
  errors" while the contradiction was erased. `--no-color` did not help; that
  only suppresses colors efaimo adds.
- `.env` loading is restricted to `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
  It previously set ANY key from a working-directory `.env`, so a cloned
  repository could set `NODE_TLS_REJECT_UNAUTHORIZED=0` and silently disable
  certificate verification for later HTTPS calls, including ones carrying your
  key.
- Skill references that resolve outside the skill directory are no longer read
  by `weigh`. S106 already warned about them, but only after the read.
- `SKILL.md` is read through a capped read (2MB) on the same guarded path that
  caps referenced files at 512KB, instead of an uncapped read.
- The published composite Action no longer interpolates its inputs into a bash
  `run:` body, which was script injection in the consumer's runner.

### Added

- `check --strict-readiness`: exit non-zero when the 2026-07-28 migration diff
  is not clean. Readiness still never touches the grade or the badge, and the
  default exit code is unchanged. It exists because a team that had finished
  migrating had no way to stay migrated: `--strict` covers quality only, so
  nothing in CI could catch a regression back onto the legacy handshake.
- `--window <tokens>` on `weigh` and `check`: report the context-window share
  against a window you name instead of the 1,000,000-token default. Absolute
  token counts do not change; only the denominator does.
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

- `efaimo test` reports a two-sided Fisher exact p and a 95% interval, and
  `helps`/`hurts` require p < 0.05. The old rule was a +-15 point threshold at
  a default of 5 trials per arm, where 5/5 against 4/5 is +20 points and
  p = 1.0000. Judge now runs at temperature 0; an unparseable judge verdict is
  excluded rather than scored FAIL; default trials 5 -> 20.
- E123 fires. The matcher was `(delete|...)` and `_` is a word character,
  so `delete_file`, `deleteFile` and `drop_table` never matched: the rule was
  dead for every conventionally named tool.
- A rule that throws is reported as an ungraded E000 instead of being silently
  swallowed, which used to RAISE the grade.
- `weigh`'s heaviest-tools column derives its width from the rows printed, so
  a 30-character tool name no longer shifts the number column.
- The median in `scripts/skills-index.mjs` is the true median.
- `check --mcp` could hang forever on a stdio server. The readiness probes
  cleaned up their spawned servers only on the happy path, so a probe that threw
  left the child's stdin open; the child never saw EOF, never exited, and its
  stdio handles kept the CLI's event loop alive. The report printed and then the
  process simply never returned. Cleanup now runs in a `finally`, matching the
  stateless introspection path next door, which already did.
- `check --mcp` and `weigh` lost server identity on servers that had finished
  migrating. The published spec deleted `DiscoverResult.serverInfo` and moved
  identity into `_meta["io.modelcontextprotocol/serverInfo"]`, and efaimo read
  only the Release Candidate's field. Both shapes are read now, newest first.
- E118 measured cache fields on `tools/list` only, while its own detail line
  already listed `server/discover`. The published spec made `DiscoverResult`
  extend `CacheableResult`, so that surface is required now, is measured now,
  and the message names whichever surface failed.

## [0.1.0] - 2026-07-18

First release.

### Added

- `efaimo weigh`: context-window cost of MCP tool definitions (stdio, remote, or a
  whole client config) and of Agent Skills, in three serializations, with an
  optional `--anthropic` exact Claude count. Per-tool numbers plus an explicit
  block-framing line reconcile exactly with the total. In a multi-server run a
  broken or auth-gated server is skipped with a reason, not fatal.
  `--out`/`--diff`/`--max-tokens`/`--allow-increase` for CI budget gates,
  `--badge` for a shields endpoint.
- `efaimo check --mcp`: a quality grade (E121-E128, E130: descriptions, schemas,
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

[unreleased]: https://github.com/efaimo-ai/efaimo/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.2.0
[0.1.2]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.1.2
[0.1.1]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.1.1
[0.1.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.1.0
