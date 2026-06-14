# app/apps/file_editor_cm6/edit_tracker.py

"""
Live agent edit tracker for Code CM6.

Monitors framework shells (terminal and agent drawer) and tracks file modifications
in real-time, enabling auto-jump to edited lines when agents make changes.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable, Protocol, cast

from .stores import get_history_store

JsonDict = dict[str, object]
EditCallback = Callable[[JsonDict], None]

_history_store = get_history_store()

_lock = threading.Lock()

# Active shell watchers: shell_id -> shell_type ('terminal' | 'agent')
_active_shells: dict[str, str] = {}

# WebSocket subscribers: token -> callback
_subscribers: dict[str, EditCallback] = {}

# Last tracked edit state
_last_edit: JsonDict | None = None

# Project root (set by main app)
_project_root: Path | None = None
_project_root_str: str | None = None


class CollectDiffFn(Protocol):
    def __call__(self, project_root: Path, rel_path: str, *, base_ref: str | None = None) -> object: ...


def _json_object(value: object) -> JsonDict:
    if not isinstance(value, dict):
        return {}
    return {str(key): item for key, item in cast(dict[object, object], value).items()}


def _json_object_list(value: object) -> list[JsonDict]:
    if not isinstance(value, list):
        return []
    result: list[JsonDict] = []
    for item in cast(list[object], value):
        entry = _json_object(item)
        if entry:
            result.append(entry)
    return result


def _int_value(value: object, default: int = 0) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return default
    return default


def _collect_diff(project_root: Path, rel_path: str, *, base_ref: str | None = None) -> JsonDict:
    from . import diff_helper as _diff_helper

    fn = cast(CollectDiffFn, cast(object, getattr(_diff_helper, "collect_diff")))
    return _json_object(fn(project_root, rel_path, base_ref=base_ref))


def set_project_root(root: Path) -> None:
    """Set the active project root for diff tracking."""
    global _project_root, _project_root_str
    with _lock:
        _project_root = root
        try:
            resolved = str(root.resolve())
        except Exception:
            resolved = str(root)
        _project_root_str = resolved


def register_shell_watcher(shell_id: str, shell_type: str) -> None:
    """
    Register a framework shell for edit tracking.
    
    Args:
        shell_id: Shell session ID
        shell_type: 'terminal' or 'agent'
    """
    with _lock:
        _active_shells[shell_id] = shell_type
    
    # Notify subscribers of tracking status change
    _emit_status()


def unregister_shell_watcher(shell_id: str) -> None:
    """
    Unregister a framework shell from edit tracking.
    
    Args:
        shell_id: Shell session ID to remove
    """
    with _lock:
        _active_shells.pop(shell_id, None)
        
        # Clear last edit if no shells remain
        if not _active_shells:
            global _last_edit
            _last_edit = None
    
    # Notify subscribers of tracking status change
    _emit_status()


def on_file_modified(path: str) -> None:
    """
    Called when a file is modified (triggered by watchdog).
    Extracts the first modified line from git diff and emits edit_tracked event.
    
    Args:
        path: Absolute path to modified file
    """
    import sys
    
    with _lock:
        # Only track if we have a project root
        if not _project_root:
            return
        
        # Only track if we have subscribers
        if not _subscribers:
            return
    
    # Get diff to find modified lines
    try:
        path_obj = Path(path)
        
        # Convert to relative path for git
        try:
            rel_path = path_obj.relative_to(_project_root)
        except ValueError:
            # File outside project root
            return
        
        print(f"[EDIT_TRACKER] File modified: {rel_path}", file=sys.stderr)
        
        # Collect diff
        base_ref = _history_store.get_diff_base(_project_root_str) if _project_root_str else 'HEAD'
        diff_data = _collect_diff(_project_root, str(rel_path), base_ref=base_ref)
        summary = _json_object(diff_data.get('summary'))

        if not diff_data or not bool(summary.get('tracked')):
            print(f"[EDIT_TRACKER] No tracked changes in diff", file=sys.stderr)
            return

        hunks = _json_object_list(diff_data.get('hunks'))
        if not hunks:
            print(f"[EDIT_TRACKER] No hunks found", file=sys.stderr)
            return
        
        # Find first modified line (addition or deletion)
        first_line: int | None = None

        for hunk in hunks:
            # For additions, use newStart
            if _int_value(hunk.get('newLines')) > 0:
                first_line = _int_value(hunk.get('newStart'), 1)
                break
            # For deletions, use newStart (line after deletion)
            elif _int_value(hunk.get('oldLines')) > 0:
                first_line = _int_value(hunk.get('newStart'), 1)
                break
        
        if first_line is None:
            print(f"[EDIT_TRACKER] No line number found", file=sys.stderr)
            return
        
        # Update last edit state
        edit_data: JsonDict = {
            'path': str(path_obj),
            'rel_path': str(rel_path),
            'line': first_line,
            'timestamp': time.time(),
            'hunks_count': len(hunks),
            'added': _int_value(summary.get('added')),
            'deleted': _int_value(summary.get('deleted')),
        }
        
        with _lock:
            global _last_edit
            _last_edit = edit_data
        
        print(f"[EDIT_TRACKER] Emitting edit event: {path_obj}:{first_line}", file=sys.stderr)
        
        # Emit to subscribers
        _emit_edit(edit_data)
        
    except Exception as e:
        print(f"[EDIT_TRACKER] Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()


def subscribe(callback: EditCallback) -> str:
    """
    Subscribe to edit tracking events.
    
    Args:
        callback: Function to call with event data
    
    Returns:
        Subscription token for unsubscribe
    """
    import uuid
    token = str(uuid.uuid4())
    
    with _lock:
        _subscribers[token] = callback
    
    # Send initial status
    _emit_status_to(callback)
    
    return token


def unsubscribe(token: str) -> None:
    """
    Unsubscribe from edit tracking events.
    
    Args:
        token: Subscription token from subscribe()
    """
    with _lock:
        _subscribers.pop(token, None)


def get_tracking_status() -> JsonDict:
    """
    Get current tracking status.
    
    Returns:
        Status dictionary with active shells and last edit info
    """
    with _lock:
        shells: list[JsonDict] = [
            {'id': shell_id, 'type': shell_type}
            for shell_id, shell_type in _active_shells.items()
        ]
        return {
            'active': len(_active_shells) > 0,
            'shells': shells,
            'last_edit': dict(_last_edit) if _last_edit else None,
        }


def _emit_status() -> None:
    """Emit tracking status to all subscribers."""
    status = get_tracking_status()
    event: JsonDict = {'event': 'tracking_status'}
    event.update(status)

    with _lock:
        callbacks: list[EditCallback] = list(_subscribers.values())
    
    for callback in callbacks:
        try:
            callback(event)
        except Exception:
            pass


def _emit_status_to(callback: EditCallback) -> None:
    """Emit tracking status to a specific subscriber."""
    status = get_tracking_status()
    event: JsonDict = {'event': 'tracking_status'}
    event.update(status)
    
    try:
        callback(event)
    except Exception:
        pass


def _emit_edit(edit_data: JsonDict) -> None:
    """Emit edit_tracked event to all subscribers."""
    event: JsonDict = {'event': 'edit_tracked'}
    event.update(edit_data)

    with _lock:
        callbacks: list[EditCallback] = list(_subscribers.values())
    
    for callback in callbacks:
        try:
            callback(event)
        except Exception:
            pass
