/** Source on the local filesystem. Engine reads files scoped to `dir`. */
export interface PathSource {
  kind: "path";
  dir: string;
}

/**
 * Remote git source. Engine clones into a tempdir with `token`, checks out
 * `ref` (defaults to HEAD), reads files, then cleans up. Read-only in v1;
 * no branch push and no PR creation.
 */
export interface GitSource {
  kind: "git";
  repoUrl: string;
  token: string;
  ref?: string;
}

export type Source = PathSource | GitSource;

export type LlmProvider = "anthropic" | "openai";

/** BYOK LLM configuration. `apiKey` is caller-supplied per invocation. */
export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * What the engine is being asked to fix.
 *
 * - `span`  — fix the specific failing span(s) on the given trace.
 * - `trace` — analyze the whole trace, fix any failure it finds.
 * - `bisect` — binary-search the commit range [from, to] to find the
 *   regression commit, then propose a fix against that commit.
 */
export type FixMode =
  | { kind: "span" }
  | { kind: "trace" }
  | { kind: "bisect"; from: string; to: string };

/** Progress events emitted during `fix()`. P3/P5 stream these over SSE. */
export type FixProgress =
  | { kind: "fetching-trace" }
  | { kind: "reading-source"; fileCount: number }
  | { kind: "calling-llm"; provider: LlmProvider; model: string }
  | { kind: "parsing-diff" }
  | { kind: "bisect-iteration"; sha: string; depth: number }
  | { kind: "bisect-found"; sha: string };

export interface FixOptions {
  traceId: string;
  collectorUrl: string;
  source: Source;
  llm: LlmConfig;
  mode: FixMode;
  /** Optional progress callback. Called synchronously in emission order. */
  onProgress?: (event: FixProgress) => void;
}

export interface FixResult {
  /** Unified diff in `git apply`-compatible format. */
  diff: string;
  /** Human-readable explanation of the fix. */
  explanation: string;
  /** File paths touched by the diff. Relative to the source root. */
  filesChanged: string[];
  /** Pathlight trace ID of the meta-trace emitted by this invocation. */
  metaTraceId?: string;
  /** Bisect only: the commit that introduced the regression. */
  regressionSha?: string;
  /** Bisect only: the parent of `regressionSha` (last known good). */
  parentSha?: string;
}

/** All engine failures surface as FixError. Never leaks API keys or tokens. */
export class FixError extends Error {
  public readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FixError";
    this.cause = cause;
  }
}
