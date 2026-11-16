import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

/**
 * The composite Action, run the way a runner runs it, with npx stubbed out.
 *
 * GitHub substitutes each `${{ inputs.x }}` in the step's `env:` and bash runs
 * `run:`. That is all this reproduces, using the action's own declared
 * defaults, so what is tested is the file as shipped. The example its input
 * description gave, `weigh "npx -y my-server"`, never worked: bash does not
 * re-read quotes inside a variable, so efaimo received `"npx`, `-y` and
 * `my-server"`.
 */
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const action = YAML.parse(fs.readFileSync(path.join(root, "action.yml"), "utf8")) as {
  inputs: Record<string, { default?: string }>;
  runs: { steps: { run: string; env: Record<string, string> }[] };
};

// On Windows the first bash on PATH is often WSL's launcher, which does not see
// this process's environment. `shell: bash` on a Windows runner is Git Bash.
const bash =
  process.platform === "win32"
    ? [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")].find((p) => fs.existsSync(p))
    : "bash";

function argvFor(inputs: Record<string, string>): string[] {
  const step = action.runs.steps[0]!;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(step.env)) {
    const m = /^\$\{\{\s*inputs\.([\w-]+)\s*\}\}$/.exec(v);
    if (!m) throw new Error(`unexpected env value for ${k}: ${v}`);
    env[k] = inputs[m[1]!] ?? action.inputs[m[1]!]?.default ?? "";
  }
  const r = spawnSync(bash!, ["-c", `npx() { printf '%s\\n' "$@"; }\n${step.run}`], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) throw new Error(`bash failed (${r.status}): ${r.stderr}`);
  return r.stdout.split("\n").slice(0, -1);
}

describe.skipIf(!bash)("action.yml", () => {
  it("passes a target with spaces as one argument", () => {
    expect(action.inputs.target, "no `target` input declared").toBeDefined();
    expect(argvFor({ command: "weigh", target: "npx -y my-server" })).toEqual([
      "-y",
      "efaimo@latest",
      "weigh",
      "npx -y my-server",
    ]);
  });

  it("still splits command into words, and adds no empty argument without a target", () => {
    expect(argvFor({ command: "check --skill ./skills --strict" })).toEqual([
      "-y",
      "efaimo@latest",
      "check",
      "--skill",
      "./skills",
      "--strict",
    ]);
  });

  it("splits command into words without expanding a glob in it", () => {
    // Unquoted, the value also went through pathname expansion, so a `*` in
    // it became whatever the runner's working directory happened to hold.
    expect(argvFor({ command: "check --skill *" })).toEqual(["-y", "efaimo@latest", "check", "--skill", "*"]);
  });
});
