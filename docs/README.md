# Pathlight docs

Deep-dive guides for each feature. For the project overview and quick
start, see [../README.md](../README.md).

## By feature

### Observability core
- [Real-time dashboard](realtime.md) — SSE stream, unreviewed highlighting
- [Trace diff](trace-diff.md) — side-by-side comparison, LCS span alignment
- [Git-linked regressions](git-regressions.md) — `/commits` page, auto-
  captured commit SHA, regression flagging
- [Live breakpoints](breakpoints.md) — pause agents, edit state, resume
- [LLM replay](replay.md) — in-dashboard prompt playground against real
  providers
- [Eval-as-code + CI](eval.md) — pytest-style assertions over recent
  traces, `pathlight-eval` runner
- [Sharing traces](share.md) — single-file HTML snapshots via
  `pathlight share`
- [Eventloom visualizer](eventloom.md) — renders Eventloom Capture,
  Replay, and Handoff panels from trace metadata/output
- [Roadmap](roadmap.md) — candidate integrations and future product
  directions

### Code-fixing
- [Fix engine](fix.md) — BYOK code-fixing agent: library, CLI, and
  dashboard "Fix this" button. Path / git / bisect modes.
- [BYOK key storage](byok-keys.md) — encrypted-at-rest LLM keys + git
  tokens for the dashboard's fix flow. libsodium, fail-stop on missing
  master key, masked previews only.

### Integrations
- [OpenTelemetry interop](opentelemetry.md) — OTLP/HTTP ingest, gen_ai
  semantic conventions, attribute mapping
- [ComfyUI tracing](roadmap.md#comfyui-tracing) — roadmap and first bridge
  shape for exporting ComfyUI workflow history into Pathlight traces
- [OpenClaw plugin](openclaw-plugin.md) — first-party OpenClaw tracing
  plugin. Captures agent runs, LLM calls, tools, and sub-agent
  delegation with git provenance.
- [Eventloom visualizer](eventloom.md) — Pathlight-side view for
  Eventloom event-sourced agent logs and handoffs
- [Python SDK](python.md) — mirror of the TS SDK with Pythonic idioms

### Deployment
- [Docker deployment](docker.md) — one-command self-hosted setup,
  upgrade, env-var reference (incl. `PATHLIGHT_SEAL_KEY` for BYOK)

## By package

| Package | Published as | What it does |
| --- | --- | --- |
| [`@pathlight/sdk`](../packages/sdk) | npm | TypeScript SDK for instrumenting agents |
| [`pathlight`](../packages/sdk-python) | PyPI | Python SDK (sync + async) |
| [`@pathlight/eval`](../packages/eval) | npm | Assertion DSL + `pathlight-eval` CI runner |
| [`@pathlight/comfyui`](../packages/comfyui) | internal | ComfyUI history exporter for Pathlight traces |
| [`@pathlight/cli`](../packages/cli) | npm | `pathlight share` + `pathlight fix` CLIs |
| [`@pathlight/fix`](../packages/fix) | npm | Code-fixing agent core (library) |
| [`@pathlight/openclaw`](../packages/openclaw-plugin) | npm | OpenClaw tracing plugin |
| [`@pathlight/keys`](../packages/keys) | internal | BYOK encrypted key storage |
| [`@pathlight/collector`](../packages/collector) | internal | Hono trace collector (port 4100) |
| [`@pathlight/db`](../packages/db) | internal | Drizzle schema + migrations |
| [`@pathlight/web`](../apps/web) | docker only | Next.js dashboard (port 3100) |

## Examples

End-to-end walkthroughs you can run locally:

- [`examples/fix-hello-world`](../examples/fix-hello-world) — minimal
  buggy agent, failing trace, `pathlight fix` repair loop
- [`examples/fix-bisect-regression`](../examples/fix-bisect-regression) —
  git-mode bisect across a known-good / known-bad SHA range
- [`examples/openclaw-hello-world`](../examples/openclaw-hello-world) —
  OpenClaw agent wired to Pathlight via `@pathlight/openclaw`
- [`examples/quote-agent`](../examples/quote-agent) — demo source the
  fix-engine reads from when running `scripts/seed-screenshots.mjs`

## Tooling

- [`scripts/seed-screenshots.mjs`](../scripts/seed-screenshots.mjs) —
  re-runnable seed that creates a project, a failing trace with
  `_source.file`-tagged spans, an OpenClaw-shape nested trace, and three
  sealed BYOK keys. Used to capture the landing-page screenshots; useful
  for dogfooding the fix flow without writing your own bug.

## Reference

- [CHANGELOG.md](../CHANGELOG.md) — chronological feature log
- [../README.md](../README.md) — overview, quick start, API + SDK reference
- [`packages/keys/LEAK-AUDIT.md`](../packages/keys/LEAK-AUDIT.md) —
  per-release security checklist for the BYOK key store
