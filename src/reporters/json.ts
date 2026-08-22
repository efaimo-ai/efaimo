import { VERSION } from "../version.js";
import { RULES_VERSION } from "../rules/version.js";

export type EnvelopeKind = "check" | "weigh" | "test" | "find";

export interface EnvelopeOptions {
  /**
   * Include `generatedAt`. Default true for a report a human reads.
   *
   * Off for anything meant to be committed, diffed or compared. A wall-clock
   * stamp inside the payload makes every regeneration a diff even when not one
   * measured number moved, which is how a re-run that changed nothing still
   * produces a commit that has to be reviewed as though it might have. This
   * project has shipped several releases whose only data change was described
   * in its own notes as "stamp-only".
   *
   * `--out` baselines always drop it: a baseline exists to be compared against,
   * and a field that differs on every write is the one field a comparison must
   * ignore.
   */
  timestamp?: boolean;
}

export function toJsonEnvelope(kind: EnvelopeKind, data: unknown, opts: EnvelopeOptions = {}): string {
  return JSON.stringify(
    {
      tool: "efaimo",
      version: VERSION,
      // Which ruleset produced this. The tool version alone does not say it: a
      // patch release can change what a rule fires on, and every published
      // grade is only reproducible if the reader can tell which rules were
      // being run. See src/rules/version.ts.
      //
      // Only where rules actually ran. `weigh` counts tokens and `test` runs
      // trials; neither evaluates a rule, and stamping a ruleset onto their
      // output would be a report asserting which rules produced it when none
      // did.
      ...(kind === "check" || kind === "find" ? { rulesVersion: RULES_VERSION } : {}),
      kind,
      ...(opts.timestamp === false ? {} : { generatedAt: new Date().toISOString() }),
      data,
    },
    null,
    2,
  );
}
