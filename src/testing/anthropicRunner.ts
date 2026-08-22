import type { Runner } from "./harness.js";

/**
 * Which Claude models still accept `temperature` / `top_p` / `top_k`.
 *
 * Sampling parameters were removed from the Claude 4.7 line onward and now
 * return a 400 on Fable 5, Opus 5, Opus 4.8, Opus 4.7 and Sonnet 5. This
 * runner used to send `temperature` on every request, and the scenario default
 * model is `claude-sonnet-5`, so `efaimo test --live` sent a rejected
 * parameter on its first call; `isTransient()` correctly does not retry a 400,
 * so the whole scenario threw before a single trial completed.
 *
 * Nothing in the suite could see it. The runner is injected precisely so the
 * A/B logic can be tested without spending tokens, which means every test in
 * this repo exercises a fake and none of them ever built this request body.
 * The fix is therefore paired with a test that asserts on the body itself.
 *
 * The list is an ALLOWLIST of models that accept the parameter, and it is
 * closed: it names model lines that already shipped, so it cannot go stale in
 * the direction that breaks a run. A model released after this was written is
 * unknown to it and gets no `temperature`, which costs a little determinism on
 * the judge and cannot cost a 400. The opposite shape - a denylist of models
 * that reject it - would fail every future release by default.
 */
export function acceptsSamplingParams(model: string): boolean {
  return /^claude-(3|(sonnet|haiku|opus)-4-5|(opus|sonnet)-4-6)\b/i.test(model);
}

/** The request body, split out so a test can assert on it without a network call. */
export function anthropicRequestBody(req: {
  model: string;
  system?: string;
  user: string;
  deterministic?: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: 1024,
    ...(req.system ? { system: req.system } : {}),
    messages: [{ role: "user", content: req.user }],
  };
  // 0 for the judge, 1 for the subject (see RunnerRequest.deterministic), but
  // only where the model still has the parameter. Where it does not, the
  // subject arm is unaffected (1 was the default anyway) and the judge simply
  // is not pinned; `runScenario` is told so it can say it in the report,
  // because an unpinned judge is variance that lands in the measurement.
  if (acceptsSamplingParams(req.model)) body.temperature = req.deterministic ? 0 : 1;
  return body;
}

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
      body: JSON.stringify(anthropicRequestBody(req)),
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
