import { FixError, type LlmConfig, type LlmProvider } from "../types.js";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: LlmMessage[];
  tools?: LlmToolSpec[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface CompletionResult {
  content: string;
  toolCalls: LlmToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface LlmAdapter {
  readonly provider: LlmProvider;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  anthropic: "claude-opus-4-7",
  openai: "gpt-5.4",
};

export async function createLlmAdapter(config: LlmConfig): Promise<LlmAdapter> {
  if (config.provider === "anthropic") {
    const { createAnthropicAdapter } = await import("./anthropic.js");
    return createAnthropicAdapter(config);
  }
  if (config.provider === "openai") {
    const { createOpenAiAdapter } = await import("./openai.js");
    return createOpenAiAdapter(config);
  }
  throw new FixError(`Unknown LLM provider: ${String((config as { provider: string }).provider)}`);
}
