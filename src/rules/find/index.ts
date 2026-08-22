import type { Finding, FindRule } from "../../core/types.js";

/**
 * Findability rules, E141-E146.
 *
 * A separate family with its own command on purpose. They are not readiness
 * (which asks whether a 2026-07-28 client can talk to this server) and not
 * quality (which asks what a model experiences once a tool is in front of it).
 * They ask a third thing: under deferred loading, does anything ever put this
 * tool in front of the model at all.
 *
 * E141 is the one that is not a heuristic. The others read a simulation and
 * are worth less; they are kept because the simulation is the only thing here
 * that models the real mechanism, and because the cases they do catch (a tool
 * with no description, two tools with the same one) are worth catching.
 *
 * None of them feeds `check`'s grade, and `find` produces no grade of its own.
 * ADR-030 has the reasoning.
 */

function cap<T>(items: T[], n: number): { shown: T[]; more: number } {
  return { shown: items.slice(0, n), more: Math.max(0, items.length - n) };
}

/**
 * A target-supplied value going into a rule message or detail.
 *
 * The reporters strip control characters but keep newlines, because a detail
 * block is legitimately multi-line. That makes a newline inside a tool name a
 * way for the audited server to add its own line to the auditor's output. The
 * values these rules interpolate - names, terms - are all single-line by
 * nature, so they are flattened here, at the point where a multi-line region
 * is built out of them.
 */
function one(s: string): string {
  return s.replace(/[\r\n]+/g, " ");
}
const list = (xs: readonly string[]): string => xs.map(one).join(", ");

const e141: FindRule = {
  id: "E141",
  title: "tool owns no exclusive vocabulary",
  surface: "find",
  check({ find }) {
    const shared = find.perTool.filter((t) => t.ownTermCount === 0);
    const { shown, more } = cap(shared, 5);
    const findings: Finding[] = shown.map((t) => ({
      ruleId: "E141",
      severity: "warn" as const,
      title: "tool owns no exclusive vocabulary",
      // Stated as what it is: an existence claim about queries, not a
      // prediction about one search. Every term this tool has appears on some
      // other tool, so there is no query that matches it alone. Whether it
      // still wins a shared query depends on term frequencies, which is a much
      // weaker thing to rely on than owning a word.
      message: `tool "${one(t.name)}" has no term that no other tool has, so no search can return it without also returning a competitor`,
      target: t.name,
      // "also appears on", not "covered by": no single tool on this list
      // necessarily carries the whole vocabulary. They are the tools with the
      // most overlap, which is where to look first when writing the fix.
      detail: t.sharedWith.length ? `every word it has also appears on: ${list(t.sharedWith)} (most overlap first)` : undefined,
      fixHint: "put something in the description that only this tool does: the object it acts on, the format it returns, the case it is for",
    }));
    if (more) {
      findings.push({
        ruleId: "E141",
        severity: "warn",
        title: "tool owns no exclusive vocabulary",
        message: `...and ${more} more tools that share every one of their terms with another tool`,
      });
    }
    return findings;
  },
};

const e142: FindRule = {
  id: "E142",
  title: "a search for the tool's own description does not return it",
  surface: "find",
  check({ find }) {
    const findings: Finding[] = [];

    const unsearchable = find.perTool.filter((t) => t.rank === undefined);
    for (const t of cap(unsearchable, 5).shown) {
      findings.push({
        ruleId: "E142",
        severity: "warn",
        title: "a search for the tool's own description does not return it",
        message: `tool "${one(t.name)}" offers no words to search for: its description is empty or made only of function words, so nothing but the exact name reaches it`,
        target: t.name,
        fixHint: "write a description containing the words someone would use to describe the task this tool does",
      });
    }

    const missed = find.perTool.filter((t) => t.rank !== undefined && !t.reachable);
    for (const t of cap(missed, 5).shown) {
      findings.push({
        ruleId: "E142",
        severity: "warn",
        title: "a search for the tool's own description does not return it",
        message: `tool "${one(t.name)}" ranks ${t.rank} of ${find.toolCount} for a search built from its own description (${list(t.query)}), outside a result window of ${find.method.topK}`,
        target: t.name,
        detail: t.outrankedBy.length ? `outranked by: ${list(t.outrankedBy)}` : undefined,
        fixHint: "make the description carry a term the other tools do not share",
      });
    }

    const more = cap(unsearchable, 5).more + cap(missed, 5).more;
    if (more) {
      findings.push({
        ruleId: "E142",
        severity: "warn",
        title: "a search for the tool's own description does not return it",
        message: `...and ${more} more tools a search for their own description does not return`,
      });
    }
    return findings;
  },
};

