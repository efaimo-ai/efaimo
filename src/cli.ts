#!/usr/bin/env node
import fs from "node:fs";
import crossSpawn from "cross-spawn";
import { Command } from "commander";
import pc from "picocolors";
import { VERSION } from "./version.js";
import { resolveTarget, type ResolvedTarget } from "./targets/resolve.js";
import { loadClientServers, SUPPORTED_CLIENTS } from "./targets/clientConfigs.js";
import { introspectServer } from "./clients/introspect.js";
import { RC_VERSION } from "./clients/rawprobe.js";
import { weighServer, weighSkills } from "./weigh/weigh.js";
import { findSkills } from "./skills/parse.js";
import { diffServerWeigh } from "./weigh/diff.js";
import { DEFAULT_CONTEXT_WINDOW, formatWindowShare, setContextWindow } from "./weigh/window.js";
import { checkMcpRepoOnly, checkMcpTarget, checkSkillSet, type CheckSkillResult } from "./check/check.js";
import {
  renderCheckPretty,
  renderDiffPretty,
  renderScenarioPlan,
  renderServerWeighPretty,
  renderSkillSetPretty,
  renderSkillWeighPretty,
  renderTestReportPretty,
  setColor,
} from "./reporters/pretty.js";
import { parseScenario, runScenario } from "./testing/harness.js";
import { anthropicRunner } from "./testing/anthropicRunner.js";
import { openaiRunner, providerForModel } from "./testing/openaiRunner.js";
import { toJsonEnvelope } from "./reporters/json.js";
import { renderCheckMarkdown, renderDiffMarkdown, renderSkillSetMarkdown, renderWeighMarkdown } from "./reporters/markdown.js";
import { gradeBadgeSpec, makeBadgeSvg, toShieldsEndpoint, weighBadgeSpec } from "./reporters/badge.js";
import { loadDotEnv } from "./util/dotenv.js";
import type { CheckReport, ServerWeighResult, WeighResult } from "./core/types.js";

// Load a local .env before any command reads a key. Shell env always wins.
const dotEnvKeys = new Set(loadDotEnv());

const program = new Command();

program
  .name("efaimo")
  .description("Audit what your agent loads: quality and context cost for MCP servers and Agent Skills")
  .version(VERSION)
  .addHelpText(
    "after",
    `
examples:
  $ npx efaimo weigh "npx -y @modelcontextprotocol/server-everything"
  $ npx efaimo weigh https://mcp.example.com/mcp
  $ npx efaimo weigh ./my-skill
  $ npx efaimo weigh --client claude-code
  $ npx efaimo check --mcp "npx -y my-mcp-server"      # incl. 2026-07-28 readiness
  $ npx efaimo check --skill ./skills/
  $ npx efaimo weigh "npx -y my-server" --out base.json && npx efaimo weigh "npx -y my-server" --diff base.json
`,
  );

function collectPairs(sep: string) {
  return (value: string, prev: Record<string, string> = {}): Record<string, string> => {
    const idx = value.indexOf(sep);
    if (idx === -1) throw new Error(`expected "KEY${sep}VALUE", got "${value}"`);
    return { ...prev, [value.slice(0, idx).trim()]: value.slice(idx + 1).trim() };
  };
}

function colorSetup(opts: { color?: boolean }): void {
  setColor(opts.color !== false && process.env.NO_COLOR === undefined);
}

function windowSetup(opts: { window?: string }): void {
  if (opts.window === undefined) return;
  const n = Number(opts.window);
  if (!Number.isFinite(n) || n <= 0) fail(`--window must be a positive number of tokens, got "${opts.window}"`);
  setContextWindow(n);
}

function fail(message: string): never {
  console.error(pc.red(`error: ${message}`));
  process.exit(2);
}

function writeBadge(fileArg: string | boolean | undefined, spec: { label: string; message: string; color: string }): void {
  if (!fileArg) return;
  const file = typeof fileArg === "string" ? fileArg : "efaimo-badge.svg";
  fs.writeFileSync(file, makeBadgeSvg(spec.label, spec.message, spec.color));
  const jsonFile = file.replace(/\.svg$/i, "") + ".json";
  fs.writeFileSync(jsonFile, toShieldsEndpoint(spec));
  console.error(pc.dim(`badge written: ${file}, ${jsonFile}`));
}

