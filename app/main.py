#!/bin/env python
# main.py (project_root)
import errno
import json
import os
import subprocess
import sys
import threading
import importlib.util
import traceback
import traceback
import time
import uuid
import signal
from pathlib import Path
from typing import List

# Add project root to the Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from flask import Flask, render_template, jsonify, send_from_directory, send_file, request, current_app, Response
import requests
from app.libs.framework_shells import framework_shells_bp, _manager, FrameworkShellManager
from app.libs.jobs import jobs_bp
from app.libs.bookmarks import bookmarks_bp
from app.libs.app_manager import ensure_app_running
from app.libs.app_lifecycle import start_background_tasks
from flask_sock import Sock
from simple_websocket import Client as WSClient, ConnectionClosed, Server

app = Flask(__name__)
app.register_blueprint(framework_shells_bp)
app.register_blueprint(jobs_bp, url_prefix="/api")
app.register_blueprint(bookmarks_bp, url_prefix="/api")
# Initialize WebSocket support and expose to modules
sock = Sock(app)
app.config["SOCK"] = sock

RUN_ID = os.environ.get("TE_RUN_ID")
if not RUN_ID:
    RUN_ID = f"run_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    os.environ["TE_RUN_ID"] = RUN_ID
else:
    os.environ.setdefault("TE_RUN_ID", RUN_ID)
app.config["TE_RUN_ID"] = RUN_ID

APP_STARTED_AT = time.time()

try:  # Optional dependency for richer process metrics
    import psutil  # type: ignore
except Exception:  # pragma: no cover - psutil may be unavailable.
    psutil = None  # type: ignore

# Pre-initialize to avoid NameError if imported differently
loaded_extensions = []
loaded_apps = []
_SPECIAL_WORKER_HTTP_ROUTES: set[str] = set()
_SPECIAL_WORKER_WS_ROUTES: set[tuple[str, bool]] = set()
_SPECIAL_WORKER_WS_RAW: dict[str, bool] = {}

SETTINGS_FILE = Path(os.path.expanduser('~/.cache/termux_extensions/settings.json'))
STATE_STORE_FILE = Path(os.path.expanduser('~/.cache/termux_extensions/state_store.json'))
STATE_STORE_LOCK = threading.RLock()

# Ensure importlib-based imports and spec-based module loads receive the current run id
# This allows extension/app modules to access TE_RUN_ID at import time (as a global)
try:
    _orig_module_from_spec = importlib.util.module_from_spec

    def _module_from_spec_with_runid(spec):
        mod = _orig_module_from_spec(spec)
        try:
            run_id = app.config.get("TE_RUN_ID")
        except Exception:
            run_id = None
        if run_id is not None:
            # set both attribute and dict entry to make it available during exec_module
            setattr(mod, 'TE_RUN_ID', run_id)
            mod.__dict__['TE_RUN_ID'] = run_id
        return mod

    importlib.util.module_from_spec = _module_from_spec_with_runid
except Exception:
    # If anything fails here, fall back to original importlib behavior
    pass

try:
    _orig_import_module = importlib.import_module

    def _import_module_with_runid(name, package=None):
        mod = _orig_import_module(name, package=package)
        try:
            run_id = app.config.get("TE_RUN_ID")
        except Exception:
            run_id = None
        if run_id is not None:
            setattr(mod, 'TE_RUN_ID', run_id)
            mod.__dict__['TE_RUN_ID'] = run_id
        return mod

    importlib.import_module = _import_module_with_runid
except Exception:
    pass


def _load_settings() -> dict:
    try:
        if SETTINGS_FILE.is_file():
            with SETTINGS_FILE.open('r', encoding='utf-8') as fh:
                data = json.load(fh)
                if isinstance(data, dict):
                    return data
    except Exception as exc:
        print(f"Failed to load settings: {exc}")
    return {}


