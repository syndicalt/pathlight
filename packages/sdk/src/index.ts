/**
 * Pathlight TypeScript SDK
 *
 * Usage:
 *   import { Pathlight } from "@pathlight/sdk";
 *
 *   const tl = new Pathlight({
 *     baseUrl: "http://localhost:4100",
 *     projectId: "my-project",
 *   });
 *
 *   const trace = tl.trace("research-agent", { query: "..." });
 *   const span = trace.span("llm.chat", "llm", { model: "gpt-4o" });
 *   span.end({ output: result, inputTokens: 100, outputTokens: 200 });
 *   trace.end({ output: finalResult });
 */

// Git metadata is captured on Node.js only. In React Native / browser bundles
// (Metro, webpack, Vite) a static `import "node:child_process"` would be
// hoisted into the output and blow up the bundle, so the import is hidden
// behind a runtime require that static analyzers cannot see.
type ExecSync = (typeof import("node:child_process"))["execSync"];

export interface GitContext {
  commit: string;
  branch: string;
  dirty: boolean;
}

let cachedGit: GitContext | null | undefined;
let cachedExec: ExecSync | null | undefined;

function loadExecSync(): ExecSync | null {
  if (cachedExec !== undefined) return cachedExec;
  // Bail on non-Node runtimes (RN has no `process.versions.node`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (globalThis as any).process;
  if (!proc || !proc.versions || !proc.versions.node) {
    cachedExec = null;
    return null;
  }
  try {
    // Function-constructor require() is opaque to bundlers so the
    // `node:child_process` string is never statically resolved.
    const mod = Function("return require('node:child_process')")() as typeof import("node:child_process");
    cachedExec = mod.execSync;
    return cachedExec;
  } catch {
    cachedExec = null;
    return null;
  }
}

// Capture git HEAD / branch / dirtiness once per process. Returns null when the
// process isn't Node, isn't inside a git checkout, or git isn't on PATH.
function detectGitContext(): GitContext | null {
  if (cachedGit !== undefined) return cachedGit;
  const execSync = loadExecSync();
  if (!execSync) {
    cachedGit = null;
    return null;
  }
  try {
    const commit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const status = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    cachedGit = { commit, branch, dirty: status.length > 0 };
  } catch {
    cachedGit = null;
  }
  return cachedGit;
}

// Capture the caller's source location from the stack trace
function captureSource(): { file: string; line: number; column: number; func: string } | null {
  const err = new Error();
  const stack = err.stack?.split("\n");
  if (!stack) return null;

  // Walk up the stack to find the first frame outside the SDK
  for (let i = 1; i < stack.length; i++) {
    const frame = stack[i].trim();
    // Skip frames from this SDK file
    if (frame.includes("/sdk/") || frame.includes("@pathlight/sdk")) continue;
    if (frame.includes("node:") || frame.includes("node_modules")) continue;

    // Parse "at functionName (file:line:col)" or "at file:line:col"
    const match = frame.match(/at\s+(?:(.+?)\s+\()?((?:file:\/\/)?(.+?)):(\d+):(\d+)\)?/);
    if (match) {
      return {
        func: match[1] || "(anonymous)",
        file: match[3] || match[2],
        line: parseInt(match[4]),
        column: parseInt(match[5]),
      };
    }
  }
  return null;
}

interface PathlightConfig {
  baseUrl: string;
  projectId?: string;
  apiKey?: string;
  /** Disable automatic git-context capture (commit/branch/dirty). */
  disableGitContext?: boolean;
  /**
   * Provide git context explicitly. Use this in environments where the SDK
   * cannot shell out to `git` (React Native, browsers, sandboxed runtimes):
   * capture the values at build time and pass them in. When set, this
   * overrides any auto-detection.
   */
  git?: GitContext | null;
}

interface CreatedResponse {
  id: string;
}

export class PathlightHttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "PathlightHttpError";
    this.status = status;
    this.body = body;
  }
}

