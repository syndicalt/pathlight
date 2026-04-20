"""Git-context capture.

Runs three git subprocesses the first time it's called in a process, caches
the result. Returns ``None`` when git is unavailable or the process isn't in
a checkout — callers should treat that as "no git context" rather than an
error.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
import subprocess


@dataclass(frozen=True)
class GitContext:
    """Snapshot of the git state that produced a trace."""

    commit: str
    branch: str
    dirty: bool


_cached: Optional[GitContext] | None = ...  # type: ignore[assignment]


def detect() -> Optional[GitContext]:
    """Return the git context for the current working directory, or None.

    Cached after first call — a process doesn't change commits on the fly.
    """
    global _cached
    if _cached is not ...:  # already computed (even if it's None)
        return _cached  # type: ignore[return-value]

    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        status = subprocess.run(
            ["git", "status", "--porcelain"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        _cached = GitContext(commit=commit, branch=branch, dirty=bool(status.strip()))
    except (subprocess.SubprocessError, FileNotFoundError):
        _cached = None

    return _cached  # type: ignore[return-value]


def reset_cache() -> None:
    """Reset the cached git context — primarily for tests."""
    global _cached
    _cached = ...  # type: ignore[assignment]
