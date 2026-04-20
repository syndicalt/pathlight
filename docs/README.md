# Pathlight docs

Deep-dive guides for each feature. For the project overview and quick
start, see [../README.md](../README.md).

## By feature

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

## By package

- [`@pathlight/sdk`](../packages/sdk) — TypeScript SDK
- [`@pathlight/eval`](../packages/eval) — assertion DSL + CI runner
- [`@pathlight/cli`](../packages/cli) — command-line utilities
- [Collector](../packages/collector) — Hono API server
- [DB](../packages/db) — Drizzle schema + migrations
- [Web dashboard](../apps/web) — Next.js UI

## Reference

- [CHANGELOG.md](../CHANGELOG.md) — chronological feature log
- [../README.md](../README.md) — overview, quick start, API + SDK reference
