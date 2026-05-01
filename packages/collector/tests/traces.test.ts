import { describe, it, expect } from "vitest";
import { buildCollector } from "./fixtures.js";

const jsonPost = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const jsonPatch = (body: unknown) => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /v1/traces", () => {
  it("creates a trace and returns an id", async () => {
    const { call } = await buildCollector();
    const res = await call<{ id: string }>("/v1/traces", jsonPost({ name: "agent" }));
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/.+/);
  });

  it("returns 400 when name is missing", async () => {
    const { call } = await buildCollector();
    const res = await call<{ error?: unknown }>("/v1/traces", jsonPost({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("persists git fields", async () => {
    const { call } = await buildCollector();
    const create = await call<{ id: string }>(
      "/v1/traces",
      jsonPost({
        name: "agent",
        gitCommit: "abc123",
        gitBranch: "feature/x",
        gitDirty: true,
      }),
    );
    const get = await call<{ trace: Record<string, unknown> }>(`/v1/traces/${create.body.id}`);
    expect(get.body.trace.gitCommit).toBe("abc123");
    expect(get.body.trace.gitBranch).toBe("feature/x");
    expect(get.body.trace.gitDirty).toBe(true);
  });
});

describe("GET /v1/traces", () => {
  it("returns empty list when no traces exist", async () => {
    const { call } = await buildCollector();
    const res = await call<{ traces: unknown[]; total: number }>("/v1/traces");
    expect(res.status).toBe(200);
    expect(res.body.traces).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("lists created traces and reports total", async () => {
    // Note: ordering within the same second is DB-defined since createdAt uses
    // timestamp mode (second resolution), so we only assert membership/total.
    const { call } = await buildCollector();
    const a = await call<{ id: string }>("/v1/traces", jsonPost({ name: "a" }));
    const b = await call<{ id: string }>("/v1/traces", jsonPost({ name: "b" }));

    const res = await call<{ traces: Array<{ id: string; name: string }>; total: number }>(
      "/v1/traces",
    );
    expect(res.body.total).toBe(2);
    const ids = res.body.traces.map((t) => t.id).sort();
    expect(ids).toEqual([a.body.id, b.body.id].sort());
  });

  it("filters by status", async () => {
    const { call } = await buildCollector();
    const t = await call<{ id: string }>("/v1/traces", jsonPost({ name: "a" }));
    await call(`/v1/traces/${t.body.id}`, jsonPatch({ status: "failed" }));

    const failed = await call<{ traces: unknown[] }>("/v1/traces?status=failed");
    expect(failed.body.traces).toHaveLength(1);

    const completed = await call<{ traces: unknown[] }>("/v1/traces?status=completed");
    expect(completed.body.traces).toHaveLength(0);
  });

  it("filters by name (partial match)", async () => {
    const { call } = await buildCollector();
    await call("/v1/traces", jsonPost({ name: "research-agent" }));
    await call("/v1/traces", jsonPost({ name: "estimate" }));

    const res = await call<{ traces: Array<{ name: string }> }>("/v1/traces?name=research");
    expect(res.body.traces).toHaveLength(1);
    expect(res.body.traces[0].name).toBe("research-agent");
  });

  it("honors limit + offset", async () => {
    const { call } = await buildCollector();
    for (let i = 0; i < 5; i++) {
      await call("/v1/traces", jsonPost({ name: `t${i}` }));
      await new Promise((r) => setTimeout(r, 1));
    }

    const page1 = await call<{ traces: unknown[]; total: number }>("/v1/traces?limit=2&offset=0");
    const page2 = await call<{ traces: unknown[]; total: number }>("/v1/traces?limit=2&offset=2");

    expect(page1.body.total).toBe(5);
    expect(page1.body.traces).toHaveLength(2);
    expect(page2.body.traces).toHaveLength(2);
  });
});

describe("PATCH /v1/traces/:id", () => {
  it("updates status and sets completedAt", async () => {
    const { call } = await buildCollector();
    const create = await call<{ id: string }>("/v1/traces", jsonPost({ name: "t" }));
    const res = await call<{ trace: Record<string, unknown> }>(
      `/v1/traces/${create.body.id}`,
      jsonPatch({ status: "completed", output: { result: "ok" } }),
    );
    expect(res.body.trace.status).toBe("completed");
    expect(res.body.trace.completedAt).toBeTruthy();
    expect(res.body.trace.output).toContain('"result"');
  });

  it("accepts reviewedAt (ISO string or null)", async () => {
    const { call } = await buildCollector();
    const create = await call<{ id: string }>("/v1/traces", jsonPost({ name: "t" }));

    const set = await call<{ trace: Record<string, unknown> }>(
      `/v1/traces/${create.body.id}`,
      jsonPatch({ reviewedAt: "2026-04-20T00:00:00Z" }),
    );
    expect(set.body.trace.reviewedAt).toBeTruthy();

    const cleared = await call<{ trace: Record<string, unknown> }>(
      `/v1/traces/${create.body.id}`,
      jsonPatch({ reviewedAt: null }),
    );
    expect(cleared.body.trace.reviewedAt).toBeNull();
  });
});

describe("DELETE /v1/traces/:id", () => {
  it("removes the trace", async () => {
    const { call } = await buildCollector();
    const create = await call<{ id: string }>("/v1/traces", jsonPost({ name: "t" }));
    await call(`/v1/traces/${create.body.id}`, { method: "DELETE" });
    const res = await call(`/v1/traces/${create.body.id}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/traces/:id", () => {
  it("returns 404 for unknown trace", async () => {
    const { call } = await buildCollector();
    const res = await call("/v1/traces/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("bundles trace + spans + events + scores", async () => {
    const { call } = await buildCollector();
    const t = await call<{ id: string }>("/v1/traces", jsonPost({ name: "t" }));

    // Create a span
    const s = await call<{ id: string }>(
      "/v1/spans",
      jsonPost({ traceId: t.body.id, name: "llm", type: "llm" }),
    );
    expect(s.status).toBe(201);

    // Create an event on that span
    await call(
      `/v1/spans/${s.body.id}/events`,
      jsonPost({ name: "decision", body: { choice: "go" }, level: "info" }),
    );

    const res = await call<{
      trace: { id: string };
      spans: Array<{ id: string }>;
      events: Array<{ name: string }>;
    }>(`/v1/traces/${t.body.id}`);

    expect(res.body.trace.id).toBe(t.body.id);
    expect(res.body.spans).toHaveLength(1);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].name).toBe("decision");
  });
});

describe("issue detection", () => {
  it("flags traces whose spans have 'failed' in their output", async () => {
    const { call } = await buildCollector();
    const t = await call<{ id: string }>("/v1/traces", jsonPost({ name: "t" }));
    const s = await call<{ id: string }>(
      "/v1/spans",
      jsonPost({ traceId: t.body.id, name: "step", type: "custom" }),
    );
    await call(
      `/v1/spans/${s.body.id}`,
      jsonPatch({ status: "completed", output: "connection timeout" }),
    );

    const res = await call<{
      traces: Array<{ hasIssues: boolean; issues: string[] }>;
    }>("/v1/traces");
    expect(res.body.traces[0].hasIssues).toBe(true);
    expect(res.body.traces[0].issues).toContain("issue_in_output");
  });

  it("does not flag structured output just because it has an error key", async () => {
    const { call } = await buildCollector();
    const t = await call<{ id: string }>("/v1/traces", jsonPost({ name: "eventloom" }));
    const s = await call<{ id: string }>(
      "/v1/spans",
      jsonPost({ traceId: t.body.id, name: "eventloom.deterministic-runner", type: "llm" }),
    );
    await call(
      `/v1/spans/${s.body.id}`,
      jsonPatch({
        status: "completed",
        output: {
          outputSummary: "Emitted intentions: task.propose.",
          totalTokens: 9,
          error: null,
        },
      }),
    );

    const res = await call<{
      traces: Array<{ name: string; hasIssues: boolean; issues: string[] }>;
    }>("/v1/traces");
    const trace = res.body.traces.find((item) => item.name === "eventloom");
    expect(trace?.hasIssues).toBe(false);
    expect(trace?.issues).toEqual([]);
  });

  it("does not keyword-flag Eventloom spans", async () => {
    const { call } = await buildCollector();
    const t = await call<{ id: string }>("/v1/traces", jsonPost({ name: "eventloom" }));
    const s = await call<{ id: string }>(
      "/v1/spans",
      jsonPost({
        traceId: t.body.id,
        name: "eventloom.deterministic-runner",
        type: "llm",
        metadata: { source: "eventloom", exportKind: "model_invocation" },
      }),
    );
    await call(
      `/v1/spans/${s.body.id}`,
      jsonPatch({
        status: "completed",
        output: {
          outputSummary: "Projection errors: none. Rejected events: none.",
          error: null,
        },
      }),
    );

    const res = await call<{
      traces: Array<{ name: string; hasIssues: boolean; issues: string[] }>;
    }>("/v1/traces");
    const trace = res.body.traces.find((item) => item.name === "eventloom");
    expect(trace?.hasIssues).toBe(false);
    expect(trace?.issues).toEqual([]);
  });
});

describe("GET /v1/traces/commits", () => {
  it("aggregates by commit", async () => {
    const { call } = await buildCollector();

    for (let i = 0; i < 3; i++) {
      const t = await call<{ id: string }>(
        "/v1/traces",
        jsonPost({ name: "agent", gitCommit: "aaa111", gitBranch: "main", gitDirty: false }),
      );
      await call(
        `/v1/traces/${t.body.id}`,
        jsonPatch({ status: "completed", totalDurationMs: 1000 + i * 100, totalTokens: 100 }),
      );
    }

    const t2 = await call<{ id: string }>(
      "/v1/traces",
      jsonPost({ name: "agent", gitCommit: "bbb222", gitBranch: "feature/x", gitDirty: true }),
    );
    await call(
      `/v1/traces/${t2.body.id}`,
      jsonPatch({ status: "failed", totalDurationMs: 3000, totalTokens: 200 }),
    );

    const res = await call<{
      commits: Array<{
        commit: string;
        branch: string;
        dirty: boolean;
        traceCount: number;
        avgDuration: number;
        failed: number;
      }>;
    }>("/v1/traces/commits");

    expect(res.body.commits).toHaveLength(2);
    const aaa = res.body.commits.find((c) => c.commit === "aaa111");
    expect(aaa?.traceCount).toBe(3);
    expect(aaa?.failed).toBe(0);
    const bbb = res.body.commits.find((c) => c.commit === "bbb222");
    expect(bbb?.traceCount).toBe(1);
    expect(bbb?.failed).toBe(1);
    expect(bbb?.dirty).toBe(true);
  });

  it("excludes traces with no git_commit", async () => {
    const { call } = await buildCollector();
    await call("/v1/traces", jsonPost({ name: "no-git" }));
    const res = await call<{ commits: unknown[] }>("/v1/traces/commits");
    expect(res.body.commits).toEqual([]);
  });
});
