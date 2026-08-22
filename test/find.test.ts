import { describe, it, expect } from "vitest";
import type { ToolDef } from "../src/core/types.js";
import { tokenize, nameIsGeneric, QUERY_STOPWORDS } from "../src/find/tokenize.js";
import { Bm25Index, scoresTie } from "../src/find/bm25.js";
import { analyzeFind, indexedTerms, taskQuery, DEFER_RECOMMENDED_TOKENS } from "../src/find/find.js";
import { runFindRules } from "../src/core/engine.js";

function tool(name: string, description: string, props: Record<string, string> = {}): ToolDef {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(Object.entries(props).map(([k, d]) => [k, { type: "string", description: d }])),
    },
  };
}

/** Eight tools, each with a subject nobody else has. The shape a catalog should be. */
const HEALTHY: ToolDef[] = [
  tool("get_weather", "Get the current weather forecast for a city. Returns temperature and conditions.", { city: "the city to look up" }),
  tool("send_email", "Send an email message to a recipient. Returns the delivery status.", { recipient: "the mailbox address" }),
  tool("create_invoice", "Create a billing invoice for a customer. Returns the invoice identifier.", { customer: "the customer account" }),
  tool("search_documents", "Search indexed documents by keyword. Returns matching document titles.", { keyword: "the search keyword" }),
  tool("deploy_service", "Deploy a service to the production cluster. Returns the deployment identifier.", { service: "the service name" }),
  tool("list_repositories", "List the git repositories owned by an account. Returns repository names.", { account: "the owning account" }),
  tool("translate_text", "Translate text between languages. Returns the translated string.", { target: "the target language" }),
  tool("resize_image", "Resize an image to the given dimensions. Returns the new image url.", { width: "pixel width" }),
];

/**
 * The same eight tools plus a duplicate of one: `fetch_weather` carries
 * `get_weather`'s description and argument verbatim. Nothing about the pair is
 * distinguishable to someone describing the task, which is the failure this
 * command exists to name.
 */
const TWINS: ToolDef[] = [
  ...HEALTHY,
  tool("fetch_weather", "Get the current weather forecast for a city. Returns temperature and conditions.", { city: "the city to look up" }),
];

describe("tokenizer", () => {
  it("splits the three naming conventions onto the same terms", () => {
    expect(tokenize("get_weather")).toEqual(["get", "weather"]);
    expect(tokenize("getWeather")).toEqual(["get", "weather"]);
    expect(tokenize("get-weather")).toEqual(["get", "weather"]);
  });

  it("keeps an acronym whole instead of shattering it", () => {
    expect(tokenize("HTTPServer")).toEqual(["http", "server"]);
    expect(tokenize("parseJSONBody")).toEqual(["parse", "json", "body"]);
  });

  it("splits a digit off a word but keeps it as a term", () => {
    expect(tokenize("s3Bucket")).toEqual(["s", "3", "bucket"].filter((t) => t.length > 1));
    expect(tokenize("getV2Config")).toEqual(["get", "config"]);
  });

  it("drops single characters, which carry no retrieval signal", () => {
    expect(tokenize("a b cd")).toEqual(["cd"]);
  });

  it("is total: any string in, an array out", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("!!! ???")).toEqual([]);
  });
});

describe("generic names", () => {
  it("flags a name built only from generic words", () => {
    expect(nameIsGeneric("run")).toBe(true);
    expect(nameIsGeneric("execute_query")).toBe(true);
    expect(nameIsGeneric("get_data")).toBe(true);
  });

  it("does not flag a name that carries a subject", () => {
    expect(nameIsGeneric("get_weather")).toBe(false);
    expect(nameIsGeneric("screenshot")).toBe(false);
    expect(nameIsGeneric("browser_navigate")).toBe(false);
    expect(nameIsGeneric("list_repositories")).toBe(false);
  });

  it("treats a nameless tool as generic rather than crashing", () => {
    expect(nameIsGeneric("")).toBe(true);
    expect(nameIsGeneric("!!")).toBe(true);
  });
});

