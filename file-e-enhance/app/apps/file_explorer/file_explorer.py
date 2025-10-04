
    # app/apps/file_explorer/file_explorer.py
    from flask import Blueprint, request, jsonify
    import os, shutil, subprocess, json

    file_explorer_bp = Blueprint('file_explorer_bp', __name__)

    def _json_ok(data, status=200):
        return jsonify({"ok": True, "data": data}), status

    def _json_err(msg, status=400):
        return jsonify({"ok": False, "error": str(msg)}), status

    @file_explorer_bp.route('/list', methods=['GET'])
    def list_directory():
        path = request.args.get('path') or os.path.expanduser('~')
        show_hidden = request.args.get('hidden', '0').lower() in ('1', 'true', 'yes', 'on')
        abs_path = os.path.abspath(os.path.expanduser(path))
        entries = []
        try:
            with os.scandir(abs_path) as it:
                for entry in it:
                    name = entry.name
                    if not show_hidden and name.startswith('.'):
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            type_ = 'directory'
                        elif entry.is_symlink():
                            type_ = 'symlink'
                        else:
                            type_ = 'file'
                    except PermissionError:
                        type_ = 'unknown'
                    try:
                        stat = entry.stat(follow_symlinks=False)
                        size = stat.st_size
                        mtime = int(stat.st_mtime)
                    except Exception:
                        size = None
                        mtime = None
                    entries.append({
                        "name": name,
                        "type": type_,
                        "path": os.path.join(abs_path, name),
                        "size": size,
                        "mtime": mtime
                    })
        except PermissionError:
            # Fallback to sudo for listing
            code = (
                "import os, json, sys; "
                f"path={abs_path!r}; show_hidden={show_hidden!r}; "
                "ents=[]; "
                "try:
"
                "  files = os.scandir(path)
"
                "except Exception as e:
"
                "  print(str(e), file=sys.stderr); sys.exit(1)
"
                "for entry in files:
"
                "  name=entry.name
"
                "  if (not show_hidden) and name.startswith('.'):
"
                "    continue
"
                "  try:
"
                "    isdir = entry.is_dir(follow_symlinks=False)
"
                "    typ = 'directory' if isdir else ('file' if entry.is_file(follow_symlinks=False) else 'unknown')
"
                "  except Exception:
"
                "    typ = 'unknown'
"
                "  try:
"
                "    st = entry.stat(follow_symlinks=False)
"
                "    size = st.st_size; mtime = int(st.st_mtime)
"
                "  except Exception:
"
                "    size = None; mtime = None
"
                "  ents.append({'name': name, 'type': typ, 'path': os.path.join(path, name), 'size': size, 'mtime': mtime})
"
                "json.dump(ents, sys.stdout)"
            )
            result = subprocess.run(
                ['sudo', '-n', 'python3', '-c', code],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                err = result.stderr.strip() or "Failed to list directory"
                return _json_err(err, 403 if 'Permission' in err else 500)
            try:
                entries = json.loads(result.stdout)
            except Exception as e:
                return _json_err(f"Parse error: {e}", 500)
        except FileNotFoundError:
            return _json_err("Directory not found", 404)
        except NotADirectoryError:
            return _json_err("Not a directory", 400)
        except Exception as e:
            return _json_err(str(e), 500)
        entries.sort(key=lambda x: ((x.get('type') != 'directory'), x.get('name', '').lower()))
        return _json_ok(entries)

    @file_explorer_bp.route('/mkdir', methods=['POST'])
    def make_directory():
        data = request.get_json(silent=True) or {}
        base = data.get('path') or ''
        name = (data.get('name') or '').strip()
        if not name or '/' in name or name in ('.', '..'):
            return _json_err("Invalid directory name", 400)
        base = os.path.abspath(os.path.expanduser(base))
        target = os.path.abspath(os.path.join(base, name))
        if not os.path.isdir(base):
            return _json_err("Base path is not a directory", 400)
        try:
            os.makedirs(target, exist_ok=False)
        except FileExistsError:
            return _json_err("A file or folder with that name already exists", 400)
        except PermissionError:
            result = subprocess.run(['sudo', '-n', 'mkdir', '-p', target], capture_output=True, text=True)
            if result.returncode != 0:
                err = result.stderr.strip() or "Permission denied"
                return _json_err(err, 403)
        except Exception as e:
            return _json_err(str(e), 500)
        return _json_ok({"created": os.path.basename(target)})

    @file_explorer_bp.route('/delete', methods=['POST'])
    def delete_path():
        data = request.get_json(silent=True) or {}
        target = data.get('path')
        if not target:
            return _json_err("Path is required", 400)
        target = os.path.abspath(os.path.expanduser(target))
        if not os.path.exists(target):
            return _json_err("File not found", 404)
        try:
            if os.path.isdir(target) and not os.path.islink(target):
                shutil.rmtree(target)
            else:
                os.remove(target)
        except PermissionError:
            result = subprocess.run(['sudo', '-n', 'rm', '-rf', target], capture_output=True, text=True)
            if result.returncode != 0:
                err = result.stderr.strip() or "Permission denied"
                return _json_err(err, 403)
        except Exception as e:
            return _json_err(str(e), 500)
        return _json_ok({"deleted": target})

    @file_explorer_bp.route('/rename', methods=['POST'])
    def rename_path():
        data = request.get_json(silent=True) or {}
        src = data.get('path')
        new_name = (data.get('name') or '').strip()
        if not src or not new_name:
            return _json_err("Source path and new name are required", 400)
        src = os.path.abspath(os.path.expanduser(src))
        base_dir = os.path.dirname(src)
        dst = os.path.join(base_dir, new_name)
        if os.path.exists(dst):
            return _json_err("A file/folder with that name already exists", 400)
        try:
            os.replace(src, dst)
        except PermissionError:
            result = subprocess.run(['sudo', '-n', 'mv', src, dst], capture_output=True, text=True)
            if result.returncode != 0:
                err = result.stderr.strip() or "Permission denied"
                return _json_err(err, 403)
        except Exception as e:
            return _json_err(str(e), 500)
        return _json_ok({"renamed": os.path.basename(src), "to": os.path.basename(dst)})

    @file_explorer_bp.route('/copy', methods=['POST'])
    def copy_path():
        data = request.get_json(silent=True) or {}
        src = data.get('source')
        dest_dir = data.get('dest')
        if not src or not dest_dir:
            return _json_err("Source and destination are required", 400)
        src = os.path.abspath(os.path.expanduser(src))
        dest_dir = os.path.abspath(os.path.expanduser(dest_dir))
        if not os.path.isdir(dest_dir):
            return _json_err("Destination is not a directory", 400)
        dest_path = os.path.join(dest_dir, os.path.basename(src))
        if os.path.exists(dest_path):
            return _json_err("Target already exists at destination", 400)
        try:
            if os.path.isdir(src) and not os.path.islink(src):
                shutil.copytree(src, dest_path)
            else:
                shutil.copy2(src, dest_path)
        except PermissionError:
            result = subprocess.run(['sudo', '-n', 'cp', '-r', src, dest_path], capture_output=True, text=True)
            if result.returncode != 0:
                err = result.stderr.strip() or "Copy failed"
                return _json_err(err, 500)
        except Exception as e:
            return _json_err(str(e), 500)
        return _json_ok({"copied": src, "to": dest_path})

    @file_explorer_bp.route('/move', methods=['POST'])
    def move_path():
        data = request.get_json(silent=True) or {}
        src = data.get('source')
        dest_dir = data.get('dest')
        if not src or not dest_dir:
            return _json_err("Source and destination are required", 400)
        src = os.path.abspath(os.path.expanduser(src))
        dest_dir = os.path.abspath(os.path.expanduser(dest_dir))
        if not os.path.isdir(dest_dir):
            return _json_err("Destination is not a directory", 400)
        dest_path = os.path.join(dest_dir, os.path.basename(src))
        if os.path.exists(dest_path):
            return _json_err("Target already exists at destination", 400)
        try:
            os.replace(src, dest_path)
        except PermissionError:
            result = subprocess.run(['sudo', '-n', 'mv', src, dest_path], capture_output=True, text=True)
            if result.returncode != 0:
                err = result.stderr.strip() or "Move failed"
                return _json_err(err, 500)
        except Exception as e:
            return _json_err(str(e), 500)
        return _json_ok({"moved": src, "to": dest_path})

    @file_explorer_bp.route('/chmod', methods=['POST'])
    def chmod_path():
        data = request.get_json(silent=True) or {}
        target = data.get('path')
        mode_str = str(data.get('mode', '')).strip()
        if not target or not mode_str:
            return _json_err("Path and mode are required", 400)
        target = os.path.abspath(os.path.expanduser(target))
        try:
            mode_val = int(mode_str, 8)
        except Exception:
            return _json_err("Invalid mode format", 400)
        try:
            os.chmod(target, mode_val)
        except PermissionError:
            result = subprocess.run(['sudo', '-n', 'chmod', oct(mode_val)[2:], target], capture_output=True, text=True)
            if result.returncode != 0:
                err = result.stderr.strip() or "Permission denied"
                return _json_err(err, 403)
        except Exception as e:
            return _json_err(str(e), 500)
        return _json_ok({"path": target, "mode": oct(mode_val)})

    @file_explorer_bp.route('/chown', methods=['POST'])
    def chown_path():
        data = request.get_json(silent=True) or {}
        target = data.get('path')
        user = (data.get('user') or '').strip()
        group = (data.get('group') or '').strip()
        if not target or (not user and not group):
            return _json_err("Path and user/group required", 400)
        target = os.path.abspath(os.path.expanduser(target))
        spec = f"{user}:{group}" if user and group else (user if user else f":{group}")
        try:
            shutil.chown(target, user or None, group or None)
        except Exception:
            result = subprocess.run(['sudo', '-n', 'chown', spec, target], capture_output=True, text=True)
            if result.returncode != 0:
                err = result.stderr.strip() or "Permission denied"
                return _json_err(err, 403)
        return _json_ok({"path": target, "owner": user or "unchanged", "group": group or "unchanged"})
