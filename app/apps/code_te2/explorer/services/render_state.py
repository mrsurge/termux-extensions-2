# pyright: strict
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TypedDict, cast

from ...project_sidecar import ProjectSidecar
from ...diagnostics_latency_metrics import (
    diagnostics_latency_metrics_enabled,
    elapsed_ms,
    record_latency_event,
)
from ...open_state_events import (
    client_foreground_payload_from_event,
    open_state_payload_from_event,
)
from ...worker_services.event_bus import (
    WorkerEvent,
    build_event,
    current_project_generation,
    event_payload_list,
    event_payload_object,
    publish as publish_worker_event,
    record_stale_drop,
    subscribe as subscribe_worker_event,
)
from ..context import EmitPersonal
from ..transport.connection_manager import abs_to_rel
from ..transport.rpc_emit import (
    emit_client_explorer_rpc_notification,
    emit_explorer_rpc_notification,
    emit_project_explorer_rpc_notification,
)
from . import fs_service_client
from . import file_ops as _file_ops

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
DiagnosticsDetailPayload = dict[str, list[object]]
ListDirectoryFn = Callable[[str], _file_ops.FsDirectoryListing]
ExplorerListingAdapterFn = Callable[[_file_ops.FsDirectoryListing], JsonObject]

list_directory = cast(ListDirectoryFn, fs_service_client.list_directory)
explorer_listing_from_fs_directory_listing = cast(
    ExplorerListingAdapterFn,
    _file_ops.explorer_listing_from_fs_directory_listing,
)
_event_bus_handlers_registered = False


class ExplorerRenderStatePayload(TypedDict, total=False):
    reason: str
    directories: list[str]
    open_directories: list[str]
    open_directories_changed: bool
    created: list[str]
    changed: list[str]
    deleted: list[str]


@dataclass(frozen=True)
class ExplorerBootstrapSnapshot:
    root_listing: JsonObject
    open_directories: list[str]
    open_directory_listings: list[JsonObject]


# Backend read-model builders. These functions centralize Explorer-facing state
# derived from disk and sidecars so bootstrap/reconnect does not rely on frontend
# restore attempts as the source of truth.
async def build_directory_listing(rel: str) -> JsonObject:
    listing = await asyncio.to_thread(list_directory, rel)
    return await asyncio.to_thread(explorer_listing_from_fs_directory_listing, listing)


async def build_bootstrap_snapshot(
    project_root: Path,
    *,
    extra_open_directories: list[str] | None = None,
) -> ExplorerBootstrapSnapshot:
    root_listing, open_directories = await asyncio.gather(
        build_directory_listing("."),
        asyncio.to_thread(load_pruned_open_directories, project_root),
    )
    open_directories = _merge_open_directories(open_directories, extra_open_directories or [])
    open_directory_listings = await build_open_directory_listings(open_directories)
    return ExplorerBootstrapSnapshot(
        root_listing=root_listing,
        open_directories=open_directories,
        open_directory_listings=open_directory_listings,
    )


# Open-directory replay. Persisted open dirs are loaded from backend state and
# listed shallow-to-deep so existing frontend handlers can render parents before
# nested children without a contract change.
async def build_open_directory_listings(open_directories: list[str]) -> list[JsonObject]:
    listings: list[JsonObject] = []
    for rel in _sort_open_directories_for_replay(open_directories):
        try:
            listings.append(await build_directory_listing(rel))
        except Exception as exc:
            logger.debug(
                "[explorer_render_state] skipped open directory listing rel=%s error=%s",
                rel,
                exc,
            )
    return listings


def load_pruned_open_directories(project_root: Path) -> list[str]:
    return _load_pruned_open_directory_state(project_root).directories


@dataclass(frozen=True)
class OpenDirectoryState:
    directories: list[str]
    changed: bool


def _load_pruned_open_directory_state(project_root: Path) -> OpenDirectoryState:
    try:
        sidecar = ProjectSidecar.load_or_create(str(project_root))
        original = sidecar.get_open_directories()
        pruned = [
            rel
            for rel in original
            if _is_existing_project_directory(project_root, rel)
        ]
        if pruned != original:
            sidecar.set_open_directories(pruned)
            sidecar.save()
            logger.info(
                "[explorer_render_state] pruned missing open directories project=%s before=%s after=%s",
                project_root,
                len(original),
                len(pruned),
            )
        return OpenDirectoryState(directories=pruned, changed=pruned != original)
    except Exception as exc:
        logger.warning("Failed to load Explorer open directories: %s", exc)
        return OpenDirectoryState(directories=[], changed=False)


