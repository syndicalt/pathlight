# Eventloom visualizer

Pathlight can render Eventloom's Capture, Replay, and Handoff model when a
trace carries Eventloom's visualizer contract. This is a Pathlight-side view
over normal trace data; Eventloom still owns the append-only JSONL log,
deterministic replay, and handoff summary.

## What it shows

When present, the trace detail page displays an **Eventloom** panel above
the generic trace input/output blocks:

- **Capture** shows ordered Eventloom facts, actors, event summaries, event
  ids, and event type counts.
- **Replay** shows hash-chain integrity, projection hash, projection state,
  and integrity errors when replay detects them.
- **Handoff** shows active and completed tasks, model/tool/reasoning
  telemetry, verification evidence, observability gaps, and next actions.

The regular Pathlight waterfall remains available below the panel. Use the
waterfall for spans, durations, model/tool calls, and span-level inspection;
use the Eventloom panel for event-sourced runtime state.

## Contract

Eventloom exports a versioned display contract in trace metadata:

```json
{
  "visualizer": {
    "version": "eventloom.pathlight.visualizer.v1",
    "outputPath": "visualizer",
    "panels": [
      { "id": "capture", "title": "Capture", "outputPath": "visualizer.capture" },
      { "id": "replay", "title": "Replay", "outputPath": "visualizer.replay" },
      { "id": "handoff", "title": "Handoff", "outputPath": "visualizer.handoff" }
    ]
  }
}
```

The trace output must include:

```json
{
  "visualizer": {
    "capture": {},
    "replay": {},
    "handoff": {}
  }
}
```

Pathlight only renders the panel when both conditions are true:

- `trace.metadata.visualizer.version` is
  `eventloom.pathlight.visualizer.v1`.
- `trace.output.visualizer` has `capture`, `replay`, and `handoff` keys.

If either field is missing, the trace detail page falls back to the normal
Pathlight view.

## Local smoke flow

Start Pathlight:

```bash
docker compose up -d
```

Or, for local development:

```bash
npm run dev -w packages/collector
npm run dev -w apps/web
```

From an Eventloom checkout, generate and export a trace:

```bash
npm run eventloom -- run software-work /tmp/eventloom-pathlight-viz.jsonl
npm run eventloom -- export pathlight /tmp/eventloom-pathlight-viz.jsonl \
  --base-url http://localhost:4100 \
  --trace-name eventloom-pathlight-viz
```

Open the Pathlight dashboard at <http://localhost:3100>, then open the
`eventloom-pathlight-viz` trace. The Eventloom panel should appear above
Trace Input and Trace Output.

## Troubleshooting

- **No Eventloom panel appears.** Inspect the raw trace metadata and output.
  The metadata contract and `output.visualizer` object must both be present.
- **Capture appears but replay looks wrong.** Check
  `visualizer.replay.integrity`. Integrity failures usually mean the source
  JSONL log was edited, truncated, or reordered.
- **Handoff has observability gaps.** Add model, tool, reasoning, and
  verification events to the Eventloom log before export.

