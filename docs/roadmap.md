# Pathlight roadmap

This roadmap tracks high-value integration and product directions. It is not
a release commitment; items should graduate into issues or implementation
plans when they have clear acceptance criteria.

## Product Hardening

### Local-first safety and reliability

Status: planned.

This sprint turns the code review findings into product work. The goal is to
keep Pathlight easy to run locally while making its trust boundaries explicit
and reducing silent failure modes.

Why it matters:

- Pathlight currently behaves like a local developer tool, but the collector
  exposes powerful endpoints when it is reachable from a browser or network.
- The dashboard has a strong BYOK key-storage model for the fix flow, but the
  replay panel still stores provider keys in browser local storage.
- Several UI flows fail silently, which makes local debugging feel unreliable
  even when the collector and SDK are doing the right thing.
- Trace-list issue detection scans span output across each listed trace, which
  is acceptable for demos but will degrade as trace volume grows.

Recommended next order:

1. Add collector/dashboard bind-safety controls: default local usage, visible
   warnings for non-localhost exposure, and an optional shared dashboard token.
2. Replace replay-panel API-key localStorage with a BYOK-backed or session-only
   flow that matches the rest of the key-management story.
3. Improve SDK HTTP errors so JS and Python clients report status codes and
   sanitized response details instead of blindly parsing JSON.
4. Add visible dashboard error states for failed fetches, failed review
   updates, breakpoint stream disconnects, and fix/replay failures.
5. Move trace-list issue detection toward bounded queries or persisted issue
   summaries instead of scanning all spans for every listed trace.
6. Add focused frontend tests for trace loading, replay, fix streaming, trace
   compare alignment, and diff preview parsing.

Acceptance criteria:

- A user who binds Pathlight outside localhost receives an explicit warning
  and has a documented option to require a dashboard/collector token.
- Replay no longer persists raw provider keys in localStorage by default.
- SDK network and collector errors include the HTTP status and a sanitized
  message.
- Dashboard collector failures produce visible UI states instead of only
  logging to the browser console.
- The trace list can show issue badges without unbounded span-output scans.
- Critical dashboard flows have regression coverage.

## Integration Candidates

### ComfyUI tracing

Status: shipped as an initial plugin and CLI bridge.

Target Pathlight first, with Eventloom as a later companion for agent-driven
creative workflows.

Why it matters:

- ComfyUI is a large node-based generative AI engine and application with a
  graph workflow model, local API, custom nodes, cloud API, and MCP surface.
- ComfyUI users need to understand which node, model, prompt, seed, setting,
  custom node, or artifact caused a slow, broken, or changed run.
- ComfyUI workflows map naturally to Pathlight traces and spans.

Product shape:

- A ComfyUI workflow run maps to one Pathlight trace.
- Each ComfyUI node execution maps to a Pathlight span.
- Node inputs, prompts, seeds, sampler settings, model names, LoRAs,
  dimensions, and ControlNet or adapter settings map to span input and
  metadata.
- Generated image, video, audio, or 3D outputs map to span output,
  artifacts, or linked file metadata.
- Node failures and queue status map to span and trace status.

Implemented integration:

- `@pathlight/comfyui` can export saved or live ComfyUI history.
- The ComfyUI plugin auto-exports completed workflows to the Pathlight
  collector.
- Each workflow maps to one trace; each workflow node maps to one span.
- Node inputs, titles, outputs, prompt ids, queue status, and execution
  errors are attached to trace/span input, output, and metadata.
- The optional `Pathlight Status` node is a visible marker only; backend
  auto-export does not require adding it to the graph.

Eventloom fit:

Eventloom should come later, when an agent is orchestrating ComfyUI rather
than simply running a static graph. Eventloom can record why an agent chose
a prompt, model, seed, rerun, branch, approval, or final output. Pathlight
then shows what happened inside the ComfyUI graph.

Recommended next order:

1. Capture live ComfyUI execution events for real per-node timing.
2. Add artifact and generated-output previews/links.
3. Link back to the Pathlight trace from ComfyUI history or logs.
4. Add Eventloom decision journaling for agent-driven ComfyUI automation.

Shipped acceptance criteria:

- Provide a standalone bridge that can export ComfyUI `/history/{prompt_id}`
  output into Pathlight.
- Map one workflow run to one trace and each prompt node to one span.
- Mark node and trace failures from ComfyUI execution error messages.
- Keep the first bridge runnable against a live local ComfyUI instance and
  testable from a saved history JSON file.
