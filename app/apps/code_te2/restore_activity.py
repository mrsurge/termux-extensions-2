"""Event-loop-owned explicit restore activity, independent of editor imports."""
from pathlib import Path

active_paths: set[str] = set()


def is_restoring(path: str) -> bool:
    return str(Path(path).resolve()) in active_paths
