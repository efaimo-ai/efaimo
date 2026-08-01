import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.js";
import { MCP_RULES } from "../src/rules/mcp/index.js";
import { SKILL_RULES } from "../src/rules/skill/index.js";
import { loadClientServers } from "../src/targets/clientConfigs.js";
import { resolveTarget } from "../src/targets/resolve.js";
import { makeBadgeSvg, toShieldsEndpoint } from "../src/reporters/badge.js";
import { gradeFindings } from "../src/core/grade.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

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
    const ids = [...MCP_RULES, ...SKILL_RULES].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every rule id is documented in docs/RULES.md", () => {
    const rulesDoc = fs.readFileSync(path.join(root, "docs", "RULES.md"), "utf8");
    for (const r of [...MCP_RULES, ...SKILL_RULES]) {
      expect(rulesDoc, `RULES.md must document ${r.id}`).toContain(r.id);
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
