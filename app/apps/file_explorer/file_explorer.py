from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request

file_explorer_bp = Blueprint("file_explorer_app", __name__)

HOME_DIR = Path(os.path.expanduser("~"))


def _json_ok(data: Any, status: int = 200):
    return jsonify({"ok": True, "data": data}), status


def _json_err(message: str, status: int = 400):
    return jsonify({"ok": False, "error": str(message)}), status


def _scandir_entries(path: Path, show_hidden: bool) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    with os.scandir(path) as iterator:
        for entry in iterator:
            name = entry.name
            if not show_hidden and name.startswith('.'):
                continue
            try:
                if entry.is_dir(follow_symlinks=False):
                    entry_type = 'directory'
                elif entry.is_symlink():
                    entry_type = 'symlink'
                else:
                    entry_type = 'file'
            except PermissionError:
                entry_type = 'unknown'
            size = None
            mtime = None
            try:
                stat = entry.stat(follow_symlinks=False)
                size = stat.st_size
                mtime = int(stat.st_mtime)
            except Exception:
                pass
            entries.append(
                {
                    'name': name,
                    'type': entry_type,
                    'path': os.path.join(str(path), name),
                    'size': size,
                    'mtime': mtime,
                }
            )
    return entries


def _scandir_with_sudo(path: Path, show_hidden: bool) -> List[Dict[str, Any]]:
    script = (
        "import json, os, sys\n"
        f"path = {json.dumps(str(path))}\n"
        f"show_hidden = {json.dumps(bool(show_hidden))}\n"
        "entries = []\n"
        "try:\n"
        "    with os.scandir(path) as iterator:\n"
        "        for entry in iterator:\n"
        "            name = entry.name\n"
        "            if not show_hidden and name.startswith('.'):\n"
        "                continue\n"
        "            try:\n"
        "                if entry.is_dir(follow_symlinks=False):\n"
        "                    entry_type = 'directory'\n"
        "                elif entry.is_symlink():\n"
        "                    entry_type = 'symlink'\n"
        "                else:\n"
        "                    entry_type = 'file'\n"
        "            except PermissionError:\n"
        "                entry_type = 'unknown'\n"
        "            size = None\n"
        "            mtime = None\n"
        "            try:\n"
        "                stat = entry.stat(follow_symlinks=False)\n"
        "                size = stat.st_size\n"
        "                mtime = int(stat.st_mtime)\n"
        "            except Exception:\n"
        "                pass\n"
        "            entries.append({\n"
        "                'name': name,\n"
        "                'type': entry_type,\n"
        "                'path': os.path.join(path, name),\n"
        "                'size': size,\n"
        "                'mtime': mtime\n"
        "            })\n"
        "    json.dump(entries, sys.stdout)\n"
        "except FileNotFoundError:\n"
        "    sys.stderr.write('Directory not found')\n"
        "    sys.exit(44)\n"
        "except PermissionError as exc:\n"
        "    sys.stderr.write(str(exc) or 'Permission denied')\n"
        "    sys.exit(13)\n"
        "except Exception as exc:\n"
        "    sys.stderr.write(str(exc))\n"
        "    sys.exit(99)\n"
    )
    result = subprocess.run(
        ['sudo', '-n', 'python3', '-c', script],
        capture_output=True,
        text=True,
    )
    if result.returncode == 44:
        raise FileNotFoundError('Directory not found')
    if result.returncode == 13:
        message = result.stderr.strip() or 'Permission denied'
        raise PermissionError(message)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or 'Failed to list directory'
        raise RuntimeError(message)
    try:
        return json.loads(result.stdout or '[]')
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive
        raise RuntimeError(f'Failed to parse sudo output: {exc}') from exc


def _run_sudo(argv: List[str]) -> None:
    result = subprocess.run(['sudo', '-n', *argv], capture_output=True, text=True)
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or 'Permission denied'
        raise PermissionError(message)


@file_explorer_bp.route('/list', methods=['GET'])
def list_directory():
    raw_path = request.args.get('path') or str(HOME_DIR)
    show_hidden = request.args.get('hidden', '0').lower() in {'1', 'true', 'yes', 'on'}
    abs_path = Path(os.path.abspath(os.path.expanduser(raw_path)))
    try:
        entries = _scandir_entries(abs_path, show_hidden)
    except PermissionError:
        try:
            entries = _scandir_with_sudo(abs_path, show_hidden)
        except FileNotFoundError:
            return _json_err('Directory not found', 404)
        except PermissionError as exc:
            return _json_err(str(exc) or 'Permission denied', 403)
        except Exception as exc:
            return _json_err(str(exc), 500)
    except FileNotFoundError:
        return _json_err('Directory not found', 404)
    except NotADirectoryError:
        return _json_err('Not a directory', 400)
    except Exception as exc:
        return _json_err(str(exc), 500)
    entries.sort(key=lambda item: (item.get('type') != 'directory', (item.get('name') or '').lower()))
    return _json_ok(entries)


