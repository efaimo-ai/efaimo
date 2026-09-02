import type { FindResult, ToolDef, ToolFindEntry } from "../core/types.js";
import { Bm25Index, DEFAULT_BM25, scoresTie, type Bm25Doc } from "./bm25.js";
import { nameIsGeneric, QUERY_STOPWORDS, tokenize } from "./tokenize.js";
// QUERY_STOPWORDS is used twice here on purpose: a word nobody would type is
// neither a query term nor vocabulary that makes a tool findable.

/**
 * Findability: can a search over this catalog pick this tool out at all?
 *
 * Why this exists. Since 2026-01 a host can mark tools `defer_loading: true`,
 * which keeps them out of the system-prompt prefix entirely; the model then
 * finds them by searching the catalog, and Anthropic recommends turning that
 * on once tool definitions pass ~10k tokens. Under deferral a tool no search
 * surfaces costs zero tokens and provides zero capability, and no existing
 * check looks at that: `weigh` measures what a tool costs, `check` measures
 * what a model experiences once the tool is already in front of it.
 *
 * Two measurements, and they are not the same kind of thing.
 *
 * 1. EXCLUSIVE VOCABULARY, the headline. Which terms does a tool have that no
 *    other tool in the catalog has? A tool with none cannot be matched by any
 *    query that does not also match a competitor, because every word it
 *    contains is somewhere else too. That is a fact about the catalog, checked
 *    by inspection, with no model of how anyone searches, no parameters, and
 *    nothing to disagree with except the tokenizer.
 *
 *    It also discriminates, which the alternative did not. Measured on
 *    `@playwright/mcp` 0.0.78: 22 of 24 tools own a word, and `browser_close`
 *    and `browser_navigate` own none.
 *
 * 2. THE SEARCH PROBE, secondary. Simulated BM25 over the four fields tool
 *    search documents as searchable, each tool queried with the top terms of
 *    its own description. This is a model, and a generous one: the query comes
 *    from the tool's own words. It reads 100% on both the official reference
 *    server and playwright, so it is a floor test that catches catastrophe -
 *    an empty description, a literal duplicate - and not a ranking. The report
 *    says so on every run rather than letting a saturated number look like a
 *    good score.
 *
 * Neither is a grade. See ADR-030 for why this ships as proportions.
 */

/** How many of a tool's own terms make up its self-query. */
export const DEFAULT_QUERY_TERMS = 4;

/**
 * How many results a search returns. Anthropic documents a default of 5 (the
 * model may raise it), so 5 is what a tool has to land inside to be seen
 * without the model deciding to look harder.
 */
export const DEFAULT_TOP_K = 5;

/**
 * When Anthropic's own guidance says to turn tool search on.
 *
 * The doc lists five conditions joined by "any of the following apply", and
 * two of them can be checked from a tool list: "You have 10 or more tools
 * available" and "Your tool definitions consume more than 10k tokens". The
 * other three are about the operator's situation, not the catalog.
 *
 * Both are checked. An earlier version implemented only the token clause,
 * which told a reader that a 24-tool, 3.5k-token server was "probably loaded
 * up front today" when Anthropic's first condition already applied to it, and
 * left E145 structurally unable to fire on the most common shape there is: a
 * catalog with plenty of tools and modest descriptions.
 */
export const DEFER_RECOMMENDED_TOKENS = 10_000;
export const DEFER_RECOMMENDED_TOOLS = 10;

interface SchemaBudget {
  nodes: number;
  tokens: number;
}

/**
 * Bounded walk of a JSON Schema, collecting argument names and descriptions.
 *
 * Two things this got wrong and now does not.
 *
 * It used `out.push(...tokenize(text))`, which passes every token as a separate
 * argument. One argument description long enough to produce ~125,000 tokens
 * (about a megabyte, entirely within reach of an untrusted third-party server)
 * blew the call-stack limit and took the whole run down with a `RangeError`.
 * Tokens are appended one at a time now, and there is a token budget as well
 * as a node budget: bounding node COUNT does not bound the work one node can do.
 *
 * And it walked only `properties` and a singular `items`, which misses the two
 * shapes generated schemas actually take: pydantic hoists everything into
 * `$defs` and points at it with `$ref`, and zod emits `anyOf`/`oneOf`. Against
 * those, argument names and descriptions went uncollected, which makes
 * `distinct` PESSIMISTIC: a tool that really does own a word gets reported as
 * owning none and E141 fires on a server that is fine. `$defs` is walked
 * directly rather than resolving `$ref`, because the text is what is wanted,
 * not the structure, and a walk cannot loop that way.
 */
