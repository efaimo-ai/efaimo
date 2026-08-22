# How efaimo counts tokens

efaimo's numbers are meant to be **reproducible and honest**, not authoritative
down to the token. This document is the whole method so you can check it.

## The tokenizer

Estimates use **OpenAI's `o200k_base`** tokenizer (via `gpt-tokenizer`), because
it is public, deterministic, runs offline, and tracks the vocabularies of current
frontier models closely on English and JSON. Every estimated number in efaimo's
output is labeled `o200k` / `estimated`.

Different hosts use different tokenizers, and no vendor tokenizer but OpenAI's is
public, so the estimate carries an **unmeasured, consistent bias** against any
specific host. That makes it reliable for **comparison** (bias cancels in a
`--diff`, so budget gates are trustworthy) but only **approximate in absolute
terms**: the absolute thresholds (E127, E128) and the "percent of window" figure
can be off by more than a few percent, and should be read as order-of-magnitude,
not billing. When you need Claude-exact numbers, pass `--anthropic` (see below).
A calibration study across real schemas is future work; until then the default is
labeled an estimate precisely because its absolute accuracy is unverified.

## What we serialize

A tool definition's real cost depends on how a host serializes it into the model's
context. efaimo reports three serializations so you can see the spread:

- **raw JSON** - the `tools/list` payload, minified. A neutral lower bound.
- **Claude-style** - each tool as `{"description","name","parameters"}` wrapped in
  a `<functions>` block, mirroring how Claude-family harnesses present tools. This
  is efaimo's **primary metric** (the one used for badges, diffs, and budgets)
  because it is the closest public approximation of a real system-prompt injection.
- **OpenAI tools** - the Chat Completions `tools` array shape.

Hosts wrap these in a small amount of fixed framing text (headers, instructions on
how to call tools). That framing is **per-host constant** and independent of your
server, so efaimo excludes it: it would add the same number to every server and
wash out of any comparison or diff.

### Per-tool numbers vs the total

Per-tool numbers count each tool's **bare definition line**; the Claude-style
total counts the whole `<functions>` block, including the `<function>` tags and
newlines around every line. That wrapper is reported as its own **block framing**
line item, so per-tool numbers plus framing equal the Claude-style total. The
per-tool threshold rule (E127) uses the bare line; the total rule (E128) uses the
wrapped total. For the other two serializations no wrapper exists, and summing
per-tool counts may differ from the total by a few tokens, because a tokenizer
can merge characters across element boundaries when tools are concatenated.

## The context window we compare against

Alongside the absolute token count, efaimo prints the share of a context window
it represents. There is no correct denominator for that: the window belongs to
whichever model the host is running, not to the server being measured. Current
frontier Claude models (Fable 5, Opus 5, Opus 4.8/4.7/4.6, Sonnet 5, Sonnet
4.6) are **1M**, so that is the default. Haiku 4.5 is 200k, as are many
non-Claude and local models, where identical tool definitions cost five times
the share.

Because the denominator is an assumption rather than a measurement, efaimo
always names it in the output ("~4.3% of a 1M window") and lets you set your
own with `--window` (since 0.1.1; 0.1.0 hardcoded 200k and printed `of a 200k window`):

```bash
npx efaimo weigh "npx -y my-server" --window 200000
```

**No rule grades on this share.** The cost thresholds (E127, E128) are absolute
token counts, so changing `--window` changes what you read and never changes a
grade. The absolute number is the one efaimo stands behind; the share is a
readability aid on top of it.

## Skills

For Agent Skills efaimo reports the three progressive-disclosure levels defined by
the spec separately, because they load at different times:

- **metadata** (`name` + `description`) - loaded at session start for *every*
  installed skill. This is the always-on cost; the spec targets ~100 tokens.
- **body** - the rest of `SKILL.md`, loaded when the skill triggers.
- **referenced files** - `references/`, `scripts/`, `assets/` linked from the body,
  loaded only on demand.

## Claude-exact mode

