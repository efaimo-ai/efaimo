<p align="center">
  <img src="assets/banner.png" alt="efaimo. The linter for Agent Skills and MCP servers." width="820">
</p>

<p align="center">
  <a href="https://github.com/efaimo-ai/efaimo/actions/workflows/ci.yml"><img src="https://github.com/efaimo-ai/efaimo/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="https://www.npmjs.com/package/efaimo"><img src="https://img.shields.io/npm/v/efaimo.svg?color=57E7D6&label=npm" alt="npm"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="node >= 22">
</p>

<p align="center">
  <b>efaimo</b> is the quality linter for <b>Agent Skills</b> and <b>MCP servers</b>.<br>
  Lint what triggers, weigh what it costs, before it reaches your context window.
</p>

Agent Skills are exploding, and nobody lints them. A skill's description is how it
triggers; its body loads into context every time it fires; and curated skills still
lower task completion a fraction of the time ([SkillsBench](https://www.skillsbench.ai)
measured 16 of 84 doing exactly that). The most popular skill installer ships no
quality gate at all. efaimo is that gate. It also weighs the token cost and audits
the 2026-07-28 readiness of your MCP servers, the more mature half of the tool.

## Agent Skills

```bash
npx efaimo check --skill ./skills/
```

Point it at one skill or a whole folder. It validates each skill against the
[agentskills.io](https://agentskills.io) spec and grades it:

```text
check skill  claude-api
grade C (71)   1 error  2 warnings  4 info

  x S101  description is 1068 chars (spec max 1024)
  ! S104  instructions are ~18.4k tokens (spec recommends staying under 5k)
          fix: move detail into references/ files loaded on demand
  ! S104  SKILL.md is 570 lines (spec recommends under 500)
  i S104  metadata level is ~294 tokens; the spec targets ~100 (loads every session)
```

*(That is Anthropic's own `claude-api` skill.)* efaimo checks frontmatter and
trigger quality, collisions across an installed set, the context budget (metadata
loaded every session, body loaded on trigger), reference integrity, and injection
hygiene. Run it on a folder and every skill gets its own grade, not one aggregate.

**We graded the 36 most popular public Agent Skills.** 92% score an A, but even a
curated set has real issues: the 8% that miss an A (including Anthropic's own
`claude-api`, a C) carry an over-limit description or bloated instructions, and the
median skill's instructions run ~1,700 tokens loaded on every trigger. Full report
and method: [the Skills Quality Index](./research/skills-index/REPORT.md). Reproduce
any row with one command.

### Does the skill actually help? (experimental)

Linting tells you a skill is well-formed. It does not tell you the skill makes the
agent *better*, and research shows some skills make it worse. `efaimo test` measures
that directly: it runs a task with and without the skill, N trials each, and an LLM
judge scores every attempt.

```bash
npx efaimo test scenario.yaml                 # dry run: validate + show the plan, no API calls
npx efaimo test scenario.yaml --live          # run it for real (Claude or GPT)
npx efaimo test scenario.yaml --live --model gpt-4o-mini
```

Works with Claude (`ANTHROPIC_API_KEY`) or GPT (`OPENAI_API_KEY`) models; the
provider is picked from the model name. Put the key in your shell or a local
`.env` file (copy `.env.example`); a real shell variable always wins.

Two real runs (claude-sonnet-5, 8 trials each) show why this matters. First, a
generic csv-cleanup skill that a capable model does not need:

```text
test  csv-cleanup helps on a messy CSV
  with skill     8/8 pass  (100%)
  without skill  8/8 pass  (100%)
  delta          +0 points   no measurable effect
```

Then a skill that encodes a convention the model cannot guess:

```text
test  contoso-crm-import helps on an unknowable format
  with skill     8/8 pass  (100%)
  without skill  0/8 pass  (0%)
  delta          +100 points   helps
```

Both skills lint clean; their value is opposite. The first is pure context
overhead, the second earns its tokens, and linting cannot tell them apart. `efaimo
test` can. Experimental and probabilistic: raise the trial count for confidence,
and treat small deltas as noise. It is opt-in because a live run spends tokens on
your key. See [examples/scenario.example.yaml](./examples/scenario.example.yaml)
and [examples/scenario.crm.yaml](./examples/scenario.crm.yaml).

## MCP servers

```bash
npx efaimo weigh "npx -y my-mcp-server"      # what does it cost my context window?
npx efaimo check --mcp "npx -y my-server"    # quality + 2026-07-28 readiness
```

`weigh` reports the token cost of tool definitions in three real serializations,
per tool, with an optional `--anthropic` exact Claude count.

<p align="center">
  <img src="assets/demo.png" alt="efaimo weigh example output" width="720">
</p>

`check --mcp` connects live and, rather than a yes/no verdict, gives you a
**migration diff** for the 2026-07-28 stateless spec (which removes `initialize`,
sessions, Sampling, Roots, and Logging, and requires `server/discover`,
`resultType`, and cache fields): exactly what will break and how to fix it, each
rule naming the SEP it came from. Full list: [docs/RULES.md](./docs/RULES.md).

## From an agent

`efaimo mcp` runs efaimo as a small, read-only MCP server, so an agent can lint or
weigh a skill mid-session, before it commits it to context:

```bash
npx efaimo mcp      # stdio server exposing efaimo_check_skill and efaimo_weigh_skill
```

It reads files only (it spawns no process and opens no socket), and the
token-spending `test` is not exposed. Client config and recipes are in
[docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md).

## How it works

efaimo sits between your agent and everything it loads, measures the cost the way
your host actually serializes it, and grades the quality, before any of it reaches
your context window.

<p align="center">
  <img src="assets/architecture.png" alt="efaimo weighs and checks what your agent loads" width="880">
</p>

## How it compares

Focused tools already own pieces of this space; efaimo is the one that covers Agent
Skills and frames MCP readiness as an actionable diff. As of mid-2026:

| | efaimo | mcp-xray | mcp-spec-check |
|---|---|---|---|
| Agent Skills linting | yes | no | no |
| Skill A/B outcome test | yes (experimental) | no | no |
| MCP tool-definition cost | yes (3 serializations, `--anthropic` exact) | yes (graded) | no |
| 2026-07-28 readiness | as a migration diff: what breaks and how to fix | no | as a yes/no verdict |
| CI budget gate + badge | yes | no | no |

efaimo complements the security scanners (Snyk agent-scan) and the skills installer
(`npx skills`) rather than replacing them.

## Install

Nothing to install. Use `npx`:

```bash
npx efaimo check --skill ./skills/
```

Or add it to a project with `npm i -D efaimo`, or the GitHub Action:

```yaml
- uses: efaimo-ai/efaimo@v0
  with:
    command: check --skill ./skills --strict
```

Gate a pull request on context-window growth, too:

```bash
npx efaimo weigh "npx -y my-server" --out base.json          # record a baseline
npx efaimo weigh "npx -y my-server" --diff base.json --allow-increase 10
```

`--badge badge.svg` writes an SVG plus a shields.io endpoint JSON for your README.
More recipes (pre-commit, GitLab, editor audit, programmatic use):
[docs/INTEGRATIONS.md](./docs/INTEGRATIONS.md).

## Rules at a glance

| family | covers |
|---|---|
| **S101 to S106** | skills: frontmatter and trigger quality, trigger collisions, context budget, reference integrity, injection hygiene |
| **E101 to E118** | MCP 2026-07-28 readiness: deprecated primitives, statelessness, `server/discover`, `resultType`, cache fields, transport |
| **E121 to E130** | MCP quality: description quality, annotations, schema hygiene, tool-count and token-cost budgets |

Every finding carries a stable id you can suppress or link. See [docs/RULES.md](./docs/RULES.md).

## Roadmap

- Harden `efaimo test` with judge calibration and variance reporting, so this
  experimental harness earns the confidence to become the tool's differentiator.
- A public, continuously updated Agent Skills Quality Index over a broad corpus.

## Stability

efaimo is 0.x. The commands are stable, but the rule set, grades, and exact output
may change between minor versions until 1.0; pin a version in CI if you need
reproducible thresholds. Every finding keeps a stable id.

## Honest scope

efaimo is a linter and cost profiler, not a security scanner. Its injection checks
are info-level heuristics that an attacker evades trivially; a clean report is not a
security pass. For supply-chain safety use a dedicated scanner such as Snyk
agent-scan. Token figures are estimates unless you opt into `--anthropic`; the
method and its known bias are in [docs/METHODOLOGY.md](./docs/METHODOLOGY.md).

## About

Built by [efaimo ai](https://efaimo.ai), open tooling for the space between hosts
and tools. `efaimo` is the flagship CLI; capabilities grow as subcommands under one
name. Apache-2.0. See [CONTRIBUTING.md](./CONTRIBUTING.md) and
[docs/RULES.md](./docs/RULES.md) to add a rule.
