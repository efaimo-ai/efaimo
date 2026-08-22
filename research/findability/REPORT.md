# Can a search single your tools out? Four real MCP servers

Measured 2026-08-23 with `efaimo find` on `main` (0.2.0, unpublished; `npx
efaimo` installs 0.1.2, which has no `find` command).

A host can mark tools `defer_loading: true`, which keeps their definitions out
of the context window until a search returns them. Anthropic recommends that
once a catalog reaches ten tools or ten thousand tokens of definitions. In that
world a tool nothing surfaces costs no context and provides no capability, so
"can a search pick this out" becomes a question worth measuring.

**This is a sample, not a census.** Four servers that install from npm and list
their tools without credentials, at pinned versions. Swap the list and the
numbers move.

## The measurements

| server | version | tools | `distinct` | `probe` | definitions | tool search recommended |
|---|---|---:|---:|---:|---:|---|
| `@modelcontextprotocol/server-everything` | 2026.7.4 | 13 | **13/13 (100%)** | 13/13 | 1,120 | yes, on tool count |
| `@playwright/mcp` | 0.0.78 | 24 | **22/24 (91.7%)** | 24/24 | 3,453 | yes, on tool count |
| `firecrawl-mcp` | 3.22.3 | 26 | **24/26 (92.3%)** | 26/26 | 16,699 | yes, on both |
| `@notionhq/notion-mcp-server` | 2.4.1 | 24 | **16/24 (66.7%)** | 24/24 | 17,218 | yes, on both |

`distinct` is the share of tools that own at least one term no other tool in
the same catalog has. `probe` is a simulated BM25 search. `definitions` is the
Claude-style o200k estimate of the tool-definition block, and matches
`research/mcp-stack-cost/REPORT.md` row for row, which is a useful cross-check:
two different code paths measuring the same servers agree to the token.

Every one of the four is past at least one of the two conditions Anthropic
names for turning tool search on, which is the point: this is not an exotic
configuration to worry about later.

## The tools that own no word of their own

| server | tools |
|---|---|
| `server-everything` | none |
| `@playwright/mcp` | `browser_close`, `browser_navigate` |
| `firecrawl-mcp` | `firecrawl_check_crawl_status`, `firecrawl_monitor_get` |
| `@notionhq/notion-mcp-server` | `API-get-user`, `API-get-block-children`, `API-retrieve-a-block`, `API-delete-a-block`, `API-create-a-comment`, `API-retrieve-a-data-source`, `API-create-a-data-source`, `API-retrieve-a-database` |

Every word each of these tools carries also appears on some other tool in the
same server, so **no query exists that returns it without also returning a
competitor**. That is a fact about the catalog, not a prediction about a
particular search: it follows from the index and assumes nothing about how
anyone searches.

The Notion list is the one worth reading twice. `API-get-user` and
`API-get-users` are different tools. So are `API-retrieve-a-block`,
`API-get-block-children` and `API-delete-a-block`. A person describing what
they want has no vocabulary that separates them.

## The tools whose only word is their own name (E146)

| server | tools |
|---|---|
| `@playwright/mcp` | `browser_evaluate`, `browser_hover` |
| `@notionhq/notion-mcp-server` | `API-get-users`, `API-list-data-source-templates`, `API-move-page` |

These are findable in principle, because names are searchable. They are not
findable by anyone describing a task rather than naming a tool, which is the
situation deferred loading creates. `browser_hover` owns exactly one word,
`hover`, and it is in its own name.

## Two findings that changed the tool while it was being built

**The probe saturates.** It reads **100% on all four servers**, and a study of
four query models (tf-idf, raw term frequency, leading terms, name tokens) at
one to four query terms gave the same answer almost everywhere. A number that
reads full marks for every real catalog is not a measurement. That is why
`distinct` is the headline and `probe` is a labelled secondary floor test, and
why the CLI says so on every run instead of letting a saturated 100% look like
a good score. ADR-030 has the reasoning.

The probe still earns its place: it is the only number here that models the
actual mechanism, and it catches what `distinct` cannot express, such as a tool
whose description is empty (E142) or two tools whose descriptions are literally
identical (E143, which fires on Notion).

**Indexing `title` made `distinct` optimistic.** MCP tools may carry a `title`,
and an early version indexed it. Anthropic's list of searchable fields is tool
name, description, argument names and argument descriptions; `title` is not
among them. Worse, a title is usually the name restated for humans, so reading
it put the tool's own name back into its own probe after all the trouble taken
to keep it out. Dropping it cost Notion one tool: `API-create-a-comment` had
been credited with a word that existed only in a field no search reads, and
17/24 became 16/24. A metric that counts evidence the mechanism cannot see is
generous in exactly the direction nobody wants.

## What `distinct` does not say

- **It falls as a catalog grows, and that is the phenomenon, not an artifact.**
  More tools in one namespace means more shared vocabulary, and being uniquely
  identifiable really is harder in a 200-tool catalog than in a 13-tool one.
  Do not compare the percentage across servers of very different sizes without
  saying which is which.
- **Owning a word is necessary, not sufficient.** A tool can own a term nobody
  would ever type and still be unreachable. Function words are excluded for
  that reason, and the CLI prints the owned words so a human can judge the
  rest.
- **Not owning a word is not fatal.** Such a tool can still rank first for a
  shared query, because BM25 also weighs term frequency and document length.
  What it can never do is come back alone.
- **It cannot be evaluated at one tool.** With a single tool every term is
  trivially exclusive; the figure is 100% for any tool whatsoever, the report
  says so, and `--min-distinct` refuses rather than passing.
- **The tokenizer is a choice.** camelCase, `snake_case` and `kebab-case` split
  onto the same terms, single characters are dropped, and there is no stemming,
  so `page` and `pages` are different terms. `src/find/tokenize.ts` is the whole
  of it; docs/METHODOLOGY.md states the limits.

## Reproducing this

Each row, exactly. No API key, no account, offline apart from connecting to the
server. `find` reads the tool list and spawns nothing else, but note that
auditing a stdio server means executing it: these four are public npm packages
pinned to a version.

```bash
npx efaimo find "npx -y @modelcontextprotocol/server-everything@2026.7.4"
npx efaimo find "npx -y @playwright/mcp@0.0.78"
npx efaimo find "npx -y firecrawl-mcp@3.22.3"
npx efaimo find "npx -y @notionhq/notion-mcp-server@2.4.1"
```

The whole table in one pass, as JSON:

```bash
for s in @modelcontextprotocol/server-everything@2026.7.4 @playwright/mcp@0.0.78 \
         firecrawl-mcp@3.22.3 @notionhq/notion-mcp-server@2.4.1; do
  npx efaimo find "npx -y $s" --json --no-timestamp
done
```

`--no-timestamp` makes the output byte-identical between runs, so a diff shows
a change in the servers rather than a change in the clock.

Until 0.2.0 publishes, `npx efaimo` will not have `find`; run it from a clone
with `node dist/cli.js find ...` after `npm run build`.
