# pyright: strict
from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .state_payload import JsonObject
from ...open_state_backend import write_sidecar_open_file


class HistoryStoreLike(Protocol):
    def touch_project(self, project_path: str) -> JsonObject: ...

    def set_active_project(self, project_path: str) -> str | None: ...

    def get_active_project(self) -> str | None: ...

    def list_projects(self) -> list[JsonObject]: ...


@dataclass(frozen=True, slots=True)
class ProjectServiceDeps:
    history: HistoryStoreLike
    get_project_root: Callable[[], Path]
    set_project_root: Callable[[str], Path]
    invalidate_diff_cache: Callable[[Path], None]
    set_edit_tracker_project_root: Callable[[Path], None]
    close_active_terminal_sockets: Callable[[], Awaitable[None]]
    stop_diagnostics_bridge: Callable[[], None]
    terminate_adapter_shell: Callable[[], Awaitable[bool]]
    emit_sidebar_cwd_set: Callable[[str], Awaitable[None]]
    build_state_payload: Callable[[], JsonObject]
    create_project: Callable[[str, str], JsonObject]
    format_label: Callable[[str | None], str]
    get_sidecar_path: Callable[[str], Path]


async def _ignore_async_errors(fn: Callable[[], Awaitable[object | None]]) -> None:
    try:
        await fn()
    except Exception:
        pass


def _ignore_sync_errors(fn: Callable[[], object]) -> None:
    try:
        fn()
    except Exception:
        pass


def payload_string(payload: JsonObject, key: str) -> str | None:
    value = payload.get(key)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def normalize_history_project_path(path: str) -> str:
    try:
        expanded = os.path.expanduser(str(path))
        return os.path.abspath(expanded)
    except Exception:
        return str(path or "").strip()


def _resolve_project_file_target(project_root: Path, file_target: str) -> str:
    raw = str(file_target or "").strip()
    if not raw:
        raise ValueError("invalid_file_target")
    candidate = Path(raw).expanduser() if os.path.isabs(raw) else project_root / raw
    try:
        resolved_root = project_root.expanduser().resolve(strict=False)
        resolved_file = candidate.expanduser().resolve(strict=False)
        resolved_file.relative_to(resolved_root)
    except ValueError as exc:
        raise PermissionError("outside_project") from exc
    return str(resolved_file)


async def after_project_switch(deps: ProjectServiceDeps, *, reason: str) -> None:
    await _ignore_async_errors(deps.close_active_terminal_sockets)
    _ignore_sync_errors(deps.stop_diagnostics_bridge)
    await _ignore_async_errors(deps.terminate_adapter_shell)
    await _ignore_async_errors(lambda: deps.emit_sidebar_cwd_set(reason))


def _history_entry_for_path(deps: ProjectServiceDeps, normalized_path: str) -> JsonObject | None:
    for entry in deps.history.list_projects():
        entry_path = entry.get("path")
        entry_path_str = entry_path if isinstance(entry_path, str) else None
        if entry_path_str == normalized_path:
            return dict(entry)
    return None


def _lookup_reason(
    *,
    has_entry: bool,
    sidecar_exists: bool,
    directory_exists: bool,
) -> str | None:
    if not has_entry:
        return "not_in_history"
    if not sidecar_exists:
        return "sidecar_missing"
    if not directory_exists:
        return "path_missing"
    return None


def lookup_project(deps: ProjectServiceDeps, path: str) -> JsonObject:
    normalized_path = normalize_history_project_path(path)
    if not normalized_path:
        return {
            "ok": True,
            "known": False,
            "reason": "invalid_path",
            "project": None,
        }

    entry = _history_entry_for_path(deps, normalized_path)
    active_project = deps.history.get_active_project()
    directory_exists = Path(normalized_path).is_dir()
    sidecar_path = deps.get_sidecar_path(normalized_path)
    sidecar_exists = sidecar_path.exists()
    reason = _lookup_reason(
        has_entry=entry is not None,
        sidecar_exists=sidecar_exists,
        directory_exists=directory_exists,
    )

    label_obj = entry.get("label") if entry is not None else None
    label = label_obj if isinstance(label_obj, str) and label_obj else deps.format_label(normalized_path)
    opened_at = entry.get("opened_at") if entry is not None else None
    project: JsonObject = {
        "path": normalized_path,
        "label": label,
        "opened_at": opened_at,
        "is_active": bool(active_project and active_project == normalized_path),
        "directory_exists": directory_exists,
        "sidecar": {
            "exists": sidecar_exists,
            "path": str(sidecar_path),
        },
    }

    return {
        "ok": True,
        "known": reason is None,
        "reason": reason,
        "project": project,
    }


