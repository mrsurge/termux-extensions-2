# app/apps/file_editor_cm6/core_read.py

from __future__ import annotations
import logging
import os
import time
import uuid
import errno
from collections import deque
from pathlib import Path
from threading import Thread, Lock, Timer
from typing import Callable, Dict, Optional

from .core_write import _get_file_meta

logger = logging.getLogger(__name__)

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    _is_watchdog_available = True
except ImportError:
    _is_watchdog_available = False
    # Define dummy classes for type hinting if watchdog is not available
    class Observer: pass
    class FileSystemEventHandler: pass


_watcher_thread: Optional[Thread] = None
_project_root: Optional[Path] = None
# Maps a file path to a dict of {token: callback}
_subscribers: Dict[str, Dict[str, Callable[[dict], None]]] = {}
# Maps token to client_id for suppression tracking
_token_to_client_id: Dict[str, str] = {}
_lock = Lock()

EXCLUDE_PATTERNS = [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".venv",
    "__pycache__",
]

_debounced_events: Dict[str, dict] = {}
_debounce_timers: Dict[str, Timer] = {}
DEBOUNCE_DELAY = 0.15 # 150 ms

# Self-echo suppression: tracks recent saves to prevent flicker
_suppression_windows: Dict[tuple, float] = {}  # (path, client_id) -> expiry_time
SUPPRESSION_WINDOW = 1.8  # seconds (match frontend SELF_ECHO_GRACE)


def _norm_path(p: str) -> str:
    """Return a canonical absolute path for subscription bookkeeping."""
    candidate = Path(p)
    if not candidate.is_absolute() and _project_root:
        candidate = _project_root / candidate
    try:
        return str(candidate.resolve())
    except Exception:
        return str(candidate.absolute())


class PollingWatcher:
    def __init__(self, path, on_event):
        self._path = path
        self._on_event = on_event
        self._thread = Thread(target=self._poll, daemon=True)
        self._running = False
        self._known_files = {}

    def start(self):
        self._running = True
        self._thread.start()

    def stop(self):
        self._running = False
        self._thread.join()

    def _poll(self):
        while self._running:
            for root, _, files in os.walk(self._path):
                # Apply noise filters
                if any(p in root for p in EXCLUDE_PATTERNS):
                    continue
                for file in files:
                    filepath = Path(root) / file
                    if any(p in str(filepath) for p in EXCLUDE_PATTERNS):
                        continue
                    try:
                        stat = filepath.stat()
                        mtime = stat.st_mtime
                        if str(filepath) not in self._known_files:
                            self._known_files[str(filepath)] = mtime
                            self._on_event({"type": "modified", "path": str(filepath)})
                            self._notify_explorer(str(filepath), "created")
                        elif self._known_files[str(filepath)] < mtime:
                            self._known_files[str(filepath)] = mtime
                            self._on_event({"type": "modified", "path": str(filepath)})
                            self._notify_explorer(str(filepath), "modified")
                    except FileNotFoundError:
                        if str(filepath) in self._known_files:
                            del self._known_files[str(filepath)]
                            self._on_event({"type": "deleted", "path": str(filepath)})
                            self._notify_explorer(str(filepath), "deleted")
            time.sleep(0.3)

    def _notify_explorer(self, path: str, event_type: str):
        """Notify explorer of filesystem changes."""
        try:
            from .explorer.services.runtime_notifications import notify_explorer_of_change
            notify_explorer_of_change(path, event_type)
        except Exception:
            pass  # Explorer module may not be loaded yet

