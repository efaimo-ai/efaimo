export type Severity = "error" | "warn" | "info";

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  message: string;
  /** Tool name, skill name, or file path this finding is about. */
  target?: string;
  detail?: string;
  fixHint?: string;
}

export type Surface = "mcp" | "skill";

export interface ToolDef {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface ResourceDef {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptDef {
  name: string;
  title?: string;
  description?: string;
}

export interface ServerIntrospection {
  targetLabel: string;
  transport: "stdio" | "http";
  /** For http targets: which transport actually worked. */
  httpTransport?: "streamable" | "sse-legacy";
  serverInfo?: { name?: string; version?: string; title?: string };
  protocolVersion?: string;
  instructions?: string;
  capabilities?: Record<string, unknown>;
  tools: ToolDef[];
  resources: ResourceDef[];
  prompts: PromptDef[];
  /** Raw JSON-RPC result object of tools/list (first page), for spec-field checks. */
  rawToolsListResult?: unknown;
  /** Diagnostics collected while connecting (stderr snippets, fallbacks used). */
  notes: string[];
}

export interface ProbeOutcome {
  ok: boolean;
  /** How a non-ok outcome failed: a JSON-RPC error, a timeout, or the process exiting. */
  kind?: "ok" | "error" | "timeout" | "exit";
  errorCode?: number;
  errorMessage?: string;
}

export interface ProbeResults {
  /** RC-style request without the legacy initialize handshake. */
  bareToolsList?: ProbeOutcome | { skipped: string };
  /** server/discover support (SEP-2575). */
  serverDiscover?: { supported: boolean; errorMessage?: string } | { skipped: string };
  /** Whether tools/list result carried the RC-required resultType field. */
  resultTypePresent?: boolean;
  /** Whether tools/list result carried both RC-required ttlMs and cacheScope (SEP-2549). */
  cacheFieldsPresent?: boolean;
  /** Same tool order across two fresh connections. */
  toolsOrderDeterministic?: boolean;
  /** Non-JSON noise observed on stdout before/between JSON-RPC messages (stdio only). */
  stdoutNoise?: string;
  httpAuth?: {
    required: boolean;
    wwwAuthenticate?: string;
    resourceMetadataUrl?: string;
    authorizationServer?: string;
    dcrRegistrationEndpoint?: boolean;
    cimdSupported?: boolean | undefined;
  };
  serverCard?: { found: boolean; url?: string } | { skipped: string };
}

export interface RepoMatch {
  category:
    | "sampling"
    | "roots"
    | "logging"
    | "elicitation"
    | "sse-resume"
    | "session-state"
    | "subscribe"
    | "ping";
  file: string;
  line: number;
  excerpt: string;
}

export interface RepoScan {
  root: string;
  sdk?: {
    package: string;
    range?: string;
    language: "ts" | "python";
    generation: "legacy" | "rc";
  }[];
  matches: RepoMatch[];
  filesScanned: number;
}

export interface SerializedTokens {
  rawJson: number;
  claudeStyle: number;
  openaiTools: number;
}

export interface ToolWeigh {
  name: string;
  tokens: SerializedTokens;
  descriptionTokens: number;
  schemaTokens: number;
}

export interface ServerWeighResult {
  kind: "mcp";
  label: string;
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  perTool: ToolWeigh[];
  totals: SerializedTokens;
  /**
   * Claude-style block framing: totals.claudeStyle minus the sum of per-tool
   * lines, i.e. the <functions>/<function> wrapper the per-tool numbers
   * exclude. perTool claudeStyle + this = totals.claudeStyle. Optional so
   * pre-0.1.0 --diff baselines still parse.
   */
  framingTokens?: number;
  instructionsTokens: number;
  /** Exact count via Anthropic count_tokens API, when a key was provided. */
  anthropicExactTotal?: number;
  notes: string[];
}

export interface SkillWeighEntry {
  name: string;
  dir: string;
  metadataTokens: number;
  bodyTokens: number;
  bodyLines: number;
  refFileCount: number;
  refFileTokens: number;
}

export interface SkillSetWeighResult {
  kind: "skill";
  label: string;
  perSkill: SkillWeighEntry[];
  totals: { metadata: number; body: number; refFiles: number };
  notes: string[];
}

export type WeighResult = ServerWeighResult | SkillSetWeighResult;

export interface SkillInfo {
  dir: string;
  file: string;
  name?: string;
  description?: string;
  frontmatter: Record<string, unknown>;
  frontmatterRaw: string;
  body: string;
  bodyLines: number;
  referencedPaths: { raw: string; resolved: string; exists: boolean; source: "link" | "code" }[];
  files: { path: string; bytes: number }[];
  parseError?: string;
}

export interface SkillSet {
  root: string;
  skills: SkillInfo[];
}

export interface GradeInfo {
  score: number;
  letter: "A" | "B" | "C" | "D" | "F";
}

export interface CheckReport {
  tool: "efaimo";
  version: string;
  surface: Surface;
  target: string;
  /** Graded findings: quality rules (and every skill rule). */
  findings: Finding[];
  counts: { error: number; warn: number; info: number };
  grade: GradeInfo;
  /**
   * MCP only: 2026-07-28 readiness findings (E101-E118), reported as an
   * ungraded migration diff. The target spec is not final until 2026-07-28,
   * so unreadiness is a to-do list, not a quality defect.
   */
  readiness?: { findings: Finding[]; counts: { error: number; warn: number; info: number } };
  notes: string[];
}

export interface McpRuleContext {
  intro: ServerIntrospection;
  probes?: ProbeResults;
  repo?: RepoScan;
  weigh?: ServerWeighResult;
}

export interface SkillRuleContext {
  skill: SkillInfo;
  set: SkillSet;
  weigh?: SkillSetWeighResult;
}

export interface McpRule {
  id: string;
  title: string;
  surface: "mcp";
  check(ctx: McpRuleContext): Finding[];
}

export interface SkillRule {
  id: string;
  title: string;
  surface: "skill";
  check(ctx: SkillRuleContext): Finding[];
}
