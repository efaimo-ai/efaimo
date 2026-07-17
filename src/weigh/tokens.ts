let encodeFn: ((text: string) => number[]) | null = null;

/**
 * Token counts use OpenAI's o200k_base as the canonical tokenizer: it is
 * publicly reproducible, and vendor tokenizers track each other closely on
 * English/JSON text. Anthropic-exact counts are available via the
 * count_tokens API when a key is provided. See docs/METHODOLOGY.md.
 *
 * Load the tokenizer once, then count synchronously. Weighing tokenizes many
 * strings in a loop; awaiting each one adds a microtask hop per string for no
 * benefit, since the underlying encode is synchronous.
 */
export async function loadTokenizer(): Promise<(text: string) => number> {
  if (!encodeFn) {
    const mod = await import("gpt-tokenizer/encoding/o200k_base");
    encodeFn = mod.encode;
  }
  const enc = encodeFn;
  return (text: string) => enc(text).length;
}

export async function countTokens(text: string): Promise<number> {
  const count = await loadTokenizer();
  return count(text);
}
