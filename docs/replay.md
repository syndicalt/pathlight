# LLM span replay

Every LLM span in the trace inspector gets an inline playground: edit the
messages, model, or system prompt, then re-run against the real provider
without leaving the dashboard. No more copy-pasting prompts into a separate
playground tab.

## Usage

1. Open a trace. Click an LLM span in the waterfall.
2. The right-hand inspector shows a **Replay** panel with the original
   prompt pre-filled.
3. Edit the system prompt, user messages, or model as desired. Add/remove
   messages with the buttons below.
4. Enter your provider API key — it's saved in `localStorage` per-provider
   so you only enter it once. (If `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`
   is set in the collector's env, the UI key is optional.)
5. Click **Run replay**. The response renders inline with tokens and
   duration.

## How the SDK populates the editor

The inspector tries to extract a `{ messages, system }` shape from
`span.input`. If the SDK stored the span input as:

```json
{
  "messages": [
    { "role": "system", "content": "You are…" },
    { "role": "user", "content": "…" }
  ]
}
```

…then the replay editor pre-fills the system prompt from the first message
(if its role is `system`) and populates the message list with the rest.

If the input isn't in that shape, the editor falls back to treating the
whole input as a single user message. Works but less rich.

### Tip: make your LLM spans replay-friendly

Pass the raw chat payload to `span.input` rather than a post-processed
result. You don't have to — the span itself is independent — but it makes
the replay experience much better:

```typescript
const span = trace.span("chat", "llm", {
  model: "gpt-4o",
  provider: "openai",
  input: { messages },   // the actual payload, pre-send
});
const res = await openai.chat.completions.create({ model: "gpt-4o", messages });
await span.end({ output: res.choices[0].message.content, /* tokens, cost */ });
```

## Collector proxy

The browser can't hit `api.openai.com` or `api.anthropic.com` directly
(CORS), so the collector exposes a proxy:

```
POST /v1/replay/llm
Content-Type: application/json

{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "messages": [{ "role": "user", "content": "hi" }],
  "system": "optional system prompt",
  "apiKey": "sk-…",
  "baseUrl": "https://api.openai.com",
  "temperature": 0.7,
  "maxTokens": 1024
}
```

Response shape:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini-2024-…",
  "output": "…",
  "raw": { /* full provider response */ },
  "inputTokens": 50,
  "outputTokens": 20,
  "durationMs": 640
}
```

## Provider support

### OpenAI-compatible

Default path. Hits `POST <baseUrl>/v1/chat/completions` with a standard
OpenAI chat payload. Works with:

- OpenAI
- Together AI (`baseUrl: "https://api.together.xyz"`)
- Groq (`baseUrl: "https://api.groq.com/openai"`)
- Ollama (`baseUrl: "http://localhost:11434"`, no `apiKey` needed)
- LiteLLM proxy, Portkey, any OpenAI-compatible endpoint

### Anthropic

Set `provider: "anthropic"`. Hits `POST /v1/messages` with Anthropic's
schema (including the `anthropic-version` header). The collector translates
the response back into the unified `output` field.

## API key + base URL handling

Priority order for both credentials:

1. `apiKey` / `baseUrl` fields in the request body (per-request override)
2. Generic `REPLAY_API_KEY` / `REPLAY_BASE_URL` env vars on the collector —
   works with any provider (OpenAI-compatible gateway, Anthropic, or vanilla OpenAI)
3. Provider-specific env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)

The dashboard persists both per-request values in `localStorage` under
`pathlight:replay-key:<provider>` and `pathlight:replay-base:<provider>`
so you don't re-type them. They're only sent along the collector →
provider chain.

### Using an OpenAI-compatible gateway (Provara, Groq, Together, Ollama…)

Set the base URL either per-request from the dashboard or via env on the
collector:

```bash
REPLAY_API_KEY=pvra_…
REPLAY_BASE_URL=https://gateway.provara.xyz
```

The collector accepts the base URL with or without a trailing `/v1` —
the path is appended automatically.

## Not in scope yet

- **Tool span replay** — tool calls depend on user code (your `search()`
  function), and Pathlight can't re-invoke arbitrary functions safely.
- **Multi-span replay-from-point** — re-running an entire agent from a
  specific span requires SDK-side orchestration that's tracked as a future
  feature.
- **Saving the replay as a new trace** — a future enhancement; today the
  replay is one-shot and doesn't persist.
