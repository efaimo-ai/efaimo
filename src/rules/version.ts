/**
 * Which ruleset produced a report.
 *
 * The tool version does not answer this. A patch release can change what a
 * rule fires on without changing any documented behaviour (0.1.2 did exactly
 * that: E123 started matching `delete_file`, and every grade that rule touched
 * moved), so "efaimo 0.1.2 said A(95)" is only reproducible if the reader can
 * also tell which rules were running. Every JSON envelope now carries this.
 *
 * Values:
 *   "1"  every ruleset through efaimo 0.1.2. Reports from those versions carry
 *        no `rulesVersion` field at all; the absence IS the value.
 *   "2"  the first ruleset that declares itself. Adds the findability family
 *        (E141-E145), which no earlier version had.
 *
 * Bump it when a rule is added, removed, renumbered, or changed in what it
 * fires on. `test/meta.test.ts` pins the rule inventory, so an added or
 * removed rule cannot land without someone looking at this file. It cannot
 * detect a changed threshold inside an existing rule: that one is human
 * discipline, and this comment is where the discipline is written down.
 *
 * Deliberately not derived from package.json. Tying it to the release number
 * would make it move on every release whether or not a rule moved, which is
 * the thing it exists to distinguish.
 */
export const RULES_VERSION = "2";
