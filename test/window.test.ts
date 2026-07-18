import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  formatWindow,
  formatWindowShare,
  getContextWindow,
  setContextWindow,
} from "../src/weigh/window.js";
import { MCP_RULES } from "../src/rules/mcp/index.js";
import type { ServerWeighResult } from "../src/core/types.js";

afterEach(() => setContextWindow(DEFAULT_CONTEXT_WINDOW));

function weighWithTotal(claudeStyle: number): ServerWeighResult {
  return {
    kind: "mcp",
    label: "test",
    toolCount: 1,
    resourceCount: 0,
    promptCount: 0,
    perTool: [],
    totals: { rawJson: claudeStyle, claudeStyle, openaiTools: claudeStyle },
    framingTokens: 0,
    instructionsTokens: 0,
    notes: [],
  } as unknown as ServerWeighResult;
}

describe("context window", () => {
  it("defaults to 1M, matching current frontier Claude models", () => {
    expect(DEFAULT_CONTEXT_WINDOW).toBe(1_000_000);
    expect(getContextWindow()).toBe(1_000_000);
  });

  it("names the denominator it used, so the share is never a hidden assumption", () => {
    expect(formatWindowShare(58_959)).toBe("~5.9% of a 1M window");
    expect(formatWindowShare(58_959, 200_000)).toBe("~29.5% of a 200k window");
  });

  it("does not round a small but non-zero share down to 0.0%", () => {
    expect(formatWindowShare(120)).toBe("~<0.1% of a 1M window");
    expect(formatWindowShare(0)).toBe("~0.0% of a 1M window");
  });

  it("formats windows the way people write them", () => {
    expect(formatWindow(1_000_000)).toBe("1M");
    expect(formatWindow(200_000)).toBe("200k");
    expect(formatWindow(128_000)).toBe("128k");
    expect(formatWindow(4_096)).toBe("4,096");
  });

  it("rejects a window that would produce a nonsense share", () => {
    expect(() => setContextWindow(0)).toThrow(/positive/);
    expect(() => setContextWindow(-1)).toThrow(/positive/);
    expect(() => setContextWindow(Number.NaN)).toThrow(/positive/);
    expect(getContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("E128 grades on absolute tokens, so --window never moves a grade", () => {
    const e128 = MCP_RULES.find((r) => r.id === "E128");
    expect(e128).toBeDefined();

    const ctx = { weigh: weighWithTotal(26_000) } as never;
    const atDefault = e128!.check(ctx);
    setContextWindow(200_000);
    const atNarrowWindow = e128!.check(ctx);

    // Same severity and count either way: only the printed share differs.
    expect(atNarrowWindow.map((f) => f.severity)).toEqual(atDefault.map((f) => f.severity));
    expect(atDefault[0]?.message).toContain("1M window");
    expect(atNarrowWindow[0]?.message).toContain("200k window");

    // And a total under the absolute threshold stays silent regardless.
    setContextWindow(1_000);
    expect(e128!.check({ weigh: weighWithTotal(9_000) } as never)).toEqual([]);
  });
});