With `--anthropic` (and `ANTHROPIC_API_KEY` set), efaimo also calls Anthropic's
`POST /v1/messages/count_tokens`, which accepts a `tools` array, and measures the
**delta** between a request with your tools and the same request without them. That
delta is the exact number of tokens your tool definitions add for the chosen Claude
model. This requires network and a key, so it is opt-in; the o200k estimate is
always shown alongside.

## Determinism

Given the same server output, efaimo produces the same numbers every run: the
tokenizer is deterministic and no sampling is involved. Server responses can change
between runs (a server may reorder or add tools); efaimo's `check` flags
nondeterministic `tools/list` ordering (E112) precisely because it affects both
prompt-cache hits and reproducibility.

## What this is not

efaimo estimates the **cost of tool/skill definitions sitting in context**. It does
not measure per-call argument/result tokens, host framing, or model-side reasoning.
For end-to-end token accounting, instrument your agent run directly.

## `efaimo test`: what the verdict means

The verdict is a significance test, not a threshold on the size of the gap.

Each arm runs N trials of the same task, one with the skill in the system
prompt and one without, and an LLM judge returns PASS or FAIL per trial. The
two arms form a 2x2 table, and the report carries:

- a **two-sided Fisher exact p**. Fisher rather than chi-squared because the
  counts are single digits, where the chi-squared approximation is not
  trustworthy;
- a **95% Newcombe interval on the delta**, built from each arm's Wilson
  interval. Wilson rather than the normal approximation because runs land on
  the boundaries (8/8, 0/8), where the normal interval has zero width and
  would claim certainty from eight trials.

`helps` and `hurts` require **p < 0.05**. Anything else is `no measurable
effect`, however large the gap looks, and the report says so with the p
attached. The default is 20 trials per arm: below roughly that, a partial
result cannot reach significance at all.

Until 2026-08-02 the rule was `>= +15 points helps`, with a default of 5
trials. At that size 5/5 against 4/5 is +20 points and p = 1.0000.

Two things the judge does, which matter for reading a result:

- it is asked to sample deterministically **where the model still accepts a
  sampling parameter**. Claude removed `temperature` from the 4.7 line onward,
  so on Sonnet 5, Opus 5 and their siblings the judge runs at the model's own
  default and its variance is part of the measurement. The report says so on
  every run that this applies to, rather than claiming a determinism it does
  not have. **(unreleased; `efaimo@0.1.2` sends the parameter unconditionally,
  which those models reject with a 400.)** The subject arm is unaffected: it
  wanted temperature 1, which is the default anyway;
- a reply that is neither PASS nor FAIL is **excluded and counted separately**,
  not scored as a failure. A refusal or an API error is not evidence about the
  skill. Exclusion is only unbiased while it falls on both arms alike, so the
  report also carries a **two-sided Fisher exact p on the unparseable counts**,
  and a skew significant at the same 0.05 makes the verdict `inconclusive`:
  two pass rates computed over different populations cannot be subtracted.
  **(unreleased.)**

### What this design still cannot tell you

Named here rather than left for a reader to discover:

- **The judge defaults to the same model as the subject**, so part of any
  measured effect is a model preferring its own output. `judge_model:` in the
  scenario, or `--judge-model`, points it at another model, and the report
  prints both. Subject and judge may be different providers. **(unreleased;
  `efaimo@0.1.2` always judges with the subject model.)**
- **The control arm receives no system prompt at all**, so "the skill's
  content" is confounded with "having any system prompt". A length-matched
  placebo is the fix and is not implemented.
- **Two scenarios is a demonstration, not a benchmark.** The committed runs
  show the method works, not that skills in general do or do not help.

Treat a single scenario as evidence about that scenario.

## `efaimo find`: findability **(unreleased)**

A host may mark tools `defer_loading: true`, which keeps their definitions out
of the system-prompt prefix until a search returns them. Anthropic lists five
conditions for turning that on, joined by "any of the following apply", and two
of them can be checked from a tool list: **ten or more tools**, or **more than
10k tokens of definitions**. `find` checks both and names the one that fired.
An earlier version implemented only the token clause, which told a reader that
a 24-tool, 3.5k-token catalog was probably loaded up front when Anthropic's
first condition already applied to it.

