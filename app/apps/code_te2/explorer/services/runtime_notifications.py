# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.request
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from types import TracebackType
from typing import Protocol, cast

from .file_ops import mark_draft_cache_dirty, mark_git_cache_dirty
from .git_diff_base import project_diff_base
from . import git_comparison
from .state_facts import publish_draft_state_changed, publish_review_state_changed
from ..transport.connection_manager import manager
from ...worker_services.event_bus import (
    build_event,
    current_project_generation,
    publish as publish_worker_event,
    record_coalesced_event,
    record_stale_drop,
)
from ...worker_services import git_service as worker_git_service
from ...stores import get_history_store
from ...worker_services.latest_projection import LatestProjection, Current

logger = logging.getLogger(__name__)
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
_git_projection = LatestProjection("code_te2_git_projection")
_git_content_revision = 0
_git_published_content_revision = 0
_git_refresh_revision = 0


def set_explorer_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called during app startup to set the event loop for watcher callbacks."""
    global _explorer_event_loop
    _explorer_event_loop = loop


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
        _ = loop.call_soon_threadsafe(callback)
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
        _ = existing.cancel()
        record_coalesced_event(name, name)

    async def _run() -> None:
        try:
            await asyncio.sleep(delay)
            await callback()
        except asyncio.CancelledError:
            pass
        finally:
            current = asyncio.current_task()
            if current is not None and tasks.get(key) is current:
                _ = tasks.pop(key, None)

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
    is_current: Current = lambda: True,
    selection_revision: str | None = None,
    selection_only: bool = False,
) -> bool:
    global _git_refresh_revision
    _git_refresh_revision += 1
    revision = _git_refresh_revision
    project = Path(project_path)
    normalized_project = str(project.expanduser().resolve(strict=False))
    try:
        if not is_current() or _is_stale_git_generation(project, project_generation):
            record_stale_drop("runtime_notifications:git_refresh_before_work", "GitSnapshotRequested")
            logger.debug(
                "Dropping stale git refresh before work project=%s generation=%s current=%s source=%s",
                project,
                project_generation,
                current_project_generation(project),
                source,
            )
            return False

        mark_git_cache_dirty(project)

        snapshot = await asyncio.to_thread(
            worker_git_service.get_snapshot,
            project,
            project_generation=project_generation,
        )
        if not is_current():
            return False
        base_ref = get_history_store().get_diff_base(normalized_project)
        diff_base: dict[str, object] | None = None
        try:
            diff_base = await asyncio.to_thread(project_diff_base, project, base_ref, snapshot)
        except Exception as exc:
            logger.warning("Failed to resolve comparison base for %s: %s", project, exc)
        if not is_current():
            return False
        comparison = git_comparison.Comparison(base_ref, dict(snapshot["statuses"]))
        comparison_error = None
        if base_ref != "HEAD":
            try:
                commit = diff_base.get("commit") if diff_base else None
                commit_data = cast(dict[str, object], commit) if isinstance(commit, dict) else {}
                commit_hash = commit_data.get("hash")
                if not isinstance(commit_hash, str):
                    raise ValueError("Historical comparison commit is unavailable")
                comparison = await asyncio.to_thread(git_comparison.compute, project, base_ref, commit_hash)
            except Exception as exc:
                comparison = git_comparison.Comparison(base_ref, {})
                comparison_error = str(exc)
        nodes, actual_nodes = await asyncio.to_thread(
            lambda: (
                _git_tree_decorations(comparison.statuses),
                _git_tree_decorations(git_comparison.actual_statuses(snapshot)),
            ),
        )
        if not is_current() or revision != _git_refresh_revision:
            return False
        if get_history_store().get_diff_base(normalized_project) != base_ref:
            return False
        if _is_stale_git_generation(project, project_generation):
            record_stale_drop("runtime_notifications:git_refresh_after_work", "GitSnapshotRequested")
            mark_git_cache_dirty(project)
            logger.debug(
                "Dropping stale git refresh after work project=%s generation=%s current=%s source=%s",
                project,
                project_generation,
                current_project_generation(project),
                source,
            )
            return False
        logger.info(
            "[GIT_STATUS_DEBUG] staged=%s, unstaged=%s, untracked=%s",
            snapshot["staged"],
            snapshot["unstaged"],
            snapshot["untracked"],
        )
        git_comparison.install(project, comparison)
        decorations_payload: dict[str, object] = {
            "statuses": snapshot["statuses"],
            "nodes": nodes,
            "actualNodes": actual_nodes,
            "comparisonRef": base_ref,
            "comparisonError": comparison_error,
            "projectPath": normalized_project,
        }
        status_payload: dict[str, object] = {
            "branch": snapshot["branch"],
            "detached": snapshot["detached"],
            "ahead": snapshot["ahead"],
            "behind": snapshot["behind"],
            "staged": snapshot["staged"],
            "unstaged": snapshot["unstaged"],
            "untracked": snapshot["untracked"],
            "projectPath": normalized_project,
            "isRepository": snapshot["isRepository"],
            "hasHead": snapshot["hasHead"],
            "head": snapshot["head"],
            "selectionRevision": selection_revision,
            "selectionOnly": selection_only,
        }
        if diff_base is not None:
            status_payload["diffBase"] = diff_base
        # Git snapshot completion is a typed control-plane fact; Explorer and
        # editor-side projectors decide how to publish it to their own lanes.
        await publish_worker_event(
            build_event(
                "GitSnapshotChanged",
                project_root=normalized_project,
                project_generation=project_generation,
                source=source,
                payload={
                    "decorations": decorations_payload,
                    "status": status_payload,
                },
            )
        )
        return True
    except Exception as exc:
        logger.warning("Failed to broadcast git status update: %s", exc)
        return False


def schedule_git_status_update(
    project_path: str | Path,
    *,
    project_generation: int | None = None,
    source: str = "runtime_notifications:scheduled_git_status",
    delay: float = 0.1,
    selection_revision: str | None = None,
    require_connection: bool = True,
) -> None:
    """Schedule bounded latest-only Git projection without cancelling native reads."""
    project = Path(project_path)
    normalized_project = str(project.expanduser().resolve(strict=False))

    def _schedule() -> None:
        global _git_content_revision
        if _is_stale_git_generation(project, project_generation):
            return
        if require_connection and not manager.has_connections(normalized_project):
            return
        mark_git_cache_dirty(project)
        if selection_revision is None:
            _git_content_revision += 1
        content_revision = _git_content_revision

        async def do_broadcast(current: Current) -> None:
            global _git_published_content_revision
            if delay:
                await asyncio.sleep(delay)
            if not current():
                return
            published = await broadcast_git_status_update(
                normalized_project,
                project_generation=project_generation,
                source=source,
                is_current=current,
                selection_revision=selection_revision,
                selection_only=selection_revision is not None and content_revision == _git_published_content_revision,
            )
            if current() and published:
                _git_published_content_revision = content_revision

        _git_projection.submit(do_broadcast)

    _ = _post_to_explorer_loop(_schedule)


def _git_tree_decorations(statuses: Mapping[str, str]) -> dict[str, object]:
    from .file_ops import build_git_tree_decorations

    return cast(dict[str, object], build_git_tree_decorations(statuses))


def _is_worker_process() -> bool:
    return bool(os.getenv("TE_APP_ID") or os.getenv("TE_APP_WORKER_PORT"))


def _framework_url() -> str:
    return os.environ.get("TE_FRAMEWORK_URL", "http://127.0.0.1:8089").rstrip("/")


def _forward_draft_notification(project_path: str) -> None:
    url = f"{_framework_url()}/api/apps/code_te2/explorer/notify_drafts"
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
            _ = resp.read()
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
            name="code_te2_draft_forward",
            callback=do_forward,
        )

    _ = _post_to_explorer_loop(_schedule)


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
        draft_decorations: dict[str, object] = {
            rel: {"hasDraft": True} for rel in draft_files
        }
        await publish_draft_state_changed(
            normalized_path,
            {"drafts": draft_decorations},
            source="runtime_notifications:draft_decorations",
        )

        reviews = await review.list_reviews(Path(normalized_path), lightweight=False)
        await publish_review_state_changed(
            normalized_path,
            {"entries": reviews},
            source="runtime_notifications:review_entries",
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
            name="code_te2_draft_decorations",
            callback=do_broadcast,
        )

    _ = _post_to_explorer_loop(_notify)
