import { Pathlight } from "@pathlight/sdk";
import {
  FixError,
  type FixOptions,
  type FixResult,
  type FixProgress,
} from "./types.js";
import { fetchTrace } from "./collector-client.js";
import { createPathSourceReader, type SourceReader } from "./source/path.js";
import { createGitSourceReader } from "./source/git.js";
import { buildPrompt, PROPOSE_FIX_TOOL } from "./prompt.js";
import { parseFixResponse } from "./diff-parser.js";
import { createLlmAdapter, DEFAULT_MODELS } from "./llm/index.js";

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
export { createGitSourceReader } from "./source/git.js";
export type { GitSourceReader, CreateGitSourceReaderOptions } from "./source/git.js";
export { createLlmAdapter, DEFAULT_MODELS } from "./llm/index.js";
export type {
  LlmAdapter,
  LlmMessage,
  LlmToolSpec,
  LlmToolCall,
  CompletionRequest,
  CompletionResult,
} from "./llm/index.js";
export { buildPrompt, inferFilesFromSpans, PROPOSE_FIX_TOOL } from "./prompt.js";
export type { PromptBuildResult } from "./prompt.js";
export { parseFixResponse, isUnifiedDiff } from "./diff-parser.js";
export type { ParsedFix } from "./diff-parser.js";

async function createSourceReader(source: FixOptions["source"]): Promise<SourceReader> {
  if (source.kind === "path") {
    return createPathSourceReader(source);
  }
  if (source.kind === "git") {
    return createGitSourceReader(source);
  }
  throw new FixError(`Unknown source kind: ${String((source as { kind: string }).kind)}`);
}

function emit(options: FixOptions, event: FixProgress): void {
  try {
    options.onProgress?.(event);
  } catch {
    // Progress callbacks must not be able to break the engine.
  }
}

/** Meta-trace safe-input — never includes apiKey or token. */
function safeInput(options: FixOptions): Record<string, unknown> {
  return {
    traceId: options.traceId,
    mode: options.mode,
    source: options.source.kind === "path"
      ? { kind: "path", dir: options.source.dir }
      : { kind: "git", repoUrl: options.source.repoUrl, ref: options.source.ref },
    llm: {
      provider: options.llm.provider,
      model: options.llm.model ?? DEFAULT_MODELS[options.llm.provider],
    },
  };
}

export async function fix(options: FixOptions): Promise<FixResult> {
  if (options.mode.kind === "bisect") {
    throw new FixError("bisect mode is implemented in P2 (#46)");
  }

  const meta = new Pathlight({ baseUrl: options.collectorUrl });
  const metaTrace = meta.trace("fix.engine", safeInput(options));
  void metaTrace.id.catch(() => {});
  let metaTraceId: string | undefined;
  try {
    metaTraceId = await metaTrace.id;
  } catch {
    // Collector unavailable — keep going, meta-trace is best-effort.
  }

  let reader: SourceReader;
  try {
    reader = await createSourceReader(options.source);
  } catch (err) {
    const message = err instanceof FixError ? err.message : "Unexpected engine error";
    await metaTrace.end({
      status: "failed",
      error: message,
    }).catch(() => {});
    throw err;
  }

  try {
    emit(options, { kind: "fetching-trace" });
    const traceData = await fetchTrace(options.collectorUrl, options.traceId);

    const prompt = await buildPrompt(traceData, reader, options.mode);
    emit(options, { kind: "reading-source", fileCount: prompt.candidateFiles.length });

    const adapter = await createLlmAdapter(options.llm);
    const model = options.llm.model ?? DEFAULT_MODELS[options.llm.provider];
    emit(options, { kind: "calling-llm", provider: options.llm.provider, model });

    const completion = await adapter.complete({
      messages: prompt.messages,
      tools: [PROPOSE_FIX_TOOL],
      maxTokens: options.llm.maxTokens,
      temperature: options.llm.temperature,
      model: options.llm.model,
    });

    emit(options, { kind: "parsing-diff" });
    const parsed = parseFixResponse(completion);

    const result: FixResult = {
      diff: parsed.diff,
      explanation: parsed.explanation,
      filesChanged: parsed.filesChanged,
      metaTraceId,
    };

    await metaTrace.end({
      status: "completed",
      output: {
        filesChanged: parsed.filesChanged,
        diffLength: parsed.diff.length,
        explanationLength: parsed.explanation.length,
        model: completion.model,
        inputTokens: completion.usage.inputTokens,
        outputTokens: completion.usage.outputTokens,
      },
    }).catch(() => {});

    return result;
  } catch (err) {
    const message = err instanceof FixError ? err.message : "Unexpected engine error";
    await metaTrace.end({
      status: "failed",
      error: message,
    }).catch(() => {});
    throw err;
  } finally {
    await reader.cleanup().catch(() => {});
  }
}
