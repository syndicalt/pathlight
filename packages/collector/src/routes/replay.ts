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
        const data = await res.json();
        if (!res.ok) return c.json({ error: data }, 502);
        return c.json({
          provider: "anthropic",
          model: data.model,
          output: data.content?.map((c: { text?: string }) => c.text).filter(Boolean).join("\n") || "",
          raw: data,
          inputTokens: data.usage?.input_tokens,
          outputTokens: data.usage?.output_tokens,
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
      const data = await res.json();
      if (!res.ok) return c.json({ error: data }, 502);
      return c.json({
        provider: "openai",
        model: data.model,
        output: data.choices?.[0]?.message?.content ?? "",
        raw: data,
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : String(err) },
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
