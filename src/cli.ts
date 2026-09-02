#!/usr/bin/env node
import fs from "node:fs";
import crossSpawn from "cross-spawn";
import { Command } from "commander";
import pc from "picocolors";
import { VERSION } from "./version.js";
import { resolveTarget, type ResolvedTarget } from "./targets/resolve.js";
import { loadClientServers, SUPPORTED_CLIENTS } from "./targets/clientConfigs.js";
import { introspectServer } from "./clients/introspect.js";
import { SPEC_VERSION } from "./clients/rawprobe.js";
import { weighServer, weighSkills } from "./weigh/weigh.js";
import { findSkills } from "./skills/parse.js";
import { diffServerWeigh } from "./weigh/diff.js";
import { diffCheck, CheckDiffRefused, type CheckEnvelope } from "./check/diff.js";
import { DEFAULT_CONTEXT_WINDOW, formatWindowShare, setContextWindow } from "./weigh/window.js";
import { checkMcpRepoOnly, checkMcpTarget, checkSkillSet, type CheckSkillResult } from "./check/check.js";
import { analyzeFind, DEFAULT_TOP_K } from "./find/find.js";
import { runFindRules } from "./core/engine.js";
import {
  renderCheckPretty,
  renderDiffPretty,
  renderFindFindingsPretty,
  renderFindPretty,
  renderScenarioPlan,
  renderServerWeighPretty,
  renderSkillSetPretty,
  renderSkillWeighPretty,
  renderTestReportPretty,
  setColor,
  renderCheckDiffPretty,
} from "./reporters/pretty.js";
import { parseScenario, runScenario, type Runner } from "./testing/harness.js";
import { acceptsSamplingParams, anthropicRunner } from "./testing/anthropicRunner.js";
import { openaiRunner, providerForModel } from "./testing/openaiRunner.js";
import { toJsonEnvelope } from "./reporters/json.js";
import { renderCheckMarkdown, renderDiffMarkdown, renderFindMarkdown, renderSkillSetMarkdown, renderWeighMarkdown } from "./reporters/markdown.js";
import { gradeBadgeSpec, makeBadgeSvg, toShieldsEndpoint, weighBadgeSpec } from "./reporters/badge.js";
import { loadDotEnv } from "./util/dotenv.js";
import type { CheckReport, ServerWeighResult, WeighResult, ToolDef} from "./core/types.js";

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
  $ npx efaimo find "npx -y my-mcp-server"             # would a search surface these tools?
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
  // Escape codes are noise once stdout is a file or another tool's stdin, and
  // `efaimo weigh > report.txt` is a normal thing to do. So colour needs both
  // the user's consent and a terminal to write to; FORCE_COLOR is the escape
  // hatch for CI that renders ANSI in its log viewer.
  const forced = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0";
  const wanted = opts.color !== false && process.env.NO_COLOR === undefined;
  setColor(wanted && (forced || process.stdout.isTTY === true));
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

