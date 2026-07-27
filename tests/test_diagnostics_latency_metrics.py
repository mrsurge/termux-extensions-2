from __future__ import annotations

import json
import unittest
from contextlib import redirect_stdout
from io import StringIO

from app.apps.file_editor_cm6.diagnostics_latency_metrics import (
    DiagnosticsLatencyMetrics,
    sample_engineio_queues,
)


class _Queue:
    def __init__(self, depth: int) -> None:
        self._depth = depth

    def qsize(self) -> int:
        return self._depth


class _Socket:
    def __init__(self, depth: int) -> None:
        self.queue = _Queue(depth)


class _Engine:
    def __init__(self) -> None:
        self.sockets = {"a": _Socket(2), "b": _Socket(5)}


class _Server:
    def __init__(self) -> None:
        self.eio = _Engine()


class DiagnosticsLatencyMetricsTests(unittest.TestCase):
    def test_disabled_metrics_emit_nothing(self) -> None:
        output = StringIO()
        metrics = DiagnosticsLatencyMetrics(enabled=False)
        with redirect_stdout(output):
            metrics.record("ignored", {"value": 1})
            metrics.begin_open("open-1", "/workspace/a.py", "test")
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(metrics.open_trace_count, 0)

    def test_open_trace_records_are_correlated_and_bounded(self) -> None:
        output = StringIO()
        metrics = DiagnosticsLatencyMetrics(enabled=True, max_open_traces=1)
        with redirect_stdout(output):
            metrics.begin_open("open-1", "/workspace/a.py", "test")
            metrics.begin_open("open-2", "/workspace/b.py", "test")
            metrics.record_open_stage("open-2", "file_read", duration_ms=1.25)
            metrics.finish_open("open-2", "complete")

        records = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(metrics.open_trace_count, 0)
        self.assertEqual(records[-1]["request_id"], "open-2")
        self.assertEqual(records[-1]["stage"], "complete")
        self.assertNotIn("content", records[-1])

    def test_engineio_queue_sampler_reports_aggregate_depth(self) -> None:
        sample = sample_engineio_queues(_Server())
        self.assertEqual(
            sample,
            {"sockets": 2, "queued_packets": 7, "max_queue_depth": 5},
        )


if __name__ == "__main__":
    unittest.main()
