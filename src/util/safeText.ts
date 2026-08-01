// Text that came from the thing being audited must not be able to drive the
// terminal it is reported in.
//
// Tool names, titles, descriptions, server instructions, stderr tails and
// repo-scan excerpts all originate with the target. They were interpolated
// into stdout raw, so a hostile server could emit ESC[1A ESC[2K inside a tool
// name and rewrite the grade line printed above its own finding: the auditor
// reads "grade A (100), 0 errors" while the finding that contradicts it is
// erased. OSC 8 forges a hyperlink; OSC 52 writes the reader's clipboard.
// `--no-color` did not help, because that only suppresses the colours efaimo
// itself adds.
//
// This matters out of proportion to its severity. An auditing tool whose
// verdict can be rewritten by the thing it audits has a credibility problem
// before it has a security one, and the HTTP transport is exactly where a user
// expects no code execution and therefore no consequences.
//
// Applied at the RENDER boundary, never on ingestion: escape bytes in a
// description are real bytes that a model would receive and really do cost
// tokens, so `weigh` has to keep counting them. What must not happen is that
// they reach a terminal as control codes.
//
// JSON output needs no pass here: JSON.stringify already encodes control
// characters as  escape sequences, which are inert text.

// C0 except tab and newline, DEL, and the C1 block. C1 is included because a
// lone 0x9B is CSI in a terminal that decodes single-byte C1, which is the
// same attack without an ESC byte to grep for.
// Built from code points rather than written as literals so this file does not
// itself contain the bytes it exists to remove; the same reason gates.mjs next
// door builds its dash class with String.fromCharCode.
const CONTROLS = new RegExp(
  "[" +
    "\\u0000-\\u0008" + // C0 up to backspace (tab 0x09 and newline 0x0A kept)
    "\\u000B-\\u001F" + // vertical tab through unit separator, ESC included
    "\\u007F" + // DEL
    "\\u0080-\\u009F" + // C1, single-byte CSI/OSC among them
    "]",
  "g",
);

/**
 * Strip terminal control characters from text that originated outside efaimo.
 * Tab and newline survive because layout depends on them; everything else that
 * can move a cursor, clear a line, or address the terminal is removed.
 */
export function safeText(s: string): string {
  return s.replace(CONTROLS, "");
}

/** Same, for a value that may be undefined. */
export function safeTextOpt(s: string | undefined): string | undefined {
  return s === undefined ? undefined : safeText(s);
}
