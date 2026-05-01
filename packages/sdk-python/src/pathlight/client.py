"""Core client classes: Pathlight, Trace, Span (+ async variants).

Mirrors the TypeScript SDK's surface with Pythonic affordances — context
managers, keyword-only arguments for end(), and async siblings.
"""
from __future__ import annotations

import time
from types import TracebackType
from typing import Any, Literal, Optional

import httpx

from ._source import capture as capture_source
from .git import detect as detect_git, GitContext

SpanType = Literal["llm", "tool", "retrieval", "agent", "chain", "custom"]
TraceStatus = Literal["running", "completed", "failed", "cancelled"]
SpanStatus = Literal["running", "completed", "failed"]


class PathlightHTTPError(RuntimeError):
    """Collector request failed with a non-2xx response."""

    def __init__(self, status_code: int, message: str, body: Any) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _parse_response(resp: httpx.Response) -> dict[str, Any]:
    body: Any
    if resp.content:
        try:
            body = resp.json()
        except ValueError:
            body = resp.text
    else:
        body = {}

    if resp.is_error:
        raise PathlightHTTPError(resp.status_code, _error_message(resp.status_code, body), body)

    return body if isinstance(body, dict) else {}


def _error_message(status_code: int, body: Any) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, str):
            return f"Pathlight collector error {status_code}: {error}"
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return f"Pathlight collector error {status_code}: {error['message']}"
    return f"Pathlight collector error {status_code}"


# ---------------------- sync ----------------------


