/**
 * @pathlight/eval — pytest-style assertions over Pathlight traces.
 *
 * Usage:
 *   import { expect, evaluate } from "@pathlight/eval";
 *
 *   await evaluate({
 *     baseUrl: "http://localhost:4100",
 *     name: "estimate",
 *     limit: 20,
 *   }, (trace) => {
 *     expect(trace).toSucceed();
 *     expect(trace).toCompleteWithin("5s");
 *     expect(trace).toCostLessThan(0.10);
 *     expect(trace).toCallTool("database").atMost(3);
 *   });
 */

export interface TraceRecord {
  id: string;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
  input: string | null;
  output: string | null;
  error: string | null;
  totalDurationMs: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  createdAt: string;
  gitCommit?: string | null;
  gitBranch?: string | null;
}

export interface SpanRecord {
  id: string;
  name: string;
  type: "llm" | "tool" | "retrieval" | "agent" | "chain" | "custom";
  status: "running" | "completed" | "failed";
  toolName: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  error: string | null;
}

export interface TraceBundle {
  trace: TraceRecord;
  spans: SpanRecord[];
}

export class AssertionError extends Error {
  constructor(
    message: string,
    public readonly traceId: string,
    public readonly rule: string,
  ) {
    super(message);
    this.name = "AssertionError";
  }
}

function parseDuration(input: number | string): number {
  if (typeof input === "number") return input;
  const m = input.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!m) throw new Error(`Invalid duration: ${input}`);
  const n = parseFloat(m[1]);
  const unit = m[2] || "ms";
  return unit === "s" ? n * 1000 : unit === "m" ? n * 60_000 : n;
}

class ToolAssertion {
  constructor(
    private readonly bundle: TraceBundle,
    private readonly toolName: string,
  ) {}

  private count(): number {
    return this.bundle.spans.filter((s) => s.type === "tool" && s.toolName === this.toolName).length;
  }

  atMost(max: number): void {
    const c = this.count();
    if (c > max) {
      throw new AssertionError(
        `Tool ${this.toolName} called ${c} times (expected ≤ ${max})`,
        this.bundle.trace.id,
        `toCallTool(${this.toolName}).atMost(${max})`,
      );
    }
  }

  atLeast(min: number): void {
    const c = this.count();
    if (c < min) {
      throw new AssertionError(
        `Tool ${this.toolName} called ${c} times (expected ≥ ${min})`,
        this.bundle.trace.id,
        `toCallTool(${this.toolName}).atLeast(${min})`,
      );
    }
  }

  exactly(n: number): void {
    const c = this.count();
    if (c !== n) {
      throw new AssertionError(
        `Tool ${this.toolName} called ${c} times (expected ${n})`,
        this.bundle.trace.id,
        `toCallTool(${this.toolName}).exactly(${n})`,
      );
    }
  }
}

export class TraceAssertion {
  constructor(private readonly bundle: TraceBundle) {}

  toSucceed(): void {
    const s = this.bundle.trace.status;
    if (s !== "completed") {
      throw new AssertionError(
        `Trace status is '${s}' (expected 'completed')`,
        this.bundle.trace.id,
        "toSucceed()",
      );
    }
  }

  toFail(): void {
    if (this.bundle.trace.status !== "failed") {
      throw new AssertionError(
        `Trace status is '${this.bundle.trace.status}' (expected 'failed')`,
        this.bundle.trace.id,
        "toFail()",
      );
    }
  }

  toCompleteWithin(duration: number | string): void {
    const max = parseDuration(duration);
    const actual = this.bundle.trace.totalDurationMs;
    if (actual === null || actual > max) {
      throw new AssertionError(
        `Trace took ${actual ?? "?"}ms (expected ≤ ${max}ms)`,
        this.bundle.trace.id,
        `toCompleteWithin(${duration})`,
      );
    }
  }

  toCostLessThan(usd: number): void {
    const cost = this.bundle.trace.totalCost ?? 0;
    if (cost >= usd) {
      throw new AssertionError(
        `Trace cost $${cost.toFixed(4)} (expected < $${usd.toFixed(4)})`,
        this.bundle.trace.id,
        `toCostLessThan(${usd})`,
      );
    }
  }