# Projection helpers. They intentionally reuse existing Explorer RPC
# notification names so this backend read-model slice does not create a frontend
# contract migration.
async def emit_bootstrap_snapshot(
    emit_personal: EmitPersonal,
    snapshot: ExplorerBootstrapSnapshot,
) -> None:
    await emit_personal("explorer.list.updated", snapshot.root_listing)
    await emit_personal(
        "explorer.openDirs.updated",
        {"dirs": snapshot.open_directories, "hydrate": "backend"},
    )
    for listing in snapshot.open_directory_listings:
        await emit_personal("explorer.list.updated", listing)


# Event-bus projection. The render-state subsystem owns watcher-driven Explorer
# relist decisions, so the frontend no longer derives affected directories from
# watcher payloads.
def register_explorer_render_state_bus_handlers() -> None:
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("DiagnosticsDetailChanged", _handle_diagnostics_detail_changed_event)
    subscribe_worker_event("DraftStateChanged", _handle_draft_state_changed_event)
    subscribe_worker_event("GitDiffBaseChanged", _handle_git_diff_base_changed_event)
    subscribe_worker_event("GitPathRestored", _handle_git_path_restored_event)
    subscribe_worker_event("GitSnapshotChanged", _handle_git_snapshot_changed_event)
    subscribe_worker_event("OpenStateChanged", _handle_open_state_changed_event)
    subscribe_worker_event("ClientForegroundChanged", _handle_client_foreground_changed_event)
    subscribe_worker_event("PreferencesChanged", _handle_preferences_changed_event)
    subscribe_worker_event("ReviewStateChanged", _handle_review_state_changed_event)
    subscribe_worker_event("WatcherConfigChanged", _handle_watcher_config_changed_event)
    subscribe_worker_event("WatcherErrorRaised", _handle_watcher_error_raised_event)
    subscribe_worker_event("WorkspaceFilesChanged", _handle_workspace_files_changed_event)
    subscribe_worker_event("ExplorerRenderStateChanged", _handle_explorer_render_state_changed_event)
    _event_bus_handlers_registered = True


async def _handle_diagnostics_detail_changed_event(event: WorkerEvent) -> None:
    # Render-state is the Explorer projector for diagnostics facts; WBA intake
    # and workspace caches consume the same fact on their own lanes.
    project = event.get("project_root")
    if not project:
        return
    generation = event.get("project_generation")
    if generation is not None and current_project_generation(project) != generation:
        record_stale_drop("explorer_render_state:diagnostics_detail", event["type"])
        logger.debug(
            "[explorer_render_state] dropped stale diagnostics detail project=%s generation=%s current=%s",
            project,
            generation,
            current_project_generation(project),
        )
        return
    diagnostics_detail = _diagnostics_detail_from_event(event)
    detail = cast(JsonObject, diagnostics_detail)
    marker_count = sum(len(markers) for markers in diagnostics_detail.values())
    publish_started_ns = (
        time.perf_counter_ns()
        if diagnostics_latency_metrics_enabled()
        else 0
    )
    await emit_project_explorer_rpc_notification(
        project,
        "explorer.diagnostics.detail",
        detail,
    )
    record_latency_event(
        "diagnostics_explorer_publish",
        {
            "files": len(detail),
            "markers": marker_count,
            "duration_ms": elapsed_ms(publish_started_ns),
        },
    )


async def _handle_draft_state_changed_event(event: WorkerEvent) -> None:
    # Draft/review state changes are store-backed facts; render-state owns only
    # the Explorer decoration projection for those facts.
    project = event.get("project_root")
    if not project or _is_stale_project_event(event, project):
        return
    await emit_project_explorer_rpc_notification(
        project,
        "explorer.decorations.updated",
        {"drafts": event_payload_object(event, "drafts")},
    )