class Pathlight:
    """Entry point for instrumenting an agent run.

    Parameters
    ----------
    base_url:
        Collector URL, e.g. ``http://localhost:4100``.
    project_id:
        Optional group for multi-project installations. Forwarded on every
        trace.
    api_key:
        Optional bearer token sent as ``Authorization: Bearer …``.
    disable_git_context:
        Skip auto-detection of commit/branch/dirty. Useful in sandboxed
        runtimes where ``git`` is unavailable or untrusted.
    git:
        Pass an explicit :class:`GitContext` to override auto-detection.
        Wins over auto-detect; respected even when ``disable_git_context`` is
        False.
    timeout:
        httpx client timeout in seconds. Default 10.
    """

    def __init__(
        self,
        *,
        base_url: str,
        project_id: str | None = None,
        api_key: str | None = None,
        disable_git_context: bool = False,
        git: GitContext | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._project_id = project_id
        self._api_key = api_key
        self._disable_git = disable_git_context
        self._git_override = git
        self._client = httpx.Client(base_url=self._base_url, timeout=timeout)

    # --- public ---

    def trace(
        self,
        name: str,
        *,
        input: Any = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> "Trace":
        """Start a new trace. Returns immediately; creation happens server-side."""
        return Trace(self, name=name, input=input, tags=tags, metadata=metadata)

    def breakpoint(
        self,
        *,
        label: str,
        state: Any = None,
        trace_id: str | None = None,
        span_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> Any:
        """Register a breakpoint and block until the dashboard resumes it.

        Returns the (possibly-modified) ``state`` the dashboard sent back.
        On timeout or network failure, falls back to ``state`` so agents
        don't hang forever.
        """
        payload: dict[str, Any] = {"label": label, "state": state}
        if trace_id is not None:
            payload["traceId"] = trace_id
        if span_id is not None:
            payload["spanId"] = span_id
        if timeout_ms is not None:
            payload["timeoutMs"] = timeout_ms

        try:
            # Long-poll — server holds the response until resume/timeout.
            # Use a bespoke timeout so httpx doesn't kill the request early.
            effective = (timeout_ms or 15 * 60_000) / 1000 + 5
            resp = self._client.post(
                "/v1/breakpoints",
                json=payload,
                headers=self._headers(),
                timeout=effective,
            )
            if resp.status_code == 408 or not resp.is_success:
                return state
            body = resp.json()
            return body.get("state", state)
        except httpx.HTTPError:
            return state

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "Pathlight":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()

    # --- internal ---

    def _headers(self) -> dict[str, str]:
        h = {"content-type": "application/json"}
        if self._api_key:
            h["authorization"] = f"Bearer {self._api_key}"
        return h

    def _git(self) -> GitContext | None:
        if self._git_override is not None:
            return self._git_override
        if self._disable_git:
            return None
        return detect_git()

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        resp = self._client.post(path, json=body, headers=self._headers())
        return _parse_response(resp)

    def _patch(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        resp = self._client.patch(path, json=body, headers=self._headers())
        return _parse_response(resp)


class Trace:
    """A single agent run. Hosts child spans."""

    def __init__(
        self,
        client: Pathlight,
        *,
        name: str,
        input: Any = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self._client = client
        self._start = time.perf_counter()
        self._total_tokens = 0
        self._total_cost = 0.0

        git = client._git()
        payload: dict[str, Any] = {"name": name, "projectId": client._project_id}
        if input is not None:
            payload["input"] = input
        if tags:
            payload["tags"] = tags
        if metadata is not None:
            payload["metadata"] = metadata
        if git is not None:
            payload["gitCommit"] = git.commit
            payload["gitBranch"] = git.branch
            payload["gitDirty"] = git.dirty

        result = client._post("/v1/traces", payload)
        self.id: str = result["id"]

    def span(
        self,
        name: str,
        *,
        type: SpanType = "custom",
        parent_span_id: str | None = None,
        model: str | None = None,
        provider: str | None = None,
        tool_name: str | None = None,
        tool_args: Any = None,
        input: Any = None,
        metadata: dict[str, Any] | None = None,
    ) -> "Span":
        return Span(
            self,
            name=name,
            type=type,
            parent_span_id=parent_span_id,
            model=model,
            provider=provider,
            tool_name=tool_name,
            tool_args=tool_args,
            input=input,
            metadata=metadata,
        )

    def _add(self, tokens: int, cost: float) -> None:
        self._total_tokens += tokens
        self._total_cost += cost

    def end(
        self,
        *,
        output: Any = None,
        status: TraceStatus | None = None,
        error: str | None = None,
    ) -> None:
        duration_ms = int((time.perf_counter() - self._start) * 1000)
        resolved_status = status or ("failed" if error else "completed")
        payload: dict[str, Any] = {
            "status": resolved_status,
            "totalDurationMs": duration_ms,
        }
        if output is not None:
            payload["output"] = output
        if error is not None:
            payload["error"] = error
        if self._total_tokens:
            payload["totalTokens"] = self._total_tokens
        if self._total_cost:
            payload["totalCost"] = self._total_cost
        self._client._patch(f"/v1/traces/{self.id}", payload)

    def __enter__(self) -> "Trace":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc is not None:
            self.end(status="failed", error=str(exc))
        else:
            # Only auto-close if user didn't call end() explicitly.
            try:
                self.end()
            except httpx.HTTPError:
                pass


class Span:
    """A single step inside a trace."""

    def __init__(
        self,
        trace: Trace,
        *,
        name: str,
        type: SpanType,
        parent_span_id: str | None = None,
        model: str | None = None,
        provider: str | None = None,
        tool_name: str | None = None,
        tool_args: Any = None,
        input: Any = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self._trace = trace
        self._client = trace._client
        self._start = time.perf_counter()

        meta = dict(metadata or {})
        src = capture_source()
        if src is not None:
            meta["_source"] = {"file": src.file, "line": src.line, "func": src.func}

        payload: dict[str, Any] = {"traceId": trace.id, "name": name, "type": type}
        if parent_span_id:
            payload["parentSpanId"] = parent_span_id
        if model:
            payload["model"] = model
        if provider:
            payload["provider"] = provider
        if tool_name:
            payload["toolName"] = tool_name
        if tool_args is not None:
            payload["toolArgs"] = tool_args
        if input is not None:
            payload["input"] = input
        if meta:
            payload["metadata"] = meta

        result = self._client._post("/v1/spans", payload)
        self.id: str = result["id"]

    def event(
        self,
        name: str,
        *,
        body: Any = None,
        level: Literal["debug", "info", "warn", "error"] = "info",
    ) -> None:
        self._client._post(
            f"/v1/spans/{self.id}/events",
            {"name": name, "body": body, "level": level},
        )

    def end(
        self,
        *,
        output: Any = None,
        status: SpanStatus | None = None,
        error: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        cost: float | None = None,
        tool_result: Any = None,
    ) -> None:
        duration_ms = int((time.perf_counter() - self._start) * 1000)
        resolved_status = status or ("failed" if error else "completed")

        if input_tokens or output_tokens:
            self._trace._add(
                (input_tokens or 0) + (output_tokens or 0),
                cost or 0.0,
            )
        elif cost:
            self._trace._add(0, cost)

        payload: dict[str, Any] = {
            "status": resolved_status,
            "durationMs": duration_ms,
        }
        if output is not None:
            payload["output"] = output
        if error is not None:
            payload["error"] = error
        if input_tokens is not None:
            payload["inputTokens"] = input_tokens
        if output_tokens is not None:
            payload["outputTokens"] = output_tokens
        if cost is not None:
            payload["cost"] = cost
        if tool_result is not None:
            payload["toolResult"] = tool_result

        self._client._patch(f"/v1/spans/{self.id}", payload)

    def __enter__(self) -> "Span":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc is not None:
            self.end(status="failed", error=str(exc))
        else:
            try:
                self.end()
            except httpx.HTTPError:
                pass


# ---------------------- async ----------------------


class AsyncPathlight:
    """Async sibling of :class:`Pathlight`. All I/O is awaited."""

    def __init__(
        self,
        *,
        base_url: str,
        project_id: str | None = None,
        api_key: str | None = None,
        disable_git_context: bool = False,
        git: GitContext | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._project_id = project_id
        self._api_key = api_key
        self._disable_git = disable_git_context
        self._git_override = git
        self._client = httpx.AsyncClient(base_url=self._base_url, timeout=timeout)

    async def trace(
        self,
        name: str,
        *,
        input: Any = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> "AsyncTrace":
        return await AsyncTrace._create(
            self, name=name, input=input, tags=tags, metadata=metadata
        )

    async def breakpoint(
        self,
        *,
        label: str,
        state: Any = None,
        trace_id: str | None = None,
        span_id: str | None = None,
        timeout_ms: int | None = None,
    ) -> Any:
        payload: dict[str, Any] = {"label": label, "state": state}
        if trace_id is not None:
            payload["traceId"] = trace_id
        if span_id is not None:
            payload["spanId"] = span_id
        if timeout_ms is not None:
            payload["timeoutMs"] = timeout_ms

        try:
            effective = (timeout_ms or 15 * 60_000) / 1000 + 5
            resp = await self._client.post(
                "/v1/breakpoints", json=payload, headers=self._headers(), timeout=effective
            )
            if resp.status_code == 408 or not resp.is_success:
                return state
            body = resp.json()
            return body.get("state", state)
        except httpx.HTTPError:
            return state

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncPathlight":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        await self.close()

    def _headers(self) -> dict[str, str]:
        h = {"content-type": "application/json"}
        if self._api_key:
            h["authorization"] = f"Bearer {self._api_key}"
        return h

    def _git(self) -> GitContext | None:
        if self._git_override is not None:
            return self._git_override
        if self._disable_git:
            return None
        return detect_git()

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        resp = await self._client.post(path, json=body, headers=self._headers())
        return _parse_response(resp)

    async def _patch(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        resp = await self._client.patch(path, json=body, headers=self._headers())
        return _parse_response(resp)


class AsyncTrace:
    """Async sibling of :class:`Trace`."""

    def __init__(
        self,
        client: AsyncPathlight,
        *,
        id: str,
    ) -> None:
        self._client = client
        self.id = id
        self._start = time.perf_counter()
        self._total_tokens = 0
        self._total_cost = 0.0

    @classmethod
    async def _create(
        cls,
        client: AsyncPathlight,
        *,
        name: str,
        input: Any,
        tags: list[str] | None,
        metadata: dict[str, Any] | None,
    ) -> "AsyncTrace":
        git = client._git()
        payload: dict[str, Any] = {"name": name, "projectId": client._project_id}
        if input is not None:
            payload["input"] = input
        if tags:
            payload["tags"] = tags
        if metadata is not None:
            payload["metadata"] = metadata
        if git is not None:
            payload["gitCommit"] = git.commit
            payload["gitBranch"] = git.branch
            payload["gitDirty"] = git.dirty
        result = await client._post("/v1/traces", payload)
        return cls(client, id=result["id"])

    async def span(
        self,
        name: str,
        *,
        type: SpanType = "custom",
        parent_span_id: str | None = None,
        model: str | None = None,
        provider: str | None = None,
        tool_name: str | None = None,
        tool_args: Any = None,
        input: Any = None,
        metadata: dict[str, Any] | None = None,
    ) -> "AsyncSpan":
        return await AsyncSpan._create(
            self,
            name=name,
            type=type,
            parent_span_id=parent_span_id,
            model=model,
            provider=provider,
            tool_name=tool_name,
            tool_args=tool_args,
            input=input,
            metadata=metadata,
        )

    def _add(self, tokens: int, cost: float) -> None:
        self._total_tokens += tokens
        self._total_cost += cost

    async def end(
        self,
        *,
        output: Any = None,
        status: TraceStatus | None = None,
        error: str | None = None,
    ) -> None:
        duration_ms = int((time.perf_counter() - self._start) * 1000)
        resolved_status = status or ("failed" if error else "completed")
        payload: dict[str, Any] = {
            "status": resolved_status,
            "totalDurationMs": duration_ms,
        }
        if output is not None:
            payload["output"] = output
        if error is not None:
            payload["error"] = error
        if self._total_tokens:
            payload["totalTokens"] = self._total_tokens
        if self._total_cost:
            payload["totalCost"] = self._total_cost
        await self._client._patch(f"/v1/traces/{self.id}", payload)

    async def __aenter__(self) -> "AsyncTrace":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc is not None:
            await self.end(status="failed", error=str(exc))
        else:
            try:
                await self.end()
            except httpx.HTTPError:
                pass


class AsyncSpan:
    """Async sibling of :class:`Span`."""

    def __init__(
        self,
        trace: AsyncTrace,
        *,
        id: str,
    ) -> None:
        self._trace = trace
        self._client = trace._client
        self.id = id
        self._start = time.perf_counter()

    @classmethod
    async def _create(
        cls,
        trace: AsyncTrace,
        *,
        name: str,
        type: SpanType,
        parent_span_id: str | None,
        model: str | None,
        provider: str | None,
        tool_name: str | None,
        tool_args: Any,
        input: Any,
        metadata: dict[str, Any] | None,
    ) -> "AsyncSpan":
        meta = dict(metadata or {})
        src = capture_source()
        if src is not None:
            meta["_source"] = {"file": src.file, "line": src.line, "func": src.func}

        payload: dict[str, Any] = {"traceId": trace.id, "name": name, "type": type}
        if parent_span_id:
            payload["parentSpanId"] = parent_span_id
        if model:
            payload["model"] = model
        if provider:
            payload["provider"] = provider
        if tool_name:
            payload["toolName"] = tool_name
        if tool_args is not None:
            payload["toolArgs"] = tool_args
        if input is not None:
            payload["input"] = input
        if meta:
            payload["metadata"] = meta

        result = await trace._client._post("/v1/spans", payload)
        return cls(trace, id=result["id"])

    async def event(
        self,
        name: str,
        *,
        body: Any = None,
        level: Literal["debug", "info", "warn", "error"] = "info",
    ) -> None:
        await self._client._post(
            f"/v1/spans/{self.id}/events",
            {"name": name, "body": body, "level": level},
        )

    async def end(
        self,
        *,
        output: Any = None,
        status: SpanStatus | None = None,
        error: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        cost: float | None = None,
        tool_result: Any = None,
    ) -> None:
        duration_ms = int((time.perf_counter() - self._start) * 1000)
        resolved_status = status or ("failed" if error else "completed")

        if input_tokens or output_tokens:
            self._trace._add(
                (input_tokens or 0) + (output_tokens or 0), cost or 0.0
            )
        elif cost:
            self._trace._add(0, cost)

        payload: dict[str, Any] = {"status": resolved_status, "durationMs": duration_ms}
        if output is not None:
            payload["output"] = output
        if error is not None:
            payload["error"] = error
        if input_tokens is not None:
            payload["inputTokens"] = input_tokens
        if output_tokens is not None:
            payload["outputTokens"] = output_tokens
        if cost is not None:
            payload["cost"] = cost
        if tool_result is not None:
            payload["toolResult"] = tool_result

        await self._client._patch(f"/v1/spans/{self.id}", payload)

    async def __aenter__(self) -> "AsyncSpan":
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if exc is not None:
            await self.end(status="failed", error=str(exc))
        else:
            try:
                await self.end()
            except httpx.HTTPError:
                pass
