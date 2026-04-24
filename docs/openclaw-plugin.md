# OpenClaw plugin

`@pathlight/openclaw` is a first-party [OpenClaw](https://openclaw.ai) plugin that captures agent runs, LLM calls, tool execution, and sub-agent delegation as Pathlight traces with zero code changes.

Differentiator vs competing observability plugins: every trace carries `git_commit` / `git_branch` / `git_dirty` automatically, so the `/commits` regression view and the fix-engine bisect (see [docs/fix.md](fix.md)) see your OpenClaw runs the same way they see SDK-instrumented code.

## Install

```bash
openclaw plugins install @pathlight/openclaw
```

## Configure

Via env vars (the primary path):

```bash
export PATHLIGHT_BASE_URL=http://localhost:4100
export PATHLIGHT_API_KEY=pk_live_...        # optional; not required for local collectors
export PATHLIGHT_PROJECT_ID=proj_xyz        # optional
```

Or via OpenClaw's plugin-config file (precedence: plugin config > env > defaults):

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
| --- | --- |
| `before_agent_start` → `agent_end` | Root trace (with `git_commit` / `git_branch` / `git_dirty`) |
| `llm_input` → `llm_output` | `llm` span with model, provider, input/output, token usage |
| `before_tool_call` → `after_tool_call` | `tool` span with name, args, result |
| `subagent_spawning` → `subagent_ended` | `agent` span in the parent trace (the child run gets its own trace) |

Memory hooks are intentionally out of scope in v1 — the hook surface is still stabilizing upstream.

## Sub-agent nesting

OpenClaw sub-agents are separate runs with their own `runId`. The plugin emits an `agent`-type **marker span** in the parent trace (carrying `childSessionKey` + `parentRunId` metadata) and lets the child's own `before_agent_start` hook open its own top-level Pathlight trace. Cross-trace linking via metadata is a planned UX pass.

## Graceful degradation

If the Pathlight collector is unreachable the plugin logs one warning and continues best-effort. A downed collector will never crash an OpenClaw run.

Per-hook errors are caught in a shared `safeOn` wrapper, so a single throwing hook can never take down the plugin.

## Security

- Plugin code runs in-process with the OpenClaw Gateway (trusted native plugin).
- The Pathlight API key (when set) is sent only to the configured `baseUrl`, never logged.
- No user prompt content leaves your infra unless your collector is off-box.

## Package

[`packages/openclaw-plugin`](../packages/openclaw-plugin/README.md) in this repo; published as `@pathlight/openclaw` on npm.
