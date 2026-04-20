# Real-time dashboard

The trace list updates live — new traces and status changes appear without
refreshing. Open a side channel by standing up an agent in one terminal and
the dashboard in another; traces stream into the list as they're created.

## How it works

### Collector

`GET /v1/traces/stream` opens a server-sent events (SSE) connection.
Internally it plugs into a process-wide `EventEmitter` (`traceEvents` in
`packages/collector/src/events.ts`). Every `POST /v1/traces` and
`PATCH /v1/traces/:id` emits on this bus, which is then fanned out to all
connected SSE subscribers.

Events:

| Event | Payload |
| --- | --- |
| `trace.created` | Full trace row with `issues: []` and `hasIssues` stub |
| `trace.updated` | Full trace row (same shape) |
| `ping` | Empty payload every 25s to keep the connection alive |

The payload is intentionally the raw DB row — the dashboard layers in richer
issue enrichment from its initial REST fetch.

### Dashboard

`apps/web/src/app/page.tsx` opens an `EventSource` on mount:

```tsx
const source = new EventSource(`${COLLECTOR_URL}/v1/traces/stream`);
source.addEventListener("trace.created", …);
source.addEventListener("trace.updated", …);
```

On `trace.created` it prepends the new row (if not already in state). On
`trace.updated` it merges fields while preserving the richer issue data from
the initial list fetch (SSE payloads don't re-enrich spans).

## Unreviewed highlighting

Every trace has a `reviewed_at` column. The list view renders a subtle
sky-blue left-border accent on traces where `reviewedAt === null`. Opening
a trace detail page auto-patches `reviewedAt = new Date().toISOString()` so
the highlight disappears on the next render.

This gives you a passive "inbox" — new runs stand out; anything you've
looked at fades back into the list.

## Reconnect behavior

The dashboard's SSE subscribers don't handle reconnect explicitly; the
browser's built-in `EventSource` retry is sufficient for collector restarts
during dev. The collector sends a `ping` every 25s as a keepalive.