describe("bm25", () => {
  const docs = [
    { id: "b_weather", terms: ["weather", "forecast", "city"] },
    { id: "a_email", terms: ["email", "message", "send"] },
    { id: "c_empty", terms: ["email", "message", "send"] },
  ];

  it("ranks the matching document first", () => {
    const idx = new Bm25Index(docs);
    expect(idx.score(["weather"])[0]!.id).toBe("b_weather");
  });

  it("returns nothing for an empty query rather than the whole catalog at zero", () => {
    // The alternative - every document at score 0 - would make an unindexable
    // tool look like it ranked first, which is the exact failure this command
    // exists to report.
    expect(new Bm25Index(docs).score([])).toEqual([]);
  });

  it("breaks ties by code point, so the ranking is the same on every machine", () => {
    const idx = new Bm25Index(docs);
    const hits = idx.score(["email"]);
    expect(hits[0]!.score).toBeCloseTo(hits[1]!.score, 12);
    // a_email and c_empty are identical documents; the alphabetically first id
    // wins, and it wins by code point, not by the host's collation table.
    expect([hits[0]!.id, hits[1]!.id]).toEqual(["a_email", "c_empty"]);
  });

  it("is deterministic across runs", () => {
    const a = new Bm25Index(docs).score(["email", "weather"]);
    const b = new Bm25Index(docs).score(["email", "weather"]);
    expect(a).toEqual(b);
  });

  it("collapses a repeated query term instead of weighting it twice", () => {
    const idx = new Bm25Index(docs);
    expect(idx.score(["weather", "weather"])[0]!.score).toBeCloseTo(idx.score(["weather"])[0]!.score, 12);
  });

  it("scoresTie is relative, so it holds at both ends of the scale", () => {
    expect(scoresTie(2, 2 + 1e-12)).toBe(true);
    expect(scoresTie(4000, 4000 + 1e-9)).toBe(true);
    expect(scoresTie(2, 2.1)).toBe(false);
  });
});

describe("what gets indexed and queried", () => {
  it("indexes all four fields tool search matches on", () => {
    const t = tool("send_email", "Send a message.", { recipient: "the mailbox address" });
    const terms = indexedTerms(t);
    expect(terms).toContain("send"); // name
    expect(terms).toContain("message"); // description
    expect(terms).toContain("recipient"); // argument name
    expect(terms).toContain("mailbox"); // argument description
  });

  it("does not draw query terms from argument names", () => {
    // A person describes a task, not a parameter list. `mailbox` is indexed so
    // a search CAN reach it, but it is never what this tool is probed with.
    const idx = new Bm25Index(HEALTHY.map((x) => ({ id: x.name, terms: indexedTerms(x) })));
    const q = taskQuery(tool("send_email", "Send a message.", { recipient: "the mailbox address" }), idx);
    expect(q).not.toContain("mailbox");
    expect(q).not.toContain("recipient");
  });

  it("does not draw query terms from the tool's own name", () => {
    // The whole situation being modelled is a searcher who does not know the
    // name. Drawing the query from it made a unique name token, which has
    // maximal idf, pull its own tool to the top of every probe.
    const idx = new Bm25Index(HEALTHY.map((x) => ({ id: x.name, terms: indexedTerms(x) })));
    const t = tool("zqxwv_widget", "Rotate a turbine blade to the requested angle.");
    expect(taskQuery(t, idx)).not.toContain("zqxwv");
    expect(indexedTerms(t)).toContain("zqxwv"); // indexed, just not probed with
  });

  it("excludes stopwords from the query", () => {
    const idx = new Bm25Index(HEALTHY.map((x) => ({ id: x.name, terms: indexedTerms(x) })));
    const q = taskQuery(tool("get_thing", "Use this when you would like the thing that is there."), idx);
    for (const term of q) expect(QUERY_STOPWORDS.has(term)).toBe(false);
  });
});

