import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginState } from "../state.js";

export function registerToolHooks(api: OpenClawPluginApi, state: PluginState): void {
  api.on("before_tool_call", async (event, ctx) => {
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
    state.setToolSpan(toolCallId, span);
  });

  api.on("after_tool_call", async (event, ctx) => {
    const toolCallId = event.toolCallId;
    if (!toolCallId) return;
    const span = state.takeToolSpan(toolCallId);
    if (!span) return;

    try {
      await span.end({
        output: event.result,
        toolResult: event.result,
        error: event.error,
        status: event.error ? "failed" : "completed",
      });
    } catch (err) {
      api.logger.warn("pathlight: tool span.end failed", { toolCallId, err: String(err) });
    }
  });
}
