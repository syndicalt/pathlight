# ComfyUI tracing

Pathlight can trace ComfyUI workflows through the `@pathlight/comfyui`
package. The integration has two modes:

- A CLI/library exporter for saved ComfyUI history.
- A ComfyUI plugin that auto-exports completed workflows to the Pathlight
  collector.

Each ComfyUI workflow becomes one Pathlight trace. Each ComfyUI node becomes
a `chain` span with node inputs, class type, title metadata, output metadata,
and execution errors when ComfyUI reports them.

## Install the plugin

Copy the single-file loader and support directory into ComfyUI:

```bash
cp ~/Projects/Personal/pathlight/packages/comfyui/plugin/pathlight_plugin.py \
  ~/Projects/Personal/ComfyUI/custom_nodes/pathlight_plugin.py
rm -rf ~/Projects/Personal/ComfyUI/custom_nodes/pathlight
rm -rf ~/Projects/Personal/ComfyUI/custom_nodes/pathlight_support.disabled
cp -R ~/Projects/Personal/pathlight/packages/comfyui/plugin/pathlight_support.disabled \
  ~/Projects/Personal/ComfyUI/custom_nodes/pathlight_support.disabled
```

Restart ComfyUI after copying the files.

ComfyUI should then report `pathlight_plugin.py` in its custom-node import
timings. It should also expose an optional `Pathlight Status` node under the
`Pathlight` category. The node is only a visible status marker; auto-export
runs from the backend plugin even when the node is not added to a workflow.

## Configure

Configuration uses environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PATHLIGHT_COLLECTOR_URL` | `http://127.0.0.1:4100` | Pathlight collector URL |
| `PATHLIGHT_API_KEY` | unset | Optional collector API key |
| `PATHLIGHT_COMFYUI_AUTO_EXPORT` | `1` | Set to `0` to disable automatic export |

For local Pathlight, no API key is required.

## Verify

Check that ComfyUI registered the node and backend routes:

```bash
curl http://127.0.0.1:8188/object_info/PathlightStatus
curl http://127.0.0.1:8188/pathlight/comfyui/config
```

Run a ComfyUI workflow, then inspect recent exports:

```bash
curl http://127.0.0.1:8188/pathlight/comfyui/exports
```

Each export maps a ComfyUI prompt id to a Pathlight trace id.

## Manual export

The plugin can export a specific completed prompt:

```bash
curl -X POST http://127.0.0.1:8188/pathlight/comfyui/export/<prompt_id>
```

You can preview the Pathlight trace plan without exporting:

```bash
curl http://127.0.0.1:8188/pathlight/comfyui/preview/<prompt_id>
```

The package CLI can also export saved history:

```bash
npm --workspace @pathlight/comfyui run build
npx pathlight-comfyui \
  --prompt-id <prompt_id> \
  --comfy-url http://127.0.0.1:8188 \
  --collector-url http://127.0.0.1:4100
```

## Current limits

The plugin exports after ComfyUI records workflow history. Pathlight can show
the workflow nodes, inputs, outputs, status, and errors, but per-node timings
are synthetic until the plugin captures live ComfyUI execution events.