export class Pathlight {
  private baseUrl: string;
  private projectId?: string;
  private apiKey?: string;
  private gitContextDisabled: boolean;
  private gitOverride: GitContext | null | undefined;

  constructor(config: PathlightConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.projectId = config.projectId;
    this.apiKey = config.apiKey;
    this.gitContextDisabled = !!config.disableGitContext;
    this.gitOverride = config.git;
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return parseCollectorResponse<T>(res);
  }

  private async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    return parseCollectorResponse<T>(res);
  }

  trace(name: string, input?: unknown, options?: { tags?: string[]; metadata?: unknown }): Trace {
    return new Trace(this, name, input, options);
  }

  /**
   * Register a live breakpoint that pauses execution until the dashboard
   * resumes it. Returns the (possibly-modified) state the caller passed in.
   *
   * Typical use:
   *
   *   const state = await tl.breakpoint({
   *     label: "post-retrieval",
   *     state: { docs, query },
   *   });
   *
   * If the dashboard edits `state` before resuming, the edited value is what
   * the promise resolves to — so downstream code sees the override.
   */
  async breakpoint<T = unknown>(options: {
    label: string;
    state?: T;
    traceId?: string;
    spanId?: string;
    /** Maximum time to wait before auto-resuming with the original state. */
    timeoutMs?: number;
  }): Promise<T> {
    const res = await fetch(`${this.baseUrl}/v1/breakpoints`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        label: options.label,
        state: options.state ?? null,
        traceId: options.traceId,
        spanId: options.spanId,
        timeoutMs: options.timeoutMs,
      }),
    });

    if (res.status === 408 || !res.ok) {
      // Auto-resume on timeout or error — don't wedge the caller.
      return (options.state as T) ?? (null as unknown as T);
    }
    const body = (await res.json()) as { state?: T };
    return (body.state ?? (options.state as T)) as T;
  }

  /** @internal */
  async _createTrace(data: { name: string; projectId?: string; input?: unknown; tags?: string[]; metadata?: unknown }) {
    const git = this.gitContextDisabled
      ? null
      : this.gitOverride !== undefined
        ? this.gitOverride
        : detectGitContext();
    return this.post<CreatedResponse>("/v1/traces", {
      ...data,
      projectId: data.projectId || this.projectId,
      ...(git
        ? { gitCommit: git.commit, gitBranch: git.branch, gitDirty: git.dirty }
        : {}),
    });
  }

  /** @internal */
  async _updateTrace(id: string, data: Record<string, unknown>) {
    return this.patch(`/v1/traces/${id}`, data);
  }

  /** @internal */
  async _createSpan(data: Record<string, unknown>) {
    return this.post<CreatedResponse>("/v1/spans", data);
  }

  /** @internal */
  async _updateSpan(id: string, data: Record<string, unknown>) {
    return this.patch(`/v1/spans/${id}`, data);
  }

  /** @internal */
  async _createEvent(spanId: string, data: Record<string, unknown>) {
    return this.post(`/v1/spans/${spanId}/events`, data);
  }
}

async function parseCollectorResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text.length > 0 ? parseJsonOrText(text) : {};
  if (!res.ok) {
    throw new PathlightHttpError(res.status, collectorErrorMessage(res.status, body), body);
  }
  return body as T;
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function collectorErrorMessage(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string") return `Pathlight collector error ${status}: ${error}`;
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return `Pathlight collector error ${status}: ${message}`;
    }
  }
  return `Pathlight collector error ${status}`;
}

export class Trace {
  private client: Pathlight;
  private _id: string | null = null;
  private _name: string;
  private _input?: unknown;
  private _options?: { tags?: string[]; metadata?: unknown };
  private _startTime = Date.now();
  private _totalTokens = 0;
  private _totalCost = 0;
  private _initPromise: Promise<void>;

