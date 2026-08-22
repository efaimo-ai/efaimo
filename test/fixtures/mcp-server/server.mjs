#!/usr/bin/env node
// Minimal legacy-style stdio MCP server for deterministic tests.
// Speaks JSON-RPC over line-delimited stdio: initialize, tools/list.
// Intentionally imperfect (thin descriptions, no annotations, a destructive
// tool) so the check rules have something to find. No SDK dependency.
import readline from "node:readline";

const TOOLS = [
  {
    name: "add",
    description:
      "Add two integers together and return their sum. Use this when the user asks for arithmetic addition; returns the numeric result.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "first addend" },
        b: { type: "number", description: "second addend" },
      },
      required: ["a", "b"],
    },
  },
  {
    name: "echo",
    description: "echo",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "delete_everything",
    description: "Delete all records in the datastore permanently.",
    inputSchema: { type: "object", properties: { confirm: { type: "boolean" } } },
  },
];

// With FIXTURE_TOOLS=dup this serves two tools whose vocabulary is identical
// apart from their names, so `efaimo find` has a catalog where a tool owns no
// exclusive word. Off by default: every other test in the suite depends on the
// three tools above.
const DUP_TOOLS = [
  {
    name: "fetch_page",
    description: "Fetch a page from the site and return its contents as text.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "the page address" } } },
  },
  {
    name: "load_page",
    description: "Fetch a page from the site and return its contents as text.",
    inputSchema: { type: "object", properties: { url: { type: "string", description: "the page address" } } },
  },
];

const SERVED =
  process.env.FIXTURE_TOOLS === "dup" ? DUP_TOOLS
  : process.env.FIXTURE_TOOLS === "one" ? [TOOLS[0]]
  : TOOLS;

const rl = readline.createInterface({ input: process.stdin });
function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    return;
  }
  const { id, method } = msg;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {}, logging: {} },
        serverInfo: { name: "fixture-server", version: "0.0.1" },
      },
    });
  } else if (method === "notifications/initialized") {
    // no reply
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: SERVED } });
  } else if (method === "resources/list") {
    send({ jsonrpc: "2.0", id, result: { resources: [] } });
  } else if (method === "prompts/list") {
    send({ jsonrpc: "2.0", id, result: { prompts: [] } });
  } else if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
});
