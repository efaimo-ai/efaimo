import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.js";
import { MCP_RULES } from "../src/rules/mcp/index.js";
import { SKILL_RULES } from "../src/rules/skill/index.js";
import { FIND_RULES, isFindabilityRuleId } from "../src/rules/find/index.js";
import { isReadinessRuleId } from "../src/rules/mcp/index.js";
import { RULES_VERSION } from "../src/rules/version.js";
import { loadClientServers } from "../src/targets/clientConfigs.js";
import { resolveTarget } from "../src/targets/resolve.js";
import { makeBadgeSvg, toShieldsEndpoint } from "../src/reporters/badge.js";
import { gradeFindings } from "../src/core/grade.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

/** Every rule the CLI can run, across all three families. */
const ALL_RULES = [...MCP_RULES, ...SKILL_RULES, ...FIND_RULES];

describe("meta", () => {
  it("VERSION matches package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  // The third version string in the repo, and the only one nothing watched.
  // SKILL.md ships in package.json's files list and is what `npx skills add
  // efaimo-ai/efaimo` installs, so a stale number here is a version an agent
  // reads and reports to a user. Given how this project actually fails - a
  // hand-maintained number quietly going stale next to a derived one - an
  // unpinned duplicate is a scheduled bug, not a hypothetical.
  it("SKILL.md frontmatter version matches package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
    const skill = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
    const m = skill.match(/^\s{2}version:\s*"([^"]+)"/m);
    expect(m, "no `  version: \"x.y.z\"` line under metadata in SKILL.md").not.toBeNull();
    expect(m![1]).toBe(pkg.version);
  });

  it("rule ids are unique", () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every rule id is documented in docs/RULES.md", () => {
    const rulesDoc = fs.readFileSync(path.join(root, "docs", "RULES.md"), "utf8");
    for (const r of ALL_RULES) {
      expect(rulesDoc, `RULES.md must document ${r.id}`).toContain(r.id);
    }
  });

  // The rule inventory, pinned by hand.
  //
  // `rulesVersion` in every JSON envelope claims to say which ruleset produced
  // a report, and a claim nothing checks is a comment. This is the check: add,
  // remove or renumber a rule and this list fails, which puts the author in
  // src/rules/version.ts deciding whether the version has to move.
  //
  // What it cannot do, stated so nobody trusts it further than it goes: it
  // does not see a changed threshold or a rewritten matcher inside an existing
  // rule. 0.1.2 fixed E123 so it finally matched `delete_file`, and every id
  // in this list would have been identical before and after. That case is
  // human discipline; this only guarantees the inventory.
  //
  // A literal list, not a hash: a reviewer can read `"E146"` appearing in a
  // diff and know what happened, and a changed hash teaches them nothing and
  // gets updated without thought.
  it("the rule inventory is what src/rules/version.ts was last reasoned about", () => {
    expect(ALL_RULES.map((r) => r.id).sort()).toEqual([
      "E101", "E102", "E103", "E104", "E105", "E106", "E107", "E108", "E109",
      "E110", "E111", "E112", "E113", "E114", "E115", "E116", "E117", "E118",
      "E121", "E122", "E123", "E124", "E125", "E126", "E127", "E128", "E130",
      "E141", "E142", "E143", "E144", "E145", "E146",
      "S101", "S102", "S103", "S104", "S105", "S106",
    ]);
    // An empty family would pass the loops below without this. The dash guard
    // further down this file makes the same assertion about its own harvest.
    expect(FIND_RULES.length).toBe(6);
    // The findability family arrived with ruleset "2". If this list ever
    // changes again, that number has to move with it.
    expect(RULES_VERSION).toBe("2");
  });

  it("findability rule ids do not collide with the readiness range", () => {
    // `isReadinessRuleId` splits a check report into graded and ungraded
    // halves with /^E1(0|1)\d$/. E14x has to stay outside it or a findability
    // finding would be filed as a migration item.
    for (const r of FIND_RULES) {
      expect(isReadinessRuleId(r.id), `${r.id} must not read as a readiness rule`).toBe(false);
      expect(isFindabilityRuleId(r.id)).toBe(true);
    }
    for (const r of MCP_RULES) {
      expect(isFindabilityRuleId(r.id), `${r.id} must not read as a findability rule`).toBe(false);
    }
  });

  // Several working docs live in this directory but are kept out of the repo
  // through .git/info/exclude, which is local and therefore invisible to anyone
  // reading .gitignore. So a published file can cite a doc that no reader can
  // open, and nothing says so: this repo went public with STATE, DECISIONS and
  // SITE-HANDOFF staying private, and the first commit after that added two
  // such citations. Tracked files only, so this works in a fresh clone where
  // the private docs do not exist at all.
  it("no published file cites a doc that was never published", () => {
    const tracked = new Set(
      execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean),
    );
    const docsDir = "docs" + "/";
    const ref = new RegExp(`${docsDir}[A-Za-z0-9._-]+\\.md`, "g");
    const offenders: string[] = [];
    let scanned = 0;
    for (const f of tracked) {
      if (!/\.(md|ya?ml|ts|mjs|json)$/.test(f)) continue;
      if (f === "test/meta.test.ts") continue; // builds the pattern above
      scanned++;
      for (const m of fs.readFileSync(path.join(root, f), "utf8").matchAll(ref)) {
        if (!tracked.has(m[0])) offenders.push(`${f} cites ${m[0]}`);
      }
    }
    // Empty harvest is a failure: if the scan stops finding files, it stops
    // being a check while still reporting green.
    expect(scanned, "scanned no files, so this proves nothing").toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  // House rule, everywhere in this project: ASCII hyphen only, no em (U+2014) or
  // en (U+2013) dash, in copy, in comments that ship, in CSS, in the run
  // captures the site quotes. The site enforces it in gates.mjs and the router
  // in check-orientation, but the CLI's own tree had no guard, so a dash in a
  // source comment or a doc could ship unnoticed. Tracked files only: a fresh
  // clone has no skills-index corpus (gitignored, and full of other people's
  // dashes), so this checks exactly what this repo versions. Bytes, not a regex
  // on a decoded string, because the decode is where a byte check goes blind.
  it("no em or en dash in tracked text (ASCII hyphen only)", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
    const TEXT = /\.(md|mjs|cjs|js|ts|tsx|jsx|css|json|jsonc|txt|ya?ml|html|svg|toml)$/;
    // No-extension text that still ships or is authored, matched by basename.
    // NOTICE is in package.json's `files`, so it reaches every `npm i`, and
    // nothing else guarded it; this mirrors the skill guard's own NOEXT set.
    const NOEXT = new Set(["LICENSE", "NOTICE"]);
    // Exempt ONLY machine-generated files no human authors (an upstream dep can
    // put a dash in the lockfile) and, in future, a fixture that must contain
    // the character it tests. A dash in a real authored file is a bug to fix.
    const EXEMPT = new Set<string>(["pnpm-lock.yaml"]);
    const offenders: string[] = [];
    let scanned = 0;
    for (const f of tracked) {
      if (!(TEXT.test(f) || NOEXT.has(path.basename(f))) || EXEMPT.has(f)) continue;
      scanned++;
      const buf = fs.readFileSync(path.join(root, f));
      for (let i = 0; i < buf.length - 2; i++) {
        if (buf[i] === 0xe2 && buf[i + 1] === 0x80 && (buf[i + 2] === 0x94 || buf[i + 2] === 0x93)) {
          const line = buf.subarray(0, i).toString("utf8").split("\n").length;
          offenders.push(`${f}:${line} has an ${buf[i + 2] === 0x94 ? "em" : "en"} dash`);
          break; // one hit per file is enough to fail and locate it
        }
      }
    }
    // Empty harvest is a failure: if ls-files or the filter stops matching, the
    // guard stops guarding while still reporting green.
    expect(scanned, "scanned no text files, so this proves nothing").toBeGreaterThan(20);
    expect(offenders, "ASCII hyphen only; replace these with a hyphen").toEqual([]);
  });
});

