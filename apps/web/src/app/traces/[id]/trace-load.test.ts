import { describe, expect, it } from "vitest";
import { prepareTraceLoad, rollbackOptimisticReview } from "./trace-load";

describe("prepareTraceLoad", () => {
  it("optimistically marks an unreviewed trace and returns the patch body", () => {
    const prepared = prepareTraceLoad(
      {
        trace: { id: "trace_1", reviewedAt: null },
        spans: [{ id: "span_1" }],
        events: [{ id: "event_1" }],
      },
      "2026-05-01T12:00:00.000Z",
    );

    expect(prepared.trace.reviewedAt).toBe("2026-05-01T12:00:00.000Z");
    expect(prepared.reviewPatch).toEqual({ reviewedAt: "2026-05-01T12:00:00.000Z" });
    expect(prepared.spans).toEqual([{ id: "span_1" }]);
    expect(prepared.events).toEqual([{ id: "event_1" }]);
  });

  it("does not patch an already reviewed trace", () => {
    const prepared = prepareTraceLoad(
      { trace: { id: "trace_1", reviewedAt: "existing" }, spans: [], events: [] },
      "new",
    );

    expect(prepared.trace.reviewedAt).toBe("existing");
    expect(prepared.reviewPatch).toBeNull();
  });
});

describe("rollbackOptimisticReview", () => {
  it("clears reviewedAt after a failed patch", () => {
    expect(rollbackOptimisticReview({ id: "trace_1", reviewedAt: "optimistic" })).toEqual({
      id: "trace_1",
      reviewedAt: null,
    });
  });

  it("preserves null traces", () => {
    expect(rollbackOptimisticReview(null)).toBeNull();
  });
});
