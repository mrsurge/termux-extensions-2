# app/apps/file_editor_cm6/core_read.py
# pyright: strict, reportUnusedFunction=false

from __future__ import annotations
import logging
import os
import time
import uuid
from pathlib import Path
from threading import Thread, Lock, Timer
from typing import Callable, Protocol, cast

from . import core_write

logger = logging.getLogger(__name__)

JsonObject = dict[str, object]
CoreEvent = JsonObject
CoreCallback = Callable[[CoreEvent], None]


class WatchdogEvent(Protocol):
    event_type: str
    src_path: str
    is_directory: bool


class MovedWatchdogEvent(WatchdogEvent, Protocol):
    dest_path: str


class WatcherHandle(Protocol):
    def stop(self) -> None: ...

    def join(self, timeout: float | None = None) -> None: ...


class FileSystemEventHandler:
    def on_any_event(self, event: WatchdogEvent) -> None:
        del event


try:
    from watchdog.events import FileSystemEventHandler as _ImportedWatchdogHandlerBase

    _WatchdogHandlerBase = cast(type[FileSystemEventHandler], _ImportedWatchdogHandlerBase)
    _is_watchdog_available = True
except ImportError:
    _is_watchdog_available = False
    _WatchdogHandlerBase = FileSystemEventHandler


_watcher_thread: WatcherHandle | None = None
_project_root: Path | None = None
# Maps a file path to a dict of {token: callback}
_subscribers: dict[str, dict[str, CoreCallback]] = {}
# Maps token to client_id for suppression tracking
_token_to_client_id: dict[str, str] = {}
_lock = Lock()

EXCLUDE_PATTERNS = [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".venv",
    "__pycache__",
]

_debounced_events: dict[str, CoreEvent] = {}
_debounce_timers: dict[str, Timer] = {}
DEBOUNCE_DELAY = 0.15 # 150 ms

# Self-echo suppression: tracks recent saves to prevent flicker
_suppression_windows: dict[tuple[str, str], float] = {}  # (path, client_id) -> expiry_time
SUPPRESSION_WINDOW = 1.8  # seconds (match frontend SELF_ECHO_GRACE)


def _json_object(value: object) -> JsonObject:
    if not isinstance(value, dict):
        return {}
    raw = cast(dict[object, object], value)
    return {str(key): item for key, item in raw.items()}


def _file_meta(path: Path) -> JsonObject:
    getter = cast(Callable[[Path], object], core_write.__dict__["_get_file_meta"])
    return _json_object(getter(path))


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
    def __init__(self, path: Path, on_event: CoreCallback) -> None:
        self._path = path
        self._on_event = on_event
        self._thread = Thread(target=self._poll, daemon=True)
        self._running = False
        self._known_files: dict[str, float] = {}

    def start(self) -> None:
        self._running = True
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        self._thread.join()

    def join(self, timeout: float | None = None) -> None:
        self._thread.join(timeout=timeout)

    def _poll(self) -> None:
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

    def _notify_explorer(self, path: str, event_type: str) -> None:
        """Notify explorer of filesystem changes."""
        try:
            from .workspace_events import publish_file_change_threadsafe

            publish_file_change_threadsafe(path, event_type)
        except Exception:
            pass  # Explorer module may not be loaded yet

class WatchdogHandler(_WatchdogHandlerBase):
    def __init__(self, on_event: CoreCallback) -> None:
        super().__init__()
        self.on_event = on_event

    def on_any_event(self, event: WatchdogEvent) -> None:
        # Only handle meaningful events - skip opened/closed noise
        if event.event_type not in ('created', 'modified', 'deleted', 'moved'):
            return
        
        # Determine the "interesting" path:
        # - For moved/renamed events, use dest_path (final name)
        # - Otherwise, use src_path
        # Git often does temp-file → rename, so we need dest_path to see real files
        if event.event_type == "moved" and hasattr(event, "dest_path"):
            path = cast(MovedWatchdogEvent, event).dest_path
        else:
            path = event.src_path

        # Apply noise filters on the final path
        if any(p in path for p in EXCLUDE_PATTERNS):
            return
        
        logger.debug(f"[WATCHER] event_type={event.event_type}, path={path}")
        
        # Notify explorer of filesystem changes (files AND directories)
        # This runs in the watcher thread, so it schedules async work
        try:
            from .workspace_events import publish_file_change_threadsafe

            publish_file_change_threadsafe(path, event.event_type)
        except Exception:
            pass  # Explorer module may not be loaded yet
        
        # For file content updates, continue with existing logic
        if event.is_directory:
            return
        self.on_event({"type": event.event_type, "path": path})

