"""Unit tests for the git context module."""
from __future__ import annotations

import subprocess
from unittest.mock import patch

from pathlight import git as git_mod


def test_returns_none_when_git_missing(monkeypatch) -> None:
    git_mod.reset_cache()

    def raise_fnf(*_args, **_kwargs):
        raise FileNotFoundError("no git")

    with patch.object(subprocess, "run", side_effect=raise_fnf):
        assert git_mod.detect() is None


def test_caches_between_calls(monkeypatch) -> None:
    git_mod.reset_cache()

    def fake_run(args, **_kwargs):
        mapping = {
            ("git", "rev-parse", "HEAD"): "deadbeef\n",
            ("git", "rev-parse", "--abbrev-ref", "HEAD"): "main\n",
            ("git", "status", "--porcelain"): "M foo.py\n",
        }
        return subprocess.CompletedProcess(args=args, returncode=0, stdout=mapping[tuple(args)], stderr="")

    with patch.object(subprocess, "run", side_effect=fake_run) as mocked:
        first = git_mod.detect()
        second = git_mod.detect()

    assert first == second
    assert first.commit == "deadbeef"
    assert first.branch == "main"
    assert first.dirty is True
    # First call issues three subprocess invocations; second call should reuse cache.
    assert mocked.call_count == 3


def test_clean_working_tree_dirty_false(monkeypatch) -> None:
    git_mod.reset_cache()

    def fake_run(args, **_kwargs):
        mapping = {
            ("git", "rev-parse", "HEAD"): "abc123\n",
            ("git", "rev-parse", "--abbrev-ref", "HEAD"): "master\n",
            ("git", "status", "--porcelain"): "\n",  # just whitespace → clean
        }
        return subprocess.CompletedProcess(args=args, returncode=0, stdout=mapping[tuple(args)], stderr="")

    with patch.object(subprocess, "run", side_effect=fake_run):
        ctx = git_mod.detect()
    assert ctx is not None
    assert ctx.dirty is False
