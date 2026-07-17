import { describe, it, expect } from "vitest";
import { countTokens } from "../src/weigh/tokens.js";
import { serializeClaudeStyle, serializeSingle, toolToClaudeLine } from "../src/weigh/serializers.js";
import { diffServerWeigh } from "../src/weigh/diff.js";
import type { ServerWeighResult, ToolDef } from "../src/core/types.js";

const TOOLS: ToolDef[] = [
  { name: "add", description: "Add two numbers and return the sum.", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
  { name: "sub", description: "Subtract b from a.", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } } },
];

describe("token counting", () => {
  it("is deterministic", async () => {
    const a = await countTokens("the quick brown fox jumps over the lazy dog");
    const b = await countTokens("the quick brown fox jumps over the lazy dog");
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it("counts more tokens for longer text", async () => {
    const short = await countTokens("hello");
    const long = await countTokens("hello ".repeat(50));
    expect(long).toBeGreaterThan(short);
  });
});

describe("serializers", () => {
  it("claude-style wraps each tool in a function block", () => {
    const s = serializeClaudeStyle(TOOLS);
    expect(s).toContain("<functions>");
    expect(s).toContain("</function>");
    expect(s).toContain('"name":"add"');
  });

  it("single serialization is a subset of the batch", () => {
    const single = serializeSingle(TOOLS[0]!);
    expect(single.claudeStyle).toBe(toolToClaudeLine(TOOLS[0]!));
  });
});

describe("diff", () => {
  function weigh(tokens: number[]): ServerWeighResult {
    return {
      kind: "mcp",
      label: "x",
      toolCount: tokens.length,
      resourceCount: 0,
      promptCount: 0,
      perTool: tokens.map((t, i) => ({
        name: `t${i}`,
        tokens: { rawJson: t, claudeStyle: t, openaiTools: t },
        descriptionTokens: 0,
        schemaTokens: 0,
      })),
      totals: { rawJson: sum(tokens), claudeStyle: sum(tokens), openaiTools: sum(tokens) },
      instructionsTokens: 0,
      notes: [],
    };
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it("computes delta and percent", () => {
    const d = diffServerWeigh(weigh([100, 100]), weigh([100, 150]));
    expect(d.before).toBe(200);
    expect(d.after).toBe(250);
    expect(d.delta).toBe(50);
    expect(d.pct).toBeCloseTo(25);
    expect(d.toolChanges.some((c) => c.name === "t1")).toBe(true);
  });

  it("handles added and removed tools", () => {
    const d = diffServerWeigh(weigh([100]), weigh([100, 80]));
    expect(d.toolChanges.find((c) => c.name === "t1")?.before).toBeUndefined();
    expect(d.toolChanges.find((c) => c.name === "t1")?.after).toBe(80);
  });
});
