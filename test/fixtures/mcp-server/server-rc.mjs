#!/usr/bin/env node
// Stateless 2026-07-28 stdio server for deterministic tests. It has no
// initialize (rejects it like a server that dropped the legacy handshake),
// answers bare tools/list and server/discover, and returns 2026-07-28-shaped
// results (resultType, ttlMs, cacheScope). Intentionally clean so a fully
// conformant server can be asserted to audit clean. No SDK dependency.
//
// Identity lives in _meta, not at the top level. The LOCKED RC carried
// DiscoverResult.serverInfo as an ordinary field; the spec that actually
// published on 2026-07-28 deleted it and moved identity to
// _meta["io.modelcontextprotocol/serverInfo"], where it is optional. This
// fixture is the published shape, because that is what "conformant" means now.
//
// Two env switches exist so the readers can be tested against shapes this
// fixture is not, without a second fixture file:
//   RC_FIXTURE_LEGACY_SERVERINFO=1  identity at the top level (locked-RC shape)
//   RC_FIXTURE_DISCOVER_NO_CACHE=1  server/discover answers without ttlMs and
//                                   cacheScope, which the published spec
//                                   requires by making DiscoverResult extend
//                                   CacheableResult (the RC did not).
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
const IDENTITY = { name: "rc-fixture", version: "0.0.1" };

const legacyIdentity = process.env.RC_FIXTURE_LEGACY_SERVERINFO === "1";
const discoverNoCache = process.env.RC_FIXTURE_DISCOVER_NO_CACHE === "1";

function discoverResult() {
  const base = {
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: {} },
    ...(discoverNoCache ? { resultType: "complete" } : CACHE),
  };
  return legacyIdentity
    ? { ...base, serverInfo: IDENTITY }
    : { ...base, _meta: { "io.modelcontextprotocol/serverInfo": IDENTITY } };
}

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
    send({ jsonrpc: "2.0", id, result: discoverResult() });
  } else if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
});
