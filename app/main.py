#!/bin/env python
# main.py (project_root)
import errno
import importlib
import importlib.util
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Dict, Iterable, List, Optional

# Add project root to the Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from fastapi import FastAPI, Request, Query, Body, HTTPException
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
import requests
from app.libs.app_lifecycle import start_background_tasks
from app.libs.app_manager import ensure_app_running
from app.libs.bookmarks import bookmarks_bp

# Create FastAPI app instance
app = FastAPI()

# Mount static files
from fastapi.staticfiles import StaticFiles
import os
static_dir = os.path.join(os.path.dirname(__file__), 'static')
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

app.include_router(bookmarks_bp, prefix="/api")
from app.libs.framework_shells import FrameworkShellManager, get_manager, framework_shells_bp

app.include_router(framework_shells_bp)
from app.libs.jobs import jobs_bp
app.include_router(jobs_bp, prefix="/api")



RUN_ID = os.environ.get("TE_RUN_ID")
if not RUN_ID:
    RUN_ID = f"run_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    os.environ["TE_RUN_ID"] = RUN_ID
else:
    os.environ.setdefault("TE_RUN_ID", RUN_ID)


APP_STARTED_AT = time.time()

try:  # Optional dependency for richer process metrics
    import psutil  # type: ignore
except Exception:  # pragma: no cover - psutil may be unavailable.
    psutil = None  # type: ignore

# Pre-initialize to avoid NameError if imported differently
loaded_extensions = []
loaded_apps = []

SETTINGS_FILE = Path(os.path.expanduser('~/.cache/termux_extensions/settings.json'))
STATE_STORE_FILE = Path(os.path.expanduser('~/.cache/termux_extensions/state_store.json'))
STATE_STORE_LOCK = threading.RLock()
FRAMEWORK_LOG_ROOT = Path(os.path.expanduser("~/.cache/te_framework/logs"))
LOG_MONITOR_ENABLED = os.getenv("TE_MONITOR_FRAMEWORK_LOGS", "1").lower() not in {"0", "false", "no"}
LOG_MONITOR_POLL_SECONDS = float(os.getenv("TE_MONITOR_FRAMEWORK_LOGS_INTERVAL", "1.0"))
LOG_MONITOR_REPLAY = os.getenv("TE_MONITOR_FRAMEWORK_LOGS_REPLAY", "0").lower() in {"1", "true", "yes"}
_log_monitor_thread: Optional["FrameworkShellLogMonitor"] = None


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


def get_setting(key: str, default=None):
    """
    Get a setting value from disk-persisted settings.
    This allows components to read settings without accessing app.config.
    
    Args:
        key: Setting key to retrieve
        default: Default value if key not found
        
    Returns:
        Setting value or default
    """
    settings = _load_settings()
    return settings.get(key, default)


def _apply_settings_to_config():
    """Legacy function - settings now read directly via get_setting()."""
    pass
        


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