Under deferral, a tool nothing surfaces costs no context and provides no
capability, so "can this be found" becomes a separate question from "what does
this cost" and "how good is this tool".

`find` answers it with two numbers that are **not the same kind of claim**, and
prints both with their denominators. In JSON they are `data.distinct` and
`data.probe`; the terminal uses the same two words.

### `distinct`: a property of the catalog

For every tool, which of its terms does no other tool in the catalog have?

If the answer is none, then every word that tool contains appears somewhere
else, so **no query exists that matches it without also matching a
competitor**. That is not a prediction about a particular search. It follows
from the index, and the only assumption in it is the tokenizer.

The precise limit of the claim, stated because it is easy to overstate: a tool
with no exclusive vocabulary can still be ranked *first* for a shared query,
because BM25 also weighs term frequency and document length. What it can never
do is come back alone. Owning a word is a much stronger position than winning a
tie-break.

Terms come from the four fields the tool search documentation names as
searchable: **tool name, description, argument names, argument descriptions**.
Tokenization splits camelCase, `snake_case` and `kebab-case` onto the same
terms, lowercases, drops single characters, and does no stemming, so `page` and
`pages` are different terms (`src/find/tokenize.ts`, identified in JSON as
`data.method.tokenizer`, a string that changes when the splitting rules do).
English function words are excluded from ownership as well as from queries: a
tool can be the only one in a catalog that says "the", and counting that as
vocabulary it owns would be true and useless.

**`title` is deliberately not indexed**, though MCP tools may carry one.
Anthropic's list of searchable fields does not include it, and a `title` is
usually the name restated for humans, so reading it would put the tool's own
name back into its own probe. Indexing a field the real search cannot read also
makes the number optimistic: a tool would "own" a word no query can reach.
Measured cost of getting this wrong: Notion's server scored 17/24 with `title`
indexed and 16/24 without, and the 16 is the honest one.

**At one tool the number cannot be computed.** Every term is trivially
exclusive, so the figure is 100% for any tool whatsoever. The report says so and
`--min-distinct` refuses to be evaluated rather than reporting a pass.

### `probe`: a simulation, and a saturated one

BM25 (k1=1.2, b=0.75) over those same fields, with each tool queried using the
highest tf-idf terms **of its own description** and a result window of 5, which
is the documented default number of results a search returns.

Two honest limits:

- The real search runs server-side. Its analyzer and parameters are not
  published, so this is a model of a documented mechanism, not a reproduction.
- **It saturates.** Measured on four public servers: 13/13, 24/24, 26/26 and
  24/24, and every query variant tried (tf-idf, raw tf, leading terms) gave the
  same 100%. The query comes from the tool's own words, which is friendlier
  than anything a user would type. Treat it as a floor test that catches an
  empty description or a literal duplicate, not as a ranking.
  [The findability report](../research/findability/REPORT.md) has the numbers
  and the commands that reproduce them.

The query deliberately excludes the tool's **name** and its **title**. An
earlier version included both and the metric could barely fail: a unique name
token has maximal idf, so it entered every query and pulled its own tool to the
top, and two tools with identical descriptions both scored a clean first place.
The name stays in the index, so a name whose words echo the description still
helps it rank.

### Why there is no findability grade

Because the two numbers answer different questions and only one of them is a
measurement rather than a model, and because a letter would have inherited the
defect the quality grade already has: it cannot see size. See ADR-030. The gate
is `--min-distinct`, which the operator sets, on the number that can actually
fail at two tools and up.

The colour the terminal puts on `distinct` is not a grade either: red means the
E141 condition holds (some tool owns nothing), green means it does not. An
earlier version banded it at 95 and 80 percent, two cutoffs that appeared in no
rule and no document, inside the one command whose design note says it does not
grade.
