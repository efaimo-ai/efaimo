#!/usr/bin/env node
// Run what CI runs, before pushing.
//
// Why this exists. On 2026-09-02 two pushes landed on a red CI in a row. Both
// times the local check had been `typecheck`, `build` and `test`, all green,
// and both times CI failed on `pnpm audit`, a step the local run never
// touched. The claim "verified locally" and the claim "CI will pass" were
// different claims about different sets, and nothing said so out loud.
//
// The fix is not discipline, it is derivation. This reads the steps out of
// `.github/workflows/ci.yml` and runs them, so a step added to CI is a step
// this runs too. A hand-copied list is the same bug one level up: it agrees on
// the day it is written and drifts silently afterwards.
//
// What happens to a step CI gains depends on its kind, and the difference
// matters enough to say precisely, because the first draft of this comment got
// it wrong and a sabotage caught the overstatement:
//
//   - A new `run:` step is RUN, automatically. That is the whole point of
//     deriving the list; it appears in the output and in the step count.
//   - A new `uses:` step is a HARD STOP, because an action cannot be executed
//     here. Someone has to either declare why it cannot run locally or teach
//     this script about it.
//
// Three ways of finding nothing are failures, not passes:
//
//   1. Zero steps parsed. A walk that stops finding steps stops checking while
//      still exiting 0, which is the shape of every vacuous pass.
//   2. An unrecognised `uses:` step, as above.
//   3. A declared skip whose step has left CI. The reason is then describing
//      something that no longer exists, and the next reader trusts it.
//
// Conditional steps are reported rather than evaluated. CI runs a matrix and
// this machine is one cell of it, so a step carrying `if:` is run here with
// its condition printed, which makes the assumption visible instead of
// letting the output imply CI-equivalence it has not got.
//
// usage:
//   node scripts/preflight.mjs          run the whole CI gate
//   node scripts/preflight.mjs --fast   skip the network smoke test, and SAY SO
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "ci.yml");
const FAST = process.argv.includes("--fast");
const JOB = "build-test";

// Steps CI runs that this cannot, each with the reason it cannot. Keyed by the
// `uses:` value or by an exact `run:` body. A reason is a claim, so it says
// what the step actually covers rather than "not needed locally".
const DECLARED_SKIPS = new Map([
  ["actions/checkout", "CI fetches the repository; locally the working tree is already the thing under test."],
  ["pnpm/action-setup", "CI installs pnpm; the local version is asserted below instead."],
  ["actions/setup-node", "CI installs Node; the local version is reported below. A matrix of two Node versions on two operating systems cannot be reproduced on one machine, so this script is evidence about one cell of four."],
  ["./", "The composite Action runs the PUBLISHED package through npx, not this checkout. It tests action.yml against npm, which no run of the local tree can stand in for. If action.yml changed, only CI can tell you."],
]);

if (!existsSync(WORKFLOW)) {
  console.error(`preflight: ${WORKFLOW} is missing. Either CI moved or this script is aimed at nothing; do not read a pass out of it.`);
  process.exit(2);
}

const wf = parse(readFileSync(WORKFLOW, "utf8"));
const steps = wf?.jobs?.[JOB]?.steps;
if (!Array.isArray(steps) || steps.length === 0) {
  console.error(`preflight: parsed 0 steps from job "${JOB}" in ci.yml. A gate that found nothing to run is not a gate.`);
  process.exit(2);
}

const plan = [];
const unrecognised = [];
for (const step of steps) {
  const label = step.name ?? (step.uses ? `uses ${step.uses}` : String(step.run ?? "").split("\n")[0]);
  if (step.uses) {
    const key = [...DECLARED_SKIPS.keys()].find((k) => step.uses === k || step.uses.startsWith(k + "@"));
    if (key) plan.push({ kind: "skip", label, reason: DECLARED_SKIPS.get(key) });
    else unrecognised.push(`uses: ${step.uses}`);
    continue;
  }
  if (typeof step.run === "string") {
    const body = step.run.trim();
    const key = [...DECLARED_SKIPS.keys()].find((k) => k === body);
    if (key) plan.push({ kind: "skip", label, reason: DECLARED_SKIPS.get(key) });
    else plan.push({ kind: "run", label, body, when: step.if ?? null, shell: step.shell ?? null, network: /npx -y|server-everything/.test(body) });
    continue;
  }
  unrecognised.push(label);
}

