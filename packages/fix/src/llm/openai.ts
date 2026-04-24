import { FixError, type LlmConfig } from "../types.js";
import type { CompletionRequest, CompletionResult, LlmAdapter } from "./index.js";

export function createOpenAiAdapter(_config: LlmConfig): LlmAdapter {
  return {
    provider: "openai",
    async complete(_req: CompletionRequest): Promise<CompletionResult> {
      throw new FixError("OpenAI adapter is implemented in T6");
    },
  };
}
