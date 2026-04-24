import { Pathlight } from "@pathlight/sdk";

export interface PathlightOpenClawOptions {
  baseUrl?: string;
  apiKey?: string;
  projectId?: string;
}

export function createPathlightPlugin(options: PathlightOpenClawOptions = {}) {
  const client = new Pathlight({
    baseUrl: options.baseUrl ?? "http://localhost:4100",
    apiKey: options.apiKey,
    projectId: options.projectId,
  });

  return {
    name: "@pathlight/openclaw",
    client,
  };
}

export default createPathlightPlugin;
