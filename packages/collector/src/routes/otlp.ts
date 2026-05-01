import { Hono } from "hono";
import type { Db } from "@pathlight/db";
import { traces, spans } from "@pathlight/db";
import { eq } from "@pathlight/db";
import { emitTraceEvent } from "../events.js";
import { recomputeTraceIssues } from "../issues.js";

/**
 * OTLP/HTTP ingest. Accepts the OTLP protobuf-over-JSON shape that
 * @opentelemetry/exporter-trace-otlp-http emits when you send
 * `https://endpoint/v1/traces`. We mount it at `/v1/otlp/traces` so it can
 * coexist with Pathlight's native trace ingestion.
 *
 * Mapping follows the OpenTelemetry GenAI semantic conventions:
 *   gen_ai.system             -> span.provider
 *   gen_ai.request.model      -> span.model
 *   gen_ai.usage.input_tokens -> span.inputTokens
 *   gen_ai.usage.output_tokens-> span.outputTokens
 *   gen_ai.usage.cost         -> span.cost
 *
 * Span type heuristics: any gen_ai.* attribute => "llm". SpanKind CLIENT
 * without gen_ai => "tool". Everything else => "custom".
 */
export function createOtlpRoutes(db: Db) {
  const app = new Hono();

  app.post("/traces", async (c) => {
    const body = (await c.req.json()) as OtlpRequest;
    if (!body || !Array.isArray(body.resourceSpans)) {
      return c.json({ error: "missing resourceSpans" }, 400);
    }

    const groupedByTrace = new Map<string, OtlpSpan[]>();
    const resourceByTrace = new Map<string, Attr[]>();

    for (const rs of body.resourceSpans) {
      const resourceAttrs = rs.resource?.attributes ?? [];
      for (const ss of rs.scopeSpans ?? []) {
        for (const span of ss.spans ?? []) {
          const list = groupedByTrace.get(span.traceId) ?? [];
          list.push(span);
          groupedByTrace.set(span.traceId, list);
          if (!resourceByTrace.has(span.traceId)) {
            resourceByTrace.set(span.traceId, resourceAttrs);
          }
        }
      }
    }

    const traceIds: string[] = [];

    for (const [traceId, otSpans] of groupedByTrace) {
      const root = findRoot(otSpans);
      if (!root) continue;

      const resource = resourceByTrace.get(traceId) ?? [];
      const serviceName = String(readAttr(resource, "service.name") ?? "otel-ingest");

      const traceStart = Number(BigInt(root.startTimeUnixNano) / 1_000_000n);
      const traceEnd = Number(BigInt(root.endTimeUnixNano || root.startTimeUnixNano) / 1_000_000n);

      let totalInput = 0;
      let totalOutput = 0;
      let totalCost = 0;
      for (const s of otSpans) {
        totalInput += Number(readAttr(s.attributes ?? [], "gen_ai.usage.input_tokens") ?? 0);
        totalOutput += Number(readAttr(s.attributes ?? [], "gen_ai.usage.output_tokens") ?? 0);
        totalCost += Number(readAttr(s.attributes ?? [], "gen_ai.usage.cost") ?? 0);
      }

      const existing = await db.select().from(traces).where(eq(traces.id, traceId)).get();
      const traceRow = {
        id: traceId,
        name: root.name || serviceName,
        status: mapStatus(root.status?.code),
        input: null,
        output: null,
        error: root.status?.message || null,
        totalDurationMs: traceEnd - traceStart,
        totalTokens: totalInput + totalOutput || null,
        totalCost: totalCost || null,
        metadata: JSON.stringify({ source: "otlp", serviceName, resource }),
        tags: null,
        createdAt: new Date(traceStart),
        completedAt: new Date(traceEnd),
        reviewedAt: null,
        gitCommit: toStringOrNull(readAttr(resource, "pathlight.git.commit")),
        gitBranch: toStringOrNull(readAttr(resource, "pathlight.git.branch")),
        gitDirty: null,
      };

      if (existing) {
        await db.update(traces).set(traceRow).where(eq(traces.id, traceId)).run();
      } else {
        await db.insert(traces).values(traceRow).run();
      }

      for (const s of otSpans) {
        const attrs = s.attributes ?? [];
        const type = inferSpanType(s, attrs);
        const start = Number(BigInt(s.startTimeUnixNano) / 1_000_000n);
        const end = Number(BigInt(s.endTimeUnixNano || s.startTimeUnixNano) / 1_000_000n);

        const spanRow = {
          id: s.spanId,
          traceId,
          parentSpanId: s.parentSpanId || null,
          name: s.name,
          type,
          status: mapSpanStatus(s.status?.code),
          input: null,
          output: null,
          error: s.status?.message || null,
          model: toStringOrNull(readAttr(attrs, "gen_ai.request.model")),
          provider: toStringOrNull(readAttr(attrs, "gen_ai.system")),
          inputTokens: toIntOrNull(readAttr(attrs, "gen_ai.usage.input_tokens")),
          outputTokens: toIntOrNull(readAttr(attrs, "gen_ai.usage.output_tokens")),
          cost: toNumberOrNull(readAttr(attrs, "gen_ai.usage.cost")),
          toolName: toStringOrNull(readAttr(attrs, "gen_ai.tool.name")),
          toolArgs: null,
          toolResult: null,
          startedAt: new Date(start),
          completedAt: new Date(end),
          durationMs: end - start,
          metadata: JSON.stringify(attrsToObject(attrs)),
        };

        const existingSpan = await db.select().from(spans).where(eq(spans.id, s.spanId)).get();
        if (existingSpan) {
          await db.update(spans).set(spanRow).where(eq(spans.id, s.spanId)).run();
        } else {
          await db.insert(spans).values(spanRow).run();
        }
      }

      traceIds.push(traceId);

      const stored = await recomputeTraceIssues(db, traceId);
      if (stored) emitTraceEvent(existing ? "trace.updated" : "trace.created", stored);
    }

    return c.json({ partialSuccess: {}, accepted: traceIds.length });
  });

  return app;
}

