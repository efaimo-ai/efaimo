import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const CLI = path.join(root, "dist", "cli.js");
const SKILLS = path.join(here, "fixtures", "skills");

function run(args: string[], cwd?: string) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--no-color"], { encoding: "utf8", cwd });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// The e2e suite runs the built CLI; CI builds before testing. Skip if no build.
const built = fs.existsSync(CLI);

describe.skipIf(!built)("cli e2e (built dist)", () => {
  it("prints its version", () => {
    const r = run(["--version"]);
    expect(r.code).toBe(0);
    // Derived, not typed. This was hardcoded "0.1.0" and would have had to be
    // hand-edited at every release: a version string in a test is one more
    // copy that drifts, and this file is asserting that the binary agrees with
    // package.json, not that it prints one particular number.
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(r.out.trim()).toBe(pkg.version);
  });

  it("rejects a non-numeric --timeout with a clear error (exit 2)", () => {
    const r = run(["check", "--mcp", "node whatever.js", "--timeout", "30s"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--timeout/);
  });

  it("emits a valid JSON envelope and exits 1 on a failing skill", () => {
    const r = run(["check", "--skill", path.join(SKILLS, "bad-skill"), "--json"]);
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.out);
    expect(parsed.tool).toBe("efaimo");
    expect(parsed.data.surface).toBe("skill");
    expect(parsed.data.findings.length).toBeGreaterThan(0);
  });

  it("enforces --max-tokens on a skill weigh (exit 1)", () => {
    const r = run(["weigh", path.join(SKILLS, "good-skill"), "--max-tokens", "1"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/budget exceeded/);
  });

  it("weighs a skill under budget cleanly (exit 0)", () => {
    const r = run(["weigh", path.join(SKILLS, "good-skill"), "--max-tokens", "100000"]);
    expect(r.code).toBe(0);
  });

  it("weigh --client skips a broken server and still weighs the rest (exit 0)", () => {
    const cfgDir = path.join(here, "fixtures", "clientcfg-mixed");
    const r = run(["weigh", "--client", "vscode", "--timeout", "20"], cfgDir);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/weigh mcp/); // the good fixture server produced a report
    expect(r.err).toMatch(/skipped vscode:broken/);
    expect(r.err).toMatch(/weighed 1 of 2 servers/);
  });

  it("weigh --client fails loudly when every server fails (exit 2)", () => {
    const cfgDir = path.join(here, "fixtures", "clientcfg-broken");
    const r = run(["weigh", "--client", "vscode", "--timeout", "20"], cfgDir);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/no server could be weighed/);
  });

  // `efaimo weigh > report.txt` should produce a readable file, not escape codes.
  // spawnSync gives the child a pipe, so stdout.isTTY is undefined here.
  it("writes no ANSI escapes when stdout is not a terminal", () => {
    const r = spawnSync(process.execPath, [CLI, "weigh", path.join(SKILLS, "good-skill")], {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: undefined },
    });
    expect(r.status).toBe(0);
    expect(r.stdout ?? "").not.toMatch(/\u001b\[/);
  });

  it("still colours a pipe when FORCE_COLOR asks for it", () => {
    const r = spawnSync(process.execPath, [CLI, "weigh", path.join(SKILLS, "good-skill")], {
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: undefined },
    });
    expect(r.status).toBe(0);
    expect(r.stdout ?? "").toMatch(/\u001b\[/);
  });

  it("names the window it measured against, and honours --window", () => {
    const dflt = run(["weigh", "--stdio", "node " + path.join(here, "fixtures", "mcp-server", "server.mjs")]);
    const narrow = run(["weigh", "--stdio", "node " + path.join(here, "fixtures", "mcp-server", "server.mjs"), "--window", "200000"]);
    expect(dflt.out).toMatch(/of a 1M window/);
    expect(narrow.out).toMatch(/of a 200k window/);
  });

  it("rejects a --window that would make the share meaningless (exit 2)", () => {
    const r = run(["weigh", path.join(SKILLS, "good-skill"), "--window", "0"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--window/);
  });

  // Readiness never moves the grade or the default exit code (ADR-014/027), so
  // a team that had migrated had no way to stay migrated. --strict-readiness is
  // the opt-in, and it must move the exit code WITHOUT moving the grade.
  describe("--strict-readiness", () => {
    const MCP = path.join(here, "fixtures", "mcp-server");
    const legacy = "node " + path.join(MCP, "server.mjs");
    const conformant = "node " + path.join(MCP, "server-rc.mjs");

    it("stays quiet by default on a server with items to migrate", () => {
      const r = run(["check", "--mcp", legacy, "--timeout", "20"]);
      expect(r.code).toBe(0);
    });

    it("exits 1 on the same server when asked to", () => {
      const r = run(["check", "--mcp", legacy, "--strict-readiness", "--timeout", "20"]);
      expect(r.code).toBe(1);
    });

    it("exits 0 on a conformant server, so it is usable as a CI gate", () => {
      const r = run(["check", "--mcp", conformant, "--strict-readiness", "--timeout", "20"]);
      expect(r.code).toBe(0);
    });

    it("moves the exit code without moving the grade", () => {
      const plain = run(["check", "--mcp", legacy, "--timeout", "20"]);
      const strict = run(["check", "--mcp", legacy, "--strict-readiness", "--timeout", "20"]);
      const grade = (s: string) => s.match(/grade\s+(\S+\s+\(\d+\))/)?.[1];
      expect(grade(strict.out)).toBe(grade(plain.out));
      expect(grade(strict.out)).toBeTruthy();
    });
  });

  describe("find", () => {
    const MCP = path.join(here, "fixtures", "mcp-server");
    const server = "node " + path.join(MCP, "server.mjs");

    it("reports both numbers with their denominators", () => {
      const r = run(["find", "--stdio", server, "--timeout", "20"]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/distinct\s+3\/3/);
      expect(r.out).toMatch(/probe\s+3\/3/);
    });

    it("says the probe is vacuous when the window covers the catalog", () => {
      // Three tools and a window of five: no tool can fall outside it, so the
      // 100% means nothing and the output has to say so on the page, not only
      // in a doc nobody opens.
      const r = run(["find", "--stdio", server, "--timeout", "20"]);
      expect(r.out).toMatch(/vacuous/i);
    });

    it("emits a JSON envelope carrying the ruleset that produced it", () => {
      const r = run(["find", "--stdio", server, "--json", "--timeout", "20"]);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.out);
      expect(parsed.kind).toBe("find");
      // Pinned by hand, like the inventory in meta.test.ts: "3" since S108.
      expect(parsed.rulesVersion).toBe("3");
      expect(parsed.data.distinct.total).toBe(3);
      expect(parsed.data.method.bm25.k1).toBe(1.2);
    });

    it("--no-timestamp makes two runs byte-identical", () => {
      // The point of the flag: an artifact that is committed or diffed must
      // not change when nothing measured changed.
      const a = run(["find", "--stdio", server, "--json", "--no-timestamp", "--timeout", "20"]);
      const b = run(["find", "--stdio", server, "--json", "--no-timestamp", "--timeout", "20"]);
      expect(a.out).toBe(b.out);
      expect(a.out).not.toMatch(/generatedAt/);
      // And the sabotage: with the stamp, they differ.
      expect(JSON.parse(run(["find", "--stdio", server, "--json", "--timeout", "20"]).out).generatedAt).toBeTruthy();
    });

    it("--min-distinct passes a catalog where every tool owns a word", () => {
      const r = run(["find", "--stdio", server, "--min-distinct", "100", "--timeout", "20"]);
      expect(r.code).toBe(0);
    });

    it("--min-distinct fails a catalog with two vocabulary-identical tools", () => {
      // The gate has to be able to go red against a real server, not only in a
      // unit test with a hand-built catalog.
      const r = run(["find", "--stdio", server, "--env", "FIXTURE_TOOLS=dup", "--min-distinct", "100", "--timeout", "20"]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/below --min-distinct/);
      expect(r.out).toMatch(/E141/);
    });

    it("refuses a skill path instead of pretending to search it", () => {
      const r = run(["find", path.join(SKILLS, "good-skill"), "--timeout", "20"]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/S103/);
    });

    it("rejects a --min-distinct above 100", () => {
      const r = run(["find", "--stdio", server, "--min-distinct", "101", "--timeout", "20"]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/percentage/);
    });
  });
});

