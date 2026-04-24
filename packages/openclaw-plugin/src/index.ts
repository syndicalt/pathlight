import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { Pathlight } from "@pathlight/sdk";
import { PluginState } from "./state.js";
import { registerTraceEnvelopeHooks } from "./hooks/trace-envelope.js";
import { registerLlmHooks } from "./hooks/llm.js";

export interface PathlightOpenClawOptions {
  baseUrl?: string;
  apiKey?: string;
  projectId?: string;
}

function resolveOptions(api: OpenClawPluginApi): Required<Pick<PathlightOpenClawOptions, "baseUrl">> & PathlightOpenClawOptions {
  const cfg = (api.pluginConfig ?? {}) as PathlightOpenClawOptions;
  return {
    baseUrl: cfg.baseUrl ?? process.env.PATHLIGHT_BASE_URL ?? "http://localhost:4100",
    apiKey: cfg.apiKey ?? process.env.PATHLIGHT_API_KEY,
    projectId: cfg.projectId ?? process.env.PATHLIGHT_PROJECT_ID,
  };
}

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

    api.logger.info(`pathlight: tracing enabled (${opts.baseUrl})`);

    registerTraceEnvelopeHooks(api, state);
    registerLlmHooks(api, state);
  },
});

export { PluginState };
