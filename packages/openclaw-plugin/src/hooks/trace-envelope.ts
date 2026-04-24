import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginState } from "../state.js";

export function registerTraceEnvelopeHooks(api: OpenClawPluginApi, state: PluginState): void {
  api.on("before_agent_start", async (event, ctx) => {
    const runId = ctx.runId;
    if (!runId) return;

    const trace = state.client.trace(
      ctx.agentId ?? "openclaw-agent",
      event,
      {
        metadata: {
          openclawRunId: runId,
          sessionKey: ctx.sessionKey,
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          modelProviderId: ctx.modelProviderId,
          modelId: ctx.modelId,
          trigger: ctx.trigger,
          channelId: ctx.channelId,
        },
      },
    );
    state.setTrace(runId, trace);
  });

  api.on("agent_end", async (event, ctx) => {
    const runId = ctx.runId;
    if (!runId) return;
    const trace = state.removeTrace(runId);
    if (!trace) return;

    try {
      await trace.end({
        output: event.messages,
        status: event.success ? "completed" : "failed",
        error: event.error,
      });
    } catch (err) {
      api.logger.warn("pathlight: trace.end failed", { runId, err: String(err) });
    }
  });
}
