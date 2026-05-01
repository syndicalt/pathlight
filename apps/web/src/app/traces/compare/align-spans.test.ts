import { describe, expect, it } from "vitest";
import { alignSpans } from "./align-spans";

const spans = (...names: string[]) => names.map((name, index) => ({ id: `${name}-${index}`, name }));

describe("alignSpans", () => {
  it("pairs identical span names in order", () => {
    const pairs = alignSpans(spans("plan", "tool", "done"), spans("plan", "tool", "done"));
    expect(pairs.map((pair) => [pair.a?.name ?? null, pair.b?.name ?? null])).toEqual([
      ["plan", "plan"],
      ["tool", "tool"],
      ["done", "done"],
    ]);
  });

  it("keeps inserted right-side spans as additions", () => {
    const pairs = alignSpans(spans("plan", "done"), spans("plan", "tool", "done"));
    expect(pairs.map((pair) => [pair.a?.name ?? null, pair.b?.name ?? null])).toEqual([
      ["plan", "plan"],
      [null, "tool"],
      ["done", "done"],
    ]);
  });

  it("keeps removed left-side spans as removals", () => {
    const pairs = alignSpans(spans("plan", "tool", "done"), spans("plan", "done"));
    expect(pairs.map((pair) => [pair.a?.name ?? null, pair.b?.name ?? null])).toEqual([
      ["plan", "plan"],
      ["tool", null],
      ["done", "done"],
    ]);
  });

  it("handles repeated names by sequential rank", () => {
    const pairs = alignSpans(spans("llm", "tool", "llm", "done"), spans("llm", "llm", "done"));
    expect(pairs.map((pair) => [pair.a?.id ?? null, pair.b?.id ?? null])).toEqual([
      ["llm-0", "llm-0"],
      ["tool-1", null],
      ["llm-2", "llm-1"],
      ["done-3", "done-2"],
    ]);
  });
});
