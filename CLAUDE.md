# Pathlight

Visual debugging, execution traces, and observability for AI agents.

## Architecture

Turborepo monorepo with npm workspaces:

- `packages/collector` — Hono-based trace collector API on port 4100. Receives traces, spans, and events from the SDK.
- `packages/db` — Drizzle ORM + SQLite. Schema: traces, spans, events, projects, scores.
- `packages/sdk` — TypeScript SDK for instrumenting agents. Sends trace data to the collector.
- `apps/web` — Next.js + Tailwind CSS dashboard for viewing and debugging traces.

## Commands

```bash
npx turbo dev               # Start collector + web concurrently
npm run dev -w packages/collector   # Collector only (port 4100)
npm run dev -w apps/web             # Web UI only (port 3100)

# Database
npm run db:generate -w packages/db   # Generate Drizzle migrations
npm run db:migrate -w packages/db    # Run migrations
npm run db:studio -w packages/db     # Open Drizzle Studio
npm run db:retire -w packages/db     # Archive database (rename to .archived-<timestamp>.db)
npm run db:retire -w packages/db -- --delete  # Permanently delete database
```

## Key Data Model

- **Trace** — A complete agent execution (one run). Has status, input/output, duration, total tokens/cost.
- **Span** — A single step within a trace (LLM call, tool use, decision). Supports nesting via parentSpanId. Types: llm, tool, retrieval, agent, chain, custom.
- **Event** — Point-in-time annotation within a span (logs, decisions, errors). Has severity levels.
- **Score** — Quality annotation on a trace or span (human or auto-generated).
- **Project** — Groups traces. Has an API key for SDK authentication.

## SDK Usage

```typescript
import { Pathlight } from "@pathlight/sdk";

const tl = new Pathlight({ baseUrl: "http://localhost:4100" });

const trace = tl.trace("my-agent", { query: "..." });
const span = trace.span("llm.chat", "llm", { model: "gpt-4o" });
// ... do work ...
span.end({ output: result, inputTokens: 100, outputTokens: 200 });
trace.end({ output: finalResult });
```
