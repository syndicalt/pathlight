from __future__ import annotations

import asyncio
import importlib.util
import logging
import os
import sys
from typing import Any

from aiohttp import web
from server import PromptServer

WEB_DIRECTORY = "./pathlight_support.disabled/web"

COLLECTOR_URL_ENV = "PATHLIGHT_COLLECTOR_URL"
API_KEY_ENV = "PATHLIGHT_API_KEY"
AUTO_EXPORT_ENV = "PATHLIGHT_COMFYUI_AUTO_EXPORT"

_LOGGER = logging.getLogger("pathlight.comfyui")
_PATCHED = False
_EXPORTS: dict[str, dict[str, Any]] = {}


def _load_exporter():
    exporter_path = os.path.join(os.path.dirname(__file__), "pathlight_support.disabled", "exporter.py")
    spec = importlib.util.spec_from_file_location("pathlight_comfyui_exporter", exporter_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load Pathlight exporter from {exporter_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["pathlight_comfyui_exporter"] = module
    spec.loader.exec_module(module)
    return module


_EXPORTER = _load_exporter()


class PathlightConfig:
    CATEGORY = "Pathlight"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("collector_url",)
    FUNCTION = "run"
    OUTPUT_NODE = False

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    def run(self):
        _patch_prompt_queue()
        return (_collector_url(),)


NODE_CLASS_MAPPINGS = {
    "PathlightConfig": PathlightConfig,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PathlightConfig": "Pathlight Config",
}


def _collector_url() -> str:
    return os.environ.get(COLLECTOR_URL_ENV, "http://127.0.0.1:4100")


def _api_key() -> str | None:
    return os.environ.get(API_KEY_ENV)


def _auto_export_enabled() -> bool:
    value = os.environ.get(AUTO_EXPORT_ENV, "1").lower()
    return value not in {"0", "false", "off", "no"}


def _history_for_prompt(prompt_id: str) -> dict[str, Any]:
    return PromptServer.instance.prompt_queue.get_history(prompt_id=prompt_id)


def _remember_export(prompt_id: str, result: Any) -> None:
    _EXPORTS[prompt_id] = {
        "promptId": prompt_id,
        "traceId": result.trace_id,
        "spanCount": len(result.span_ids),
        "status": result.status,
        "error": result.error,
    }


async def _export_prompt(prompt_id: str, trace_name: str | None = None) -> dict[str, Any]:
    history = _history_for_prompt(prompt_id)
    if not history:
        raise web.HTTPNotFound(text=f"No ComfyUI history found for prompt_id {prompt_id}")

    result = await asyncio.to_thread(
        _EXPORTER.export_history_to_pathlight,
        history,
        _collector_url(),
        _api_key(),
        trace_name,
    )
    _remember_export(prompt_id, result)
    _LOGGER.info("Exported ComfyUI prompt %s to Pathlight trace %s", prompt_id, result.trace_id)
    return _EXPORTS[prompt_id]


def _patch_prompt_queue() -> None:
    global _PATCHED
    if _PATCHED:
        return

    server = getattr(PromptServer, "instance", None)
    queue = getattr(server, "prompt_queue", None)
    if queue is None:
        _LOGGER.warning("Pathlight ComfyUI auto-export deferred; prompt queue is not ready")
        return

    original_task_done = queue.task_done

    def task_done_with_pathlight(item_id, history_result, status, process_item=None):
        original_task_done(item_id, history_result, status, process_item)
        if not _auto_export_enabled():
            return

        try:
            prompt_id = next(reversed(queue.history.keys()))
            asyncio.run_coroutine_threadsafe(
                _export_prompt(prompt_id, trace_name=f"ComfyUI workflow {prompt_id}"),
                server.loop,
            )
        except Exception:
            _LOGGER.exception("Failed to schedule Pathlight ComfyUI export")

    queue.task_done = task_done_with_pathlight
    _PATCHED = True
    _LOGGER.info("Pathlight ComfyUI auto-export is %s", "enabled" if _auto_export_enabled() else "disabled")


@PromptServer.instance.routes.get("/pathlight/comfyui/config")
async def get_config(_request):
    _patch_prompt_queue()
    return web.json_response(
        {
            "collectorUrl": _collector_url(),
            "autoExport": _auto_export_enabled(),
            "hasApiKey": _api_key() is not None,
            "exports": _EXPORTS,
        }
    )


@PromptServer.instance.routes.get("/pathlight/comfyui/exports")
async def get_exports(_request):
    _patch_prompt_queue()
    return web.json_response(_EXPORTS)


@PromptServer.instance.routes.post("/pathlight/comfyui/export/{prompt_id}")
async def post_export(request):
    _patch_prompt_queue()
    prompt_id = request.match_info["prompt_id"]
    body = await request.json() if request.can_read_body else {}
    trace_name = body.get("traceName") if isinstance(body, dict) else None
    result = await _export_prompt(prompt_id, trace_name=trace_name)
    return web.json_response(result)


@PromptServer.instance.routes.get("/pathlight/comfyui/preview/{prompt_id}")
async def get_preview(request):
    _patch_prompt_queue()
    prompt_id = request.match_info["prompt_id"]
    history = _history_for_prompt(prompt_id)
    if not history:
        raise web.HTTPNotFound(text=f"No ComfyUI history found for prompt_id {prompt_id}")
    return web.json_response(_EXPORTER.build_trace_plan(history))


_patch_prompt_queue()
