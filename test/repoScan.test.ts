import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo } from "../src/targets/repoScan.js";
import { checkMcpRepoOnly } from "../src/check/check.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, "fixtures", "repo");

function tempRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "efaimo-repo-"));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

describe("repo scan", () => {
  it("detects deprecated primitive usage", () => {
    const scan = scanRepo(REPO);
    const cats = new Set(scan.matches.map((m) => m.category));
    expect(cats.has("sampling")).toBe(true);
    expect(cats.has("roots")).toBe(true);
    expect(cats.has("logging")).toBe(true);
    expect(cats.has("session-state")).toBe(true);
  });

  it("detects the legacy SDK dependency", () => {
    const scan = scanRepo(REPO);
    expect(scan.sdk?.some((s) => s.package === "@modelcontextprotocol/sdk" && s.generation === "legacy")).toBe(true);
  });

  it("check --repo-only surfaces E101/E102/E103/E104 findings", () => {
    const report = checkMcpRepoOnly(REPO, "fixture-repo");
    const ids = new Set(report.findings.map((f) => f.ruleId));
    expect(ids.has("E101")).toBe(true);
    expect(ids.has("E102")).toBe(true);
    expect(ids.has("E103")).toBe(true);
    expect(ids.has("E104")).toBe(true);
  });

  it("does not treat sibling packages (mcp-agent, mcpengine) as the mcp SDK", () => {
    const dir = tempRepo({ "requirements.txt": "mcp-agent==1.0.0\nmcpengine>=2\nfastapi\n" });
    try {
      const scan = scanRepo(dir);
      expect(scan.sdk?.some((s) => s.package === "mcp")).not.toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects the mcp 2.x (RC) generation from a version specifier", () => {
    const dir = tempRepo({ "requirements.txt": "mcp>=2.0.0\n" });
    try {
      const scan = scanRepo(dir);
      expect(scan.sdk?.some((s) => s.package === "mcp" && s.generation === "rc")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
