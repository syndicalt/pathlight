import { Hono } from "hono";
import type { Db } from "@tracelens/db";
import { traces, spans, events, scores } from "@tracelens/db";
import { eq, desc, sql, and, gte, lte, like } from "@tracelens/db";
import { nanoid } from "nanoid";

export function createTraceRoutes(db: Db) {
  const app = new Hono();

  // List traces with filters
  app.get("/", async (c) => {
    const limit = Math.min(parseInt(c.req.query("limit") || "50"), 200);
    const offset = parseInt(c.req.query("offset") || "0");
    const status = c.req.query("status");
    const name = c.req.query("name");
    const projectId = c.req.query("projectId");

    const conditions = [];
    if (status) conditions.push(eq(traces.status, status as "running" | "completed" | "failed" | "cancelled"));
    if (name) conditions.push(like(traces.name, `%${name}%`));
    if (projectId) conditions.push(eq(traces.projectId, projectId));

    const rows = await db
      .select()
      .from(traces)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(traces.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(traces)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .get();

    // Enrich with span-level issue detection
    const traceIds = rows.map((r) => r.id);
    const issueMap = new Map<string, string[]>();

    if (traceIds.length > 0) {
      const allSpans = await db
        .select({ traceId: spans.traceId, output: spans.output, error: spans.error, status: spans.status })
        .from(spans)
        .where(sql`${spans.traceId} IN (${sql.join(traceIds.map((id) => sql`${id}`), sql`, `)})`)
        .all();

      const ISSUE_PATTERNS = /\bfail\b|failed|failure|error|exception|timeout|timed out|invalid|denied|refused|rejected|incomplete|truncat/i;

      for (const span of allSpans) {
        const issues: string[] = [];
        if (span.status === "failed") issues.push("span_failed");
        if (span.error) issues.push("has_error");
        if (span.output && ISSUE_PATTERNS.test(span.output)) issues.push("issue_in_output");

        if (issues.length > 0) {
          const existing = issueMap.get(span.traceId) || [];
          existing.push(...issues);
          issueMap.set(span.traceId, existing);
        }
      }
    }

    const enriched = rows.map((r) => ({
      ...r,
      issues: [...new Set(issueMap.get(r.id) || [])],
      hasIssues: issueMap.has(r.id) || r.status === "failed" || !!r.error,
    }));

    return c.json({ traces: enriched, total: total?.count || 0, limit, offset });
  });

  // Get single trace with all spans and events
  app.get("/:id", async (c) => {
    const { id } = c.req.param();

    const trace = await db.select().from(traces).where(eq(traces.id, id)).get();
    if (!trace) {
      return c.json({ error: { message: "Trace not found", type: "not_found" } }, 404);
    }

    const traceSpans = await db
      .select()
      .from(spans)
      .where(eq(spans.traceId, id))
      .orderBy(spans.startedAt)
      .all();

    const traceEvents = await db
      .select()
      .from(events)
      .where(eq(events.traceId, id))
      .orderBy(events.timestamp)
      .all();

    const traceScores = await db
      .select()
      .from(scores)
      .where(eq(scores.traceId, id))
      .all();

    return c.json({ trace, spans: traceSpans, events: traceEvents, scores: traceScores });
  });

  // Create a new trace (called by SDK)
  app.post("/", async (c) => {
    const body = await c.req.json<{
      id?: string;
      name: string;
      projectId?: string;
      input?: unknown;
      metadata?: unknown;
      tags?: string[];
    }>();

    if (!body.name) {
      return c.json({ error: { message: "name is required", type: "validation_error" } }, 400);
    }

    const id = body.id || nanoid();

    await db.insert(traces).values({
      id,
      name: body.name,
      projectId: body.projectId || null,
      input: body.input ? JSON.stringify(body.input) : null,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      tags: body.tags ? JSON.stringify(body.tags) : null,
    }).run();

    return c.json({ id }, 201);
  });

  // Update a trace (mark complete, add output, etc.)
  app.patch("/:id", async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<{
      status?: string;
      output?: unknown;
      error?: string;
      totalDurationMs?: number;
      totalTokens?: number;
      totalCost?: number;
      metadata?: unknown;
    }>();

    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) updates.status = body.status;
    if (body.output !== undefined) updates.output = JSON.stringify(body.output);
    if (body.error !== undefined) updates.error = body.error;
    if (body.totalDurationMs !== undefined) updates.totalDurationMs = body.totalDurationMs;
    if (body.totalTokens !== undefined) updates.totalTokens = body.totalTokens;
    if (body.totalCost !== undefined) updates.totalCost = body.totalCost;
    if (body.metadata !== undefined) updates.metadata = JSON.stringify(body.metadata);

    if (body.status === "completed" || body.status === "failed") {
      updates.completedAt = new Date();
    }

    if (Object.keys(updates).length > 0) {
      await db.update(traces).set(updates).where(eq(traces.id, id)).run();
    }

    const updated = await db.select().from(traces).where(eq(traces.id, id)).get();
    return c.json({ trace: updated });
  });

  // Delete a trace and all related data
  app.delete("/:id", async (c) => {
    const { id } = c.req.param();
    await db.delete(scores).where(eq(scores.traceId, id)).run();
    await db.delete(events).where(eq(events.traceId, id)).run();
    await db.delete(spans).where(eq(spans.traceId, id)).run();
    await db.delete(traces).where(eq(traces.id, id)).run();
    return c.json({ deleted: true });
  });

  return app;
}
