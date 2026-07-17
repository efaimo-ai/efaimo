import type { Runner } from "./harness.js";

/**
 * The OpenAI live runner (Chat Completions). Used by `efaimo test --live` when the
 * scenario model is an OpenAI model. Spends tokens on the caller's OPENAI_API_KEY.
 */
export function openaiRunner(apiKey: string): Runner {
  return async (req) => {
    const messages: { role: string; content: string }[] = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.user });
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: req.model, messages, max_completion_tokens: 1024 }),
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`openai API ${res.status}: ${body.slice(0, 160)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content ?? "";
  };
}

/**
 * Pick a provider from the model name. Returns "unknown" for a model that is
 * neither a recognized OpenAI nor Claude name, so the caller can fail clearly
 * instead of silently routing, say, a Gemini model to the Anthropic API.
 */
export function providerForModel(model: string): "openai" | "anthropic" | "unknown" {
  if (/^(gpt|o[0-9]|chatgpt|text-|davinci)/i.test(model)) return "openai";
  if (/^claude/i.test(model)) return "anthropic";
  return "unknown";
}
