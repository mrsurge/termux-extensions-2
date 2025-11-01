import json
from typing import Dict, Any, Optional

from .agent_preferences import load_preferences, save_preferences


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
    sessions = load_session_map()
    entry = sessions.get(session_id)
    if entry and isinstance(entry, dict):
        return entry
    return None


def update_session(session_id: str, **kwargs: Any) -> Dict[str, Any]:
    sessions = load_session_map()
    session = sessions.get(session_id, {}) if isinstance(sessions.get(session_id), dict) else {}
    session.update(kwargs)
    sessions[session_id] = session
    save_session_map(sessions)
    return session


def clear_conversation_id(session_id: str) -> None:
    sessions = load_session_map()
    entry = sessions.get(session_id)
    if isinstance(entry, dict):
        entry['conversationId'] = None
        sessions[session_id] = entry
        save_session_map(sessions)