describe("grade", () => {
  it("clean report is an A", () => {
    expect(gradeFindings([]).letter).toBe("A");
  });
  it("errors sink the grade", () => {
    const g = gradeFindings(Array.from({ length: 3 }, () => ({ ruleId: "E", severity: "error" as const, title: "", message: "" })));
    expect(g.score).toBe(55);
    expect(g.letter).toBe("F");
  });
});

describe("target resolution", () => {
  it("routes URLs to http", () => {
    expect(resolveTarget("https://x.example/mcp").kind).toBe("http");
  });
  it("routes a stdio command string", () => {
    const t = resolveTarget("npx -y some-server", { forceStdio: true });
    expect(t.kind).toBe("stdio");
    if (t.kind === "stdio") {
      expect(t.command).toBe("npx");
      expect(t.args).toEqual(["-y", "some-server"]);
    }
  });
});

describe("client config parsing", () => {
  it("parses claude-desktop-style config from a temp file", () => {
    const tmp = path.join(here, "fixtures", "clientcfg");
    fs.mkdirSync(path.join(tmp, ".cursor"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { demo: { command: "node", args: ["s.js"] }, remote: { url: "https://x/mcp" } } }),
    );
    const prev = process.cwd();
    try {
      const res = loadClientServers("cursor", tmp);
      const names = res.entries.map((e) => e.name).sort();
      expect(names).toEqual(["demo", "remote"]);
      expect(res.entries.find((e) => e.name === "remote")!.target.kind).toBe("http");
    } finally {
      process.chdir(prev);
    }
  });
});

describe("badge", () => {
  it("emits valid-looking svg and shields json", () => {
    const svg = makeBadgeSvg("context cost", "1.2k tok", "#3fb950");
    expect(svg).toContain("<svg");
    expect(svg).toContain("1.2k tok");
    const json = JSON.parse(toShieldsEndpoint({ label: "efaimo", message: "A (95)", color: "#3fb950" }));
    expect(json.schemaVersion).toBe(1);
    expect(json.color).toBe("3fb950");
  });
});