@file_explorer_bp.route('/mkdir', methods=['POST'])
def make_directory():
    data = request.get_json(silent=True) or {}
    base = os.path.abspath(os.path.expanduser(data.get('path') or ''))
    name = (data.get('name') or '').strip()
    if not name or '/' in name or name in {'.', '..'}:
        return _json_err('Invalid directory name', 400)
    if not os.path.isdir(base):
        return _json_err('Base path is not a directory', 400)
    target = os.path.abspath(os.path.join(base, name))
    try:
        os.makedirs(target, exist_ok=False)
    except FileExistsError:
        return _json_err('A file or folder with that name already exists', 400)
    except PermissionError:
        try:
            _run_sudo(['mkdir', '-p', target])
        except PermissionError as exc:
            return _json_err(str(exc) or 'Permission denied', 403)
    except Exception as exc:
        return _json_err(str(exc), 500)
    return _json_ok({'created': os.path.basename(target)})


@file_explorer_bp.route('/delete', methods=['POST'])
def delete_path():
    data = request.get_json(silent=True) or {}
    target = data.get('path')
    if not target:
        return _json_err('Path is required', 400)
    abs_target = os.path.abspath(os.path.expanduser(target))
    if not os.path.exists(abs_target):
        return _json_err('File not found', 404)
    try:
        if os.path.isdir(abs_target) and not os.path.islink(abs_target):
            shutil.rmtree(abs_target)
        else:
            os.remove(abs_target)
    except PermissionError:
        try:
            _run_sudo(['rm', '-rf', abs_target])
        except PermissionError as exc:
            return _json_err(str(exc) or 'Permission denied', 403)
    except Exception as exc:
        return _json_err(str(exc), 500)
    return _json_ok({'deleted': abs_target})


@file_explorer_bp.route('/rename', methods=['POST'])
def rename_path():
    data = request.get_json(silent=True) or {}
    source = data.get('path')
    new_name = (data.get('name') or '').strip()
    if not source or not new_name:
        return _json_err('Source path and new name are required', 400)
    src_abs = os.path.abspath(os.path.expanduser(source))
    dest_dir = os.path.dirname(src_abs)
    dest_abs = os.path.join(dest_dir, new_name)
    if os.path.exists(dest_abs):
        return _json_err('A file or folder with that name already exists', 400)
    try:
        os.replace(src_abs, dest_abs)
    except PermissionError:
        try:
            _run_sudo(['mv', src_abs, dest_abs])
        except PermissionError as exc:
            return _json_err(str(exc) or 'Permission denied', 403)
    except Exception as exc:
        return _json_err(str(exc), 500)
    return _json_ok({'renamed': os.path.basename(src_abs), 'to': os.path.basename(dest_abs)})


@file_explorer_bp.route('/copy', methods=['POST'])
def copy_path():
    data = request.get_json(silent=True) or {}
    source = data.get('source')
    dest = data.get('dest')
    if not source or not dest:
        return _json_err('Source and destination are required', 400)
    src_abs = os.path.abspath(os.path.expanduser(source))
    dest_abs = os.path.abspath(os.path.expanduser(dest))
    
    # Check if dest is a directory or a file path
    # If dest exists and is a directory, join with source basename
    # Otherwise, use dest as the full target path (from file picker saveFile)
    if os.path.exists(dest_abs) and os.path.isdir(dest_abs):
        # Destination is a directory, append source filename
        dest_abs = os.path.join(dest_abs, os.path.basename(src_abs))
        if os.path.exists(dest_abs):
            return _json_err('Target already exists at destination', 400)
    
    # Ensure parent directory exists
    dest_dir = os.path.dirname(dest_abs)
    if not os.path.exists(dest_dir):
        return _json_err('Destination directory does not exist', 400)
    
    try:
        if os.path.isdir(src_abs) and not os.path.islink(src_abs):
            shutil.copytree(src_abs, dest_abs)
        else:
            shutil.copy2(src_abs, dest_abs)
    except PermissionError:
        try:
            _run_sudo(['cp', '-r', src_abs, dest_abs])
        except PermissionError as exc:
            return _json_err(str(exc) or 'Copy failed', 500)
    except Exception as exc:
        return _json_err(str(exc), 500)
    return _json_ok({'copied': src_abs, 'to': dest_abs})


