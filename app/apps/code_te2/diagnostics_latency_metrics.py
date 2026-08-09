# pyright: strict
"""Default-off diagnostics/open latency observations for Code TE2."""

from __future__ import annotations

import json
import os
import time
from collections import OrderedDict
from collections.abc import Mapping
from typing import TypedDict, cast, final

METRICS_ENV = "CODE_TE2_DIAGNOSTICS_LATENCY_METRICS"
METRICS_SYSTEM = "code_te2.diagnostics_latency"


class OpenTrace(TypedDict):
    started_ns: int
    path: str
    source: str


class EngineIoQueueSample(TypedDict):
    sockets: int
    queued_packets: int
    max_queue_depth: int


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def elapsed_ms(started_ns: int) -> float:
    if started_ns <= 0:
        return 0.0
    return round((time.perf_counter_ns() - started_ns) / 1_000_000, 3)


@final
class DiagnosticsLatencyMetrics:
    """Emit bounded, content-free timing records while explicitly enabled."""

    def __init__(self, *, enabled: bool, max_open_traces: int = 128) -> None:
        self.enabled = enabled
        self.max_open_traces = max(1, max_open_traces)
        self._open_traces: OrderedDict[str, OpenTrace] = OrderedDict()

    def record(self, kind: str, fields: Mapping[str, object] | None = None) -> None:
        if not self.enabled:
            return
        record: dict[str, object] = {
            "system": METRICS_SYSTEM,
            "kind": kind,
            "ts_ms": int(time.time() * 1000),
        }
        if fields:
            record.update(fields)
        print(json.dumps(record, sort_keys=True, separators=(",", ":"), default=str), flush=True)

    def begin_open(self, request_id: str, path: str, source: str) -> None:
        if not self.enabled or not request_id:
            return
        self._open_traces[request_id] = {
            "started_ns": time.perf_counter_ns(),
            "path": path,
            "source": source,
        }
        self._open_traces.move_to_end(request_id)
        while len(self._open_traces) > self.max_open_traces:
            _ = self._open_traces.popitem(last=False)
        self.record(
            "open_stage",
            {
                "request_id": request_id,
                "path": path,
                "source": source,
                "stage": "backend_received",
                "total_ms": 0.0,
            },
        )

    def record_open_stage(
        self,
        request_id: str,
        stage: str,
        *,
        duration_ms: float | None = None,
        fields: Mapping[str, object] | None = None,
    ) -> None:
        if not self.enabled or not request_id:
            return
        trace = self._open_traces.get(request_id)
        record: dict[str, object] = {
            "request_id": request_id,
            "stage": stage,
        }
        if trace is not None:
            record.update(
                {
                    "path": trace["path"],
                    "source": trace["source"],
                    "total_ms": elapsed_ms(trace["started_ns"]),
                }
            )
            self._open_traces.move_to_end(request_id)
        if duration_ms is not None:
            record["duration_ms"] = round(duration_ms, 3)
        if fields:
            record.update(fields)
        self.record("open_stage", record)

    def finish_open(
        self,
        request_id: str,
        stage: str,
        *,
        duration_ms: float | None = None,
        fields: Mapping[str, object] | None = None,
    ) -> None:
        self.record_open_stage(
            request_id,
            stage,
            duration_ms=duration_ms,
            fields=fields,
        )
        _ = self._open_traces.pop(request_id, None)

    @property
    def open_trace_count(self) -> int:
        return len(self._open_traces)


_METRICS = DiagnosticsLatencyMetrics(enabled=_env_flag(METRICS_ENV))


def diagnostics_latency_metrics_enabled() -> bool:
    return _METRICS.enabled


def record_latency_event(
    kind: str,
    fields: Mapping[str, object] | None = None,
) -> None:
    _METRICS.record(kind, fields)


def begin_open_trace(request_id: str, path: str, source: str) -> None:
    _METRICS.begin_open(request_id, path, source)


def record_open_stage(
    request_id: str,
    stage: str,
    *,
    duration_ms: float | None = None,
    fields: Mapping[str, object] | None = None,
) -> None:
    _METRICS.record_open_stage(
        request_id,
        stage,
        duration_ms=duration_ms,
        fields=fields,
    )


def finish_open_trace(
    request_id: str,
    stage: str,
    *,
    duration_ms: float | None = None,
    fields: Mapping[str, object] | None = None,
) -> None:
    _METRICS.finish_open(
        request_id,
        stage,
        duration_ms=duration_ms,
        fields=fields,
    )


def sample_engineio_queues(owner: object) -> EngineIoQueueSample:
    """Best-effort packet queue sample from a Socket.IO server or namespace."""
    server = getattr(owner, "server", owner)
    engine = getattr(server, "eio", None)
    sockets_obj = getattr(engine, "sockets", None)
    if not isinstance(sockets_obj, dict):
        return {"sockets": 0, "queued_packets": 0, "max_queue_depth": 0}

    queued_packets = 0
    max_queue_depth = 0
    sockets = cast(dict[object, object], sockets_obj)
    for socket in sockets.values():
        queue = getattr(socket, "queue", None)
        qsize = getattr(queue, "qsize", None)
        if not callable(qsize):
            continue
        try:
            depth_obj = qsize()
        except Exception:
            continue
        if not isinstance(depth_obj, int):
            continue
        depth = depth_obj
        queued_packets += depth
        max_queue_depth = max(max_queue_depth, depth)
    return {
        "sockets": len(sockets),
        "queued_packets": queued_packets,
        "max_queue_depth": max_queue_depth,
    }