function schemaTerms(schema: unknown, depth = 0, budget: SchemaBudget = { nodes: 600, tokens: 20_000 }): string[] {
  const out: string[] = [];
  if (depth > 4 || budget.nodes <= 0 || budget.tokens <= 0 || !schema || typeof schema !== "object") return out;
  budget.nodes--;
  const node = schema as Record<string, unknown>;

  const take = (text: unknown): void => {
    if (typeof text !== "string") return;
    for (const t of tokenize(text)) {
      if (budget.tokens-- <= 0) return;
      out.push(t);
    }
  };
  const descend = (child: unknown): void => {
    for (const t of schemaTerms(child, depth + 1, budget)) {
      if (budget.tokens-- <= 0) return;
      out.push(t);
    }
  };

  for (const key of ["properties", "$defs", "definitions", "patternProperties"]) {
    const bag = node[key];
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
    for (const [name, value] of Object.entries(bag as Record<string, unknown>)) {
      if (budget.nodes <= 0 || budget.tokens <= 0) break;
      // Only `properties` and `patternProperties` keys are argument names a
      // caller types; a `$defs` key is a type name the model never sees.
      if (key === "properties" || key === "patternProperties") take(name);
      if (value && typeof value === "object") {
        // Description only. A property `title` is no more a searchable field
        // than a tool `title` is, and indexing it would be the same mistake
        // one level down.
        take((value as { description?: unknown }).description);
        descend(value);
      }
    }
  }

  for (const key of ["items", "additionalProperties", "not", "contains"]) {
    const child = node[key];
    // A tuple schema writes `items` as an ARRAY; that shape is handled below,
    // and descending into the array itself would spend a node on nothing.
    if (child && typeof child === "object" && !Array.isArray(child)) descend(child);
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    const arr = node[key];
    if (!Array.isArray(arr)) continue;
    for (const child of arr) {
      if (budget.nodes <= 0 || budget.tokens <= 0) break;
      descend(child);
    }
  }
  // A tuple schema writes `items: [ {...}, {...} ]`, which the object branch
  // above skips because an array is typeof "object" but has no keys of interest.
  if (Array.isArray(node.items)) {
    for (const child of node.items) {
      if (budget.nodes <= 0 || budget.tokens <= 0) break;
      descend(child);
    }
  }
  return out;
}

/**
 * The four fields tool search matches on: name, description, argument names,
 * argument descriptions. Kept in one function so the index and the docs can
 * never disagree about what is searched.
 *
 * `title` is deliberately NOT among them, for two reasons that point the same
 * way. Anthropic's list of searchable fields is these four and does not
 * include it. And MCP `title` is a human-readable restatement of the name:
 * every one of the reference server's thirteen tools sets one, and every one
 * is the name title-cased ("Echo Tool", "Get Annotated Message Tool"). An
 * earlier version indexed and PROBED with it, which quietly put the tool's own
 * name back into its own query through the back door and undid the whole
 * reason the name is excluded. Two tools with identical descriptions and
 * name-derived titles scored a clean rank 1 each instead of tying.
 *
 * Indexing a field the real search does not read would also make `distinct`
 * optimistic: a tool could "own" a word that exists only in its title, where
 * no query can reach it.
 */
export function indexedTerms(tool: ToolDef): string[] {
  return [
    ...tokenize(tool.name),
    ...tokenize(tool.description ?? ""),
    ...schemaTerms(tool.inputSchema),
  ];
}

