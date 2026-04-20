import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { expect as expectTrace, evaluate, AssertionError, type TraceBundle } from "./index.js";

function bundle(overrides: Partial<TraceBundle["trace"]> = {}, spans: TraceBundle["spans"] = []): TraceBundle {
  return {
    trace: {
      id: "t1",
      name: "test",
      status: "completed",
      input: null,
      output: null,
      error: null,
      totalDurationMs: 1000,
      totalTokens: 100,
      totalCost: 0.01,
      createdAt: new Date().toISOString(),
      ...overrides,
    },
    spans,
  };
}

function span(overrides: Partial<TraceBundle["spans"][number]> = {}): TraceBundle["spans"][number] {
  return {
    id: "s1",
    name: "llm.chat",
    type: "llm",
    status: "completed",
    toolName: null,
    durationMs: 500,
    inputTokens: 10,
    outputTokens: 5,
    cost: 0.001,
    error: null,
    ...overrides,
  };
}

describe("matchers", () => {
  it("toSucceed passes when status=completed, fails otherwise", () => {
    expect(() => expectTrace(bundle()).toSucceed()).not.toThrow();
    expect(() => expectTrace(bundle({ status: "failed" })).toSucceed()).toThrow(AssertionError);
  });

  it("toFail passes when status=failed", () => {
    expect(() => expectTrace(bundle({ status: "failed" })).toFail()).not.toThrow();
    expect(() => expectTrace(bundle()).toFail()).toThrow(AssertionError);
  });

  it("toCompleteWithin accepts ms number", () => {
    expect(() => expectTrace(bundle({ totalDurationMs: 500 })).toCompleteWithin(1000)).not.toThrow();
    expect(() => expectTrace(bundle({ totalDurationMs: 1500 })).toCompleteWithin(1000)).toThrow(AssertionError);
  });

  it("toCompleteWithin parses '5s' and '2m'", () => {
    expect(() => expectTrace(bundle({ totalDurationMs: 4000 })).toCompleteWithin("5s")).not.toThrow();
    expect(() => expectTrace(bundle({ totalDurationMs: 5001 })).toCompleteWithin("5s")).toThrow(AssertionError);
    expect(() => expectTrace(bundle({ totalDurationMs: 119_000 })).toCompleteWithin("2m")).not.toThrow();
  });

  it("toCompleteWithin throws on invalid duration string", () => {
    expect(() => expectTrace(bundle()).toCompleteWithin("not-a-duration")).toThrow(/Invalid duration/);
  });

  it("toCostLessThan respects strict less-than", () => {
    expect(() => expectTrace(bundle({ totalCost: 0.04 })).toCostLessThan(0.05)).not.toThrow();
    expect(() => expectTrace(bundle({ totalCost: 0.05 })).toCostLessThan(0.05)).toThrow(AssertionError);
  });

  it("toUseAtMostTokens", () => {
    expect(() => expectTrace(bundle({ totalTokens: 500 })).toUseAtMostTokens(500)).not.toThrow();
    expect(() => expectTrace(bundle({ totalTokens: 501 })).toUseAtMostTokens(500)).toThrow(AssertionError);
  });

  it("toHaveNoFailedSpans fails when any span.status=failed", () => {
    expect(() =>
      expectTrace(bundle({}, [span({ status: "completed" })])).toHaveNoFailedSpans(),
    ).not.toThrow();
    expect(() =>
      expectTrace(bundle({}, [span({ status: "failed" })])).toHaveNoFailedSpans(),
    ).toThrow(AssertionError);
  });

  describe("toHaveNoToolLoops", () => {
    it("passes when tool calls alternate", () => {
      const spans = [
        span({ type: "tool", toolName: "a" }),
        span({ type: "tool", toolName: "b" }),
        span({ type: "tool", toolName: "a" }),
      ];
      expect(() => expectTrace(bundle({}, spans)).toHaveNoToolLoops()).not.toThrow();
    });

    it("fails when the same tool is called >= threshold times in a row", () => {
      const spans = [
        span({ type: "tool", toolName: "search" }),
        span({ type: "tool", toolName: "search" }),
        span({ type: "tool", toolName: "search" }),
      ];
      expect(() => expectTrace(bundle({}, spans)).toHaveNoToolLoops()).toThrow(AssertionError);
    });

    it("ignores non-tool spans between same-tool calls", () => {
      const spans = [
        span({ type: "tool", toolName: "search" }),
        span({ type: "tool", toolName: "search" }),
      ];
      expect(() => expectTrace(bundle({}, spans)).toHaveNoToolLoops()).not.toThrow();
    });

    it("custom threshold", () => {
      const spans = [
        span({ type: "tool", toolName: "x" }),
        span({ type: "tool", toolName: "x" }),
      ];
      expect(() => expectTrace(bundle({}, spans)).toHaveNoToolLoops(2)).toThrow(AssertionError);
    });
  });

  describe("toCallTool", () => {
    const spans = [
      span({ type: "tool", toolName: "search" }),
      span({ type: "tool", toolName: "search" }),
      span({ type: "tool", toolName: "fetch" }),
      span({ type: "llm", toolName: null }),  // not a tool — should not count
    ];

    it("atMost", () => {
      expect(() => expectTrace(bundle({}, spans)).toCallTool("search").atMost(2)).not.toThrow();
      expect(() => expectTrace(bundle({}, spans)).toCallTool("search").atMost(1)).toThrow(AssertionError);
    });

    it("atLeast", () => {
      expect(() => expectTrace(bundle({}, spans)).toCallTool("search").atLeast(2)).not.toThrow();
      expect(() => expectTrace(bundle({}, spans)).toCallTool("search").atLeast(3)).toThrow(AssertionError);
    });

    it("exactly", () => {
      expect(() => expectTrace(bundle({}, spans)).toCallTool("search").exactly(2)).not.toThrow();
      expect(() => expectTrace(bundle({}, spans)).toCallTool("search").exactly(1)).toThrow(AssertionError);
    });
  });

  describe("toMatchOutput", () => {
    it("string contains", () => {
      expect(() => expectTrace(bundle({ output: "hello world" })).toMatchOutput("world")).not.toThrow();
      expect(() => expectTrace(bundle({ output: "hello world" })).toMatchOutput("xyz")).toThrow(AssertionError);
    });

    it("regex match", () => {
      expect(() => expectTrace(bundle({ output: "order #42" })).toMatchOutput(/order #\d+/)).not.toThrow();
      expect(() => expectTrace(bundle({ output: "no order here" })).toMatchOutput(/order #\d+/)).toThrow(AssertionError);
    });
  });

  it("AssertionError carries trace id and rule name", () => {
    try {
      expectTrace(bundle({ id: "trace_xyz", status: "failed" })).toSucceed();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AssertionError);
      expect((err as AssertionError).traceId).toBe("trace_xyz");
      expect((err as AssertionError).rule).toBe("toSucceed()");
    }
  });
});

describe("evaluate()", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("aggregates pass/fail counts across traces", async () => {
    const traces = [
      { id: "t1", status: "completed", totalCost: 0.01 },
      { id: "t2", status: "failed", totalCost: 0.02 },
      { id: "t3", status: "completed", totalCost: 100 }, // too expensive
    ];

    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/traces?")) {
        return new Response(JSON.stringify({ traces }));
      }
      const id = u.split("/").pop()!;
      const t = traces.find((x) => x.id === id)!;
      return new Response(JSON.stringify({
        trace: { ...t, name: "x", input: null, output: null, error: null,
                  totalDurationMs: 100, totalTokens: 10, createdAt: "" },
        spans: [],
      }));
    }) as typeof fetch;

    const result = await evaluate(
      { baseUrl: "http://x", limit: 10 },
      (t) => {
        expectTrace(t).toSucceed();
        expectTrace(t).toCostLessThan(0.05);
      },
    );

    expect(result.total).toBe(3);
    expect(result.passed).toBe(1);   // t1
    expect(result.failed).toBe(2);   // t2 (failed status), t3 (too expensive)
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0].traceId).toBe("t2");
  });

  it("respects traceIds override (skips list fetch)", async () => {
    let listFetched = false;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/traces?")) {
        listFetched = true;
        return new Response(JSON.stringify({ traces: [] }));
      }
      return new Response(JSON.stringify({
        trace: {
          id: "t1", name: "x", status: "completed", input: null, output: null, error: null,
          totalDurationMs: 100, totalTokens: 10, totalCost: 0.01, createdAt: "",
        },
        spans: [],
      }));
    }) as typeof fetch;

    const result = await evaluate(
      { baseUrl: "http://x", traceIds: ["t1"] },
      (t) => expectTrace(t).toSucceed(),
    );

    expect(listFetched).toBe(false);
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
  });

  it("filters by gitCommit prefix", async () => {
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes("/v1/traces?")) {
        return new Response(JSON.stringify({
          traces: [
            { id: "t1", gitCommit: "abc12345" },
            { id: "t2", gitCommit: "def67890" },
            { id: "t3", gitCommit: null },
          ],
        }));
      }
      const id = u.split("/").pop()!;
      return new Response(JSON.stringify({
        trace: { id, name: "x", status: "completed", input: null, output: null, error: null,
                  totalDurationMs: 100, totalTokens: 10, totalCost: 0.01, createdAt: "" },
        spans: [],
      }));
    }) as typeof fetch;

    const result = await evaluate(
      { baseUrl: "http://x", gitCommit: "abc" },
      () => {},
    );

    expect(result.total).toBe(1);
  });
});
