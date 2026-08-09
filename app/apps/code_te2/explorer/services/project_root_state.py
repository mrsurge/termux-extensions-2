# pyright: strict
from __future__ import annotations

import threading
from pathlib import Path

_LOCK = threading.RLock()
_project_root = Path.home()


def set_project_root(path: str) -> Path:
    """Set the Explorer project root after validation."""
    candidate = Path(path).expanduser().resolve()
    if not candidate.exists() or not candidate.is_dir():
        raise ValueError("project path must be an existing directory")
    global _project_root
    with _LOCK:
        _project_root = candidate
    return candidate


def get_project_root() -> Path:
    """Return the current Explorer project root."""
    with _LOCK:
        return _project_root
