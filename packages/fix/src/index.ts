import { Pathlight } from "@pathlight/sdk";
import {
  FixError,
  type FixOptions,
  type FixResult,
  type FixProgress,
  type FixMode,
} from "./types.js";
import { fetchTrace, type TraceWithSpans } from "./collector-client.js";
import { createPathSourceReader, type SourceReader } from "./source/path.js";
import { createGitSourceReader, type GitSourceReader } from "./source/git.js";
import { buildPrompt, PROPOSE_FIX_TOOL } from "./prompt.js";
import { parseFixResponse } from "./diff-parser.js";
import { createLlmAdapter, DEFAULT_MODELS, type LlmAdapter } from "./llm/index.js";
import { spawn } from "node:child_process";
import { bisect, makeGitCheckoutProbe, type ProbeVerdict } from "./bisect.js";
import { inferFilesFromSpans } from "./prompt.js";

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
export { bisect, listCommitRange, parentOf, makeGitCheckoutProbe } from "./bisect.js";
export type { BisectOptions, BisectResult, BisectProbe, ProbeVerdict } from "./bisect.js";

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

/**
 * Run a single span/trace-mode fix against the given reader + trace data.
 * Shared between the plain fix() path and the bisect-then-fix path so the
 * FixResult shape stays identical across modes.
 */
async function runSpanFix(
  options: FixOptions,
  reader: SourceReader,
  traceData: TraceWithSpans,
  mode: FixMode,
  adapter: LlmAdapter,
): Promise<{
  diff: string;
  explanation: string;
  filesChanged: string[];
  inputTokens: number;
  outputTokens: number;
  model: string;
}> {
  const prompt = await buildPrompt(traceData, reader, mode);
  emit(options, { kind: "reading-source", fileCount: prompt.candidateFiles.length });

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

  return {
    diff: parsed.diff,
    explanation: parsed.explanation,
    filesChanged: parsed.filesChanged,
    inputTokens: completion.usage.inputTokens,
    outputTokens: completion.usage.outputTokens,
    model: completion.model,
  };
}

/**
 * Default bisect verdict when the caller didn't supply `bisectProbe`.
 *
 * Heuristic:
 * - Read the files the failing trace's spans referenced via `_source.file`.
 * - If those files don't exist yet at this commit → "good" (pre-regression).
 * - If the files exist and contain the error signal (literal text from the
 *   trace's error or any failing span's error) → "bad".
 * - Otherwise → "bad" (conservative: an existing file is more likely to be
 *   the regression-introducer than an absent one).
 *
 * This default is documented as a heuristic. Callers with real CI or
 * `pathlight-eval` infrastructure should supply their own `bisectProbe`.
 */
async function defaultBisectVerdict(
  reader: GitSourceReader,
  traceData: TraceWithSpans,
): Promise<ProbeVerdict> {
  const candidates = inferFilesFromSpans(traceData.spans, reader.rootDir);
  if (candidates.length === 0) return "skip";
  const contents = await reader.readFiles(candidates).catch(() => [] as Awaited<ReturnType<typeof reader.readFiles>>);
  if (contents.length === 0) return "good";
  const errorSignal =
    traceData.trace.error ??
    traceData.spans.find((s) => s.error)?.error ??
    "";
  if (errorSignal) {
    // If any candidate file mentions the error text, that's a strong "bad".
    for (const file of contents) {
      if (file.content.includes(errorSignal)) return "bad";
    }
  }
  return "bad";
}

/** Resolve the current HEAD SHA in a git working tree. */
function currentSha(reader: GitSourceReader): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", ["rev-parse", "HEAD"], {
      cwd: reader.repoDir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf-8")));
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(out.trim());
      else rejectPromise(new FixError(`git rev-parse HEAD failed (exit ${code})`));
    });
  });
}

export async function fix(options: FixOptions): Promise<FixResult> {
  if (options.mode.kind === "bisect" && options.source.kind !== "git") {
    throw new FixError("bisect mode requires a git source");
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

    const adapter = await createLlmAdapter(options.llm);

    // Bisect-then-fix pipeline.
    if (options.mode.kind === "bisect") {
      const gitReader = reader as GitSourceReader;
      // Ensure history is deep enough for the range we're about to walk.
      await gitReader.fetchFull().catch(() => {
        // Best-effort: shallow clone may already cover the range.
      });

      const probe = options.bisectProbe
        ? makeGitCheckoutProbe(gitReader, async () => options.bisectProbe!(await currentSha(gitReader)))
        : makeGitCheckoutProbe(gitReader, () => defaultBisectVerdict(gitReader, traceData));

      const bisectResult = await bisect(gitReader.repoDir, {
        from: options.mode.from,
        to: options.mode.to,
        probe,
        onIteration: ({ sha, depth }) => {
          emit(options, { kind: "bisect-iteration", sha, depth });
        },
      });

      emit(options, { kind: "bisect-found", sha: bisectResult.regressionSha });

      // Check out the regression commit before we run the final fix.
      await (reader as GitSourceReader).checkout(bisectResult.regressionSha);

      const fixAtSha = await runSpanFix(
        options,
        reader,
        traceData,
        { kind: "span" },
        adapter,
      );

      const result: FixResult = {
        diff: fixAtSha.diff,
        explanation: fixAtSha.explanation,
        filesChanged: fixAtSha.filesChanged,
        metaTraceId,
        regressionSha: bisectResult.regressionSha,
        parentSha: bisectResult.parentSha,
      };

      await metaTrace.end({
        status: "completed",
        output: {
          filesChanged: fixAtSha.filesChanged,
          diffLength: fixAtSha.diff.length,
          explanationLength: fixAtSha.explanation.length,
          model: fixAtSha.model,
          inputTokens: fixAtSha.inputTokens,
          outputTokens: fixAtSha.outputTokens,
          regressionSha: bisectResult.regressionSha,
          parentSha: bisectResult.parentSha,
          bisectIterations: bisectResult.iterations,
        },
      }).catch(() => {});

      return result;
    }

    // Non-bisect path: plain span/trace mode.
    const fixed = await runSpanFix(options, reader, traceData, options.mode, adapter);

    const result: FixResult = {
      diff: fixed.diff,
      explanation: fixed.explanation,
      filesChanged: fixed.filesChanged,
      metaTraceId,
    };

    await metaTrace.end({
      status: "completed",
      output: {
        filesChanged: fixed.filesChanged,
        diffLength: fixed.diff.length,
        explanationLength: fixed.explanation.length,
        model: fixed.model,
        inputTokens: fixed.inputTokens,
        outputTokens: fixed.outputTokens,
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
