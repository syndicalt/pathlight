from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class ExportResult:
    trace_id: str
    span_ids: list[str]
    status: str
    error: str | None


def build_trace_plan(history_envelope: dict[str, Any], trace_name: str | None = None) -> dict[str, Any]:
    prompt_id, history = _unwrap_history(history_envelope)
    nodes = _extract_nodes(history.get("prompt"))
    outputs = history.get("outputs") or {}
    failures = _extract_failures(((history.get("status") or {}).get("messages")) or [])
    failures_by_node: dict[str, list[dict[str, Any]]] = {}

    for failure in failures:
        node_id = failure.get("nodeId")
        if node_id:
            failures_by_node.setdefault(str(node_id), []).append(failure)

    spans = []
    for node_id in sorted(nodes.keys(), key=_node_sort_key):
        node = nodes[node_id]
        node_failures = failures_by_node.get(str(node_id), [])
        class_type = node.get("class_type") or "unknown"
        status = "failed" if node_failures else "completed"
        error = "; ".join(failure["message"] for failure in node_failures) or None
        spans.append(
            {
                "name": f"comfy.node.{class_type}",
                "type": "chain",
                "input": node.get("inputs") or {},
                "output": outputs.get(str(node_id)),
                "status": status,
                "error": error,
                "metadata": {
                    "source": "comfyui",
                    "exportKind": "workflow_node",
                    "promptId": prompt_id,
                    "nodeId": str(node_id),
                    "classType": class_type,
                    "title": ((node.get("_meta") or {}).get("title")),
                    "outputNode": str(node_id) in outputs,
                },
            }
        )

    status_data = history.get("status") or {}
    failed = status_data.get("completed") is False or len(failures) > 0
    status = "failed" if failed else "completed"
    error = "; ".join(failure["message"] for failure in failures) or None
    output_node_ids = list(outputs.keys())

    return {
        "trace": {
            "name": trace_name or f"ComfyUI workflow {prompt_id}",
            "input": {
                "promptId": prompt_id,
                "nodeCount": len(spans),
                "status": status_data.get("status_str"),
            },
            "metadata": {
                "source": "comfyui",
                "exportKind": "workflow_run",
                "promptId": prompt_id,
                "nodeCount": len(spans),
                "outputNodeIds": output_node_ids,
                "comfyStatus": status_data,
                "meta": history.get("meta"),
            },
            "tags": ["comfyui"],
        },
        "spans": spans,
        "output": {
            "promptId": prompt_id,
            "nodeCount": len(spans),
            "outputNodeIds": output_node_ids,
            "outputs": outputs,
            "status": status_data.get("status_str"),
            "completed": status_data.get("completed"),
            "failures": failures,
        },
        "status": status,
        "error": error,
    }


def export_history_to_pathlight(
    history_envelope: dict[str, Any],
    collector_url: str,
    api_key: str | None = None,
    trace_name: str | None = None,
    timeout_seconds: float = 10,
) -> ExportResult:
    plan = build_trace_plan(history_envelope, trace_name=trace_name)
    base_url = collector_url.rstrip("/")
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"

    trace = _request_json(
        "POST",
        f"{base_url}/v1/traces",
        {**plan["trace"], "status": "running"},
        headers,
        timeout_seconds,
    )
    trace_id = trace["id"]
    span_ids: list[str] = []

    for span in plan["spans"]:
        created = _request_json(
            "POST",
            f"{base_url}/v1/spans",
            {
                "traceId": trace_id,
                "name": span["name"],
                "type": span["type"],
                "input": span["input"],
                "metadata": span["metadata"],
            },
            headers,
            timeout_seconds,
        )
        span_id = created["id"]
        span_ids.append(span_id)

        if span.get("error"):
            _request_json(
                "POST",
                f"{base_url}/v1/spans/{span_id}/events",
                {
                    "name": "comfyui.node.error",
                    "level": "error",
                    "body": span["error"],
                    "metadata": span["metadata"],
                },
                headers,
                timeout_seconds,
            )

        _request_json(
            "PATCH",
            f"{base_url}/v1/spans/{span_id}",
            {
                "status": span["status"],
                "output": span.get("output"),
                "error": span.get("error"),
                "metadata": span["metadata"],
            },
            headers,
            timeout_seconds,
        )

    _request_json(
        "PATCH",
        f"{base_url}/v1/traces/{trace_id}",
        {
            "status": plan["status"],
            "output": plan["output"],
            "error": plan.get("error"),
            "metadata": plan["trace"]["metadata"],
        },
        headers,
        timeout_seconds,
    )

    return ExportResult(
        trace_id=trace_id,
        span_ids=span_ids,
        status=plan["status"],
        error=plan.get("error"),
    )


def _unwrap_history(history_envelope: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    if "prompt" in history_envelope or "outputs" in history_envelope or "status" in history_envelope:
        prompt_id = _prompt_id_from_history(history_envelope) or "unknown"
        return prompt_id, history_envelope

    if not history_envelope:
        raise ValueError("ComfyUI history response is empty")

    prompt_id = next(iter(history_envelope.keys()))
    history = history_envelope[prompt_id]
    if not isinstance(history, dict):
        raise ValueError(f"ComfyUI history entry {prompt_id} is not an object")
    return str(prompt_id), history


def _prompt_id_from_history(history: dict[str, Any]) -> str | None:
    prompt = history.get("prompt")
    if isinstance(prompt, list) and len(prompt) > 1:
        return str(prompt[1])
    return None


def _extract_nodes(prompt: Any) -> dict[str, dict[str, Any]]:
    if isinstance(prompt, list) and len(prompt) > 2 and isinstance(prompt[2], dict):
        source = prompt[2]
    elif isinstance(prompt, dict):
        source = prompt
    else:
        return {}

    nodes: dict[str, dict[str, Any]] = {}
    for node_id, node in source.items():
        if isinstance(node, dict):
            nodes[str(node_id)] = node
    return nodes


def _extract_failures(messages: list[Any]) -> list[dict[str, Any]]:
    failures = []
    for message in messages:
        kind = message[0] if isinstance(message, list) and len(message) > 0 else None
        payload = message[1] if isinstance(message, list) and len(message) > 1 else message
        payload = payload if isinstance(payload, dict) else {}
        kind_text = kind if isinstance(kind, str) else ""
        exception_message = payload.get("exception_message")
        message_text = payload.get("message")

        if "error" not in kind_text and not exception_message and not message_text:
            continue

        failures.append(
            {
                "nodeId": _string_or_none(payload.get("node_id") or payload.get("nodeId")),
                "message": str(exception_message or message_text or kind_text),
                "raw": message,
            }
        )
    return failures


def _request_json(
    method: str,
    url: str,
    body: dict[str, Any],
    headers: dict[str, str],
    timeout_seconds: float,
) -> dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Pathlight request failed: {method} {url} {error.code} {detail}") from error


def _node_sort_key(node_id: str) -> tuple[int, str]:
    try:
        return (int(node_id), node_id)
    except ValueError:
        return (10**12, node_id)


def _string_or_none(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)
