import { EventEmitter } from "node:events";
import type { traces } from "@pathlight/db";

type TraceRow = typeof traces.$inferSelect;
export type TracePayload = Omit<TraceRow, "issues" | "hasIssues"> & {
  issues: string[];
  hasIssues: boolean;
};

export type TraceEventType = "trace.created" | "trace.updated";

export interface TraceEvent {
  type: TraceEventType;
  trace: TracePayload;
}

class TraceEventBus extends EventEmitter {}

export const traceEvents = new TraceEventBus();
traceEvents.setMaxListeners(100);

export function emitTraceEvent(type: TraceEventType, row: TracePayload) {
  const payload: TraceEvent = {
    type,
    trace: row,
  };
  traceEvents.emit("trace", payload);
}
