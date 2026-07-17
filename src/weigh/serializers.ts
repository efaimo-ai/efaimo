import type { ToolDef } from "../core/types.js";

/**
 * Three documented serializations of tool definitions (docs/METHODOLOGY.md):
 * - rawJson: the tools/list payload, minified. A neutral lower-bound proxy.
 * - claudeStyle: one JSON object per tool with description/name/parameters,
 *   wrapped in a <functions> block, mirroring how Claude-family harnesses
 *   present tools in the system prompt.
 * - openaiTools: the Chat Completions `tools` array shape.
 * Hosts add their own fixed framing text around these; that overhead is
 * per-host constant and excluded on purpose.
 */

export function toolToClaudeLine(tool: ToolDef): string {
  return JSON.stringify({
    description: tool.description ?? "",
    name: tool.name,
    parameters: tool.inputSchema ?? { type: "object", properties: {} },
  });
}

export function serializeClaudeStyle(tools: ToolDef[]): string {
  const lines = tools.map((t) => `<function>${toolToClaudeLine(t)}</function>`);
  return `<functions>\n${lines.join("\n")}\n</functions>`;
}

export function toolToOpenAIEntry(tool: ToolDef): object {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

export function serializeOpenAITools(tools: ToolDef[]): string {
  return JSON.stringify(tools.map(toolToOpenAIEntry));
}

export function serializeRawJson(tools: ToolDef[]): string {
  return JSON.stringify(tools);
}

export function serializeSingle(tool: ToolDef): { rawJson: string; claudeStyle: string; openaiTools: string } {
  return {
    rawJson: JSON.stringify(tool),
    claudeStyle: toolToClaudeLine(tool),
    openaiTools: JSON.stringify(toolToOpenAIEntry(tool)),
  };
}
