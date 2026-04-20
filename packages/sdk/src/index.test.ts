import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Pathlight } from "./index.js";

// Thin mock of the collector's fetch surface. Every test resets it.
type Handler = (url: string, init?: RequestInit) => Promise<Response>;
let handler: Handler;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  handler = async () => new Response(JSON.stringify({ id: "trace_test" }), { status: 201 });
  globalThis.fetch = ((url: string, init?: RequestInit) => handler(url, init)) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Pathlight", () => {
  it("strips a trailing slash from baseUrl", async () => {
    const seen: string[] = [];
    handler = async (url) => {
      seen.push(url);
      return new Response(JSON.stringify({ id: "abc" }), { status: 201 });
    };

    const tl = new Pathlight({ baseUrl: "http://localhost:4100/", disableGitContext: true });
    const trace = tl.trace("t");
    await trace.id;

    expect(seen[0]).toBe("http://localhost:4100/v1/traces");
  });

  it("forwards projectId from config to every trace create", async () => {
    const bodies: unknown[] = [];
    handler = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "abc" }), { status: 201 });
    };

    const tl = new Pathlight({ baseUrl: "http://x", projectId: "proj_42", disableGitContext: true });
    await tl.trace("t").id;

    expect((bodies[0] as { projectId?: string }).projectId).toBe("proj_42");
  });

  it("sends Authorization header when apiKey is provided", async () => {
    let authHeader: string | null = null;
    handler = async (_url, init) => {
      authHeader = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ id: "abc" }), { status: 201 });
    };

    const tl = new Pathlight({ baseUrl: "http://x", apiKey: "secret", disableGitContext: true });
    await tl.trace("t").id;

    expect(authHeader).toBe("Bearer secret");
  });

  it("omits git fields when disableGitContext is true", async () => {
    const bodies: Record<string, unknown>[] = [];
    handler = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "abc" }), { status: 201 });
    };

    const tl = new Pathlight({ baseUrl: "http://x", disableGitContext: true });
    await tl.trace("t").id;

    expect(bodies[0]).not.toHaveProperty("gitCommit");
    expect(bodies[0]).not.toHaveProperty("gitBranch");
    expect(bodies[0]).not.toHaveProperty("gitDirty");
  });

  it("forwards an explicit git object from config", async () => {
    const bodies: Record<string, unknown>[] = [];
    handler = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "abc" }), { status: 201 });
    };

    const tl = new Pathlight({
      baseUrl: "http://x",
      git: { commit: "deadbeef", branch: "main", dirty: false },
    });
    await tl.trace("t").id;

    expect(bodies[0].gitCommit).toBe("deadbeef");
    expect(bodies[0].gitBranch).toBe("main");
    expect(bodies[0].gitDirty).toBe(false);
  });
});

describe("Trace", () => {
  it("accumulates tokens and cost from child spans", async () => {
    const patches: Record<string, unknown>[] = [];
    handler = async (url, init) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
      }
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    };

    const tl = new Pathlight({ baseUrl: "http://x", disableGitContext: true });
    const trace = tl.trace("t");
    await trace.id;

    const s1 = trace.span("s1", "llm");
    await s1.id;
    await s1.end({ inputTokens: 100, outputTokens: 50, cost: 0.002 });

    const s2 = trace.span("s2", "llm");
    await s2.id;
    await s2.end({ inputTokens: 20, outputTokens: 10, cost: 0.001 });

    await trace.end({ output: "done" });

    // Last PATCH is the trace end — should have summed totals.
    const last = patches.at(-1) as { totalTokens?: number; totalCost?: number };
    expect(last.totalTokens).toBe(180); // 100+50+20+10
    expect(last.totalCost).toBeCloseTo(0.003, 5);
  });

  it("marks status=failed when end() is called with an error", async () => {
    const patches: Record<string, unknown>[] = [];
    handler = async (_url, init) => {
      if (init?.method === "PATCH") patches.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    };

    const tl = new Pathlight({ baseUrl: "http://x", disableGitContext: true });
    const trace = tl.trace("t");
    await trace.id;
    await trace.end({ error: "boom" });

    expect(patches.at(-1)).toMatchObject({ status: "failed", error: "boom" });
  });
});

describe("Span", () => {
  // Source-location capture intentionally skips frames containing "/sdk/" so
  // the SDK's own internals don't get logged. That means we can't meaningfully
  // assert its success from a test file inside /packages/sdk/ — but we can at
  // least assert the SDK still sends the span when capture returns null.
  it("still creates spans when source capture yields nothing", async () => {
    const spanBodies: Record<string, unknown>[] = [];
    handler = async (url, init) => {
      if (url.endsWith("/v1/spans") && init?.method === "POST") {
        spanBodies.push(JSON.parse(String(init.body)));
      }
      return new Response(JSON.stringify({ id: "x" }), { status: 201 });
    };

    const tl = new Pathlight({ baseUrl: "http://x", disableGitContext: true });
    const trace = tl.trace("t");
    await trace.id;
    const span = trace.span("s", "llm");
    await span.id;

    expect(spanBodies).toHaveLength(1);
    expect((spanBodies[0] as { name?: string }).name).toBe("s");
    expect((spanBodies[0] as { type?: string }).type).toBe("llm");
  });

  it("sends inputTokens/outputTokens/cost on end()", async () => {
    const patches: Record<string, unknown>[] = [];
    handler = async (url, init) => {
      if (url.includes("/v1/spans/") && init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
      }
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    };

    const tl = new Pathlight({ baseUrl: "http://x", disableGitContext: true });
    const trace = tl.trace("t");
    await trace.id;
    const span = trace.span("s", "llm");
    await span.id;
    await span.end({ inputTokens: 7, outputTokens: 3, cost: 0.001 });

    expect(patches[0]).toMatchObject({ inputTokens: 7, outputTokens: 3, cost: 0.001 });
  });
});

describe("breakpoint()", () => {
  it("returns the dashboard-provided state when collector resolves successfully", async () => {
    handler = async (url, init) => {
      if (url.endsWith("/v1/breakpoints") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ id: "bp_1", resumed: true, state: { edited: true } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    };

    const tl = new Pathlight({ baseUrl: "http://x", disableGitContext: true });
    const result = await tl.breakpoint<{ edited?: boolean }>({
      label: "test",
      state: { edited: false },
    });

    expect(result).toEqual({ edited: true });
  });

  it("falls back to the original state on 408 timeout", async () => {
    handler = async () =>
      new Response(JSON.stringify({ error: "timeout" }), { status: 408 });

    const tl = new Pathlight({ baseUrl: "http://x", disableGitContext: true });
    const result = await tl.breakpoint<{ foo: string }>({
      label: "test",
      state: { foo: "original" },
    });

    expect(result).toEqual({ foo: "original" });
  });

  it("falls back to the original state on network error", async () => {
    handler = async () => new Response("", { status: 500 });

    const tl = new Pathlight({ baseUrl: "http://x", disableGitContext: true });
    const result = await tl.breakpoint<string>({
      label: "test",
      state: "hello",
    });

    expect(result).toBe("hello");
  });
});
