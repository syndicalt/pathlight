import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginState } from "../state.js";
import { silence } from "../safe.js";

type SafeOn = ReturnType<typeof import("../safe.js").createSafeOn>;
type Logger = OpenClawPluginApi["logger"];

export function registerToolHooks(safeOn: SafeOn, _logger: Logger, state: PluginState): void {
  safeOn("before_tool_call", async (event, ctx) => {
    const runId = event.runId ?? ctx.runId;
    const toolCallId = event.toolCallId;
    if (!runId || !toolCallId) return;
    const trace = state.getTrace(runId);
    if (!trace) return;

    const span = trace.span(event.toolName, "tool", {
      toolName: event.toolName,
      toolArgs: event.params,
      input: event.params,
    });
    silence(span);
    state.setToolSpan(toolCallId, span);
  });

  safeOn("after_tool_call", async (event, _ctx) => {
    const toolCallId = event.toolCallId;
    if (!toolCallId) return;
    const span = state.takeToolSpan(toolCallId);
    if (!span) return;

    await span.end({
      output: event.result,
      toolResult: event.result,
      error: event.error,
      status: event.error ? "failed" : "completed",
    });
  });
}