def _get_client_id_for_token(token: str) -> str | None:
    """Returns the client_id associated with a token."""
    return _token_to_client_id.get(token)

def _emit_event(event: CoreEvent) -> None:
    """Sends an event to clients subscribed to that specific file path."""
    path = event.get("path")
    if not path: return

    path_text = str(path)
    key = path_text if path_text == "git_status" else _norm_path(path_text)
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
            thread.stop()
        except Exception:
            pass

        # Wait for thread to finish
        try:
            if hasattr(thread, 'join'):
                thread.join(timeout=2.0)
        except Exception:
            pass

def _process_debounced_event(path: str) -> None:
    with _lock:
        event = _debounced_events.pop(path, None)
        _debounce_timers.pop(path, None)
    if event:
        _do_handle_fs_event(event)

def _handle_fs_event(raw_event: CoreEvent) -> None:
    """Debounces and processes a raw filesystem event."""
    path = raw_event.get("path")
    if not path:
        return
    path_text = str(path)
    norm = _norm_path(path_text)

    with _lock:
        _debounced_events[norm] = raw_event
        timer = _debounce_timers.get(norm)
        if timer:
            timer.cancel()
        _debounce_timers[norm] = Timer(DEBOUNCE_DELAY, _process_debounced_event, args=(norm,))
        _debounce_timers[norm].start()

def _do_handle_fs_event(raw_event: CoreEvent) -> None:
    """Processes a raw filesystem event into a replace_full event."""
    path = raw_event.get("path")
    if not path: return

    path_text = str(path)

    try:
        file_meta = _file_meta(Path(path_text))
        content = Path(path_text).read_text(encoding='utf-8', errors='replace')
        lang = "plaintext"
        if path_text.endswith('.py'): lang = 'python'
        if path_text.endswith('.js'): lang = 'javascript'
        if path_text.endswith(('.kt', '.kts')): lang = 'kotlin'
        
        _emit_event({
            "type": "replace_full",
            "path": path_text,
            "content": content,
            "language": lang,
            "sha256": str(file_meta.get("sha256", ""))
        })
        
        _emit_event({
            "type": "diff_changed",
            "path": path_text,
            "sha256": str(file_meta.get("sha256", ""))
        })
        
        # Import lazily to avoid module-load cycles in watcher/bootstrap paths.
        from . import edit_tracker

        edit_tracker.on_file_modified(path_text)
        
    except (FileNotFoundError, IsADirectoryError):
        pass # File might have been deleted

def init_watcher(project_root: Path | None = None) -> None:
    """Initializes and starts the file system watcher.
    
    DISABLED: recursive watchdog hits inotify limits on large repos.
    Will be replaced by extension host watcher relay via $onFileEvent pipeline.
    Code preserved for reference.
    
    If project_root is None, reads from the history store SSOT.
    This ensures the watcher always watches whatever the active project is.
    """
    logger.info("[WATCHER] init_watcher disabled — pending watcher overhaul (inotify limits)")
    return

def subscribe(path: str, client_id: str, on_event: CoreCallback) -> str:
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

        file_meta = _file_meta(full_path)
        content = full_path.read_text(encoding='utf-8', errors='replace')
        lang = "plaintext"
        if path.endswith('.py'): lang = 'python'
        if path.endswith('.js'): lang = 'javascript'

        snapshot_event: CoreEvent = {
            "type": "replace_full",
            "path": norm,
            "content": content,
            "language": lang,
            "sha256": str(file_meta.get("sha256", "")),
        }
        on_event(snapshot_event)
    except Exception:
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

def push_save_ack(path: str, op_id: str, client_id: str, meta: JsonObject) -> None:
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

def push_git_status(status: JsonObject) -> None:
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
    event: CoreEvent = {
        "type": "diff_changed",
        "path": norm,
        "sha256": sha256
    }
    _emit_event(event)
