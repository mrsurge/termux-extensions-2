import json
import threading
from pathlib import Path
from typing import Dict, Any

_PREFS_LOCK = threading.Lock()
_PREFS_DIR = Path.home() / '.codex' / 'app_prefs'
_PREFS_FILE = _PREFS_DIR / 'code_cm6.json'


def _load_preferences_unlocked() -> Dict[str, Any]:
    if not _PREFS_FILE.exists():
        return {}
    try:
        content = _PREFS_FILE.read_text(encoding='utf-8')
        if not content.strip():
            return {}
        data = json.loads(content)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        backup = _PREFS_FILE.with_suffix('.corrupt')
        try:
            _PREFS_FILE.replace(backup)
        except Exception:
            pass
    except Exception:
        pass
    return {}


def load_preferences() -> Dict[str, Any]:
    with _PREFS_LOCK:
        return _load_preferences_unlocked()


def save_preferences(prefs: Dict[str, Any]) -> None:
    _PREFS_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = _PREFS_FILE.with_suffix('.tmp')
    with _PREFS_LOCK:
        payload = json.dumps(prefs, indent=2)
        tmp_path.write_text(payload, encoding='utf-8')
        tmp_path.replace(_PREFS_FILE)

