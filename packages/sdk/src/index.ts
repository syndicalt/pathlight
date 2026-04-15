/**
 * TraceLens TypeScript SDK
 *
 * Usage:
 *   import { TraceLens } from "@tracelens/sdk";
 *
 *   const tl = new TraceLens({
 *     baseUrl: "http://localhost:4100",
 *     projectId: "my-project",
 *   });
 *
 *   const trace = tl.trace("research-agent", { query: "..." });
 *   const span = trace.span("llm.chat", "llm", { model: "gpt-4o" });
 *   span.end({ output: result, inputTokens: 100, outputTokens: 200 });
 *   trace.end({ output: finalResult });
 */

// Capture the caller's source location from the stack trace
function captureSource(): { file: string; line: number; column: number; func: string } | null {
  const err = new Error();
  const stack = err.stack?.split("\n");
  if (!stack) return null;

  // Walk up the stack to find the first frame outside the SDK
  for (let i = 1; i < stack.length; i++) {
    const frame = stack[i].trim();
    // Skip frames from this SDK file
    if (frame.includes("/sdk/") || frame.includes("@tracelens/sdk")) continue;
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

interface TraceLensConfig {
  baseUrl: string;
  projectId?: string;
  apiKey?: string;
}

export class TraceLens {
  private baseUrl: string;
  private projectId?: string;
  private apiKey?: string;

  constructor(config: TraceLensConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.projectId = config.projectId;
    this.apiKey = config.apiKey;
  }

  private async post(path: string, body: unknown) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return res.json();
  }

  private async patch(path: string, body: unknown) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    return res.json();
  }

  trace(name: string, input?: unknown, options?: { tags?: string[]; metadata?: unknown }): Trace {
    return new Trace(this, name, input, options);
  }

  /** @internal */
  async _createTrace(data: { name: string; projectId?: string; input?: unknown; tags?: string[]; metadata?: unknown }) {
    return this.post("/v1/traces", { ...data, projectId: data.projectId || this.projectId });
  }

  /** @internal */
  async _updateTrace(id: string, data: Record<string, unknown>) {
    return this.patch(`/v1/traces/${id}`, data);
  }

  /** @internal */
  async _createSpan(data: Record<string, unknown>) {
    return this.post("/v1/spans", data);
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

export class Trace {
  private client: TraceLens;
  private _id: string | null = null;
  private _name: string;
  private _input?: unknown;
  private _options?: { tags?: string[]; metadata?: unknown };
  private _startTime = Date.now();
  private _totalTokens = 0;
  private _totalCost = 0;
  private _initPromise: Promise<void>;

  constructor(client: TraceLens, name: string, input?: unknown, options?: { tags?: string[]; metadata?: unknown }) {
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
  private client: TraceLens;
  private trace: Trace;
  private _id: string | null = null;
  private _startTime = Date.now();
  private _initPromise: Promise<void>;

  private _source: ReturnType<typeof captureSource>;

  constructor(
    client: TraceLens,
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
