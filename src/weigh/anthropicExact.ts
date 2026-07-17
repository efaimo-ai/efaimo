import type { ToolDef } from "../core/types.js";

const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Exact tool-definition cost for Claude models, measured as the delta of
 * /v1/messages/count_tokens with and without the tools array (the endpoint
 * accepts `tools`; verified against the official API reference 2026-07-16).
 * Returns undefined on any failure; callers treat this as optional precision.
 */
export async function countClaudeToolTokens(
  tools: ToolDef[],
  opts: { apiKey: string; model?: string },
): Promise<number | undefined> {
  const model = opts.model ?? DEFAULT_MODEL;
  const base = { model, messages: [{ role: "user", content: "hi" }] };
  const apiTools = tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: (t.inputSchema as object) ?? { type: "object", properties: {} },
  }));
  try {
    const [withTools, withoutTools] = await Promise.all([
      postCount({ ...base, tools: apiTools }, opts.apiKey),
      postCount(base, opts.apiKey),
    ]);
    if (withTools === undefined || withoutTools === undefined) return undefined;
    const delta = withTools - withoutTools;
    return delta >= 0 ? delta : undefined;
  } catch {
    return undefined;
  }
}

async function postCount(body: unknown, apiKey: string): Promise<number | undefined> {
  const res = await fetch(COUNT_TOKENS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as { input_tokens?: number };
  return typeof json.input_tokens === "number" ? json.input_tokens : undefined;
}
