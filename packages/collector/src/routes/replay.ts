import { Hono } from "hono";

/**
 * Server-side proxy that lets the dashboard re-run an LLM call with edited
 * inputs. The browser can't call OpenAI/Anthropic directly (CORS) so the
 * request flows through the collector. API keys are read from env vars
 * (OPENAI_API_KEY, ANTHROPIC_API_KEY) by default, but the request can
 * override them per-call for quick experimentation.
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
        const apiKey = body.apiKey || process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return c.json({ error: "ANTHROPIC_API_KEY not set and no apiKey in request" }, 400);

        const base = body.baseUrl || "https://api.anthropic.com";
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

      // OpenAI-compatible (OpenAI, Ollama, Together, Groq, etc)
      const apiKey = body.apiKey || process.env.OPENAI_API_KEY;
      const base = body.baseUrl || "https://api.openai.com";
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
