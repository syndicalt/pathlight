# @pathlight/openclaw

Pathlight tracing plugin for [OpenClaw](https://openclaw.ai). Captures agent
runs, LLM calls, tool execution, and sub-agent delegation as Pathlight traces —
with git provenance baked in — and zero code changes in your agent.

## Install

```bash
openclaw plugins install @pathlight/openclaw
```

## Configure

Point the plugin at your Pathlight collector via env vars:

```bash
export PATHLIGHT_BASE_URL=http://localhost:4100
export PATHLIGHT_API_KEY=pk_live_...        # optional for local collectors
export PATHLIGHT_PROJECT_ID=proj_xyz        # optional
```

Or in your OpenClaw plugin config (precedence: plugin config > env > defaults):

```json
{
  "pathlight": {
    "baseUrl": "https://collector.example.com",
    "apiKey": "pk_live_...",
    "projectId": "proj_xyz"
  }
}
```

Defaults: `baseUrl=http://localhost:4100`, no API key, no project ID.

## What gets traced

| OpenClaw event | Pathlight span |
|---|---|
| `before_agent_start` → `agent_end` | Root trace (with `git_commit` / `git_branch` / `git_dirty`) |
| `llm_input` → `llm_output` | `llm` span with model, provider, input/output, token usage |
| `before_tool_call` → `after_tool_call` | `tool` span with name, args, result |
| `subagent_spawning` → `subagent_ended` | `agent` span in the parent trace (the child run gets its own trace) |

Memory hooks are intentionally out of scope in v1.

## Graceful degradation

If the collector is unreachable, the plugin logs one warning and continues
best-effort. A downed collector never crashes the agent.

## License

MIT
