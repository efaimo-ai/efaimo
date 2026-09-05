# Changelog

All notable changes to efaimo are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased] 0.6.0

Everything in this section is **(unreleased)**: it exists on `main` and not in
what `npx efaimo` installs. These annotations come off in the commit BEFORE the
tag, never in the tag commit, because registries render the tagged tree.

### Added

- **S108: a reference file nothing points at** _(unreleased)_. A file under
  `references/` that no markdown link or backticked path resolves to, whose
  path never appears in `SKILL.md`, whose directory is never named there, and
  that no reference file which IS reached mentions either. It ships in the
  package, installs byte-perfect, and an agent has no route to it.

  Found in this project's own skills on 2026-09-04: `read-back` had shipped a
  4.6 KB failure gallery that grew for a month with nothing linking to it, and
  `unreleased-guard` had shipped `the-gap.md` the same way. The installer
  tests, the house style guard and an A(100) were all green, because none of
  them is about whether a shipped file is reachable. The workspace that
  publishes those skills got a checker the same day; this is the rule for
  everyone else's `references/`.

  Reported and **not scored**, the way S105 is. Measured before it was
  written, on the public corpus at the commits `research/skills-index/manifest.json`
  pins: 2 of 36 skills carry a `references/` directory at all, 4 files between
  them, no orphan, so there is no population to calibrate a penalty on and no
  published grade moves. Scoring it is a separate decision. It fires under
  `--strict`, which is where our own seven repositories run it.

  Transitive on purpose: a reader who opens `references/api.md` can follow a
  link inside it, so a file reached that way is not an orphan. Scoped to
  `references/` on purpose: `scripts/` is executed rather than read and
  `assets/` is consumed by scripts, so an unmentioned file there is a
  different claim.

### Changed

- **`rulesVersion` is `3`** _(unreleased)_. No grade moves with S108, but a
  report from this ruleset carries a rule id that ruleset `2` could not have
  produced, and `check --diff` across the two would attribute that to the
  subject rather than to the ruler.

## [0.5.0] - 2026-09-04

### Changed

- **`efaimo mcp` is built on the 2.x SDK line and now satisfies the
  specification this tool audits other servers against.** The 1.x line speaks
  2025-11-25; it cannot answer `server/discover` and cannot carry the SEP-2549
  cache fields, so the one MCP server this project ships failed two MUST-level
  items of the 2026-07-28 revision, and `check --mcp` said so about it on every
  run. The skill this project publishes about that migration opens with "upgrade
  the SDK first". This is that.

  Measured against the built server, before and after, with the same command:

  ```
  before   2026-07-28 readiness  3 items to migrate   E106, E118, E107
  after    2026-07-28 readiness  clean, nothing to migrate
  ```

  Read off the wire rather than from our own tool as well: a modern opening now
  answers `server/discover` with `supportedVersions`, `capabilities`,
  `resultType: "complete"`, `ttlMs` and `cacheScope`, and `tools/list` carries
  the same three fields. A 2025-era client that opens with `initialize` is still
  served, unchanged, because `serveStdio` pins the era per connection rather
  than making the server pick one.

- **The client half moved with it**, from `@modelcontextprotocol/sdk` to
  `@modelcontextprotocol/client`. Doing only the server half would have left
  both generations installed, and E101 stops firing the moment any 2.x package
  is present, so the half-migration would have silenced the rule that was
  telling the truth.

### Fixed

- **Two moderate advisories, by subtraction.** `qs` arrived through
  `body-parser` through `express` through the 1.x SDK, which pulls a whole HTTP
  and OAuth stack that a stdio server never speaks. `pnpm audit --prod` now
  reports no known vulnerabilities, and production dependencies went from 30 to
  13.

### Notes

- No rule changed, so no grade moved. `rulesVersion` is untouched and the
  published skills index does not need regenerating.
- `check --skill`, `weigh`, `find` and `test` are byte-identical in behaviour;
  the only thing that moved is what `efaimo mcp` puts on the wire.

## [0.4.0] - 2026-09-03

### Fixed

- **`check --skill <dir>` finds skills it used to walk past**.
  Two causes, both silent. The walk never entered a directory whose name starts
  with a dot, so `.claude/skills/<name>/`, which is where a project keeps its
  own skills, was invisible; and its depth bound of 3 missed layouts one level
  deeper such as `skills/custom_skills/<name>/`. On the public corpus this
  found 34 skills where `scripts/skills-index.mjs` found 38, and both numbers
  were reported with confidence.

  Dot directories are now entered for skill discovery and nowhere else, with
  `.git` still excluded. The depth bound is 6 and is measured rather than
  picked: the deepest real skill in that corpus sits 4 directories below a
  directory of repositories and 3 below a repository root, so six leaves two
  levels of headroom while still keeping an accidental `check --skill /` from
  walking a disk.

  **And when the bound does bite, it says so.** `SkillSet.truncatedAt` lists
  the directories the walk refused to enter, because a bound that truncates in
  silence is the same failure as a check that examines nothing. On the public
  corpus it fires 16 times, all of them XML schema trees inside the `xlsx` and
  `pptx` skills, which is the bound doing its job audibly.

- **One walker instead of two**. `scripts/skills-index.mjs`
  carried its own copy with different rules, which is why the two disagreed.
  It now calls the CLI's discovery, so they cannot drift apart again, and it
  passes the truncation warning through. The published July index regenerates
  byte-identically under the shared walk, which is how this was checked.

### Added