  constructor(client: Pathlight, name: string, input?: unknown, options?: { tags?: string[]; metadata?: unknown }) {
    this.client = client;
    this._name = name;
    this._input = input;
    this._options = options;

    // Start trace creation immediately
    this._initPromise = this._init();
  }

  private async _init() {
    const result = await this.client._createTrace({
      name: this._name,
      input: this._input,
      tags: this._options?.tags,
      metadata: this._options?.metadata,
    });
    this._id = result.id;
  }

  get id(): Promise<string> {
    return this._initPromise.then(() => this._id!);
  }

  span(name: string, type: "llm" | "tool" | "retrieval" | "agent" | "chain" | "custom", options?: {
    parentSpanId?: string;
    model?: string;
    provider?: string;
    toolName?: string;
    toolArgs?: unknown;
    input?: unknown;
    metadata?: unknown;
  }): Span {
    return new Span(this.client, this, name, type, options);
  }

  /** @internal */
  _addTokens(tokens: number) { this._totalTokens += tokens; }
  /** @internal */
  _addCost(cost: number) { this._totalCost += cost; }

  async end(data?: { output?: unknown; status?: "completed" | "failed"; error?: string }) {
    await this._initPromise;
    const durationMs = Date.now() - this._startTime;
    await this.client._updateTrace(this._id!, {
      status: data?.status || (data?.error ? "failed" : "completed"),
      output: data?.output,
      error: data?.error,
      totalDurationMs: durationMs,
      totalTokens: this._totalTokens || undefined,
      totalCost: this._totalCost || undefined,
    });
  }
}

export class Span {
  private client: Pathlight;
  private trace: Trace;
  private _id: string | null = null;
  private _startTime = Date.now();
  private _initPromise: Promise<void>;

  private _source: ReturnType<typeof captureSource>;

  constructor(
    client: Pathlight,
    trace: Trace,
    name: string,
    type: "llm" | "tool" | "retrieval" | "agent" | "chain" | "custom",
    options?: {
      parentSpanId?: string;
      model?: string;
      provider?: string;
      toolName?: string;
      toolArgs?: unknown;
      input?: unknown;
      metadata?: unknown;
    },
  ) {
    this.client = client;
    this.trace = trace;
    // Capture source location at the call site (must happen in constructor, not async)
    this._source = captureSource();

    this._initPromise = this._init(name, type, options);
  }

  private async _init(name: string, type: string, options?: Record<string, unknown>) {
    const traceId = await this.trace.id;

    // Merge source location into metadata
    const existingMeta = options?.metadata ? (typeof options.metadata === "object" ? options.metadata : {}) : {};
    const metadata = this._source
      ? { ...existingMeta as Record<string, unknown>, _source: this._source }
      : existingMeta;

    const result = await this.client._createSpan({
      traceId,
      name,
      type,
      ...options,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    this._id = result.id;
  }

  get id(): Promise<string> {
    return this._initPromise.then(() => this._id!);
  }

  async event(name: string, body?: unknown, level?: "debug" | "info" | "warn" | "error") {
    await this._initPromise;
    await this.client._createEvent(this._id!, { name, body, level });
  }

  async end(data?: {
    output?: unknown;
    status?: "completed" | "failed";
    error?: string;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    toolResult?: unknown;
  }) {
    await this._initPromise;
    const durationMs = Date.now() - this._startTime;

    if (data?.inputTokens || data?.outputTokens) {
      this.trace._addTokens((data.inputTokens || 0) + (data.outputTokens || 0));
    }
    if (data?.cost) {
      this.trace._addCost(data.cost);
    }

    await this.client._updateSpan(this._id!, {
      status: data?.status || (data?.error ? "failed" : "completed"),
      output: data?.output,
      error: data?.error,
      durationMs,
      inputTokens: data?.inputTokens,
      outputTokens: data?.outputTokens,
      cost: data?.cost,
      toolResult: data?.toolResult,
    });
  }
}
