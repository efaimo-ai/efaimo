import { describe, it, expect } from "vitest";
import { redactUrl, redactUrlsIn, resolveTarget } from "../src/targets/resolve.js";

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
  it("keeps a URL's userinfo and query values out of the label", () => {
    const url = "https://me:hunter2@mcp.example.com/mcp?token=abc123&region=eu";
    const t = resolveTarget(url, {});
    expect(t).toMatchObject({ kind: "http", url });
    expect(t.label).toBe("https://***:***@mcp.example.com/mcp?token=***&region=***");
  });

  // A host that takes a token as the username (https://<token>@host/) has no
  // password and no query, and masking only those printed the token as typed.
  it("masks a token in the username position", () => {
    const t = resolveTarget("https://ghp_secret@mcp.example.com/x", {});
    expect(t.label).toBe("https://***@mcp.example.com/x");
    expect(redactUrl("http://ghp_secret:@127.0.0.1:9/mcp")).toBe("http://***@127.0.0.1:9/mcp");
  });

  // fetch refuses a URL with credentials and quotes the whole URL in its message.
  it("masks the username inside an error message too", () => {
    const msg = redactUrlsIn("Request cannot be constructed from a URL that includes credentials: https://ghp_secret@mcp.example.com/x");
    expect(msg).toBe("Request cannot be constructed from a URL that includes credentials: https://***@mcp.example.com/x");
  });

  // The label is also how check --diff pairs a server with its baseline, so a
  // URL with nothing to hide must not be normalised into a different string.
  it("leaves a URL with nothing to hide exactly as typed", () => {
    for (const url of ["https://mcp.example.com", "HTTP://Example.com:443/mcp", "https://mcp.example.com/mcp?"]) {
      expect(resolveTarget(url, {}).label).toBe(url);
    }
  });

  // A key with no `=` came out as `?sk_live_x=`, the key masked nothing, and a
  // fragment, where an OAuth implicit flow puts its token, passed as typed.
  it("masks a query key that carries no value, and drops the fragment", () => {
    expect(redactUrl("https://h.example/mcp?sk_live_x")).toBe("https://h.example/mcp?***");
    expect(redactUrl("https://h.example/mcp?sk_live_x&region=eu")).toBe("https://h.example/mcp?***&region=***");
    expect(redactUrl("https://h.example/mcp#access_token=abc123")).toBe("https://h.example/mcp");
  });

  // A stdio label was the command as typed, and mcp-remote takes the URL and
  // the auth header as arguments, so both went into the report, --out and diffs.
  it("masks URLs and bearer tokens in a stdio label", () => {
    const cmd = 'npx -y mcp-remote https://h.example/mcp?api_key=SECRET --header "Authorization: Bearer tok123"';
    const shown = 'npx -y mcp-remote https://h.example/mcp?api_key=*** --header "Authorization: Bearer ***"';
    expect(resolveTarget(cmd, {}).label).toBe(shown);
    expect(resolveTarget(cmd, { forceStdio: true }).label).toBe(shown);
    expect(resolveTarget(cmd, {})).toMatchObject({ kind: "stdio", args: expect.arrayContaining(["Authorization: Bearer tok123"]) });
    // Nothing to hide, nothing changed, so a baseline still pairs.
    expect(resolveTarget("npx -y some-server --port 3000", {}).label).toBe("npx -y some-server --port 3000");
  });
});