/**
 * The terms a person would plausibly type to reach this tool.
 *
 * Drawn from the description, and deliberately NOT from the name, the title,
 * or the argument names.
 *
 * Not the name, because the person searching does not know it. That is the
 * whole situation being modelled: the tool is deferred, the user describes a
 * task, and the model turns that description into a query. An earlier version
 * of this drew query terms from the name too, and the result was a metric that
 * could barely fail - a unique name token has maximal idf, so it entered every
 * query and pulled its own tool to the top. Two tools with the same
 * description and different names both scored a clean rank 1, which is exactly
 * backwards: identical descriptions are the case where a searcher cannot tell
 * them apart. The name stays in the INDEX, so a name whose words echo the
 * description still helps the tool rank.
 *
 * Not the title either, and that one is the same bug wearing a different hat:
 * MCP `title` is usually the name title-cased, so reading it here put the name
 * back into its own query after all the trouble taken to keep it out. See
 * `indexedTerms`, which drops it from the index for the same reason.
 *
 * Not argument names, because a user describes a task ("post a message to
 * slack"), not a parameter list. They are indexed, so a search can still reach
 * them; they are just never what the tool is probed with.
 *
 * Ranked by tf*idf inside this catalog, so the terms chosen are the ones that
 * separate this tool from its siblings, with stopwords excluded because in a
 * small catalog a function word repeated in one description can outrank the
 * noun that identifies the tool.
 */
