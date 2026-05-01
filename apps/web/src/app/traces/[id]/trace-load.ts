export interface TraceLoadBundle<TTrace, TSpan, TEvent> {
  trace: TTrace;
  spans: TSpan[];
  events: TEvent[];
}

export interface PreparedTraceLoad<TTrace, TSpan, TEvent> extends TraceLoadBundle<TTrace, TSpan, TEvent> {
  reviewPatch: { reviewedAt: string } | null;
}

export function prepareTraceLoad<TTrace extends { reviewedAt: string | null }, TSpan, TEvent>(
  data: TraceLoadBundle<TTrace, TSpan, TEvent>,
  reviewedAt: string,
): PreparedTraceLoad<TTrace, TSpan, TEvent> {
  if (data.trace.reviewedAt) {
    return { ...data, reviewPatch: null };
  }

  return {
    trace: { ...data.trace, reviewedAt },
    spans: data.spans,
    events: data.events,
    reviewPatch: { reviewedAt },
  };
}

export function rollbackOptimisticReview<TTrace extends { reviewedAt: string | null }>(
  trace: TTrace | null,
): TTrace | null {
  return trace ? { ...trace, reviewedAt: null } : trace;
}
