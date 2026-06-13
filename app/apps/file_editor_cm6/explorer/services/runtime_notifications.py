# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.request
from collections.abc import Awaitable, Callable
from pathlib import Path
from threading import Lock, Timer
from types import TracebackType
from typing import Protocol, cast

from .file_ops import mark_draft_cache_dirty, mark_git_cache_dirty
from ..transport.connection_manager import abs_to_rel, manager
from ..transport.rpc_emit import emit_project_explorer_rpc_notification
from ...worker_services.event_bus import (
    build_event,
    current_project_generation,
    publish_threadsafe as publish_worker_event_threadsafe,
)
from ...worker_services import git_service as worker_git_service

logger = logging.getLogger(__name__)
GitStatusPublisher = Callable[[str, dict[str, object], dict[str, object]], Awaitable[None]]


class UrlOpenResponse(Protocol):
    def __enter__(self) -> "UrlOpenResponse": ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> object: ...

    def read(self) -> bytes: ...

_explorer_event_loop: asyncio.AbstractEventLoop | None = None
_explorer_refresh_timers: dict[str, Timer] = {}
_explorer_refresh_lock = Lock()
_watcher_file_batches: dict[str, dict[str, set[str]]] = {}
_git_status_publisher: GitStatusPublisher | None = None
WATCHER_FILES_DEBOUNCE = 0.3


