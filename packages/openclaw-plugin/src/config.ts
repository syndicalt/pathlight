import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export interface PathlightOpenClawOptions {
  baseUrl?: string;
  apiKey?: string;
  projectId?: string;
}

export interface ResolvedOptions {
  baseUrl: string;
  apiKey: string | undefined;
  projectId: string | undefined;
}

export function resolveOptions(api: OpenClawPluginApi): ResolvedOptions {
  const cfg = (api.pluginConfig ?? {}) as PathlightOpenClawOptions;
  return {
    baseUrl: cfg.baseUrl ?? process.env.PATHLIGHT_BASE_URL ?? "http://localhost:4100",
    apiKey: cfg.apiKey ?? process.env.PATHLIGHT_API_KEY,
    projectId: cfg.projectId ?? process.env.PATHLIGHT_PROJECT_ID,
  };
}
