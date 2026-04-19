import { EventEmitter } from "node:events";
import type { traces } from "@pathlight/db";

type TraceRow = typeof traces.$inferSelect;

export type TraceEventType = "trace.created" | "trace.updated";

export interface TraceEvent {
  type: TraceEventType;
  trace: TraceRow & { issues: string[]; hasIssues: boolean };
}

class TraceEventBus extends EventEmitter {}

export const traceEvents = new TraceEventBus();
traceEvents.setMaxListeners(100);

export function emitTraceEvent(type: TraceEventType, row: TraceRow) {
  const payload: TraceEvent = {
    type,
    trace: {
      ...row,
      issues: [],
      hasIssues: row.status === "failed" || !!row.error,
    },
  };
  traceEvents.emit("trace", payload);
}
