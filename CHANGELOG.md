# Changelog

All notable changes to Pathlight. Dates are release days, not merge days.

## 0.3.0 — 2026-04-24

Published to npm: `@pathlight/sdk`, `@pathlight/eval`, `@pathlight/cli`,
`@pathlight/fix` (new), `@pathlight/openclaw` (new).
Published to PyPI: `pathlight`.

### Added — Code-fixing agent ([#44](https://github.com/syndicalt/pathlight/issues/44))
- New `@pathlight/fix` library. Pure `fix({ traceId, collectorUrl, source, llm, mode })`
  function reads a failing trace, pulls the source files the spans referenced
  (via `_source.file` metadata), and returns a unified diff + explanation.
- **BYOK** — user brings their own Anthropic or OpenAI key. Pathlight never
  acts as an inference proxy. Keys are never logged, never emitted in traces,
  never echoed in errors. `FixError.cause` is non-enumerable so default
  stringification paths can't walk into SDK error payloads that echo headers.
- **Three source modes**: `{ kind: "path", dir }` reads a local tree;
  `{ kind: "git", repoUrl, token, ref? }` shallow-clones into a tempdir with
  read-only tokens only; bisect deepens the clone automatically as needed.
- **Three fix modes**: `span` (fix the failing span[s]), `trace` (whole
  trace), `bisect` (binary-search a commit range for the regression commit
  in O(log₂ N) probes, propose a fix against that SHA).
- **Structured tool-use output.** Both Anthropic and OpenAI adapters expose
  the same `complete({ messages, tools })` interface and return the model's
  diff via a `propose_fix` tool call — no prose parsing.
- **Meta-trace emission** on every invocation. Carries mode, source kind,
  provider, model, token counts, files-changed — never the diff body,
  never keys/tokens.
- New CLI subcommand `pathlight fix <trace-id>` with `--source-dir` /
  `--git-url` / `--provider` / `--model` / `--apply` / `--bisect` /
  `--from` / `--to` flags. Key from `PATHLIGHT_LLM_API_KEY` env,
  token from `PATHLIGHT_GIT_TOKEN`. Progress prints to stderr so stdout
  stays pipeable.
- New collector route `POST /v1/fix` streams the engine over SSE
  (`progress` / `chunk` / `result` / `error` / `done`).
- New collector route `POST /v1/fix-apply` writes a diff to a local
  working tree via `git apply` with an explicit `--check` precheck.
- Dashboard adds **"Fix this"** button on every failed span's inspector.
  Dialog includes source picker, provider + BYOK key picker, mode selector,
  live SSE progress stream, unified diff viewer with per-file expand /
  collapse + add/remove colorization, **Apply to working tree** / **Download
  .patch** / **Copy** actions, and a **Bisect result** banner when the run
  identifies a regression commit.
- New example apps: `examples/fix-hello-world/` (path-mode loop against a
  deliberately-buggy agent), `examples/fix-bisect-regression/` (git + bisect
  walkthrough with a known regression).
- Docs: [docs/fix.md](docs/fix.md).

### Added — BYOK encrypted key storage ([#48](https://github.com/syndicalt/pathlight/issues/48))
- New `@pathlight/keys` internal package backed by libsodium
  `crypto_secretbox_easy` (authenticated encryption, fresh nonce per value).
- New `api_keys` table in `@pathlight/db` with `kind` (`llm` | `git`),
  `provider`, `label`, `sealed_value`, `preview` (last 4 chars for UI mask).
- Collector routes `POST/GET/PUT/DELETE /v1/projects/:id/keys` — mounted
  only when `PATHLIGHT_SEAL_KEY` (32-byte base64) is set. Fail-stop on
  missing/malformed. All responses are masked metadata; plaintext never
  leaves the server.
- Cross-project access returns `null` (same shape as not-found). Cross-kind
  access on the `SecretResolver` returns `null` to prevent mis-typed secrets
  flowing into the wrong API.
- `SecretResolver` adapter plugs into `POST /v1/fix` so the dashboard
  drives fix runs with stored key IDs — plaintext never touches the browser.
- New dashboard page `/settings/keys` — per-project list with add / rotate
  (atomic) / revoke flows; values masked as `••••••••<last-4>`.
- `packages/keys/LEAK-AUDIT.md` documents six grep-based audit probes + four
  runtime probes that every release must pass.
- Docs: [docs/byok-keys.md](docs/byok-keys.md).

### Added — OpenClaw plugin ([#42](https://github.com/syndicalt/pathlight/issues/42))
- New `@pathlight/openclaw` npm package — a native OpenClaw plugin that
  captures agent runs, LLM calls, tool execution, and sub-agent delegation
  as Pathlight traces, with `git_commit` / `git_branch` / `git_dirty`
  automatically attached to every trace.
- Install: `openclaw plugins install @pathlight/openclaw`. Configure via
  `PATHLIGHT_BASE_URL` / `PATHLIGHT_API_KEY` / `PATHLIGHT_PROJECT_ID` env
  (or OpenClaw plugin-config file; precedence: config > env > defaults).
- Hooks wired: `before_agent_start` / `agent_end`, `llm_input` / `llm_output`,
  `before_tool_call` / `after_tool_call`, `subagent_spawning` / `subagent_ended`.
  Memory hooks deferred until the upstream surface stabilizes.
- Graceful degradation: unreachable collector logs one warning and
  continues best-effort; hook throws are caught in a shared `safeOn` wrapper
  so a single bad hook can't take down the plugin.
- Shipped with an `examples/openclaw-hello-world/` starter.
- Docs: [docs/openclaw-plugin.md](docs/openclaw-plugin.md).

### Added — Docker Compose + prebuilt GHCR images
- `docker compose up -d` starts collector + dashboard with a named SQLite
  volume; migrations run automatically on first boot.
- Two multi-stage Dockerfiles (`Dockerfile.collector`, `Dockerfile.web`)
  at the repo root. Web image uses Next.js 15 standalone output.
- GitHub Actions workflow publishes tagged + `:latest` images to
  `ghcr.io/syndicalt/pathlight-{collector,web}` on every push to master.

### Changed
- TopNav gains a **Settings** link (`/settings/keys`) and bumps the version
  badge to v0.3.0.
- Collector router mounts `/v1/fix` unconditionally and
  `/v1/projects/:id/keys` only when `PATHLIGHT_SEAL_KEY` is set — BYOK is
  opt-in per deployment.

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
