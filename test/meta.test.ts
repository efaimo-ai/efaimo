import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
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
