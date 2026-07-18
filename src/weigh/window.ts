/**
 * The context window a token count is reported as a share of.
 *
 * There is no single correct denominator: it is a property of the model the
 * host happens to be running, not of the server being measured. Every current
 * frontier Claude model (Fable 5, Opus 4.8/4.7/4.6, Sonnet 5, Sonnet 4.6) is
 * 1M; Haiku 4.5 is 200K, as are many non-Claude and local models, where the
 * same tool definitions cost 5x the share shown here.
 *
 * So the share is always printed with the window it was computed against, and
 * `--window` lets the caller name their own. The absolute token count is the
 * number efaimo actually stands behind; this is a readability aid on top of it.
 *
 * Note that no rule grades on this share -- E128's thresholds are absolute
 * token counts, so changing the window never moves a grade.
 */
export const DEFAULT_CONTEXT_WINDOW = 1_000_000;

let contextWindow = DEFAULT_CONTEXT_WINDOW;

export function setContextWindow(tokens: number): void {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    throw new Error(`--window must be a positive number of tokens, got ${tokens}`);
  }
  contextWindow = tokens;
}

export function getContextWindow(): number {
  return contextWindow;
}

/** "1M", "200k", "128k", "4,096" -- how the window is named in output. */
export function formatWindow(tokens: number = contextWindow): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${tokens / 1_000}k`;
  return tokens.toLocaleString("en-US");
}

/**
 * "~0.1% of a 1M window" -- always names the denominator, so the reader is
 * never left guessing which model it assumed.
 */
export function formatWindowShare(tokens: number, window: number = contextWindow): string {
  const pct = (tokens / window) * 100;
  const shown = pct < 0.1 && pct > 0 ? "<0.1" : pct.toFixed(1);
  return `~${shown}% of a ${formatWindow(window)} window`;
}