if (unrecognised.length) {
  console.error("preflight: ci.yml has steps this script does not know how to handle:");
  for (const u of unrecognised) console.error("  " + u);
  console.error("Add it to the run plan or to DECLARED_SKIPS with the reason it cannot run locally.");
  process.exit(2);
}

// A skip whose step has left CI is a reason describing nothing.
const seen = new Set(
  steps.flatMap((s) => {
    const out = [];
    if (s.uses) {
      const k = [...DECLARED_SKIPS.keys()].find((k) => s.uses === k || s.uses.startsWith(k + "@"));
      if (k) out.push(k);
    }
    if (typeof s.run === "string" && DECLARED_SKIPS.has(s.run.trim())) out.push(s.run.trim());
    return out;
  }),
);
const stale = [...DECLARED_SKIPS.keys()].filter((k) => !seen.has(k));
if (stale.length) {
  console.error("preflight: these skips are declared but no longer appear in ci.yml, so their reasons describe nothing:");
  for (const s of stale) console.error("  " + s);
  process.exit(2);
}

// Environment differences are a real source of "green here, red there".
const pnpmPin = String(steps.find((s) => typeof s.uses === "string" && s.uses.startsWith("pnpm/action-setup"))?.with?.version ?? "");
const localPnpm = spawnSync("pnpm --version", { encoding: "utf8", shell: true }).stdout?.trim();
const nodes = wf?.jobs?.[JOB]?.strategy?.matrix?.node ?? [];
console.log(`preflight: ${plan.filter((p) => p.kind === "run").length} steps to run, ${plan.filter((p) => p.kind === "skip").length} declared skips`);
console.log(`  node   here ${process.version}, CI matrix ${JSON.stringify(nodes)} on ${JSON.stringify(wf?.jobs?.[JOB]?.strategy?.matrix?.os ?? [])}`);
console.log(`  pnpm   here ${localPnpm ?? "?"}, CI pins ${pnpmPin || "?"}${pnpmPin && localPnpm && pnpmPin !== localPnpm ? "   MISMATCH" : ""}`);
console.log("");

let skippedForSpeed = 0;
let conditional = 0;
let failed = null;
for (const step of plan) {
  if (step.kind === "skip") {
    console.log(`SKIP  ${step.label}`);
    console.log(`      ${step.reason}`);
    continue;
  }
  if (FAST && step.network) {
    skippedForSpeed++;
    console.log(`SKIP  ${step.label}  (--fast; this one talks to the network)`);
    continue;
  }
  if (step.when) {
    conditional++;
    console.log(`RUN   ${step.label}   [CI condition: ${String(step.when).trim()}] assumed true on this machine`);
    process.stdout.write("      ... ");
  } else {
    process.stdout.write(`RUN   ${step.label} ... `);
  }
  // Honour the step's declared shell. A step that says `shell: bash` is bash
  // syntax, and running it in this machine's default shell produced a FALSE
  // RED on the first full run here: cmd.exe choked on a `for i in 1 2 3` loop
  // that CI runs happily. A gate that fails for a reason CI would not have is
  // worse than one that misses something, because it teaches you to ignore it.
  const r =
    step.shell === "bash"
      ? spawnSync("bash", ["-c", step.body], { cwd: ROOT, stdio: "pipe", encoding: "utf8" })
      : spawnSync(step.body, { cwd: ROOT, shell: true, stdio: "pipe", encoding: "utf8" });
  if (r.status === 0) {
    console.log("ok");
  } else {
    console.log(`FAILED (exit ${r.status})`);
    console.log((r.stdout ?? "").trimEnd());
    console.log((r.stderr ?? "").trimEnd());
    failed = step.label;
    break;
  }
}

console.log("");
if (failed) {
  console.log(`preflight: FAILED at "${failed}". CI would fail the same way; do not push.`);
  process.exit(1);
}
if (skippedForSpeed) {
  // The summary line carries the strength of the claim. "Everything passed" and
  // "everything I chose to run passed" are different sentences.
  console.log(`preflight: partial. ${skippedForSpeed} network step(s) skipped by --fast, so this does NOT stand in for CI.`);
  process.exit(0);
}
console.log(
  `preflight: matches the CI gate on this machine (one matrix cell of four)${conditional ? `, with ${conditional} conditional step(s) assumed true` : ""}.`,
);