describe.skipIf(!built)("find: gates that must not pass vacuously", () => {
  const server = "node " + path.join(here, "fixtures", "mcp-server", "server.mjs");

  it("refuses --min-distinct on a one-tool catalog instead of passing it", () => {
    // With one tool every term is trivially exclusive, so the figure is 100%
    // for any tool whatsoever. Exit 2, not 0: "this gate cannot be evaluated
    // here" is a different fact from "this gate passed", and a CI run that
    // silently goes green against a catalog nothing was measured on is the
    // failure this command exists to name.
    const r = run(["find", "--stdio", server, "--env", "FIXTURE_TOOLS=one", "--min-distinct", "100", "--timeout", "20"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/cannot be evaluated/);
  });

  it("still reports on a one-tool catalog, and says the number means nothing", () => {
    const r = run(["find", "--stdio", server, "--env", "FIXTURE_TOOLS=one", "--timeout", "20"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/vacuous/i);
  });

  it("rejects a fractional --top, which printed one window and used another", () => {
    const r = run(["find", "--stdio", server, "--top", "2.5", "--timeout", "20"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/whole number/);
  });
});

// Text the audited side wrote reached stderr raw: a config entry's name and
// command in the --client listing and the skip lines, and what a dying server
// put on stderr in the final error. ESC[2K in a server name could erase the
// line that lists what is about to run, which is the line --client prints so a
// reader can see it.
describe.skipIf(!built)("text from the audited side cannot drive the terminal", () => {
  const ESC = String.fromCharCode(27);

  it("--client: a hostile entry name and command", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "efaimo-hostile-"));
    try {
      fs.mkdirSync(path.join(dir, ".vscode"));
      fs.writeFileSync(
        path.join(dir, ".vscode", "mcp.json"),
        JSON.stringify({
          servers: {
            good: { command: "node", args: [path.join(here, "fixtures", "mcp-server", "server.mjs")] },
            [ESC + "[2Kevil"]: { command: "node", args: ["does-not-exist-" + ESC + "[31m.mjs"] },
          },
        }),
      );
      const r = run(["weigh", "--client", "vscode", "--timeout", "20"], dir);
      expect(r.code).toBe(0);
      // The entry was listed, tried and skipped, so the text did reach output.
      expect(r.err).toMatch(/\[2Kevil: node does-not-exist-\[31m\.mjs/);
      expect(r.err).toMatch(/skipped vscode:\[2Kevil: could not connect/);
      expect(r.err.includes(ESC), "an escape byte reached stderr").toBe(false);
      expect(r.out.includes(ESC), "an escape byte reached stdout").toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the final error: what a dying server wrote to stderr", () => {
    // Split in the source so the label (the command) cannot satisfy the match.
    const server = `node -e "process.stderr.write(String.fromCharCode(27)+'[2K'+'stderr'+'-tail');process.exit(1)"`;
    const r = run(["weigh", "--stdio", server, "--timeout", "10"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/server stderr: \[2Kstderr-tail/);
    expect(r.err.includes(ESC), "an escape byte reached stderr").toBe(false);
  });
});

// A URL's password and query values reached every line that names the target:
// "connecting to", the final error, the --client listing, and through the
// label the report itself. fetch also refuses a URL with credentials and puts
// the whole URL in its message, so the error line leaked it a second time.
describe.skipIf(!built)("secrets in a URL stay out of the output", () => {
  const url = "http://me:hunter2@127.0.0.1:9/mcp?token=abc123";

  it("as the target", () => {
    const r = run(["weigh", url, "--timeout", "5"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/me:\*\*\*@127\.0\.0\.1:9\/mcp\?token=\*\*\*/);
    expect(r.err + r.out).not.toMatch(/hunter2|abc123/);
  });

  it("in a --client config", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "efaimo-urlcfg-"));
    try {
      fs.mkdirSync(path.join(dir, ".vscode"));
      fs.writeFileSync(path.join(dir, ".vscode", "mcp.json"), JSON.stringify({ servers: { remote: { url } } }));
      const r = run(["weigh", "--client", "vscode", "--timeout", "5"], dir);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/remote: http:\/\/me:\*\*\*@/);
      expect(r.err + r.out).not.toMatch(/hunter2|abc123/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// `--out base.json --diff base.json` is the natural ratchet: compare with the
// last run, then keep this one. The write ran first, so the diff read back the
// run it was comparing and reported no change, whatever had changed.
describe.skipIf(!built)("--out and --diff naming the same file", () => {
  const server = "node " + path.join(here, "fixtures", "mcp-server", "server.mjs");

  it("weigh compares with the old run, then saves the new one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "efaimo-ratchet-"));
    const base = path.join(dir, "base.json");
    const total = () => JSON.parse(fs.readFileSync(base, "utf8")).data.totals.claudeStyle as number;
    try {
      expect(run(["weigh", "--stdio", server, "--out", base, "--timeout", "20"]).code).toBe(0);
      const before = total();
      // One tool instead of three, so this run is smaller than the baseline.
      const r = run(["weigh", "--stdio", server, "--env", "FIXTURE_TOOLS=one", "--out", base, "--diff", base, "--timeout", "20"]);
      expect(r.code).toBe(0);
      const after = total();
      expect(after).toBeLessThan(before);
      const m = r.out.match(/context budget diff \(Claude-style\): ([\d,]+) -> ([\d,]+)/);
      expect(m, "no diff line in the output").not.toBeNull();
      expect([m![1]!, m![2]!].map((s) => Number(s.replace(/,/g, "")))).toEqual([before, after]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check compares with the old run", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "efaimo-ratchet-"));
    const base = path.join(dir, "base.json");
    const skill = path.join(SKILLS, "good-skill");
    try {
      expect(run(["check", "--skill", skill, "--out", base]).code).toBe(0);
      // Lower the recorded grade, so the same skill checked again has improved.
      const env = JSON.parse(fs.readFileSync(base, "utf8"));
      env.data.grade = { ...env.data.grade, score: 50, letter: "F" };
      fs.writeFileSync(base, JSON.stringify(env));
      const r = run(["check", "--skill", skill, "--out", base, "--diff", base]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/improved 1\s+worsened 0\s+held 0/);
      expect(JSON.parse(fs.readFileSync(base, "utf8")).data.grade.score).toBeGreaterThan(50);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