def _save_settings(payload: dict) -> dict:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SETTINGS_FILE.open('w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    return payload


def _apply_settings_to_config():
    """Load settings from disk and apply relevant values to app.config."""
    settings = _load_settings()
    if settings.get("TE_MAX_SERVICE_SHELLS") is not None:
        app.config["TE_MAX_SERVICE_SHELLS"] = int(settings["TE_MAX_SERVICE_SHELLS"])
    if settings.get("TE_MAX_APP_SHELLS") is not None:
        app.config["TE_MAX_APP_SHELLS"] = int(settings["TE_MAX_APP_SHELLS"])
    if settings.get("APP_TTL_SECONDS") is not None:
        app.config["APP_TTL_SECONDS"] = int(settings["APP_TTL_SECONDS"])


def _load_state_store() -> dict:
    with STATE_STORE_LOCK:
        try:
            if STATE_STORE_FILE.is_file():
                with STATE_STORE_FILE.open('r', encoding='utf-8') as fh:
                    data = json.load(fh)
                    if isinstance(data, dict):
                        return data
        except Exception as exc:
            print(f"Failed to load state store: {exc}")
        return {}


def _save_state_store(store: dict) -> None:
    with STATE_STORE_LOCK:
        STATE_STORE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = STATE_STORE_FILE.with_suffix('.tmp')
        with tmp_path.open('w', encoding='utf-8') as fh:
            json.dump(store, fh, indent=2, ensure_ascii=False)
        tmp_path.replace(STATE_STORE_FILE)


def _parse_meta_file(meta_path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    try:
        with meta_path.open('r', encoding='utf-8') as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line or '=' not in line:
                    continue
                key, value = line.split('=', 1)
                cleaned = value.strip().strip('"').strip("'")
                data[key.strip()] = cleaned
    except Exception:
        return {}
    return data


def _collect_interactive_session_stats(run_id: str | None) -> dict[str, object]:
    cache_dir = Path(os.path.expanduser('~/.cache/te'))
    total = 0
    matching = 0
    matching_sids: List[str] = []
    if not cache_dir.is_dir():
        return {"total": 0, "matching_run": 0, "sids": []}
    for meta_path in cache_dir.glob('*/meta'):
        meta = _parse_meta_file(meta_path)
        if meta.get('SESSION_TYPE') != 'interactive':
            continue
        total += 1
        if run_id and meta.get('RUN_ID') != run_id:
            continue
        matching += 1
        sid = meta.get('SID') or meta_path.parent.name
        matching_sids.append(sid)
    return {"total": total, "matching_run": matching, "sids": matching_sids}

def _scandir_entries(path: str, include_hidden: bool) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    with os.scandir(path) as handle:
        for entry in handle:
            name = entry.name
            if not include_hidden and name.startswith('.'):
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
            full_path = os.path.join(path, name)
            entries.append({
                'name': name,
                'type': entry_type,
                'path': os.path.abspath(full_path),
            })
    entries.sort(key=lambda item: (item['type'] != 'directory', item['name'].lower()))
    return entries


def _scandir_with_sudo(path: str, include_hidden: bool) -> list[dict[str, str]]:
    script = (
        'import json, os, sys\n'
        f"path = {json.dumps(path)}\n"
        f"include_hidden = { 'True' if include_hidden else 'False' }\n"
        'entries = []\n'
        'try:\n'
        '    with os.scandir(path) as handle:\n'
        '        for entry in handle:\n'
        '            name = entry.name\n'
        '            if not include_hidden and name.startswith(\'.\'):\n'
        '                continue\n'
        '            try:\n'
        '                if entry.is_dir(follow_symlinks=False):\n'
        "                    entry_type = 'directory'\n"
        '                elif entry.is_symlink():\n'
        "                    entry_type = 'symlink'\n"
        '                else:\n'
        "                    entry_type = 'file'\n"
        '            except PermissionError:\n'
        "                entry_type = 'unknown'\n"
        '            full_path = os.path.join(path, name)\n'
        '            entries.append({"name": name, "type": entry_type, "path": os.path.abspath(full_path)})\n'
        '    entries.sort(key=lambda item: (item["type"] != "directory", item["name"].lower()))\n'
        '    json.dump(entries, sys.stdout)\n'
        'except FileNotFoundError:\n'
        "    sys.stderr.write('Directory not found')\n"
        '    sys.exit(44)\n'
        'except PermissionError as exc:\n'
        "    sys.stderr.write(f'Permission denied: {exc}')\n"
        '    sys.exit(13)\n'
        'except Exception as exc:\n'
        "    sys.stderr.write(str(exc))\n"
        '    sys.exit(99)\n'
    )
    result = subprocess.run(
        ['sudo', '-n', 'python3', '-c', script],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or 'sudo browse failed'
        if result.returncode == 44:
            raise FileNotFoundError(message)
        if result.returncode == 13:
            raise PermissionError(message)
        raise PermissionError(message)
    try:
        data = json.loads(result.stdout)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError as exc:
        raise PermissionError(f'Failed to parse sudo output: {exc}')
    raise PermissionError('Invalid sudo output')


def _resolve_browse_path(raw_path: str, root: str) -> tuple[str | None, str | None]:
    home_dir = os.path.expanduser('~')
    target_root = (root or 'home').lower()
    allow_outside = target_root in {'system', 'absolute'}

    candidate = (raw_path or '~').strip()
    if not candidate:
        candidate = '~'

    try:
        if candidate.startswith('~'):
            expanded = os.path.expanduser(candidate)
        elif candidate.startswith('/'):
            expanded = os.path.abspath(os.path.normpath(candidate))
        else:
            expanded = os.path.join(home_dir, candidate)
        expanded = os.path.abspath(expanded)
    except Exception as exc:
        return None, f'Invalid path: {exc}'

    if not allow_outside and not expanded.startswith(home_dir):
        return None, 'Access denied'

    return expanded, None

def run_script(script_name, app_root_path, args=None):
    """Helper function to run a shell script and return its output."""
    project_root = os.path.dirname(app_root_path)
    scripts_dir = os.path.join(project_root, 'scripts')
    if args is None: args = []
    script_path = os.path.join(scripts_dir, script_name)
    try:
        subprocess.run(['chmod', '+x', script_path], check=True)
        result = subprocess.run([script_path] + args, capture_output=True, text=True, check=True)
        return result.stdout, None
    except Exception as e:
        return None, str(e)

def load_services():
    """Scans for services in app/libs and imports them to register job handlers."""
    libs_dir = os.path.join(os.path.dirname(__file__), 'libs')
    if not os.path.exists(libs_dir):
        return

    for filename in os.listdir(libs_dir):
        if filename.endswith('.py') and not filename.startswith('__'):
            module_name = f"app.libs.{filename.replace('.py', '')}"
            try:
                importlib.import_module(module_name)
                print(f"Loaded service: {module_name}")
            except Exception as e:
                print(f"Error loading service {module_name}: {e}")


# --- Extension Loader ---

def load_extensions():
    """Scans for extensions, loads their blueprints, and returns their manifests."""
    extensions = []
    extensions_dir = os.path.join(os.path.dirname(__file__), 'extensions')
    if not os.path.exists(extensions_dir):
        return []

    for ext_name in os.listdir(extensions_dir):
        ext_path = os.path.join(extensions_dir, ext_name)
        manifest_path = os.path.join(ext_path, 'manifest.json')
        
        if not os.path.isdir(ext_path) or not os.path.exists(manifest_path):
            continue

        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
            manifest['_ext_dir'] = ext_name
            extensions.append(manifest)

        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
        if backend_file:
            module_name = f"app.extensions.{ext_name}.{backend_file.replace('.py', '')}"
            spec = importlib.util.spec_from_file_location(module_name, os.path.join(ext_path, backend_file))
            try:
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)  # may raise anything
            except BaseException as e:
                manifest['__load_error__'] = f"{type(e).__name__}: {e}"
                manifest['__load_trace__'] = traceback.format_exc()[-2048:]
            else:
                from flask import Blueprint
                try:
                    for obj_name in dir(module):
                        obj = getattr(module, obj_name)
                        if isinstance(obj, Blueprint):
                            if ext_name == 'apps':
                                app.register_blueprint(obj, url_prefix='')
                            else:
                                app.register_blueprint(obj, url_prefix=f"/api/ext/{ext_name}")
                            break
                    else:
                        manifest['__load_warning__'] = 'No Flask Blueprint found in backend module'
                except BaseException as e:
                    manifest['__load_error__'] = f"Blueprint registration failed: {type(e).__name__}: {e}"
                    manifest['__load_trace__'] = traceback.format_exc()[-2048:]
    return extensions

# --- Main Application Routes ---

@app.route('/')
def index():
    return render_template('index.html')

def load_apps():
    """Scans for apps, loads their blueprints (if any), and returns their manifests."""
    apps = []
    apps_dir = os.path.join(os.path.dirname(__file__), 'apps')
    if not os.path.exists(apps_dir):
        return []

    for app_name in os.listdir(apps_dir):
        app_path = os.path.join(apps_dir, app_name)
        manifest_path = os.path.join(app_path, 'manifest.json')

        if not os.path.isdir(app_path) or not os.path.exists(manifest_path):
            continue

        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
            manifest['_dir'] = app_name
            apps.append(manifest)


    return apps


def _register_worker_http_route(app_id: str, path: str):
    """Register an HTTP proxy route for a worker-specific prefix."""
    normalized = path.lstrip('/')
    route = f"/{normalized}"
    endpoint_base = f"proxy_app_http_{app_id}_{normalized.replace('/', '_')}"

    def handle_root(app_id=app_id, normalized=normalized):
        target = normalized
        if _maybe_upgrade_to_websocket(app_id, target):
            return ''
        return proxy_app_request(app_id, normalized)

    def handle_subpath(subpath, app_id=app_id, normalized=normalized):
        target = f"{normalized}/{subpath}" if subpath else normalized
        if _maybe_upgrade_to_websocket(app_id, target):
            return ''
        return proxy_app_request(app_id, target)

    app.add_url_rule(
        route,
        endpoint=endpoint_base,
        view_func=handle_root,
        methods=['GET', 'POST', 'OPTIONS'],
    )
    app.add_url_rule(
        f"{route}/<path:subpath>",
        endpoint=f"{endpoint_base}_sub",
        view_func=handle_subpath,
        methods=['GET', 'POST', 'OPTIONS'],
    )


def _register_worker_ws_route(app_id: str, path: str, raw: bool):
    """Register a WebSocket proxy route for a worker path."""
    normalized = path.lstrip('/')
    route = f"/{normalized}"
    _SPECIAL_WORKER_WS_RAW.setdefault(normalized, raw)

    def handler(client_ws, app_id=app_id, normalized=normalized, raw=raw):
        try:
            with open("/tmp/nice_code_cm6_ws_proxy.log", "a", encoding="utf-8") as fh:
                fh.write(f"handler invoked for app={app_id} path={normalized} raw={raw} qs={request.query_string.decode('utf-8')}\\n")
        except Exception:
            pass
        return _proxy_app_websocket(client_ws, app_id, normalized, raw=raw)

    endpoint_name = f"ws_proxy_{app_id}_{normalized.replace('/', '_')}_{'raw' if raw else 'norm'}"
    sock.route(route, endpoint=endpoint_name)(handler)


def _register_worker_proxy_routes(manifest: dict):
    """Install HTTP/WS proxy routes declared in an app manifest."""
    proxy_cfg = manifest.get('worker_proxy') or {}
    app_id = manifest.get('id')
    if not app_id:
        return

    ws_entries = proxy_cfg.get('websocket') or []
    for entry in ws_entries:
        if isinstance(entry, str):
            path = entry
            raw = False
        elif isinstance(entry, dict):
            path = entry.get('path')
            raw = bool(entry.get('raw'))
        else:
            continue
        if not path:
            continue
        normalized = path.lstrip('/')
        key = (normalized, raw)
        if key in _SPECIAL_WORKER_WS_ROUTES:
            continue
        _SPECIAL_WORKER_WS_ROUTES.add(key)
        _register_worker_ws_route(app_id, normalized, raw=raw)

    http_paths = proxy_cfg.get('http') or []
    for path in http_paths:
        if not isinstance(path, str):
            continue
        normalized = path.lstrip('/')
        if normalized in _SPECIAL_WORKER_HTTP_ROUTES:
            continue
        _SPECIAL_WORKER_HTTP_ROUTES.add(normalized)
        _register_worker_http_route(app_id, normalized)


def _maybe_upgrade_to_websocket(app_id: str, normalized_path: str) -> bool:
    """Detect WS upgrade attempts hitting HTTP routes and hand them to the WS proxy."""
    if normalized_path not in _SPECIAL_WORKER_WS_RAW:
        return False
    upgrade = request.headers.get('Upgrade', '')
    connection = request.headers.get('Connection', '')
    if 'websocket' not in upgrade.lower() or 'upgrade' not in connection.lower():
        return False
    raw_flag = _SPECIAL_WORKER_WS_RAW.get(normalized_path, False)
    try:
        with open('/tmp/nice_code_cm6_ws_proxy.log', 'a', encoding='utf-8') as fh:
            fh.write(
                f"upgrade reroute app={app_id} path={normalized_path} raw={raw_flag} "
                f"headers={{'Upgrade': '{upgrade}', 'Connection': '{connection}'}}\\n"
            )
    except Exception:
        pass
    server_ws = Server.accept(request.environ)
    _proxy_app_websocket(server_ws, app_id, normalized_path, raw=raw_flag)
    return True


@app.route('/extensions/<path:ext_dir>/<path:filename>')
def serve_extension_file(ext_dir, filename):
    return send_from_directory(os.path.join(app.root_path, 'extensions', ext_dir), filename)

@app.route('/api/extensions')
def get_extensions():
    return jsonify({"ok": True, "data": current_app.config.get('LOADED_EXTENSIONS', [])})

@app.route('/api/run_command', methods=['POST'])
def run_command_endpoint():
    """Executes a shell command and returns its stdout."""
    data = request.get_json()
    if not data or 'command' not in data:
        return jsonify({"ok": False, "error": '"command" field is required.'}), 400

    command = data['command']

    try:
        result = subprocess.run(
            command, 
            shell=True, 
            capture_output=True, 
            text=True, 
            check=True
        )
        return jsonify({"ok": True, "data": {"stdout": result.stdout}})
    except subprocess.CalledProcessError as e:
        return jsonify({"ok": False, "error": 'Command failed', 'stderr': e.stderr}), 500
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/list_path_executables')
def list_path_executables():
    """Lists all unique executables on the user's PATH."""
    output, error = run_script('list_path_execs.sh', app.root_path)
    if error:
        return jsonify({"ok": False, "error": error}), 500
    try:
        return jsonify({"ok": True, "data": json.loads(output)})
    except json.JSONDecodeError:
        return jsonify({"ok": False, "error": 'Failed to decode JSON from list_path_execs script.'}), 500

@app.route('/api/browse')
def browse_path():
    """Browses a given path, defaulting to the user's home directory."""
    path = request.args.get('path', '~')
    root_param = request.args.get('root', 'home').lower()
    # Expand the tilde and normalize the path to resolve `..` etc.
    expanded_path, error_message = _resolve_browse_path(path, root_param)
    if error_message:
        status = 403 if error_message == 'Access denied' else 400
        return jsonify({"ok": False, "error": error_message}), status
    if not expanded_path:
        return jsonify({"ok": False, "error": 'Invalid path'}), 400

    hidden_flag = request.args.get('hidden', '').lower()
    include_hidden = hidden_flag in {'1', 'true', 'yes', 'on'}

    used_sudo = False
    try:
        entries = _scandir_entries(expanded_path, include_hidden)
    except PermissionError:
        try:
            entries = _scandir_with_sudo(expanded_path, include_hidden)
            used_sudo = True
        except FileNotFoundError as exc:
            return jsonify({"ok": False, "error": str(exc) or 'Directory not found'}), 404
        except PermissionError as exc:
            return jsonify({"ok": False, "error": str(exc) or 'Access denied'}), 403
        except Exception as exc:
            return jsonify({"ok": False, "error": str(exc) or 'Failed to browse directory'}), 500
    except FileNotFoundError:
        return jsonify({"ok": False, "error": 'Directory not found'}), 404
    except OSError as exc:
        if exc.errno == errno.ENOENT:
            return jsonify({"ok": False, "error": 'Directory not found'}), 404
        if exc.errno in {errno.EACCES, errno.EPERM}:
            try:
                entries = _scandir_with_sudo(expanded_path, include_hidden)
                used_sudo = True
            except PermissionError as inner:
                return jsonify({"ok": False, "error": str(inner) or 'Access denied'}), 403
        else:
            return jsonify({"ok": False, "error": f'Unable to browse: {exc}'}), 500

    return jsonify({"ok": True, "data": entries, "meta": {"used_sudo": used_sudo}})

@app.route('/api/settings', methods=['GET', 'POST'])
def settings_handler():
    if request.method == 'GET':
        data = _load_settings()
        return jsonify({"ok": True, "data": data})

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": 'JSON object required'}), 400
    try:
        saved = _save_settings(payload)
    except Exception as exc:
        return jsonify({"ok": False, "error": f'Failed to save settings: {exc}'}), 500
    return jsonify({"ok": True, "data": saved})


@app.route('/api/state', methods=['GET', 'POST', 'DELETE'])
def state_handler():
    if request.method == 'GET':
        keys = request.args.getlist('key')
        if not keys:
            return jsonify({"ok": False, "error": 'query parameter "key" is required'}), 400
        store = _load_state_store()
        data = {key: store.get(key) for key in keys}
        return jsonify({"ok": True, "data": data})

    if request.method == 'POST':
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"ok": False, "error": 'JSON object required'}), 400
        key = payload.get('key')
        if not isinstance(key, str) or not key.strip():
            return jsonify({"ok": False, "error": '"key" must be a non-empty string'}), 400
        merge = bool(payload.get('merge'))
        value = payload.get('value')
        store = _load_state_store()
        if merge and isinstance(value, dict) and isinstance(store.get(key), dict):
            merged = dict(store.get(key) or {})
            merged.update(value)
            store[key] = merged
        else:
            store[key] = value
        try:
            _save_state_store(store)
        except Exception as exc:
            return jsonify({"ok": False, "error": f'Failed to persist state: {exc}'}), 500
        return jsonify({"ok": True, "data": store.get(key)})

    # DELETE
    keys = request.args.getlist('key')
    if not keys:
        return jsonify({"ok": False, "error": 'query parameter "key" is required'}), 400
    store = _load_state_store()
    removed = 0
    for key in keys:
        if key in store:
            removed += 1
            store.pop(key, None)
    try:
        _save_state_store(store)
    except Exception as exc:
        return jsonify({"ok": False, "error": f'Failed to persist state: {exc}'}), 500
    return jsonify({"ok": True, "data": {"removed": removed}})

