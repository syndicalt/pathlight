import Anthropic from "@anthropic-ai/sdk";
import { FixError, type LlmConfig } from "../types.js";
import {
  DEFAULT_MODELS,
  type CompletionRequest,
  type CompletionResult,
  type LlmAdapter,
  type LlmToolCall,
} from "./index.js";

export function createAnthropicAdapter(config: LlmConfig): LlmAdapter {
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    provider: "anthropic",
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const model = req.model ?? config.model ?? DEFAULT_MODELS.anthropic;
      const systemMessages = req.messages.filter((m) => m.role === "system");
      const turnMessages = req.messages.filter((m) => m.role !== "system");

      let response: Anthropic.Messages.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: req.maxTokens ?? config.maxTokens ?? 4096,
          temperature: req.temperature ?? config.temperature,
          system: systemMessages.map((m) => m.content).join("\n\n") || undefined,
          messages: turnMessages.map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content,
          })),
          tools: req.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Messages.Tool["input_schema"],
          })),
        });
      } catch (err) {
        throw new FixError(`Anthropic request failed`, err);
      }

      let content = "";
      const toolCalls: LlmToolCall[] = [];
      for (const block of response.content) {
        if (block.type === "text") {
          content += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      return {
        content,
        toolCalls,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        model: response.model,
      };
    },
  };
}
