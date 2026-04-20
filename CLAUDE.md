# Pathlight

Visual debugging, execution traces, and observability for AI agents.

See `README.md` for the user-facing overview, `CHANGELOG.md` for a
feature-by-feature history, and `docs/` for per-feature deep-dives.

## Architecture

Turborepo monorepo with npm workspaces:

- `packages/collector` — Hono-based trace collector API on port 4100.
  Receives traces/spans/events, serves SSE streams, proxies LLM replays,
  hosts the in-memory breakpoint registry.
- `packages/db` — Drizzle ORM + SQLite. Schema: traces, spans, events,
  projects, scores. Traces carry `git_commit`/`git_branch`/`git_dirty` and
  `reviewed_at`.
- `packages/sdk` — TypeScript SDK for instrumenting agents. Auto-captures
  source locations + git context. Exposes `tl.breakpoint()` for live
  debugging.
- `packages/eval` — `@pathlight/eval` assertion DSL and `pathlight-eval`
  CI runner.
- `packages/cli` — `@pathlight/cli` with `pathlight share` subcommand for
  exporting single-file HTML trace snapshots.
- `packages/sdk-python` — `pathlight` on PyPI. Sync + async clients,
  context managers, full feature parity with the TS SDK.
- `apps/web` — Next.js + Tailwind dashboard (port 3100). Routes: `/`
  (list), `/traces/[id]` (detail + side-by-side inspector), `/traces/compare`
  (diff), `/commits` (regression view).
- Root-level `Dockerfile.collector` + `Dockerfile.web` + `docker-compose.yml`
  ship the stack. GHCR publishes `ghcr.io/syndicalt/pathlight-{collector,web}`
  on every push to master.

## Commands

```bash
# Docker (single-command self-host)
docker compose up -d               # Pull + run both services
docker compose down -v             # Stop + wipe data

# Local dev
npx turbo dev                      # Start collector + web concurrently
npx turbo build                    # Build all packages
npx turbo test                     # Run the test suite
npm run dev -w packages/collector  # Collector only (port 4100)
npm run dev -w apps/web            # Web UI only (port 3100)

# Database (the collector's DB is at packages/collector/pathlight.db
# in local dev; in Docker it lives in the pathlight_data volume)
npm run db:generate -w packages/db
DATABASE_URL="file:$(pwd)/packages/collector/pathlight.db" \
  npm run db:migrate -w packages/db
npm run db:studio -w packages/db
npm run db:retire -w packages/db                          # Archive default DB
npm run db:retire -w packages/db -- ../collector/pathlight.db  # Archive specific
npm run db:retire -w packages/db -- --delete              # Delete instead

# CLIs
pathlight share <trace-id> --out ./snapshot.html
pathlight-eval specs/estimate.mjs --base-url http://localhost:4100
```

## Key data model

- **Trace** — A complete agent execution. Status, input/output, duration,
  tokens, cost, git provenance, `reviewedAt`.
- **Span** — A single step. Types: llm, tool, retrieval, agent, chain,
  custom. Nests via `parentSpanId`.
- **Event** — Point-in-time annotation within a span (logs, decisions,
  errors).
- **Score** — Quality annotation on a trace or span.
- **Project** — Groups traces; has an API key for SDK auth.

## SDK usage

```typescript
import { Pathlight } from "@pathlight/sdk";

const tl = new Pathlight({ baseUrl: "http://localhost:4100" });

const trace = tl.trace("my-agent", { query: "..." });
const span = trace.span("llm.chat", "llm", { model: "gpt-4o" });
// ... do work ...
span.end({ output: result, inputTokens: 100, outputTokens: 200 });
trace.end({ output: finalResult });

// Pause mid-run; dashboard resumes with optional state override.
const state = await tl.breakpoint({ label: "checkpoint", state: { foo } });
```

## Notable UI conventions

- **Top nav** (`apps/web/src/components/TopNav.tsx`) — sticky horizontal
  header with logo, version, right-aligned page links. Replaces the old
  fixed left sidebar.
- **Span inspector** — side-by-side with the timeline when a span is
  selected. Timeline narrows to `0.8fr`; inspector takes `1.2fr` and is
  sticky.
- **Breakpoints panel** (`BreakpointsPanel.tsx`) — globally mounted in
  `layout.tsx`. Auto-opens on new breakpoint arrival.

## Conventions

- Commit messages use `feat(#N):` / `fix(#N):` / `refactor(web):` style.
- Shiplog workflow: each feature gets an `issue/N-slug` branch and PR.
- Keep the collector DB migrated (`DATABASE_URL` must point at
  `packages/collector/pathlight.db` for CLI migrations). Docker handles
  this automatically on container boot.
- Workspace packages `@pathlight/db`, `@pathlight/sdk`, `@pathlight/eval`,
  `@pathlight/cli` all compile to `dist/` via `tsc`. **Don't** switch any
  of them back to `main: ./src/*.ts` — it breaks production `node`
  execution (only works under `tsx`).
- Empty directories aren't tracked by git. If a new empty dir needs to
  exist for Docker COPY to work, add a `.gitkeep` (see `apps/web/public/`).
