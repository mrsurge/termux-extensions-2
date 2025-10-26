
# app/apps/file_editor_cm6/main.py

import os
import json
from pathlib import Path
from flask import Blueprint, jsonify, request
from flask_sock import Sock

from .core_read import init_watcher, subscribe, unsubscribe, push_save_ack
from .core_write import write_full, BaseMismatchError, _get_file_meta
from .history_store import HistoryStore
from .explorer_helper import set_project_root, get_project_root, list_dir, mark_git_cache_dirty
from .preferences_store import PreferencesStore

file_editor_cm6_bp = Blueprint('file_editor_cm6', __name__)
sock = Sock()

# Initialize history store (project root managed by explorer_helper)
_history_store = HistoryStore()
_preferences_store = PreferencesStore()

def _ensure_project_root_synced() -> Path:
    """Ensure the in-memory project root matches the persisted active project."""
    stored = _history_store.get_active_project()
    if stored:
        stored_path = Path(stored)
        if stored_path.is_dir():
            current = get_project_root()
            try:
                if stored_path.resolve() != current.resolve():
                    return set_project_root(stored)
            except Exception:
                pass
            return stored_path
    return get_project_root()

# Sync the initial project root on module import.
try:
    _ensure_project_root_synced()
except Exception:
    pass

def _build_state_payload() -> dict:
    project_path = _history_store.get_active_project()
    project_exists = bool(project_path and Path(project_path).is_dir())
    project_label = HistoryStore.format_label(project_path)
    project_message = ""
    if not project_path:
        project_message = "No project selected."
    elif not project_exists:
        project_message = f'Project "{project_label or project_path}" not found.'
    else:
        # Make sure runtime root matches
        try:
            set_project_root(project_path)
        except Exception:
            project_exists = False
            project_message = f'Project "{project_label or project_path}" not accessible.'

    last_file = _history_store.get_last_file(project_path)
    last_file_exists = bool(last_file and Path(last_file).is_file())
    last_file_label = HistoryStore.format_label(last_file)
    last_file_message = ""
    if last_file and not last_file_exists:
        last_file_message = f'File "{last_file_label or last_file}" not found.'

    recents_raw = _history_store.list_files(project_path) if project_path else []
    recents = []
    for entry in recents_raw:
        entry_path = entry.get("path")
        exists = bool(entry_path and Path(entry_path).is_file())
        recents.append({
            "path": entry_path,
            "label": entry.get("label") or HistoryStore.format_label(entry_path),
            "opened_at": entry.get("opened_at"),
            "exists": exists,
        })

    editor_prefs = _preferences_store.get_preferences(project_path)

    return {
        "activeProject": project_path,
        "activeProjectLabel": project_label,
        "activeProjectExists": project_exists,
        "activeProjectMessage": project_message,
        "lastFile": last_file,
        "lastFileLabel": last_file_label,
        "lastFileExists": last_file_exists,
        "lastFileMessage": last_file_message,
        "recents": recents,
        "preferences": editor_prefs,
    }

def _expand_and_validate_path(path):
    base_home = os.path.expanduser('~')
    expanded = os.path.normpath(os.path.expanduser(path))
    if not os.path.abspath(expanded).startswith(base_home):
        return None, 'Access denied'
    return expanded, None

@file_editor_cm6_bp.route('/')
def status_root():
    return jsonify({"ok": True, "data": {"message": "File Editor CM6 app API ready"}})

@file_editor_cm6_bp.get('/status')
def status():
    return jsonify({"ok": True, "data": {"message": "File Editor CM6 app API ready"}})

