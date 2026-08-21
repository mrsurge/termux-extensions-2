from __future__ import annotations

import gc
import json
import os
import signal
import sys
import threading
import time
import tracemalloc
from collections import Counter
from pathlib import Path
from types import FrameType
from typing import Any


PROFILE_DIR_ENV = "TE2_MEMORY_PROFILE_DIR"
TRACEBACK_LIMIT_ENV = "TE2_PYTHON_TRACEMALLOC_FRAMES"
_DEFAULT_TRACEBACK_LIMIT = 25
_TOP_ALLOCATION_COUNT = 100
_TOP_OBJECT_TYPE_COUNT = 100
_capture_lock = threading.Lock()
_installed = False


def install_python_memory_profiler(role: str) -> bool:
    """Install an opt-in SIGUSR2 tracemalloc snapshot hook for this process."""

    global _installed
    raw_output_dir = os.environ.get(PROFILE_DIR_ENV, "").strip()
    if not raw_output_dir or _installed:
        return bool(raw_output_dir and _installed)
    if not hasattr(signal, "SIGUSR2"):
        print("[memory-profile] SIGUSR2 is unavailable on this platform", file=sys.stderr)
        return False

    output_dir = Path(raw_output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    if not tracemalloc.is_tracing():
        tracemalloc.start(_traceback_limit())

    normalized_role = _normalize_role(role)

    def _request_capture(_signum: int, _frame: FrameType | None) -> None:
        if _capture_lock.locked():
            print(
                f"[memory-profile] snapshot already running role={normalized_role} pid={os.getpid()}",
                file=sys.stderr,
            )
            return
        threading.Thread(
            target=_capture_snapshot,
            args=(output_dir, normalized_role),
            name=f"te2-memory-profile-{normalized_role}",
            daemon=True,
        ).start()

    _ = signal.signal(signal.SIGUSR2, _request_capture)
    _installed = True
    print(
        f"[memory-profile] tracemalloc ready role={normalized_role} pid={os.getpid()} dir={output_dir}",
        file=sys.stderr,
        flush=True,
    )
    return True


def _capture_snapshot(output_dir: Path, role: str) -> None:
    if not _capture_lock.acquire(blocking=False):
        return
    try:
        captured_at_ns = time.time_ns()
        pid = os.getpid()
        stem = f"python-{role}-{pid}-{captured_at_ns}"
        snapshot = tracemalloc.take_snapshot()
        snapshot_path = output_dir / f"{stem}.tracemalloc"
        summary_path = output_dir / f"{stem}.json"
        snapshot.dump(str(snapshot_path))

        current_bytes, peak_bytes = tracemalloc.get_traced_memory()
        summary = {
            "schemaVersion": 1,
            "capturedAtNs": captured_at_ns,
            "pid": pid,
            "role": role,
            "tracedCurrentBytes": current_bytes,
            "tracedPeakBytes": peak_bytes,
            "processMemoryKb": _process_memory_kb(),
            "garbageCollector": {
                "counts": list(gc.get_count()),
                "thresholds": list(gc.get_threshold()),
                "trackedObjects": len(gc.get_objects()),
                "topTrackedTypes": _top_tracked_types(),
            },
            "topAllocations": _top_allocations(snapshot),
            "snapshot": snapshot_path.name,
        }
        _atomic_write_json(summary_path, summary)
        print(
            f"[memory-profile] wrote {summary_path} and {snapshot_path}",
            file=sys.stderr,
            flush=True,
        )
    except Exception as exc:
        print(f"[memory-profile] snapshot failed: {exc}", file=sys.stderr, flush=True)
    finally:
        _capture_lock.release()


def _traceback_limit() -> int:
    try:
        value = int(os.environ.get(TRACEBACK_LIMIT_ENV, _DEFAULT_TRACEBACK_LIMIT))
    except (TypeError, ValueError):
        return _DEFAULT_TRACEBACK_LIMIT
    return max(1, min(value, 100))


def _normalize_role(value: str) -> str:
    normalized = "".join(character if character.isalnum() or character in "-_" else "_" for character in value)
    return normalized.strip("_") or "python"


def _process_memory_kb() -> dict[str, int]:
    values: dict[str, int] = {}
    try:
        for raw_line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
            key, separator, raw_value = raw_line.partition(":")
            if not separator or key not in {"VmRSS", "VmHWM", "VmSwap", "RssAnon"}:
                continue
            first = raw_value.strip().split(maxsplit=1)[0]
            values[key] = int(first)
    except (OSError, ValueError):
        pass
    return values


def _top_tracked_types() -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    for value in gc.get_objects():
        value_type = type(value)
        counts[f"{value_type.__module__}.{value_type.__qualname__}"] += 1
    return [
        {"type": name, "count": count}
        for name, count in counts.most_common(_TOP_OBJECT_TYPE_COUNT)
    ]


def _top_allocations(snapshot: tracemalloc.Snapshot) -> list[dict[str, Any]]:
    allocations: list[dict[str, Any]] = []
    for statistic in snapshot.statistics("traceback")[:_TOP_ALLOCATION_COUNT]:
        allocations.append(
            {
                "sizeBytes": statistic.size,
                "count": statistic.count,
                "traceback": [str(frame) for frame in statistic.traceback],
            }
        )
    return allocations


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(
            json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
