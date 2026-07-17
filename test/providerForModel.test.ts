import { describe, it, expect } from "vitest";
import { providerForModel } from "../src/testing/openaiRunner.js";

describe("providerForModel", () => {
  it("routes Claude names to anthropic", () => {
    expect(providerForModel("claude-sonnet-5")).toBe("anthropic");
    expect(providerForModel("claude-opus-4-8")).toBe("anthropic");
  });

  it("routes OpenAI names to openai", () => {
    for (const m of ["gpt-4o-mini", "gpt-5", "o1", "o3-mini", "chatgpt-4o-latest"]) {
      expect(providerForModel(m)).toBe("openai");
    }
  });

  it("returns unknown for an unsupported provider instead of misrouting", () => {
    for (const m of ["gemini-2.0-flash", "mistral-large", "llama-3.1", "grok-2"]) {
      expect(providerForModel(m)).toBe("unknown");
    }
  });
});
