"""Async client smoke tests — verifies the Async* siblings mirror the sync surface."""
from __future__ import annotations

import json
import pytest
from pytest_httpx import HTTPXMock

from pathlight import AsyncPathlight


BASE = "http://localhost:4100"


async def test_async_trace_round_trip(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/spans", json={"id": "s1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/spans/s1", json={}, status_code=200)
    httpx_mock.add_response(url=f"{BASE}/v1/traces/t1", json={}, status_code=200)

    async with AsyncPathlight(base_url=BASE, disable_git_context=True) as pl:
        trace = await pl.trace("agent")
        span = await trace.span("llm.chat", type="llm")
        await span.end(input_tokens=5, output_tokens=10, cost=0.001)
        await trace.end(output="done")

    trace_patch = [r for r in httpx_mock.get_requests() if r.method == "PATCH" and r.url.path == "/v1/traces/t1"][0]
    body = json.loads(trace_patch.content)
    assert body["totalTokens"] == 15
    assert body["status"] == "completed"


async def test_async_context_manager_marks_failed(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/traces/t1", json={}, status_code=200)

    async with AsyncPathlight(base_url=BASE, disable_git_context=True) as pl:
        trace = await pl.trace("agent")
        with pytest.raises(RuntimeError):
            async with trace:
                raise RuntimeError("kaboom")

    patch = [r for r in httpx_mock.get_requests() if r.method == "PATCH"][0]
    body = json.loads(patch.content)
    assert body["status"] == "failed"
    assert "kaboom" in body["error"]


async def test_async_breakpoint_returns_override(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        url=f"{BASE}/v1/breakpoints",
        json={"id": "bp", "resumed": True, "state": {"x": 42}},
        status_code=200,
    )
    async with AsyncPathlight(base_url=BASE, disable_git_context=True) as pl:
        result = await pl.breakpoint(label="t", state={"x": 1})
    assert result == {"x": 42}