function parseNumberOpt(
  value: string | undefined,
  label: string,
  bound?: { min: number; exclusive?: boolean },
): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${label} must be a number, got "${value}"`);
  // A budget or a percentage below its floor is not a stricter gate, it is a
  // nonsensical one: `--max-tokens -5` turned "over budget" into always-true
  // with a negative ceiling in the message. Reject it at the boundary.
  if (bound && (bound.exclusive ? n <= bound.min : n < bound.min)) {
    fail(`${label} must be ${bound.exclusive ? "greater than" : "at least"} ${bound.min}, got "${value}"`);
  }
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
  timestamp?: boolean;
}

// `--no-timestamp` is commander's negated form, so `opts.timestamp` is true
// unless the flag is passed. Kept in one helper because three commands take it
// and the polarity is easy to invert by accident.
function envelopeOpts(opts: { timestamp?: boolean }): { timestamp: boolean } {
  return { timestamp: opts.timestamp !== false };
}

const NO_TIMESTAMP_HELP = "omit generatedAt from JSON output (for committed or diffed artifacts)";

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
  .option("--no-timestamp", NO_TIMESTAMP_HELP)
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
    const maxTokens = parseNumberOpt(opts.maxTokens, "--max-tokens", { min: 0, exclusive: true });
    const allowIncreasePct = parseNumberOpt(opts.allowIncrease, "--allow-increase", { min: 0 });
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
      // Say what is about to be EXECUTED, not just which file it came from.
      //
      // --client reads .mcp.json, .cursor/mcp.json and .vscode/mcp.json from
      // the CURRENT DIRECTORY as well as the user config, and then spawns
      // every command in them. Cloning an untrusted repo and running the audit
      // tool inside it was therefore arbitrary code execution, and the only
      // thing printed was the friendly config key, never the command. Cursor
      // and VS Code gate project-scoped MCP config behind workspace trust;
      // this printed nothing at all.
      //
      // Listing them is the minimum. A stdio entry names a real command that
      // is about to run on this machine.
      for (const e of conf.entries) {
        const t = e.target;
        const shown =
          t.kind === "stdio"
            ? [t.command, ...t.args].join(" ") + (t.env && Object.keys(t.env).length ? `   (+${Object.keys(t.env).length} env)` : "")
            : t.url;
        console.error(pc.dim(`  ${e.name}: ${shown}`));
      }
      if (conf.fromCwd.length) {
        console.error(
          pc.yellow(
            `  ! ${conf.fromCwd.length} of these came from the current directory (${conf.fromCwd.join(", ")}), not your user config.\n` +
              `    Auditing a stdio server means executing it. Only continue in a repository you trust.`,
          ),
        );
      }
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
      // Never stamped. A baseline exists to be compared against, so a field
      // that differs on every write is the one field a comparison must ignore,
      // and a committed baseline that diffs on nothing but the clock trains
      // reviewers to skim exactly the file they should read.
      fs.writeFileSync(opts.out, toJsonEnvelope("weigh", single, { timestamp: false }));
      console.error(pc.dim(`baseline written: ${opts.out}`));
    } else if (opts.out) {
      console.error(pc.yellow("--out skipped: it writes a single baseline, but multiple targets were requested"));
    }

    if (opts.json) {
      console.log(toJsonEnvelope("weigh", single ?? results, envelopeOpts(opts)));
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
      // A skill weigh baseline also carries a `totals` object, so a bare
      // truthiness check passed it through and diffServerWeigh then died on the
      // missing tool array with a raw TypeError. A server baseline is the one
      // whose totals hold the three serializations; require the Claude-style
      // total specifically so a skill baseline is rejected with a clear message.
      if (!baseline?.totals || typeof baseline.totals.claudeStyle !== "number") {
        fail(`"${opts.diff}" is not an MCP server weigh baseline; write one with: efaimo weigh <server> --out ${opts.diff}`);
      }
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
  .option("--strict-readiness", "exit 1 if the 2026-07-28 migration diff is not clean (never changes the grade)")
  .option("--conformance", "after the audit, run the official MCP conformance suite (http targets)")
  .option("--header <header>", 'HTTP header "Key: Value" (repeatable)', collectPairs(":"))
  .option("--env <pair>", "KEY=VALUE for stdio servers (repeatable)", collectPairs("="))
  .option("--timeout <seconds>", "connect timeout in seconds", "45")
  .option("--json", "print JSON")
  .option("--md", "print Markdown")
  .option("--no-timestamp", NO_TIMESTAMP_HELP)
  .option("--badge [file]", "write a grade badge SVG + shields endpoint JSON")
  .option("--out <file>", "write the JSON result to a file (usable as a --diff baseline)")
  .option("--diff <baseline>", "compare against a baseline JSON from --out")
  .option("--allow-rules-drift", "let --diff proceed when the two runs used different rulesets (grade movement is then unattributable)")
  .option("--fail-on-regression", "with --diff, exit 1 if any subject present in both runs scored lower")
  .option("--anthropic [model]", "use exact Claude token counts where relevant")
  .option("--window <tokens>", "context window the share is reported against", String(DEFAULT_CONTEXT_WINDOW))
  .option("--no-color", "disable colors")
  .action(async (targetArg: string | undefined, opts: CommonOpts & {
    mcp?: boolean;
    skill?: boolean;
    repo?: string;
    probe?: boolean;
    strict?: boolean;
    strictReadiness?: boolean;
    conformance?: boolean;
    badge?: string | boolean;
    out?: string;
    diff?: string;
    allowRulesDrift?: boolean;
    failOnRegression?: boolean;
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

    // A baseline is written unstamped for the same reason weigh's is: a file
    // that differs on every write is the one field a comparison must ignore,
    // and a committed baseline that diffs on nothing but the clock trains
    // reviewers to skim the file they should be reading. The whole envelope is
    // written rather than just its data, because the version and rulesVersion
    // in it are what make the later comparison trustworthy.
    const baselineAndDiff = (payload: unknown) => {
      if (opts.out) {
        fs.writeFileSync(opts.out, toJsonEnvelope("check", payload, { timestamp: false }));
        console.error(pc.dim(`baseline written: ${opts.out}`));
      }
      if (!opts.diff) return;
      let baseline: CheckEnvelope;
      try {
        baseline = JSON.parse(fs.readFileSync(opts.diff, "utf8")) as CheckEnvelope;
      } catch (e) {
        fail(`could not read the baseline "${opts.diff}": ${(e as Error).message}`);
        return;
      }
      const current = JSON.parse(toJsonEnvelope("check", payload, { timestamp: false })) as CheckEnvelope;
      try {
        const d = diffCheck(baseline, current, { allowRulesDrift: opts.allowRulesDrift });
        console.log("");
        console.log(renderCheckDiffPretty(d));
        if (opts.failOnRegression && d.worsened.length) process.exitCode = 1;
      } catch (e) {
        // Every refusal here is a comparison that would have produced a
        // plausible number from incomparable inputs, so it stops rather than
        // printing one.
        if (e instanceof CheckDiffRefused) fail(e.message);
        throw e;
      }
    };

    if (skillSet) {
      baselineAndDiff(skillSet);
      if (opts.json) console.log(toJsonEnvelope("check", skillSet, envelopeOpts(opts)));
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

    baselineAndDiff(report);
    if (opts.json) console.log(toJsonEnvelope("check", report, envelopeOpts(opts)));
    else if (opts.md) console.log(renderCheckMarkdown(report));
    else console.log(renderCheckPretty(report));

    writeBadge(opts.badge, gradeBadgeSpec(report));

    if (opts.conformance) {
      if (target.kind !== "http") {
        console.error(pc.yellow("note: the official conformance suite drives http targets (--url); skipping for this target"));
      } else {
        // The `latest` line of the conformance suite (0.1.16) predates the
        // 2026-07-28 revision, so it silently tests the old protocol. Those
        // scenarios ship on the `alpha` line only; --spec-version scopes them
        // to the revision efaimo is about.
        //
        // Pinned to an exact version, because a dist-tag is not a pin. `alpha`
        // moved from 0.2.0-alpha.9 to 0.2.0-alpha.10 on 2026-07-27, and we went
        // on reporting "the official conformance suite" for a build nobody here
        // had run: the same "we do not know what we ran" bug this block was
        // written to fix, through the other door. Bumping it means re-reading
        // `server --help` first; the two flags below were confirmed against
        // 0.2.0-alpha.10.
        const args = [
          "-y",
          "@modelcontextprotocol/conformance@0.2.0-alpha.10",
          "server",
          "--url",
          target.url,
          "--spec-version",
          SPEC_VERSION,
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
    // Readiness stays out of the grade, the badge and the default exit code
    // (ADR-014, reaffirmed in ADR-027). But a team that HAS migrated had no way
    // to stay migrated: --strict covers quality only, so nothing in CI could
    // catch a regression back onto the legacy handshake. This is the opt-in for
    // exactly that, and it moves the exit code only. Nobody's grade changes,
    // no published number moves, and the operator decides rather than us.
    if (opts.strictReadiness && (report.readiness?.findings.length ?? 0) > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("find")
  .description("would a search surface these tools? (findability under deferred tool loading)")
  .argument("[targets...]", "one or more MCP servers: stdio command | http(s) URL. Two or more are merged into one catalog and measured together")
  .option("--stdio", "treat target as a stdio command string")
  .option("--header <header>", 'HTTP header "Key: Value" (repeatable)', collectPairs(":"))
  .option("--env <pair>", "KEY=VALUE for stdio servers (repeatable)", collectPairs("="))
  .option("--timeout <seconds>", "connect timeout in seconds", "45")
  .option(
    "--top <n>",
    `result window to simulate (Anthropic's documented default is ${DEFAULT_TOP_K}; the probe is vacuous when tools <= top, so gate on --min-distinct rather than on this)`,
    String(DEFAULT_TOP_K),
  )
  .option("--min-distinct <pct>", "exit 1 if fewer than pct percent of tools own a word no other tool has")
  .option("--json", "print JSON")
  .option("--md", "print Markdown")
  .option("--no-timestamp", NO_TIMESTAMP_HELP)
  .option("--no-color", "disable colors")
  .addHelpText(
    "after",
    "\nA tool marked defer_loading is kept out of the context window until a search finds it, so a tool\n" +
      "nothing surfaces costs nothing and does nothing. Two numbers come back. `distinct` is a property of\n" +
      "the catalog: a tool that owns no word the others lack cannot be matched by any query that does not\n" +
      "also match a competitor. `probe` is a simulated BM25 search, offline and deterministic, and it\n" +
      "saturates on well-formed catalogs, so it is a floor test rather than a ranking.\n" +
      "Pass more than one server and their catalogs are MERGED and measured together, with each tool\n" +
      "labelled by where it came from. That is the case worth checking: a server author keeps their own\n" +
      "names apart, nobody coordinates across the several servers a person installs, and the model sees\n" +
      "one flat list. A single-server run is structurally unable to see a collision between two of them.\n" +
      "No API key, no network beyond connecting to the server. docs/METHODOLOGY.md has the method.",
  )
  .action(async (targetArgs: string[] | undefined, opts: CommonOpts & { top?: string; minDistinct?: string }) => {
    colorSetup(opts);
    const args = targetArgs ?? [];
    if (!args.length) fail("nothing to search: pass an MCP server (stdio command or URL)");
    const timeoutMs = seconds(opts.timeout) * 1000;
    const topK = parseNumberOpt(opts.top, "--top", { min: 1 }) ?? DEFAULT_TOP_K;
    // A window is a count of results, so a fraction of one is not a stricter
    // setting, it is a nonsensical one: `--top 2.5` printed "result window 2.5"
    // while `rank <= 2.5` behaved as 2, so the number in the report and the
    // number in the comparison disagreed.
    if (!Number.isInteger(topK)) fail(`--top must be a whole number of results, got "${opts.top}"`);
    const minDistinct = parseNumberOpt(opts.minDistinct, "--min-distinct", { min: 0 });
    if (minDistinct !== undefined && minDistinct > 100) fail(`--min-distinct is a percentage, got "${opts.minDistinct}"`);

    const targets = args
      .map((a) => resolveTarget(a, { forceStdio: opts.stdio, env: opts.env, headers: opts.header }))
      .map((target) => {
        if (target.kind === "skillset" || target.kind === "repo") {
          fail(
            `"${target.label}" is a ${target.kind === "skillset" ? "skill path" : "source directory"}; find needs a live MCP server (stdio command or URL). ` +
              `Skills have no searchable tool catalog; their trigger-overlap check is S103 in \`efaimo check --skill\`.`,
          );
          throw new Error("unreachable");
        }
        return target;
      });

    // Several servers are merged into ONE catalog rather than measured one at
    // a time, because the failure worth finding only exists between them. A
    // server's author keeps their own tool names apart as a matter of course;
    // nobody coordinates across the five or ten servers a person actually
    // installs, and the model sees all of them as one flat list with no
    // indication of which came from where. Measuring them separately would
    // report every catalog as tidy and miss exactly the collision that makes a
    // model pick the wrong tool.
    //
    // The origin is attached for the report and NOT for the index. Prefixing
    // names with their server would hand every tool a term no other tool has,
    // and a catalog of indistinguishable tools would score a perfect 100.
    let tools: ToolDef[] = [];
    let definitionTokens = 0;
    for (const target of targets) {
      console.error(pc.dim(`connecting to ${target.label} ...`));
      const intro = await introspectServer(target, { timeoutMs });
      // Weighed only to answer one question: is this catalog big enough that a
      // host would defer it. No API key is involved; the count is the local
      // o200k estimate the rest of the tool uses.
      const w = await weighServer(intro);
      definitionTokens += w.totals.claudeStyle;
      tools = tools.concat(
        targets.length > 1 ? intro.tools.map((tool) => ({ ...tool, origin: target.label })) : intro.tools,
      );
    }
    const label = targets.length === 1 ? targets[0]!.label : `${targets.length} servers`;
    const result = analyzeFind(label, tools, {
      topK,
      definitionTokens,
      sources: targets.map((x) => x.label),
    });
    const findings = runFindRules({ find: result });

    if (opts.json) {
      console.log(toJsonEnvelope("find", { ...result, findings }, envelopeOpts(opts)));
    } else if (opts.md) {
      console.log(renderFindMarkdown(result, findings));
    } else {
      console.log(renderFindPretty(result));
      console.log(renderFindFindingsPretty(result, findings));
    }

    // Gated on `distinct`, not on the probe. The probe is 100% by construction
    // whenever the catalog fits inside the result window, so a gate on it
    // would pass without examining anything for every small server. Exclusive
    // vocabulary can fail at two tools and up.
    //
    // At ONE tool it cannot: every term is trivially exclusive and the figure
    // is 100% for any tool whatsoever. Exit 2 rather than 0, because "this
    // gate cannot be evaluated here" is a different fact from "this gate
    // passed", and a CI run that silently passes on a catalog nothing was
    // measured against is the failure this whole command was built around.
    if (minDistinct !== undefined && result.distinctVacuous) {
      fail(
        `--min-distinct cannot be evaluated on a ${result.toolCount}-tool catalog: with nothing to be distinct from, ` +
          `every term is trivially exclusive and the figure is 100% for any tool. Drop the gate for this server.`,
      );
    }
    if (minDistinct !== undefined && result.distinct.pct < minDistinct) {
      console.error(
        pc.red(
          `distinct ${result.distinct.pct}% is below --min-distinct ${minDistinct}% ` +
            `(${result.distinct.total - result.distinct.count} of ${result.distinct.total} tools own no word the others lack)`,
        ),
      );
      process.exitCode = 1;
    }
  });

