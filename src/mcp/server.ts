import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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
 */

interface JsonSchema {
  type: "object";
  properties: Record<string, { type: string; description: string }>;
  required: string[];
  additionalProperties: false;
}

interface ToolAnnotations {
  readOnlyHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
  run: (args: Record<string, unknown>) => Promise<string>;
}

// Both tools only read local files, so the same hints apply: safe to call without
// a confirmation, safe to repeat, and not reaching out to any external service.
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`"${key}" is required and must be a non-empty string`);
  }
  return v;
}

const pathSchema = (what: string): JsonSchema => ({
  type: "object",
  properties: { path: { type: "string", description: what } },
  required: ["path"],
  additionalProperties: false,
});

const TOOLS: ToolDef[] = [
  {
    name: "efaimo_check_skill",
    description:
      "Lint an Agent Skill, or a folder of skills, for spec compliance, trigger quality, " +
      "context-window cost, reference integrity, and injection hygiene. Returns a grade from " +
      "A to F and the findings. Read-only: reads files only.",
    inputSchema: pathSchema("Path to a SKILL.md file or a directory that contains skills."),
    annotations: READ_ONLY,
    async run(args) {
      const p = requireString(args, "path");
      const res = await checkSkillSet(p, p);
      if (res.perSkill.length === 1 && res.setFindings.length === 0) {
        return renderCheckMarkdown(res.perSkill[0]!.report);
      }
      return renderSkillSetMarkdown(res);
    },
  },
  {
    name: "efaimo_weigh_skill",
    description:
      "Measure the context-window token cost of an Agent Skill: the metadata loaded into every " +
      "session and the body loaded when the skill triggers. Returns token counts per skill. " +
      "Read-only: reads files only.",
    inputSchema: pathSchema("Path to a SKILL.md file or a directory that contains skills."),
    annotations: READ_ONLY,
    async run(args) {
      const p = requireString(args, "path");
      const set = findSkills(p);
      if (!set.skills.length) throw new Error(`no SKILL.md found under "${p}"`);
      return renderWeighMarkdown(await weighSkills(set));
    },
  },
];

export function buildMcpServer(): Server {
  const server = new Server({ name: "efaimo", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find((t) => t.name === req.params.name);
    if (!tool) {
      return { content: [{ type: "text" as const, text: `unknown tool: ${req.params.name}` }], isError: true };
    }
    try {
      const text = await tool.run(req.params.arguments ?? {});
      return { content: [{ type: "text" as const, text }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: "text" as const, text: `error: ${message}` }], isError: true };
    }
  });

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = buildMcpServer();
  await server.connect(new StdioServerTransport());
  console.error(`efaimo mcp v${VERSION}: read-only skill tools ready on stdio`);
}