const e143: FindRule = {
  id: "E143",
  title: "tools are indistinguishable to a search",
  surface: "find",
  check({ find }) {
    // Report each pair once. A ties with B is the same fact as B ties with A,
    // and printing both halves doubles the finding count, which would double
    // the apparent size of the problem.
    const seen = new Set<string>();
    const findings: Finding[] = [];
    for (const t of find.perTool) {
      for (const other of t.tiedWith) {
        const key = t.name < other ? `${one(t.name)} ${one(other)}` : `${one(other)} ${one(t.name)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (findings.length >= 5) continue;
        findings.push({
          ruleId: "E143",
          severity: "warn",
          title: "tools are indistinguishable to a search",
          message: `tools "${one(t.name)}" and "${one(other)}" score identically for a search built from "${one(t.name)}"'s description (${list(t.query)}); only the alphabetical tie-break separates them`,
          target: t.name,
          fixHint: "give each description a term the other does not have, or merge the tools",
        });
      }
    }
    // The true pair count comes from tiedWithCount, not from the names above.
    // `tiedWith` is capped at three per tool for display, so counting the
    // pairs it yields reported 30 for a catalog whose real answer was 66: a
    // count of what survived a display cap, printed as a count of the problem.
    // Each pair is counted from both ends, hence the halving.
    const totalPairs = Math.round(find.perTool.reduce((n, t) => n + t.tiedWithCount, 0) / 2);
    if (totalPairs > findings.length) {
      findings.push({
        ruleId: "E143",
        severity: "warn",
        title: "tools are indistinguishable to a search",
        message: `...and ${totalPairs - findings.length} more indistinguishable pairs (${totalPairs} in total)`,
      });
    }
    return findings;
  },
};

const e146: FindRule = {
  id: "E146",
  title: "the only word a tool owns is its own name",
  surface: "find",
  check({ find }) {
    // Names ARE searchable, so this tool is findable in principle and E141
    // correctly does not fire. It is not findable by anyone describing a task,
    // which is the situation deferred loading creates, so the two cases are
    // reported separately rather than merged into one number.
    const nameOnly = find.perTool.filter((t) => t.ownTermCount > 0 && t.ownOutsideNameCount === 0);
    const { shown, more } = cap(nameOnly, 5);
    const findings: Finding[] = shown.map((t) => ({
      ruleId: "E146",
      severity: "info" as const,
      title: "the only word a tool owns is its own name",
      message:
        t.ownTermCount === 1
          ? `tool "${one(t.name)}" owns one term and it comes from its own name; nothing in its description is unique, so only someone who already knows the name can single it out`
          : `tool "${one(t.name)}" owns ${t.ownTermCount} terms and every one of them comes from its own name; nothing in its description is unique, so only someone who already knows the name can single it out`,
      target: t.name,
      fixHint: "put a word in the description that no other tool's description uses",
    }));
    if (more) {
      findings.push({
        ruleId: "E146",
        severity: "info",
        title: "the only word a tool owns is its own name",
        message: `...and ${more} more tools whose only exclusive words are their own name`,
      });
    }
    return findings;
  },
};

const e144: FindRule = {
  id: "E144",
  title: "tool name carries no domain term",
  surface: "find",
  check({ find }) {
    // All-generic AND no name token of its own.
    //
    // "Generic" alone was too weak: the fixture server's `add` is a perfectly
    // descriptive name for an arithmetic tool, and the rule told its author to
    // "put the subject in the name" with no usable suggestion. What separates
    // `add` from `run` is not the word list, it is whether the word belongs to
    // this tool alone in this catalog. `ownTermCount > ownOutsideNameCount`
    // means at least one exclusive term came from the name, which is exactly
    // the case where a broad pattern search does reach it.
    const generic = find.perTool.filter((t) => t.genericName && t.ownTermCount === t.ownOutsideNameCount);
    const { shown, more } = cap(generic, 5);
    const findings: Finding[] = shown.map((t) => ({
      ruleId: "E144",
      severity: "info" as const,
      title: "tool name carries no domain term",
      message: `tool "${one(t.name)}" is named only with generic words, so a broad pattern search (Claude writes things like ".*weather.*") can reach it only through its description`,
      target: t.name,
      fixHint: "put the subject in the name: what does it act on",
    }));
    if (more) {
      findings.push({
        ruleId: "E144",
        severity: "info",
        title: "tool name carries no domain term",
        message: `...and ${more} more tools named only with generic words`,
      });
    }
    return findings;
  },
};

const e145: FindRule = {
  id: "E145",
  title: "deferred catalog with tools a search cannot single out",
  surface: "find",
  check({ find }) {
    if (!find.deferRecommended) return [];
    // The union, not the sum. These two sets overlap heavily - a tool with no
    // exclusive vocabulary is often also one the probe misses - and adding
    // them read as twice as many problems as there are. On a 15-tool server
    // this line once claimed 24.
    const affected = new Set<string>();
    for (const t of find.perTool) {
      if (t.ownTermCount === 0 || !t.reachable) affected.add(t.name);
    }
    if (!affected.size) return [];
    return [
      {
        ruleId: "E145",
        severity: "warn",
        title: "deferred catalog with tools a search cannot single out",
        // The reason comes from the analysis, not from a repeat of one
        // threshold. Anthropic lists several conditions; hardcoding the token
        // one here printed "~3500 tokens, past the ~10.0k" on a catalog that
        // qualified on tool count instead.
        message:
          `tool search is recommended for this catalog (${find.deferBecause.map(one).join("; ")}), ` +
          `and ${affected.size} of ${find.toolCount} tool${affected.size === 1 ? " cannot" : "s cannot"} be singled out by a search. ` +
          `Once this catalog is deferred, a tool nothing surfaces costs nothing and does nothing.`,
        fixHint: "fix the descriptions above, or split the server so fewer tools compete in one catalog",
      },
    ];
  },
};

export const FIND_RULES: FindRule[] = [e141, e142, e143, e144, e145, e146];

/** E141-E146 are findability rules: reported by `efaimo find`, never part of a `check` grade. */
export function isFindabilityRuleId(id: string): boolean {
  return /^E14\d$/.test(id);
}
