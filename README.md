# Pathlight

Visual debugging, execution traces, and observability for AI agents.

When your AI agent makes a bad decision at step 7 of a 12-step workflow,
Pathlight shows you exactly what happened — what went in, what came out, how
long it took, and where in your code it was called. Then it lets you *edit*
that step's prompt and re-run it against the real model, diff two runs
side-by-side, pause the agent mid-execution, or block a PR when latency
regresses.

No more debugging agents with `console.log`.

---

## Feature tour

| Feature | Why you'd use it | Docs |
| --- | --- | --- |
| **Waterfall timeline** | Visual answer to "where is the time going?" | [overview](#waterfall-timeline) |
| **Span inspector** | Full input/output/metadata on click, side-by-side with timeline | [overview](#span-inspector) |
| **Real-time stream** | New traces and status changes land without refresh | [docs/realtime.md](docs/realtime.md) |
| **Trace diff** | Side-by-side compare of two traces; "did my prompt change break anything?" | [docs/trace-diff.md](docs/trace-diff.md) |
| **Git-linked regressions** | SDK auto-captures commit SHA; `/commits` page flags >25% cost/latency regressions | [docs/git-regressions.md](docs/git-regressions.md) |
| **Live breakpoints** | `await tl.breakpoint(...)` pauses your agent; edit state on the dashboard and resume | [docs/breakpoints.md](docs/breakpoints.md) |
| **LLM replay** | Edit messages on any LLM span and re-run against the real provider | [docs/replay.md](docs/replay.md) |
| **Eval-as-code + CI** | `expect(trace).toCostLessThan(0.10)` — assert over recent traces, exit nonzero in CI | [packages/eval/README.md](packages/eval/README.md) |
| **Code-fixing agent** | BYOK LLM reads your failing trace + source and proposes a unified diff. CLI, dashboard button, `bisect` across commits. | [docs/fix.md](docs/fix.md) |
| **BYOK key storage** | Encrypted-at-rest LLM keys + git tokens per project. Dashboard picker uses stored IDs; plaintext never touches the browser. | [docs/byok-keys.md](docs/byok-keys.md) |
| **OpenClaw plugin** | `@pathlight/openclaw` captures OpenClaw agent runs, LLM calls, tool execution, and sub-agent delegation with git provenance. | [docs/openclaw-plugin.md](docs/openclaw-plugin.md) |
| **`pathlight share`** | Single-file HTML snapshot of a trace, zero deps to open | [packages/cli/README.md](packages/cli/README.md) |
| **OpenTelemetry interop** | Collector accepts OTLP/HTTP; any OTel-instrumented app can ship to Pathlight | [docs/opentelemetry.md](docs/opentelemetry.md) |
| **Python SDK** | `pip install pathlight` — same dashboard features, Pythonic API, sync + async | [docs/python.md](docs/python.md) |
| **One-command deploy** | `docker compose up -d` pulls prebuilt images from GHCR; SQLite persists in a named volume | [docs/docker.md](docs/docker.md) |
| **Automatic source mapping** | Every span records the file:line where it was created | [overview](#automatic-source-mapping) |
| **Issue detection** | Failed spans + error-pattern matches flag traces in the list | [overview](#issue-detection) |

Full chronological list in [CHANGELOG.md](CHANGELOG.md).

---

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/syndicalt/pathlight.git
cd pathlight
docker compose up -d
```

That's it. Dashboard at <http://localhost:3100>, collector at
<http://localhost:4100>. Trace data lives in the `pathlight_data` named
volume — survives restarts; `docker compose down -v` wipes it.

Prebuilt images are published to GHCR so the first `up` pulls rather
than builds.

### Local dev (if you want to hack on Pathlight itself)

```bash
git clone https://github.com/syndicalt/pathlight.git
cd pathlight
npm install

# Generate and apply database migrations
npm run db:generate -w packages/db
DATABASE_URL="file:$(pwd)/packages/collector/pathlight.db" \
  npm run db:migrate -w packages/db

# Start collector (4100) + dashboard (3100) together
npx turbo dev
```

- **Collector**: <http://localhost:4100> — receives trace data from your agent
- **Dashboard**: <http://localhost:3100> — view, debug, diff, replay

### Instrument your agent

```bash
npm install @pathlight/sdk
```

```typescript
import { Pathlight } from "@pathlight/sdk";

const tl = new Pathlight({ baseUrl: "http://localhost:4100" });

const trace = tl.trace("research-agent", { query: "What is WebAssembly?" });

// Each step is a span
const llm = trace.span("classify", "llm", { model: "gpt-4o" });
const result = await openai.chat(/* … */);
await llm.end({ output: result, inputTokens: 50, outputTokens: 10 });

const search = trace.span("web-search", "tool", { toolName: "search" });
const results = await searchTool(result.query);
await search.end({ toolResult: results });

await trace.end({ output: finalAnswer });
```

That's it. Open the dashboard and every trace appears in real time with full
waterfall, source locations, token counts, and git provenance.

---

## Workflow playbooks

### "Did my prompt change regress anything?"
1. Open the trace list. Commit badge on each row shows which SHA produced it.
2. Pick the last good run and your new run; click **Compare**.
3. See per-span duration delta, input/output JSON diff, and new/missing spans.

### "Can I stop this agent mid-flight and tweak its state?"
1. Drop `state = await tl.breakpoint({ label: "post-retrieval", state: { docs, query } })`.
2. Run the agent. When execution reaches the breakpoint, the dashboard's
   floating pulse badge lights up.
3. Edit the JSON state, click **Resume with edits** — your agent continues
   with the modified value.

### "Let me tune this prompt without leaving the dashboard."
1. Open a trace detail, click any LLM span.
2. Edit the system prompt, messages, or model right in the inspector.
3. Enter your provider API key (saved in `localStorage` per-provider) and
   click **Run replay**.

### "Don't let a merge ship a cost regression."
1. Write `specs/estimate.mjs` with `expect(trace).toCostLessThan(0.05)` etc.
2. Add a GitHub Actions step: `npx pathlight-eval specs/estimate.mjs --base-url …`.
3. Merge gate fails when any trace violates the assertion.

### "Send this weird run to a teammate."
1. `pathlight share <trace-id> --out /tmp/bad-run.html`
2. Attach the HTML to your GitHub issue / Slack thread. They open it in any
   browser — no dashboard, no server, no dependencies.

### "Fix this failing trace without leaving the dashboard."
1. Open the failing trace, click the broken span.
2. Click **Fix this** in the inspector header. Pick a source (local path or
   remote git URL), a provider key from your BYOK store, and a mode
   (span / trace / bisect).
3. SSE streams progress. Diff preview renders per-file with add/remove
   colorization. Click **Apply to working tree** (path mode) or
   **Download .patch**. See [docs/fix.md](docs/fix.md).

### "Which commit broke this agent?"
1. From the CLI: `pathlight fix <trace-id> --bisect --from <good-sha> --to <bad-sha> --git-url <url>`
2. Binary-search walks the commit range in O(log N) probes and returns the
   regression SHA plus a proposed fix against that commit.
3. In the dashboard: pick mode **Bisect** in the fix dialog — the result
   screen shows a banner with the regression SHA linking to `/commits`.

---

## What you see

### Trace list

All agent runs at a glance. Status, duration, tokens, tags, commit badge.
Unreviewed runs get a subtle left accent. Real-time — new traces and status
updates appear without refresh. Multi-select two rows to compare.

### Waterfall timeline

Every span as a proportional bar showing when it started and how long it
took relative to the total trace. Sequential steps cascade down. Issue spans
get an amber highlight. Clicking a span splits the view: timeline shrinks
left, inspector fills the right.

### Span inspector

Side-by-side with the timeline. Shows:
- Status, duration, model, provider, tokens
- **Source location** — file:line automatically captured from the call stack
- Input / output / tool args / tool result / metadata (formatted JSON)
- Error details
- For **LLM spans**: full replay editor — edit messages and re-run

### `/commits` regression view

Groups recent traces by commit SHA. Per-commit aggregates (trace count, avg
duration/tokens/cost, failure count) with deltas vs. the previous commit.
Rows where a metric got ≥25% worse are tinted red so regressions can't hide.

### Breakpoints panel

Floating amber pulse badge appears the moment any agent hits a breakpoint.
Click it to open a per-breakpoint editor: label, trace link, live JSON state
editor, Resume / Resume with edits / Cancel.

---

## Span types

| Type | Color | Use for |
| --- | --- | --- |
| `llm` | Blue | LLM API calls (chat completions, embeddings) |
| `tool` | Green | Tool invocations (search, code exec, API calls) |
| `retrieval` | Violet | RAG retrieval, document fetches, knowledge base lookups |
| `agent` | Orange | Sub-agent invocations, delegation |
| `chain` | Cyan | Chain/pipeline steps, sequential processing |
| `custom` | Gray | Anything else |

---

## Architecture

```
pathlight/
├── apps/
│   └── web/              # Next.js 15 dashboard (port 3100)
│       └── src/
│           ├── app/
│           │   ├── page.tsx                # Trace list + real-time stream
│           │   ├── traces/[id]/page.tsx    # Trace detail, waterfall, inspector
│           │   ├── traces/compare/page.tsx # Side-by-side trace diff
│           │   └── commits/page.tsx        # Per-commit regression view
│           ├── components/
│           │   ├── TopNav.tsx              # Sticky horizontal nav
│           │   ├── BreakpointsPanel.tsx    # Floating badge + slide-out editor
│           │   └── Fix/                    # "Fix this" dialog — button, form, key picker,
│           │                               # SSE stream, diff preview, apply/download/copy,
│           │                               # bisect banner
│           └── lib/
│               ├── api.ts                  # Collector fetch helpers
│               ├── diff.ts                 # LCS line-diff utility
│               └── format.ts               # Duration / token / timestamp formatters
├── packages/
│   ├── collector/        # Hono-based trace collector (port 4100)
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── traces.ts        # CRUD + SSE stream + /commits aggregate
│   │       │   ├── spans.ts         # Span CRUD
│   │       │   ├── projects.ts      # Project CRUD
│   │       │   ├── breakpoints.ts   # Live breakpoint register/wait/resume/SSE
│   │       │   ├── replay.ts        # LLM replay proxy (OpenAI + Anthropic)
│   │       │   ├── otlp.ts          # OTLP/HTTP ingest (gen_ai.* mapping)
│   │       │   ├── fix.ts           # POST /v1/fix — SSE wrapper around @pathlight/fix
│   │       │   ├── fix-apply.ts     # POST /v1/fix-apply — git apply a diff locally
│   │       │   └── keys.ts          # BYOK key CRUD (mounted only when PATHLIGHT_SEAL_KEY is set)
│   │       ├── events.ts            # Trace EventEmitter for SSE fan-out
│   │       ├── breakpoints.ts       # In-memory breakpoint registry
│   │       └── router.ts            # CORS + route mounting
│   ├── db/               # Drizzle ORM + SQLite (builds to dist/)
│   │   ├── drizzle/                 # Migrations (shipped with runtime)
│   │   └── src/
│   │       ├── schema.ts            # traces, spans, events, projects, scores
│   │       ├── retire.ts            # db:retire command
│   │       └── index.ts
│   ├── sdk/              # TypeScript SDK — @pathlight/sdk
│   │   └── src/index.ts             # Pathlight, Trace, Span, breakpoint()
│   ├── sdk-python/       # Python SDK — pathlight on PyPI
│   │   ├── src/pathlight/
│   │   │   ├── client.py            # Pathlight / AsyncPathlight classes
│   │   │   ├── git.py               # Auto git-context capture
│   │   │   └── _source.py           # Stack-walk source location
│   │   └── tests/                   # pytest + pytest-httpx
│   ├── eval/             # Assertion DSL + pathlight-eval CLI
│   │   ├── bin/pathlight-eval.js
│   │   ├── examples/
│   │   └── src/index.ts             # expect() matchers, evaluate()
│   ├── cli/              # pathlight CLI (subcommand router)
│   │   ├── bin/pathlight.js
│   │   └── src/
│   │       ├── commands/share.ts    # pathlight share <trace-id>
│   │       ├── commands/fix.ts      # pathlight fix <trace-id> — path/git/bisect modes
│   │       └── viewer-template.ts   # Self-contained HTML viewer
│   ├── fix/              # Code-fixing agent core — @pathlight/fix
│   │   └── src/
│   │       ├── index.ts             # fix() entry + composition
│   │       ├── types.ts             # FixOptions / FixResult / FixMode / FixProgress
│   │       ├── source/{path,git}.ts # SourceReader implementations
│   │       ├── llm/{anthropic,openai}.ts  # BYOK adapters behind a shared interface
│   │       ├── bisect.ts            # O(log N) regression search
│   │       ├── prompt.ts            # Trace + source → LLM messages; PROPOSE_FIX_TOOL schema
│   │       ├── diff-parser.ts       # Tool-call → parsed unified diff
│   │       └── secrets.ts           # Token/key redaction for error paths
│   ├── keys/             # BYOK encrypted key storage — @pathlight/keys (internal)
│   │   ├── LEAK-AUDIT.md            # Per-release security checklist
│   │   └── src/
│   │       ├── seal.ts              # libsodium crypto_secretbox primitives
│   │       ├── seal-key.ts          # PATHLIGHT_SEAL_KEY loader (fail-stop on missing)
│   │       ├── store.ts             # KeyStore: create/list/rotate/revoke/resolveSecret
│   │       └── resolver.ts          # SecretResolver adapter for /v1/fix
│   └── openclaw-plugin/  # OpenClaw tracing plugin — @pathlight/openclaw
│       └── src/
│           ├── index.ts             # definePluginEntry wiring
│           ├── hooks/               # trace-envelope, llm, tool, delegation
│           └── state.ts             # Per-run state (trace + in-flight spans)
├── Dockerfile.collector  # Multi-stage build; migrations run on boot
├── Dockerfile.web        # Next.js 15 standalone runtime
├── docker-compose.yml    # Collector + dashboard + SQLite volume
├── .github/workflows/
│   ├── ci.yml            # Node + Python tests on every PR
│   ├── docker.yml        # Publish GHCR images on push to master
│   ├── publish-python.yml  # PyPI release on py-v* tag
│   └── ...
└── CHANGELOG.md
```

---

## Data model

| Entity | Description |
| --- | --- |
| **Trace** | A complete agent execution. Status, input/output, duration, tokens, cost, `git_commit`/`git_branch`/`git_dirty`, `reviewed_at`. |
| **Span** | A single step within a trace. Types: llm, tool, retrieval, agent, chain, custom. Nests via `parent_span_id`. |
| **Event** | Point-in-time annotation within a span (logs, decisions, errors). Severity levels. |
| **Project** | Groups traces; has an API key for SDK auth. |
| **Score** | Quality annotation on a trace or span (human or auto). |

---

## API reference

### Traces

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/traces` | GET | List traces; filter by `status`, `name`, `projectId`; paginate with `limit`, `offset` |
| `/v1/traces` | POST | Create a trace. Accepts `gitCommit`, `gitBranch`, `gitDirty` |
| `/v1/traces/stream` | GET | SSE stream of `trace.created` / `trace.updated` / `ping` |
| `/v1/traces/commits` | GET | Per-commit aggregate stats (see [git-regressions docs](docs/git-regressions.md)) |
| `/v1/traces/:id` | GET | Get trace with all spans, events, scores |
| `/v1/traces/:id` | PATCH | Update (status, output, duration, `reviewedAt`) |
| `/v1/traces/:id` | DELETE | Delete trace and all related rows |

### Spans

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/spans` | POST | Create a span |
| `/v1/spans/:id` | PATCH | Update (status, output, tokens, cost, toolResult) |
| `/v1/spans/:id/events` | POST | Log an event |

### Breakpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/breakpoints` | POST | Register + block until resumed or timed out (default 15m). Returns `{ state }` |
| `/v1/breakpoints` | GET | List active breakpoints |
| `/v1/breakpoints/:id/resume` | POST | Resume with optional `{ state }` override |
| `/v1/breakpoints/:id/cancel` | POST | Reject the waiting SDK call with 408 |
| `/v1/breakpoints/stream` | GET | SSE: `snapshot`, `added`, `resolved`, `cancelled`, `ping` |

### Replay

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/replay/llm` | POST | Proxy LLM call. Body: `{ provider, model, messages, system?, apiKey?, baseUrl?, temperature?, maxTokens? }` |

### OpenTelemetry ingest

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/otlp/traces` | POST | OTLP/HTTP JSON ingest. Accepts `resourceSpans[...]`. Maps `gen_ai.*` attributes to Pathlight fields. See [OTel docs](docs/opentelemetry.md). |

### Fix engine

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/fix` | POST | Run `@pathlight/fix` against a failing trace. Response is `text/event-stream` with `progress` / `chunk` / `result` / `error` / `done` events. Resolves `keyId`/`tokenId` via the BYOK key store. See [docs/fix.md](docs/fix.md). |
| `/v1/fix-apply` | POST | Write a unified diff to a local working tree via `git apply`. Body: `{ sourceDir, diff }`. Runs `git apply --check` first. |

### BYOK key storage

Only mounted when `PATHLIGHT_SEAL_KEY` is set. See [docs/byok-keys.md](docs/byok-keys.md).

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/projects/:id/keys` | GET | List keys — masked metadata only |
| `/v1/projects/:id/keys` | POST | Create a key: `{ kind, provider, label, value }` |
| `/v1/projects/:id/keys/:keyId` | PUT | Atomically rotate |
| `/v1/projects/:id/keys/:keyId` | DELETE | Revoke immediately |

### Projects

| Endpoint | Method | Description |
| --- | --- | --- |
| `/v1/projects` | GET | List projects |
| `/v1/projects` | POST | Create a project (returns API key) |

### Health

| Endpoint | Method | Description |
| --- | --- | --- |
| `/health` | GET | Liveness probe |

---

## SDK reference

### `new Pathlight(config)`

```typescript
const tl = new Pathlight({
  baseUrl: "http://localhost:4100",
  projectId: "my-project",        // optional
  apiKey: "tl_…",                  // optional
  disableGitContext: false,        // opt out of auto git capture
});
```

### `tl.trace(name, input?, options?)`

```typescript
const trace = tl.trace("agent-name", inputData, {
  tags: ["production", "v2"],
  metadata: { userId: "123" },
});

await trace.end({ output: result });
// or
await trace.end({ status: "failed", error: "…" });
```

### `trace.span(name, type, options?)`

```typescript
const span = trace.span("step-name", "llm", {
  model: "gpt-4o",
  provider: "openai",
  input: { prompt: "…" },
  toolName: "search",          // for tool spans
  toolArgs: { query: "…" },    // for tool spans
});

await span.end({
  output: result,
  inputTokens: 100,
  outputTokens: 200,
  cost: 0.003,
  toolResult: { …: … },        // for tool spans
});

await span.event("decision", { choice: "retry" }, "info");
```

Source location (file, line, function) is captured automatically.

### `tl.breakpoint(options)`

```typescript
const state = await tl.breakpoint({
  label: "post-retrieval",
  state: { docs, query },
  timeoutMs: 15 * 60_000,   // default: 15 minutes
});
// If the dashboard edited `state`, the returned value reflects the edit.
```

See [docs/breakpoints.md](docs/breakpoints.md).

---

## Automatic source mapping

The SDK walks the stack on every `trace.span(...)` call and captures the
first frame outside `@pathlight/sdk` and `node_modules`. The file, line,
column, and function name get stored in `span.metadata._source` and render
as a clickable breadcrumb in the dashboard.

This means zero instrumentation config — the waterfall always knows exactly
where in your code each step was created.

---

## Issue detection

The collector enriches every trace list response with per-row issue flags:

- **Span failed** — `span.status === "failed"`
- **Span error** — `span.error` is set
- **Suspicious output** — regex matches `\bfail\b`, `failed`, `error`,
  `exception`, `timeout`, `invalid`, `denied`, `refused`, `rejected`,
  `incomplete`, `truncat`

Traces with any issue get an amber **Issues detected** badge on the list and
individual amber-highlighted rows in the waterfall.

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `file:pathlight.db` | SQLite or Turso URL |
| `DATABASE_AUTH_TOKEN` | — | Turso auth token |
| `PORT` | `4100` | Collector port |
| `NEXT_PUBLIC_COLLECTOR_URL` | `http://localhost:4100` | Collector URL (browser) |
| `PATHLIGHT_URL` | `http://localhost:4100` | Collector URL for CLI (`pathlight`, `pathlight-eval`) |
| `REPLAY_API_KEY` | — | Generic server-side key for `/v1/replay/llm` — works with OpenAI, Anthropic, or any OpenAI-compatible gateway |
| `REPLAY_BASE_URL` | — | Base URL for OpenAI-compatible replay (e.g. `https://gateway.provara.xyz`). Accepts with or without trailing `/v1` |
| `OPENAI_API_KEY` | — | Fallback key when `REPLAY_API_KEY` isn't set and provider is OpenAI-compatible |
| `ANTHROPIC_API_KEY` | — | Fallback key when `REPLAY_API_KEY` isn't set and provider is Anthropic |
| `PATHLIGHT_SEAL_KEY` | — | 32-byte base64 master key for the BYOK encrypted key store. When set, the collector mounts `/v1/projects/:id/keys`. Fail-stops on malformed input. |
| `PATHLIGHT_LLM_API_KEY` | — | BYOK LLM key consumed by `pathlight fix`. Required for the CLI. |
| `PATHLIGHT_GIT_TOKEN` | — | Read-only git token consumed by `pathlight fix --git-url`. Never logged. |

---

## Commands

```bash
# Docker (recommended)
docker compose up -d                   # Pull + start everything
docker compose down                    # Stop (data preserved in volume)
docker compose down -v                 # Stop + wipe data
docker compose pull && docker compose up -d   # Upgrade to latest images

# Local dev (monorepo)
npx turbo dev                          # Collector + web together
npx turbo build                        # Build all packages
npx turbo test                         # Run the full test suite
npm run dev -w packages/collector      # Collector only (4100)
npm run dev -w apps/web                # Web only (3100)

# Database (local dev — Docker handles migrations automatically)
npm run db:generate -w packages/db                 # Generate Drizzle migration
DATABASE_URL="file:$(pwd)/packages/collector/pathlight.db" \
  npm run db:migrate -w packages/db               # Apply migrations
npm run db:studio -w packages/db                   # Open Drizzle Studio
npm run db:retire -w packages/db -- ../collector/pathlight.db  # Archive
npm run db:retire -w packages/db -- --delete ../collector/pathlight.db  # Delete

# CLIs (after install)
pathlight share <trace-id> --out report.html
pathlight-eval specs/my-checks.mjs --base-url http://localhost:4100

# Code-fixing agent (BYOK)
export PATHLIGHT_LLM_API_KEY=sk-ant-...
pathlight fix <trace-id> --source-dir . --apply
pathlight fix <trace-id> --git-url https://github.com/acme/repo.git --provider openai
pathlight fix <trace-id> --bisect --from <good> --to <bad> --git-url <url>
```

---

## Tech stack

- **Collector**: [Hono](https://hono.dev) — lightweight, fast
- **Dashboard**: [Next.js 15](https://nextjs.org) + [Tailwind CSS](https://tailwindcss.com)
- **Database**: SQLite via [Drizzle ORM](https://orm.drizzle.team) (libSQL-compatible; Turso-ready)
- **Monorepo**: [Turborepo](https://turbo.build) + npm workspaces
- **Streaming**: Server-sent events (native `EventSource` + `hono/streaming`)

---

## Self-hosted philosophy

Everything runs locally by default. SQLite file, single collector process,
no external services required. API keys (for replay and BYOK fix) read from
env vars, from the browser's `localStorage`, or from the encrypted
libsodium-backed key store — never sent to any third-party beyond the LLM
provider itself.

**BYOK is a hard line.** The code-fixing agent, LLM replay, and OpenClaw
plugin all use the user's own keys. Pathlight never acts as an inference
proxy and never stores plaintext keys at rest.

## License

MIT
