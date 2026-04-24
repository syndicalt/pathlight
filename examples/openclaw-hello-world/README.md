# openclaw-hello-world

Minimal OpenClaw agent wired up with `@pathlight/openclaw` for tracing. Runs
one LLM call and one tool call, and both land in the Pathlight dashboard.

## Prerequisites

1. A running Pathlight collector + web UI:
   ```bash
   docker compose up -d   # from the pathlight repo root
   # Dashboard: http://localhost:3100
   # Collector: http://localhost:4100
   ```
2. OpenClaw installed on your machine (see [openclaw.ai](https://openclaw.ai)).
3. An LLM provider configured in OpenClaw (OpenAI, Anthropic, etc.).

## Run

```bash
export PATHLIGHT_BASE_URL=http://localhost:4100
export PATHLIGHT_PROJECT_ID=openclaw-hello-world

cd examples/openclaw-hello-world
openclaw plugins install @pathlight/openclaw
openclaw run agent.md "What time is it in Tokyo?"
```

Open http://localhost:3100 — the run appears as a trace with:

- Root span: the agent run, tagged with the git commit you ran from
- An `llm` child span: the model call that resolved the time-zone query
- A `tool` child span: the `get_time` tool invocation

## What's in here

- `agent.md` — an OpenClaw agent definition with one LLM step and one tool call.
- `.env.example` — copy to `.env` and fill in your collector details.

## Troubleshooting

If no traces appear, check:

1. `curl http://localhost:4100/v1/health` — collector reachable?
2. `openclaw plugins list` — is `@pathlight/openclaw` enabled?
3. Plugin logs on agent startup will say `pathlight: tracing enabled (<baseUrl>)`.
   Missing that line means the plugin didn't load.
