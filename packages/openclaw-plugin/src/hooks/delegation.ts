import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { PluginState } from "../state.js";
import { silence } from "../safe.js";

type SafeOn = ReturnType<typeof import("../safe.js").createSafeOn>;
type Logger = OpenClawPluginApi["logger"];

export function registerDelegationHooks(safeOn: SafeOn, _logger: Logger, state: PluginState): void {
  safeOn("subagent_spawning", async (event, ctx) => {
    const parentRunId = ctx.runId;
    const childSessionKey = event.childSessionKey;
    if (!parentRunId || !childSessionKey) return;
    const parentTrace = state.getTrace(parentRunId);
    if (!parentTrace) return;

    const span = parentTrace.span(event.agentId, "agent", {
      input: {
        childSessionKey: event.childSessionKey,
        agentId: event.agentId,
        label: event.label,
        mode: event.mode,
      },
      metadata: {
        openclawChildSessionKey: childSessionKey,
        parentRunId,
      },
    });
    silence(span);
    state.setSubagentSpan(childSessionKey, span);
  });

  safeOn("subagent_ended", async (event, _ctx) => {
    const childSessionKey = event.targetSessionKey;
    if (!childSessionKey) return;
    const span = state.takeSubagentSpan(childSessionKey);
    if (!span) return;

    const failed = event.outcome === "error" || event.outcome === "timeout" || event.outcome === "killed";
    await span.end({
      output: { reason: event.reason, outcome: event.outcome },
      error: event.error,
      status: failed ? "failed" : "completed",
    });
  });
}
