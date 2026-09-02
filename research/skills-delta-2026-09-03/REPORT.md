# The Skills Quality Index, measured twice

[The Skills Quality Index](../skills-index/REPORT.md) is a photograph: 36 skills from three repositories, pinned at July commits. This is the same corpus measured again seven weeks later with the same tool and the same ruleset, so the difference is movement in the skills rather than movement in the instrument.

It exists because nobody publishes this. Skills and MCP servers are proliferating and there is no series anywhere saying whether they are getting heavier or whether their quality holds. Two pinned measurements of the same corpus is the smallest artifact that can answer it.

## Corpus

| source | repository | 2026-07-17 | 2026-09-03 |
|---|---|---|---|
| anthropics-skills | https://github.com/anthropics/skills | `fa0fa64bdc96` | `5304866b05b4` |
| anthropics-claude-cookbooks | https://github.com/anthropics/claude-cookbooks | `67ce644d33e5` | `26b5cdce81d3` |
| obra-superpowers | https://github.com/obra/superpowers | `d884ae04edeb` | `b36e0829c6d0` |

Reproduce both sides. The corpus is pinned by the manifest and the tool by the tag:

```
git clone https://github.com/efaimo-ai/efaimo && cd efaimo
git checkout v0.2.0
npm i
node scripts/skills-corpus.mjs .corpus-jul research/skills-index/manifest.json
node scripts/skills-corpus.mjs .corpus-sep
node scripts/skills-index.mjs .corpus-jul --json jul.json
node scripts/skills-index.mjs .corpus-sep --json sep.json
```

Raw output for both dates sits beside this file: `index-2026-07-17.json`, `index-2026-09-03.json`.

Every figure below is over the **36 skills paired by `scripts/skills-index.mjs`**. The 0.3.0 changelog reports the same corpus over the **32** that `check --skill` pairs, because its walker misses four of them (`.claude/skills/<name>/` and one level deeper). Only the body percentage differs between the two populations, +7.0% here against +7.5% there; everything else is identical.

## Two controls, because a delta is the shape a broken measurement takes

**The instrument did not move.** Both runs and the published index all report `efaimo 0.2.0`. More than that, the July re-run reproduces the committed index across all 36 rows, field for field: name, source, grade, counts, ruleIds, meta, body, bodyLines, refFiles, refTokens. Had the ruleset shifted underneath, that comparison would have failed first.

**The largest single movement is content, not counting.** The outlier below is `claude-api`. On disk its directory went from 808,447 to 1,181,653 bytes across 66 to 70 files, and the index counts only the subset `SKILL.md` references, 18 files to 25. Both point the same way.

## What moved

| | 2026-07-17 | 2026-09-03 | |
|---|---|---|---|
| metadata (always in context) | 2,154 | 2,137 | **-0.8%** |
| body (loads on trigger) | 87,308 | 93,454 | **+7.0%** |
| referenced files (load on demand) | 138,980 | 224,289 | **+61.4%** |
| referenced, excluding `claude-api` | 57,744 | 60,503 | +4.8% |

**The cost that is always in context did not move.** Exactly one skill changed it (`finishing-a-development-branch`, 44 to 27 tokens).

**The body grew, and grew in both directions.** Of the 15 skills that changed, 7 got longer and 8 got shorter. That is what maintenance looks like.

**Referenced-file weight grew 61.4%, and one skill is 96.5% of that column's movement.** `claude-api` went from 81,236 to 163,786 tokens across 18 to 25 files. Take it out and the other 35 skills moved +4.8%.

The share is of total absolute movement, counting the one skill that shrank, not of the net increase. A net basis can exceed 100% whenever decreases are large, which is why it is the wrong denominator.

**Grades moved one way only.** Of the 36 skills present on both dates, 0 improved, 4 got worse, 32 held.

| skill | July | September |
|---|---|---|
| `subagent-driven-development` | A (95) | **B (85)** |
| `writing-skills` | A (90) | **B (80)** |
| `brainstorming` | A (100) | A (99) |
| `claude-api` | C (73) | C (72) |

Rule findings went 23 to 30 (S104 9 to 12, S106 8 to 12, the rest unchanged). Errors 1 to 2, warnings 8 to 12. Two skills arrived: `discernment-nudge` A (100) and `academy-guide` B (85).

## What it says, and about whom

The uncomfortable part points inward. **This ruleset has a size threshold for metadata and one for the body, and none at all for referenced-file weight.** The two columns being watched stayed disciplined. The one nothing was watching grew 61%. That is what happens to any quantity with no instrument pointed at it, and the instrument was ours to build.

The same reading covers the grades. Nothing improved in seven weeks across a corpus maintained by people who are good at this. It is not that anyone stopped caring; it is that no number was telling anyone.

**Two things not to take from this.** The naive headline is "+40% context cost", which you get by summing all three columns and not separating the outlier. It is arithmetically true and describes none of the three costs, since they load at different times and almost all the movement is in the column that is cheapest to carry. And an efaimo grade certifies **structural conformance**, not usefulness: valid front matter, sane size, no missing referenced files, no name collision. It is not a judgment about whether a skill is any good.

On that second point, while checking this report the grader was sabotaged and one of its rules did not hold: S102 passed any description over 20 characters containing the word use, when, for, or helps, so `Useful for various tasks.` scored a clean 100 in silence. It tested for the presence of a trigger word rather than for the presence of a trigger. Fixed after this measurement rather than before, on purpose, because changing a rule changes grades and the comparison above is only valid while both runs use one ruleset. The reproduction above is pinned to `v0.2.0` for the same reason.
