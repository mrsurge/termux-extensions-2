from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from ...open_state_backend import read_sidecar_open_state
from ...worker_services.git_service import GitCommit, GitStatus

JsonObject = dict[str, object]


class HistoryStoreLike(Protocol):
    def get_active_project(self) -> str | None: ...

    def get_diff_base(self, project_path: str | None) -> str: ...

    def get_last_file(self, project_path: str | None) -> str | None: ...

    def list_files(self, project_path: str) -> list[JsonObject]: ...


class PreferencesStoreLike(Protocol):
    def get_preferences(self, project_path: str | None = None) -> JsonObject: ...


@dataclass(frozen=True, slots=True)
class StatePayloadDeps:
    history: HistoryStoreLike
    preferences: PreferencesStoreLike
    set_project_root: Callable[[str], Path]
    is_git_repository: Callable[[Path], bool]
    get_commit_info: Callable[[Path, str], GitCommit | None]
    format_label: Callable[[str | None], str]


def resolve_diff_base(deps: StatePayloadDeps, project_path: str | None) -> str:
    base = deps.history.get_diff_base(project_path)
    return base.strip() if base else "HEAD"


def build_diff_base_payload(deps: StatePayloadDeps, project_path: str | None) -> JsonObject:
    base_ref = resolve_diff_base(deps, project_path)
    mode = "none"
    commit_info: JsonObject | None = None

    if project_path:
        root_path = Path(project_path)
        if root_path.exists() and deps.is_git_repository(root_path):
            mode = "head" if base_ref == "HEAD" else "detached"
            try:
                commit = deps.get_commit_info(root_path, base_ref)
            except Exception:
                commit = None
            if commit:
                commit_info = {
                    "hash": commit.hash,
                    "short": commit.short_hash,
                    "subject": commit.summary,
                    "author": commit.author,
                    "date": commit.date,
                }

    return {
        "ref": base_ref,
        "mode": mode,
        "commit": commit_info,
    }


def status_to_payload(status: GitStatus) -> JsonObject:
    return {
        "branch": status.branch,
        "detached": status.detached,
        "ahead": status.ahead,
        "behind": status.behind,
        "staged": status.staged,
        "unstaged": status.unstaged,
        "untracked": status.untracked,
    }


def get_runtime_metadata() -> JsonObject:
    """Collect worker runtime metadata for crash/session recovery."""
    return {
        "run_id": os.getenv("TE_RUN_ID", "unknown"),
        "shell_id": os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown"),
        "shell_run_id": os.getenv("TE_FRAMEWORK_SHELL_RUN_ID", "unknown"),
        "launcher_pid": int(os.getenv("TE_LAUNCHER_PID", "0")),
        "worker_pid": os.getpid(),
    }


def build_state_payload(deps: StatePayloadDeps) -> JsonObject:
    project_path = deps.history.get_active_project()
    project_exists = bool(project_path and Path(project_path).is_dir())
    project_label = deps.format_label(project_path)
    project_message = ""
    if not project_path:
        project_message = "No project selected."
    elif not project_exists:
        project_message = f'Project "{project_label or project_path}" not found.'
    else:
        # Keep the worker runtime root aligned with the active project state.
        try:
            _ = deps.set_project_root(project_path)
        except Exception:
            project_exists = False
            project_message = f'Project "{project_label or project_path}" not accessible.'

    last_file: str | None = None
    open_state_payload: JsonObject | None = None
    if project_path:
        try:
            open_state = read_sidecar_open_state(project_path, reason="sidecar_replay")
            open_state_payload = dict(open_state)
            open_file = open_state.get("openFile")
            last_file = open_file if isinstance(open_file, str) else None
        except Exception:
            last_file = None
    last_file_exists = bool(last_file and Path(last_file).is_file())
    last_file_label = deps.format_label(last_file)
    last_file_message = ""
    if last_file and not last_file_exists:
        last_file_message = f'File "{last_file_label or last_file}" not found.'

    recents_raw = deps.history.list_files(project_path) if project_path else []
    recents: list[JsonObject] = []
    for entry in recents_raw:
        entry_path = entry.get("path")
        entry_path_str = entry_path if isinstance(entry_path, str) else None
        exists = bool(entry_path_str and Path(entry_path_str).is_file())
        recents.append({
            "path": entry_path_str,
            "label": entry.get("label") or deps.format_label(entry_path_str),
            "opened_at": entry.get("opened_at"),
            "exists": exists,
            "scroll_line": entry.get("scroll_line"),
        })

    editor_prefs = deps.preferences.get_preferences(project_path)
    runtime_meta = get_runtime_metadata()
    diff_base_info = build_diff_base_payload(deps, project_path if project_exists else None)

    return {
        "activeProject": project_path,
        "activeProjectLabel": project_label,
        "activeProjectExists": project_exists,
        "activeProjectMessage": project_message,
        "lastFile": last_file,
        "currentPath": last_file,
        "openState": open_state_payload,
        "lastFileLabel": last_file_label,
        "lastFileExists": last_file_exists,
        "lastFileMessage": last_file_message,
        "recents": recents,
        "preferences": editor_prefs,
        "gitDiffBase": diff_base_info,
        "runtime": runtime_meta,
    }


def expand_and_validate_path(path: str, *, base_home: str | None = None) -> tuple[str | None, str | None]:
    home = os.path.expanduser(base_home or "~")
    expanded = os.path.normpath(os.path.expanduser(path))
    if not os.path.abspath(expanded).startswith(home):
        return None, "Access denied"
    return expanded, None
