# pyright: strict
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal, TypedDict, cast

logger = logging.getLogger(__name__)

EventType = Literal[
    "GitSnapshotRequested",
    "ProjectSwitchStarted",
    "ProjectSwitchFinished",
    "WatcherErrorRaised",
    "WorkspaceFilesChanged",
]

JsonObject = dict[str, object]
EventHandler = Callable[["WorkerEvent"], Awaitable[None]]


class WorkerEvent(TypedDict):
    type: EventType
    project_root: str | None
    project_generation: int | None
    emitted_at_ms: int
    source: str
    correlation_id: str | None
    payload: JsonObject


_loop: asyncio.AbstractEventLoop | None = None
_queue: asyncio.Queue[WorkerEvent] | None = None
_dispatcher_task: asyncio.Task[None] | None = None
_handlers: dict[EventType, list[EventHandler]] = {}
_project_generation = 0
_current_project_root: str | None = None


def set_worker_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Register the app-worker loop used by thread-safe event ingress."""
    global _loop, _queue, _dispatcher_task
    _loop = loop
    if _queue is None:
        _queue = asyncio.Queue()
    if _dispatcher_task is None or _dispatcher_task.done():
        _dispatcher_task = loop.create_task(_dispatch_loop(), name="file_editor_cm6_event_bus")


def current_project_generation(project_root: str | Path | None = None) -> int | None:
    """Return the current project generation, optionally scoped to project_root."""
    if project_root is None:
        return _project_generation or None
    normalized = _normalize_project_root(project_root)
    if normalized == _current_project_root:
        return _project_generation or None
    return None


def next_project_generation(project_root: str | Path) -> int:
    """Mint a new monotonic generation for the active project root."""
    global _project_generation, _current_project_root
    _project_generation += 1
    _current_project_root = _normalize_project_root(project_root)
    return _project_generation


def build_event(
    event_type: EventType,
    *,
    project_root: str | Path | None = None,
    project_generation: int | None = None,
    source: str,
    payload: JsonObject | None = None,
    correlation_id: str | None = None,
) -> WorkerEvent:
    return {
        "type": event_type,
        "project_root": _normalize_project_root(project_root) if project_root is not None else None,
        "project_generation": project_generation,
        "emitted_at_ms": int(time.time() * 1000),
        "source": source,
        "correlation_id": correlation_id,
        "payload": dict(payload or {}),
    }


def subscribe(event_type: EventType, handler: EventHandler) -> None:
    """Register an async handler for a worker event type."""
    handlers = _handlers.setdefault(event_type, [])
    if handler not in handlers:
        handlers.append(handler)


async def publish(event: WorkerEvent) -> None:
    """Publish an event on the worker loop through the dispatcher queue."""
    queue = _queue
    if queue is None:
        await _deliver(event)
        return
    await queue.put(event)


def publish_threadsafe(event: WorkerEvent) -> bool:
    """Post an event from a watcher/thread callback into the worker loop."""
    loop = _loop
    queue = _queue
    if loop is None or queue is None or not loop.is_running():
        return False

    def _enqueue() -> None:
        queue.put_nowait(event)

    loop.call_soon_threadsafe(_enqueue)
    return True


async def _dispatch_loop() -> None:
    queue = _queue
    if queue is None:
        return
    while True:
        event = await queue.get()
        try:
            await _deliver(event)
        finally:
            queue.task_done()


async def _deliver(event: WorkerEvent) -> None:
    handlers = list(_handlers.get(event["type"], []))
    for handler in handlers:
        try:
            await handler(event)
        except Exception as exc:
            logger.warning(
                "[event_bus] handler failed type=%s handler=%s error=%s",
                event["type"],
                getattr(handler, "__name__", repr(handler)),
                exc,
            )


def _normalize_project_root(project_root: str | Path) -> str:
    try:
        return str(Path(project_root).expanduser().resolve(strict=False))
    except Exception:
        return str(project_root)


def event_payload_list(event: WorkerEvent, key: str) -> list[str]:
    value = event["payload"].get(key)
    if not isinstance(value, list):
        return []
    return [item for item in cast(list[object], value) if isinstance(item, str)]
