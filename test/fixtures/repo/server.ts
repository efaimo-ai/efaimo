// Fixture "server repo" source for the static repo scanner. Not executed.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const server = new Server({ name: "legacy", version: "1.0.0" });

async function summarize(text: string) {
  // deprecated Sampling usage
  const result = await server.createMessage({
    messages: [{ role: "user", content: { type: "text", text } }],
    maxTokens: 100,
  });
  return result;
}

async function whereAmI() {
  // deprecated Roots usage
  const roots = await server.listRoots();
  return roots;
}

function logHello() {
  // deprecated Logging usage
  server.sendLoggingMessage({ level: "info", data: "hello" });
}

const sessions = new Map(); // in-process session state