def _terminate_framework_shells(manager: FrameworkShellManager) -> None:
    for record in list(manager.list_shells()):
        try:
            manager.remove_shell(record.id, force=True)
        except Exception as exc:
            print(f"Failed to remove shell {record.id}: {exc}")


@app.route('/api/framework/runtime/metrics')
def framework_runtime_metrics():
    mgr = _manager()
    run_id = app.config.get("TE_RUN_ID")
    data = {
        "run_id": run_id,
        "supervisor_pid": int(os.environ.get("TE_SUPERVISOR_PID", "0")) or None,
        "app_pid": os.getpid(),
        "started_at": APP_STARTED_AT,
        "uptime": max(0.0, time.time() - APP_STARTED_AT),
        "framework_shells": mgr.aggregate_resource_stats(),
        "interactive_sessions": _collect_interactive_session_stats(run_id),
        "process": None,
    }
    if psutil:
        try:
            proc = psutil.Process(os.getpid())  # type: ignore[arg-type]
            with proc.oneshot():
                data["process"] = {
                    "cpu_percent": proc.cpu_percent(interval=0.0),
                    "memory_rss": proc.memory_info().rss,
                    "num_threads": proc.num_threads(),
                }
        except (psutil.NoSuchProcess, psutil.AccessDenied):  # type: ignore[attr-defined]
            data["process"] = None
    return jsonify({"ok": True, "data": data})


