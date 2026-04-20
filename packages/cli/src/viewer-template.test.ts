import { describe, it, expect } from "vitest";
import { renderShareHtml, type ShareBundle } from "./viewer-template.js";

function makeBundle(overrides: Partial<ShareBundle> = {}): ShareBundle {
  return {
    trace: {
      id: "trace_abc",
      name: "my-agent",
      status: "completed",
      input: JSON.stringify({ query: "hello" }),
      output: JSON.stringify({ answer: "hi" }),
      totalDurationMs: 1234,
      totalTokens: 42,
      totalCost: 0.001,
      createdAt: "2026-04-20T00:00:00Z",
    },
    spans: [
      { id: "s1", name: "llm.chat", type: "llm", status: "completed", startedAt: "2026-04-20T00:00:00Z", durationMs: 500 },
    ],
    events: [],
    exportedAt: "2026-04-20T00:01:00Z",
    ...overrides,
  };
}

describe("renderShareHtml", () => {
  it("produces a standalone HTML document", () => {
    const html = renderShareHtml(makeBundle());
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("</html>");
    expect(html).toContain("<style>");
    expect(html).toContain("<script");
  });

  it("embeds the trace name in the <title>", () => {
    const html = renderShareHtml(makeBundle({
      trace: { ...makeBundle().trace, name: "special-agent" },
    }));
    expect(html).toMatch(/<title>special-agent — Pathlight trace<\/title>/);
  });

  it("html-escapes the title", () => {
    const html = renderShareHtml(makeBundle({
      trace: { ...makeBundle().trace, name: "<script>alert(1)</script>" },
    }));
    expect(html).not.toContain("<title><script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes </script> inside the embedded JSON payload", () => {
    // An adversarial payload: a trace output that literally contains </script>.
    // A naive JSON.stringify + inline would allow this to break out of the
    // <script> element.
    const html = renderShareHtml(makeBundle({
      trace: {
        ...makeBundle().trace,
        output: "normal-text-</script><img src=x onerror=alert(1)>",
      },
    }));

    const dataScript = html.match(
      /<script id="pathlight-data" type="application\/json">([\s\S]*?)<\/script>/,
    );
    expect(dataScript).toBeTruthy();
    // The embedded JSON must not contain a raw </script> sequence.
    expect(dataScript![1]).not.toMatch(/<\/script/i);
    // The escaped form should be present instead.
    expect(dataScript![1]).toMatch(/<\\\/script/);
  });

  it("contains all span names as serialized JSON", () => {
    const bundle = makeBundle({
      spans: [
        { id: "s1", name: "retrieve.docs", type: "tool", status: "completed", startedAt: "2026-04-20T00:00:00Z", durationMs: 100 },
        { id: "s2", name: "llm.summarize", type: "llm", status: "completed", startedAt: "2026-04-20T00:00:01Z", durationMs: 300 },
      ],
    });
    const html = renderShareHtml(bundle);
    // Names are embedded in the JSON data blob, not directly in markup — assert
    // the JSON parses and contains them.
    const match = html.match(/<script id="pathlight-data" type="application\/json">([\s\S]*?)<\/script>/);
    const data = JSON.parse(match![1].replace(/<\\\/script/gi, "</script"));
    expect(data.spans.map((s: { name: string }) => s.name)).toEqual([
      "retrieve.docs",
      "llm.summarize",
    ]);
  });
});
