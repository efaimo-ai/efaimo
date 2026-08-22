/**
 * A small, exact BM25 index.
 *
 * `efaimo find` needs to answer "would a search over this catalog surface this
 * tool", and the built-in tool search is server-side: its parameters are not
 * published, so nothing here can be a reproduction. It is the textbook
 * Robertson/Sparck-Jones BM25 with its conventional parameters, run offline on
 * the four fields Anthropic documents as searchable, and both the formula and
 * the parameters are printed in the output. A reader can disagree with the
 * model and still check the arithmetic.
 *
 * Two properties this file exists to guarantee:
 *
 * - **Determinism.** Ties break on the document id by code point, never by
 *   `localeCompare`, whose collation depends on the host's ICU data. A tool
 *   that reports other people's nondeterminism (E112) must not have any of its
 *   own, and "it ranked differently on CI" is exactly the bug that would be
 *   impossible to reproduce.
 * - **No silent empties.** `score()` on an empty query returns an empty array
 *   rather than the whole catalog at score 0. Callers treat that as a finding,
 *   not as a pass.
 */

export interface Bm25Doc {
  id: string;
  terms: string[];
}

export interface Bm25Hit {
  id: string;
  score: number;
  /**
   * The document's position in the corpus.
   *
   * Present because `id` is not a key. MCP does not forbid two tools sharing a
   * name, and a caller that located its own row with `findIndex(h => h.id ===
   * name)` got the better-scoring twin's rank, score and tie set: a tool that
   * really sat eighth reported rank 1, and the headline moved in the flattering
   * direction. Match on this instead.
   */
  index: number;
}

export interface Bm25Params {
  k1: number;
  b: number;
}

/** The conventional defaults. Printed in every report so the method travels with the number. */
export const DEFAULT_BM25: Bm25Params = { k1: 1.2, b: 0.75 };

export class Bm25Index {
  readonly params: Bm25Params;
  readonly size: number;
  private readonly ids: string[];
  private readonly tf: Map<string, number>[];
  private readonly len: number[];
  private readonly df = new Map<string, number>();
  private readonly avgdl: number;

  constructor(docs: readonly Bm25Doc[], params: Bm25Params = DEFAULT_BM25) {
    this.params = params;
    this.size = docs.length;
    this.ids = docs.map((d) => d.id);
    this.tf = docs.map((d) => {
      const m = new Map<string, number>();
      for (const t of d.terms) m.set(t, (m.get(t) ?? 0) + 1);
      return m;
    });
    this.len = docs.map((d) => d.terms.length);
    for (const m of this.tf) {
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    const total = this.len.reduce((a, b) => a + b, 0);
    // A catalog of zero-length documents would divide by zero in the length
    // normalization. It cannot happen with real tools (a name always tokenizes
    // to something) but the guard costs nothing and a NaN score would rank
    // unpredictably rather than fail.
    this.avgdl = docs.length ? Math.max(1, total / docs.length) : 1;
  }

  /** BM25 IDF. Always positive, so a term present in every document still contributes. */
  idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    return Math.log(1 + (this.size - n + 0.5) / (n + 0.5));
  }

  /** Document frequency: how many tools contain this term at all. */
  documentFrequency(term: string): number {
    return this.df.get(term) ?? 0;
  }

  termFrequency(index: number, term: string): number {
    return this.tf[index]?.get(term) ?? 0;
  }

  /**
   * Score every document against a query, highest first.
   *
   * Duplicate query terms are collapsed: a query is a set of keywords here,
   * not a passage, and counting a repeated term twice would silently weight it.
   */
  score(query: readonly string[]): Bm25Hit[] {
    const terms = [...new Set(query)];
    if (!terms.length) return [];
    const { k1, b } = this.params;
    const hits: Bm25Hit[] = [];
    for (let i = 0; i < this.size; i++) {
      let s = 0;
      const norm = k1 * (1 - b + (b * this.len[i]!) / this.avgdl);
      for (const t of terms) {
        const f = this.tf[i]!.get(t);
        if (!f) continue;
        s += this.idf(t) * ((f * (k1 + 1)) / (f + norm));
      }
      hits.push({ id: this.ids[i]!, score: s, index: i });
    }
    // Ties break on the id by code point, then on position, so two documents
    // with the same name and the same score still have a fixed order.
    hits.sort(
      (x, y) => (y.score - x.score) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) || (x.index - y.index),
    );
    return hits;
  }
}

/**
 * Are two scores the same as far as a ranker is concerned?
 *
 * Relative, because BM25 scores are unbounded: an absolute epsilon that is
 * right at score 2 is meaningless at score 40. Two tools this close are
 * separated only by the tie-break, which means the search picks between them
 * on the alphabet rather than on relevance.
 */
export function scoresTie(a: number, bScore: number, rel = 1e-9): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(bScore), 1);
  return Math.abs(a - bScore) <= rel * scale;
}
