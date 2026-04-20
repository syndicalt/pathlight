import { describe, it, expect } from "vitest";
import { buildCollector } from "./fixtures.js";

const jsonPost = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const nowNs = (offsetMs = 0) => String((Date.now() + offsetMs) * 1_000_000);

describe("POST /v1/otlp/traces", () => {
  it("400 when resourceSpans is missing", async () => {
    const { call } = await buildCollector();
    const res = await call("/v1/otlp/traces", jsonPost({}));
    expect(res.status).toBe(400);
  });

  it("ingests a single-span trace and surfaces it via native API", async () => {
    const { call } = await buildCollector();
    const traceId = "0123456789abcdef0123456789abcdef";
    const spanId = "0123456789abcdef";

    const start = nowNs();
    const end = nowNs(500);

    const res = await call<{ accepted: number }>("/v1/otlp/traces", jsonPost({
      resourceSpans: [{
        resource: { attributes: [{ key: "service.name", value: { stringValue: "my-agent" } }] },
        scopeSpans: [{
          spans: [{
            traceId,
            spanId,
            name: "openai.chat",
            kind: 3,
            startTimeUnixNano: start,
            endTimeUnixNano: end,
            status: { code: 1 },
            attributes: [
              { key: "gen_ai.system", value: { stringValue: "openai" } },
              { key: "gen_ai.request.model", value: { stringValue: "gpt-4o" } },
              { key: "gen_ai.usage.input_tokens", value: { intValue: "100" } },
              { key: "gen_ai.usage.output_tokens", value: { intValue: "50" } },
            ],
          }],
        }],
      }],
    }));
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);

    // Read it back through the normal API.
    const detail = await call<{
      trace: { id: string; name: string; totalTokens: number; status: string };
      spans: Array<{ id: string; name: string; type: string; provider: string; model: string; inputTokens: number; outputTokens: number }>;
    }>(`/v1/traces/${traceId}`);

    expect(detail.status).toBe(200);
    expect(detail.body.trace.id).toBe(traceId);
    expect(detail.body.trace.name).toBe("openai.chat");
    expect(detail.body.trace.totalTokens).toBe(150);
    expect(detail.body.trace.status).toBe("completed");

    expect(detail.body.spans).toHaveLength(1);
    expect(detail.body.spans[0].type).toBe("llm");  // gen_ai.* present → llm
    expect(detail.body.spans[0].provider).toBe("openai");
    expect(detail.body.spans[0].model).toBe("gpt-4o");
    expect(detail.body.spans[0].inputTokens).toBe(100);
    expect(detail.body.spans[0].outputTokens).toBe(50);
  });

  it("groups multiple spans into one trace with parent links preserved", async () => {
    const { call } = await buildCollector();
    const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const parentId = "parent0000000000";
    const childId = "child00000000000";

    await call("/v1/otlp/traces", jsonPost({
      resourceSpans: [{
        scopeSpans: [{
          spans: [
            {
              traceId, spanId: parentId,
              name: "agent.run",
              kind: 2,  // SERVER
              startTimeUnixNano: nowNs(),
              endTimeUnixNano: nowNs(1000),
            },
            {
              traceId, spanId: childId, parentSpanId: parentId,
              name: "tool.search",
              kind: 3,  // CLIENT
              startTimeUnixNano: nowNs(100),
              endTimeUnixNano: nowNs(300),
            },
          ],
        }],
      }],
    }));

    const detail = await call<{
      spans: Array<{ id: string; parentSpanId: string | null; type: string; name: string }>;
    }>(`/v1/traces/${traceId}`);

    expect(detail.body.spans).toHaveLength(2);
    const parent = detail.body.spans.find((s) => s.id === parentId)!;
    const child = detail.body.spans.find((s) => s.id === childId)!;
    expect(parent.parentSpanId).toBeNull();
    expect(child.parentSpanId).toBe(parentId);
    expect(child.type).toBe("tool");  // CLIENT kind + no gen_ai → tool
    expect(parent.type).toBe("custom");
  });

  it("maps OTel status code 2 to failed", async () => {
    const { call } = await buildCollector();
    const traceId = "f".repeat(32);

    await call("/v1/otlp/traces", jsonPost({
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId, spanId: "f".repeat(16),
            name: "doomed",
            startTimeUnixNano: nowNs(),
            endTimeUnixNano: nowNs(10),
            status: { code: 2, message: "upstream exploded" },
          }],
        }],
      }],
    }));

    const detail = await call<{ trace: { status: string; error: string } }>(`/v1/traces/${traceId}`);
    expect(detail.body.trace.status).toBe("failed");
    expect(detail.body.trace.error).toBe("upstream exploded");
  });

  it("is idempotent — resending the same trace updates in place", async () => {
    const { call } = await buildCollector();
    const traceId = "b".repeat(32);

    const payload = {
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId, spanId: "b".repeat(16),
            name: "first",
            startTimeUnixNano: nowNs(),
            endTimeUnixNano: nowNs(100),
          }],
        }],
      }],
    };
    await call("/v1/otlp/traces", jsonPost(payload));
    // Send again, changing the name
    const p2 = JSON.parse(JSON.stringify(payload));
    p2.resourceSpans[0].scopeSpans[0].spans[0].name = "second";
    await call("/v1/otlp/traces", jsonPost(p2));

    // Only one trace should exist
    const list = await call<{ total: number }>("/v1/traces");
    expect(list.body.total).toBe(1);

    // And the detail reflects the latest name
    const detail = await call<{ trace: { name: string } }>(`/v1/traces/${traceId}`);
    expect(detail.body.trace.name).toBe("second");
  });

  it("picks up pathlight.git.commit / pathlight.git.branch from resource attrs", async () => {
    const { call } = await buildCollector();
    const traceId = "c".repeat(32);

    await call("/v1/otlp/traces", jsonPost({
      resourceSpans: [{
        resource: {
          attributes: [
            { key: "pathlight.git.commit", value: { stringValue: "abc1234def" } },
            { key: "pathlight.git.branch", value: { stringValue: "master" } },
          ],
        },
        scopeSpans: [{
          spans: [{
            traceId, spanId: "c".repeat(16),
            name: "s",
            startTimeUnixNano: nowNs(),
            endTimeUnixNano: nowNs(10),
          }],
        }],
      }],
    }));

    const detail = await call<{ trace: { gitCommit: string; gitBranch: string } }>(`/v1/traces/${traceId}`);
    expect(detail.body.trace.gitCommit).toBe("abc1234def");
    expect(detail.body.trace.gitBranch).toBe("master");
  });
});
