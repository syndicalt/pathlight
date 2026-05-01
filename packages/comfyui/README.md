# @pathlight/comfyui

ComfyUI history exporter for Pathlight traces.

The package maps one ComfyUI workflow history item to one Pathlight trace.
Each prompt node becomes a `chain` span with node inputs, class type, output
metadata, and execution errors when ComfyUI reports them.

## CLI

```bash
npm --workspace @pathlight/comfyui run build
npx pathlight-comfyui --prompt-id <prompt-id> \
  --comfy-url http://127.0.0.1:8188 \
  --collector-url http://localhost:4100
```

For offline or repeatable tests, export a history response first and pass it
directly:

```bash
npx pathlight-comfyui \
  --history-file packages/comfyui/fixtures/history-success.json \
  --trace-name comfyui-pathlight-success \
  --collector-url http://localhost:4100
```

The package also includes `fixtures/history-error.json`, which intentionally
exports a failed trace. Use it when validating that Pathlight flags the
failing ComfyUI node and records the node error event:

```bash
npx pathlight-comfyui \
  --history-file packages/comfyui/fixtures/history-error.json \
  --trace-name comfyui-pathlight-error \
  --collector-url http://localhost:4100
```

Environment variables:

- `COMFYUI_URL`
- `PATHLIGHT_COLLECTOR_URL`
- `PATHLIGHT_API_KEY`

## Library

```ts
import { exportComfyHistoryToPathlight, fetchComfyHistory } from "@pathlight/comfyui";

const history = await fetchComfyHistory("http://127.0.0.1:8188", "prompt-id");
const result = await exportComfyHistoryToPathlight(history, {
  collectorUrl: "http://localhost:4100",
});

console.log(result.traceId);
```

The CLI works from ComfyUI history. The plugin below auto-exports completed
workflow history and preserves the submitted prompt graph so Pathlight can
render workflow nodes as timeline spans. A future plugin revision can emit
live node timing and artifacts as the workflow runs.

## ComfyUI plugin

The plugin uses a single-file ComfyUI custom node loader plus a support
directory. The support directory ends in `.disabled` so ComfyUI does not try
to import it as a second custom node package. Install it by copying both
`plugin/pathlight_plugin.py` and `plugin/pathlight_support.disabled/` into
ComfyUI's `custom_nodes` directory:

```bash
cp ~/Projects/Personal/pathlight/packages/comfyui/plugin/pathlight_plugin.py \
  ~/Projects/Personal/ComfyUI/custom_nodes/pathlight_plugin.py
rm -rf ~/Projects/Personal/ComfyUI/custom_nodes/pathlight
rm -rf ~/Projects/Personal/ComfyUI/custom_nodes/pathlight_support.disabled
cp -R ~/Projects/Personal/pathlight/packages/comfyui/plugin/pathlight_support.disabled \
  ~/Projects/Personal/ComfyUI/custom_nodes/pathlight_support.disabled
```

Restart ComfyUI after installing the plugin.

After restart, ComfyUI should expose a `Pathlight Status` node under the
`Pathlight` category and load the `pathlight.comfyui` frontend extension.
The status node is optional. Auto-export runs from the backend plugin even
when the node is not added to a workflow.

Configuration is environment-variable based:

- `PATHLIGHT_COLLECTOR_URL` defaults to `http://127.0.0.1:4100`
- `PATHLIGHT_API_KEY` is optional
- `PATHLIGHT_COMFYUI_AUTO_EXPORT` defaults to `1`; set it to `0` to disable
  automatic export after each workflow completes

Plugin routes:

- `GET /pathlight/comfyui/config` shows active config and recent exports
- `GET /pathlight/comfyui/exports` shows recent prompt-to-trace exports
- `GET /pathlight/comfyui/preview/{prompt_id}` previews the Pathlight trace
  plan without exporting
- `POST /pathlight/comfyui/export/{prompt_id}` exports one history item on
  demand
