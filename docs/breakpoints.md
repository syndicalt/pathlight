# Live breakpoints

`await tl.breakpoint(...)` pauses your agent mid-run until the dashboard
resumes it — optionally with edited state. It's `pdb` for agents.

## Minimal example

```typescript
import { Pathlight } from "@pathlight/sdk";

const tl = new Pathlight({ baseUrl: "http://localhost:4100" });

async function answer(query: string) {
  const docs = await retrieve(query);

  // Pause here; open the dashboard, inspect the state, maybe edit it.
  const { query: q, docs: d } = await tl.breakpoint({
    label: "post-retrieval",
    state: { query, docs },
  });

  return summarize(d, q);
}
```

Run the agent. When execution hits the breakpoint:

1. A floating amber pulse badge appears on the dashboard.
2. Click it to open the breakpoints panel.
3. Edit the JSON state (or leave as-is).
4. Click **Resume with edits** — your agent continues, with `q` / `d`
   reflecting any edits you made.

## SDK API

```typescript
tl.breakpoint<T>(options: {
  label: string;
  state?: T;
  traceId?: string;
  spanId?: string;
  timeoutMs?: number;
}): Promise<T>
```

- `label` (required) — shown in the dashboard list.
- `state` — anything JSON-serializable; the editor operates on this.
- `traceId` / `spanId` — optional back-references shown as clickable links
  in the panel.
- `timeoutMs` — default **15 minutes**. On timeout, the SDK returns the
  original `state` unmodified so the agent doesn't hang forever.

## Collector endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/breakpoints` | Register + long-poll. Responds when the breakpoint is resumed or cancelled |
| `GET /v1/breakpoints` | List currently-paused breakpoints |
| `POST /v1/breakpoints/:id/resume` | Resume with `{ state }` body |
| `POST /v1/breakpoints/:id/cancel` | Reject the SDK's waiting call with a 408 |
| `GET /v1/breakpoints/stream` | SSE: `snapshot`, `added`, `resolved`, `cancelled`, `ping` |

## Implementation notes

### In-memory registry

Breakpoints live in a `Map<id, Record>` on the collector with an
`EventEmitter` backbone (`packages/collector/src/breakpoints.ts`). No DB
persistence — breakpoints die with the process, which is the right
lifetime. A breakpoint the SDK is waiting on across a collector restart is
safely timed out.

### Long-polling, not websockets

`POST /v1/breakpoints` doesn't return until either `resume`, `cancel`, or
timeout. This keeps the SDK as one HTTP round-trip and avoids the complexity
of websockets / SSE in user code. The internal Promise resolver is stashed
on the in-memory record so `resume` can find and call it.

### Dashboard stream

The dashboard opens an SSE stream to `/v1/breakpoints/stream` in a persistent
layout component (`BreakpointsPanel.tsx`). On connect it gets a `snapshot`
with all active breakpoints, then `added` / `resolved` / `cancelled` events
keep the UI in sync across all open browser tabs.

## Patterns

### Conditional breakpoint

```typescript
if (totalCost > 0.50) {
  state = await tl.breakpoint({
    label: `expensive run: $${totalCost.toFixed(2)}`,
    state,
  });
}
```

### Skip to the last hop

```typescript
for (const step of plan) {
  await executeStep(step);
}
state = await tl.breakpoint({ label: "final-step", state });
await produceAnswer(state);
```

### Breakpoint guard around a deploy

Set `timeoutMs: 1000` so breakpoints auto-resume fast in prod, but use a
developer-time wrapper that raises the timeout during debugging sessions.

## Gotchas

- **Production use**: don't leave `tl.breakpoint()` calls in production code.
  They'll block for 15 minutes waiting for a dashboard that probably isn't
  connected. Use feature flags or dev-only guards.
- **JSON state**: whatever you pass must be JSON-serializable. Class
  instances, functions, and circular refs will lose fidelity on the round-
  trip.
- **Concurrent breakpoints**: multiple agents can pause at once and all
  appear in the dashboard panel — each is resolved independently.
