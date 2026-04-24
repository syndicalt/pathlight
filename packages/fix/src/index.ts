import { FixError, type FixOptions, type FixResult } from "./types.js";

export type {
  FixOptions,
  FixResult,
  FixMode,
  FixProgress,
  Source,
  PathSource,
  GitSource,
  LlmConfig,
  LlmProvider,
} from "./types.js";
export { FixError } from "./types.js";
export { fetchTrace } from "./collector-client.js";
export type { TraceRecord, SpanRecord, TraceWithSpans } from "./collector-client.js";
export { createPathSourceReader } from "./source/path.js";
export type { FileContent, SourceReader } from "./source/path.js";
export { createLlmAdapter, DEFAULT_MODELS } from "./llm/index.js";
export type {
  LlmAdapter,
  LlmMessage,
  LlmToolSpec,
  LlmToolCall,
  CompletionRequest,
  CompletionResult,
} from "./llm/index.js";

export async function fix(_options: FixOptions): Promise<FixResult> {
  throw new FixError("fix() is not yet implemented — wired up in T8");
}
