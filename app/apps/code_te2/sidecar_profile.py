"""Bounded, content-free ProjectSidecar timing for opt-in runtime debugging."""
from __future__ import annotations

import json
import os
import sys
import threading
from dataclasses import dataclass


ENABLED = os.environ.get("TE2_RUNTIME_DEBUG", "").lower() in {"1", "true", "yes"}
_MAX_OPERATIONS = 24


@dataclass
class _Sample:
    count: int = 0
    total_ns: int = 0
    max_ns: int = 0
    chars: int = 0


_lock = threading.Lock()
_samples: dict[str, _Sample] = {}
_emitted: set[str] = set()


def record(operation: str, elapsed_ns: int = 0, *, chars: int = 0) -> None:
    if not ENABLED:
        return
    with _lock:
        sample = _samples.get(operation)
        if sample is None:
            if len(_samples) >= _MAX_OPERATIONS:
                return
            sample = _Sample()
            _samples[operation] = sample
        sample.count += 1
        sample.total_ns += max(0, elapsed_ns)
        sample.max_ns = max(sample.max_ns, elapsed_ns)
        sample.chars += max(0, chars)


def emit_window(phase: str) -> None:
    """Emit one non-overlapping window, never paths, contents, or draft keys."""
    if not ENABLED:
        return
    with _lock:
        if phase in _emitted:
            return
        _emitted.add(phase)
        samples = dict(_samples)
        _samples.clear()
    operations = {
        name: {
            "count": sample.count,
            "total_ms": round(sample.total_ns / 1_000_000, 3),
            "max_ms": round(sample.max_ns / 1_000_000, 3),
            "chars": sample.chars,
        }
        for name, sample in sorted(samples.items())
    }
    print(
        "[sidecar_profile] " + json.dumps({"phase": phase, "operations": operations}, separators=(",", ":")),
        file=sys.stderr,
        flush=True,
    )
