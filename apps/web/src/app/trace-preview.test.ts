import { describe, expect, it } from "vitest";
import { parseTraceTags, traceInputPreview } from "./trace-preview";

describe("parseTraceTags", () => {
  it("returns string tags from a serialized array", () => {
    expect(parseTraceTags(JSON.stringify(["comfyui", "agent"]))).toEqual(["comfyui", "agent"]);
  });

  it("ignores malformed or non-array tag payloads", () => {
    expect(parseTraceTags("{bad json")).toEqual([]);
    expect(parseTraceTags(JSON.stringify({ tag: "agent" }))).toEqual([]);
    expect(parseTraceTags(null)).toEqual([]);
  });

  it("filters non-string and empty tags", () => {
    expect(parseTraceTags(JSON.stringify(["ok", "", 1, null, "done"]))).toEqual(["ok", "done"]);
  });
});

describe("traceInputPreview", () => {
  it("previews structured object values", () => {
    expect(traceInputPreview(JSON.stringify({ prompt: "hello", config: { steps: 4 } }))).toBe("hello {\"steps\":4}");
  });

  it("previews serialized strings directly", () => {
    expect(traceInputPreview(JSON.stringify("hello world"))).toBe("hello world");
  });

  it("falls back to raw malformed input without throwing", () => {
    expect(traceInputPreview("{bad json")).toBe("{bad json");
  });

  it("truncates long previews", () => {
    expect(traceInputPreview(JSON.stringify({ prompt: "abcdef" }), 3)).toBe("abc");
  });
});
