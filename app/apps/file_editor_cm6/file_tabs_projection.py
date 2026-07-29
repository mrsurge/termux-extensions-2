# pyright: strict
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import TypedDict, cast

from .project_sidecar import ProjectSidecar
from .ui_ipc.rpc_contract import (
    UI_IPC_RPC_NOTIFICATION_FILE_TABS_DECORATIONS_CHANGED,
)
from .worker_services import git_service
from .worker_services.event_bus import (
    WorkerEvent,
    current_project_generation,
    event_payload_object,
    subscribe as subscribe_worker_event,
)

JsonObject = dict[str, object]
ProjectionEmitter = Callable[[str, JsonObject], Awaitable[None]]
logger = logging.getLogger(__name__)


class FileTabDiagnostics(TypedDict):
    errors: int
    warnings: int


class FileTabDecoration(TypedDict):
    path: str
    gitStatus: str
    hasDraft: bool
    diagnostics: FileTabDiagnostics


class FileTabsDecorationProjection(TypedDict):
    projectPath: str
    items: list[FileTabDecoration]


_registered = False
_diagnostics_by_project: dict[str, dict[str, FileTabDiagnostics]] = {}
_draft_paths_by_project: dict[str, set[str]] = {}
_git_statuses_by_project: dict[str, dict[str, str]] = {}
_projection_revisions: dict[str, int] = {}
_projection_tasks: dict[str, asyncio.Task[None]] = {}
_projection_emitter: ProjectionEmitter | None = None


def _normalized_path(path: str | Path) -> str:
    return str(Path(path).expanduser().resolve(strict=False))


def _retain_project(project: str) -> None:
    """Keep projector caches bounded to the one active project."""
    for cache in (
        _diagnostics_by_project,
        _draft_paths_by_project,
        _git_statuses_by_project,
        _projection_revisions,
    ):
        for stale_project in [key for key in cache if key != project]:
            _ = cache.pop(stale_project, None)
    for stale_project, task in list(_projection_tasks.items()):
        if stale_project == project:
            continue
        _ = task.cancel()
        _ = _projection_tasks.pop(stale_project, None)


def _marker_severity(marker: object) -> int:
    if not isinstance(marker, dict):
        return 0
    raw = cast(dict[object, object], marker).get("severity")
    if not isinstance(raw, (int, float, str)) or isinstance(raw, bool):
        return 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0


def _diagnostics_from_detail(detail: JsonObject) -> dict[str, FileTabDiagnostics]:
    result: dict[str, FileTabDiagnostics] = {}
    for raw_path, raw_markers in detail.items():
        if not isinstance(raw_markers, list):
            continue
        errors = 0
        warnings = 0
        for marker in cast(list[object], raw_markers):
            severity = _marker_severity(marker)
            if severity == 8:
                errors += 1
            elif severity == 4:
                warnings += 1
        if errors or warnings:
            result[_normalized_path(raw_path)] = {
                "errors": errors,
                "warnings": warnings,
            }
    return result


def _draft_paths(project: str, drafts: JsonObject) -> set[str]:
    result: set[str] = set()
    for raw_path, raw_info in drafts.items():
        if (
            isinstance(raw_info, dict)
            and cast(dict[object, object], raw_info).get("unsaved") is False
        ):
            continue
        candidate = Path(raw_path).expanduser()
        if not candidate.is_absolute():
            candidate = Path(project) / candidate
        result.add(_normalized_path(candidate))
    return result


def _initial_draft_paths(sidecar: ProjectSidecar) -> set[str]:
    result: set[str] = set()
    for entry in sidecar.list_project_drafts():
        path = entry.get("file_path")
        if isinstance(path, str) and path:
            result.add(_normalized_path(path))
    return result


def _build_projection_sync(
    project: str,
    *,
    diagnostics: dict[str, FileTabDiagnostics],
    draft_paths: set[str] | None,
    git_statuses: dict[str, str] | None,
) -> FileTabsDecorationProjection:
    normalized_project = _normalized_path(project)
    # This projection runs in asyncio.to_thread(). Use an isolated snapshot so
    # a background reload cannot replace the shared sidecar instance mid-write.
    sidecar = ProjectSidecar(normalized_project)
    resolved_drafts = (
        set(draft_paths)
        if draft_paths is not None
        else _initial_draft_paths(sidecar)
    )
    resolved_git = (
        dict(git_statuses)
        if git_statuses is not None
        else git_service.get_cached_statuses(Path(normalized_project))
    )

    items: list[FileTabDecoration] = []
    for entry in sidecar.list_recent_files()[:12]:
        raw_path = entry.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            continue
        path = _normalized_path(raw_path)
        try:
            rel = Path(path).relative_to(normalized_project).as_posix()
        except ValueError:
            rel = ""
        diagnostic = diagnostics.get(path, {"errors": 0, "warnings": 0})
        items.append(
            {
                "path": path,
                "gitStatus": resolved_git.get(rel, "") if rel else "",
                "hasDraft": path in resolved_drafts,
                "diagnostics": {
                    "errors": diagnostic["errors"],
                    "warnings": diagnostic["warnings"],
                },
            }
        )
    return {
        "projectPath": normalized_project,
        "items": items,
    }


