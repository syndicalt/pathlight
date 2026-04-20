"""Unit tests for the sync Pathlight client."""
from __future__ import annotations

import json
import pytest
from pytest_httpx import HTTPXMock

from pathlight import Pathlight, GitContext


BASE = "http://localhost:4100"


def test_strips_trailing_slash_from_base_url(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)

    pl = Pathlight(base_url=f"{BASE}/", disable_git_context=True)
    trace = pl.trace("t")
    assert trace.id == "t1"


def test_authorization_header_when_api_key_set(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)

    pl = Pathlight(base_url=BASE, api_key="secret", disable_git_context=True)
    pl.trace("t")

    req = httpx_mock.get_requests()[0]
    assert req.headers.get("authorization") == "Bearer secret"


def test_disable_git_context_omits_fields(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)

    pl = Pathlight(base_url=BASE, disable_git_context=True)
    pl.trace("t")

    body = json.loads(httpx_mock.get_requests()[0].content)
    assert "gitCommit" not in body
    assert "gitBranch" not in body
    assert "gitDirty" not in body


def test_explicit_git_context_forwarded(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)

    pl = Pathlight(
        base_url=BASE,
        git=GitContext(commit="abc", branch="main", dirty=False),
    )
    pl.trace("t")

    body = json.loads(httpx_mock.get_requests()[0].content)
    assert body["gitCommit"] == "abc"
    assert body["gitBranch"] == "main"
    assert body["gitDirty"] is False


def test_project_id_forwarded(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)

    pl = Pathlight(base_url=BASE, project_id="proj_42", disable_git_context=True)
    pl.trace("t")

    body = json.loads(httpx_mock.get_requests()[0].content)
    assert body["projectId"] == "proj_42"


def test_trace_accumulates_tokens_and_cost(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/spans", json={"id": "s1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/spans", json={"id": "s2"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/spans/s1", json={}, status_code=200)
    httpx_mock.add_response(url=f"{BASE}/v1/spans/s2", json={}, status_code=200)
    httpx_mock.add_response(url=f"{BASE}/v1/traces/t1", json={}, status_code=200)

    pl = Pathlight(base_url=BASE, disable_git_context=True)
    trace = pl.trace("t")
    trace.span("s1", type="llm").end(input_tokens=100, output_tokens=50, cost=0.002)
    trace.span("s2", type="llm").end(input_tokens=20, output_tokens=10, cost=0.001)
    trace.end(output="done")

    trace_patch = [r for r in httpx_mock.get_requests() if r.method == "PATCH" and r.url.path == "/v1/traces/t1"]
    body = json.loads(trace_patch[-1].content)
    assert body["totalTokens"] == 180
    assert body["totalCost"] == pytest.approx(0.003, rel=1e-5)


def test_trace_status_failed_on_error(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/traces/t1", json={}, status_code=200)

    pl = Pathlight(base_url=BASE, disable_git_context=True)
    trace = pl.trace("t")
    trace.end(error="boom")

    patch = [r for r in httpx_mock.get_requests() if r.method == "PATCH"][0]
    body = json.loads(patch.content)
    assert body["status"] == "failed"
    assert body["error"] == "boom"


def test_context_manager_closes_on_success(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/traces/t1", json={}, status_code=200)

    with Pathlight(base_url=BASE, disable_git_context=True) as pl:
        with pl.trace("t"):
            pass

    patches = [r for r in httpx_mock.get_requests() if r.method == "PATCH"]
    assert len(patches) == 1
    assert json.loads(patches[0].content)["status"] == "completed"


def test_context_manager_marks_failed_on_exception(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/traces/t1", json={}, status_code=200)

    pl = Pathlight(base_url=BASE, disable_git_context=True)
    with pytest.raises(ValueError):
        with pl.trace("t"):
            raise ValueError("blew up")

    patch = [r for r in httpx_mock.get_requests() if r.method == "PATCH"][0]
    body = json.loads(patch.content)
    assert body["status"] == "failed"
    assert "blew up" in body["error"]


def test_breakpoint_returns_override_state(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(
        url=f"{BASE}/v1/breakpoints",
        json={"id": "bp_1", "resumed": True, "state": {"edited": True}},
        status_code=200,
    )
    pl = Pathlight(base_url=BASE, disable_git_context=True)
    result = pl.breakpoint(label="test", state={"edited": False})
    assert result == {"edited": True}


def test_breakpoint_falls_back_on_408(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/breakpoints", json={}, status_code=408)
    pl = Pathlight(base_url=BASE, disable_git_context=True)
    result = pl.breakpoint(label="t", state={"original": True})
    assert result == {"original": True}


def test_breakpoint_falls_back_on_server_error(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/breakpoints", json={}, status_code=500)
    pl = Pathlight(base_url=BASE, disable_git_context=True)
    result = pl.breakpoint(label="t", state="hello")
    assert result == "hello"


def test_span_sends_token_and_cost_fields(httpx_mock: HTTPXMock) -> None:
    httpx_mock.add_response(url=f"{BASE}/v1/traces", json={"id": "t1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/spans", json={"id": "s1"}, status_code=201)
    httpx_mock.add_response(url=f"{BASE}/v1/spans/s1", json={}, status_code=200)
    httpx_mock.add_response(url=f"{BASE}/v1/traces/t1", json={}, status_code=200)

    pl = Pathlight(base_url=BASE, disable_git_context=True)
    trace = pl.trace("t")
    span = trace.span("s", type="llm", model="gpt-4o", provider="openai")
    span.end(input_tokens=7, output_tokens=3, cost=0.001)
    trace.end()

    span_patch = [r for r in httpx_mock.get_requests() if r.method == "PATCH" and "/spans/" in r.url.path][0]
    body = json.loads(span_patch.content)
    assert body["inputTokens"] == 7
    assert body["outputTokens"] == 3
    assert body["cost"] == 0.001