- **S107: a filename one capitalisation away from a skill**.
  Set-level and warn-level, so it moves no grade, in the same way S103 treats
  a collision that belongs to a pair rather than to either member.

  The spec names `SKILL.md` exactly and discovery matches it exactly, so
  `skill.md` is not a skill here on any platform. It is not nothing anywhere:
  a case-insensitive filesystem, the default on macOS and Windows, may hand it
  to a host that opens it by name, so the same repository can carry a working
  skill on the author's laptop and no skill at all in Linux CI. Nothing in
  this tool would previously have mentioned such a file, which is the worst
  property a near miss can have. Five exist in the public corpus.

## [0.3.0] - 2026-09-03

### Added

- **`check --out` and `check --diff`**: what moved between two
  audits of the same subject. Same grammar as `weigh --out` / `weigh --diff`,
  which is why it is a flag rather than a sixth subcommand. Nothing published
  says whether skills and MCP servers are getting heavier or whether their
  quality holds, because that needs the same thing measured twice and nothing
  made the comparison cheap.

  A delta is exactly the shape a broken measurement takes, so the controls a
  careful person would run by hand are enforced instead of documented:

  - **Rules drift is a hard stop.** Different `rulesVersion` between the two
    runs means a moved grade cannot be attributed to the subject, because the
    ruler moved too. `--allow-rules-drift` proceeds and marks
    every grade line unattributable.
  - **An empty pairing fails.** Nothing in common is two reports about
    different subjects, not "no change".
  - **The three token costs are never summed.** Metadata is carried
    permanently, the body loads on trigger, referenced files load on demand;
    one combined percentage would describe none of them.
  - **A dominant mover is named beside its total**, because when one subject is
    most of a change, the total is about that subject and not the population.

  `--fail-on-regression` exits 1 when any subject present in
  both runs scored lower.

  Measured on the public skills corpus, 2026-07-17 pinned against 2026-09-03
  HEAD, same ruleset both sides, over the **32 skills `check --skill` pairs**:
  metadata -0.8%, body +7.5%, referenced files +61.4% with one skill at 96.5%
  of that movement; grades 0 improved and 4 worsened.

  The population matters and is worth stating, because
  `research/skills-delta-2026-09-03/REPORT.md` reports body **+7.0%** over
  **36** paired skills for the same corpus on the same dates. Both are true.
  `scripts/skills-index.mjs` finds four skills that `check --skill` does not,
  for the walker reason in Known below, so the two are measuring slightly
  different populations. Every other figure is identical between them; the
  body percentage is the one the four missing skills move.

- **`efaimo find` takes several servers**. Pass more than one
  and their catalogs are merged into one and measured together, each tool
  labelled with where it came from. A flag-shaped change rather than a new
  subcommand, because the engine already took a flat tool array and only the
  CLI surface was single-target.

  The reason it is worth having: a server's author keeps their own tool names
  apart as a matter of course, nobody coordinates across the several servers a
  person actually installs, and the model sees one flat list with no
  indication of origin. A single-server run is structurally unable to see the
  collision that actually bites.

  The origin is carried for the report and deliberately kept out of the index.
  Prefixing names with their server would hand every tool a term no other tool
  has, and a catalog of indistinguishable tools would score a perfect 100.
  There is a test for exactly that, and it had to be rewritten once: its first
  origin labels were "server-one" and "server-two", whose only surviving token
  is "server" for both, so the sabotage it existed to catch passed.

  Measured live on `server-everything@2026.7.4` plus `@playwright/mcp@0.0.78`:
  37 tools merged, 35 distinct (94.6%). No cross-server collision between
  those two, which is the right answer for a filesystem server and a browser
  server, and the two tools owning nothing are playwright's own already
  documented `browser_close` and `browser_navigate`.

### Fixed

- **S102 no longer passes filler**. The rule read
  `description.length < 20` and then asked only whether one of four trigger
  words appeared anywhere, so `Useful for various tasks.` scored a clean
  A (100) in silence because "for" sits inside "for various tasks". It was
  testing for the presence of a trigger WORD rather than for the presence of a
  trigger. A skill whose whole body was one sentence also scored 100.

  Two floors replace it, both grounded on the 38 public skills in
  `research/skills-index/manifest.json` measured 2026-09-03, where the shortest
  real description is 68 characters and the thinnest carries 4 distinct content
  terms: under 40 characters, or fewer than 4 distinct terms surviving the
  stopword list, is a warning. The second is the same measurement `find` makes
  on tool catalogs, since a description with no distinguishing content cannot
  be matched to a task whatever words it contains.

  Impact on the corpus: none. The 38 skills produce zero S102 findings before
  and after, and the grade distribution is unchanged. This was found by
  sabotaging the grader while reviewing two new skills, not by a report.

  Note that this changes grades in principle, so it is deliberately sequenced
  after the 2026-09-03 delta measurement, whose reproduction is pinned to
  `v0.2.0`.

### Known

- **`check --skill <dir>` does not find every skill under a tree**
  _(present in 0.2.0 as well)_. It walks
  `<root>/<name>/SKILL.md` and `<root>/skills/<name>/SKILL.md` but misses skills
  inside a dot directory (`.claude/skills/<name>/`) and skills one level deeper
  (`skills/custom_skills/<name>/`). On the corpus above it found 34 where
  `scripts/skills-index.mjs` found 38, all four in the same repository. Two of
  this tool's own walkers disagreeing about the same tree is a defect whichever
  is right; a `--diff` built on the narrower walk silently compares an
  incomplete population. Not fixed here because the fix is a design decision
  about depth and dot directories, separate from this change.

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

[0.5.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.5.0
[0.4.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.4.0
[0.3.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.3.0
[0.2.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.2.0
[0.1.2]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.1.2
[0.1.1]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.1.1
[0.1.0]: https://github.com/efaimo-ai/efaimo/releases/tag/v0.1.0
