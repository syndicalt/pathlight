import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { fix, type FixOptions, type FixProgress, type Source } from "@pathlight/fix";
import { validateFixRequest, type FixRequest } from "./fix-schema.js";

/**
 * `POST /v1/fix` — wraps `@pathlight/fix` in an SSE-streamed web endpoint so
 * the dashboard (#49) and CLI alternatives can drive fix-engine runs remotely.
 *
 * Authorization is deferred per parent-invariant #4 in issue #44: any request
 * carrying a well-formed `projectId` is allowed through. A future auth pass
 * will layer on top without changing this route's shape.
 *
 * SSE event schema:
 *   - `progress` — engine phase transitions (`FixProgress` values verbatim)
 *   - `chunk`    — reserved for streaming LLM output (engine emits whole
 *                  completions today; kept in the wire schema so enabling
 *                  streaming in the engine doesn't require a route change)
 *   - `result`   — final `FixResult` payload (diff, explanation, filesChanged)
 *   - `error`    — sanitized engine failure (no keys, no tokens, no stack)
 *   - `done`     — stream closure sentinel; always fires last
 *
 * T3 wires the engine: progress events are forwarded via `onProgress`, the
 * engine's `fix()` resolves to the `result` event, and every invocation ends
 * with a `done` event. Secret resolution is still a stub — T4 wires the real
 * `keyId`/`tokenId` → plaintext lookup.
 */

export function createFixRoutes(options?: FixRouteOptions) {
  const app = new Hono();
  const runFix = options?.runFix ?? fix;
  const resolveSecrets = options?.resolveSecrets ?? defaultStubResolveSecrets;

  app.post("/", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const validated = validateFixRequest(raw);
    if (!validated.ok) {
      return c.json({ error: validated.error, field: validated.field }, 400);
    }
    const request = validated.value;
    const collectorUrl = computeCollectorUrl(c.req.url);

    return streamSSE(c, async (stream) => {
      const sendEvent = async (event: string, data: unknown) => {
        if (stream.aborted) return;
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      };

      const onProgress = (event: FixProgress) => {
        // Fire-and-forget — progress emission must never block the engine.
        void sendEvent("progress", event);
      };

      let secrets: ResolvedSecrets;
      try {
        secrets = await resolveSecrets(request);
      } catch {
        await sendEvent("error", { message: "secret resolution failed" });
        await sendEvent("done", { ok: false });
        return;
      }

      const fixOptions: FixOptions = {
        traceId: request.traceId,
        collectorUrl,
        source: buildEngineSource(request, secrets),
        llm: {
          provider: request.llm.provider,
          apiKey: secrets.llmApiKey,
          ...(request.llm.model !== undefined ? { model: request.llm.model } : {}),
          ...(request.llm.maxTokens !== undefined ? { maxTokens: request.llm.maxTokens } : {}),
          ...(request.llm.temperature !== undefined ? { temperature: request.llm.temperature } : {}),
        },
        mode:
          request.mode === "bisect"
            ? { kind: "bisect", from: request.from!, to: request.to! }
            : { kind: request.mode },
        onProgress,
      };

      try {
        const result = await runFix(fixOptions);
        await sendEvent("result", {
          diff: result.diff,
          explanation: result.explanation,
          filesChanged: result.filesChanged,
          metaTraceId: result.metaTraceId,
          regressionSha: result.regressionSha,
          parentSha: result.parentSha,
        });
        await sendEvent("done", { ok: true });
      } catch {
        // T5 will expand error handling and logging. T3 keeps it minimal but
        // already satisfies invariant #1: never echo caught error content.
        await sendEvent("error", { message: "fix-engine failed" });
        await sendEvent("done", { ok: false });
      }
    });
  });

  return app;
}

/**
 * Injection seam for tests (and for T4's secret resolver). The runtime default
 * calls the real `@pathlight/fix` engine.
 */
export interface FixRouteOptions {
  runFix?: (options: FixOptions) => Promise<Awaited<ReturnType<typeof fix>>>;
  resolveSecrets?: (request: FixRequest) => Promise<ResolvedSecrets>;
}

export interface ResolvedSecrets {
  llmApiKey: string;
  /** Present only when source.kind === "git"; undefined for path sources. */
  gitToken?: string;
}

// T3 placeholder. T4 replaces this with the P4-backed resolver.
async function defaultStubResolveSecrets(_request: FixRequest): Promise<ResolvedSecrets> {
  throw new Error("secret resolver not wired (T4)");
}

function buildEngineSource(request: FixRequest, secrets: ResolvedSecrets): Source {
  if (request.source.kind === "path") {
    return { kind: "path", dir: request.source.dir };
  }
  return {
    kind: "git",
    repoUrl: request.source.repoUrl,
    token: secrets.gitToken ?? "",
    ...(request.source.ref !== undefined ? { ref: request.source.ref } : {}),
  };
}

function computeCollectorUrl(requestUrl: string): string {
  try {
    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "http://localhost:4100";
  }
}
