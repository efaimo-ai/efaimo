import type {
  ServerIntrospection,
  ServerWeighResult,
  SkillSet,
  SkillSetWeighResult,
  ToolWeigh,
} from "../core/types.js";
import { countClaudeToolTokens } from "./anthropicExact.js";
import { serializeClaudeStyle, serializeOpenAITools, serializeRawJson, serializeSingle } from "./serializers.js";
import { loadTokenizer } from "./tokens.js";
import { isBinaryPath, readTextSafe } from "../util/misc.js";

export async function weighServer(
  intro: ServerIntrospection,
  opts: { anthropicApiKey?: string; anthropicModel?: string } = {},
): Promise<ServerWeighResult> {
  const count = await loadTokenizer();
  const perTool: ToolWeigh[] = [];
  for (const tool of intro.tools) {
    const s = serializeSingle(tool);
    perTool.push({
      name: tool.name,
      tokens: {
        rawJson: count(s.rawJson),
        claudeStyle: count(s.claudeStyle),
        openaiTools: count(s.openaiTools),
      },
      descriptionTokens: count(tool.description ?? ""),
      schemaTokens: count(JSON.stringify(tool.inputSchema ?? {})),
    });
  }
  perTool.sort((a, b) => b.tokens.claudeStyle - a.tokens.claudeStyle);

  const totals = {
    rawJson: count(serializeRawJson(intro.tools)),
    claudeStyle: count(serializeClaudeStyle(intro.tools)),
    openaiTools: count(serializeOpenAITools(intro.tools)),
  };

  const notes = [
    "token counts are estimates using the o200k_base tokenizer; hosts add fixed framing text on top (see docs/METHODOLOGY.md)",
  ];

  let anthropicExactTotal: number | undefined;
  if (opts.anthropicApiKey && intro.tools.length > 0) {
    anthropicExactTotal = await countClaudeToolTokens(intro.tools, {
      apiKey: opts.anthropicApiKey,
      model: opts.anthropicModel,
    });
    if (anthropicExactTotal !== undefined) {
      notes.push("anthropic-exact measured via /v1/messages/count_tokens (tools delta)");
    } else {
      notes.push("anthropic-exact measurement failed; showing o200k estimates only");
    }
  }

  return {
    kind: "mcp",
    label: intro.targetLabel,
    toolCount: intro.tools.length,
    resourceCount: intro.resources.length,
    promptCount: intro.prompts.length,
    perTool,
    totals,
    instructionsTokens: count(intro.instructions ?? ""),
    anthropicExactTotal,
    notes,
  };
}

export async function weighSkills(set: SkillSet): Promise<SkillSetWeighResult> {
  const count = await loadTokenizer();
  const perSkill: SkillSetWeighResult["perSkill"] = [];
  for (const skill of set.skills) {
    const name = skill.name ?? "(unnamed)";
    const metadataTokens = count(`${name}: ${skill.description ?? ""}`);
    const bodyTokens = count(skill.body);
    let refFileTokens = 0;
    let refFileCount = 0;
    for (const ref of skill.referencedPaths) {
      if (!ref.exists || isBinaryPath(ref.resolved)) continue;
      const text = readTextSafe(ref.resolved);
      if (text === undefined) continue;
      refFileCount++;
      refFileTokens += count(text);
    }
    perSkill.push({
      name,
      dir: skill.dir,
      metadataTokens,
      bodyTokens,
      bodyLines: skill.bodyLines,
      refFileCount,
      refFileTokens,
    });
  }

  return {
    kind: "skill",
    label: set.root,
    perSkill,
    totals: {
      metadata: perSkill.reduce((s, x) => s + x.metadataTokens, 0),
      body: perSkill.reduce((s, x) => s + x.bodyTokens, 0),
      refFiles: perSkill.reduce((s, x) => s + x.refFileTokens, 0),
    },
    notes: [
      "metadata loads at session start for every installed skill; body loads on trigger; referenced files load on demand",
      "token counts are o200k_base estimates (see docs/METHODOLOGY.md)",
    ],
  };
}
