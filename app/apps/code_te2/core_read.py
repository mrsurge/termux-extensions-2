# app/apps/code_te2/core_read.py
# pyright: strict, reportUnusedFunction=false

from __future__ import annotations
import time
import uuid
from pathlib import Path
from threading import Lock
from typing import Callable, cast

from . import core_write

JsonObject = dict[str, object]
CoreEvent = JsonObject
CoreCallback = Callable[[CoreEvent], None]

# Maps a file path to a dict of {token: callback}
_subscribers: dict[str, dict[str, CoreCallback]] = {}
# Maps token to client_id for suppression tracking
_token_to_client_id: dict[str, str] = {}
_lock = Lock()

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


def _current_project_root() -> Path | None:
    try:
        from .explorer.services.file_ops import get_project_root

        return get_project_root().resolve(strict=False)
    except Exception:
        return None


def _norm_path(p: str) -> str:
    """Return a canonical absolute path for subscription bookkeeping."""
    candidate = Path(p)
    project_root = _current_project_root()
    if not candidate.is_absolute() and project_root is not None:
        candidate = project_root / candidate
    try:
        return str(candidate.resolve())
    except Exception:
        return str(candidate.absolute())


def _is_under_project(path: Path) -> bool:
    project_root = _current_project_root()
    if project_root is None:
        return True
    try:
        path.resolve(strict=False).relative_to(project_root)
        return True
    except ValueError:
        return False

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
            # For other events (save_ack, diff_changed, etc.), send to all.
            for callback in path_subscribers.values():
                try:
                    callback(event)
                except Exception:
                    pass

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
        if not _is_under_project(full_path):
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
    