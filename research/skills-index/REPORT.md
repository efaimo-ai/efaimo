# The Agent Skills Quality Index

Every public Agent Skill in the corpus, graded by [efaimo](https://github.com/efaimo-ai/efaimo) `check --skill`. Corpus: 36 skills.

## Corpus

Every `SKILL.md` in these repositories at these exact commits. Reproduce: `node scripts/skills-corpus.mjs <dir> research/skills-index/manifest.json` fetches the identical corpus (the manifest pins the commits below), then `node scripts/skills-index.mjs <dir>` regenerates this report:

| source | repository | commit |
|---|---|---|
| anthropics-skills | https://github.com/anthropics/skills | `fa0fa64bdc96` |
| anthropics-claude-cookbooks | https://github.com/anthropics/claude-cookbooks | `67ce644d33e5` |
| obra-superpowers | https://github.com/obra/superpowers | `d884ae04edeb` |

## Headline

- **97% score an A**, but **3% carry at least one error-level finding**.
- The **median skill's instructions are ~1,673 tokens** (the spec recommends staying under 5,000), loaded whenever the skill triggers.
- Median always-on metadata: ~39 tokens per skill, loaded at session start for every installed skill.

## Grade distribution

| grade | count | share |
|---|---|---|
| A | 35 | 97% |
| B | 0 | 0% |
| C | 1 | 3% |
| D | 0 | 0% |
| F | 0 | 0% |

## Most common findings

| rule | skills affected |
|---|---|
| S104 | 6 (17%) |
| S106 | 5 (14%) |
| S101 | 2 (6%) |
| S105 | 2 (6%) |
| S102 | 1 (3%) |

## Lowest-graded skills

| skill | source | grade | errors | warnings | info |
|---|---|---|---|---|---|
| `claude-api` | anthropics-skills | C (71) | 1 | 2 | 4 |
| `writing-skills` | obra-superpowers | A (90) | 0 | 2 | 0 |
| `pptx` | anthropics-skills | A (94) | 0 | 1 | 1 |
| `subagent-driven-development` | obra-superpowers | A (95) | 0 | 1 | 0 |
| `template-skill` | anthropics-skills | A (95) | 0 | 1 | 0 |
| `skill-creator` | anthropics-skills | A (95) | 0 | 1 | 0 |
| `mcp-builder` | anthropics-skills | A (96) | 0 | 0 | 4 |
| `xlsx` | anthropics-skills | A (99) | 0 | 0 | 1 |
| `doc-coauthoring` | anthropics-skills | A (99) | 0 | 0 | 1 |
| `algorithmic-art` | anthropics-skills | A (99) | 0 | 0 | 1 |
| `applying-brand-guidelines` | anthropics-claude-cookbooks | A (99) | 0 | 0 | 1 |
| `cookbook-audit` | anthropics-claude-cookbooks | A (99) | 0 | 0 | 1 |

## Full corpus

<details><summary>Every graded skill</summary>

| skill | source | grade |
|---|---|---|
| `algorithmic-art` | anthropics-skills | A (99) |
| `analyzing-financial-statements` | anthropics-claude-cookbooks | A (100) |
| `applying-brand-guidelines` | anthropics-claude-cookbooks | A (99) |
| `brainstorming` | obra-superpowers | A (100) |
| `brand-guidelines` | anthropics-skills | A (100) |
| `canvas-design` | anthropics-skills | A (100) |
| `claude-api` | anthropics-skills | C (71) |
| `cookbook-audit` | anthropics-claude-cookbooks | A (99) |
| `creating-financial-models` | anthropics-claude-cookbooks | A (100) |
| `dispatching-parallel-agents` | obra-superpowers | A (100) |
| `doc-coauthoring` | anthropics-skills | A (99) |
| `docx` | anthropics-skills | A (100) |
| `executing-plans` | obra-superpowers | A (100) |
| `finishing-a-development-branch` | obra-superpowers | A (100) |
| `frontend-design` | anthropics-skills | A (100) |
| `internal-comms` | anthropics-skills | A (100) |
| `mcp-builder` | anthropics-skills | A (96) |
| `pdf` | anthropics-skills | A (100) |
| `pptx` | anthropics-skills | A (94) |
| `receiving-code-review` | obra-superpowers | A (100) |
| `requesting-code-review` | obra-superpowers | A (100) |
| `skill-creator` | anthropics-skills | A (95) |
| `slack-gif-creator` | anthropics-skills | A (100) |
| `subagent-driven-development` | obra-superpowers | A (95) |
| `systematic-debugging` | obra-superpowers | A (100) |
| `template-skill` | anthropics-skills | A (95) |
| `test-driven-development` | obra-superpowers | A (100) |
| `theme-factory` | anthropics-skills | A (100) |
| `using-git-worktrees` | obra-superpowers | A (100) |
| `using-superpowers` | obra-superpowers | A (100) |
| `verification-before-completion` | obra-superpowers | A (100) |
| `web-artifacts-builder` | anthropics-skills | A (100) |
| `webapp-testing` | anthropics-skills | A (100) |
| `writing-plans` | obra-superpowers | A (100) |
| `writing-skills` | obra-superpowers | A (90) |
| `xlsx` | anthropics-skills | A (99) |

</details>

<sub>Reproduce a row: `npx efaimo check --skill <skill-dir>`. Corpus and method are open; this is a lint-quality signal, not a security audit.</sub>
