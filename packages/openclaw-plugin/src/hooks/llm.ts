import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginState } from "../state.js";
import { silence } from "../safe.js";

type SafeOn = ReturnType<typeof import("../safe.js").createSafeOn>;
type Logger = OpenClawPluginApi["logger"];

export function registerLlmHooks(safeOn: SafeOn, _logger: Logger, state: PluginState): void {
  safeOn("llm_input", async (event, ctx) => {
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
    silence(span);
    state.setLlmSpan(runId, span);
  });

  safeOn("llm_output", async (event, ctx) => {
    const runId = event.runId ?? ctx.runId;
    if (!runId) return;
    const span = state.takeLlmSpan(runId);
    if (!span) return;

    await span.end({
      output: event.assistantTexts,
      inputTokens: event.usage?.input,
      outputTokens: event.usage?.output,
    });
  });
}