describe("analyzeFind", () => {
  it("refuses an empty catalog instead of reporting a perfect score", () => {
    // 0 reachable of 0 is 100%, and a command that printed that would be
    // reporting a green for something it never looked at.
    expect(() => analyzeFind("empty", [])).toThrow(/no tools/i);
  });

  it("a healthy catalog gives every tool a word of its own", () => {
    const r = analyzeFind("healthy", HEALTHY);
    expect(r.toolCount).toBe(8);
    expect(r.distinct.count).toBe(8);
    expect(r.distinct.pct).toBe(100);
    expect(r.perTool.every((t) => t.ownTermCount > 0)).toBe(true);
    expect(r.perTool.every((t) => t.sharedWith.length === 0)).toBe(true);
    expect(r.probe.pct).toBe(100);
    expect(r.perTool.every((t) => t.rank === 1)).toBe(true);
    expect(r.windowCoversCatalog).toBe(false);
  });

  it("owned terms are exactly the terms no other tool has", () => {
    const r = analyzeFind("healthy", HEALTHY);
    const wx = r.perTool.find((t) => t.name === "get_weather")!;
    // Checkable by hand against the fixtures above: only this tool mentions
    // any of these. `returns` appears on every tool and must not be here.
    expect(wx.ownTerms).toContain("weather");
    expect(wx.ownTerms).not.toContain("returns");
  });

  it("adding a duplicate strips the ORIGINAL of its exclusive vocabulary", () => {
    // `fetch_weather` copies `get_weather`'s description and argument
    // verbatim, so every word `get_weather` had is now on two tools. The
    // duplicate keeps one word of its own, `fetch`, from its name. This is the
    // shape of the finding: adding a tool can break a tool you did not touch.
    const r = analyzeFind("twins", TWINS);
    expect(r.perTool.find((t) => t.name === "get_weather")!.ownTermCount).toBe(0);
    expect(r.perTool.find((t) => t.name === "fetch_weather")!.ownTerms).toContain("fetch");
    expect(r.distinct.count).toBe(8);
    expect(r.distinct.total).toBe(9);
  });

  it("names the tools that share a stripped tool's vocabulary", () => {
    const r = analyzeFind("twins", TWINS);
    expect(r.perTool.find((t) => t.name === "get_weather")!.sharedWith).toContain("fetch_weather");
  });

  it("says so when the result window covers the whole catalog", () => {
    const r = analyzeFind("tiny", HEALTHY.slice(0, 3));
    expect(r.windowCoversCatalog).toBe(true);
    expect(r.probe.pct).toBe(100);
    expect(r.notes.some((n) => n.startsWith("VACUOUS"))).toBe(true);
  });

  it("reports a tool with no searchable description as unranked, not as rank 1", () => {
    const broken = [...HEALTHY, { name: "x", description: "" } as ToolDef];
    const r = analyzeFind("broken", broken);
    const entry = r.perTool.find((t) => t.name === "x")!;
    expect(entry.query).toEqual([]);
    expect(entry.rank).toBeUndefined();
    expect(entry.reachable).toBe(false);
    expect(r.probe.returned).toBe(8);
    expect(r.probe.total).toBe(9);
  });

  it("finds the duplicate in a catalog of near-identical tools", () => {
    const r = analyzeFind("twins", TWINS);
    const wx = r.perTool.find((t) => t.name === "get_weather")!;
    // Same description, same argument, different name. A searcher describing
    // the task gets both back at the same score and picks on the alphabet.
    // Under the old name-inclusive probe both scored a clean rank 1, which
    // said the opposite of the truth.
    expect(wx.tiedWith).toContain("fetch_weather");
  });

  it("carries its whole method in the result", () => {
    const r = analyzeFind("healthy", HEALTHY);
    expect(r.method.bm25.k1).toBe(1.2);
    expect(r.method.bm25.b).toBe(0.75);
    expect(r.method.topK).toBe(5);
    expect(r.method.queryTerms).toBe(4);
    expect(r.notes.join(" ")).toMatch(/is a property of the catalog, not a model/);
    expect(r.notes.join(" ")).toMatch(/probe is a simulated BM25/);
    expect(r.notes.join(" ")).toMatch(/floor test/);
  });

  it("is deterministic", () => {
    expect(analyzeFind("healthy", HEALTHY)).toEqual(analyzeFind("healthy", HEALTHY));
  });

  it("distinct moves when the catalog gets worse", () => {
    // The sabotage. A metric that reads 100% for every catalog is measuring
    // nothing, so this pins that it falls on a catalog that is worse in
    // exactly one way. Note it needs no window and no query model: the same
    // fall happens at every setting, which is why this is the headline number
    // and the probe is not.
    expect(analyzeFind("healthy", HEALTHY).distinct.pct).toBe(100);
    expect(analyzeFind("twins", TWINS).distinct.pct).toBeLessThan(100);
  });

  it("the probe also moves, once the window is tight enough to matter", () => {
    expect(analyzeFind("healthy", HEALTHY, { topK: 1 }).probe.pct).toBe(100);
    expect(analyzeFind("twins", TWINS, { topK: 1 }).probe.pct).toBeLessThan(100);
  });
});

