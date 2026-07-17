import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../src/mcp/server.js";

/** Drive the real server through a real client over a linked in-memory transport. */
async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await buildMcpServer().connect(serverTransport);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

describe("efaimo mcp server", () => {
  it("lists two read-only skill tools with annotations", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["efaimo_check_skill", "efaimo_weigh_skill"]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.inputSchema.required).toEqual(["path"]);
    }
    await client.close();
  });

  it("checks a real skill via tools/call and returns a grade", async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: "efaimo_check_skill", arguments: { path: "examples/csv-cleanup" } });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    expect(res.isError).toBeFalsy();
    expect(text).toMatch(/grade [A-F]/);
    await client.close();
  });

  it("weighs a real skill via tools/call and reports token cost", async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: "efaimo_weigh_skill", arguments: { path: "examples/csv-cleanup" } });
    const text = (res.content as { type: string; text: string }[])[0]!.text;
    expect(res.isError).toBeFalsy();
    expect(text.toLowerCase()).toContain("metadata");
    await client.close();
  });

  it("reports a tool error as isError, not a thrown exception", async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: "efaimo_check_skill", arguments: { path: "does/not/exist" } });
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("rejects a missing required argument", async () => {
    const client = await connectedClient();
    const res = await client.callTool({ name: "efaimo_check_skill", arguments: {} });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
