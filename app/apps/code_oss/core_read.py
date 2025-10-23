from __future__ import annotations
import os
import time
import uuid
from collections import deque
from pathlib import Path
from threading import Thread, Lock, Timer
from typing import Callable, Dict, Optional

from .core_write import _get_file_meta

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
                        elif self._known_files[str(filepath)] < mtime:
                            self._known_files[str(filepath)] = mtime
                            self._on_event({"type": "modified", "path": str(filepath)})
                    except FileNotFoundError:
                        if str(filepath) in self._known_files:
                            del self._known_files[str(filepath)]
                            self._on_event({"type": "deleted", "path": str(filepath)})
            time.sleep(0.3)

class WatchdogHandler(FileSystemEventHandler):
    def __init__(self, on_event):
        super().__init__()
        self.on_event = on_event

    def on_any_event(self, event):
        if event.is_directory:
            return
        # Apply noise filters
        if any(p in event.src_path for p in EXCLUDE_PATTERNS):
            return
        self.on_event({"type": event.event_type, "path": event.src_path})

def _emit_event(event: dict):
    """Sends an event to clients subscribed to that specific file path."""
    path = event.get("path")
    if not path: return

    with _lock:
        path_subscribers = _subscribers.get(path, {})
        for callback in path_subscribers.values():
            try:
                callback(event)
            except Exception:
                pass # Ignore broken subscribers

def _process_debounced_event(path: str):
    with _lock:
        event = _debounced_events.pop(path, None)
        _debounce_timers.pop(path, None)
    if event:
        _do_handle_fs_event(event)

def _handle_fs_event(raw_event):
    """Debounces and processes a raw filesystem event."""
    path = raw_event.get("path")
    if not path: return

    with _lock:
        _debounced_events[path] = raw_event
        if path in _debounce_timers:
            _debounce_timers[path].cancel()
        _debounce_timers[path] = Timer(DEBOUNCE_DELAY, _process_debounced_event, args=(path,))
        _debounce_timers[path].start()

def _do_handle_fs_event(raw_event):
    """Processes a raw filesystem event into a replace_full event."""
    path = raw_event.get("path")
    if not path: return

    rel_path = os.path.relpath(path, _project_root)
    
    try:
        file_meta = _get_file_meta(Path(path))
        content = Path(path).read_text(encoding='utf-8', errors='replace')
        lang = "plaintext"
        if rel_path.endswith('.py'): lang = 'python'
        if rel_path.endswith('.js'): lang = 'javascript'
        
        _emit_event({
            "type": "replace_full",
            "path": rel_path,
            "content": content,
            "language": lang,
            "sha256": file_meta["sha256"]
        })
    except (FileNotFoundError, IsADirectoryError):
        pass # File might have been deleted

def init_watcher(project_root: Path):
    """Initializes and starts the file system watcher if not already running."""
    global _watcher_thread, _project_root
    if _watcher_thread:
        return

    _project_root = project_root

    if _is_watchdog_available:
        handler = WatchdogHandler(_handle_fs_event)
        observer = Observer()
        observer.schedule(handler, str(project_root), recursive=True)
        observer.start()
        _watcher_thread = observer
    else:
        watcher = PollingWatcher(str(project_root), _handle_fs_event)
        watcher.start()
        _watcher_thread = watcher

def subscribe(path: str, client_id: str, on_event: Callable[[dict], None]) -> str:
    """Subscribes a client to file events, sends an initial snapshot, and returns a token."""
    token = str(uuid.uuid4())
    with _lock:
        if path not in _subscribers:
            _subscribers[path] = {}
        _subscribers[path][token] = on_event

    # Immediately send snapshot
    try:
        full_path = _project_root.joinpath(path).resolve()
        if not str(full_path).startswith(str(_project_root.resolve())):
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
            "path": path,
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
    with _lock:
        for path_subs in _subscribers.values():
            if token in path_subs:
                del path_subs[token]
                break

def push_save_ack(path: str, op_id: str, client_id: str, meta: dict) -> None:
    """Pushes a save acknowledgement event to clients."""
    _emit_event({
        "type": "save_ack",
        "path": path,
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

