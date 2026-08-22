/**
 * The tokenizer the findability simulation runs on.
 *
 * Tool search (both variants) matches against a tool's name, description,
 * argument names and argument descriptions. Anthropic does not publish the
 * analyzer it uses, so this is a stated approximation rather than a
 * reproduction, and docs/METHODOLOGY.md says exactly that. What matters is
 * that it is deterministic and written down: the same catalog always produces
 * the same terms, on every machine.
 *
 * Splitting rules, in order:
 *   1. camelCase and PascalCase boundaries become separators (`getWeather` ->
 *      `get weather`), because a regex like `.*weather.*` has to reach the
 *      second half of a camelCase name and a naive split on `[^a-z0-9]` never
 *      would.
 *   2. Runs of digits after letters split too (`s3Bucket` keeps `s3`, but
 *      `getV2Config` yields `get v2 config`).
 *   3. Everything that is not a letter or a digit is a separator, so
 *      `get_weather`, `get-weather` and `get.weather` all land on the same
 *      two terms.
 *   4. Lowercase, and drop single characters, which carry no retrieval signal
 *      and only distort the length normalization.
 */
/**
 * Longest field this will tokenize.
 *
 * Every string here comes from the audited server, which may be hostile and is
 * in any case not obliged to be sensible. The split below is linear, but linear
 * on ten megabytes is still ten megabytes, done twice per description, and the
 * connect timeout bounds the RPC rather than what happens after it. A tool
 * definition that needs more than this to describe itself has a finding of its
 * own waiting in `check`.
 */
export const MAX_FIELD_CHARS = 200_000;

export function tokenize(text: string): string[] {
  if (!text) return [];
  return (text.length > MAX_FIELD_CHARS ? text.slice(0, MAX_FIELD_CHARS) : text)
    // ACRONYMFollowed -> ACRONYM Followed, before the general camel split, so
    // `HTTPServer` does not become `httpserver` or `h t t p server`.
    //
    // One capital, not `[A-Z]+`. The quantified form is quadratic on a run of
    // capitals with no lowercase after it: every start position backtracks the
    // whole run. Measured on the old expression, `'A'.repeat(n)` took 43ms at
    // 10k, 7.8s at 100k and 147s at 400k, so one 300KB shouted description
    // pinned a core for minutes while `weigh` and `check` on the same server
    // answered in under a second. `([A-Z])([A-Z][a-z])` matches the same
    // boundaries in linear time: on `HTTPServer` it still splits at `P|Se`.
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 1);
}

/**
 * English function words, excluded from QUERY SELECTION only.
 *
 * They stay in the index on purpose. BM25's IDF already discounts a term that
 * appears in most documents, and removing them from the index would also
 * change every document's length, which changes every score. They are excluded
 * from query selection because that step ranks a tool's own terms by TF-IDF,
 * and in a small catalog a function word repeated three times in one
 * description can outrank the domain noun that actually identifies the tool.
 *
 * Deliberately short and boring: this list is part of the published method, so
 * every word in it has to be defensible as a word nobody searches for.
 */
export const QUERY_STOPWORDS = new Set([
  // Two and three letter function words. The tokenizer drops single
  // characters, so without these a description like "Delete all records in the
  // datastore" probes with `in`, and a term that appears in half the catalog
  // spends one of the four query slots saying nothing.
  "in", "on", "at", "to", "of", "or", "as", "by", "is", "be", "an", "if",
  "do", "so", "up", "we", "us", "am", "he", "she", "him", "her", "his", "me",
  "my", "no", "yes",
  "the", "and", "for", "with", "that", "this", "from", "into", "onto", "than",
  "then", "they", "them", "their", "there", "these", "those", "will", "would",
  "shall", "should", "can", "could", "may", "might", "must", "not", "but",
  "are", "was", "were", "been", "being", "have", "has", "had", "does", "did",
  "you", "your", "yours", "its", "it", "our", "ours", "any", "all", "each",
  "such", "only", "also", "more", "most", "some", "other", "when", "where",
  "which", "while", "what", "who", "whom", "how", "why", "use", "used",
  "using", "via", "per", "out", "off", "over", "under", "about", "above",
  "below", "between", "before", "after", "here", "one", "two", "yes", "no",
]);

/**
 * Name tokens that identify nothing on their own.
 *
 * Used by E144 only. Anthropic's own debugging note for tool search says
 * Claude writes broad patterns such as `.*weather.*`, and that adding common
 * keywords to descriptions improves discoverability. A name assembled purely
 * from these words carries no such keyword, so the only thing that can reach
 * the tool is its description.
 *
 * A word being here does NOT make a name bad: `get_weather` has `weather`.
 * The rule fires only when EVERY token of a name is in this set.
 */
export const GENERIC_NAME_TOKENS = new Set([
  "get", "set", "put", "post", "patch", "add", "new", "create", "make",
  "update", "edit", "modify", "change", "delete", "remove", "drop",
  "list", "read", "write", "fetch", "load", "save", "send", "call",
  "run", "exec", "execute", "invoke", "do", "handle", "process", "perform",
  "query", "search", "find", "lookup", "check", "test", "start", "stop",
  "open", "close", "begin", "end", "init", "setup", "config", "configure",
  "tool", "api", "data", "item", "items", "object", "thing", "value",
  "values", "result", "results", "action", "request", "response", "info",
  "helper", "util", "utils", "main", "default", "generic", "custom", "my",
]);

/** True when a tool name is built only from words that identify nothing. */
export function nameIsGeneric(name: string): boolean {
  const terms = tokenize(name);
  if (!terms.length) return true;
  return terms.every((t) => GENERIC_NAME_TOKENS.has(t));
}
