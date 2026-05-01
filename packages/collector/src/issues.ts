import type { Db } from "@pathlight/db";
import { eq } from "@pathlight/db";
import { spans, traces } from "@pathlight/db";
import type { TracePayload } from "./events.js";

const ISSUE_PATTERNS = /\bfail\b|failed|failure|error|exception|timeout|timed out|invalid|denied|refused|rejected|incomplete|truncat/i;

export function parseIssueList(value: string | null | undefined): string[] {
  if (!value) return [];
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

export function formatTraceIssues(row: {
  status: string;
  error: string | null;
  hasIssues?: boolean | null;
  issues?: string | null;
}) {
  const issues = parseIssueList(row.issues);
  const hasIssues = !!row.hasIssues || row.status === "failed" || !!row.error || issues.length > 0;
  return { issues, hasIssues };
}

export async function recomputeTraceIssues(db: Db, traceId: string): Promise<TracePayload | null> {
  const trace = await db
    .select({
      id: traces.id,
      status: traces.status,
      error: traces.error,
    })
    .from(traces)
    .where(eq(traces.id, traceId))
    .get();
  if (!trace) return null;

  const traceSpans = await db
    .select({
      output: spans.output,
      error: spans.error,
      status: spans.status,
      metadata: spans.metadata,
    })
    .from(spans)
    .where(eq(spans.traceId, traceId))
    .all();

  const issues = new Set<string>();
  if (trace.status === "failed") issues.add("trace_failed");
  if (trace.error) issues.add("trace_error");

  for (const span of traceSpans) {
    if (span.status === "failed") issues.add("span_failed");
    if (span.error) issues.add("has_error");
    if (!isEventloomSpan(span.metadata) && textHasIssue(span.output)) {
      issues.add("issue_in_output");
    }
  }

  const issueList = [...issues];
  await db
    .update(traces)
    .set({ hasIssues: issueList.length > 0, issues: JSON.stringify(issueList) })
    .where(eq(traces.id, traceId))
    .run();

  const updated = await db.select().from(traces).where(eq(traces.id, traceId)).get();
  return updated ? { ...updated, ...formatTraceIssues(updated) } : null;
}

function textHasIssue(value: string | null | undefined): boolean {
  if (!value) return false;
  const parsed = parseJson(value);
  if (parsed === null) return ISSUE_PATTERNS.test(value);
  return jsonStringValues(parsed).some((text) => ISSUE_PATTERNS.test(text));
}

function isEventloomSpan(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  const parsed = parseJson(metadata);
  return !!parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).source === "eventloom";
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function jsonStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(jsonStringValues);
  return [];
}
