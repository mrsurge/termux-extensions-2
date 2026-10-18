"""Event-loop-owned watcher fence for explicit restores and editor disk writes.

The historical names remain shared with guarded restore/edit owners. Writers
must publish their committed SHA before releasing this in-flight fence.
"""
from pathlib import Path

active_paths: set[str] = set()


def is_restoring(path: str) -> bool:
    return str(Path(path).resolve()) in active_paths
