# pyright: strict
from __future__ import annotations

import logging
from pathlib import Path
from typing import TypedDict, cast

logger = logging.getLogger(__name__)

DiagnosticsDetailPayload = dict[str, list[object]]


class WatcherFilesPayload(TypedDict):
    created: list[str]
    changed: list[str]
    deleted: list[str]


_diagnostics_detail_by_project: dict[str, DiagnosticsDetailPayload] = {}
_watcher_batch_by_project: dict[str, WatcherFilesPayload] = {}
_watcher_error_by_project: dict[str, dict[str, object]] = {}
_git_decorations_by_project: dict[str, dict[str, object]] = {}
_git_status_by_project: dict[str, dict[str, object]] = {}


def _normalize_project_path(project_path: str) -> str:
    return str(Path(project_path).expanduser().resolve(strict=False))


def _copy_diagnostics_detail(detail_abs: DiagnosticsDetailPayload) -> DiagnosticsDetailPayload:
    return {
        str(abs_path): list(markers)
        for abs_path, markers in detail_abs.items()
    }


def _build_rel_payload(
    project_path: str,
    *,
    created_abs: list[str],
    changed_abs: list[str],
    deleted_abs: list[str],
) -> WatcherFilesPayload:
    from .explorer.transport.connection_manager import abs_to_rel

    def to_rel(abs_path: str) -> str | None:
        try:
            return abs_to_rel(abs_path, project_path)
        except Exception:
            return None

    created = [rel for rel in (to_rel(path) for path in created_abs) if rel]
    changed = [rel for rel in (to_rel(path) for path in changed_abs) if rel]
    deleted = [rel for rel in (to_rel(path) for path in deleted_abs) if rel]
    return {
        "created": created,
        "changed": changed,
        "deleted": deleted,
    }


async def publish_diagnostics_detail(
    project_path: str,
    detail_abs: DiagnosticsDetailPayload,
) -> None:
    from .explorer.transport.rpc_emit import emit_project_explorer_rpc_notification

    normalized_project = _normalize_project_path(project_path)
    copied = _copy_diagnostics_detail(detail_abs)
    _diagnostics_detail_by_project[normalized_project] = copied
    await emit_project_explorer_rpc_notification(
        normalized_project,
        "explorer.diagnostics.detail",
        cast(dict[str, object], copied),
    )


async def publish_watcher_error(project_path: str, payload: dict[str, object]) -> None:
    from .explorer.transport.rpc_emit import emit_project_explorer_rpc_notification

    normalized_project = _normalize_project_path(project_path)
    copied = dict(payload)
    _watcher_error_by_project[normalized_project] = copied
    await emit_project_explorer_rpc_notification(
        normalized_project,
        "explorer.watcher.error",
        copied,
    )


async def publish_file_change_batch(
    project_path: str,
    *,
    created_abs: list[str],
    changed_abs: list[str],
    deleted_abs: list[str],
) -> None:
    from .explorer.services.runtime_notifications import notify_explorer_of_change
    from .monaco_editor.editor_ws import handle_external_file_change

    normalized_project = _normalize_project_path(project_path)
    rel_payload = _build_rel_payload(
        normalized_project,
        created_abs=created_abs,
        changed_abs=changed_abs,
        deleted_abs=deleted_abs,
    )
    _watcher_batch_by_project[normalized_project] = rel_payload

    for abs_path in created_abs:
        notify_explorer_of_change(abs_path, "created")
    for abs_path in changed_abs:
        notify_explorer_of_change(abs_path, "modified")
    for abs_path in deleted_abs:
        notify_explorer_of_change(abs_path, "deleted")

    for abs_path in [*created_abs, *changed_abs]:
        try:
            await handle_external_file_change(abs_path)
        except Exception as exc:
            logger.debug("[workspace_events] external file change publish failed: %s", exc)

def publish_file_change_threadsafe(abs_path: str, event_type: str) -> None:
    import asyncio

    from .explorer.services.file_ops import get_project_root
    from .explorer.services.runtime_notifications import get_explorer_event_loop

    loop = get_explorer_event_loop()
    if loop is None or not loop.is_running():
        return

    normalized_project = _normalize_project_path(str(get_project_root()))
    created_abs: list[str] = [abs_path] if event_type == "created" else []
    deleted_abs: list[str] = [abs_path] if event_type == "deleted" else []
    changed_abs: list[str] = []
    if event_type not in {"created", "deleted"}:
        changed_abs = [abs_path]

    asyncio.run_coroutine_threadsafe(
        publish_file_change_batch(
            normalized_project,
            created_abs=created_abs,
            changed_abs=changed_abs,
            deleted_abs=deleted_abs,
        ),
        loop,
    )


async def publish_git_status_update(
    project_path: str,
    *,
    decorations_payload: dict[str, object],
    status_payload: dict[str, object],
) -> None:
    from .explorer.transport.rpc_emit import emit_project_explorer_rpc_notification
    from .monaco_editor.editor_ws import broadcast_git_baselines_for_active_file

    normalized_project = _normalize_project_path(project_path)
    _git_decorations_by_project[normalized_project] = dict(decorations_payload)
    _git_status_by_project[normalized_project] = dict(status_payload)

    await emit_project_explorer_rpc_notification(
        normalized_project,
        "explorer.git.decorations.updated",
        dict(decorations_payload),
    )
    await emit_project_explorer_rpc_notification(
        normalized_project,
        "explorer.git.status.updated",
        dict(status_payload),
    )
    try:
        await broadcast_git_baselines_for_active_file()
    except Exception as exc:
        logger.warning(
            "Failed to push git baselines after status update for %s: %s",
            normalized_project,
            exc,
        )


def get_workspace_event_snapshot(project_path: str) -> dict[str, object]:
    normalized_project = _normalize_project_path(project_path)
    return {
        "diagnostics_detail": _copy_diagnostics_detail(
            _diagnostics_detail_by_project.get(normalized_project, {})
        ),
        "watcher_batch": dict(_watcher_batch_by_project.get(normalized_project, {"created": [], "changed": [], "deleted": []})),
        "watcher_error": dict(_watcher_error_by_project.get(normalized_project, {})),
        "git_decorations": dict(_git_decorations_by_project.get(normalized_project, {})),
        "git_status": dict(_git_status_by_project.get(normalized_project, {})),
    }