class FrameworkShellLogMonitor(threading.Thread):
    """Background tailer that scans framework shell logs for Python stack traces."""

    TRACEBACK_HEADER = re.compile(r"Traceback \(most recent call last\):")

    def __init__(
        self,
        base_dir: Path,
        poll_interval: float = 1.0,
        replay_existing: bool = False,
    ) -> None:
        super().__init__(name="FrameworkShellLogMonitor", daemon=True)
        self.base_dir = base_dir
        self.poll_interval = max(0.25, poll_interval)
        self.replay_existing = replay_existing
        self._stop_event = threading.Event()
        self._positions: Dict[Path, int] = {}
        self._capturing: Dict[Path, bool] = {}
        self._buffers: Dict[Path, List[str]] = {}

    # ----------------------------------------------------------------- control
    def stop(self) -> None:
        self._stop_event.set()

    # ----------------------------------------------------------------- helpers
    def _iter_log_files(self) -> Iterable[Path]:
        if not self.base_dir.is_dir():
            return []
        log_paths: List[Path] = []
        for fs_dir in self.base_dir.glob("fs-*"):
            if not fs_dir.is_dir():
                continue
            for log_path in fs_dir.rglob("*.log"):
                if log_path.is_file():
                    log_paths.append(log_path)
        for fs_dir in self.base_dir.glob("fs_*"):
            if not fs_dir.is_dir():
                continue
            for log_path in fs_dir.rglob("*.log"):
                if log_path.is_file():
                    log_paths.append(log_path)
        return log_paths

    def _init_file_state(self, path: Path) -> None:
        if path in self._positions:
            return
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return
        self._positions[path] = 0 if self.replay_existing else size
        self._capturing[path] = False
        self._buffers[path] = []

    def _cleanup_file_state(self, path: Path) -> None:
        self._positions.pop(path, None)
        self._capturing.pop(path, None)
        self._buffers.pop(path, None)

    def _flush_traceback(self, path: Path) -> None:
        buffer = self._buffers.get(path)
        if not buffer:
            return
        print(f"[FrameworkLogMonitor] Stack trace detected in {path}:")
        for line in buffer:
            print(line)
        print("-" * 60)
        self._buffers[path] = []
        self._capturing[path] = False

    def _handle_line(self, path: Path, line: str) -> None:
        capturing = self._capturing.get(path, False)
        if not capturing and self.TRACEBACK_HEADER.search(line):
            capturing = True
            self._capturing[path] = True
            self._buffers[path] = [line]
            return
        if capturing:
            self._buffers.setdefault(path, []).append(line)
            # Python stack traces end with a non-indented line (exception message) followed by blank line or other text.
            is_blank = not line.strip()
            looks_like_exception = bool(line and not line.startswith((" ", "\t")))
            if is_blank or looks_like_exception:
                self._flush_traceback(path)

    def _process_file(self, path: Path) -> None:
        self._init_file_state(path)
        if path not in self._positions:
            return
        try:
            with path.open("r", encoding="utf-8", errors="replace") as fh:
                fh.seek(self._positions[path])
                for raw_line in fh:
                    line = raw_line.rstrip("\n")
                    self._handle_line(path, line)
                self._positions[path] = fh.tell()
        except FileNotFoundError:
            self._cleanup_file_state(path)
        except Exception as exc:
            print(f"[FrameworkLogMonitor] Error tailing {path}: {exc}")

    # ----------------------------------------------------------------- thread
    def run(self) -> None:
        if not self.base_dir.exists():
            print(f"[FrameworkLogMonitor] Base directory {self.base_dir} does not exist; waiting for creation.")
        while not self._stop_event.is_set():
            for log_path in self._iter_log_files():
                self._process_file(log_path)
            self._stop_event.wait(self.poll_interval)


def _start_framework_shell_log_monitor() -> Optional[FrameworkShellLogMonitor]:
    if not LOG_MONITOR_ENABLED:
        return None
    monitor = FrameworkShellLogMonitor(
        FRAMEWORK_LOG_ROOT,
        poll_interval=LOG_MONITOR_POLL_SECONDS,
        replay_existing=LOG_MONITOR_REPLAY,
    )
    monitor.start()
    print(f"[FrameworkLogMonitor] Watching framework shell logs under {FRAMEWORK_LOG_ROOT} (poll={LOG_MONITOR_POLL_SECONDS}s, replay={LOG_MONITOR_REPLAY})")
    return monitor

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
                from fastapi import APIRouter
                try:
                    for obj_name in dir(module):
                        obj = getattr(module, obj_name)
                        if isinstance(obj, (Blueprint, APIRouter)):
                            if ext_name == 'apps':
                                app.include_router(obj, url_prefix='')
                            else:
                                app.include_router(obj, prefix=f"/api/ext/{ext_name}")
                            break
                    else:
                        manifest['__load_warning__'] = 'No Flask Blueprint found in backend module'
                except BaseException as e:
                    manifest['__load_error__'] = f"Blueprint registration failed: {type(e).__name__}: {e}"
                    manifest['__load_trace__'] = traceback.format_exc()[-2048:]
    return extensions

# --- Main Application Routes ---


@app.get("/")
async def root():
    return FileResponse(os.path.join(project_root, 'app', 'templates', 'index.html'))

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


@app.get('/api/extensions')
async def get_extensions():
    """Return list of loaded extensions."""
    # Access the global variable set during startup
    import app.main
    exts = getattr(app.main, '_loaded_extensions', [])
    return {"ok": True, "data": exts}


@app.get("/api/browse")
async def browse(
    path: str = Query(None),
    root: str = Query("home"),
    sudo: bool = Query(False),
    hidden: bool = Query(False),
):
    try:
        resolved, err = _resolve_browse_path(path, root)
        if err:
            raise HTTPException(status_code=400, detail=err)
        
        if sudo:
            entries = _scandir_with_sudo(resolved, hidden)
        else:
            entries = _scandir_entries(resolved, hidden)
        
        return {"ok": True, "data": {"path": resolved, "entries": entries}}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Directory not found")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/settings")
async def get_settings():
    data = _load_settings()
    return {"ok": True, "data": data}

