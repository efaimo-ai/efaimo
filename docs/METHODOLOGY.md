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
frontier Claude models (Fable 5, Opus 4.8/4.7/4.6, Sonnet 5, Sonnet 4.6) are
**1M**, so that is the default. Haiku 4.5 is 200k, as are many non-Claude and
local models, where identical tool definitions cost five times the share.

Because the denominator is an assumption rather than a measurement, efaimo
always names it in the output ("~4.3% of a 1M window") and lets you set your
own with `--window`:

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
