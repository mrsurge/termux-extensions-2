import json
import time
import threading
from typing import Dict, Any, Optional, List

from .agent_preferences import load_preferences, save_preferences

_session_lock = threading.RLock()


def load_session_map() -> Dict[str, Any]:
    prefs = load_preferences()
    raw = prefs.get('agent_sessions')
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except Exception:
        return {}


def save_session_map(data: Dict[str, Any]) -> None:
    prefs = load_preferences()
    prefs['agent_sessions'] = json.dumps(data)
    save_preferences(prefs)


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    with _session_lock:
        sessions = load_session_map()
        entry = sessions.get(session_id)
        if entry and isinstance(entry, dict):
            return entry
        return None


def list_sessions() -> List[Dict[str, Any]]:
    """Return list of all sessions with summary metadata (no full message history)."""
    with _session_lock:
        sessions = load_session_map()
        result = []
        for session_id, session in sessions.items():
            if not isinstance(session, dict):
                continue
            result.append({
                'id': session.get('id', session_id),
                'name': session.get('name', 'Unnamed Session'),
                'agent': session.get('agent', 'codex'),
                'createdAt': session.get('createdAt'),
                'conversationId': session.get('conversationId'),
                'messageCount': len(session.get('messages', [])),
                'cwd': session.get('cwd'),
                'auto': session.get('auto', False),
                'fullAccess': session.get('fullAccess', False)
            })
        return sorted(result, key=lambda x: x.get('createdAt') or 0, reverse=True)


def create_session(
    session_id: str,
    name: str,
    agent: str = 'codex',
    cwd: Optional[str] = None,
    auto: bool = False,
    fullAccess: bool = False
) -> Dict[str, Any]:
    """Create a new session and persist immediately."""
    with _session_lock:
        sessions = load_session_map()
        session = {
            'id': session_id,
            'name': name,
            'agent': agent,
            'conversationId': None,
            'shell_id': None,
            'messages': [],
            'createdAt': time.time(),
            'cwd': cwd,
            'auto': auto,
            'fullAccess': fullAccess,
            'version': 1
        }
        sessions[session_id] = session
        save_session_map(sessions)
        return session


def append_message(session_id: str, message: Dict[str, Any]) -> Dict[str, Any]:
    """
    Append a message to session transcript and persist immediately.
    Returns the updated session.
    """
    with _session_lock:
        sessions = load_session_map()
        session = sessions.get(session_id)
        if not session or not isinstance(session, dict):
            raise ValueError(f"Session {session_id} not found")
        
        if 'messages' not in session:
            session['messages'] = []
        
        session['messages'].append(message)
        session['version'] = session.get('version', 1) + 1
        sessions[session_id] = session
        save_session_map(sessions)
        return session


def update_message(session_id: str, message_id: str, **updates: Any) -> Dict[str, Any]:
    """
    Update an existing message (e.g., streaming tokens).
    Returns the updated session.
    """
    with _session_lock:
        sessions = load_session_map()
        session = sessions.get(session_id)
        if not session or not isinstance(session, dict):
            raise ValueError(f"Session {session_id} not found")
        
        messages = session.get('messages', [])
        for msg in messages:
            if msg.get('id') == message_id:
                msg.update(updates)
                break
        
        session['version'] = session.get('version', 1) + 1
        sessions[session_id] = session
        save_session_map(sessions)
        return session


def update_session_metadata(session_id: str, **kwargs: Any) -> Dict[str, Any]:
    """Update session metadata (conversationId, shell_id, etc.) and persist."""
    with _session_lock:
        sessions = load_session_map()
        session = sessions.get(session_id, {}) if isinstance(sessions.get(session_id), dict) else {}
        session.update(kwargs)
        session['version'] = session.get('version', 1) + 1
        sessions[session_id] = session
        save_session_map(sessions)
        return session


def delete_session(session_id: str) -> bool:
    """Delete a session. Returns True if deleted, False if not found."""
    with _session_lock:
        sessions = load_session_map()
        if session_id in sessions:
            del sessions[session_id]
            save_session_map(sessions)
            return True
        return False


def clear_conversation_id(session_id: str) -> None:
    """Clear conversation ID for a session (triggers history restore on next message)."""
    with _session_lock:
        sessions = load_session_map()
        entry = sessions.get(session_id)
        if isinstance(entry, dict):
            entry['conversationId'] = None
            entry['version'] = entry.get('version', 1) + 1
            sessions[session_id] = entry
            save_session_map(sessions)


# Backward compatibility aliases
update_session = update_session_metadata
