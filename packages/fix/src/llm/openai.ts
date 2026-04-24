import OpenAI from "openai";
import { FixError, type LlmConfig } from "../types.js";
import {
  DEFAULT_MODELS,
  type CompletionRequest,
  type CompletionResult,
  type LlmAdapter,
  type LlmToolCall,
} from "./index.js";

export function createOpenAiAdapter(config: LlmConfig): LlmAdapter {
  const client = new OpenAI({ apiKey: config.apiKey });

  return {
    provider: "openai",
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const model = req.model ?? config.model ?? DEFAULT_MODELS.openai;

      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await client.chat.completions.create({
          model,
          max_tokens: req.maxTokens ?? config.maxTokens ?? 4096,
          temperature: req.temperature ?? config.temperature,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          tools: req.tools?.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            },
          })),
        });
      } catch (err) {
        throw new FixError(`OpenAI request failed`, err);
      }

      const choice = response.choices[0];
      if (!choice) {
        throw new FixError(`OpenAI returned no choices`);
      }

      const content = choice.message.content ?? "";
      const toolCalls: LlmToolCall[] = (choice.message.tool_calls ?? []).flatMap((tc) => {
        if (tc.type !== "function") return [];
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = { _raw: tc.function.arguments };
        }
        return [{ id: tc.id, name: tc.function.name, input: parsedArgs }];
      });

      return {
        content,
        toolCalls,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        model: response.model,
      };
    },
  };
}