@app.route('/api/framework/runtime/shutdown', methods=['POST'])
def framework_runtime_shutdown():
    token = request.headers.get("X-Framework-Key") or request.args.get("token")
    expected = os.environ.get("TE_FRAMEWORK_SHELL_TOKEN")
    if expected and token != expected:
        return jsonify({"ok": False, "error": "Forbidden"}), 403

    mgr = _manager()
    _terminate_framework_shells(mgr)

    supervisor_pid = int(os.environ.get("TE_SUPERVISOR_PID", "0") or 0)
    if supervisor_pid:
        try:
            os.kill(supervisor_pid, signal.SIGTERM)
        except OSError:
            pass
    else:
        func = request.environ.get('werkzeug.server.shutdown')
        if func:
            func()

    return jsonify({"ok": True, "data": {"message": "Shutdown initiated"}})



# --- PWA: Service Worker ---
@app.route('/sw.js')
def service_worker():
    # Serve the service worker from a deterministic path at the app root scope
    return send_from_directory(os.path.join(app.root_path, 'static', 'js'), 'sw.js', mimetype='application/javascript')


# --- Lazy initialization compatible with Flask 3.x (before_first_request removed) ---
_initialized = False
_init_lock = None
try:
    import threading as _threading
    _init_lock = _threading.Lock()
