# Integrating efaimo

efaimo is a plain CLI, so it drops into anything that can run a command. This is the
practical guide, from local dev to CI to calling it from an agent.

## Local: pre-commit

Stop a broken skill before it lands. `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: efaimo-skills
        name: efaimo check --skill
        entry: npx efaimo check --skill ./skills --strict
        language: system
        pass_filenames: false
        files: ^skills/.*SKILL\.md$
```

## CI: GitHub Actions

Fail the build on skill regressions or a context-budget blowout.

```yaml
- uses: efaimo-ai/efaimo@v0
  with:
    command: check --skill ./skills --strict
```

Ratchet MCP tool-definition cost with the budget gate (commit `base.json` once with
`npx efaimo weigh "npx -y your-server" --out base.json`):

```yaml
- run: npx efaimo weigh "npx -y your-server" --diff base.json --allow-increase 10
```

Post the grade on the PR with `--md` (pipe into any comment action):

```yaml
- run: npx efaimo check --skill ./skills --md >> "$GITHUB_STEP_SUMMARY"
```

## CI: GitLab

```yaml
efaimo:
  image: node:24
  script:
    - npx efaimo check --skill ./skills --strict
    - npx efaimo weigh "npx -y your-server" --diff base.json --allow-increase 10
```

## Audit what an editor already loads

efaimo reads the MCP config of the tools you already use and weighs everything they
load, so you can see the context tax before you open a chat:

```bash
npx efaimo weigh --client claude-code      # also: claude-desktop, cursor, vscode
```

## Use it as an Agent Skill

efaimo ships a `SKILL.md`, so an agent that supports Agent Skills can install it and
run the checks itself:

```bash
npx skills add efaimo-ai/efaimo
```

The skill is a thin trigger; the `npx efaimo` binary does the work. It pairs with
`skills validate` (metadata) as the deeper tier (quality, cost, collisions, and the
`test` A/B harness): `npx skills validate ./skill && npx efaimo check --skill ./skill`.

## Cursor / VS Code / Windsurf

Any editor that runs tasks can run efaimo. Add a task or a keybinding to
`npx efaimo check --skill ${workspaceFolder}/skills`, and use `weigh --client cursor`
(or `vscode`) to audit the MCP servers that editor loads.

## Calling efaimo from an agent (efaimo mcp)

`efaimo mcp` runs efaimo as a small, read-only MCP server over stdio. It exposes two
tools, `efaimo_check_skill` and `efaimo_weigh_skill`, so an agent can lint or weigh a
skill mid-session, before it commits it to context. The tools read files only: they
spawn no process, open no socket, and `test` (which spends tokens) is not exposed, so
the server is safe to call unattended.

Add it to a client config (Claude Desktop, Claude Code, Cursor, ...):

```json
{
  "mcpServers": {
    "efaimo": { "command": "npx", "args": ["-y", "efaimo", "mcp"] }
  }
}
```

Both tools take a `path` to a SKILL.md or a folder of skills and return Markdown.

efaimo holds its own server to the same bar. `efaimo check --mcp "npx -y efaimo mcp"`
grades it a quality A with a three-item 2026-07-28 migration diff: a fully
stateless server wants the 2.x MCP SDK for `server/discover`, cache fields, and
`resultType`. That SDK upgrade is the roadmap item; the server is useful today on
the current SDK.

## Programmatic use

Every capability is also a typed function:

```ts
import { weighServer, introspectServer, checkSkillSet } from "efaimo";

const intro = await introspectServer({ kind: "stdio", command: "npx", args: ["-y", "my-server"], label: "my-server" });
const cost = await weighServer(intro);
console.log(cost.totals.claudeStyle);
```
