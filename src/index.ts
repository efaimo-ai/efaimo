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
export { anthropicRunner } from "./testing/anthropicRunner.js";
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
} from "./reporters/pretty.js";
export {
  renderCheckMarkdown,
  renderSkillSetMarkdown,
  renderWeighMarkdown,
  renderDiffMarkdown,
} from "./reporters/markdown.js";
export { toJsonEnvelope } from "./reporters/json.js";