except Exception:
    class _DummyLock:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
    _init_lock = _DummyLock()

def _ensure_initialized():
    global _initialized, loaded_extensions, loaded_apps
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        try:
            _apply_settings_to_config()
        except Exception as e:
            print(f"Error loading settings: {e}")
        try:
            load_services()
        except Exception as e:
            print(f"Error loading services: {e}")
        try:
            if not loaded_extensions:
                loaded_extensions = load_extensions()
                app.config['LOADED_EXTENSIONS'] = loaded_extensions
        except Exception as e:
            print(f"Error loading extensions: {e}")
        try:
            if not loaded_apps:
                loaded_apps = load_apps()
                app.config['LOADED_APPS'] = loaded_apps
        except Exception as e:
            print(f"Error loading apps: {e}")
        try:
            for manifest in app.config.get('LOADED_APPS', []):
                _register_worker_proxy_routes(manifest)
        except Exception as e:
            print(f"Error registering worker proxy routes: {e}")
        _initialized = True

@app.before_request
def _before_request_init():
    _ensure_initialized()
    start_background_tasks(app)


# @app.route('/api/create_directory', methods=['POST'])
# def create_directory():
#     """Creates a new directory at a given path."""
#     data = request.get_json()
#     if not data or 'path' not in data or 'name' not in data:
#         return jsonify({'error': 'Path and name are required.'}), 400
# 
#     base_path = os.path.expanduser(data['path'])
#     new_dir_name = data['name']
# 
#     # Basic security: ensure we are still within the home directory
#     if not os.path.abspath(base_path).startswith(os.path.expanduser('~')):
#         return jsonify({'error': 'Access denied'}), 403
#     
#     # Prevent invalid directory names
#     if '/' in new_dir_name or '..' in new_dir_name:
#         return jsonify({'error': 'Invalid directory name'}), 400
# 
#     try:
#         os.makedirs(os.path.join(base_path, new_dir_name), exist_ok=True)
#         return jsonify({'status': 'success'})
#     except Exception as e:
#         return jsonify({'error': str(e)}), 500


