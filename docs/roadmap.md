# Pathlight roadmap

This roadmap tracks high-value integration and product directions. It is not
a release commitment; items should graduate into issues or implementation
plans when they have clear acceptance criteria.

## Integration Candidates

### ComfyUI tracing

Status: sprint 1 in progress.

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

Initial integration options:

- Build a `ComfyUI-Pathlight` custom node pack or server extension.
- Add configuration for the Pathlight collector URL.
- Start a trace when a workflow is queued or begins execution.
- Emit spans around node execution.
- Attach workflow JSON, prompt ids, model hashes, seeds, and output file
  paths where available.
- Link back to the Pathlight trace from ComfyUI history or logs.

Eventloom fit:

Eventloom should come later, when an agent is orchestrating ComfyUI rather
than simply running a static graph. Eventloom can record why an agent chose
a prompt, model, seed, rerun, branch, approval, or final output. Pathlight
then shows what happened inside the ComfyUI graph.

Recommended order:

1. Build Pathlight tracing for ComfyUI workflow/node execution.
2. Validate with a local workflow and at least one custom-node failure.
3. Add artifact and generated-output handling.
4. Add Eventloom decision journaling for agent-driven ComfyUI automation.

Sprint 1 acceptance criteria:

- Provide a standalone bridge that can export ComfyUI `/history/{prompt_id}`
  output into Pathlight.
- Map one workflow run to one trace and each prompt node to one span.
- Mark node and trace failures from ComfyUI execution error messages.
- Keep the first bridge runnable against a live local ComfyUI instance and
  testable from a saved history JSON file.