class WatchdogHandler(FileSystemEventHandler):
    def __init__(self, on_event):
        super().__init__()
        self.on_event = on_event

    def on_any_event(self, event):
        # Only handle meaningful events - skip opened/closed noise
        if event.event_type not in ('created', 'modified', 'deleted', 'moved'):
            return
        
        # Determine the "interesting" path:
        # - For moved/renamed events, use dest_path (final name)
        # - Otherwise, use src_path
        # Git often does temp-file → rename, so we need dest_path to see real files
        if event.event_type == "moved" and hasattr(event, "dest_path"):
            path = event.dest_path
        else:
            path = event.src_path

        # Apply noise filters on the final path
        if any(p in path for p in EXCLUDE_PATTERNS):
            return
        
        logger.debug(f"[WATCHER] event_type={event.event_type}, path={path}")
        
        # Notify explorer of filesystem changes (files AND directories)
        # This runs in the watcher thread, so it schedules async work
        try:
            from .explorer.services.runtime_notifications import notify_explorer_of_change
            notify_explorer_of_change(path, event.event_type)
        except Exception:
            pass  # Explorer module may not be loaded yet
        
        # For file content updates, continue with existing logic
        if event.is_directory:
            return
        self.on_event({"type": event.event_type, "path": path})

def _get_client_id_for_token(token: str) -> Optional[str]:
    """Returns the client_id associated with a token."""
    return _token_to_client_id.get(token)

def _emit_event(event: dict):
    """Sends an event to clients subscribed to that specific file path."""
    path = event.get("path")
    if not path: return

    key = path if path == "git_status" else _norm_path(path)
    event["path"] = key

    # Clean up expired suppression windows
    now = time.time()
    with _lock:
        expired_keys = [k for k, expiry in _suppression_windows.items() if expiry < now]
        for k in expired_keys:
            del _suppression_windows[k]

        path_subscribers = _subscribers.get(key, {})

        # For replace_full events, check suppression
        if event.get("type") == "replace_full":
            for token, callback in path_subscribers.items():
                client_id = _get_client_id_for_token(token)
                if client_id and (key, client_id) in _suppression_windows:
                    # Skip this client - they just saved
                    continue
                try:
                    callback(event)
                except Exception:
                    pass
        else:
            # For other events (save_ack, etc), send to all
            for callback in path_subscribers.values():
                try:
                    callback(event)
                except Exception:
                    pass


def stop_watcher():
    """Stop the current watcher and reset shared state."""
    global _watcher_thread, _project_root
    thread = None
    with _lock:
        thread = _watcher_thread
        _watcher_thread = None
        _project_root = None

        # Cancel all pending timers
        for timer in _debounce_timers.values():
            try:
                timer.cancel()
            except Exception:
                pass
        _debounce_timers.clear()
        _debounced_events.clear()
        _suppression_windows.clear()
        _token_to_client_id.clear()
        _subscribers.clear()

    # Stop the watcher thread (outside lock to avoid deadlock)
    if thread:
        try:
            # For Watchdog Observer
            if hasattr(thread, 'stop'):
                thread.stop()
            # For PollingWatcher
            elif hasattr(thread, '_running'):
                thread._running = False
        except Exception:
            pass

        # Wait for thread to finish
        try:
            if hasattr(thread, 'join'):
                thread.join(timeout=2.0)
        except Exception:
            pass

def _process_debounced_event(path: str):
    with _lock:
        event = _debounced_events.pop(path, None)
        _debounce_timers.pop(path, None)
    if event:
        _do_handle_fs_event(event)

def _handle_fs_event(raw_event):
    """Debounces and processes a raw filesystem event."""
    path = raw_event.get("path")
    if not path:
        return
    norm = _norm_path(path)

    with _lock:
        _debounced_events[norm] = raw_event
        timer = _debounce_timers.get(norm)
        if timer:
            timer.cancel()
        _debounce_timers[norm] = Timer(DEBOUNCE_DELAY, _process_debounced_event, args=(norm,))
        _debounce_timers[norm].start()

