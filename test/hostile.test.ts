import { describe, it, expect } from "vitest";
import type { ToolDef } from "../src/core/types.js";
import { analyzeFind } from "../src/find/find.js";
import { runFindRules } from "../src/core/engine.js";
import { renderFindPretty, renderFindFindingsPretty, setColor } from "../src/reporters/pretty.js";
import { renderFindMarkdown } from "../src/reporters/markdown.js";
import { tokenize, MAX_FIELD_CHARS } from "../src/find/tokenize.js";

/**
 * The audited thing must not be able to rewrite the auditor's verdict.
 *
 * Everything in a report comes from the server being audited, which may be
 * hostile, and `--md` is piped into GitHub step summaries by this project's own
 * CI documentation. The escaping machinery for that had existed for weeks and
 * had never once been watched go red; adversarial review then found two escapes
 * that did not work and one table that could be forged. These are the tests
 * that would have caught them.
 */

function hostile(name: string, description = "Does a thing with the thing."): ToolDef {
  return { name, description, inputSchema: { type: "object", properties: {} } };
}

/** Enough neighbours that the catalog is not trivially vacuous. */
const FILLER: ToolDef[] = [
  hostile("get_weather", "Look up the weather forecast for a city."),
  hostile("send_email", "Send an email message to a recipient."),
  hostile("create_invoice", "Create a billing invoice for a customer."),
  hostile("deploy_service", "Deploy a service to the production cluster."),
  hostile("resize_image", "Resize an image to the given dimensions."),
];

function report(tools: ToolDef[]): { pretty: string; md: string } {
  setColor(false);
  const f = analyzeFind("hostile", tools);
  const findings = runFindRules({ find: f });
  return {
    pretty: renderFindPretty(f) + "\n" + renderFindFindingsPretty(f, findings),
    md: renderFindMarkdown(f, findings),
  };
}

/**
 * Split a table row the way GFM does, so the test's model of the threat is the
 * renderer's model and not a friendlier one.
 *
 * A backslash escapes the character after it. That means `\\` is an escaped
 * BACKSLASH and any pipe following it is a live delimiter, which is exactly the
 * hole a naive `/(?<!\\)\|/` cannot see: written that way, this test passed
 * against a renderer that had the bug.
 */
function gfmCells(row: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!;
    if (c === "\\" && i + 1 < row.length) {
      cur += c + row[i + 1];
      i++;
      continue;
    }
    if (c === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur);
  return cells;
}