// ---------- OTLP types (minimal, just what we consume) ----------

interface OtlpRequest {
  resourceSpans?: Array<{
    resource?: { attributes?: Attr[] };
    scopeSpans?: Array<{
      scope?: { name?: string };
      spans?: OtlpSpan[];
    }>;
  }>;
}

interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano?: string;
  status?: { code?: number; message?: string };
  attributes?: Attr[];
}

interface Attr {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: { values: Attr["value"][] };
  };
}

// ---------- helpers ----------

function findRoot(list: OtlpSpan[]): OtlpSpan | null {
  return list.find((s) => !s.parentSpanId) ?? list[0] ?? null;
}

function readAttr(attrs: Attr[], key: string): string | number | boolean | null {
  const a = attrs.find((x) => x.key === key);
  if (!a) return null;
  const v = a.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  return null;
}

function attrsToObject(attrs: Attr[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of attrs) {
    const v = a.value;
    if (v.stringValue !== undefined) out[a.key] = v.stringValue;
    else if (v.intValue !== undefined) out[a.key] = Number(v.intValue);
    else if (v.doubleValue !== undefined) out[a.key] = v.doubleValue;
    else if (v.boolValue !== undefined) out[a.key] = v.boolValue;
  }
  return out;
}

function inferSpanType(span: OtlpSpan, attrs: Attr[]): "llm" | "tool" | "retrieval" | "agent" | "chain" | "custom" {
  const hasGenAi = attrs.some((a) => a.key.startsWith("gen_ai."));
  if (hasGenAi) return "llm";
  // SpanKind CLIENT = 3. External calls are almost certainly tools.
  if (span.kind === 3) return "tool";
  return "custom";
}

// OTLP StatusCode: 0=unset, 1=ok, 2=error
function mapStatus(code: number | undefined): "running" | "completed" | "failed" | "cancelled" {
  if (code === 2) return "failed";
  return "completed";
}

function mapSpanStatus(code: number | undefined): "running" | "completed" | "failed" {
  if (code === 2) return "failed";
  return "completed";
}

function toIntOrNull(v: string | number | boolean | null): number | null {
  if (v === null || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toNumberOrNull(v: string | number | boolean | null): number | null {
  if (v === null || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(v: string | number | boolean | null): string | null {
  if (v === null) return null;
  return String(v);
}
