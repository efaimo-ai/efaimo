// Weighs a plausible MCP loadout and writes the site's stack dataset.
//
// The site's other figures come from one reference server, which is the right
// unit for showing *how* the cost happens (per tool, per serialization) and
// the wrong unit for showing *how much*: nobody installs server-everything.
// This produces the how-much number, from servers people actually install.
//
// Usage (from the efaimo repo root, after `pnpm build`):
//   node scripts/stack-cost.mjs ../efaimo-ai/src/data/mcp-stack-cost.json
//
// Placeholder credentials are passed where a server wants them. Listing tools
// does not authenticate, so the manifest -- and therefore its token cost -- is
// what a real install loads. Servers are pinned by the versions npm resolved
// at generation time and recorded in the output; re-run rather than trusting
// the file's age.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
if (!OUT) {
  console.error("usage: node scripts/stack-cost.mjs <output.json>");
  process.exit(2);
}

const CLI = path.join(import.meta.dirname, "..", "dist", "cli.js");
if (!fs.existsSync(CLI)) {
  console.error(`${CLI} not found; run \`pnpm build\` first`);
  process.exit(2);
}

// A loadout, not a census: popular, installs from npm, and lists its tools
// without real credentials. Swap the list and the total moves a lot, which is
// the point the site should be making.
const STACK = [
  { pkg: "@notionhq/notion-mcp-server", cmd: "npx -y @notionhq/notion-mcp-server" },
  { pkg: "firecrawl-mcp", cmd: "npx -y firecrawl-mcp" },
  { pkg: "@playwright/mcp", cmd: "npx -y @playwright/mcp" },
  { pkg: "@modelcontextprotocol/server-filesystem", cmd: "npx -y @modelcontextprotocol/server-filesystem ." },
  { pkg: "@modelcontextprotocol/server-everything", cmd: "npx -y @modelcontextprotocol/server-everything" },
  { pkg: "@upstash/context7-mcp", cmd: "npx -y @upstash/context7-mcp" },
  { pkg: "@modelcontextprotocol/server-memory", cmd: "npx -y @modelcontextprotocol/server-memory" },
  { pkg: "@modelcontextprotocol/server-sequential-thinking", cmd: "npx -y @modelcontextprotocol/server-sequential-thinking" },
];

const env = {
  ...process.env,
  NOTION_TOKEN: "placeholder",
  OPENAPI_MCP_HEADERS: "{}",
  FIRECRAWL_API_KEY: "placeholder",
  NO_COLOR: "1",
};

function npmVersion(pkg) {
  const r = spawnSync("npm", ["view", pkg, "version"], { encoding: "utf8", shell: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

const servers = [];
const skipped = [];

for (const s of STACK) {
  process.stderr.write(`weighing ${s.pkg} ... `);
  const r = spawnSync(process.execPath, [CLI, "weigh", "--stdio", s.cmd, "--json"], {
    encoding: "utf8",
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    process.stderr.write("SKIP (no JSON)\n");
    skipped.push({ pkg: s.pkg, reason: "did not produce a report" });
    continue;
  }
  const d = parsed?.data;
  if (!d || typeof d.totals?.claudeStyle !== "number" || d.totals.claudeStyle <= 0) {
    process.stderr.write("SKIP (no tools)\n");
    skipped.push({ pkg: s.pkg, reason: "listed no tools" });
    continue;
  }
  servers.push({
    pkg: s.pkg,
    version: npmVersion(s.pkg),
    command: s.cmd,
    toolCount: d.toolCount,
    tokens: {
      claudeStyle: d.totals.claudeStyle,
      rawJson: d.totals.rawJson,
      openaiTools: d.totals.openaiTools,
    },
  });
  process.stderr.write(`${d.totals.claudeStyle} tokens, ${d.toolCount} tools\n`);
}

if (servers.length === 0) {
  console.error("no server could be weighed; refusing to write an empty dataset");
  process.exit(1);
}

// Heaviest first, so consumers can treat index 0 as the biggest offender the
// same way they already do for perTool in weigh-everything.json.
servers.sort((a, b) => b.tokens.claudeStyle - a.tokens.claudeStyle);

const totals = servers.reduce(
  (acc, s) => ({
    claudeStyle: acc.claudeStyle + s.tokens.claudeStyle,
    rawJson: acc.rawJson + s.tokens.rawJson,
    openaiTools: acc.openaiTools + s.tokens.openaiTools,
    toolCount: acc.toolCount + s.toolCount,
  }),
  { claudeStyle: 0, rawJson: 0, openaiTools: 0, toolCount: 0 },
);

const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"));

const out = {
  tool: "efaimo",
  version: pkg.version,
  kind: "stack",
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  data: {
    note:
      "A plausible loadout, not a census. Popular servers that install from npm and list " +
      "their tools without real credentials. Swap the list and the total moves a lot.",
    serverCount: servers.length,
    toolCount: totals.toolCount,
    totals: { claudeStyle: totals.claudeStyle, rawJson: totals.rawJson, openaiTools: totals.openaiTools },
    servers,
    skipped,
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.error(
  `\nwrote ${OUT}: ${servers.length} servers, ${totals.toolCount} tools, ${totals.claudeStyle} tokens` +
    (skipped.length ? ` (skipped ${skipped.length})` : ""),
);
