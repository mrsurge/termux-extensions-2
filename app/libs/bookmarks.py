import json
import os
from pathlib import Path

from flask import Blueprint, jsonify, request

bookmarks_bp = Blueprint("bookmarks", __name__)

BOOKMARKS_DIR = Path(os.path.expanduser("~/.cache/termux_extensions/file_explorer/bookmarks"))
BOOKMARKS_FILE = BOOKMARKS_DIR / "bookmarks.json"
BOOKMARKS_TEMPLATE_FILE = Path("app/static/bookmarks.json")

def _ensure_bookmarks_file() -> None:
    """Ensure the bookmarks file and its parent directory exist."""
    if BOOKMARKS_FILE.exists():
        return
    try:
        BOOKMARKS_DIR.mkdir(parents=True, exist_ok=True)
        if not BOOKMARKS_TEMPLATE_FILE.exists():
            BOOKMARKS_FILE.write_text('[]', encoding='utf-8')
            return

        template_content = BOOKMARKS_TEMPLATE_FILE.read_text(encoding='utf-8')
        
        prefix_val = os.environ.get('PREFIX', '')
        if prefix_val:
            template_content = template_content.replace('$PREFIX', prefix_val)
            
        bookmarks = json.loads(template_content)
        
        with BOOKMARKS_FILE.open('w', encoding='utf-8') as f:
            json.dump(bookmarks, f, indent=2)

    except Exception as e:
        print(f"Error creating bookmarks file: {e}")
        if not BOOKMARKS_FILE.exists():
            BOOKMARKS_FILE.write_text('[]', encoding='utf-8')

@bookmarks_bp.route('/bookmarks', methods=['GET'])
def get_bookmarks():
    """Get the list of bookmarks."""
    try:
        _ensure_bookmarks_file()
        with BOOKMARKS_FILE.open('r', encoding='utf-8') as f:
            bookmarks = json.load(f)
        return jsonify({"ok": True, "data": bookmarks})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to read bookmarks: {e}"}), 500

@bookmarks_bp.route('/bookmarks', methods=['POST'])
def add_bookmark():
    """Add a new bookmark."""
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    path = data.get('path')
    if not name or not path:
        return jsonify({"ok": False, "error": 'Name and path are required'}), 400

    try:
        _ensure_bookmarks_file()
        with BOOKMARKS_FILE.open('r+', encoding='utf-8') as f:
            bookmarks = json.load(f)
            bookmarks.append({'name': name, 'path': path})
            f.seek(0)
            f.truncate()
            json.dump(bookmarks, f, indent=2)
        return jsonify({"ok": True, "data": bookmarks})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to add bookmark: {e}"}), 500

@bookmarks_bp.route('/bookmarks', methods=['PUT'])
def update_bookmarks():
    """Update the entire list of bookmarks (for reordering, editing, deleting)."""
    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return jsonify({"ok": False, "error": 'A JSON array of bookmarks is required'}), 400

    try:
        _ensure_bookmarks_file()
        with BOOKMARKS_FILE.open('w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        return jsonify({"ok": True, "data": data})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Failed to update bookmarks: {e}"}), 500