async def _handle_git_diff_base_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project or _is_stale_project_event(event, project):
        return
    payload = event["payload"]
    ref = payload.get("ref")
    if not isinstance(ref, str) or not ref:
        return
    await emit_project_explorer_rpc_notification(
        project,
        "explorer.git.diffBase.updated",
        {
            "ref": ref,
            "refresh": payload.get("refresh") is True,
        },
    )


async def _handle_git_path_restored_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project or _is_stale_project_event(event, project):
        return
    path = event["payload"].get("path")
    if not isinstance(path, str) or not path:
        return
    await emit_project_explorer_rpc_notification(
        project,
        "explorer.git.restored",
        {"path": path},
    )


async def _handle_git_snapshot_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project:
        return
    generation = event.get("project_generation")
    if generation is not None and current_project_generation(project) != generation:
        record_stale_drop("explorer_render_state:git_snapshot", event["type"])
        logger.debug(
            "[explorer_render_state] dropped stale git snapshot project=%s generation=%s current=%s",
            project,
            generation,
            current_project_generation(project),
        )
        return

    decorations = event_payload_object(event, "decorations")
    status = event_payload_object(event, "status")
    if decorations:
        await emit_project_explorer_rpc_notification(
            project,
            "explorer.git.decorations.updated",
            decorations,
        )
    if status:
        await emit_project_explorer_rpc_notification(
            project,
            "explorer.git.status.updated",
            status,
        )


async def _handle_open_state_changed_event(event: WorkerEvent) -> None:
    # Explorer render-state is the Explorer projector for backend open-state
    # facts; the editor runtime no longer publishes active-file state directly.
    project = event.get("project_root")
    if not project:
        return
    generation = event.get("project_generation")
    if generation is not None and current_project_generation(project) != generation:
        record_stale_drop("explorer_render_state:open_state", event["type"])
        logger.debug(
            "[explorer_render_state] dropped stale open-state project=%s generation=%s current=%s",
            project,
            generation,
            current_project_generation(project),
        )
        return
    open_state = open_state_payload_from_event(event)
    if open_state is None:
        return
    await emit_project_explorer_rpc_notification(
        project,
        "explorer.openState.changed",
        dict(open_state),
    )


async def _handle_client_foreground_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project or _is_stale_project_event(event, project):
        return
    open_state = open_state_payload_from_event(event)
    client_foreground = client_foreground_payload_from_event(event)
    if open_state is None or client_foreground is None:
        return
    await emit_client_explorer_rpc_notification(
        client_foreground["clientInstanceId"],
        "explorer.activeFile.updated",
        {
            "rel": client_foreground["rel"],
            "abs": client_foreground["path"],
            "openState": dict(open_state),
            "clientForeground": dict(client_foreground),
        },
    )


async def _handle_preferences_changed_event(event: WorkerEvent) -> None:
    await emit_explorer_rpc_notification(
        "explorer.prefs.ui.updated",
        {"ui": event_payload_object(event, "ui")},
    )


async def _handle_review_state_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project or _is_stale_project_event(event, project):
        return
    await emit_project_explorer_rpc_notification(
        project,
        "explorer.review.entries.updated",
        {"entries": _event_payload_object_list(event, "entries")},
    )


async def _handle_watcher_config_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project or _is_stale_project_event(event, project):
        return
    config = event_payload_object(event, "config")
    if config:
        await emit_project_explorer_rpc_notification(
            project,
            "explorer.watcher.config.updated",
            config,
        )
    mode = event["payload"].get("mode")
    if isinstance(mode, str) and mode:
        await emit_project_explorer_rpc_notification(
            project,
            "explorer.watcher.mode.changed",
            {"mode": mode},
        )
    mode_status = event_payload_object(event, "mode_status")
    if mode_status:
        await emit_project_explorer_rpc_notification(
            project,
            "explorer.watcher.mode.status",
            mode_status,
        )


async def _handle_watcher_error_raised_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project or _is_stale_project_event(event, project):
        return
    await emit_project_explorer_rpc_notification(
        project,
        "explorer.watcher.error",
        event_payload_object(event, "error"),
    )