@app.route('/api/app/<app_id>/<path:subpath>', methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])
def proxy_app_request(app_id, subpath):
    try:
        app_info = ensure_app_running(app_id)
    except (ValueError, RuntimeError) as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    if not app_info or not app_info.get('port'):
        # This can happen if the app has no backend
        return jsonify({"ok": False, "error": "App has no backend or is not running."}), 404

    port = app_info['port']
    url = f"http://127.0.0.1:{port}/{subpath}"
    
    params = request.args.copy()
    
    headers = {key: value for key, value in request.headers if key.lower() != 'host'}

    try:
        resp = requests.request(
            method=request.method,
            url=url,
            headers=headers,
            params=params,
            data=request.get_data(),
            cookies=request.cookies,
            allow_redirects=False,
            stream=True,
            timeout=30
        )

        excluded_headers = ['content-encoding', 'content-length', 'transfer-encoding', 'connection']
        resp_headers = [(name, value) for name, value in resp.raw.headers.items() if name.lower() not in excluded_headers]

        resp_stream = Response(
            resp.iter_content(chunk_size=10 * 1024),
            resp.status_code,
            resp_headers,
        )
        resp_stream.headers["X-App-Worker-Port"] = str(port)
        return resp_stream
    except requests.exceptions.RequestException as e:
        return jsonify({"ok": False, "error": f"Failed to connect to app worker: {e}"}), 502