program
  .command("test")
  .description("does a skill actually improve task completion? (experimental A/B outcome harness)")
  .argument("<scenario>", "a scenario YAML file (see examples/scenario.example.yaml)")
  .option("--live", "run for real (spends tokens; Claude models need ANTHROPIC_API_KEY, GPT models need OPENAI_API_KEY)")
  .option("--model <model>", "override the scenario's model (e.g. gpt-4o-mini, claude-sonnet-5)")
  .option("--judge-model <model>", "grade with a different model than the one under test (removes self-preference)")
  .option("--json", "print JSON")
  .option("--no-color", "disable colors")
  .addHelpText(
    "after",
    "\nWithout --live this validates the scenario and prints the plan, making no API calls.\n" +
      "The judge defaults to the model under test, which means a model grades its own answers; set\n" +
      "judge_model in the scenario or --judge-model here to separate them. Subject and judge may be\n" +
      "different providers, in which case both keys are required.",
  )
  .action(async (file: string, opts: { live?: boolean; model?: string; judgeModel?: string; json?: boolean; color?: boolean }) => {
    colorSetup(opts);
    const parsed = parseScenario(file);
    // --model moves the judge too WHEN the judge was never pinned separately.
    // Without this, overriding the subject on a scenario that has no
    // `judge_model` would silently leave the judge on the scenario's original
    // model: a cross-model judge nobody asked for, in a run whose whole point
    // is that the comparison is controlled.
    const judgeFollowsSubject = !parsed.judgeModelExplicit;
    const model = opts.model ?? parsed.model;
    const judgeModel = opts.judgeModel ?? (judgeFollowsSubject ? model : parsed.judgeModel);
    const scenario = { ...parsed, model, judgeModel };

    if (!opts.live) {
      console.log(renderScenarioPlan(scenario));
      return;
    }

    // Subject and judge are routed independently, so a Claude subject can be
    // graded by a GPT judge (or the reverse). Every distinct provider in play
    // needs its own key, and the error says which model asked for it.
    const runners = new Map<string, Runner>();
    for (const [role, m] of [["model", scenario.model], ["judge model", scenario.judgeModel]] as const) {
      const provider = providerForModel(m);
      if (provider === "unknown") {
        fail(`${role} "${m}" is not supported: efaimo test runs Claude (claude-*) and OpenAI (gpt-*, o*) models`);
      }
      if (runners.has(provider)) continue;
      const envVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      const apiKey = process.env[envVar];
      if (!apiKey) fail(`${role} "${m}" needs ${envVar} in the environment or a .env file`);
      if (dotEnvKeys.has(envVar)) console.error(pc.dim(`using ${envVar} from .env`));
      runners.set(provider, provider === "openai" ? openaiRunner(apiKey) : anthropicRunner(apiKey));
    }
    const runner: Runner = (req) => {
      const r = runners.get(providerForModel(req.model));
      // Only the two validated models can reach here today. A future arm that
      // introduces a third would otherwise die as "undefined is not a
      // function" with no idea which model it was.
      if (!r) throw new Error(`no runner for model "${req.model}"; efaimo test runs Claude and OpenAI models`);
      return r(req);
    };

    // Say what the measurement cannot pin down, in the report, every time.
    const extraNotes: string[] = [];
    if (scenario.judgeModel === scenario.model) {
      extraNotes.push(
        `the judge is the same model as the subject, so part of any measured effect is a model preferring its own output. Set judge_model (or --judge-model) to a different model to remove that.`,
      );
    }
    if (providerForModel(scenario.judgeModel) === "anthropic" && !acceptsSamplingParams(scenario.judgeModel)) {
      extraNotes.push(
        `judge sampling is not pinned: ${scenario.judgeModel} does not accept temperature, so the judge is sampled at its default and its own variance is part of this measurement.`,
      );
    }

    const models = scenario.judgeModel === scenario.model ? scenario.model : `${scenario.model} judged by ${scenario.judgeModel}`;
    console.error(pc.dim(`running ~${scenario.trials * 4} API calls against ${models} ...`));
    const report = await runScenario(scenario, runner, { extraNotes });
    if (opts.json) console.log(toJsonEnvelope("test", report));
    else console.log(renderTestReportPretty(report));
    // `inconclusive` fails too. It means an arm produced no scoreable trial, or
    // the judge refused on one arm far more than the other, and in both cases
    // the measurement did not happen. Exiting 0 there would report a green for
    // precisely the runs where the instrument broke down, which is this
    // project's documented dominant failure mode wearing a p-value.
    if (report.verdict === "hurts" || report.verdict === "inconclusive") process.exitCode = 1;
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
