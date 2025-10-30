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
from typing import Dict, Optional, Set, Callable

from .diff_helper import collect_diff

_lock = threading.Lock()

# Active shell watchers: shell_id -> shell_type ('terminal' | 'agent')
_active_shells: Dict[str, str] = {}

# WebSocket subscribers: token -> callback
_subscribers: Dict[str, Callable[[dict], None]] = {}

# Last tracked edit state
_last_edit: Optional[dict] = None

# Project root (set by main app)
_project_root: Optional[Path] = None


def set_project_root(root: Path) -> None:
    """Set the active project root for diff tracking."""
    global _project_root
    with _lock:
        _project_root = root


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
    with _lock:
        # Only track if we have active shells
        if not _active_shells:
            return
        
        # Only track if we have a project root
        if not _project_root:
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
        
        # Collect diff
        diff_data = collect_diff(_project_root, str(rel_path))
        
        if not diff_data or not diff_data.get('summary', {}).get('tracked'):
            return
        
        hunks = diff_data.get('hunks', [])
        if not hunks:
            return
        
        # Find first modified line (addition or deletion)
        first_line = None
        
        for hunk in hunks:
            # For additions, use newStart
            if hunk.get('newLines', 0) > 0:
                first_line = hunk.get('newStart', 1)
                break
            # For deletions, use newStart (line after deletion)
            elif hunk.get('oldLines', 0) > 0:
                first_line = hunk.get('newStart', 1)
                break
        
        if first_line is None:
            return
        
        # Update last edit state
        edit_data = {
            'path': str(path_obj),
            'rel_path': str(rel_path),
            'line': first_line,
            'timestamp': time.time(),
            'hunks_count': len(hunks),
            'added': diff_data['summary'].get('added', 0),
            'deleted': diff_data['summary'].get('deleted', 0)
        }
        
        with _lock:
            global _last_edit
            _last_edit = edit_data
        
        # Emit to WebSocket subscribers
        _emit_edit(edit_data)
        
    except Exception:
        # Silently ignore errors in edit tracking
        pass


def subscribe(callback: Callable[[dict], None]) -> str:
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


def get_tracking_status() -> dict:
    """
    Get current tracking status.
    
    Returns:
        Status dictionary with active shells and last edit info
    """
    with _lock:
        return {
            'active': len(_active_shells) > 0,
            'shells': [
                {'id': shell_id, 'type': shell_type}
                for shell_id, shell_type in _active_shells.items()
            ],
            'last_edit': dict(_last_edit) if _last_edit else None,
        }


def _emit_status() -> None:
    """Emit tracking status to all subscribers."""
    status = get_tracking_status()
    event = {
        'event': 'tracking_status',
        **status
    }
    
    with _lock:
        callbacks = list(_subscribers.values())
    
    for callback in callbacks:
        try:
            callback(event)
        except Exception:
            pass


def _emit_status_to(callback: Callable[[dict], None]) -> None:
    """Emit tracking status to a specific subscriber."""
    status = get_tracking_status()
    event = {
        'event': 'tracking_status',
        **status
    }
    
    try:
        callback(event)
    except Exception:
        pass


def _emit_edit(edit_data: dict) -> None:
    """Emit edit_tracked event to all subscribers."""
    event = {
        'event': 'edit_tracked',
        **edit_data
    }
    
    with _lock:
        callbacks = list(_subscribers.values())
    
    for callback in callbacks:
        try:
            callback(event)
        except Exception:
            pass