@sock.route('/ws/app/<app_id>/<path:subpath>')
def proxy_app_websocket(client_ws, app_id, subpath):
    """
    Generic WebSocket proxy for app workers.
    Forwards WebSocket connections from clients to the appropriate worker process.
    
    Convention: All worker WebSockets must use /ws/<route> pattern.
    Client connects to: /ws/app/<app_id>/<route>
    Proxied to worker: /ws/<route>
    """
    return _proxy_app_websocket(client_ws, app_id, subpath, raw=False)


def _proxy_app_websocket(client_ws, app_id, subpath, *, raw: bool):
    """
    Lower-level WebSocket proxy helper with optional raw path support.
    
    When raw=True the worker path is used as-is (no /ws/ prefix). This is needed
    for servers like NiceGUI that mount websocket handlers outside the /ws/*
    namespace.
    """
    try:
        app_info = ensure_app_running(app_id)
    except (ValueError, RuntimeError) as e:
        try:
            client_ws.close()
        except:
            pass
        return

    if not app_info or not app_info.get('port'):
        try:
            client_ws.close()
        except:
            pass
        return

    port = app_info['port']
    
    # Build worker WebSocket URL following /ws/<route> convention
    query_string = request.query_string.decode('utf-8')
    worker_path = subpath if raw else f"ws/{subpath}"
    worker_url = f"ws://127.0.0.1:{port}/{worker_path}"
    if query_string:
        worker_url += f"?{query_string}"

    # Pass along critical headers (cookies, auth) so the worker can resume sessions
    connect_headers = {}
    cookie_header = request.headers.get('Cookie')
    if cookie_header:
        connect_headers['Cookie'] = cookie_header
    origin_header = request.headers.get('Origin')
    if origin_header:
        connect_headers['Origin'] = origin_header

    # Connect to worker WebSocket
    worker_ws = None
    try:
        headers_arg = connect_headers or None
        worker_ws = WSClient.connect(worker_url, headers=headers_arg)
    except Exception as e:
        try:
            with open("/tmp/nice_code_cm6_ws_proxy.log", "a", encoding="utf-8") as fh:
                fh.write(f"connect failed app={app_id} url={worker_url} error={e}\\n")
        except Exception:
            pass
        try:
            client_ws.close()
        except:
            pass
        return

    # Bidirectional message forwarding
    def forward_client_to_worker():
        """Forward messages from client to worker"""
        try:
            while True:
                msg = client_ws.receive()
                if msg is None:
                    break
                worker_ws.send(msg)
        except ConnectionClosed:
            pass
        finally:
            try:
                worker_ws.close()
            except:
                pass

    def forward_worker_to_client():
        """Forward messages from worker to client"""
        try:
            while True:
                msg = worker_ws.receive()
                if msg is None:
                    break
                client_ws.send(msg)
        except ConnectionClosed:
            pass
        finally:
            try:
                client_ws.close()
            except:
                pass

    # Start bidirectional forwarding in threads
    import threading
    client_thread = threading.Thread(target=forward_client_to_worker, daemon=True)
    worker_thread = threading.Thread(target=forward_worker_to_client, daemon=True)
    
    client_thread.start()
    worker_thread.start()
    
    # Wait for both threads to complete
    client_thread.join()
    worker_thread.join()


if __name__ == '__main__':
    print("--- Loading Settings ---")
    _apply_settings_to_config()
    print("--- Loading Services ---")
    load_services()
    print("--- Loading Extensions ---")
    loaded_extensions = load_extensions()
    app.config['LOADED_EXTENSIONS'] = loaded_extensions
    print(f"Loaded {len(loaded_extensions)} extensions.")
    print("--- Loading Apps ---")
    loaded_apps = load_apps()
    app.config['LOADED_APPS'] = loaded_apps
    print("--- Registering worker proxy routes ---")
    for manifest in loaded_apps:
        _register_worker_proxy_routes(manifest)
    print(f"Loaded {len(loaded_apps)} apps.")
    print("--- Starting Server ---")
    # Production-like settings for the built-in server (still not recommended for production)
    app.run(host='0.0.0.0', port=8088, debug=False)