def set_explorer_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called during app startup to set the event loop for watcher callbacks."""
    global _explorer_event_loop
    _explorer_event_loop = loop


def get_explorer_event_loop() -> asyncio.AbstractEventLoop | None:
    return _explorer_event_loop


def set_git_status_publisher(publisher: GitStatusPublisher) -> None:
    global _git_status_publisher
    _git_status_publisher = publisher


def _watcher_bucket_for_event(event_type: str) -> str:
    if event_type == "created":
        return "created"
    if event_type == "deleted":
        return "deleted"
    return "changed"


def _schedule_watcher_files_broadcast(
    project_path: str,
    rel_path: str,
    event_type: str,
) -> None:
    bucket = _watcher_bucket_for_event(event_type)
    debounce_key = f"watcher:files:{project_path}"
    with _explorer_refresh_lock:
        batch = _watcher_file_batches.get(project_path)
        if batch is None:
            batch = {"created": set[str](), "changed": set[str](), "deleted": set[str]()}
            _watcher_file_batches[project_path] = batch
        batch[bucket].add(rel_path)

        existing_timer = _explorer_refresh_timers.get(debounce_key)
        if existing_timer is not None:
            existing_timer.cancel()

        def do_broadcast() -> None:
            with _explorer_refresh_lock:
                _explorer_refresh_timers.pop(debounce_key, None)
                payload = _watcher_file_batches.pop(project_path, None)
            loop = _explorer_event_loop
            if loop is None or payload is None:
                return
            asyncio.run_coroutine_threadsafe(
                _broadcast_watcher_files(project_path, payload),
                loop,
            )

        timer = Timer(WATCHER_FILES_DEBOUNCE, do_broadcast)
        _explorer_refresh_timers[debounce_key] = timer
        timer.start()


async def _broadcast_watcher_files(project_path: str, payload: dict[str, set[str]]) -> None:
    try:
        created = sorted(payload.get("created", set()))
        changed = sorted(payload.get("changed", set()))
        deleted = sorted(payload.get("deleted", set()))
        if not created and not changed and not deleted:
            return
        await emit_project_explorer_rpc_notification(
            project_path,
            "explorer.watcher.files",
            {
                "created": created,
                "changed": changed,
                "deleted": deleted,
            },
        )
    except Exception as exc:
        logger.warning("Failed to broadcast watcher files for %s: %s", project_path, exc)


def notify_explorer_of_change(abs_path: str, event_type: str) -> None:
    """Fan out batched watcher events to explorer clients and trigger git refresh."""
    if _explorer_event_loop is None or not manager.active_connections:
        return

    for project_path in list(manager.active_connections.keys()):
        rel_path = abs_to_rel(abs_path, project_path)
        if rel_path is None:
            continue
        try:
            _schedule_watcher_files_broadcast(project_path, rel_path, event_type)
            _schedule_git_status_broadcast(project_path)
        except Exception as exc:
            logger.warning("Failed to notify explorer of change: %s", exc)
        break


def _schedule_git_status_broadcast(project_path: str) -> None:
    project_generation = current_project_generation(project_path)
    event = build_event(
        "GitSnapshotRequested",
        project_root=project_path,
        project_generation=project_generation,
        source="runtime_notifications",
        payload={},
    )
    if publish_worker_event_threadsafe(event):
        return

    debounce_key = f"git:{project_path}"
    with _explorer_refresh_lock:
        existing_timer = _explorer_refresh_timers.get(debounce_key)
        if existing_timer is not None:
            existing_timer.cancel()

        def do_broadcast() -> None:
            with _explorer_refresh_lock:
                _explorer_refresh_timers.pop(debounce_key, None)
            loop = _explorer_event_loop
            if loop is None:
                return
            asyncio.run_coroutine_threadsafe(
                broadcast_git_status_update(
                    project_path,
                    project_generation=project_generation,
                    source="runtime_notifications:fallback_timer",
                ),
                loop,
            )

        timer = Timer(0.5, do_broadcast)
        _explorer_refresh_timers[debounce_key] = timer
        timer.start()


def _is_stale_git_generation(project: Path, project_generation: int | None) -> bool:
    return (
        project_generation is not None
        and current_project_generation(project) != project_generation
    )


async def broadcast_git_status_update(
    project_path: str | Path,
    *,
    project_generation: int | None = None,
    source: str = "runtime_notifications",
) -> None:
    project = Path(project_path)
    try:
        if _is_stale_git_generation(project, project_generation):
            logger.debug(
                "Dropping stale git refresh before work project=%s generation=%s current=%s source=%s",
                project,
                project_generation,
                current_project_generation(project),
                source,
            )
            return

        mark_git_cache_dirty(project)

        statuses = await asyncio.to_thread(worker_git_service.get_statuses_for_root, project)
        status = await asyncio.to_thread(worker_git_service.get_status, project)
        if _is_stale_git_generation(project, project_generation):
            logger.debug(
                "Dropping stale git refresh after work project=%s generation=%s current=%s source=%s",
                project,
                project_generation,
                current_project_generation(project),
                source,
            )
            return
        logger.info(
            "[GIT_STATUS_DEBUG] staged=%s, unstaged=%s, untracked=%s",
            status.staged,
            status.unstaged,
            status.untracked,
        )
        publisher = _git_status_publisher
        if publisher is None:
            logger.debug("No git status publisher registered for %s", project)
            return

        await publisher(
            str(project),
            {"statuses": statuses},
            {
                "branch": status.branch,
                "detached": status.detached,
                "ahead": status.ahead,
                "behind": status.behind,
                "staged": status.staged,
                "unstaged": status.unstaged,
                "untracked": status.untracked,
            },
        )
    except Exception as exc:
        logger.warning("Failed to broadcast git status update: %s", exc)


def _is_worker_process() -> bool:
    return bool(os.getenv("TE_APP_ID") or os.getenv("TE_APP_WORKER_PORT"))


def _framework_url() -> str:
    return os.environ.get("TE_FRAMEWORK_URL", "http://127.0.0.1:8089").rstrip("/")


def _forward_draft_notification(project_path: str) -> None:
    url = f"{_framework_url()}/api/apps/file_editor_cm6/explorer/notify_drafts"
    payload = {"project": project_path}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        response = cast(UrlOpenResponse, urllib.request.urlopen(req, timeout=2.0))
        with response as resp:
            resp.read()
    except Exception as exc:
        logger.debug("Failed to forward draft notify to main: %s", exc)


def _schedule_forward_draft_refresh(project_path: str) -> None:
    debounce_key = f"drafts-forward:{project_path}"
    with _explorer_refresh_lock:
        existing_timer = _explorer_refresh_timers.get(debounce_key)
        if existing_timer is not None:
            existing_timer.cancel()

        def do_forward() -> None:
            with _explorer_refresh_lock:
                _explorer_refresh_timers.pop(debounce_key, None)
            _forward_draft_notification(project_path)

        timer = Timer(0.5, do_forward)
        _explorer_refresh_timers[debounce_key] = timer
        timer.start()


async def _broadcast_draft_decorations(project_path: str) -> None:
    try:
        from .. import review
        from ...draft_index_sidecar import DraftIndexSidecar

        normalized_path = str(Path(project_path).resolve())

        def _load_snapshot() -> set[str]:
            try:
                idx = DraftIndexSidecar.load_or_create(normalized_path)
                idx.reload()
                files, _dirs = idx.snapshot()
                return files
            except Exception:
                return set()

        draft_files = await asyncio.to_thread(_load_snapshot)
        draft_decorations = {rel: {"hasDraft": True} for rel in draft_files}
        await emit_project_explorer_rpc_notification(
            normalized_path,
            "explorer.decorations.updated",
            {"drafts": draft_decorations},
        )

        reviews = await review.list_reviews(Path(normalized_path), lightweight=False)
        await emit_project_explorer_rpc_notification(
            normalized_path,
            "explorer.review.entries.updated",
            {"entries": reviews},
        )
    except Exception as exc:
        logger.warning("Failed to broadcast draft decorations: %s", exc)


def notify_draft_state_changed(project_path: str) -> None:
    """Schedule a broadcast of updated draft decorations to explorer clients."""

    normalized_path = str(Path(project_path).resolve())

    if _is_worker_process() and not manager.has_connections(normalized_path):
        _schedule_forward_draft_refresh(normalized_path)
        return

    if _explorer_event_loop is None or not manager.has_connections(normalized_path):
        return

    mark_draft_cache_dirty(Path(project_path))

    debounce_key = f"drafts:{normalized_path}"
    with _explorer_refresh_lock:
        existing_timer = _explorer_refresh_timers.get(debounce_key)
        if existing_timer is not None:
            existing_timer.cancel()

        def do_broadcast() -> None:
            with _explorer_refresh_lock:
                _explorer_refresh_timers.pop(debounce_key, None)
            loop = _explorer_event_loop
            if loop is None:
                return
            asyncio.run_coroutine_threadsafe(
                _broadcast_draft_decorations(normalized_path),
                loop,
            )

        timer = Timer(0.5, do_broadcast)
        _explorer_refresh_timers[debounce_key] = timer
        timer.start()
