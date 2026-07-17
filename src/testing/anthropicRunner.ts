import type { Runner } from "./harness.js";

/**
 * The live runner. Used only by `efaimo test --live`, because every call spends
 * tokens on the caller's ANTHROPIC_API_KEY.
 */
export function anthropicRunner(apiKey: string): Runner {
  return async (req) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: 1024,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.user }],
      }),
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`anthropic API ${res.status}: ${body.slice(0, 160)}`);
    }
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (json.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
  };
}