describe("findability rules", () => {
  const rules = (tools: ToolDef[], opts?: Parameters<typeof analyzeFind>[2]) =>
    runFindRules({ find: analyzeFind("t", tools, opts) });

  it("a healthy catalog produces no findings", () => {
    expect(rules(HEALTHY)).toEqual([]);
  });

  it("E141 fires on the tool a duplicate stripped of its own vocabulary", () => {
    const f = rules(TWINS).filter((x) => x.ruleId === "E141");
    expect(f).toHaveLength(1);
    expect(f[0]!.target).toBe("get_weather");
    expect(f[0]!.severity).toBe("warn");
    expect(f[0]!.detail).toContain("fetch_weather");
  });

  it("E142 fires on a tool with no words to search for", () => {
    const f = rules([...HEALTHY, { name: "x", description: "" } as ToolDef]);
    const e142 = f.filter((x) => x.ruleId === "E142");
    expect(e142).toHaveLength(1);
    expect(e142[0]!.message).toMatch(/no words to search for/);
    expect(e142[0]!.severity).toBe("warn");
  });

  it("E142 fires on a tool ranked outside the window", () => {
    const f = rules(TWINS, { topK: 1 });
    expect(f.some((x) => x.ruleId === "E142" && /outside a result window/.test(x.message))).toBe(true);
  });

  it("E143 reports an indistinguishable pair once, not twice", () => {
    const f = rules(TWINS).filter((x) => x.ruleId === "E143");
    // Both directions are the same fact. Printing both would double the
    // apparent size of the problem and double the finding count.
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("fetch_weather");
    expect(f[0]!.message).toContain("get_weather");
  });

  it("E144 spares a generic name that is the only tool using that word", () => {
    // `add` in the fixture server is a perfectly findable name for an
    // arithmetic tool: nothing else in its catalog says "add", so the broad
    // pattern search Anthropic describes reaches it. The rule used to fire
    // here on the word list alone and offer no usable fix.
    const f = rules([...HEALTHY, tool("add", "Add two integers and return the sum.")]);
    expect(f.filter((x) => x.ruleId === "E144")).toHaveLength(0);
  });

  it("E144 flags a generic name whose words belong to other tools too", () => {
    // Now "run" is not this tool's word: two tools use it, so no pattern built
    // from the name singles it out, and only the description can.
    const f = rules([
      ...HEALTHY,
      tool("run", "Start the configured job and report its status."),
      tool("pipeline_run", "Run one stage of a deployment pipeline."),
    ]);
    const e144 = f.filter((x) => x.ruleId === "E144");
    expect(e144).toHaveLength(1);
    expect(e144[0]!.target).toBe("run");
    expect(e144[0]!.severity).toBe("info");
  });

  it("E146 flags a tool whose only exclusive word is its own name", () => {
    // Two tools, word-for-word identical descriptions, different names. Each
    // owns its own name token and nothing else, so `distinct` is 100% and E141
    // is correctly silent: names ARE searchable. Nobody describing the task
    // can tell them apart, which is what E146 says.
    const f = rules([
      ...HEALTHY.slice(0, 4),
      tool("alpha_widget", "Rotate the turbine blade to the requested angle."),
      tool("beta_widget", "Rotate the turbine blade to the requested angle."),
    ]);
    const e146 = f.filter((x) => x.ruleId === "E146");
    expect(e146.map((x) => x.target).sort()).toEqual(["alpha_widget", "beta_widget"]);
    expect(e146[0]!.severity).toBe("info");
  });

  it("E145 stays quiet under the defer threshold and fires over it", () => {
    const broken = [...HEALTHY, { name: "x", description: "" } as ToolDef];
    const under = rules(broken, { definitionTokens: DEFER_RECOMMENDED_TOKENS - 1 });
    const over = rules(broken, { definitionTokens: DEFER_RECOMMENDED_TOKENS + 1 });
    expect(under.some((x) => x.ruleId === "E145")).toBe(false);
    expect(over.some((x) => x.ruleId === "E145")).toBe(true);
  });

  it("E145 stays quiet over the threshold when everything is reachable", () => {
    // The rule is a composite: a big catalog is not itself a finding, and a
    // small unreachable one is already E141. It fires only where the two meet.
    expect(rules(HEALTHY, { definitionTokens: DEFER_RECOMMENDED_TOKENS + 50_000 }).some((x) => x.ruleId === "E145")).toBe(false);
  });

  it("every finding carries a rule id in the findability range", () => {
    const f = rules([...HEALTHY, { name: "x", description: "" } as ToolDef, tool("run", "Run it and return the status.")], {
      definitionTokens: DEFER_RECOMMENDED_TOKENS + 1,
    });
    expect(f.length).toBeGreaterThan(0);
    for (const x of f) expect(x.ruleId).toMatch(/^E14\d$/);
  });
});

