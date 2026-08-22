// Public library API. Kept deliberately small: only task-level entry points,
// their types, and the renderers. Rule tables, the rule engine, injection
// patterns, and grading internals are intentionally NOT exported so they stay
// free to change without a breaking release. The CLI imports modules directly.

export * from "./core/types.js";
export { VERSION } from "./version.js";

// Targets
export { resolveTarget, type ResolvedTarget, type ResolveOptions } from "./targets/resolve.js";
export { loadClientServers, SUPPORTED_CLIENTS } from "./targets/clientConfigs.js";

// Introspect + weigh
export { introspectServer } from "./clients/introspect.js";
export { weighServer, weighSkills } from "./weigh/weigh.js";
export { diffServerWeigh, type WeighDiff } from "./weigh/diff.js";
export { countTokens } from "./weigh/tokens.js";

// Skills
export { findSkills, parseSkillFile } from "./skills/parse.js";

// Find (findability under deferred tool loading)
//
// Exported because docs/INTEGRATIONS.md promises "every capability is also a
// typed function", and the blanket re-export of core/types.js was already
// publishing FindResult and ToolFindEntry: a public type with nothing public
// that produces one. runFindRules is here for the same reason its output is,
// even though the rule TABLE stays private like the other two.
export { analyzeFind, indexedTerms, taskQuery, DEFAULT_TOP_K, DEFAULT_QUERY_TERMS, DEFER_RECOMMENDED_TOKENS, DEFER_RECOMMENDED_TOOLS, type FindOptions } from "./find/find.js";
export { runFindRules } from "./core/engine.js";
export { RULES_VERSION } from "./rules/version.js";

// Check (audit)
export { checkMcpTarget, checkMcpRepoOnly, checkSkillSet, type SkillReport, type CheckSkillResult } from "./check/check.js";

// Test (skill A/B outcome harness)
export {
  parseScenario,
  runScenario,
  armSystems,
  type Scenario,
  type TestReport,
  type Runner,
} from "./testing/harness.js";
export { anthropicRunner, acceptsSamplingParams, anthropicRequestBody } from "./testing/anthropicRunner.js";
export { openaiRunner, providerForModel } from "./testing/openaiRunner.js";

// Reporters (report -> string; stable value-in/string-out contract)
export {
  renderCheckPretty,
  renderSkillSetPretty,
  renderServerWeighPretty,
  renderSkillWeighPretty,
  renderDiffPretty,
  renderScenarioPlan,
  renderTestReportPretty,
  renderFindPretty,
  renderFindFindingsPretty,
} from "./reporters/pretty.js";
export {
  renderCheckMarkdown,
  renderSkillSetMarkdown,
  renderWeighMarkdown,
  renderDiffMarkdown,
  renderFindMarkdown,
} from "./reporters/markdown.js";
export { toJsonEnvelope } from "./reporters/json.js";