async def open_project(
    deps: ProjectServiceDeps,
    path: str,
    *,
    require_known_sidecar: bool,
    reason: str,
    file_target: str | None = None,
) -> JsonObject:
    display_path = normalize_history_project_path(path)
    if not display_path:
        return {"ok": False, "reason": "invalid_path"}

    if require_known_sidecar:
        lookup = lookup_project(deps, display_path)
        if lookup.get("known") is not True:
            return {
                "ok": False,
                "reason": lookup.get("reason") or "not_known",
                "lookup": lookup,
            }

    replay_reason = "project_open"
    if file_target:
        target_path = _resolve_project_file_target(
            Path(display_path).expanduser().resolve(strict=False),
            file_target,
        )
        write_sidecar_open_file(
            display_path,
            target_path,
            reason="project_open_with_file",
            require_existing_sidecar=False,
        )
        replay_reason = "project_open_with_file"

    from ...explorer.services.project_switch import switch_project_connection
    from ...explorer.transport.rpc_socketio import sync_active_explorer_dispatchers_project_root

    switch_result = await switch_project_connection(
        None,
        display_path,
        display_path=display_path,
        initialize_watcher=False,
        switch_adapter_workspace=True,
        open_state_reason=replay_reason,
        open_state_source=reason,
    )
    project_root = switch_result.project_root
    sync_active_explorer_dispatchers_project_root(project_root)
    state = deps.build_state_payload()
    lookup_after = lookup_project(deps, display_path)
    return {
        "ok": True,
        "path": display_path,
        "resolved_path": str(project_root),
        "state": state,
        "project": lookup_after.get("project"),
    }


async def create_project_from_parent_name(
    deps: ProjectServiceDeps,
    *,
    parent_path: str,
    name: str,
    open_after: bool = True,
) -> JsonObject:
    result = deps.create_project(parent_path, name)
    new_project_path_raw = result.get("path")
    if not isinstance(new_project_path_raw, str) or not new_project_path_raw:
        raise ValueError("create_project returned invalid path")
    if open_after:
        open_result = await open_project(
            deps,
            new_project_path_raw,
            require_known_sidecar=False,
            reason="project_create",
        )
        open_result["created"] = True
        return open_result

    display_path = normalize_history_project_path(new_project_path_raw)
    deps.history.touch_project(display_path)
    deps.history.set_active_project(display_path)
    await after_project_switch(deps, reason="project_create")
    return {
        "ok": True,
        "created": True,
        "path": display_path,
        "project": lookup_project(deps, display_path).get("project"),
    }


async def create_project_from_path(
    deps: ProjectServiceDeps,
    *,
    path: str,
    adopt_existing: bool,
    open_after: bool = True,
) -> JsonObject:
    if not str(path or "").strip():
        return {"ok": False, "reason": "invalid_path"}
    target = Path(normalize_history_project_path(path))
    if target.exists():
        if not target.is_dir():
            return {"ok": False, "reason": "path_is_file", "path": str(target)}
        if not adopt_existing:
            return {"ok": False, "reason": "path_exists", "path": str(target)}
        if open_after:
            open_result = await open_project(
                deps,
                str(target),
                require_known_sidecar=False,
                reason="project_create_adopt",
            )
            open_result["created"] = False
            open_result["adopted"] = True
            return open_result
        display_path = normalize_history_project_path(str(target))
        deps.history.touch_project(display_path)
        return {
            "ok": True,
            "created": False,
            "adopted": True,
            "path": display_path,
            "project": lookup_project(deps, display_path).get("project"),
        }

    parent = target.parent
    name = target.name
    if not name:
        return {"ok": False, "reason": "invalid_path"}
    created = await create_project_from_parent_name(
        deps,
        parent_path=str(parent),
        name=name,
        open_after=open_after,
    )
    created["created"] = True
    return created
