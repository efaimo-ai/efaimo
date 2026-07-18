# What a real MCP stack costs before it does anything

Measured 2026-07-18 with `efaimo` v0.1.0 on Node 22, Windows.

Every number below is the **Claude-style serialization** of a server's tool
definitions, counted with `o200k_base` (see [docs/METHODOLOGY.md](../../docs/METHODOLOGY.md)).
These are estimates, not billing figures: `--anthropic` gives exact Claude
counts from the `count_tokens` API for anyone who wants to pay for certainty.

## Why this exists

The claim "MCP servers eat your context window" is repeated constantly and, as
far as we could find, never measured. This is the measurement. It is a snapshot
of one plausible stack, not a census: swap the servers and the total moves a
lot, which is the point.

## Result

Eight servers that install from npm without credentials to list their tools:

| server | version | tools | tokens |
|---|---|---:|---:|
| `@notionhq/notion-mcp-server` | 2.4.1 | 24 | 17,218 |
| `firecrawl-mcp` | 3.22.3 | 26 | 16,699 |
| `@playwright/mcp` | 0.0.78 | 24 | 3,453 |
| `@modelcontextprotocol/server-filesystem` | 2026.7.10 | 14 | 1,698 |
| `@modelcontextprotocol/server-everything` | 2026.7.4 | 13 | 1,120 |
| `@upstash/context7-mcp` | 3.2.4 | 2 | 987 |
| `@modelcontextprotocol/server-memory` | 2026.7.4 | 9 | 924 |
| `@modelcontextprotocol/server-sequential-thinking` | 2026.7.4 | 1 | 860 |
| **total** | | **113** | **58,959** |

58,959 tokens is about **5.9% of a 1M context window**, or **29% of a 200k
one**, loaded on every request before the agent reads a single thing.

## What actually drives the number

The distribution is what matters, not the total. Two servers are 57.5% of the
cost, and it is not because they have the most tools: `@playwright/mcp` exposes
the same 24 tools as `@notionhq/notion-mcp-server` for a fifth of the tokens.
Cost per tool ranges from 86 tokens (`server-everything`) to 717 (`notion`) and
860 (`sequential-thinking`, a single tool with a very long description). Tool
count is a bad proxy for context cost; schema and description
size is the real driver, which is why `efaimo weigh` reports per tool.

Note also that `sequential-thinking` charges 860 tokens for **one** tool. A
small server is not automatically a cheap one.

## Reproducing this

```bash
npx efaimo weigh --stdio "npx -y @notionhq/notion-mcp-server"
npx efaimo weigh --stdio "npx -y firecrawl-mcp"
npx efaimo weigh --stdio "npx -y @playwright/mcp"
npx efaimo weigh --stdio "npx -y @modelcontextprotocol/server-filesystem ."
npx efaimo weigh --stdio "npx -y @modelcontextprotocol/server-everything"
npx efaimo weigh --stdio "npx -y @upstash/context7-mcp"
npx efaimo weigh --stdio "npx -y @modelcontextprotocol/server-memory"
npx efaimo weigh --stdio "npx -y @modelcontextprotocol/server-sequential-thinking"
```

To weigh whatever you actually have configured, rather than this list:

```bash
npx efaimo weigh --client claude-code
```

`notion` and `firecrawl` were started with placeholder credentials
(`NOTION_TOKEN=dummy`, `FIRECRAWL_API_KEY=dummy`). Listing tools does not
authenticate, so the manifest, and therefore the token cost, is what a real
install loads. Versions are pinned in the table because `npx -y` resolves
`latest` and these numbers will drift as the servers change; re-run rather than
trusting the table's age.

## Caveat we cannot remove

This is eight servers chosen because they are popular and install cleanly. It
is not a random sample and it is not a claim about the median developer's
setup. If you want a number that describes *your* context bill, run the
`--client` command above; that is the number efaimo exists to give you.
