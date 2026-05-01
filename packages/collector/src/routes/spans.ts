import { Hono } from "hono";
import type { Db } from "@pathlight/db";
import { spans, events } from "@pathlight/db";
import { eq } from "@pathlight/db";
import { nanoid } from "nanoid";
import { recomputeTraceIssues } from "../issues.js";
import { emitTraceEvent } from "../events.js";

export function createSpanRoutes(db: Db) {
  const app = new Hono();

  // Create a span (called by SDK during agent execution)
  app.post("/", async (c) => {
    const body = await c.req.json<{
      id?: string;
      traceId: string;
      parentSpanId?: string;
      name: string;
      type: "llm" | "tool" | "retrieval" | "agent" | "chain" | "custom";
      input?: unknown;
      model?: string;
      provider?: string;
      toolName?: string;
      toolArgs?: unknown;
      metadata?: unknown;
    }>();

    if (!body.traceId || !body.name || !body.type) {
      return c.json({ error: { message: "traceId, name, and type are required", type: "validation_error" } }, 400);
    }

    const id = body.id || nanoid();

    await db.insert(spans).values({
      id,
      traceId: body.traceId,
      parentSpanId: body.parentSpanId || null,
      name: body.name,
      type: body.type,
      input: body.input ? JSON.stringify(body.input) : null,
      model: body.model || null,
      provider: body.provider || null,
      toolName: body.toolName || null,
      toolArgs: body.toolArgs ? JSON.stringify(body.toolArgs) : null,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    }).run();

    return c.json({ id }, 201);
  });

  // Update a span (mark complete, add output, etc.)
  app.patch("/:id", async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{
      status?: string;
      output?: unknown;
      error?: string;
      model?: string;
      provider?: string;
      inputTokens?: number;
      outputTokens?: number;
      cost?: number;
      toolResult?: unknown;
      durationMs?: number;
      metadata?: unknown;
    }>();

    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.output !== undefined) updates.output = JSON.stringify(body.output);
    if (body.error !== undefined) updates.error = body.error;
    if (body.model !== undefined) updates.model = body.model;
    if (body.provider !== undefined) updates.provider = body.provider;
    if (body.inputTokens !== undefined) updates.inputTokens = body.inputTokens;
    if (body.outputTokens !== undefined) updates.outputTokens = body.outputTokens;
    if (body.cost !== undefined) updates.cost = body.cost;
    if (body.toolResult !== undefined) updates.toolResult = JSON.stringify(body.toolResult);
    if (body.durationMs !== undefined) updates.durationMs = body.durationMs;
    if (body.metadata !== undefined) updates.metadata = JSON.stringify(body.metadata);

    if (body.status === "completed" || body.status === "failed") {
      updates.completedAt = new Date();
    }

    if (Object.keys(updates).length > 0) {
      await db.update(spans).set(updates).where(eq(spans.id, id)).run();
    }

    const updated = await db.select().from(spans).where(eq(spans.id, id)).get();
    if (updated) {
      const trace = await recomputeTraceIssues(db, updated.traceId);
      if (trace) emitTraceEvent("trace.updated", trace);
    }
    return c.json({ span: updated });
  });

  // Log an event within a span
  app.post("/:id/events", async (c) => {
    const { id: spanId } = c.req.param();
    const body = await c.req.json<{
      name: string;
      level?: "debug" | "info" | "warn" | "error";
      body?: unknown;
      metadata?: unknown;
    }>();

    // Get the span to find its traceId
    const span = await db.select().from(spans).where(eq(spans.id, spanId)).get();
    if (!span) {
      return c.json({ error: { message: "Span not found", type: "not_found" } }, 404);
    }

    const eventId = nanoid();
    await db.insert(events).values({
      id: eventId,
      traceId: span.traceId,
      spanId,
      name: body.name,
      level: body.level || "info",
      body: body.body ? JSON.stringify(body.body) : null,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    }).run();

    return c.json({ id: eventId }, 201);
  });

  return app;
}