export function taskQuery(tool: ToolDef, index: Bm25Index, limit = DEFAULT_QUERY_TERMS): string[] {
  const source = tokenize(tool.description ?? "");
  const tf = new Map<string, number>();
  for (const t of source) {
    if (QUERY_STOPWORDS.has(t)) continue;
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return [...tf.entries()]
    .map(([term, count]) => ({ term, weight: count * index.idf(term) }))
    // Code-point tie-break, not localeCompare: the query has to be the same on
    // every machine or the whole report is unreproducible.
    .sort((a, b) => (b.weight - a.weight) || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, limit)
    .map((x) => x.term);
}

export interface FindOptions {
  /** Labels of the servers merged into this catalog, when more than one. */
  sources?: string[];
  topK?: number;
  queryTerms?: number;
  /** Claude-style tool-definition tokens, used only to say whether deferral is likely. */
  definitionTokens?: number;
}

export function analyzeFind(label: string, tools: readonly ToolDef[], opts: FindOptions = {}): FindResult {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const queryTerms = opts.queryTerms ?? DEFAULT_QUERY_TERMS;

  // An empty catalog is a failure, never a clean report. `find` on a server
  // that exposes no tools would otherwise print a perfect 0/0 = 100% reach,
  // which is the project's documented dominant failure mode: a green that
  // examined nothing. The caller turns this into an exit code.
  if (!tools.length) {
    throw new Error(
      `"${label}" exposes no tools, so there is nothing to search for. ` +
        `An empty catalog is not a findable one; check that the server started and listed its tools.`,
    );
  }

  const docs: Bm25Doc[] = tools.map((t) => ({ id: t.name, terms: indexedTerms(t) }));
  const index = new Bm25Index(docs, DEFAULT_BM25);

  // Exclusive vocabulary. Computed from the document frequencies the index
  // already holds, so the two measurements cannot disagree about what a term
  // is: one tokenizer, one set of documents.
  const termSets = docs.map((d) => new Set(d.terms));

  const nameTermSets = tools.map((t) => new Set(tokenize(t.name)));

  /** How many "who shares my vocabulary" scans to run. See the comment at its use. */
  const SHARED_WITH_BUDGET = 200;
  let sharedComputed = 0;

  const perTool: ToolFindEntry[] = tools.map((tool, i) => {
    // Exclusive terms, with function words removed.
    //
    // A tool can be the only one in a catalog that happens to say "the", and
    // counting that as vocabulary it owns would be true and useless: nobody
    // searches for it. Function words are already excluded from the queries
    // this file builds, for the same reason, and letting them count here would
    // have let a catalog of near-identical tools score a clean 100%.
    //
    // Most-used first, then alphabetical. The list is capped for display, and
    // an alphabetical cap shows whichever exclusive words happen to start with
    // an early letter rather than the ones the tool is actually about: on
    // `get_weather` that hid `weather` behind `city, conditions, current`.
    const own = [...termSets[i]!]
      .filter((t) => index.documentFrequency(t) === 1 && !QUERY_STOPWORDS.has(t))
      .sort((a, b) => index.termFrequency(i, b) - index.termFrequency(i, a) || (a < b ? -1 : a > b ? 1 : 0));
    // How much of that survives if the searcher does not know the name. A tool
    // whose only exclusive word IS its name is reachable in principle (names
    // are searchable) and unreachable in practice by anyone describing a task.
    const ownOutsideName = own.filter((t) => !nameTermSets[i]!.has(t));
    // Who shares this tool's vocabulary when it owns nothing. Ranked by how
    // much of it they cover, so the first name listed is the tool most worth
    // comparing against.
    // Only for tools that own nothing, and only for the first few of those.
    //
    // This is the one quadratic step here, and it used to re-materialise
    // `[...termSets[i]]` as a fresh array inside the loop, once per sibling:
    // 1,000 tools that all share their vocabulary took about four seconds and
    // 10,000 extrapolated to over half an hour. Iterating the smaller set with
    // no allocation removes most of that, and the cap removes the rest. The
    // cap costs nothing visible: the rules report at most five of these and
    // the table shows fifteen rows.
    const sharedWith = own.length || sharedComputed >= SHARED_WITH_BUDGET ? [] : (() => {
      sharedComputed++;
      const mine = termSets[i]!;
      const scored: { name: string; overlap: number }[] = [];
      for (let j = 0; j < tools.length; j++) {
        if (j === i) continue;
        const other = termSets[j]!;
        const [small, big] = mine.size <= other.size ? [mine, other] : [other, mine];
        let overlap = 0;
        for (const t of small) if (big.has(t)) overlap++;
        if (overlap > 0) scored.push({ name: tools[j]!.name, overlap });
      }
      return scored
        .sort((a, b) => b.overlap - a.overlap || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .slice(0, 3)
        .map((x) => x.name);
    })();

    const query = taskQuery(tool, index, queryTerms);
    const hits = index.score(query);
    // By POSITION, not by name. Two tools may share a name, and matching on it
    // handed every duplicate the better twin's rank, score and tie set.
    const at = hits.findIndex((h) => h.index === i);
    const rank = at >= 0 ? at + 1 : undefined;
    const score = at >= 0 ? hits[at]!.score : 0;
    const outrankedBy = at > 0 ? hits.slice(0, at).map((h) => h.id) : [];
    const tied =
      at >= 0
        ? hits.filter((h, pos) => pos !== at && scoresTie(h.score, score) && h.score > 0).map((h) => h.id)
        : [];
    return {
      name: tool.name,
      ...(tool.origin ? { origin: tool.origin } : {}),
      ownTerms: own.slice(0, 4),
      ownTermCount: own.length,
      ownOutsideNameCount: ownOutsideName.length,
      sharedWith,
      query,
      rank,
      score,
      outrankedBy: outrankedBy.slice(0, 3),
      tiedWith: tied.slice(0, 3),
      // Kept separately from the display cap. The rule that counts pairs was
      // counting the capped list, so a catalog where every tool ties with
      // every other reported 30 pairs instead of the real 66: a count of what
      // survived a display cap, presented as a count of the problem.
      tiedWithCount: tied.length,
      reachable: rank !== undefined && rank <= topK,
      genericName: nameIsGeneric(tool.name),
    };
  });

  const distinctCount = perTool.filter((t) => t.ownTermCount > 0).length;
  const reachable = perTool.filter((t) => t.reachable).length;
  const windowCoversCatalog = tools.length <= topK;
  const distinctVacuous = tools.length < 2;
  const deferBecause: string[] = [];
  if (tools.length >= DEFER_RECOMMENDED_TOOLS) {
    deferBecause.push(`${tools.length} tools (Anthropic recommends tool search at ${DEFER_RECOMMENDED_TOOLS} or more)`);
  }
  if ((opts.definitionTokens ?? 0) > DEFER_RECOMMENDED_TOKENS) {
    deferBecause.push(
      `~${(opts.definitionTokens ?? 0).toLocaleString("en-US")} tokens of definitions (Anthropic recommends tool search over ${DEFER_RECOMMENDED_TOKENS.toLocaleString("en-US")})`,
    );
  }
  const deferRecommended = deferBecause.length > 0;

  const notes: string[] = [
    `method: terms come from the four fields tool search documents as searchable (tool name, description, argument names, argument descriptions). ` +
      `"distinct" is a property of the catalog, not a model. The probe is a simulated BM25 (k1=${DEFAULT_BM25.k1}, b=${DEFAULT_BM25.b}), ` +
      `each tool queried with the ${queryTerms} highest tf-idf terms of its own description (never its name or title, which a searcher does not know), window ${topK}. docs/METHODOLOGY.md.`,
    `the probe reads 100% on every real server measured so far, so treat it as a floor test that catches an empty or duplicated description, not as a ranking.`,
  ];

  // Vacuity is stated, not hidden, and there are TWO kinds of it.
  //
  // The probe goes vacuous whenever the catalog fits inside the result window.
  // `distinct` goes vacuous only at one tool, where every term trivially has
  // document frequency 1 and the figure is 100% for any catalog whatsoever.
  // The first version of this said "exclusive vocabulary can fail at any
  // catalog size, including two tools", which is true at two and false at one,
  // and then reassured the reader that everything except the probe was "still
  // meaningful" while the headline number was the one that had stopped being
  // evidence. One-tool servers are real: sequential-thinking is one.
  if (windowCoversCatalog) {
    notes.push(
      `VACUOUS PROBE: ${tools.length} tools and a result window of ${topK}, so no tool can fall outside it. ` +
        `The probe figure is 100% by construction. Ranks, exclusive vocabulary and the findings below are still evidence.`,
    );
  }
  if (distinctVacuous) {
    notes.push(
      `VACUOUS DISTINCT: a one-tool catalog has nothing to be distinct from, so every term it has is trivially exclusive ` +
        `and the figure is 100% for any tool whatsoever. It is not evidence about this server, and --min-distinct cannot be evaluated here.`,
    );
  }
  // Duplicate names are a real defect and nothing else here reports them. The
  // ranking no longer confuses two tools that share a name, but a client that
  // routes by name still will.
  const dupNames = [...new Set(tools.map((t) => t.name).filter((nm, i, all) => all.indexOf(nm) !== i))];
  if (dupNames.length) {
    notes.push(
      `${dupNames.length} tool name${dupNames.length === 1 ? " is" : "s are"} used by more than one tool (${dupNames.slice(0, 3).join(", ")}). ` +
        `Ranks here are per tool, but a client that addresses tools by name cannot tell them apart at all.`,
    );
  }

  notes.push(
    deferRecommended
      ? `tool search is recommended for this catalog (${deferBecause.join("; ")}), so assume these tools are deferred and that findability is what decides whether they get used.`
      : `${tools.length} tools and ~${(opts.definitionTokens ?? 0).toLocaleString("en-US")} tokens of definitions, under both thresholds where Anthropic recommends tool search, so these tools are probably loaded up front today and this report is advisory rather than urgent.`,
  );

  return {
    kind: "find",
    label,
    ...(opts.sources && opts.sources.length > 1 ? { sources: opts.sources } : {}),
    toolCount: tools.length,
    method: { tokenizer: "efaimo-v1", bm25: { ...DEFAULT_BM25 }, queryTerms, topK },
    perTool,
    distinct: {
      count: distinctCount,
      total: tools.length,
      pct: Math.round((distinctCount / tools.length) * 1000) / 10,
    },
    probe: {
      returned: reachable,
      total: tools.length,
      pct: Math.round((reachable / tools.length) * 1000) / 10,
    },
    windowCoversCatalog,
    distinctVacuous,
    definitionTokens: opts.definitionTokens,
    deferRecommended,
    deferBecause,
    notes,
  };
}
