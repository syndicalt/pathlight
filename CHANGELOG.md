# Changelog

All notable changes to Pathlight. Dates are release days, not merge days.

## Unreleased

### Added — Docker Compose + prebuilt GHCR images
- `docker compose up -d` starts collector + dashboard with a named SQLite
  volume; migrations run automatically on first boot.
- Two multi-stage Dockerfiles (`Dockerfile.collector`, `Dockerfile.web`)
  at the repo root. Web image uses Next.js 15 standalone output.
- GitHub Actions workflow publishes tagged + `:latest` images to
  `ghcr.io/syndicalt/pathlight-{collector,web}` on every push to master.

### Fixed
- `@pathlight/db` now ships a proper compiled build (`main` was pointing
  at `src/index.ts` which only worked under `tsx`; production `node`
  couldn't load it). The package builds to `dist/` like the other
  workspaces do.

## 0.2.0 — 2026-04-20

First tagged release since 0.1.0. Adds real-time streaming, trace diff,
git-linked regressions, live breakpoints, LLM replay, the `@pathlight/eval`
CI runner, and the `pathlight share` CLI. New packages published to npm:
`@pathlight/eval`, `@pathlight/cli`. Updated: `@pathlight/sdk`.

### Added — Real-time dashboard ([#3](https://github.com/syndicalt/pathlight/issues/3))
- **SSE stream** at `GET /v1/traces/stream` broadcasts `trace.created` and
  `trace.updated` events.
- Dashboard subscribes on load; traces appear and update live without refresh.
- **Unreviewed traces** get a subtle sky-blue left accent. Opening a trace
  detail page auto-marks it reviewed via `PATCH /v1/traces/:id { reviewedAt }`.
- `reviewed_at` column added to `traces`.

### Added — Trace diff ([#5](https://github.com/syndicalt/pathlight/issues/5))
- Select two traces on the list (hover-revealed checkboxes, floating Compare
  action bar) and open `/traces/compare?a=…&b=…`.
- LCS-aligned span pairs with per-pair duration delta.
- Line-level JSON diff for trace inputs, outputs, and any expanded span's
  input/output.
- Summary deltas at top: duration / tokens / cost, span count.
- Zero-dependency diff utility at `apps/web/src/lib/diff.ts`.

### Added — Git-linked regressions ([#7](https://github.com/syndicalt/pathlight/issues/7))
- SDK auto-captures commit SHA, branch, and dirty flag via `git rev-parse`
  (once per process, cached). Opt-out: `new Pathlight({ disableGitContext: true })`.
- New columns on `traces`: `git_commit`, `git_branch`, `git_dirty`.
- `GET /v1/traces/commits` returns per-commit aggregates (trace count, avg
  duration/tokens/cost, failure count, first/last seen).
- New dashboard page `/commits` shows each commit with deltas vs. the previous
  commit; regressions >25% highlighted red.
- Commit badge on every trace row; `?commit=<sha>` filters the list.

### Added — `@pathlight/eval` assertion DSL and CI runner ([#9](https://github.com/syndicalt/pathlight/issues/9))
- New workspace package exposing pytest-style matchers:
  - `toSucceed()` / `toFail()`
  - `toCompleteWithin(ms | "5s" | "2m")`
  - `toCostLessThan(usd)` / `toUseAtMostTokens(n)`
  - `toHaveNoFailedSpans()` / `toHaveNoToolLoops(n?)`
  - `toCallTool(name).atMost(n)` / `.atLeast(n)` / `.exactly(n)`
  - `toMatchOutput(regex | string)`
- `pathlight-eval <spec.mjs>` CLI. Exit code 0 on all pass; 1 with a failure
  report on any miss; 2 on spec-loading errors.
- Drop-in GitHub Actions step example in `packages/eval/README.md`.

### Added — `pathlight share` single-file trace snapshot ([#11](https://github.com/syndicalt/pathlight/issues/11))
- New workspace package `@pathlight/cli`.
- `pathlight share <trace-id>` writes a self-contained HTML file with:
  - Embedded trace data (JSON in a `<script type="application/json">`).
  - Vanilla JS/CSS viewer: summary cards, input/output, waterfall timeline.
  - Zero network calls on open; opens in any browser.
- Redaction flags: `--redact-input`, `--redact-output`, `--redact-errors`.
- `--base-url`, `--out` path options; `PATHLIGHT_URL` env var fallback.

### Added — Live breakpoints ([#13](https://github.com/syndicalt/pathlight/issues/13))
- `await pathlight.breakpoint({ label, state, timeoutMs? })` pauses the agent
  and long-polls the collector until the dashboard resumes it.
- If the dashboard edits `state` before resuming, the promise resolves with
  the edited value.
- In-memory registry on the collector with an `EventEmitter` backbone.
- Routes:
  - `POST /v1/breakpoints` — register + wait
  - `GET /v1/breakpoints` — list active
  - `POST /v1/breakpoints/:id/resume` — resume with optional override
  - `POST /v1/breakpoints/:id/cancel` — reject the SDK promise
  - `GET /v1/breakpoints/stream` — SSE feed (snapshot + added/resolved/cancelled)
- Dashboard gets a floating amber pulse badge and a slide-out editor with:
  - Label, source trace link, live JSON editor for the state
  - "Resume as-is" / "Resume with edits" / "Cancel"
  - Auto-opens on new breakpoint arrival

### Added — LLM span replay ([#15](https://github.com/syndicalt/pathlight/issues/15))
- Any LLM span inspector gets an inline playground:
  - Editable model, system prompt, per-message role + content
  - Add/remove messages
  - API key field (saved in `localStorage` per-provider)
  - "Run replay" posts to the collector which proxies to the real provider
- `POST /v1/replay/llm` supports:
  - OpenAI-compatible providers (OpenAI, Together, Groq, Ollama, …) via
    `/v1/chat/completions`
  - Anthropic via `/v1/messages`
  - `apiKey` override per-request or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
    env vars on the collector
- Response renders inline with tokens + duration.

### Changed — UI layout
- **Span inspector** is now a side-by-side panel rather than a fixed overlay
  sidebar — timeline narrows to the left (0.8fr), inspector takes the right
  (1.2fr) and is sticky while scrolling. Non-LLM spans keep a two-column
  JSON grid. ([#17](https://github.com/syndicalt/pathlight/issues/17), [#18](https://github.com/syndicalt/pathlight/issues/18), [#19](https://github.com/syndicalt/pathlight/issues/19))
- **Top navigation** replaces the left sidebar. Sticky header with logo,
  version, and Traces / Commits links right-aligned. Frees ~200px of
  horizontal width on every page. ([#20](https://github.com/syndicalt/pathlight/issues/20))

### Fixed
- Trace list input preview: nested objects no longer render as
  `[object Object]`. `Object.values(parsed)` now maps non-string values
  through `JSON.stringify` before joining.

## 0.1.0 — 2026-04-16

Initial release. Core trace/span model, Hono collector, Next.js dashboard,
TypeScript SDK, source-location capture, issue detection, `db:retire` CLI.