def _do_handle_fs_event(raw_event):
    """Processes a raw filesystem event into a replace_full event."""
    path = raw_event.get("path")
    if not path: return

    try:
        file_meta = _get_file_meta(Path(path))
        content = Path(path).read_text(encoding='utf-8', errors='replace')
        lang = "plaintext"
        if path.endswith('.py'): lang = 'python'
        if path.endswith('.js'): lang = 'javascript'
        if path.endswith(('.kt', '.kts')): lang = 'kotlin'
        
        _emit_event({
            "type": "replace_full",
            "path": path,
            "content": content,
            "language": lang,
            "sha256": file_meta["sha256"]
        })
        
        _emit_event({
            "type": "diff_changed",
            "path": path,
            "sha256": file_meta["sha256"]
        })
        
        # Import lazily to avoid module-load cycles in watcher/bootstrap paths.
        from . import edit_tracker

        edit_tracker.on_file_modified(path)
        
    except (FileNotFoundError, IsADirectoryError):
        pass # File might have been deleted

def init_watcher(project_root: Path = None):
    """Initializes and starts the file system watcher.
    
    DISABLED: recursive watchdog hits inotify limits on large repos.
    Will be replaced by extension host watcher relay via $onFileEvent pipeline.
    Code preserved for reference.
    
    If project_root is None, reads from the history store SSOT.
    This ensures the watcher always watches whatever the active project is.
    """
    logger.info("[WATCHER] init_watcher disabled — pending watcher overhaul (inotify limits)")
    return

def subscribe(path: str, client_id: str, on_event: Callable[[dict], None]) -> str:
    """Subscribes a client to file events, sends an initial snapshot, and returns a token."""
    token = str(uuid.uuid4())
    norm = _norm_path(path)
    with _lock:
        if norm not in _subscribers:
            _subscribers[norm] = {}
        _subscribers[norm][token] = on_event
        _token_to_client_id[token] = client_id

    # Immediately send snapshot
    try:
        full_path = Path(norm)
        if _project_root and not str(full_path).startswith(str(_project_root.resolve())):
            raise PermissionError("Path traversal detected")
        if full_path.is_symlink():
            raise PermissionError("Symlinks not supported")

        file_meta = _get_file_meta(full_path)
        content = full_path.read_text(encoding='utf-8', errors='replace')
        lang = "plaintext"
        if path.endswith('.py'): lang = 'python'
        if path.endswith('.js'): lang = 'javascript'

        snapshot_event = {
            "type": "replace_full",
            "path": norm,
            "content": content,
            "language": lang,
            "sha256": file_meta["sha256"],
        }
        on_event(snapshot_event)
    except Exception as e:
        # Handle file not found or other errors
        pass

    return token

def unsubscribe(token: str) -> None:
    """Removes a client subscription."""
    key_to_prune = None
    with _lock:
        for key, path_subs in _subscribers.items():
            if token in path_subs:
                del path_subs[token]
                key_to_prune = key
                break
        if token in _token_to_client_id:
            del _token_to_client_id[token]
        if key_to_prune and not _subscribers.get(key_to_prune):
            _subscribers.pop(key_to_prune, None)

def push_save_ack(path: str, op_id: str, client_id: str, meta: dict) -> None:
    """Pushes a save acknowledgement event to clients and sets suppression window."""
    # Set suppression window to prevent self-echo
    norm = _norm_path(path)
    with _lock:
        _suppression_windows[(norm, client_id)] = time.time() + SUPPRESSION_WINDOW

    _emit_event({
        "type": "save_ack",
        "path": norm,
        "op_id": op_id,
        "client_id": client_id,
        "meta": meta
    })

def push_git_status(status: dict) -> None:
    """Pushes a git status event to clients."""
    # This will now only go to subscribers of a specific (and likely non-existent) path "git_status"
    # This part of the logic may need to be re-thought if git status is a global event.
    # For now, it is maintained to keep the function signature.
    _emit_event({
        "type": "git_status",
        "path": "git_status", # Dummy path
        **status
    })

def emit_diff_changed(path: str, sha256: str) -> None:
    """Notifies subscribers that diff state may have changed for a file."""
    norm = _norm_path(path)
    _emit_event({
        "type": "diff_changed",
        "path": norm,
        "sha256": sha256
    })
