# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.request
from collections.abc import Awaitable, Callable
from pathlib import Path
from types import TracebackType
from typing import Protocol, cast

from .file_ops import mark_draft_cache_dirty, mark_git_cache_dirty
from ..transport.connection_manager import manager
from ..transport.rpc_emit import emit_project_explorer_rpc_notification
from ...worker_services.event_bus import current_project_generation
from ...worker_services import git_service as worker_git_service

logger = logging.getLogger(__name__)
GitStatusPublisher = Callable[[str, dict[str, object], dict[str, object]], Awaitable[None]]
AsyncNoArg = Callable[[], Awaitable[None]]
DebounceTasks = dict[str, asyncio.Task[None]]


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
_draft_forward_tasks: DebounceTasks = {}
_draft_decorations_tasks: DebounceTasks = {}
_git_status_publisher: GitStatusPublisher | None = None


def set_explorer_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called during app startup to set the event loop for watcher callbacks."""
    global _explorer_event_loop
    _explorer_event_loop = loop


def set_git_status_publisher(publisher: GitStatusPublisher) -> None:
    global _git_status_publisher
    _git_status_publisher = publisher


def _post_to_explorer_loop(callback: Callable[[], None]) -> bool:
    loop = _explorer_event_loop
    if loop is None or not loop.is_running():
        return False
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        running_loop = None
    if running_loop is loop:
        callback()
    else:
        loop.call_soon_threadsafe(callback)
    return True


def _schedule_debounce_task(
    tasks: DebounceTasks,
    key: str,
    *,
    delay: float,
    name: str,
    callback: AsyncNoArg,
) -> None:
    existing = tasks.get(key)
    if existing is not None and not existing.done():
        existing.cancel()

    async def _run() -> None:
        try:
            await asyncio.sleep(delay)
            await callback()
        except asyncio.CancelledError:
            pass
        finally:
            current = asyncio.current_task()
            if current is not None and tasks.get(key) is current:
                tasks.pop(key, None)

    tasks[key] = asyncio.create_task(_run(), name=name)


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
    def _schedule() -> None:
        async def do_forward() -> None:
            await asyncio.to_thread(_forward_draft_notification, project_path)

        _schedule_debounce_task(
            _draft_forward_tasks,
            f"drafts-forward:{project_path}",
            delay=0.5,
            name="file_editor_cm6_draft_forward",
            callback=do_forward,
        )

    _post_to_explorer_loop(_schedule)


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

    def _notify() -> None:
        if _is_worker_process() and not manager.has_connections(normalized_path):
            _schedule_forward_draft_refresh(normalized_path)
            return

        if not manager.has_connections(normalized_path):
            return

        mark_draft_cache_dirty(Path(project_path))

        async def do_broadcast() -> None:
            await _broadcast_draft_decorations(normalized_path)

        _schedule_debounce_task(
            _draft_decorations_tasks,
            f"drafts:{normalized_path}",
            delay=0.5,
            name="file_editor_cm6_draft_decorations",
            callback=do_broadcast,
        )

    _post_to_explorer_loop(_notify)
