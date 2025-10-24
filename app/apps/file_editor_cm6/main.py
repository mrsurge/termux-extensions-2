
# app/apps/file_editor_cm6/main.py

import os
import json
from pathlib import Path
from flask import Blueprint, jsonify, request
from flask_sock import Sock

from .core_read import init_watcher, subscribe, unsubscribe, push_save_ack
from .core_write import write_full, BaseMismatchError
from .history_store import HistoryStore
from .explorer_helper import set_project_root, get_project_root, list_dir

file_editor_cm6_bp = Blueprint('file_editor_cm6', __name__)
sock = Sock()

# Initialize history store (project root managed by explorer_helper)
_history_store = HistoryStore()

def _expand_and_validate_path(path):
    base_home = os.path.expanduser('~')
    expanded = os.path.normpath(os.path.expanduser(path))
    if not os.path.abspath(expanded).startswith(base_home):
        return None, 'Access denied'
    return expanded, None

@file_editor_cm6_bp.route('/')
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
        return jsonify({"ok": True, "data": {"path": expanded, "content": content}})
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
    token = subscribe(project_root, str(rel_path), client_id, lambda event: ws.send(json.dumps(event)))

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
        return jsonify({"ok": True, "data": {"path": str(abs_path)}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.get('/project/current')
def project_current():
    """Get the current project root."""
    root = get_project_root()
    return jsonify({"ok": True, "data": {"path": str(root)}})

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
    project_root = get_project_root()
    try:
        files = _history_store.list_files(str(project_root))
        return jsonify({"ok": True, "data": files})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.post('/history/touch')
def touch_file_history():
    """Add a file to the recent files list."""
    data = request.get_json(silent=True) or {}
    path = data.get('path')

    project_root = get_project_root()
    try:
        entry = _history_store.touch_file(str(project_root), path)
        return jsonify({"ok": True, "data": entry})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@file_editor_cm6_bp.delete('/history/file')
def remove_file_history():
    """Remove a file from the recent files list."""
    path = request.args.get('path')

    project_root = get_project_root()
    try:
        removed = _history_store.remove_file(str(project_root), path)
        return jsonify({"ok": True, "data": {"removed": removed}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