@file_explorer_bp.route('/move', methods=['POST'])
def move_path():
    data = request.get_json(silent=True) or {}
    source = data.get('source')
    dest_dir = data.get('dest')
    if not source or not dest_dir:
        return _json_err('Source and destination are required', 400)
    src_abs = os.path.abspath(os.path.expanduser(source))
    dest_dir_abs = os.path.abspath(os.path.expanduser(dest_dir))
    if not os.path.isdir(dest_dir_abs):
        return _json_err('Destination is not a directory', 400)
    dest_abs = os.path.join(dest_dir_abs, os.path.basename(src_abs))
    if os.path.exists(dest_abs):
        return _json_err('Target already exists at destination', 400)
    try:
        os.replace(src_abs, dest_abs)
    except PermissionError:
        try:
            _run_sudo(['mv', src_abs, dest_abs])
        except PermissionError as exc:
            return _json_err(str(exc) or 'Move failed', 500)
    except Exception as exc:
        return _json_err(str(exc), 500)
    return _json_ok({'moved': src_abs, 'to': dest_abs})


@file_explorer_bp.route('/resolve_symlink', methods=['GET'])
def resolve_symlink():
    """Resolve a symlink to its target path."""
    path = request.args.get('path')
    if not path:
        return _json_err('Path is required', 400)
    
    abs_path = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(abs_path):
        return _json_err('Path does not exist', 404)
    
    if not os.path.islink(abs_path):
        # Not a symlink, return the path itself
        return _json_ok({'path': abs_path, 'target': abs_path, 'is_symlink': False})
    
    try:
        # Resolve the symlink
        target = os.readlink(abs_path)
        # If target is relative, make it absolute based on symlink's directory
        if not os.path.isabs(target):
            symlink_dir = os.path.dirname(abs_path)
            target = os.path.abspath(os.path.join(symlink_dir, target))
        
        # Check if target exists and what type it is
        target_exists = os.path.exists(target)
        target_type = 'unknown'
        if target_exists:
            if os.path.isdir(target):
                target_type = 'directory'
            elif os.path.isfile(target):
                target_type = 'file'
            elif os.path.islink(target):
                target_type = 'symlink'  # Target is itself a symlink
        
        return _json_ok({
            'path': abs_path,
            'target': target,
            'is_symlink': True,
            'target_exists': target_exists,
            'target_type': target_type
        })
    except Exception as exc:
        return _json_err(str(exc), 500)


@file_explorer_bp.route('/chmod', methods=['POST'])
def chmod_path():
    data = request.get_json(silent=True) or {}
    target = data.get('path')
    mode_str = str(data.get('mode', '')).strip()
    if not target or not mode_str:
        return _json_err('Path and mode are required', 400)
    target_abs = os.path.abspath(os.path.expanduser(target))
    try:
        mode_value = int(mode_str, 8)
    except Exception:
        return _json_err('Invalid mode format', 400)
    try:
        os.chmod(target_abs, mode_value)
    except PermissionError:
        try:
            _run_sudo(['chmod', oct(mode_value)[2:], target_abs])
        except PermissionError as exc:
            return _json_err(str(exc) or 'Permission denied', 403)
    except Exception as exc:
        return _json_err(str(exc), 500)
    return _json_ok({'path': target_abs, 'mode': oct(mode_value)})


@file_explorer_bp.route('/chown', methods=['POST'])
def chown_path():
    data = request.get_json(silent=True) or {}
    target = data.get('path')
    user = (data.get('user') or '').strip()
    group = (data.get('group') or '').strip()
    if not target or (not user and not group):
        return _json_err('Path and user/group required', 400)
    target_abs = os.path.abspath(os.path.expanduser(target))
    spec = f"{user}:{group}" if user and group else (user if user else f":{group}")
    try:
        shutil.chown(target_abs, user or None, group or None)
    except Exception:
        try:
            _run_sudo(['chown', spec, target_abs])
        except PermissionError as exc:
            return _json_err(str(exc) or 'Permission denied', 403)
    return _json_ok({'path': target_abs, 'owner': user or 'unchanged', 'group': group or 'unchanged'})


# Expose blueprint under a predictable attribute name for discovery
bp = file_explorer_bp
