import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginState } from "../state.js";
import { silence } from "../safe.js";

type SafeOn = ReturnType<typeof import("../safe.js").createSafeOn>;
type Logger = OpenClawPluginApi["logger"];

export function registerTraceEnvelopeHooks(
  safeOn: SafeOn,
  _logger: Logger,
  state: PluginState,
): void {
  safeOn("before_agent_start", async (event, ctx) => {
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
    silence(trace);
    state.setTrace(runId, trace);
  });

  safeOn("agent_end", async (event, ctx) => {
    const runId = ctx.runId;
    if (!runId) return;
    const trace = state.removeTrace(runId);
    if (!trace) return;

    await trace.end({
      output: event.messages,
      status: event.success ? "completed" : "failed",
      error: event.error,
    });
  });
}
