# @pathlight/collector

Hono-based HTTP API that ingests traces from the SDK, persists them to
SQLite via Drizzle, and serves the dashboard. Runs on port **4100** by
default.

## Run

```bash
# From repo root
npm run dev -w packages/collector

# Or via turbo, alongside the web dashboard
npx turbo dev
```

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4100` | HTTP port |
| `DATABASE_URL` | `file:pathlight.db` | SQLite path or Turso URL |
| `DATABASE_AUTH_TOKEN` | — | Turso auth token |
| `OPENAI_API_KEY` | — | Server-side fallback for `/v1/replay/llm` |
| `ANTHROPIC_API_KEY` | — | Server-side fallback for `/v1/replay/llm` |

The collector reads `.env` from the repo root on startup (via `dotenv`).

## Routes

Mounted in `src/router.ts`:

- `/v1/traces` — trace CRUD, SSE stream, commit aggregates
  ([trace routes](src/routes/traces.ts))
- `/v1/spans` — span CRUD + event logging ([span routes](src/routes/spans.ts))
- `/v1/projects` — project CRUD ([project routes](src/routes/projects.ts))
- `/v1/breakpoints` — live breakpoint registry + SSE
  ([breakpoint routes](src/routes/breakpoints.ts))
- `/v1/replay/llm` — OpenAI/Anthropic proxy ([replay routes](src/routes/replay.ts))
- `/health` — liveness

Full route and response reference in the [main README](../../README.md#api-reference).

## Design notes

### SSE over long-poll

The trace stream uses SSE (`hono/streaming`) because the dashboard benefits
from server-push. The breakpoint API uses long-polling on
`POST /v1/breakpoints` (blocks until resume) because the SDK side wants a
single HTTP round-trip with no event-loop complexity.

### In-memory vs. persisted state

Traces/spans/events/scores live in SQLite. Breakpoints are **in-memory
only** — they die with the process, which is the correct lifetime. A
breakpoint the SDK is waiting on across a collector restart will time out
cleanly (default 15m).

### CORS

Currently `origin: "*"` — the collector is a dev tool meant to run on
localhost alongside the developer's browser. Harden this before exposing
the collector on a public network.

## Files

```
src/
├── index.ts              # Server entrypoint — dotenv, migrations, Hono serve
├── router.ts             # CORS + route mounting
├── events.ts             # Trace EventEmitter for SSE fan-out
├── breakpoints.ts        # In-memory breakpoint registry
├── middleware/           # (currently empty — reserved)
└── routes/
    ├── traces.ts         # List, get, create, update, delete, /stream, /commits
    ├── spans.ts          # Span CRUD, event logging
    ├── projects.ts       # Project CRUD
    ├── breakpoints.ts    # Register + wait, resume, cancel, SSE stream
    └── replay.ts         # LLM replay proxy (OpenAI-compatible + Anthropic)
```
