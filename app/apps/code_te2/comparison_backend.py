"""Shared comparison selection and mode-aware editor baseline materialization."""
from __future__ import annotations

import asyncio
import hashlib
import time
from collections.abc import Callable
from pathlib import Path

from .stores import get_history_store, get_preferences_store
from .worker_services import git_service


def comparison_mode(project: str) -> str:
    prefs = get_preferences_store().get_preferences(project).get("editor", {})
    if not isinstance(prefs, dict):
        return "plain"
    if prefs.get("showDraftDiffs") and not prefs.get("autoSave"):
        return "disk"
    return "commit" if prefs.get("showInlineDiffs") else "plain"


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


async def handle_comparison_request(data: dict[str, object], source_client: str) -> dict[str, object]:
    from .explorer.services.state_facts import publish_git_diff_base_changed
    from .monaco_editor.editor_preferences_backend import handle_editor_preference_update_request
    from .monaco_editor.editor_ws import editor_runtime_active_project

    project = editor_runtime_active_project()
    if not project or data.get("projectPath") != project:
        raise ValueError("stale_project_path")
    ref = data.get("ref")
    if ref is not None:
        if not isinstance(ref, str) or not ref.strip():
            raise ValueError("invalid comparison ref")
        commit = await asyncio.to_thread(git_service.get_commit_info, Path(project), ref)
        if not commit:
            raise ValueError("comparison commit not found")
        if editor_runtime_active_project() != project:
            raise ValueError("stale_project_path")
        ref = "HEAD" if ref == "HEAD" else commit.hash
        get_history_store().set_diff_base(project, ref)
        await publish_git_diff_base_changed(project, ref=ref, refresh=True, source="host_comparison")
    mode = data.get("mode")
    if mode is not None:
        if editor_runtime_active_project() != project:
            raise ValueError("stale_project_path")
        if mode not in ("plain", "commit", "disk"):
            raise ValueError("invalid comparison mode")
        await handle_editor_preference_update_request(
            {"key": "comparisonMode", "value": mode}, source_client=source_client,
        )
    return await asyncio.to_thread(comparison_state, project, commits=data.get("commits") is True)
