#!/usr/bin/env node
// Stateless 2026-07-28-style stdio server for deterministic tests. It has no
// initialize (rejects it like an RC server that dropped the legacy handshake),
// answers bare tools/list and server/discover, and returns RC-shaped results
// (resultType, ttlMs, cacheScope). Intentionally clean so a fully conformant
// server can be asserted to audit clean. No SDK dependency.
import readline from "node:readline";

const TOOLS = [
  {
    name: "get_record",
    description:
      "Fetch a single record by id from the demo datastore. Use when the user asks for one specific record; returns the record object, or null when the id does not exist.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "record id to fetch" } },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_records",
    description:
      "List records from the demo datastore with optional paging. Use when the user asks to enumerate stored records; returns a JSON array of record objects.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "maximum records to return" } },
    },
    annotations: { readOnlyHint: true },
  },
];

const CACHE = { resultType: "complete", ttlMs: 60000, cacheScope: "public" };

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
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS, ...CACHE } });
  } else if (method === "server/discover") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        supportedVersions: ["2026-07-28"],
        capabilities: { tools: {} },
        serverInfo: { name: "rc-fixture", version: "0.0.1" },
        ...CACHE,
      },
    });
  } else if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
});
