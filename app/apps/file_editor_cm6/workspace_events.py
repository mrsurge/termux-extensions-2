# pyright: strict
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import TypedDict, cast

from .worker_services.event_bus import (
    WorkerEvent,
    build_event,
    current_project_generation,
    event_payload_list,
    publish as publish_worker_event,
    publish_threadsafe as publish_worker_event_threadsafe,
    subscribe as subscribe_worker_event,
)

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
_git_snapshot_debounce_tasks: dict[str, asyncio.Task[None]] = {}
_event_bus_handlers_registered = False


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
    from .monaco_editor.editor_ws import handle_external_file_change

    normalized_project = _normalize_project_path(project_path)
    rel_payload = _build_rel_payload(
        normalized_project,
        created_abs=created_abs,
        changed_abs=changed_abs,
        deleted_abs=deleted_abs,
    )
    _watcher_batch_by_project[normalized_project] = rel_payload

    for abs_path in [*created_abs, *changed_abs]:
        try:
            await handle_external_file_change(abs_path)
        except Exception as exc:
            logger.debug("[workspace_events] external file change publish failed: %s", exc)


async def publish_file_change_event(
    project_path: str,
    *,
    created_abs: list[str],
    changed_abs: list[str],
    deleted_abs: list[str],
) -> None:
    """Publish a file-change event through the worker event bus."""
    normalized_project = _normalize_project_path(project_path)
    await publish_worker_event(
        build_event(
            "WorkspaceFilesChanged",
            project_root=normalized_project,
            project_generation=current_project_generation(normalized_project),
            source="publish_file_change_event",
            payload={
                "created_abs": created_abs,
                "changed_abs": changed_abs,
                "deleted_abs": deleted_abs,
            },
        )
    )


def publish_file_change_threadsafe(abs_path: str, event_type: str) -> None:
    from .explorer.services.file_ops import get_project_root

    normalized_project = _normalize_project_path(str(get_project_root()))
    created_abs: list[str] = [abs_path] if event_type == "created" else []
    deleted_abs: list[str] = [abs_path] if event_type == "deleted" else []
    changed_abs: list[str] = []
    if event_type not in {"created", "deleted"}:
        changed_abs = [abs_path]

    event = build_event(
        "WorkspaceFilesChanged",
        project_root=normalized_project,
        project_generation=current_project_generation(normalized_project),
        source="publish_file_change_threadsafe",
        payload={
            "created_abs": created_abs,
            "changed_abs": changed_abs,
            "deleted_abs": deleted_abs,
        },
    )
    if publish_worker_event_threadsafe(event):
        return
    logger.debug(
        "[workspace_events] dropped thread-safe file-change event before worker bus startup project=%s path=%s type=%s",
        normalized_project,
        abs_path,
        event_type,
    )


def register_workspace_event_bus_handlers() -> None:
    """Register compatibility projectors for initial worker bus consumers."""
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    from .explorer.services.runtime_notifications import set_git_status_publisher

    async def _publish_git_status_callback(
        project_path: str,
        decorations_payload: dict[str, object],
        status_payload: dict[str, object],
    ) -> None:
        await publish_git_status_update(
            project_path,
            decorations_payload=decorations_payload,
            status_payload=status_payload,
        )

    set_git_status_publisher(_publish_git_status_callback)
    subscribe_worker_event("WorkspaceFilesChanged", _handle_workspace_files_changed_event)
    subscribe_worker_event("GitSnapshotRequested", _handle_git_snapshot_requested_event)
    _event_bus_handlers_registered = True


async def _handle_workspace_files_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project:
        return
    await publish_file_change_batch(
        project,
        created_abs=event_payload_list(event, "created_abs"),
        changed_abs=event_payload_list(event, "changed_abs"),
        deleted_abs=event_payload_list(event, "deleted_abs"),
    )
    await publish_worker_event(
        build_event(
            "GitSnapshotRequested",
            project_root=project,
            project_generation=event.get("project_generation"),
            source="workspace_events:WorkspaceFilesChanged",
            correlation_id=event.get("correlation_id"),
            payload={},
        )
    )


async def _handle_git_snapshot_requested_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project:
        return
    generation = event.get("project_generation")
    key = project
    existing = _git_snapshot_debounce_tasks.get(key)
    if existing is not None and not existing.done():
        existing.cancel()
    _git_snapshot_debounce_tasks[key] = asyncio.create_task(
        _debounced_git_snapshot(project, generation),
        name="file_editor_cm6_git_snapshot_refresh",
    )


async def _debounced_git_snapshot(project: str, generation: int | None) -> None:
    try:
        await asyncio.sleep(0.5)
        if generation is not None and current_project_generation(project) != generation:
            return
        from .explorer.services.runtime_notifications import broadcast_git_status_update

        await broadcast_git_status_update(
            project,
            project_generation=generation,
            source="workspace_events:GitSnapshotRequested",
        )
    except asyncio.CancelledError:
        pass
    finally:
        task = _git_snapshot_debounce_tasks.get(project)
        if task is asyncio.current_task():
            _git_snapshot_debounce_tasks.pop(project, None)


async def publish_git_status_update(
    project_path: str,
    *,
    decorations_payload: dict[str, object],
    status_payload: dict[str, object],
) -> None:
    from .explorer.transport.rpc_emit import emit_project_explorer_rpc_notification
    from .monaco_editor.editor_ws import broadcast_git_baselines_for_active_file

    normalized_project = _normalize_project_path(project_path)
    decorations = {**decorations_payload, "projectPath": normalized_project}
    status = {**status_payload, "projectPath": normalized_project}
    _git_decorations_by_project[normalized_project] = dict(decorations)
    _git_status_by_project[normalized_project] = dict(status)

    await emit_project_explorer_rpc_notification(
        normalized_project,
        "explorer.git.decorations.updated",
        dict(decorations),
    )
    await emit_project_explorer_rpc_notification(
        normalized_project,
        "explorer.git.status.updated",
        dict(status),
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
