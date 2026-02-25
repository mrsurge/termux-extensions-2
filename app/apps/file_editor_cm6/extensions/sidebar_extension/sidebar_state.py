from __future__ import annotations

import time
from collections import deque
from threading import Lock
from typing import Any, Dict, Optional

_state_lock = Lock()
_drawer_state: Dict[str, Any] = {
    "open_count": 0,
    "last_opened_at": None,
    "last_source": None,
    "ui_hints": {},
}

_open_request_lock = Lock()
_open_requests: "deque[Dict[str, Any]]" = deque()


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


def enqueue_open_request(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Queue a request to open a file at a location (consumed by the host UI)."""
    if not isinstance(payload, dict):
        payload = {}
    item: Dict[str, Any] = {
        "ts": time.time(),
        "rel": payload.get("rel"),
        "path": payload.get("path") or payload.get("abs"),
        "line": payload.get("line"),
        "column": payload.get("column"),
        "source": payload.get("source"),
        "conversation_id": payload.get("conversation_id"),
    }
    with _open_request_lock:
        _open_requests.append(item)
        return item.copy()


def pop_open_request() -> Optional[Dict[str, Any]]:
    """Pop the next open request, or None if queue is empty."""
    with _open_request_lock:
        if not _open_requests:
            return None
        return _open_requests.popleft()
