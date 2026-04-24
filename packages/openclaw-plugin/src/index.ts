import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Pathlight } from "@pathlight/sdk";
import { PluginState } from "./state.js";
import { resolveOptions } from "./config.js";
import { createSafeOn } from "./safe.js";
import { registerTraceEnvelopeHooks } from "./hooks/trace-envelope.js";
import { registerLlmHooks } from "./hooks/llm.js";
import { registerToolHooks } from "./hooks/tool.js";
import { registerDelegationHooks } from "./hooks/delegation.js";

export type { PathlightOpenClawOptions } from "./config.js";
export { PluginState };

export default definePluginEntry({
  id: "pathlight",
  name: "Pathlight",
  description: "Trace OpenClaw agent runs, LLM calls, tool execution, and sub-agent delegation in the Pathlight dashboard.",
  register(api) {
    const opts = resolveOptions(api);
    const client = new Pathlight({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      projectId: opts.projectId,
    });
    const state = new PluginState(client);
    const safeOn = createSafeOn(api);

    api.logger.info(`pathlight: tracing enabled (${opts.baseUrl})`);

    registerTraceEnvelopeHooks(safeOn, api.logger, state);
    registerLlmHooks(safeOn, api.logger, state);
    registerToolHooks(safeOn, api.logger, state);
    registerDelegationHooks(safeOn, api.logger, state);
  },
});
