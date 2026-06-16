# pyright: strict
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal, TypedDict, cast

logger = logging.getLogger(__name__)

EventType = Literal[
    "DraftStateChanged",
    "DiagnosticsDetailChanged",
    "GitDiffBaseChanged",
    "GitPathRestored",
    "GitSnapshotRequested",
    "GitSnapshotChanged",
    "OpenStateChanged",
    "PreferencesChanged",
    "ProjectSwitchStarted",
    "ProjectSwitchFinished",
    "ReviewStateChanged",
    "ExplorerRenderStateChanged",
    "WatcherConfigChanged",
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


def _env_flag(name: str) -> bool:
    value = os.getenv(name, "")
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


# Metrics are a default-off control-plane observer. They publish stdout JSON for
# FWS inspection and never feed observations back through the event bus.
_metrics_enabled = _env_flag("FILE_EDITOR_CM6_EVENT_METRICS")
_metrics_interval_s = _env_float("FILE_EDITOR_CM6_EVENT_METRICS_INTERVAL_S", 30.0)
_metrics_slow_handler_ms = _env_float(
    "FILE_EDITOR_CM6_EVENT_METRICS_SLOW_HANDLER_MS",
    25.0,
)
_metrics_slow_queue_ms = _env_float("FILE_EDITOR_CM6_EVENT_METRICS_SLOW_QUEUE_MS", 50.0)
_metrics_summary_task: asyncio.Task[None] | None = None
_metrics_enqueue_ms_by_event_id: dict[int, int] = {}
_metrics_published_by_type: dict[str, int] = {}
_metrics_delivered_by_type: dict[str, int] = {}
_metrics_handler_errors_by_type: dict[str, int] = {}
_metrics_slow_handlers_by_type: dict[str, int] = {}
_metrics_slow_queue_by_type: dict[str, int] = {}
_metrics_stale_drops_by_type: dict[str, int] = {}
_metrics_stale_drops_by_source: dict[str, int] = {}
_metrics_coalesced_by_label: dict[str, int] = {}
_metrics_max_queue_depth = 0
_metrics_max_queue_latency_ms = 0.0
_metrics_max_handler_ms = 0.0


def set_worker_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Register the app-worker loop used by thread-safe event ingress."""
    global _loop, _queue, _dispatcher_task
    _loop = loop
    if _queue is None:
        _queue = asyncio.Queue()
    if _dispatcher_task is None or _dispatcher_task.done():
        _dispatcher_task = loop.create_task(_dispatch_loop(), name="file_editor_cm6_event_bus")
    if _metrics_enabled:
        _ensure_metrics_summary_task(loop)


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
        if _metrics_enabled:
            _metrics_record_direct_publish(event)
        await _deliver(event)
        return
    await queue.put(event)
    if _metrics_enabled:
        _metrics_record_enqueued(event, queue.qsize())


def publish_threadsafe(event: WorkerEvent) -> bool:
    """Post an event from a watcher/thread callback into the worker loop."""
    loop = _loop
    queue = _queue
    if loop is None or queue is None or not loop.is_running():
        return False

    def _enqueue() -> None:
        queue.put_nowait(event)
        if _metrics_enabled:
            _metrics_record_enqueued(event, queue.qsize())

    loop.call_soon_threadsafe(_enqueue)
    return True


async def _dispatch_loop() -> None:
    queue = _queue
    if queue is None:
        return
    while True:
        event = await queue.get()
        try:
            if _metrics_enabled:
                _metrics_record_dequeued(event, queue.qsize())
            await _deliver(event)
        finally:
            queue.task_done()


async def _deliver(event: WorkerEvent) -> None:
    if not _metrics_enabled:
        await _deliver_without_metrics(event)
        return

    handlers = list(_handlers.get(event["type"], []))
    for handler in handlers:
        handler_name = getattr(handler, "__name__", repr(handler))
        started = time.perf_counter()
        try:
            await handler(event)
        except Exception as exc:
            _metrics_increment(_metrics_handler_errors_by_type, event["type"])
            logger.warning(
                "[event_bus] handler failed type=%s handler=%s error=%s",
                event["type"],
                handler_name,
                exc,
            )
        finally:
            duration_ms = (time.perf_counter() - started) * 1000.0
            _metrics_record_handler_duration(
                event_type=event["type"],
                handler_name=handler_name,
                duration_ms=duration_ms,
            )


async def _deliver_without_metrics(event: WorkerEvent) -> None:
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


def record_stale_drop(
    source: str,
    event_type: EventType | str,
) -> None:
    """Count a stale project-generation drop when metrics are enabled."""
    if not _metrics_enabled:
        return
    type_key = str(event_type)
    _metrics_increment(_metrics_stale_drops_by_type, type_key)
    _metrics_increment(_metrics_stale_drops_by_source, f"{source}:{type_key}")


def record_coalesced_event(label: str, event_type: EventType | str) -> None:
    """Count a cancelled/coalesced control-plane event when metrics are enabled."""
    if not _metrics_enabled:
        return
    _metrics_increment(_metrics_coalesced_by_label, f"{label}:{event_type}")


def _ensure_metrics_summary_task(loop: asyncio.AbstractEventLoop) -> None:
    global _metrics_summary_task
    if _metrics_summary_task is None or _metrics_summary_task.done():
        _metrics_summary_task = loop.create_task(
            _metrics_summary_loop(),
            name="file_editor_cm6_event_bus_metrics",
        )


async def _metrics_summary_loop() -> None:
    while True:
        await asyncio.sleep(_metrics_interval_s)
        _metrics_emit_summary()


def _metrics_record_direct_publish(event: WorkerEvent) -> None:
    _metrics_increment(_metrics_published_by_type, event["type"])
    _metrics_increment(_metrics_delivered_by_type, event["type"])


def _metrics_record_enqueued(event: WorkerEvent, queue_depth: int) -> None:
    global _metrics_max_queue_depth
    _metrics_increment(_metrics_published_by_type, event["type"])
    _metrics_enqueue_ms_by_event_id[id(event)] = _now_ms()
    if queue_depth > _metrics_max_queue_depth:
        _metrics_max_queue_depth = queue_depth


def _metrics_record_dequeued(event: WorkerEvent, queue_depth: int) -> None:
    global _metrics_max_queue_depth, _metrics_max_queue_latency_ms
    _metrics_increment(_metrics_delivered_by_type, event["type"])
    if queue_depth > _metrics_max_queue_depth:
        _metrics_max_queue_depth = queue_depth
    enqueued_at_ms = _metrics_enqueue_ms_by_event_id.pop(id(event), None)
    if enqueued_at_ms is None:
        return
    latency_ms = float(max(0, _now_ms() - enqueued_at_ms))
    if latency_ms > _metrics_max_queue_latency_ms:
        _metrics_max_queue_latency_ms = latency_ms
    if latency_ms > _metrics_slow_queue_ms:
        _metrics_increment(_metrics_slow_queue_by_type, event["type"])
        _metrics_emit(
            "slow_queue",
            {
                "event_type": event["type"],
                "project_root": event["project_root"],
                "project_generation": event["project_generation"],
                "latency_ms": round(latency_ms, 3),
                "queue_depth": queue_depth,
                "source": event["source"],
                "correlation_id": event["correlation_id"],
            },
        )


def _metrics_record_handler_duration(
    *,
    event_type: EventType,
    handler_name: str,
    duration_ms: float,
) -> None:
    global _metrics_max_handler_ms
    if duration_ms > _metrics_max_handler_ms:
        _metrics_max_handler_ms = duration_ms
    if duration_ms > _metrics_slow_handler_ms:
        _metrics_increment(_metrics_slow_handlers_by_type, event_type)
        _metrics_emit(
            "slow_handler",
            {
                "event_type": event_type,
                "handler": handler_name,
                "duration_ms": round(duration_ms, 3),
            },
        )


def _metrics_emit_summary() -> None:
    global _metrics_max_queue_depth, _metrics_max_queue_latency_ms, _metrics_max_handler_ms
    if not _metrics_has_activity():
        return
    queue = _queue
    _metrics_emit(
        "summary",
        {
            "interval_s": _metrics_interval_s,
            "queue_depth": queue.qsize() if queue is not None else 0,
            "max_queue_depth": _metrics_max_queue_depth,
            "max_queue_latency_ms": round(_metrics_max_queue_latency_ms, 3),
            "max_handler_ms": round(_metrics_max_handler_ms, 3),
            "published": dict(_metrics_published_by_type),
            "delivered": dict(_metrics_delivered_by_type),
            "handler_errors": dict(_metrics_handler_errors_by_type),
            "slow_handlers": dict(_metrics_slow_handlers_by_type),
            "slow_queue": dict(_metrics_slow_queue_by_type),
            "stale_drops": dict(_metrics_stale_drops_by_type),
            "stale_drops_by_source": dict(_metrics_stale_drops_by_source),
            "coalesced": dict(_metrics_coalesced_by_label),
        },
    )
    _metrics_published_by_type.clear()
    _metrics_delivered_by_type.clear()
    _metrics_handler_errors_by_type.clear()
    _metrics_slow_handlers_by_type.clear()
    _metrics_slow_queue_by_type.clear()
    _metrics_stale_drops_by_type.clear()
    _metrics_stale_drops_by_source.clear()
    _metrics_coalesced_by_label.clear()
    _metrics_max_queue_depth = 0
    _metrics_max_queue_latency_ms = 0.0
    _metrics_max_handler_ms = 0.0


def _metrics_has_activity() -> bool:
    return (
        bool(_metrics_published_by_type)
        or bool(_metrics_delivered_by_type)
        or bool(_metrics_handler_errors_by_type)
        or bool(_metrics_slow_handlers_by_type)
        or bool(_metrics_slow_queue_by_type)
        or bool(_metrics_stale_drops_by_type)
        or bool(_metrics_coalesced_by_label)
        or _metrics_max_queue_depth > 0
        or _metrics_max_queue_latency_ms > 0
        or _metrics_max_handler_ms > 0
    )


def _metrics_increment(counter: dict[str, int], key: str) -> None:
    counter[key] = counter.get(key, 0) + 1


def _metrics_emit(kind: str, payload: dict[str, object]) -> None:
    record: dict[str, object] = {
        "system": "file_editor_cm6.event_bus",
        "kind": kind,
        "ts_ms": _now_ms(),
    }
    record.update(payload)
    try:
        print(json.dumps(record, sort_keys=True), flush=True)
    except Exception as exc:
        logger.debug("[event_bus] failed to emit metrics kind=%s error=%s", kind, exc)


def _now_ms() -> int:
    return int(time.time() * 1000)


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


def event_payload_object(event: WorkerEvent, key: str) -> dict[str, object]:
    value = event["payload"].get(key)
    if not isinstance(value, dict):
        return {}
    return {
        key: item
        for key, item in cast(dict[object, object], value).items()
        if isinstance(key, str)
    }
