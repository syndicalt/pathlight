import type { Pathlight, Trace, Span } from "@pathlight/sdk";

export class PluginState {
  private traces = new Map<string, Trace>();
  private llmSpans = new Map<string, Span>();
  private toolSpans = new Map<string, Span>();
  private subagentSpans = new Map<string, Span>();

  constructor(public readonly client: Pathlight) {}

  setTrace(runId: string, trace: Trace): void {
    this.traces.set(runId, trace);
  }

  getTrace(runId: string | undefined): Trace | undefined {
    if (!runId) return undefined;
    return this.traces.get(runId);
  }

  removeTrace(runId: string): Trace | undefined {
    const trace = this.traces.get(runId);
    if (trace) this.traces.delete(runId);
    return trace;
  }

  setLlmSpan(runId: string, span: Span): void {
    this.llmSpans.set(runId, span);
  }

  takeLlmSpan(runId: string): Span | undefined {
    const span = this.llmSpans.get(runId);
    if (span) this.llmSpans.delete(runId);
    return span;
  }

  setToolSpan(toolCallId: string, span: Span): void {
    this.toolSpans.set(toolCallId, span);
  }

  takeToolSpan(toolCallId: string): Span | undefined {
    const span = this.toolSpans.get(toolCallId);
    if (span) this.toolSpans.delete(toolCallId);
    return span;
  }

  setSubagentSpan(childSessionKey: string, span: Span): void {
    this.subagentSpans.set(childSessionKey, span);
  }

  takeSubagentSpan(childSessionKey: string): Span | undefined {
    const span = this.subagentSpans.get(childSessionKey);
    if (span) this.subagentSpans.delete(childSessionKey);
    return span;
  }
}
