"""Capture the caller's source location from the Python stack.

Mirrors the behavior of the TS SDK: walk up the stack, skip frames inside
``pathlight/`` and Python stdlib, return the first user-code frame's file,
line, and function name.
"""
from __future__ import annotations

import inspect
import os
from dataclasses import dataclass
from typing import Optional

_SDK_MARKER = os.sep + "pathlight" + os.sep
_STDLIB_HINTS = (os.sep + "python", os.sep + "site-packages" + os.sep)


@dataclass(frozen=True)
class SourceLocation:
    file: str
    line: int
    func: str


def capture() -> Optional[SourceLocation]:
    """Return the first user-code frame, or None if nothing looks user-level."""
    for frame_info in inspect.stack()[1:]:
        fname = frame_info.filename
        if _SDK_MARKER in fname:
            continue
        if fname.startswith("<") or any(h in fname for h in _STDLIB_HINTS):
            continue
        return SourceLocation(
            file=fname,
            line=frame_info.lineno,
            func=frame_info.function,
        )
    return None
