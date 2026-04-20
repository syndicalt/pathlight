"""Pathlight Python SDK.

Usage::

    from pathlight import Pathlight

    pl = Pathlight(base_url="http://localhost:4100")

    with pl.trace("research-agent", input={"query": "..."}) as trace:
        with trace.span("classify", type="llm", model="gpt-4o") as s:
            result = call_model(...)
            s.end(output=result, input_tokens=50, output_tokens=10)
        trace.end(output=final_answer)
"""
from __future__ import annotations

from .client import Pathlight, Trace, Span, AsyncPathlight, AsyncTrace, AsyncSpan
from .git import GitContext

__all__ = [
    "Pathlight",
    "Trace",
    "Span",
    "AsyncPathlight",
    "AsyncTrace",
    "AsyncSpan",
    "GitContext",
]

__version__ = "0.2.0"
