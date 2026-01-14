from __future__ import annotations

import time
from threading import Lock
from typing import Any, Dict, Optional

_state_lock = Lock()
_drawer_state: Dict[str, Any] = {
    "open_count": 0,
    "last_opened_at": None,
    "last_source": None,
    "ui_hints": {},
}


def record_drawer_open(source: Optional[str] = None) -> Dict[str, Any]:
    """Track drawer open events and return the current drawer state."""
    with _state_lock:
        _drawer_state["open_count"] += 1
        _drawer_state["last_opened_at"] = time.time()
        _drawer_state["last_source"] = source
        return _drawer_state.copy()


def update_ui_hints(hints: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Merge UI hint updates into the drawer state."""
    if hints is None:
        hints = {}
    with _state_lock:
        if isinstance(hints, dict):
            _drawer_state["ui_hints"].update(hints)
        return _drawer_state.copy()