async def build_file_tabs_projection(
    project: str,
) -> JsonObject:
    normalized_project = _normalized_path(project)
    _retain_project(normalized_project)
    diagnostics = dict(_diagnostics_by_project.get(normalized_project, {}))
    drafts = _draft_paths_by_project.get(normalized_project)
    git_statuses = _git_statuses_by_project.get(normalized_project)
    projection = await asyncio.to_thread(
        _build_projection_sync,
        normalized_project,
        diagnostics=diagnostics,
        draft_paths=set(drafts) if drafts is not None else None,
        git_statuses=dict(git_statuses) if git_statuses is not None else None,
    )
    return {
        "projectPath": projection["projectPath"],
        "items": [
            {
                "path": item["path"],
                "gitStatus": item["gitStatus"],
                "hasDraft": item["hasDraft"],
                "diagnostics": dict(item["diagnostics"]),
            }
            for item in projection["items"]
        ],
    }


def _event_project(event: WorkerEvent) -> str | None:
    project = event.get("project_root")
    if not project:
        return None
    normalized = _normalized_path(project)
    generation = event.get("project_generation")
    if generation is not None and current_project_generation(normalized) != generation:
        return None
    _retain_project(normalized)
    return normalized


async def _emit_projection(project: str) -> None:
    emitter = _projection_emitter
    if emitter is None:
        return
    projection = await build_file_tabs_projection(project)
    await emitter(
        UI_IPC_RPC_NOTIFICATION_FILE_TABS_DECORATIONS_CHANGED,
        projection,
    )


async def _run_projection(project: str) -> None:
    try:
        while True:
            revision = _projection_revisions.get(project, 0)
            await _emit_projection(project)
            if revision == _projection_revisions.get(project, 0):
                return
    except Exception:
        logger.exception("[file_tabs] projection failed project=%s", project)
    finally:
        _ = _projection_tasks.pop(project, None)


def _schedule_projection(project: str) -> None:
    _projection_revisions[project] = _projection_revisions.get(project, 0) + 1
    task = _projection_tasks.get(project)
    if task is None or task.done():
        _projection_tasks[project] = asyncio.create_task(
            _run_projection(project),
            name=f"file_tabs_projection:{project}",
        )


def set_file_tabs_projection_emitter(emitter: ProjectionEmitter) -> None:
    """Bind UI IPC delivery without importing the transport into the projector."""
    global _projection_emitter
    _projection_emitter = emitter


async def _handle_open_state_changed(event: WorkerEvent) -> None:
    project = _event_project(event)
    if project:
        _schedule_projection(project)


async def _handle_diagnostics_changed(event: WorkerEvent) -> None:
    project = _event_project(event)
    if not project:
        return
    _diagnostics_by_project[project] = _diagnostics_from_detail(
        event_payload_object(event, "detail")
    )
    _schedule_projection(project)


async def _handle_draft_state_changed(event: WorkerEvent) -> None:
    project = _event_project(event)
    if not project:
        return
    _draft_paths_by_project[project] = _draft_paths(
        project,
        event_payload_object(event, "drafts"),
    )
    _schedule_projection(project)


async def _handle_git_snapshot_changed(event: WorkerEvent) -> None:
    project = _event_project(event)
    if not project:
        return
    decorations = event_payload_object(event, "decorations")
    raw_statuses = decorations.get("statuses")
    statuses: dict[str, str] = {}
    if isinstance(raw_statuses, dict):
        for raw_path, raw_status in cast(
            dict[object, object],
            raw_statuses,
        ).items():
            if isinstance(raw_path, str) and isinstance(raw_status, str):
                statuses[raw_path] = raw_status
    _git_statuses_by_project[project] = statuses
    _schedule_projection(project)


def register_file_tabs_projection_handlers() -> None:
    global _registered
    if _registered:
        return
    subscribe_worker_event("OpenStateChanged", _handle_open_state_changed)
    subscribe_worker_event("DiagnosticsDetailChanged", _handle_diagnostics_changed)
    subscribe_worker_event("DraftStateChanged", _handle_draft_state_changed)
    subscribe_worker_event("GitSnapshotChanged", _handle_git_snapshot_changed)
    _registered = True