async def _handle_workspace_files_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project:
        return
    project_root = Path(project)
    _file_ops.mark_git_cache_dirty(project_root)
    created = _abs_paths_to_rels(project, event_payload_list(event, "created_abs"))
    changed = _abs_paths_to_rels(project, event_payload_list(event, "changed_abs"))
    deleted = _abs_paths_to_rels(project, event_payload_list(event, "deleted_abs"))
    open_state = await asyncio.to_thread(_load_pruned_open_directory_state, project_root)
    directories = _affected_directories_for_rels(
        [*created, *changed, *deleted],
        open_state.directories,
    )
    payload: ExplorerRenderStatePayload = {
        "reason": "workspace_files_changed",
        "directories": directories,
        "open_directories": open_state.directories,
        "open_directories_changed": open_state.changed,
        "created": created,
        "changed": changed,
        "deleted": deleted,
    }
    await publish_worker_event(
        build_event(
            "ExplorerRenderStateChanged",
            project_root=project,
            project_generation=event.get("project_generation"),
            source="explorer_render_state:WorkspaceFilesChanged",
            correlation_id=event.get("correlation_id"),
            payload=cast(JsonObject, cast(object, payload)),
        )
    )
    from .runtime_notifications import schedule_git_status_update

    schedule_git_status_update(
        project,
        project_generation=event.get("project_generation"),
        source="explorer_render_state:WorkspaceFilesChanged",
    )


async def _handle_explorer_render_state_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project:
        return
    payload = event["payload"]
    if payload.get("open_directories_changed") is True:
        await emit_project_explorer_rpc_notification(
            project,
            "explorer.openDirs.updated",
            {"dirs": event_payload_list(event, "open_directories"), "hydrate": "backend"},
        )
    for rel in event_payload_list(event, "directories"):
        try:
            await emit_project_explorer_rpc_notification(
                project,
                "explorer.list.updated",
                await build_directory_listing(rel),
            )
        except Exception as exc:
            logger.debug(
                "[explorer_render_state] skipped changed directory listing project=%s rel=%s error=%s",
                project,
                rel,
                exc,
            )


def _is_existing_project_directory(project_root: Path, rel: str) -> bool:
    if not rel:
        return False
    try:
        root = project_root.expanduser().resolve(strict=False)
        target = (root / rel).resolve(strict=False)
        _ = target.relative_to(root)
        return target.is_dir()
    except Exception:
        return False


def _sort_open_directories_for_replay(open_directories: list[str]) -> list[str]:
    return sorted(
        [rel for rel in open_directories if rel],
        key=lambda rel: (rel.count("/"), rel),
    )


def _merge_open_directories(base: list[str], extra: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for rel in [*base, *extra]:
        normalized = rel.strip().strip("/")
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        merged.append(normalized)
    return _sort_open_directories_for_replay(merged)


def _abs_paths_to_rels(project_root: str, abs_paths: list[str]) -> list[str]:
    rels: list[str] = []
    for abs_path in abs_paths:
        rel = abs_to_rel(abs_path, project_root)
        if rel and rel not in rels:
            rels.append(rel)
    return rels


def _diagnostics_detail_from_event(event: WorkerEvent) -> DiagnosticsDetailPayload:
    raw = event_payload_object(event, "detail")
    return {
        path: list(cast(list[object], markers))
        for path, markers in raw.items()
        if isinstance(markers, list)
    }


def _event_payload_object_list(event: WorkerEvent, key: str) -> list[object]:
    value = event["payload"].get(key)
    if not isinstance(value, list):
        return []
    return [item for item in cast(list[object], value)]


def _is_stale_project_event(event: WorkerEvent, project: str) -> bool:
    generation = event.get("project_generation")
    if generation is None:
        return False
    stale = current_project_generation(project) != generation
    if stale:
        record_stale_drop("explorer_render_state:project_event", event["type"])
        logger.debug(
            "[explorer_render_state] dropped stale %s project=%s generation=%s current=%s",
            event["type"],
            project,
            generation,
            current_project_generation(project),
        )
    return stale


def _affected_directories_for_rels(rels: list[str], open_directories: list[str]) -> list[str]:
    affected: set[str] = set()
    for rel in rels:
        if rel == "." or "/" not in rel:
            affected.add(".")
        for open_dir in open_directories:
            if _rel_is_in_open_directory(rel, open_dir):
                affected.add(open_dir)
    return _sort_open_directories_for_replay(list(affected))


def _rel_is_in_open_directory(rel: str, open_dir: str) -> bool:
    if not open_dir:
        return False
    return rel == open_dir or rel.startswith(f"{open_dir}/")