@app.post("/api/settings")
async def post_settings(payload: dict = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    try:
        saved = _save_settings(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {exc}")
    return {"ok": True, "data": saved}



@app.get("/api/state")
async def get_state(keys: List[str] = Query(...)):
    if not keys:
        raise HTTPException(status_code=400, detail="query parameter \"key\" is required")
    store = _load_state_store()
    data = {key: store.get(key) for key in keys}
    return {"ok": True, "data": data}

@app.post("/api/state")
async def post_state(payload: dict = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    key = payload.get('key')
    if not isinstance(key, str) or not key.strip():
        raise HTTPException(status_code=400, detail="\"key\" must be a non-empty string")
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
        raise HTTPException(status_code=500, detail=f"Failed to persist state: {exc}")
    return {"ok": True, "data": store.get(key)}

@app.delete("/api/state")
async def delete_state(keys: List[str] = Query(...)):
    if not keys:
        raise HTTPException(status_code=400, detail="query parameter \"key\" is required")
    store = _load_state_store()
    removed = 0
    for key in keys:
        if key in store:
            removed += 1
            store.pop(key, None)
    try:
        _save_state_store(store)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to persist state: {exc}")
    return {"ok": True, "data": {"removed": removed}}

def _terminate_framework_shells(manager: FrameworkShellManager) -> None:
    for record in list(manager.list_shells()):
        try:
            manager.remove_shell(record.id, force=True)
        except Exception as exc:
            print(f"Failed to remove shell {record.id}: {exc}")









# --- PWA: Service Worker ---
@app.get("/sw.js")
async def sw():
    return FileResponse(os.path.join(project_root, 'app', 'static', 'js', 'sw.js'), media_type='application/javascript')


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

        except Exception as e:
            print(f"Error loading extensions: {e}")
        try:
            if not loaded_apps:
                loaded_apps = load_apps()

        except Exception as e:
            print(f"Error loading apps: {e}")
        _initialized = True







import httpx
import anyio

@app.api_route('/api/app/{app_id}/{subpath:path}', methods=['GET','POST','PUT','DELETE','PATCH','OPTIONS'])
async def proxy_app_request(app_id: str, subpath: str, request: Request):
    # Call ensure_app_running (sync, wrap in anyio)
    app_info = await anyio.to_thread.run_sync(ensure_app_running, app_id)
    if not app_info or not app_info.get('port'):
        return JSONResponse({"ok": False, "error": "App has no backend or is not running."}, status_code=404)
    
    port = app_info['port']
    url = f"http://127.0.0.1:{port}/{subpath}"
    
    # Forward headers minus 'host'
    headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
    body = await request.body()
    
    async with httpx.AsyncClient() as client:
        resp = await client.request(
            method=request.method,
            url=url,
            params=request.query_params,
            headers=headers,
            content=body,
            timeout=30.0,
        )
    
    # Strip hop-by-hop headers
    excluded = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}
    resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    
    return StreamingResponse(
        resp.iter_bytes(chunk_size=10240),
        status_code=resp.status_code,
        headers=resp_headers,
    )

from starlette.websockets import WebSocket, WebSocketDisconnect
import websockets
import asyncio

@app.websocket('/ws/app/{app_id}/{route:path}')
async def proxy_app_websocket(websocket: WebSocket, app_id: str, route: str):
    await websocket.accept()
    
    # Call ensure_app_running (sync)
    app_info = await anyio.to_thread.run_sync(ensure_app_running, app_id)
    if not app_info or not app_info.get('port'):
        await websocket.close()
        return
    
    port = app_info['port']
    query = websocket.scope['query_string'].decode('utf-8')
    worker_url = f"ws://127.0.0.1:{port}/ws/{route}"
    if query:
        worker_url += f"?{query}"
    
    try:
        async with websockets.connect(worker_url) as worker_ws:
            async def forward_client_to_worker():
                try:
                    async for msg in websocket.iter_text():
                        await worker_ws.send(msg)
                except WebSocketDisconnect:
                    pass
            
            async def forward_worker_to_client():
                try:
                    async for msg in worker_ws:
                        await websocket.send_text(msg)
                except:
                    pass
            
            await asyncio.gather(
                forward_client_to_worker(),
                forward_worker_to_client(),
                return_exceptions=True,
            )
    except Exception:
        await websocket.close()



if __name__ == '__main__':
    import uvicorn
    import app.main
    print("--- Loading Settings ---")
    _apply_settings_to_config()
    print("--- Loading Services ---")
    load_services()
    print("--- Loading Extensions ---")
    # Store in module-level variable so /api/extensions can access it
    app.main._loaded_extensions = load_extensions()
    print(f"Loaded {len(app.main._loaded_extensions)} extensions.")
    print("--- Loading Apps ---")
    loaded_apps = load_apps()
    print(f"Loaded {len(loaded_apps)} apps.")
    print("--- Starting Framework Shell Log Monitor ---")
    _log_monitor_thread = _start_framework_shell_log_monitor()
    print("--- Starting ASGI Server ---")
    uvicorn.run("app.main:app", host='0.0.0.0', port=8088)
