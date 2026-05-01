import { Hono } from "hono";

/**
 * Server-side proxy that lets the dashboard re-run an LLM call with edited
 * inputs. The browser can't call OpenAI/Anthropic (and OpenAI-compatible
 * gateways like Provara/Groq/Together) directly without CORS surprises, so
 * the request flows through the collector.
 *
 * Credential resolution order (both apiKey and baseUrl):
 *   1. Explicit field in the request body
 *   2. Generic REPLAY_API_KEY / REPLAY_BASE_URL env vars
 *   3. Provider-specific env vars (OPENAI_API_KEY / ANTHROPIC_API_KEY) —
 *      baseUrl falls back to each provider's canonical endpoint
 */
export function createReplayRoutes() {
  const app = new Hono();

  app.post("/llm", async (c) => {
    const body = await c.req.json<{
      provider: "openai" | "anthropic" | string;
      model: string;
      messages: Array<{ role: string; content: string | Array<unknown> }>;
      system?: string;
      temperature?: number;
      maxTokens?: number;
      apiKey?: string;
      baseUrl?: string;
    }>();

    if (!body.provider || !body.model || !Array.isArray(body.messages)) {
      return c.json({ error: "provider, model, and messages are required" }, 400);
    }

    const started = Date.now();

    try {
      if (body.provider === "anthropic") {
        const apiKey = body.apiKey || process.env.REPLAY_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return c.json({ error: "No API key — set ANTHROPIC_API_KEY/REPLAY_API_KEY on the collector or pass apiKey in the request" }, 400);

        const rawBase = body.baseUrl || process.env.REPLAY_BASE_URL || "https://api.anthropic.com";
        const base = normalizeBase(rawBase);
        const res = await fetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: body.model,
            max_tokens: body.maxTokens ?? 1024,
            system: body.system,
            messages: body.messages,
            temperature: body.temperature,
          }),
        });
        const data = await readJsonOrText(res);
        if (!res.ok) return c.json({ error: sanitizeProviderError(data, res) }, 502);
        const replay = data as {
          model?: string;
          content?: Array<{ text?: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        return c.json({
          provider: "anthropic",
          model: replay.model,
          output: replay.content?.map((c) => c.text).filter(Boolean).join("\n") || "",
          raw: replay,
          inputTokens: replay.usage?.input_tokens,
          outputTokens: replay.usage?.output_tokens,
          durationMs: Date.now() - started,
        });
      }

      // OpenAI-compatible (OpenAI, Provara, Ollama, Together, Groq, etc.)
      const apiKey = body.apiKey || process.env.REPLAY_API_KEY || process.env.OPENAI_API_KEY;
      const rawBase = body.baseUrl || process.env.REPLAY_BASE_URL || "https://api.openai.com";
      const base = normalizeBase(rawBase);
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: body.model,
          messages: body.system
            ? [{ role: "system", content: body.system }, ...body.messages]
            : body.messages,
          temperature: body.temperature,
          max_tokens: body.maxTokens,
        }),
      });
      const data = await readJsonOrText(res);
      if (!res.ok) return c.json({ error: sanitizeProviderError(data, res) }, 502);
      const replay = data as {
        model?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return c.json({
        provider: "openai",
        model: replay.model,
        output: replay.choices?.[0]?.message?.content ?? "",
        raw: replay,
        inputTokens: replay.usage?.prompt_tokens,
        outputTokens: replay.usage?.completion_tokens,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      return c.json(
        { error: { message: err instanceof Error ? err.message : String(err), type: "replay_proxy_error" } },
        500,
      );
    }
  });

  return app;
}

// Accept either "https://gateway.provara.xyz" or
// "https://gateway.provara.xyz/v1" — downstream code appends /v1/<path>.
function normalizeBase(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function sanitizeProviderError(data: unknown, res: Response) {
  const providerError = extractProviderError(data);
  return {
    message: truncate(providerError.message || res.statusText || "Provider request failed", 500),
    type: providerError.type || "provider_error",
    status: res.status,
    requestId: requestIdFromHeaders(res.headers),
  };
}

function extractProviderError(data: unknown): { message?: string; type?: string } {
  if (typeof data === "string") return { message: data };
  if (!data || typeof data !== "object") return {};

  const record = data as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    return {
      message: typeof err.message === "string" ? err.message : undefined,
      type: typeof err.type === "string" ? err.type : typeof err.code === "string" ? err.code : undefined,
    };
  }

  return {
    message: typeof record.message === "string" ? record.message : undefined,
    type: typeof record.type === "string" ? record.type : undefined,
  };
}

function requestIdFromHeaders(headers: Headers): string | undefined {
  return headers.get("x-request-id") ||
    headers.get("request-id") ||
    headers.get("cf-ray") ||
    undefined;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