describe("the numbers a vacuous catalog cannot support", () => {
  it("marks distinct vacuous at one tool and not at two", () => {
    // At one tool every term has document frequency 1, so `distinct` is 100%
    // for any tool whatsoever. The CLI refuses --min-distinct in that state
    // rather than reporting a pass; at two tools the figure is real again.
    const one = analyzeFind("one", HEALTHY.slice(0, 1));
    expect(one.distinctVacuous).toBe(true);
    expect(one.distinct.pct).toBe(100);
    expect(one.notes.join(" ")).toMatch(/VACUOUS DISTINCT/);
    expect(analyzeFind("two", HEALTHY.slice(0, 2)).distinctVacuous).toBe(false);
  });

  it("keeps the two vacuity flags independent", () => {
    // Eight tools with a window of five: the probe is live, distinct is live.
    const r = analyzeFind("eight", HEALTHY);
    expect(r.windowCoversCatalog).toBe(false);
    expect(r.distinctVacuous).toBe(false);
    // Three tools with a window of five: the probe is vacuous, distinct is not.
    const small = analyzeFind("three", HEALTHY.slice(0, 3));
    expect(small.windowCoversCatalog).toBe(true);
    expect(small.distinctVacuous).toBe(false);
  });
});

describe("deferral is decided by both of Anthropic's checkable conditions", () => {
  it("fires on tool count alone, under the token threshold", () => {
    // Anthropic lists "10 or more tools available" and "more than 10k tokens"
    // as separate conditions joined by "any of the following". Only the token
    // one was implemented, so a 24-tool 3.5k-token catalog was told it was
    // "probably loaded up front today" and E145 could not fire on it at all.
    const many = [...HEALTHY, ...HEALTHY.map((t) => ({ ...t, name: `alt_${t.name}` }))];
    const r = analyzeFind("many", many, { definitionTokens: 3_500 });
    expect(r.toolCount).toBe(16);
    expect(r.deferRecommended).toBe(true);
    expect(r.deferBecause.join(" ")).toMatch(/16 tools/);
  });

  it("stays quiet under both", () => {
    const r = analyzeFind("small", HEALTHY.slice(0, 3), { definitionTokens: 500 });
    expect(r.deferRecommended).toBe(false);
    expect(r.deferBecause).toEqual([]);
  });

  it("E145 names the condition that actually fired", () => {
    // The message hardcoded the token clause, so a catalog that qualified on
    // tool count was told "~3500 tokens, past the ~10.0k", which is false
    // arithmetic in an audit tool's own output.
    const many = [...HEALTHY, ...HEALTHY.map((t) => ({ ...t, name: `alt_${t.name}`, description: t.description }))];
    const f = runFindRules({ find: analyzeFind("many", many, { definitionTokens: 3_500 }) });
    const e145 = f.find((x) => x.ruleId === "E145");
    expect(e145).toBeTruthy();
    expect(e145!.message).toMatch(/16 tools/);
    expect(e145!.message).not.toMatch(/3,?500 tokens, past/);
  });
});

describe("counts are counts of the problem, not of the display cap", () => {
  it("E143 reports the true number of tied pairs", () => {
    // tiedWith is capped at three names per tool for display. Counting pairs
    // from that capped list reported 30 for a catalog whose real answer was 66.
    const same = "Handle the widget in the workspace.";
    const twelve = Array.from({ length: 12 }, (_, i) => tool(`tool_${String.fromCharCode(97 + i)}`, same));
    const r = analyzeFind("tied", twelve);
    const truePairs = Math.round(r.perTool.reduce((n, t) => n + t.tiedWithCount, 0) / 2);
    expect(truePairs).toBe((12 * 11) / 2);
    const msg = runFindRules({ find: r }).filter((x) => x.ruleId === "E143").map((x) => x.message).join(" ");
    expect(msg).toContain(`${truePairs} in total`);
  });
});
