"""Shared comparison selection and mode-aware editor baseline materialization."""
from __future__ import annotations

import hashlib
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import cast

from .stores import get_history_store, get_preferences_store
from .worker_services import git_service


def comparison_mode(project: str) -> str:
    prefs = get_preferences_store().get_preferences(project).get("editor", {})
    if not isinstance(prefs, Mapping):
        return "plain"
    editor = cast(Mapping[str, object], prefs)
    if editor.get("showDraftDiffs") and not editor.get("autoSave"):
        return "disk"
    return "commit" if editor.get("showInlineDiffs") else "plain"


def comparison_state(project: str, *, commits: bool = False) -> dict[str, object]:
    from .explorer.services.git_diff_base import project_diff_base

    ref = get_history_store().get_diff_base(project) or "HEAD"
    snapshot = git_service.get_snapshot(Path(project))
    state: dict[str, object] = {
        "projectPath": project,
        "mode": comparison_mode(project),
        "diffBase": project_diff_base(Path(project), ref, snapshot),
    }
    if commits:
        state["commits"] = [
            {"hash": entry.hash, "short_hash": entry.short_hash, "summary": entry.summary}
            for entry in git_service.get_commits(Path(project), limit=50)
        ] if snapshot.get("isRepository") else []
    return state


def selected_baseline(project: str, path: str, read_disk_text: Callable[[str], str]) -> dict[str, object]:
    mode = comparison_mode(project)
    ref = get_history_store().get_diff_base(project) or "HEAD"
    revision = time.monotonic_ns() // 1000
    disk = read_disk_text(path)
    head = None
    commit_hash = None
    if mode == "commit":
        snapshot = git_service.get_snapshot(Path(project))
        commit = git_service.get_commit_info(Path(project), ref) if snapshot.get("isRepository") and snapshot.get("head") else None
        if commit:
            commit_hash = commit.hash
            rel = Path(path).relative_to(Path(project)).as_posix()
            head = git_service.read_head_blob_text(Path(project), rel, rev=commit.hash)
    if comparison_mode(project) != mode or (get_history_store().get_diff_base(project) or "HEAD") != ref:
        raise ValueError("stale_comparison")
    return {
        "projectPath": project, "path": path, "comparison_mode": mode,
        "comparison_revision": revision, "base_ref": ref if mode == "commit" else None,
        "base_commit": commit_hash, "tracked": head is not None,
        "disk_content": disk, "disk_sha256": hashlib.sha256(disk.encode()).hexdigest(),
        "head_content": head,
        "head_sha256": hashlib.sha256(head.encode()).hexdigest() if head is not None else None,
    }
