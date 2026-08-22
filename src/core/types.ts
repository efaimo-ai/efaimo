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
  /**
   * Set false by findings that must be reported but must not affect the score.
   * Today that is the injection heuristics (E130, S105): they are shallow
   * patterns an attacker evades trivially, and `src/rules/injection.ts` says
   * so in its own comment. Letting them dock the grade made a linter hint
   * behave like a security verdict, and ten of them cost a full letter.
   * Defaults to graded, so a rule opts out deliberately or not at all.
   */
  graded?: boolean;
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
  /** Whether tools/list result carried both required ttlMs and cacheScope (SEP-2549). */
  cacheFieldsPresent?: boolean;
  /**
   * Same question for the server/discover result, measured separately because
   * the answer changed between the locked RC and the published spec: the RC's
   * DiscoverResult extended plain Result, the published 2026-07-28 extends
   * CacheableResult, so cache fields are required there now and were not then.
   * Undefined when server/discover did not answer at all (E106's job).
   */
  discoverCacheFieldsPresent?: boolean;
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
  /**
   * The model `anthropicExactTotal` was measured against. Always set when the
   * total is: Claude model lines do not share a tokenizer, so the figure is
   * exact for this model and approximate for any other, and a count printed
   * without its model cannot be reproduced.
   */
  anthropicExactModel?: string;
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

/** One tool's result in the findability report (`efaimo find`). */
export interface ToolFindEntry {
  name: string;
  /**
   * Terms this tool has that no other tool in the catalog has.
   *
   * The primary signal, and the only one here that is not a model of anything:
   * if this is empty, every word the tool contains also appears on some other
   * tool, so no query can match it without also matching a competitor. That is
   * a property of the catalog, provable by inspection, with no assumption
   * about how anyone searches. Capped for display.
   */
  ownTerms: string[];
  /** How many exclusive terms there are in total, before the display cap. */
  ownTermCount: number;
  /**
   * How many of them survive if the searcher does not know the tool's name.
   *
   * Names are searchable, so a tool whose only exclusive word is its own name
   * is findable in principle. It is not findable by anyone describing a task,
   * which is the situation deferred loading creates. E146 is this number
   * reaching zero while `ownTermCount` does not.
   */
  ownOutsideNameCount: number;
  /** When ownTermCount is 0: tools whose vocabulary covers this one's (capped). */
  sharedWith: string[];
  /**
   * The terms this tool's own description offers a searcher, most distinctive
   * first. Never includes the tool's name: the point of the probe is that the
   * person searching does not know it.
   */
  query: string[];
  /** 1-based rank for that query. Undefined when the description offers no searchable word. */
  rank?: number;
  /** BM25 score for its own query, kept so a reader can check the arithmetic. */
  score: number;
  /** Tools that scored higher for this tool's own query (capped at 3). */
  outrankedBy: string[];
  /** Tools whose score is indistinguishable from this one's, so only the tie-break separates them. Capped for display. */
  tiedWith: string[];
  /** How many there are in total, before the display cap. */
  tiedWithCount: number;
  /** Rank falls inside the simulated result window. The per-tool form of `probe`. */
  reachable: boolean;
  /** Every token of the name is a generic word (E144). */
  genericName: boolean;
}

export interface FindResult {
  kind: "find";
  label: string;
  toolCount: number;
  /** The whole method, carried with the numbers so a report is self-describing. */
  method: {
    tokenizer: string;
    bm25: { k1: number; b: number };
    queryTerms: number;
    topK: number;
  };
  perTool: ToolFindEntry[];
  /**
   * The headline: how many tools own at least one word no other tool has.
   * A measured proportion, deliberately not a letter grade (ADR-030).
   */
  distinct: { count: number; total: number; pct: number };
  /**
   * Secondary: how many tools a simulated BM25 search for their own
   * description returns inside the result window.
   *
   * Named `probe` in the JSON, in the output and in the docs, all three. It
   * was `reach` in one of them and `probe` in the others for a day, which is
   * how someone scripting a gate on the number they saw printed ends up
   * looking for a field that does not exist.
   *
   * Kept, and kept second, because it is the only number here that models the
   * actual mechanism, and because it saturates: 100% on every real server
   * measured. Treat it as a floor test that catches catastrophe, not as a
   * ranking. See docs/METHODOLOGY.md.
   */
  probe: { returned: number; total: number; pct: number };
  /** toolCount <= topK, which makes the probe figure 100% by construction. */
  windowCoversCatalog: boolean;
  /**
   * toolCount < 2, which makes the DISTINCT figure 100% by construction: with
   * one tool every term it has is trivially exclusive. `--min-distinct` cannot
   * be evaluated in that state and refuses rather than passing.
   */
  distinctVacuous: boolean;
  definitionTokens?: number;
  /** Anthropic's guidance recommends tool search for a catalog this shape. */
  deferRecommended: boolean;
  /** Which of the checkable conditions fired, in words. Empty when none did. */
  deferBecause: string[];
  notes: string[];
}

export interface SkillInfo {
  dir: string;
  file: string;
  name?: string;
  description?: string;
  frontmatter: Record<string, unknown>;
  frontmatterRaw: string;
  body: string;
  bodyLines: number;
  /** `escapes` = the reference resolves outside the skill directory. weigh must not read those; S106 reports them. */
  referencedPaths: { raw: string; resolved: string; exists: boolean; escapes: boolean; source: "link" | "code" }[];
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
   * ungraded migration diff: a migration not yet made is a to-do list, not a
   * quality defect in what shipped.
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

export interface FindRuleContext {
  find: FindResult;
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

export interface FindRule {
  id: string;
  title: string;
  surface: "find";
  check(ctx: FindRuleContext): Finding[];
}
