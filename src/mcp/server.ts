import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { checkSkillSet } from "../check/check.js";
import { weighSkills } from "../weigh/weigh.js";
import { findSkills } from "../skills/parse.js";
import { renderCheckMarkdown, renderSkillSetMarkdown, renderWeighMarkdown } from "../reporters/markdown.js";
import { VERSION } from "../version.js";

/**
 * `efaimo mcp`: a small, read-only MCP server that exposes the skill checks to an
 * agent, so it can lint or weigh a skill mid-session before committing it to
 * context. Deliberately narrow: the tools only read files. They spawn no process
 * and open no socket (unlike `check --mcp`, which connects to a live server), and
 * `test` is not exposed at all because it spends tokens. That keeps the surface
 * safe for an agent to call unattended.
 *
 * Built on the 2.x SDK line since 0.5.0. The 1.x line speaks 2025-11-25 and
 * cannot answer `server/discover` or carry the SEP-2549 cache fields, so this
 * server failed two MUST-level items of the specification the rest of this tool
 * audits other servers against, and the skill this project publishes about that
 * migration opens with "upgrade the SDK first". It was the only server we ship
 * and the only one we had not migrated.
 *
 * `serveStdio` owns the era decision rather than this file: the opening exchange
 * selects it, one instance is pinned for the connection, and a 2025-era client
 * that opens with `initialize` is still served. Registering the tools once, on a
 * factory that serves both eras, is the whole reason to use it instead of
 * wiring a transport by hand.
 */

// Both tools only read local files, so the same hints apply: safe to call without
// a confirmation, safe to repeat, and not reaching out to any external service.
const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

// One shared shape. `.min(1)` is the schema saying what `requireString` used to
// say at runtime: an empty path is not a path. Under the 2.x registration the
// SDK validates against this before the handler runs, so the check moved from
// our code into the contract, which is where a client can also see it.
const pathInput = (what: string) => z.object({ path: z.string().min(1).describe(what) });

const CHECK_DESCRIPTION =
  "Lint an Agent Skill, or a folder of skills, for spec compliance, trigger quality, " +
  "context-window cost, reference integrity, and injection hygiene. Returns a grade from " +
  "A to F and the findings. Read-only: reads files only.";

const WEIGH_DESCRIPTION =
  "Measure the context-window token cost of an Agent Skill: the metadata loaded into every " +
  "session and the body loaded when the skill triggers. Returns token counts per skill. " +
  "Read-only: reads files only.";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const failure = (e: unknown) => ({
  content: [{ type: "text" as const, text: `error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "efaimo", version: VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    "efaimo_check_skill",
    {
      description: CHECK_DESCRIPTION,
      inputSchema: pathInput("Path to a SKILL.md file or a directory that contains skills."),
      annotations: READ_ONLY,
    },
    async ({ path }) => {
      try {
        const res = await checkSkillSet(path, path);
        if (res.perSkill.length === 1 && res.setFindings.length === 0) {
          return text(renderCheckMarkdown(res.perSkill[0]!.report));
        }
        return text(renderSkillSetMarkdown(res));
      } catch (e) {
        return failure(e);
      }
    },
  );

  server.registerTool(
    "efaimo_weigh_skill",
    {
      description: WEIGH_DESCRIPTION,
      inputSchema: pathInput("Path to a SKILL.md file or a directory that contains skills."),
      annotations: READ_ONLY,
    },
    async ({ path }) => {
      try {
        const set = findSkills(path);
        if (!set.skills.length) throw new Error(`no SKILL.md found under "${path}"`);
        return text(renderWeighMarkdown(await weighSkills(set)));
      } catch (e) {
        return failure(e);
      }
    },
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  // A factory, not an instance: `serveStdio` pins one per connection after the
  // opening exchange tells it which era it is talking to.
  serveStdio(() => buildMcpServer(), {
    onerror: (e) => console.error(`efaimo mcp: ${e.message}`),
  });
  console.error(`efaimo mcp v${VERSION}: read-only skill tools ready on stdio`);
  // stdin holds the process open; there is nothing to await. Returning a promise
  // that never settles would only make the shutdown path harder to read.
  await new Promise<void>(() => {});
}
