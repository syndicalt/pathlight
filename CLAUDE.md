# Pathlight

Visual debugging, execution traces, and observability for AI agents.

See `README.md` for the user-facing overview, `CHANGELOG.md` for a
feature-by-feature history, and `docs/` for per-feature deep-dives.

## Architecture

Turborepo monorepo with npm workspaces:

- `packages/collector` — Hono-based trace collector API on port 4100.
  Receives traces/spans/events, serves SSE streams, proxies LLM replays,
  hosts the in-memory breakpoint registry, runs the `POST /v1/fix` SSE
  wrapper, and mounts BYOK `/v1/projects/:id/keys` (only when
  `PATHLIGHT_SEAL_KEY` is set).
- `packages/db` — Drizzle ORM + SQLite. Schema: traces, spans, events,
  projects, scores, api_keys. Traces carry `git_commit`/`git_branch`/`git_dirty`
  and `reviewed_at`. `api_keys` holds libsodium-sealed BYOK secrets.
- `packages/sdk` — TypeScript SDK for instrumenting agents. Auto-captures
  source locations + git context. Exposes `tl.breakpoint()` for live
  debugging.
- `packages/eval` — `@pathlight/eval` assertion DSL and `pathlight-eval`
  CI runner.
- `packages/cli` — `@pathlight/cli` with two subcommands: `pathlight share`
  (single-file HTML trace snapshot) and `pathlight fix` (BYOK code-fixing
  agent with path/git/bisect modes).
- `packages/sdk-python` — `pathlight` on PyPI. Sync + async clients,
  context managers, full feature parity with the TS SDK.
- `packages/fix` — `@pathlight/fix` code-fixing agent core. `fix()` reads
  a failing trace, pulls source files via `_source.file` metadata, runs
  a BYOK LLM (Anthropic or OpenAI), returns a unified diff. Supports
  path / git / bisect source modes. See [docs/fix.md](docs/fix.md).
- `packages/keys` — `@pathlight/keys` encrypted key storage (internal).
  libsodium `crypto_secretbox_easy`; plaintext never stored. Security
  invariants tracked in `packages/keys/LEAK-AUDIT.md`. See
  [docs/byok-keys.md](docs/byok-keys.md).
- `packages/openclaw-plugin` — `@pathlight/openclaw` OpenClaw plugin.
  Hooks `before_agent_start`/`agent_end`, LLM I/O, tool calls, and
  sub-agent delegation into Pathlight traces. See
  [docs/openclaw-plugin.md](docs/openclaw-plugin.md).
- `apps/web` — Next.js + Tailwind dashboard (port 3100). Routes: `/`
  (list), `/traces/[id]` (detail + side-by-side inspector + **Fix this**
  dialog), `/traces/compare` (diff), `/commits` (regression view),
  `/settings/keys` (BYOK key management).
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

# Code-fixing agent (BYOK)
export PATHLIGHT_LLM_API_KEY=sk-ant-...
pathlight fix <trace-id> --source-dir . --apply
pathlight fix <trace-id> --git-url <url> --provider openai
pathlight fix <trace-id> --bisect --from <good> --to <bad> --git-url <url>
```

## Key data model

- **Trace** — A complete agent execution. Status, input/output, duration,
  tokens, cost, git provenance, `reviewedAt`.
- **Span** — A single step. Types: llm, tool, retrieval, agent, chain,
  custom. Nests via `parentSpanId`. Auto-captured `metadata._source =
  { file, line, column, func }` powers fix-engine file inference.
- **Event** — Point-in-time annotation within a span (logs, decisions,
  errors).
- **Score** — Quality annotation on a trace or span.
- **Project** — Groups traces; has an API key for SDK auth.
- **ApiKey** — BYOK LLM/git secret, per project. Ciphertext + masked
  preview only; plaintext never stored or returned.

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

## Fix-engine usage

```typescript
import { fix } from "@pathlight/fix";

const result = await fix({
  traceId: "trc_xxx",
  collectorUrl: "http://localhost:4100",
  source: { kind: "path", dir: "/abs/path" },        // or { kind: "git", ... }
  llm: { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY! },
  mode: { kind: "span" },                            // "span" | "trace" | "bisect"
});
// result.diff, result.explanation, result.filesChanged
// result.regressionSha (bisect only)
```

## Notable UI conventions

- **Top nav** (`apps/web/src/components/TopNav.tsx`) — sticky horizontal
  header with logo, version, right-aligned page links (Traces, Commits,
  Settings). Replaces the old fixed left sidebar.
- **Span inspector** — side-by-side with the timeline when a span is
  selected. Timeline narrows to `0.8fr`; inspector takes `1.2fr` and is
  sticky. **"Fix this" button** appears on failed spans (driven by the
  `spanHasIssues` heuristic).
- **Fix dialog** (`apps/web/src/components/Fix/`) — modal with phase state
  machine (`idle → streaming → done | error`). Streams `/v1/fix` SSE via
  the POST-capable client at `apps/web/src/lib/sse.ts`. Renders unified
  diff in a roll-our-own viewer (no react-diff-viewer dep).
- **Breakpoints panel** (`BreakpointsPanel.tsx`) — globally mounted in
  `layout.tsx`. Auto-opens on new breakpoint arrival.
- **Settings pages** (`/settings/*`) — add/manage BYOK keys; masked
  display only, plaintext inaccessible after creation.

## BYOK security invariants

See `packages/keys/LEAK-AUDIT.md` for the per-release checklist. Short version:

1. Plaintext is NEVER stored — every write goes through `seal()`.
2. Plaintext is NEVER logged — `console.*`, errors, traces, responses.
3. Endpoints NEVER return plaintext — `POST` returns masked metadata;
   the only plaintext-return path is internal `resolveSecret` for
   outbound LLM calls.
4. `PATHLIGHT_SEAL_KEY` is required — fail-stop on missing/malformed.
5. Cross-project access returns `null` (same shape as not-found).

The fix-engine follows the same rules: `FixError.cause` is non-enumerable,
error messages are scrubbed via `makeRedactor()` before any write, and the
`fix.engine` meta-trace carries only metadata (lengths, token counts) —
never the diff body, explanation text, API key, or git token.

## Conventions

- Commit messages use `feat(#N):` / `fix(#N):` / `refactor(web):` style.
- Shiplog workflow: each feature gets an `issue/N-slug` branch and PR.
- Keep the collector DB migrated (`DATABASE_URL` must point at
  `packages/collector/pathlight.db` for CLI migrations). Docker handles
  this automatically on container boot.
- Workspace packages `@pathlight/db`, `@pathlight/sdk`, `@pathlight/eval`,
  `@pathlight/cli`, `@pathlight/fix`, `@pathlight/keys`,
  `@pathlight/openclaw` all compile to `dist/` via `tsc`. **Don't**
  switch any of them back to `main: ./src/*.ts` — it breaks production
  `node` execution (only works under `tsx`).
- Empty directories aren't tracked by git. If a new empty dir needs to
  exist for Docker COPY to work, add a `.gitkeep` (see `apps/web/public/`).
- BYOK is a hard line. The code-fixing agent, LLM replay, and OpenClaw
  plugin all use the user's own keys; Pathlight never acts as an
  inference proxy.
