# The Agent Skills Quality Index

Every public Agent Skill in the corpus, graded by [efaimo](https://github.com/efaimo-ai/efaimo) `check --skill`. Corpus: 36 skills.

## Headline

- **92% score an A**, but **6% carry at least one error-level finding**.
- The **median skill's instructions are ~1,718 tokens** (the spec recommends staying under 5,000), loaded whenever the skill triggers.
- Median always-on metadata: ~39 tokens per skill, loaded at session start for every installed skill.

## Grade distribution

| grade | count | share |
|---|---|---|
| A | 33 | 92% |
| B | 2 | 6% |
| C | 1 | 3% |
| D | 0 | 0% |
| F | 0 | 0% |

## Most common findings

| rule | skills affected |
|---|---|
| S104 | 6 (17%) |
| S106 | 6 (17%) |
| S105 | 3 (8%) |
| S101 | 2 (6%) |
| S102 | 1 (3%) |

## Lowest-graded skills

| skill | source | grade | errors | warnings | info |
|---|---|---|---|---|---|
| `claude-api` | anthropics-skills | C (71) | 1 | 2 | 4 |
| `template-skill` | anthropics-skills | B (85) | 1 | 0 | 0 |
| `docx` | anthropics-skills | B (88) | 0 | 2 | 2 |
| `writing-skills` | obra-superpowers | A (90) | 0 | 2 | 0 |
| `subagent-driven-development` | obra-superpowers | A (95) | 0 | 1 | 0 |
| `skill-creator` | anthropics-skills | A (95) | 0 | 1 | 0 |
| `mcp-builder` | anthropics-skills | A (96) | 0 | 0 | 4 |
| `xlsx` | anthropics-skills | A (99) | 0 | 0 | 1 |
| `pptx` | anthropics-skills | A (99) | 0 | 0 | 1 |
| `doc-coauthoring` | anthropics-skills | A (99) | 0 | 0 | 1 |
| `algorithmic-art` | anthropics-skills | A (99) | 0 | 0 | 1 |
| `applying-brand-guidelines` | anthropics-claude-cookbooks | A (99) | 0 | 0 | 1 |

<sub>Reproduce: `npx efaimo check --skill <skill>`. Corpus and method are open; this is a lint-quality signal, not a security audit.</sub>