describe("a hostile server cannot forge the report", () => {
  it("cannot write a row in the terminal table with a newline", () => {
    // The forged row is shaped exactly like a real one: two leading spaces, a
    // right-aligned count, the name, then the vocabulary column.
    const forged = "      9  forged_tool                        weather, forecast, radar";
    const { pretty } = report([...FILLER, hostile(`nl_tool\n${forged}`)]);
    // The invariant is about LINES, not about the text: the forged characters
    // are still in the report, on the row they belong to, which is correct and
    // faithful. What must not happen is that they occupy a line of their own
    // shaped like a row of the table. One row per tool, no more.
    const rowShape = /^ {2}\s*\d+ {2}\S/;
    const rows = pretty.split("\n").filter((l) => rowShape.test(l));
    expect(rows).toHaveLength(6);
    expect(pretty.split("\n").some((l) => l.trimEnd().endsWith("weather, forecast, radar"))).toBe(false);
  });

  it("cannot emit a terminal escape sequence", () => {
    const ESC = String.fromCharCode(27);
    const BEL = String.fromCharCode(7);
    const { pretty, md } = report([
      ...FILLER,
      hostile(ESC + "[2A" + ESC + "[2K ansi_tool", "Clears" + ESC + "[31m the screen" + BEL + " and rings."),
    ]);
    for (const out of [pretty, md]) {
      expect(out.includes(ESC), "an escape byte reached the report").toBe(false);
      expect(out.includes(BEL)).toBe(false);
    }
  });

  it("cannot split a markdown table cell with an escaped backslash", () => {
    // `esc` turned backslash-pipe into `\\|`, which GFM reads as an escaped
    // BACKSLASH followed by a live delimiter. Cells past the header count are
    // dropped, so the real verdict column fell off the end of the row and the
    // server supplied its own.
    const { md } = report([...FILLER, hostile("evil\\|**0 problems**\\|ok")]);
    const row = md.split("\n").find((l) => l.includes("evil"));
    expect(row, "the hostile tool must appear in the table").toBeTruthy();
    // leading empty + 4 columns + trailing empty
    expect(gfmCells(row!)).toHaveLength(6);
  });

  it("cannot escape a markdown code span with a backtick", () => {
    // The old escape put a zero-width space BEFORE the backtick, which changes
    // nothing: a code span ends at the next backtick run whatever precedes it.
    // The rest of the name then rendered as live markup and a link in a tool
    // name became a link in the summary. A backtick cannot be escaped inside a
    // code span, so the only safe treatment is to not emit one.
    const { md } = report([...FILLER, hostile("tick`_tool [click](https://evil.example)")]);
    const row = md.split("\n").find((l) => l.includes("_tool"))!;
    const between = /`([^`]*_tool[^`]*)`/.exec(row);
    expect(between, "the name must sit inside one unbroken code span").toBeTruthy();
    expect(between![1]).not.toContain("`");
    // And the link text is therefore still inside that span, where it is inert.
    expect(between![1]).toContain("[click](https://evil.example)");
  });

  it("neutralises markdown and inline HTML in a finding message", () => {
    // Rule messages embed the tool name mid-sentence, outside any code span.
    const { md } = report([...FILLER, hostile("x <img src=z onerror=alert(1)> [a](b) *em*")]);
    const findingRows = md.split("\n").filter((l) => l.startsWith("| ") && l.includes("E14"));
    for (const r of findingRows) {
      expect(r).not.toContain("<img");
      expect(r).not.toContain("](b)");
    }
  });

  it("does not let a pathological description hold the process", () => {
    // The acronym split was quadratic on a run of capitals: 100k characters
    // took 7.7 seconds and 400k took 147. `find` tokenizes each description
    // twice, so one shouted argument description pinned a core for minutes
    // while weigh and check on the same server answered instantly.
    const shouted = "A".repeat(300_000);
    const t0 = Date.now();
    const terms = tokenize(shouted);
    const ms = Date.now() - t0;
    expect(ms, `tokenize took ${ms}ms`).toBeLessThan(1000);
    expect(terms.length).toBeGreaterThan(0);
  });

  it("bounds how much of one field it will read", () => {
    const huge = "word ".repeat(MAX_FIELD_CHARS); // far past the cap
    expect(tokenize(huge).length).toBeLessThanOrEqual(MAX_FIELD_CHARS / 2 + 1);
  });

  it("survives a schema built to blow the walker up", () => {
    // A wide, shallow schema charged no budget at all before, because the
    // counter only decremented on entering an object; and a single very long
    // property description crashed the walker with a RangeError, because the
    // tokens were appended with a spread.
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 50_000; i++) wide[`prop_${i}`] = true;
    const deep = { type: "object", properties: { q: { type: "string", description: "lorem ipsum ".repeat(60_000) } } };
    const t0 = Date.now();
    const f = analyzeFind("schemas", [
      ...FILLER,
      { name: "wide_tool", description: "Takes many arguments.", inputSchema: { type: "object", properties: wide } },
      { name: "deep_tool", description: "Takes one long argument.", inputSchema: deep },
    ]);
    expect(Date.now() - t0, "the walker must stay bounded").toBeLessThan(10_000);
    expect(f.toolCount).toBe(7);
  });

  it("reports duplicate tool names instead of confusing them", () => {
    // Two tools with the same name used to share one row's rank and score,
    // because the lookup matched on the name. The weaker one inherited the
    // stronger one's verdict and the headline moved the flattering way.
    // Same name AND same description, so both are probed with the same query
    // and one of them must come second. Under the old name-keyed lookup both
    // reported rank 1.
    const same = "Look up the weather forecast for a city and return conditions.";
    const f = analyzeFind("dup", [...FILLER, hostile("twin", same), hostile("twin", same)]);
    const rows = f.perTool.filter((t) => t.name === "twin");
    expect(rows).toHaveLength(2);
    expect([rows[0]!.rank, rows[1]!.rank].sort()).toEqual([1, 2]);
    expect(f.notes.join(" ")).toMatch(/more than one tool/);
  });
});
