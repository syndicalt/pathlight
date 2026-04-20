import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runShare } from "./share.js";

const originalFetch = globalThis.fetch;
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "pathlight-share-test-"));
  globalThis.fetch = (async (url: string) => {
    if (!String(url).endsWith("/v1/traces/abc123")) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    return new Response(JSON.stringify({
      trace: {
        id: "abc123",
        name: "test",
        status: "completed",
        input: JSON.stringify({ secret: "SHHH" }),
        output: JSON.stringify({ answer: "SENSITIVE" }),
        error: "something bad happened",
        totalDurationMs: 500,
        totalTokens: 10,
        totalCost: 0.001,
        createdAt: "2026-04-20T00:00:00Z",
      },
      spans: [{
        id: "s1",
        name: "s",
        type: "llm",
        status: "completed",
        input: JSON.stringify({ prompt: "PRIVATE" }),
        output: JSON.stringify({ text: "PRIVATE_OUT" }),
        error: "span error",
        toolArgs: JSON.stringify({ arg: "X" }),
        toolResult: JSON.stringify({ res: "Y" }),
        startedAt: "2026-04-20T00:00:00Z",
        durationMs: 500,
      }],
      events: [],
    }));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tmp, { recursive: true, force: true });
});

describe("runShare", () => {
  it("writes an HTML file with the trace data embedded", async () => {
    const out = join(tmp, "out.html");
    const written = await runShare({ traceId: "abc123", baseUrl: "http://x", output: out });
    expect(written).toBe(out);

    const html = readFileSync(out, "utf-8");
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("abc123");
    expect(html).toContain("SHHH");       // not redacted by default
    expect(html).toContain("SENSITIVE");  // not redacted by default
  });

  it("redactInput replaces trace.input + span.input + span.toolArgs", async () => {
    const out = join(tmp, "redacted.html");
    await runShare({
      traceId: "abc123",
      baseUrl: "http://x",
      output: out,
      redactInput: true,
    });

    const html = readFileSync(out, "utf-8");
    expect(html).not.toContain("SHHH");       // from trace.input
    expect(html).not.toContain('"prompt"');    // from span.input JSON
    expect(html).not.toContain('"arg"');       // from span.toolArgs JSON
    expect(html).toContain("[redacted]");
    // Output values should still be present.
    expect(html).toContain("SENSITIVE");
    expect(html).toContain("PRIVATE_OUT");     // span.output preserved
  });

  it("redactOutput redacts trace.output + span.output + span.toolResult", async () => {
    const out = join(tmp, "redacted-out.html");
    await runShare({
      traceId: "abc123",
      baseUrl: "http://x",
      output: out,
      redactOutput: true,
    });

    const html = readFileSync(out, "utf-8");
    expect(html).not.toContain("SENSITIVE");
    expect(html).not.toContain("PRIVATE_OUT");
    expect(html).toContain("[redacted]");
    // Inputs should still be present.
    expect(html).toContain("SHHH");
  });

  it("redactErrors redacts error strings", async () => {
    const out = join(tmp, "no-errors.html");
    await runShare({
      traceId: "abc123",
      baseUrl: "http://x",
      output: out,
      redactErrors: true,
    });

    const html = readFileSync(out, "utf-8");
    expect(html).not.toContain("something bad happened");
    expect(html).not.toContain("span error");
  });

  it("throws when the collector returns non-200", async () => {
    await expect(
      runShare({ traceId: "does-not-exist", baseUrl: "http://x" }),
    ).rejects.toThrow(/404/);
  });
});
