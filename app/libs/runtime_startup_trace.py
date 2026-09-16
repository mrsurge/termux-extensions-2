"""Opt-in startup boundaries, kept off protocol stdout and free of app payloads."""
from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager


class StartupTrace:
    def __init__(self, app_id: str) -> None:
        self.enabled: bool = os.environ.get("TE2_RUNTIME_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
        self.app_id: str = app_id
        self.started: float = time.perf_counter()

    def mark(self, phase: str, *, elapsed_ms: float | None = None, outcome: str = "ok") -> None:
        if not self.enabled:
            return
        # PID plus process-local elapsed time identifies this boot without claiming
        # comparable monotonic epochs across the framework, browser and worker.
        record = {"appId": self.app_id, "pid": os.getpid(), "phase": phase,
                  "sinceEntryMs": round((time.perf_counter() - self.started) * 1000, 3),
                  "elapsedMs": elapsed_ms, "outcome": outcome}
        try:
            print("[startup_timing] " + json.dumps(record), file=sys.stderr, flush=True)
        except OSError:
            pass  # Diagnostics must not prevent startup if the log sink closes.

    @contextmanager
    def span(self, phase: str) -> Iterator[None]:
        if not self.enabled:
            yield
            return
        started = time.perf_counter()
        self.mark(phase + ".begin")
        outcome = "ok"
        try:
            yield
        except BaseException:
            outcome = "error"
            raise
        finally:
            self.mark(phase + ".end", elapsed_ms=round((time.perf_counter() - started) * 1000, 3), outcome=outcome)