  toUseAtMostTokens(max: number): void {
    const t = this.bundle.trace.totalTokens ?? 0;
    if (t > max) {
      throw new AssertionError(
        `Trace used ${t} tokens (expected ≤ ${max})`,
        this.bundle.trace.id,
        `toUseAtMostTokens(${max})`,
      );
    }
  }

  toHaveNoFailedSpans(): void {
    const failed = this.bundle.spans.filter((s) => s.status === "failed");
    if (failed.length > 0) {
      throw new AssertionError(
        `${failed.length} span(s) failed: ${failed.map((s) => s.name).join(", ")}`,
        this.bundle.trace.id,
        "toHaveNoFailedSpans()",
      );
    }
  }

  toHaveNoToolLoops(threshold = 3): void {
    // A "loop" = the same tool called >= threshold consecutive times.
    const toolSpans = this.bundle.spans.filter((s) => s.type === "tool");
    let run = 1;
    for (let i = 1; i < toolSpans.length; i++) {
      if (toolSpans[i].toolName && toolSpans[i].toolName === toolSpans[i - 1].toolName) {
        run++;
        if (run >= threshold) {
          throw new AssertionError(
            `Tool '${toolSpans[i].toolName}' called ${run}x in a row (loop detected)`,
            this.bundle.trace.id,
            `toHaveNoToolLoops(${threshold})`,
          );
        }
      } else {
        run = 1;
      }
    }
  }

  toCallTool(name: string): ToolAssertion {
    return new ToolAssertion(this.bundle, name);
  }

  toMatchOutput(matcher: RegExp | string): void {
    const output = this.bundle.trace.output ?? "";
    const ok = typeof matcher === "string" ? output.includes(matcher) : matcher.test(output);
    if (!ok) {
      throw new AssertionError(
        `Trace output did not match ${matcher}`,
        this.bundle.trace.id,
        `toMatchOutput(${matcher})`,
      );
    }
  }
}

export function expect(bundle: TraceBundle): TraceAssertion {
  return new TraceAssertion(bundle);
}

export interface EvaluateOptions {
  baseUrl: string;
  name?: string;
  projectId?: string;
  limit?: number;
  status?: "completed" | "failed" | "running" | "cancelled";
  /** Restrict to traces from a specific commit (prefix match). */
  gitCommit?: string;
  /** Explicit trace IDs (overrides list fetching). */
  traceIds?: string[];
}

export interface EvalResult {
  total: number;
  passed: number;
  failed: number;
  failures: Array<{ traceId: string; rule: string; message: string }>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json() as Promise<T>;
}

export async function evaluate(
  options: EvaluateOptions,
  assertions: (bundle: TraceBundle) => void | Promise<void>,
): Promise<EvalResult> {
  const base = options.baseUrl.replace(/\/$/, "");

  let ids: string[];
  if (options.traceIds && options.traceIds.length > 0) {
    ids = options.traceIds;
  } else {
    const qs = new URLSearchParams();
    if (options.name) qs.set("name", options.name);
    if (options.projectId) qs.set("projectId", options.projectId);
    if (options.status) qs.set("status", options.status);
    qs.set("limit", String(options.limit ?? 20));
    const list = await fetchJson<{ traces: TraceRecord[] }>(`${base}/v1/traces?${qs.toString()}`);
    ids = list.traces
      .filter((t) => (options.gitCommit ? (t.gitCommit || "").startsWith(options.gitCommit) : true))
      .map((t) => t.id);
  }

  const failures: EvalResult["failures"] = [];
  let passed = 0;

  for (const id of ids) {
    const bundle = await fetchJson<TraceBundle>(`${base}/v1/traces/${id}`);
    try {
      await assertions(bundle);
      passed++;
    } catch (err) {
      if (err instanceof AssertionError) {
        failures.push({ traceId: err.traceId, rule: err.rule, message: err.message });
      } else {
        failures.push({ traceId: id, rule: "(thrown)", message: String(err) });
      }
    }
  }

  return {
    total: ids.length,
    passed,
    failed: failures.length,
    failures,
  };
}
