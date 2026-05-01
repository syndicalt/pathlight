export interface ReplayMessage {
  role: string;
  content: string;
}

export interface ReplayRunInput {
  provider: string;
  model: string;
  system: string;
  messages: ReplayMessage[];
  apiKey: string;
  baseUrl: string;
}

export interface ReplayResult {
  output: string;
  durationMs: number;
  tokens?: string;
  error?: string;
}

export function replayRequestBody(input: ReplayRunInput) {
  return {
    provider: input.provider,
    model: input.model,
    system: input.system || undefined,
    messages: input.messages,
    apiKey: input.apiKey || undefined,
    baseUrl: input.baseUrl || undefined,
  };
}

export function replayResultFromResponse(ok: boolean, data: unknown): ReplayResult {
  if (!ok) {
    return {
      output: "",
      durationMs: 0,
      error: JSON.stringify(responseError(data), null, 2),
    };
  }

  const record = isRecord(data) ? data : {};
  const inputTokens = typeof record.inputTokens === "number" ? record.inputTokens : undefined;
  const outputTokens = typeof record.outputTokens === "number" ? record.outputTokens : 0;
  return {
    output: typeof record.output === "string" ? record.output : "",
    durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
    tokens: inputTokens !== undefined ? `${inputTokens}/${outputTokens} tok` : undefined,
  };
}

export function replayErrorResult(err: unknown): ReplayResult {
  return { output: "", durationMs: 0, error: err instanceof Error ? err.message : String(err) };
}

export function persistReplaySettings(input: Pick<ReplayRunInput, "provider" | "apiKey" | "baseUrl">, storage: {
  sessionStorage: Storage;
  localStorage: Storage;
}): void {
  if (input.apiKey) storage.sessionStorage.setItem(`pathlight:replay-key:${input.provider}`, input.apiKey);
  else storage.sessionStorage.removeItem(`pathlight:replay-key:${input.provider}`);
  if (input.baseUrl) storage.localStorage.setItem(`pathlight:replay-base:${input.provider}`, input.baseUrl);
  else storage.localStorage.removeItem(`pathlight:replay-base:${input.provider}`);
}

function responseError(data: unknown): unknown {
  if (isRecord(data) && "error" in data) return data.error;
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
