import os
from flask import Blueprint, jsonify, request

file_editor_bp = Blueprint('file_editor', __name__)

def _expand_and_validate_path(path):
    base_home = os.path.expanduser('~')
    expanded = os.path.normpath(os.path.expanduser(path))
    if not os.path.abspath(expanded).startswith(base_home):
        return None, 'Access denied'
    return expanded, None

@file_editor_bp.route('/')
def status():
    return jsonify({"ok": True, "data": {"message": "File Editor app API ready"}})

@file_editor_bp.get('/read')
def read_file():
    path = request.args.get('path')
    if not path:
        return jsonify({"ok": False, "error": '"path" query parameter is required'}), 400
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

@file_editor_bp.post('/write')
def write_file():
    data = request.get_json(silent=True) or {}
    path = data.get('path')
    content = data.get('content')
    if not path or content is None:
        return jsonify({"ok": False, "error": 'Both "path" and "content" are required'}), 400
    expanded, err = _expand_and_validate_path(path)
    if err:
        return jsonify({"ok": False, "error": err}), 403
    try:
        # Ensure directory exists
        os.makedirs(os.path.dirname(expanded), exist_ok=True)
        with open(expanded, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({"ok": True, "data": {"path": expanded}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