function seconds(value: string, label = "--timeout"): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail(`${label} must be a positive number of seconds, got "${value}"`);
  return n;
}

function parseNumberOpt(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number, got "${value}"`);
  return n;
}

function anthropicKeyFor(opts: { anthropic?: string | boolean }): { apiKey?: string; model?: string } {
  if (!opts.anthropic) return {};
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) fail("--anthropic needs ANTHROPIC_API_KEY in the environment or a .env file");
  return { apiKey, model: typeof opts.anthropic === "string" ? opts.anthropic : undefined };
}

interface CommonOpts {
  color?: boolean;
  json?: boolean;
  md?: boolean;
  window?: string;
  timeout: string;
  header?: Record<string, string>;
  env?: Record<string, string>;
  stdio?: boolean;
}

program
  .command("weigh")
  .description("measure the context cost of MCP tool definitions or Agent Skills")
  .argument("[target]", "stdio command | http(s) URL | skill path")
  .option("--client <name>", `weigh every server configured for a client (${SUPPORTED_CLIENTS.join(", ")})`)
  .option("--stdio", "treat target as a stdio command string")
  .option("--skill", "treat target as a skill path")
  .option("--header <header>", 'HTTP header "Key: Value" (repeatable)', collectPairs(":"))
  .option("--env <pair>", "KEY=VALUE for stdio servers (repeatable)", collectPairs("="))
  .option("--timeout <seconds>", "connect timeout in seconds", "45")
  .option("--json", "print JSON")
  .option("--md", "print Markdown")
  .option("--out <file>", "write the JSON result to a file (usable as a --diff baseline)")
  .option("--diff <baseline>", "compare against a baseline JSON from --out")
  .option("--max-tokens <n>", "exit 1 if the primary total exceeds n tokens")
  .option("--allow-increase <pct>", "with --diff: exit 1 if the increase exceeds pct percent")
  .option("--badge [file]", "write an SVG badge + shields endpoint JSON")
  .option("--anthropic [model]", "also measure exact Claude tokens via the count_tokens API (needs ANTHROPIC_API_KEY)")
  .option("--window <tokens>", "context window the share is reported against", String(DEFAULT_CONTEXT_WINDOW))
  .option("--no-color", "disable colors")
  .action(async (targetArg: string | undefined, opts: CommonOpts & {
    client?: string;
    skill?: boolean;
    out?: string;
    diff?: string;
    maxTokens?: string;
    allowIncrease?: string;
    badge?: string | boolean;
    anthropic?: string | boolean;
  }) => {
    colorSetup(opts);
    windowSetup(opts);
    const timeoutMs = seconds(opts.timeout) * 1000;
    const maxTokens = parseNumberOpt(opts.maxTokens, "--max-tokens");
    const allowIncreasePct = parseNumberOpt(opts.allowIncrease, "--allow-increase");
    const anthropic = anthropicKeyFor(opts);

    const targets: ResolvedTarget[] = [];
    if (opts.client) {
      const conf = loadClientServers(opts.client);
      if (!conf.entries.length) {
        fail(
          `no MCP servers found for client "${opts.client}" (checked: ${[...conf.sources, ...conf.missing].join(", ")})`,
        );
      }
      console.error(pc.dim(`config: ${conf.sources.join(", ")}`));
      targets.push(...conf.entries.map((e) => e.target));
    }
    if (targetArg) {
      targets.push(
        resolveTarget(targetArg, {
          forceStdio: opts.stdio,
          forceSkill: opts.skill,
          env: opts.env,
          headers: opts.header,
        }),
      );
    }
    if (!targets.length) fail("nothing to weigh: pass a target or --client <name> (see --help)");

    const results: WeighResult[] = [];
    const skipped: { label: string; reason: string }[] = [];
    for (const target of targets) {
      if (target.kind === "skillset") {
        const set = findSkills(target.path);
        if (!set.skills.length) fail(`no SKILL.md found under "${target.label}"`);
        results.push(await weighSkills(set));
      } else if (target.kind === "repo") {
        fail(
          `"${target.label}" is a source directory; weigh needs a live server (stdio command or URL) or a skill path. For repo checks use: efaimo check --mcp ${target.label}`,
        );
      } else {
        console.error(pc.dim(`connecting to ${target.label} ...`));
        try {
          const intro = await introspectServer(target, { timeoutMs });
          results.push(await weighServer(intro, { anthropicApiKey: anthropic.apiKey, anthropicModel: anthropic.model }));
        } catch (e) {
          // One broken/auth-gated server must not abort a multi-server run
          // (--client weighs everything an editor loads; some entries need auth).
          if (targets.length === 1) throw e;
          const reason = (e instanceof Error ? e.message : String(e)).split("\n")[0]!.trim();
          skipped.push({ label: target.label, reason });
          console.error(pc.yellow(`skipped ${target.label}: ${reason}`));
        }
      }
    }
    if (!results.length) {
      fail(`no server could be weighed (${skipped.length} of ${targets.length} failed; see reasons above)`);
    }

    // "Single" means the user asked for exactly one target, not that exactly
    // one target survived: a multi-target run with skips must not silently
    // write/diff a baseline or emit a single-object JSON for whichever server
    // happened to work.
    const single = targets.length === 1 && results.length === 1 ? results[0]! : undefined;
    const budgetTotal = results.reduce(
      (s, r) => s + (r.kind === "mcp" ? r.totals.claudeStyle : r.totals.metadata + r.totals.body),
      0,
    );

    if (opts.out && single) {
      fs.writeFileSync(opts.out, toJsonEnvelope("weigh", single));
      console.error(pc.dim(`baseline written: ${opts.out}`));
    } else if (opts.out) {
      console.error(pc.yellow("--out skipped: it writes a single baseline, but multiple targets were requested"));
    }

    if (opts.json) {
      console.log(toJsonEnvelope("weigh", single ?? results));
    } else if (opts.md) {
      console.log(results.map(renderWeighMarkdown).join("\n\n---\n\n"));
    } else {
      console.log(
        results
          .map((r) => (r.kind === "mcp" ? renderServerWeighPretty(r) : renderSkillWeighPretty(r)))
          .join("\n\n"),
      );
      if (results.length > 1) {
        const mcpTotals = results
          .filter((r): r is ServerWeighResult => r.kind === "mcp")
          .reduce((s, r) => s + r.totals.claudeStyle, 0);
        if (mcpTotals > 0) {
          console.log(
            pc.bold(
              `\ncombined MCP context cost (Claude-style, o200k est.): ${mcpTotals.toLocaleString("en-US")} tokens (${formatWindowShare(mcpTotals)})`,
            ),
          );
        }
      }
    }
    if (skipped.length) {
      console.error(
        pc.yellow(
          `weighed ${results.length} of ${targets.length} servers; skipped: ${skipped.map((s) => s.label).join(", ")}`,
        ),
      );
    }

    if (opts.diff) {
      if (!single || single.kind !== "mcp") fail("--diff works on a single MCP server result");
      const baselineRaw = JSON.parse(fs.readFileSync(opts.diff, "utf8")) as { data?: ServerWeighResult } | ServerWeighResult;
      const baseline = ("data" in baselineRaw && baselineRaw.data ? baselineRaw.data : baselineRaw) as ServerWeighResult;
      if (!baseline?.totals) fail(`"${opts.diff}" is not a weigh baseline (write one with --out)`);
      const d = diffServerWeigh(baseline, single);
      console.log("");
      console.log(opts.md ? renderDiffMarkdown(d) : renderDiffPretty(d, { maxTokens, allowIncreasePct }));
      if (
        (allowIncreasePct !== undefined && d.pct > allowIncreasePct) ||
        (maxTokens !== undefined && d.after > maxTokens)
      ) {
        process.exitCode = 1;
      }
    } else if (maxTokens !== undefined && budgetTotal > maxTokens) {
      const scope = single ? "" : " (combined)";
      console.error(pc.red(`budget exceeded${scope}: ${budgetTotal.toLocaleString("en-US")} > --max-tokens ${maxTokens}`));
      process.exitCode = 1;
    }

    if (single) writeBadge(opts.badge, weighBadgeSpec(single));
  });

program
  .command("check")
  .description("audit quality and 2026-07-28 readiness of an MCP server, or lint Agent Skills")
  .argument("[target]", "stdio command | http(s) URL | skill path | repo dir")
  .option("--mcp", "treat target as an MCP server / server repo")
  .option("--skill", "treat target as a skill path")
  .option("--stdio", "treat target as a stdio command string")
  .option("--repo <path>", "additionally scan this source repo for deprecated API usage")
  .option("--no-probe", "skip live readiness probes (bare request, server/discover, ordering)")
  .option("--strict", "exit 1 on warnings too")
  .option("--conformance", "after the audit, run the official MCP conformance suite (http targets)")
  .option("--header <header>", 'HTTP header "Key: Value" (repeatable)', collectPairs(":"))
  .option("--env <pair>", "KEY=VALUE for stdio servers (repeatable)", collectPairs("="))
  .option("--timeout <seconds>", "connect timeout in seconds", "45")
  .option("--json", "print JSON")
  .option("--md", "print Markdown")
  .option("--badge [file]", "write a grade badge SVG + shields endpoint JSON")
  .option("--anthropic [model]", "use exact Claude token counts where relevant")
  .option("--window <tokens>", "context window the share is reported against", String(DEFAULT_CONTEXT_WINDOW))
  .option("--no-color", "disable colors")
  .action(async (targetArg: string | undefined, opts: CommonOpts & {
    mcp?: boolean;
    skill?: boolean;
    repo?: string;
    probe?: boolean;
    strict?: boolean;
    conformance?: boolean;
    badge?: string | boolean;
    anthropic?: string | boolean;
  }) => {
    colorSetup(opts);
    windowSetup(opts);
    if (!targetArg) fail("nothing to check: pass a target (see --help)");
    if (opts.mcp && opts.skill) fail("--mcp and --skill are mutually exclusive");
    const timeoutMs = seconds(opts.timeout) * 1000;
    const anthropic = anthropicKeyFor(opts);

    let target = resolveTarget(targetArg, {
      forceStdio: opts.stdio,
      forceSkill: opts.skill,
      forceRepo: false,
      env: opts.env,
      headers: opts.header,
    });
    if (opts.mcp && target.kind === "skillset") {
      target = { kind: "repo", path: target.path, label: target.label };
    }

    let report: CheckReport | undefined;
    let skillSet: CheckSkillResult | undefined;
    if (target.kind === "skillset") {
      const res = await checkSkillSet(target.path, target.label);
      // A single skill shows a full report; a set shows per-skill grades.
      if (res.perSkill.length === 1 && res.setFindings.length === 0) report = res.perSkill[0]!.report;
      else skillSet = res;
    } else if (target.kind === "repo") {
      report = checkMcpRepoOnly(target.path, target.label);
    } else {
      console.error(pc.dim(`connecting to ${target.label} ...`));
      const res = await checkMcpTarget(target, {
        timeoutMs,
        probe: opts.probe,
        repoPath: opts.repo,
        anthropicApiKey: anthropic.apiKey,
      });
      report = res.report;
    }

    if (skillSet) {
      if (opts.json) console.log(toJsonEnvelope("check", skillSet));
      else if (opts.md) console.log(renderSkillSetMarkdown(skillSet));
      else console.log(renderSkillSetPretty(skillSet));
      const errs =
        skillSet.perSkill.reduce((n, s) => n + s.report.counts.error, 0) +
        skillSet.setFindings.filter((f) => f.severity === "error").length;
      const warns =
        skillSet.perSkill.reduce((n, s) => n + s.report.counts.warn, 0) +
        skillSet.setFindings.filter((f) => f.severity === "warn").length;
      if (errs > 0 || (opts.strict && warns > 0)) process.exitCode = 1;
      return;
    }
    if (!report) return;

    if (opts.json) console.log(toJsonEnvelope("check", report));
    else if (opts.md) console.log(renderCheckMarkdown(report));
    else console.log(renderCheckPretty(report));

    writeBadge(opts.badge, gradeBadgeSpec(report));

    if (opts.conformance) {
      if (target.kind !== "http") {
        console.error(pc.yellow("note: the official conformance suite drives http targets (--url); skipping for this target"));
      } else {
        // The `latest` line of the conformance suite predates the 2026-07-28
        // revision, so it silently tests the old protocol. The RC scenarios
        // ship on the `alpha` line only; --spec-version scopes them to the
        // revision efaimo is about.
        const args = [
          "-y",
          "@modelcontextprotocol/conformance@alpha",
          "server",
          "--url",
          target.url,
          "--spec-version",
          RC_VERSION,
        ];
        console.error(pc.dim(`\nrunning official MCP conformance suite:\n  npx ${args.slice(1).join(" ")}\n`));
        // cross-spawn resolves npx(.cmd) without a shell, so target.url is passed
        // as a literal argument (never interpreted by cmd.exe).
        const r = crossSpawn.sync("npx", args, {
          stdio: "inherit",
        });
        if (r.status !== 0) console.error(pc.yellow(`conformance suite exited with code ${r.status ?? "unknown"}`));
      }
    }

    if (report.counts.error > 0 || (opts.strict && report.counts.warn > 0)) {
      process.exitCode = 1;
    }
  });

program
  .command("test")
  .description("does a skill actually improve task completion? (experimental A/B outcome harness)")
  .argument("<scenario>", "a scenario YAML file (see examples/scenario.example.yaml)")
  .option("--live", "run for real (spends tokens; Claude models need ANTHROPIC_API_KEY, GPT models need OPENAI_API_KEY)")
  .option("--model <model>", "override the scenario's model (e.g. gpt-4o-mini, claude-sonnet-5)")
  .option("--json", "print JSON")
  .option("--no-color", "disable colors")
  .addHelpText("after", "\nWithout --live this validates the scenario and prints the plan, making no API calls.")
  .action(async (file: string, opts: { live?: boolean; model?: string; json?: boolean; color?: boolean }) => {
    colorSetup(opts);
    const parsed = parseScenario(file);
    const scenario = opts.model ? { ...parsed, model: opts.model } : parsed;
    if (!opts.live) {
      console.log(renderScenarioPlan(scenario));
      return;
    }
    const provider = providerForModel(scenario.model);
    if (provider === "unknown") {
      fail(`model "${scenario.model}" is not supported: efaimo test runs Claude (claude-*) and OpenAI (gpt-*, o*) models`);
    }
    const envVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
    const apiKey = process.env[envVar];
    if (!apiKey) fail(`model "${scenario.model}" needs ${envVar} in the environment or a .env file`);
    if (dotEnvKeys.has(envVar)) console.error(pc.dim(`using ${envVar} from .env`));
    const runner = provider === "openai" ? openaiRunner(apiKey) : anthropicRunner(apiKey);
    console.error(pc.dim(`running ~${scenario.trials * 4} ${provider} API calls against ${scenario.model} ...`));
    const report = await runScenario(scenario, runner);
    if (opts.json) console.log(toJsonEnvelope("test", report));
    else console.log(renderTestReportPretty(report));
    if (report.verdict === "hurts") process.exitCode = 1;
  });

program
  .command("mcp")
  .description("run efaimo as a read-only MCP server (exposes the skill checks to an agent over stdio)")
  .addHelpText(
    "after",
    "\nStarts a stdio MCP server with two read-only tools, efaimo_check_skill and efaimo_weigh_skill,\n" +
      "so an agent can lint or weigh a skill mid-session. It reads files only: no process is spawned,\n" +
      "no socket is opened, and `test` (which spends tokens) is not exposed.",
  )
  .action(async () => {
    const { runMcpServer } = await import("./mcp/server.js");
    await runMcpServer();
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  console.error(pc.red(`error: ${e instanceof Error ? e.message : String(e)}`));
  process.exitCode = 2;
});
