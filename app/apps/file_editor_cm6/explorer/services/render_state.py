# pyright: strict
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TypedDict, cast

from ...project_sidecar import ProjectSidecar
from ...worker_services.event_bus import (
    WorkerEvent,
    build_event,
    event_payload_list,
    publish as publish_worker_event,
    subscribe as subscribe_worker_event,
)
from ..context import Broadcast, EmitPersonal
from ..transport.connection_manager import abs_to_rel
from ..transport.rpc_emit import emit_project_explorer_rpc_notification
from . import file_ops as _file_ops

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
ListDirFn = Callable[[str], JsonObject]

list_dir = cast(ListDirFn, _file_ops.list_dir)
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
    return await asyncio.to_thread(list_dir, rel)


async def build_bootstrap_snapshot(project_root: Path) -> ExplorerBootstrapSnapshot:
    root_listing, open_directories = await asyncio.gather(
        build_directory_listing("."),
        asyncio.to_thread(load_pruned_open_directories, project_root),
    )
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
        {"dirs": snapshot.open_directories},
    )
    for listing in snapshot.open_directory_listings:
        await emit_personal("explorer.list.updated", listing)


async def broadcast_directory_listing(
    broadcast: Broadcast,
    rel: str,
) -> None:
    await broadcast("explorer.list.updated", await build_directory_listing(rel))


# Event-bus projection. The render-state subsystem owns watcher-driven Explorer
# relist decisions, so the frontend no longer derives affected directories from
# watcher payloads.
def register_explorer_render_state_bus_handlers() -> None:
    global _event_bus_handlers_registered
    if _event_bus_handlers_registered:
        return
    subscribe_worker_event("WorkspaceFilesChanged", _handle_workspace_files_changed_event)
    subscribe_worker_event("ExplorerRenderStateChanged", _handle_explorer_render_state_changed_event)
    _event_bus_handlers_registered = True


async def _handle_workspace_files_changed_event(event: WorkerEvent) -> None:
    project = event.get("project_root")
    if not project:
        return
    project_root = Path(project)
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
            payload=cast(JsonObject, payload),
        )
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
            {"dirs": event_payload_list(event, "open_directories")},
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
        target.relative_to(root)
        return target.is_dir()
    except Exception:
        return False


def _sort_open_directories_for_replay(open_directories: list[str]) -> list[str]:
    return sorted(
        [rel for rel in open_directories if rel],
        key=lambda rel: (rel.count("/"), rel),
    )


def _abs_paths_to_rels(project_root: str, abs_paths: list[str]) -> list[str]:
    rels: list[str] = []
    for abs_path in abs_paths:
        rel = abs_to_rel(abs_path, project_root)
        if rel and rel not in rels:
            rels.append(rel)
    return rels


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
