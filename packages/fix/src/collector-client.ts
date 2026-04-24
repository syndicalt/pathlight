import { FixError } from "./types.js";

/** Minimal trace shape the fix engine consumes. Mirrors @pathlight/db.traces. */
export interface TraceRecord {
  id: string;
  projectId: string | null;
  name: string;
  status: "running" | "completed" | "failed" | "cancelled";
  input: string | null;
  output: string | null;
  error: string | null;
  totalDurationMs: number | null;
  totalTokens: number | null;
  totalCost: number | null;
  gitCommit: string | null;
  gitBranch: string | null;
  gitDirty: boolean | null;
  metadata: string | null;
}

/** Minimal span shape. Mirrors @pathlight/db.spans. */
export interface SpanRecord {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  type: "llm" | "tool" | "retrieval" | "agent" | "chain" | "custom";
  status: "running" | "completed" | "failed";
  input: string | null;
  output: string | null;
  error: string | null;
  model: string | null;
  provider: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  toolName: string | null;
  toolArgs: string | null;
  toolResult: string | null;
  durationMs: number | null;
  metadata: string | null;
}

export interface TraceWithSpans {
  trace: TraceRecord;
  spans: SpanRecord[];
}

export async function fetchTrace(collectorUrl: string, traceId: string): Promise<TraceWithSpans> {
  const url = `${collectorUrl.replace(/\/$/, "")}/v1/traces/${encodeURIComponent(traceId)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new FixError(`Failed to reach collector at ${collectorUrl}`, err);
  }

  if (response.status === 404) {
    throw new FixError(`Trace ${traceId} not found`);
  }
  if (!response.ok) {
    throw new FixError(`Collector returned ${response.status} fetching trace ${traceId}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    throw new FixError(`Collector returned non-JSON response`, err);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("trace" in body) ||
    !("spans" in body)
  ) {
    throw new FixError(`Collector response missing trace or spans fields`);
  }

  const { trace, spans } = body as { trace: TraceRecord; spans: SpanRecord[] };
  return { trace, spans };
}