@file_editor_cm6_bp.get('/read')
def read_file():
    path = request.args.get('path')
    expanded, err = _expand_and_validate_path(path)
    if err:
        return jsonify({"ok": False, "error": err}), 403
    if not os.path.isfile(expanded):
        return jsonify({"ok": False, "error": 'File not found'}), 404
    try:
        with open(expanded, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
        meta = _get_file_meta(Path(expanded))
        return jsonify({"ok": True, "data": {"path": expanded, "content": content, "sha256": meta.get("sha256")}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.post('/write')
def write_file_route():
    data = request.get_json(silent=True) or {}
    path = data.get('path')
    content = data.get('content')
    client_id = data.get('client_id', 'unknown')
    op_id = data.get('op_id', '')
    base_sha256 = None

    if data.get('base') and isinstance(data['base'], dict):
        base_sha256 = data['base'].get('sha256')

    project_root = get_project_root()
    rel_path = path
    
    try:
        # Initialize watcher if not already running
        init_watcher(project_root)

        # Perform atomic write with optional conflict check
        file_meta = write_full(project_root, str(rel_path), content, base_sha256=base_sha256)

        # Send save acknowledgement to prevent self-echo
        push_save_ack(str(rel_path), op_id, client_id, file_meta)

        # Refresh git cache so explorer styling stays accurate
        mark_git_cache_dirty(project_root)

        return jsonify({
            "ok": True,
            "data": {
                "mtime": file_meta["mtime"],
                "size": file_meta["size"],
                "sha256": file_meta["sha256"]
            }
        })
    except BaseMismatchError as e:
        return jsonify({
            "ok": False,
            "error": "BASE_MISMATCH",
            "data": {
                "current": e.current_meta
            }
        }), 409
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@sock.route('/ws/read')
def ws_read(ws):
    """WebSocket endpoint for file change notifications."""
    path = request.args.get('path')
    client_id = request.args.get('client_id', 'unknown')

    if not path:
        ws.close(reason='Missing path parameter')
        return

    project_root = get_project_root()
    rel_path = path

    # Initialize watcher if not already running
    init_watcher(project_root)

    # Subscribe to file changes
    token = subscribe(str(rel_path), client_id, lambda event: ws.send(json.dumps(event)))

    try:
        # Keep connection alive and ignore incoming messages
        while True:
            msg = ws.receive()
            if msg is None:
                break
    finally:
        unsubscribe(token)

@file_editor_cm6_bp.post('/project/open')
def project_open():
    """Open a project directory."""
    data = request.get_json(silent=True) or {}
    path = (data.get('path') or '').strip()

    try:
        abs_path = set_project_root(path)  # validates and sets global project root
        _history_store.touch_project(str(abs_path))
        _history_store.set_active_project(str(abs_path))
        state = _build_state_payload()
        return jsonify({"ok": True, "data": {"path": str(abs_path), "state": state}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.get('/project/current')
def project_current():
    """Get the current project root."""
    root = _history_store.get_active_project() or str(get_project_root())
    return jsonify({"ok": True, "data": {"path": str(root)}})

@file_editor_cm6_bp.get('/state')
def get_project_state():
    """Return consolidated editor state."""
    state = _build_state_payload()
    return jsonify({"ok": True, "data": state})


@file_editor_cm6_bp.get('/preferences')
def get_preferences():
    """Return persisted editor/UI preferences."""
    project_path = _history_store.get_active_project()
    prefs = _preferences_store.get_preferences(project_path)
    return jsonify({"ok": True, "data": prefs})


@file_editor_cm6_bp.post('/preferences')
def update_preferences():
    """Persist editor/UI preference changes."""
    payload = request.get_json(silent=True) or {}
    editor = payload.get('editor')
    ui = payload.get('ui')
    project = payload.get('project')

    active_project = _history_store.get_active_project()
    if project is None and active_project:
        project = {"path": active_project}
    elif project and not project.get('path') and active_project:
        project['path'] = active_project

    try:
        updated = _preferences_store.update_preferences(
            editor=editor,
            ui=ui,
            project=project,
        )
        # Return a fresh snapshot for convenience
        snapshot = _preferences_store.get_preferences(active_project)
        return jsonify({"ok": True, "data": snapshot, "updated": updated})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

@file_editor_cm6_bp.post('/state/file_activity')
def record_file_activity():
    """Persist last-opened file and recents for the active project."""
    data = request.get_json(silent=True) or {}
    path = data.get('path')
    if not path:
        return jsonify({"ok": False, "error": "Path is required"}), 400

    project_path = data.get('project') or _history_store.get_active_project()
    if not project_path:
        return jsonify({"ok": False, "error": "No project selected"}), 400

    try:
        project_root_path = Path(project_path).expanduser().resolve()
        candidate_path = Path(path).expanduser().resolve()
        if not str(candidate_path).startswith(str(project_root_path)):
            return jsonify({"ok": False, "error": "File is outside the project root"}), 400

        entry = _history_store.record_file_activity(project_path, str(candidate_path))
        state = _build_state_payload()
        return jsonify({"ok": True, "data": {"entry": entry, "state": state}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.get('/explorer/list')
def explorer_list():
    """List directory contents for the file explorer."""
    rel = request.args.get('dir', '.')
    try:
        return jsonify({"ok": True, "data": list_dir(rel)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.get('/history/files')
def get_recent_files():
    """Get recent files for the current project."""
    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        files_raw = _history_store.list_files(str(project_root))
        files = []
        for entry in files_raw:
            entry_path = entry.get("path")
            files.append({
                **entry,
                "exists": bool(entry_path and Path(entry_path).is_file()),
            })
        return jsonify({"ok": True, "data": files})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.post('/history/touch')
def touch_file_history():
    """Add a file to the recent files list."""
    data = request.get_json(silent=True) or {}
    path = data.get('path')

    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        entry = _history_store.record_file_activity(str(project_root), path)
        return jsonify({"ok": True, "data": entry})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.delete('/history/file')
def remove_file_history():
    """Remove a file from the recent files list."""
    path = request.args.get('path')

    project_root = _history_store.get_active_project() or str(get_project_root())
    try:
        removed = _history_store.remove_file(str(project_root), path)
        return jsonify({"ok": True, "data": {"removed": removed}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
