import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildCollector } from "./fixtures.js";

const originalFetch = globalThis.fetch;
const jsonPost = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /v1/replay/llm", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.REPLAY_API_KEY;
    delete process.env.REPLAY_BASE_URL;
  });

  it("400 when provider/model/messages are missing", async () => {
    const { call } = await buildCollector();
    const res = await call("/v1/replay/llm", jsonPost({}));
    expect(res.status).toBe(400);
  });

  it("400 for anthropic when no API key is available", async () => {
    const { call } = await buildCollector();
    const res = await call(
      "/v1/replay/llm",
      jsonPost({ provider: "anthropic", model: "claude-x", messages: [] }),
    );
    expect(res.status).toBe(400);
  });

  it("proxies OpenAI-compatible chat completions", async () => {
    let hit: string | null = null;
    let bodySent: Record<string, unknown> | null = null;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      hit = String(url);
      bodySent = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          model: "gpt-4o-mini",
          choices: [{ message: { content: "hello back" } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const { call } = await buildCollector();
    const res = await call<{
      provider: string;
      output: string;
      inputTokens: number;
      outputTokens: number;
    }>(
      "/v1/replay/llm",
      jsonPost({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        apiKey: "sk-test",
      }),
    );

    expect(res.status).toBe(200);
    expect(hit).toBe("https://api.openai.com/v1/chat/completions");
    expect(res.body.provider).toBe("openai");
    expect(res.body.output).toBe("hello back");
    expect(res.body.inputTokens).toBe(3);
    expect(res.body.outputTokens).toBe(2);
  });

  it("prepends system prompt to openai messages when provided", async () => {
    let sent: { messages?: Array<{ role: string; content: string }> } | null = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
        status: 200,
      });
    }) as typeof fetch;

    const { call } = await buildCollector();
    await call(
      "/v1/replay/llm",
      jsonPost({
        provider: "openai",
        model: "gpt-4o-mini",
        system: "you are helpful",
        messages: [{ role: "user", content: "hi" }],
        apiKey: "sk",
      }),
    );

    expect(sent!.messages?.[0]).toEqual({ role: "system", content: "you are helpful" });
    expect(sent!.messages?.[1]).toEqual({ role: "user", content: "hi" });
  });

  it("surfaces upstream errors as 502", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })) as typeof fetch;

    const { call } = await buildCollector();
    const res = await call(
      "/v1/replay/llm",
      jsonPost({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        apiKey: "sk-bad",
      }),
    );
    expect(res.status).toBe(502);
  });

  it("proxies anthropic with the right headers", async () => {
    let headers: Headers | null = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          model: "claude-x",
          content: [{ text: "hi from claude" }],
          usage: { input_tokens: 1, output_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const { call } = await buildCollector();
    const res = await call<{ output: string; inputTokens: number }>(
      "/v1/replay/llm",
      jsonPost({
        provider: "anthropic",
        model: "claude-x",
        messages: [{ role: "user", content: "hi" }],
        apiKey: "sk-ant-test",
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.output).toBe("hi from claude");
    expect(headers!.get("x-api-key")).toBe("sk-ant-test");
    expect(headers!.get("anthropic-version")).toBe("2023-06-01");
  });

  it("falls back to env var API key when request has no key", async () => {
    process.env.OPENAI_API_KEY = "sk-from-env";
    let authHeader: string | null = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
    }) as typeof fetch;

    const { call } = await buildCollector();
    await call(
      "/v1/replay/llm",
      jsonPost({
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    expect(authHeader).toBe("Bearer sk-from-env");
  });

  it("REPLAY_API_KEY wins over OPENAI_API_KEY", async () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.REPLAY_API_KEY = "pvra-replay";
    let authHeader: string | null = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      authHeader = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
    }) as typeof fetch;

    const { call } = await buildCollector();
    await call(
      "/v1/replay/llm",
      jsonPost({ provider: "openai", model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(authHeader).toBe("Bearer pvra-replay");
  });

  it("REPLAY_BASE_URL routes requests to the configured gateway", async () => {
    process.env.REPLAY_API_KEY = "pvra-test";
    process.env.REPLAY_BASE_URL = "https://gateway.provara.xyz";
    let hitUrl: string | null = null;
    globalThis.fetch = (async (url: string) => {
      hitUrl = String(url);
      return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 });
    }) as typeof fetch;

    const { call } = await buildCollector();
    await call(
      "/v1/replay/llm",
      jsonPost({ provider: "openai", model: "claude-sonnet-4-6", messages: [{ role: "user", content: "hi" }] }),
    );

    expect(hitUrl).toBe("https://gateway.provara.xyz/v1/chat/completions");
  });

  it("normalizes a base URL passed with /v1 suffix", async () => {
    let hitUrl: string | null = null;
    globalThis.fetch = (async (url: string) => {
      hitUrl = String(url);
      return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
    }) as typeof fetch;

    const { call } = await buildCollector();
    await call(
      "/v1/replay/llm",
      jsonPost({
        provider: "openai",
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        apiKey: "sk",
        baseUrl: "https://gateway.provara.xyz/v1",   // trailing /v1
      }),
    );

    // Should resolve to a single /v1 segment, not /v1/v1
    expect(hitUrl).toBe("https://gateway.provara.xyz/v1/chat/completions");
  });
});
