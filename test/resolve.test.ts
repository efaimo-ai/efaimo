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
});
