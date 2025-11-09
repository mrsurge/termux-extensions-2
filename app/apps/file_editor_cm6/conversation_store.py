# app/apps/file_editor_cm6/conversation_store.py

"""
Manages persistence for agent conversation sessions.

This module implements the exact storage schema and atomic write flow described
in the agent drawer documentation. It is the single source of truth for
conversation history.

Storage Path: ~/.codex/agent_sessions/sessions.json
"""

import json
import time
import uuid
from pathlib import Path
from threading import RLock
from typing import Any, Dict, List, Optional

# Module-level lock for all file I/O to ensure thread safety.
_lock = RLock()

# The canonical path for session storage, as documented.
_SESSION_DIR = Path.home() / ".codex" / "agent_sessions"
_SESSION_FILE = _SESSION_DIR / "sessions.json"
_SESSION_TMP_FILE = _SESSION_DIR / "sessions.json.tmp"

def _load_raw_sessions() -> Dict[str, Dict[str, Any]]:
    """Load the JSON payload from disk without caching."""
    session_file = _get_session_path()
    if not session_file.exists():
        return {}
    try:
        data = json.loads(session_file.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}

    if isinstance(data, dict):
        # Support both {"sessions": {...}} and legacy {...}
        if "sessions" in data and isinstance(data["sessions"], dict):
            return data["sessions"]
        return data
    return {}


def _write_raw_sessions(sessions: Dict[str, Dict[str, Any]]) -> None:
    session_file = _get_session_path()
    tmp_file = _SESSION_TMP_FILE
    payload = json.dumps(sessions, indent=2)
    tmp_file.write_text(payload, "utf-8")
    tmp_file.replace(session_file)


def _get_session_path() -> Path:
    """Returns the path to the sessions file, ensuring the directory exists."""
    _SESSION_DIR.mkdir(parents=True, exist_ok=True)
    return _SESSION_FILE


def load_session_map() -> Dict[str, Dict[str, Any]]:
    """Loads and returns the entire session map from disk."""
    with _lock:
        return dict(_load_raw_sessions())


def save_session_map(session_map: Dict[str, Dict[str, Any]]) -> None:
    """Writes the provided session map to disk atomically."""
    with _lock:
        try:
            _write_raw_sessions(session_map)
        except OSError as exc:
            print(f"[ConversationStore] Error saving sessions: {exc}")
        finally:
            _invalidate_cache()


def list_sessions() -> List[Dict[str, Any]]:
    """Returns a list of all sessions with minimal metadata."""
    with _lock:
        sessions = _load_raw_sessions()
        return [
            {
                "id": s_id,
                "name": s.get("name"),
                "agent": s.get("agent"),
                "createdAt": s.get("createdAt"),
                "messageCount": len(s.get("messages", [])),
            }
            for s_id, s in sessions.items()
        ]


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves a single session by its ID."""
    with _lock:
        sessions = _load_raw_sessions()
        session = sessions.get(session_id)
        return dict(session) if session else None


def create_session(
    name: str, agent: str, cwd: str, auto: bool = False, fullAccess: bool = False
) -> Dict[str, Any]:
    """Creates a new session, persists it, and returns it."""
    with _lock:
        sessions = _load_raw_sessions()
        session_id = f"session-{uuid.uuid4().hex}"
        new_session = {
            "id": session_id,
            "name": name,
            "agent": agent,
            "conversationId": None,
            "shell_id": None,
            "messages": [],
            "createdAt": time.time(),
            "cwd": cwd,
            "auto": auto,
            "fullAccess": fullAccess,
            "version": 1,
        }
        sessions[session_id] = new_session
        _write_raw_sessions(sessions)
        return new_session


def append_message(session_id: str, message: Dict[str, Any]) -> None:
    """Appends a message to a session's history and persists the change."""
    with _lock:
        sessions = _load_raw_sessions()
        session = sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        session.setdefault("messages", []).append(message)
        session["version"] = session.get("version", 1) + 1
        _write_raw_sessions(sessions)


def update_message(session_id: str, message_id: str, updates: Dict[str, Any]) -> None:
    """Updates an existing message in a session's history."""
    with _lock:
        sessions = _load_raw_sessions()
        session = sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        for msg in session.get("messages", []):
            if msg.get("id") == message_id:
                msg.update(updates)
                session["version"] = session.get("version", 1) + 1
                _write_raw_sessions(sessions)
                return
        raise ValueError(f"Message {message_id} not found in session {session_id}")


def update_session_metadata(session_id: str, **kwargs: Any) -> None:
    """Updates metadata fields of a session and persists the change."""
    with _lock:
        sessions = _load_raw_sessions()
        session = sessions.get(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")
        session.update(kwargs)
        session["version"] = session.get("version", 1) + 1
        _write_raw_sessions(sessions)


def delete_session(session_id: str) -> None:
    """Deletes a session from the map and persists the change."""
    with _lock:
        sessions = _load_raw_sessions()
        if session_id in sessions:
            del sessions[session_id]
            _write_raw_sessions(sessions)


def clear_conversation_id(session_id: str) -> None:
    """A specific helper to nullify the conversationId for a session."""
    update_session_metadata(session_id, conversationId=None)
