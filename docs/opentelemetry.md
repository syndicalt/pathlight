# OpenTelemetry interop

Pathlight's collector accepts standard OTLP/HTTP trace payloads, so any
OpenTelemetry-instrumented app can point at it without the Pathlight SDK.
This is the ingest half of the OTel story — the SDK-side emit half is
tracked separately in issue #25.

## Endpoint

```
POST /v1/otlp/traces
Content-Type: application/json
```

Body: standard OTLP/HTTP JSON (the shape
`@opentelemetry/exporter-trace-otlp-http` sends).

## Configure any OTel-compatible exporter

Point your existing OTel SDK at Pathlight:

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4100/v1/otlp/traces",
  }),
});
sdk.start();
```

That's it — your spans land in the Pathlight dashboard alongside
natively-instrumented traces.

## Attribute mapping

Pathlight follows the OpenTelemetry GenAI semantic conventions:

| OTel attribute | Pathlight field |
| --- | --- |
| `gen_ai.system` | `span.provider` |
| `gen_ai.request.model` | `span.model` |
| `gen_ai.usage.input_tokens` | `span.inputTokens` |
| `gen_ai.usage.output_tokens` | `span.outputTokens` |
| `gen_ai.usage.cost` | `span.cost` |
| `gen_ai.tool.name` | `span.toolName` |
| everything else | serialized into `span.metadata` |

Resource attributes contribute to the trace row:

| Resource attribute | Pathlight field |
| --- | --- |
| `service.name` | used as the trace `name` when the root span has none |
| `pathlight.git.commit` | `trace.gitCommit` |
| `pathlight.git.branch` | `trace.gitBranch` |

## Span type inference

Pathlight's span model has a discrete `type` field (llm, tool, retrieval,
agent, chain, custom). OTel spans don't — we infer from attributes and
`SpanKind`:

| Condition | Resulting Pathlight type |
| --- | --- |
| Any `gen_ai.*` attribute present | `llm` |
| `SpanKind === CLIENT` (3), no gen_ai | `tool` |
| Everything else | `custom` |

This is a first pass — refine with explicit `pathlight.type = "retrieval"`
attributes on a per-span basis if the defaults don't match your mental
model.

## Status

| OTel status code | Pathlight status |
| --- | --- |
| 2 (`error`) | `failed` |
| 0 / 1 / unset | `completed` |

The OTel status `message` (set via `span.recordException` and friends)
maps to Pathlight's `error` field.

## Trace identity

Pathlight uses the raw OTLP `trace_id` as its own primary key. Resending
the same `trace_id` is **idempotent** — existing rows get updated in
place, span parents preserved. This makes retry/replay safe and prevents
duplicates when a collector restarts mid-flush.

Span `span_id`s are similarly used as Pathlight span primary keys.

## Token + cost aggregation

The trace-level `totalTokens` and `totalCost` are summed from every span
in the trace. If your spans don't carry `gen_ai.usage.*` attributes,
Pathlight falls back to `null` — no totals will show in the dashboard.

## What isn't supported yet

- **OTLP/gRPC** — HTTP only. gRPC would require `@grpc/grpc-js` which we
  haven't added to the collector's dep graph. Track in a follow-up if
  it's needed.
- **OTel metrics** — the Pathlight data model doesn't have a metrics
  surface yet. Spans-only.
- **Events on spans** — OTel span-events aren't translated to Pathlight
  event rows yet. Planned.
- **SDK-side emit** — the Pathlight SDK doesn't push to OTel collectors
  (the reverse direction of this PR). Planned — see issue #25.

## Example: Claude Agent SDK → Pathlight via OTel

If you're using Anthropic's Agent SDK or any framework that emits OTel
spans with `gen_ai.*` conventions, configuring it to export to
`http://localhost:4100/v1/otlp/traces` surfaces every run in the
Pathlight dashboard with working LLM-span replay, git attribution,
and trace diff.
