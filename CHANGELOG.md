# Changelog

All notable changes to efaimo are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.1.1] - unreleased

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
  only suppresses colours efaimo adds.
- `.env` loading is restricted to `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
  It previously set ANY key from a working-directory `.env`, so a cloned
  repository could set `NODE_TLS_REJECT_UNAUTHORIZED=0` and silently disable
  certificate verification for later HTTPS calls, including ones carrying your
  key.
- Skill references that resolve outside the skill directory are no longer read
  by `weigh`. S106 already warned about them, but only after the read.
- `SKILL.md` is read through the same 512KB-class cap as referenced files
  (2MB), instead of an uncapped read.
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

[0.1.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.1.0
