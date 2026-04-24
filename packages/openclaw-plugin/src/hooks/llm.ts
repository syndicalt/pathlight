import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginState } from "../state.js";

export function registerLlmHooks(api: OpenClawPluginApi, state: PluginState): void {
  api.on("llm_input", async (event, ctx) => {
    const runId = event.runId ?? ctx.runId;
    if (!runId) return;
    const trace = state.getTrace(runId);
    if (!trace) return;

    const span = trace.span(`llm.${event.model}`, "llm", {
      model: event.model,
      provider: event.provider,
      input: {
        prompt: event.prompt,
        systemPrompt: event.systemPrompt,
        historyMessages: event.historyMessages,
        imagesCount: event.imagesCount,
      },
    });
    state.setLlmSpan(runId, span);
  });

  api.on("llm_output", async (event, ctx) => {
    const runId = event.runId ?? ctx.runId;
    if (!runId) return;
    const span = state.takeLlmSpan(runId);
    if (!span) return;

    try {
      await span.end({
        output: event.assistantTexts,
        inputTokens: event.usage?.input,
        outputTokens: event.usage?.output,
      });
    } catch (err) {
      api.logger.warn("pathlight: llm span.end failed", { runId, err: String(err) });
    }
  });
}
