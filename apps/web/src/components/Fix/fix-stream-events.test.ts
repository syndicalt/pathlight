import { describe, expect, it } from "vitest";
import { fixStreamAction, progressLine, safeJson } from "./fix-stream-events";

describe("progressLine", () => {
  it("formats source and LLM progress events", () => {
    expect(progressLine({ kind: "reading-source", fileCount: 1 })).toBe("# reading source (1 file)");
    expect(progressLine({ kind: "calling-llm", provider: "openai", model: "gpt-test" })).toBe("# calling openai gpt-test");
  });

  it("formats bisect progress events", () => {
    expect(progressLine({ kind: "bisect-iteration", depth: 2, sha: "abcdef12345" })).toBe("# bisect depth 2 at abcdef1");
    expect(progressLine({ kind: "bisect-found", sha: "1234567890" })).toBe("# regression found at 1234567");
  });

  it("falls back for malformed progress events", () => {
    expect(progressLine(null)).toBe("progress");
    expect(progressLine({ kind: "custom-step" })).toBe("# custom-step");
  });
});

describe("fixStreamAction", () => {
  it("turns progress events into progress actions", () => {
    expect(fixStreamAction({ event: "progress", data: JSON.stringify({ kind: "fetching-trace" }) })).toEqual({
      kind: "progress",
      text: "# fetching trace",
    });
  });

  it("turns result events into result actions", () => {
    expect(fixStreamAction({
      event: "result",
      data: JSON.stringify({ diff: "diff", explanation: "done", filesChanged: ["a.ts"] }),
    })).toEqual({
      kind: "result",
      result: { diff: "diff", explanation: "done", filesChanged: ["a.ts"] },
    });
  });

  it("uses a generic message for malformed error events", () => {
    expect(fixStreamAction({ event: "error", data: "{bad json" })).toEqual({
      kind: "error",
      message: "Fix engine failed",
    });
  });

  it("marks done events closed and ignores unknown events", () => {
    expect(fixStreamAction({ event: "done", data: "{}" })).toEqual({ kind: "closed" });
    expect(fixStreamAction({ event: "ping", data: "{}" })).toEqual({ kind: "ignored" });
  });
});

describe("safeJson", () => {
  it("parses JSON and returns null for malformed payloads", () => {
    expect(safeJson("{\"ok\":true}")).toEqual({ ok: true });
    expect(safeJson("{bad json")).toBeNull();
  });
});
