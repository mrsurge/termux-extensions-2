#!/bin/env python
# /data/data/com.termux/files/home/mrselect/app/main.py
# main.py (project_root)
import sys
from pathlib import Path

# Add the vendor directory to the Python path to load our modified NiceGUI
vendor_dir = Path(__file__).parent / 'static' / 'vendor'
sys.path.insert(0, str(vendor_dir))

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
from typing import Any, Dict, Iterable, List, Optional

# Add project root to the Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from fastapi import FastAPI, Request, Query, Body, HTTPException, Header
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
import requests
from app.libs.app_lifecycle import start_background_tasks
from app.libs.app_manager import ensure_app_running, get_running_apps, initialize_running_apps

# Create FastAPI app instance with lifespan
from contextlib import asynccontextmanager, suppress

@asynccontextmanager
async def lifespan(app_instance):
    """Startup/shutdown logic for FastAPI app."""
    
    # Register framework with IPC
    from app.ipc.client import register_process
    framework_pid = os.getpid()
    registered = register_process(
        pid=framework_pid,
        type="framework",
        label="main-framework",
        parent_pid=os.getppid(),
        metadata={
            "run_id": os.environ.get("TE_RUN_ID"),
            "port": 8088,
        }
    )
    if registered:
        print(f"[framework] Registered with IPC (PID {framework_pid})")
    else:
        print(f"[framework] Warning: Failed to register with IPC", file=sys.stderr)
    
    # Startup
    print("--- Loading Settings ---")
    _apply_settings_to_config()
    print("--- Loading Services ---")
    load_services()
    print("--- Loading Extensions ---")
    global _loaded_extensions, loaded_apps
    _loaded_extensions = load_extensions()
    print(f"Loaded {len(_loaded_extensions)} extensions.")
    print("--- Loading Apps ---")
    loaded_apps = load_apps()
    # Store in app_manager module so ensure_app_running can access it
    from app.libs import app_manager
    app_manager._LOADED_APPS = loaded_apps
    print(f"Loaded {len(loaded_apps)} apps.")
    print("--- Restoring Running Apps ---")
    await initialize_running_apps()
    print("--- Starting Framework Shell Log Monitor ---")
    global _log_monitor_thread
    _log_monitor_thread = _start_framework_shell_log_monitor()
    print("--- Starting Lifecycle Background Tasks ---")
    start_background_tasks()

    yield

    # Note: Don't unregister here - IPC server is busy in shutdown_all() and can't process the request
    # IPC will clean the registry after killing all processes
    print("--- Shutting down: IPC will handle process termination ---")


app = FastAPI(lifespan=lifespan)

# Mount static files
from fastapi.staticfiles import StaticFiles
import os
static_dir = os.path.join(os.path.dirname(__file__), 'static')
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

from app.libs.framework_shells import FrameworkShellManager, get_manager
from app.apps.file_editor_cm6.agent_bridge import get_bridge # This has to go... ASAP



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
_loaded_extensions = []
loaded_extensions = []  # Keep for backwards compatibility
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
    """Scans for services in app/libs and imports them to register job handlers and routers."""
    libs_dir = os.path.join(os.path.dirname(__file__), 'libs')
    if not os.path.exists(libs_dir):
        return

    for filename in os.listdir(libs_dir):
        if filename.endswith('.py') and not filename.startswith('__'):
            module_name = f"app.libs.{filename.replace('.py', '')}"
            try:
                module = importlib.import_module(module_name)
                print(f"Loaded service: {module_name}")
                
                # Auto-register routers
                from fastapi import APIRouter
                for attr_name in dir(module):
                    if attr_name.startswith('_'): continue
                    attr = getattr(module, attr_name)
                    if isinstance(attr, APIRouter):
                        app.include_router(attr)
                        print(f"  - Registered router: {attr_name}")
                            
            except Exception as e:
                print(f"Error loading service {module_name}: {e}")


# --- Extension Loader ---

def load_extensions():
    """Scans for extensions, loads their blueprints, and returns their manifests."""
    print("[LOAD] Starting extension loading...")
    extensions = []
    extensions_dir = os.path.join(os.path.dirname(__file__), 'extensions')
    if not os.path.exists(extensions_dir):
        print(f"[LOAD] Extensions directory not found: {extensions_dir}")
        return []

    for ext_name in os.listdir(extensions_dir):
        ext_path = os.path.join(extensions_dir, ext_name)
        manifest_path = os.path.join(ext_path, 'manifest.json')
        
        if not os.path.isdir(ext_path) or not os.path.exists(manifest_path):
            continue

        print(f"[LOAD] Loading extension: {ext_name}")
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
            manifest['_ext_dir'] = ext_name
            extensions.append(manifest)

        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
        if backend_file:
            print(f"[LOAD]   - Found backend_blueprint: {backend_file}")
            module_name = f"app.extensions.{ext_name}.{backend_file.replace('.py', '')}"
            spec = importlib.util.spec_from_file_location(module_name, os.path.join(ext_path, backend_file))
            try:
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)  # may raise anything
            except BaseException as e:
                print(f"[LOAD ERROR] Failed to load extension '{ext_name}': {type(e).__name__}: {e}")
                manifest['__load_error__'] = f"{type(e).__name__}: {e}"
                manifest['__load_trace__'] = traceback.format_exc()[-2048:]
            else:
                from fastapi import APIRouter
                try:
                    for obj_name in dir(module):
                        obj = getattr(module, obj_name)
                        if isinstance(obj, APIRouter):
                            if ext_name == 'apps':
                                app.include_router(obj)  # No prefix for apps
                                print(f"[LOAD] Registered APIRouter from extension: {ext_name} (no prefix)")
                            else:
                                app.include_router(obj, prefix=f"/api/ext/{ext_name}")
                                print(f"[LOAD] Registered APIRouter from extension: {ext_name} -> /api/ext/{ext_name}")
                            break
                    else:
                        manifest['__load_warning__'] = 'No APIRouter found in backend module'
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


@app.get('/extensions/{ext_dir}/{filename:path}')
async def serve_extension_file(ext_dir: str, filename: str):
    """Serve static files for extensions."""
    ext_path = os.path.join(os.path.dirname(__file__), 'extensions', ext_dir, filename)
    if not os.path.exists(ext_path):
        raise HTTPException(status_code=404, detail="Extension file not found")
    return FileResponse(ext_path)


@app.get('/api/extensions')
async def get_extensions():
    """Return list of loaded extensions."""
    return {"ok": True, "data": _loaded_extensions}


@app.post('/api/run_command')
async def run_command_endpoint(payload: dict = Body(...)):
    """Executes a shell command and returns its stdout."""
    import subprocess
    if not payload or 'command' not in payload:
        raise HTTPException(status_code=400, detail='"command" field is required.')
    
    command = payload['command']
    
    try:
        result = await anyio.to_thread.run_sync(
            lambda: subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                check=True
            )
        )
        return {"ok": True, "data": {"stdout": result.stdout}}
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail={'ok': False, 'error': 'Command failed', 'stderr': e.stderr})
    except Exception as e:
        raise HTTPException(status_code=500, detail={'ok': False, 'error': str(e)})


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
async def get_state(key: List[str] = Query(...)):
    """Get state values for one or more keys. Use ?key=x&key=y for multiple."""
    if not key:
        raise HTTPException(status_code=400, detail="query parameter \"key\" is required")
    store = _load_state_store()
    data = {k: store.get(k) for k in key}
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


@app.get("/api/framework/ipc")
async def get_ipc_config():
    return {"ok": True, "data": {"host": _ipc_host(), "port": _ipc_port()}}


def _verify_internal_token(token: Optional[str]) -> None:
    expected = os.getenv("TE_FRAMEWORK_SHELL_TOKEN")
    if expected and token != expected:
        raise HTTPException(status_code=403, detail="Forbidden: invalid framework token")


@app.get("/api/internal/shells/{shell_id}")
async def get_internal_shell(
    shell_id: str,
    token: Optional[str] = Header(default=None, alias="X-Framework-Key"),
):
    _verify_internal_token(token)
    manager = await get_manager()
    shell = await manager.get_shell(shell_id)
    if not shell:
        raise HTTPException(status_code=404, detail="Shell not found")
    return await manager.describe(shell)


@app.get("/api/internal/shells/find")
async def find_internal_shell(
    label: str = Query(...),
    status: Optional[str] = Query("running"),
    token: Optional[str] = Header(default=None, alias="X-Framework-Key"),
):
    _verify_internal_token(token)
    manager = await get_manager()
    shell = await manager.find_shell_by_label(label, status=status)
    if not shell:
        return None
    return await manager.describe(shell)


@app.post("/api/internal/shells/spawn")
async def spawn_internal_shell(
    payload: Dict[str, Any] = Body(...),
    token: Optional[str] = Header(default=None, alias="X-Framework-Key"),
):
    _verify_internal_token(token)
    command = payload.get("command")
    if not isinstance(command, list):
        raise HTTPException(status_code=400, detail="command must be a list of strings")
    manager = await get_manager()
    record = await manager.spawn_shell_pty(
        command,
        cwd=payload.get("cwd"),
        env=payload.get("env"),
        label=payload.get("label"),
        autostart=payload.get("autostart", True),
    )
    return await manager.describe(record)


@app.post("/api/internal/shells/{shell_id}/write")
async def write_internal_shell(
    shell_id: str,
    payload: Dict[str, Any] = Body(...),
    token: Optional[str] = Header(default=None, alias="X-Framework-Key"),
):
    _verify_internal_token(token)
    message = payload.get("message")
    if message is None:
        raise HTTPException(status_code=400, detail="message is required")
    manager = await get_manager()
    await manager.write_to_pty(shell_id, message)
    return {"ok": True}


@app.get("/api/internal/shells/{shell_id}/stream")
async def stream_internal_shell(
    shell_id: str,
    token: Optional[str] = Header(default=None, alias="X-Framework-Key"),
):
    _verify_internal_token(token)
    manager = await get_manager()
    queue = await manager.subscribe_output(shell_id)

    async def event_stream():
        try:
            while True:
                chunk = await queue.get()
                payload = json.dumps({"chunk": chunk})
                yield f"data: {payload}\n\n"
        finally:
            await manager.unsubscribe_output(shell_id, queue)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/framework/runtime/shutdown")
async def shutdown_framework(request: Request):
    expected_token = os.getenv("TE_FRAMEWORK_SHELL_TOKEN")
    provided_token = request.headers.get("x-framework-key")
    if expected_token and provided_token != expected_token:
        return JSONResponse(
            {"ok": False, "error": "Forbidden: invalid framework token"},
            status_code=403,
        )

    supervisor_pid = os.environ.get("TE_SUPERVISOR_PID")
    if not supervisor_pid:
        return JSONResponse(
            {"ok": False, "error": "Supervisor PID unavailable; shutdown not supported"},
            status_code=503,
        )

    try:
        os.kill(int(supervisor_pid), signal.SIGTERM)
    except Exception as exc:
        return JSONResponse(
            {"ok": False, "error": f"Failed to signal supervisor: {exc}"},
            status_code=500,
        )

    return JSONResponse(
        {"ok": True, "data": {"message": "Shutdown signal sent to supervisor"}},
        status_code=202,
    )


async def _terminate_framework_shells(manager: FrameworkShellManager) -> None:
    records = await manager.list_shells()
    for record in list(records):
        try:
            await manager.remove_shell(record.id, force=True)
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
    # Fast lookup - don't spawn workers on every request
    # Apps must be started via POST /api/apps/{app_id}/start first
    running_apps = await get_running_apps()
    
    if app_id not in running_apps:
        return JSONResponse({
            "ok": False, 
            "error": f"App '{app_id}' is not running. Start it from the launcher first."
        }, status_code=503)  # Service Unavailable
    
    port = running_apps[app_id]['port']
    url = f"http://127.0.0.1:{port}/{subpath}"
    
    # Forward headers minus 'host'
    headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
    body = await request.body()
    
    client = httpx.AsyncClient(timeout=30.0)
    try:
        upstream_request = client.build_request(
            method=request.method,
            url=url,
            params=request.query_params,
            headers=headers,
            content=body,
        )
        resp = await client.send(upstream_request, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        print(f"[AppProxy] Failed to reach app '{app_id}' at {url}: {exc}")
        return JSONResponse(
            {
                "ok": False,
                "error": f"App '{app_id}' worker is not reachable yet. Please retry shortly."
            },
            status_code=502,
        )
    
    # Strip hop-by-hop headers
    excluded = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}
    resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}

    async def _iter_body():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(
        _iter_body(),
        status_code=resp.status_code,
        headers=resp_headers,
    )

from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState
import websockets
import asyncio


def _ipc_host() -> str:
    return os.getenv("TE_IPC_HOST", "127.0.0.1")


def _ipc_port() -> int:
    return int(os.getenv("TE_IPC_PORT", "9123"))


def _format_host_for_ws(host: str) -> str:
    return host if ":" not in host else f"[{host}]"

@app.websocket('/ws/app/{app_id}/{route:path}')
async def proxy_app_websocket(websocket: WebSocket, app_id: str, route: str):
    await websocket.accept()
    print(f"[AppProxy][WebSocket] Client connected app={app_id} route={route}")
    
    # Fast lookup - apps must be started via launcher first
    running_apps = await get_running_apps()
    
    if app_id not in running_apps:
        await websocket.send_json({
            "type": "error",
            "message": f"App '{app_id}' is not running. Start it from the launcher first."
        })
        await websocket.close()
        return
    
    port = running_apps[app_id]['port']
    query = websocket.scope['query_string'].decode('utf-8')
    worker_url = f"ws://127.0.0.1:{port}/ws/{route}"
    if query:
        worker_url += f"?{query}"
    
    try:
        async with websockets.connect(worker_url) as worker_ws:
            print(f"[AppProxy][WebSocket] Connected to worker {worker_url}")

            async def forward_client_to_worker():
                try:
                    async for msg in websocket.iter_text():
                        await worker_ws.send(msg)
                except WebSocketDisconnect:
                    print(f"[AppProxy][WebSocket] Client disconnected app={app_id}")
                except Exception as exc:
                    print(f"[AppProxy][WebSocket] Error forwarding client->worker for {app_id}: {exc}")

            async def forward_worker_to_client():
                try:
                    async for msg in worker_ws:
                        await websocket.send_text(msg)
                except websockets.ConnectionClosedOK:
                    print(f"[AppProxy][WebSocket] Worker closed connection app={app_id}")
                except Exception as exc:
                    print(f"[AppProxy][WebSocket] Error forwarding worker->client for {app_id}: {exc}")

            tasks = [
                asyncio.create_task(forward_client_to_worker(), name=f"ws-client-to-worker-{app_id}"),
                asyncio.create_task(forward_worker_to_client(), name=f"ws-worker-to-client-{app_id}"),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            print(f"[AppProxy][WebSocket] Bridge closed for app={app_id}")
    except Exception as exc:
        print(f"[AppProxy][WebSocket] Failed to proxy app={app_id}: {exc}")
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()


@app.websocket('/ws/ipc/{target_path:path}')
async def proxy_ipc_websocket(websocket: WebSocket, target_path: str):
    await websocket.accept()
    host = _ipc_host()
    port = _ipc_port()
    host_fmt = _format_host_for_ws(host)
    query = websocket.scope.get("query_string", b"").decode("utf-8")
    ipc_url = f"ws://{host_fmt}:{port}/{target_path}"
    if query:
        ipc_url += f"?{query}"
    print(f"[IPCProxy][WebSocket] Bridging to {ipc_url}")

    try:
        async with websockets.connect(ipc_url) as ipc_ws:

            async def forward_client_to_ipc():
                try:
                    async for msg in websocket.iter_text():
                        await ipc_ws.send(msg)
                except WebSocketDisconnect:
                    print("[IPCProxy][WebSocket] Client disconnected")
                except Exception as exc:
                    print(f"[IPCProxy][WebSocket] Error client->ipc: {exc}")

            async def forward_ipc_to_client():
                try:
                    async for msg in ipc_ws:
                        await websocket.send_text(msg)
                except websockets.ConnectionClosedOK:
                    print("[IPCProxy][WebSocket] IPC closed connection")
                except Exception as exc:
                    print(f"[IPCProxy][WebSocket] Error ipc->client: {exc}")

            tasks = [
                asyncio.create_task(forward_client_to_ipc(), name="ws-client-to-ipc"),
                asyncio.create_task(forward_ipc_to_client(), name="ws-ipc-to-client"),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
    except Exception as exc:
        print(f"[IPCProxy][WebSocket] Failed to bridge: {exc}")
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()


# === NiceGUI Dynamic Shims ===
# Forward NiceGUI static assets and Socket.IO from top-level paths to the correct worker
# Detects app_id from Referer header (e.g., /api/app/<app_id>/ui/nc)

import re

_APP_IN_UI = re.compile(r"/api/app/([^/]+)/ui/")

def _extract_app_id_from_referer(headers) -> str | None:
    """Extract app_id from Referer header matching /api/app/<app_id>/ui/..."""
    try:
        ref = headers.get("referer")
    except AttributeError:
        raw = dict(headers)
        ref = raw.get(b"referer") or raw.get("referer")
        if isinstance(ref, bytes):
            ref = ref.decode()
    if not ref:
        return None
    m = _APP_IN_UI.search(ref)
    return m.group(1) if m else None


@app.api_route("/ui/_nicegui/{rest:path}", methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"])
async def _nicegui_assets_dynamic(request: Request, rest: str):
    """Forward NiceGUI HTTP assets to the correct worker based on Referer"""
    app_id = _extract_app_id_from_referer(request.headers) or request.query_params.get("app_id")
    
    if not app_id:
        # ESM module imports often lack Referer - default to file_editor_cm6 for now
        # TODO: Make this more generic if multiple apps use NiceGUI
        app_id = "file_editor_cm6" # AND THIS
        print(f"[NiceGUI Assets] No Referer, defaulting to {app_id}", file=sys.stderr)
    
    running_apps = await get_running_apps()
    
    if app_id not in running_apps:
        return JSONResponse({"error": f"{app_id} not running"}, status_code=503)
    
    port = running_apps[app_id]["port"]
    url = f"http://127.0.0.1:{port}/ui/_nicegui/{rest}"
    
    headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
    body = await request.body()
    
    client = httpx.AsyncClient(timeout=30.0)
    try:
        upstream_request = client.build_request(
            method=request.method,
            url=url,
            params=request.query_params,
            headers=headers,
            content=body,
        )
        resp = await client.send(upstream_request, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        return JSONResponse({"error": str(exc)}, status_code=502)
    
    async def iter_response():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await client.aclose()
    
    return StreamingResponse(
        iter_response(),
        status_code=resp.status_code,
        headers=dict(resp.headers),
        media_type=resp.headers.get("content-type")
    )


# Engine.IO polling (HTTP) for NiceGUI's Socket.IO endpoint
# Some Socket.IO clients initiate with HTTP long-polling before WebSocket upgrade.
# Proxy those HTTP requests to the correct worker (mirrors _nicegui_assets_dynamic).
@app.api_route("/ui/_nicegui_ws/socket.io/{rest:path}", methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"])
async def _nicegui_engineio_http(request: Request, rest: str):
    app_id = _extract_app_id_from_referer(request.headers) or request.query_params.get("app_id")

    if not app_id:
        # Default to the editor app if Referer is missing (ESM/imports often lack referer)
        app_id = "file_editor_cm6"
        print(f"[NiceGUI Engine.IO HTTP] No Referer/app_id, defaulting to {app_id}", file=sys.stderr)

    running_apps = await get_running_apps()
    if app_id not in running_apps:
        return JSONResponse({"error": f"{app_id} not running"}, status_code=503)

    port = running_apps[app_id]["port"]
    # Build worker URL without adding a trailing slash when rest is empty
    rest_path = f"/{rest}" if rest else ""
    url = f"http://127.0.0.1:{port}/ui/_nicegui_ws/socket.io{rest_path}"

    headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
    body = await request.body()

    client = httpx.AsyncClient(timeout=30.0)
    try:
        upstream_request = client.build_request(
            method=request.method,
            url=url,
            params=request.query_params,
            headers=headers,
            content=body,
        )
        resp = await client.send(upstream_request, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        return JSONResponse({"error": str(exc)}, status_code=502)

    async def iter_response():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        finally:
            await client.aclose()

    return StreamingResponse(
        iter_response(),
        status_code=resp.status_code,
        headers=dict(resp.headers),
        media_type=resp.headers.get("content-type"),
    )


@app.websocket("/ui/_nicegui_ws/socket.io/{rest:path}")
async def _nicegui_ws_dynamic(websocket: WebSocket, rest: str):
    """Forward NiceGUI Socket.IO to the correct worker based on Referer"""
    await websocket.accept()
    
    app_id = _extract_app_id_from_referer(websocket.headers) or websocket.query_params.get("app_id")
    # Option B: default to file_editor_cm6 when not provided (WS often lacks Referer)
    if not app_id:
        app_id = "file_editor_cm6"
        print(f"[NiceGUI WS] No Referer/app_id; defaulting to {app_id}")
    
    running_apps = await get_running_apps()
    
    if app_id not in running_apps:
        await websocket.send_json({"error": f"{app_id} not running"})
        await websocket.close()
        return
    
    port = running_apps[app_id]["port"]
    query = websocket.scope['query_string'].decode('utf-8')
    rest_path = f"/{rest}" if rest else ""
    worker_url = f"ws://127.0.0.1:{port}/ui/_nicegui_ws/socket.io{rest_path}"
    if query:
        worker_url += f"?{query}"

    # Preserve critical handshake context for Engine.IO/NiceGUI
    client_headers = websocket.headers
    origin_hdr = client_headers.get("origin")
    cookie_hdr = client_headers.get("cookie")
    ua_hdr = client_headers.get("user-agent")
    xff_hdr = client_headers.get("x-forwarded-for")
    xfp_hdr = client_headers.get("x-forwarded-proto")
    xfh_hdr = client_headers.get("x-forwarded-host")
    sec_ws_proto = client_headers.get("sec-websocket-protocol")
    subprotocols = None
    if sec_ws_proto:
        # comma-separated list
        subprotocols = [p.strip() for p in sec_ws_proto.split(',') if p.strip()]
    extra_headers = []
    if cookie_hdr:
        extra_headers.append(("Cookie", cookie_hdr))
    if ua_hdr:
        extra_headers.append(("User-Agent", ua_hdr))
    # Forward X-Forwarded-* if present (harmless for localhost)
    if xff_hdr:
        extra_headers.append(("X-Forwarded-For", xff_hdr))
    if xfp_hdr:
        extra_headers.append(("X-Forwarded-Proto", xfp_hdr))
    if xfh_hdr:
        extra_headers.append(("X-Forwarded-Host", xfh_hdr))
    
    try:
        # Some environments use older websockets versions which don't support extra_headers/subprotocols
        # Start with a minimal, widely-supported set of arguments.
        async with websockets.connect(
            worker_url,
            origin=origin_hdr,
        ) as worker_ws:
            async def forward_client_to_worker():
                try:
                    if hasattr(websocket, "receive"):
                        # Starlette >=0.27: low-level receive available
                        while True:
                            packet = await websocket.receive()
                            if packet.get("type") == "websocket.disconnect":
                                break
                            if packet.get("text") is not None:
                                await worker_ws.send(packet["text"])
                            elif packet.get("bytes") is not None:
                                await worker_ws.send(packet["bytes"])
                    else:
                        # Fallback: text-only iteration
                        async for msg in websocket.iter_text():
                            await worker_ws.send(msg)
                except WebSocketDisconnect:
                    pass
                except Exception as exc:
                    print(f"[NiceGUI WS] Error client->worker: {exc}")

            async def forward_worker_to_client():
                try:
                    async for msg in worker_ws:
                        if isinstance(msg, (bytes, bytearray)):
                            await websocket.send_bytes(msg)
                        else:
                            await websocket.send_text(msg)
                except websockets.ConnectionClosedOK:
                    pass
                except Exception as exc:
                    print(f"[NiceGUI WS] Error worker->client: {exc}")

            tasks = [
                asyncio.create_task(forward_client_to_worker()),
                asyncio.create_task(forward_worker_to_client()),
            ]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
    except Exception as exc:
        print(f"[NiceGUI WS] Failed to proxy: {exc}")
    finally:
        if websocket.application_state != WebSocketState.DISCONNECTED:
            with suppress(Exception):
                await websocket.close()



if __name__ == '__main__':
    # Use the app instance from the imported module to ensure consistency
    # with extensions that import 'app.main'.
    # This prevents "split-brain" where __main__.app runs but extensions
    # attach to/read from app.main.app.
    import app.main
    app = app.main.app

    import argparse
    import uvicorn
    import subprocess
    import re
    from ipaddress import ip_address, ip_network, AddressValueError
    
    parser = argparse.ArgumentParser(description='Termux Extensions Framework')
    parser.add_argument('--broadcast', nargs='+', metavar='IP_SUBNET_OR_IFACE',
                        help='Enable broadcasting. Requires args: "all", IPs, subnets, or interfaces')
    parser.add_argument('--list-interfaces', action='store_true', help='Show network interfaces and exit')
    args = parser.parse_args()
    
    # Handle --list-interfaces
    if args.list_interfaces:
        try:
            result = subprocess.run(['ifconfig'], capture_output=True, text=True)
            print(result.stdout)
            sys.exit(0)
        except Exception as e:
            print(f"Error running ifconfig: {e}", file=sys.stderr)
            sys.exit(1)
    
    # Build IP allowlist
    allowlist = set()
    allow_all = False
    
    # Always allow localhost
    allowlist.add(ip_address('127.0.0.1'))
    allowlist.add(ip_address('::1'))
    
    if args.broadcast is not None:
        if 'all' in args.broadcast:
            # --broadcast all = allow everything
            allow_all = True
            print("[main] WARNING: Broadcasting to all IPs (no filtering)")
        else:
            # Pre-fetch interface data (running ifconfig once)
            interfaces_data = {}
            try:
                ifconfig_proc = subprocess.run(['ifconfig'], capture_output=True, text=True)
                if ifconfig_proc.returncode == 0:
                    current_iface = None
                    for line in ifconfig_proc.stdout.splitlines():
                        line = line.rstrip()
                        # Match interface start "wlan0: ..."
                        m_start = re.match(r'^([a-zA-Z0-9_\-]+):', line)
                        if m_start:
                            current_iface = m_start.group(1)
                            interfaces_data[current_iface] = {}
                            continue
                        
                        if current_iface:
                            # Parse inet and netmask
                            m_ip = re.search(r'inet\s+(\d+\.\d+\.\d+\.\d+)', line)
                            m_mask = re.search(r'netmask\s+(\d+\.\d+\.\d+\.\d+)', line)
                            if m_ip:
                                interfaces_data[current_iface]['ip'] = m_ip.group(1)
                            if m_mask:
                                interfaces_data[current_iface]['netmask'] = m_mask.group(1)
            except Exception as e:
                print(f"[main] Failed to parse ifconfig: {e}", file=sys.stderr)

            # Process each filter
            for item in args.broadcast:
                item = item.strip()
                
                # Check if it's a CIDR subnet
                if '/' in item:
                    try:
                        network = ip_network(item, strict=False)
                        allowlist.add(network)
                        print(f"[main] Allowing subnet: {network}")
                    except (AddressValueError, ValueError) as e:
                        print(f"[main] Invalid subnet {item}: {e}", file=sys.stderr)
                        continue
                
                # Check if it's an IP address
                elif re.match(r'^\d+\.\d+\.\d+\.\d+$', item):
                    try:
                        ip = ip_address(item)
                        allowlist.add(ip)
                        print(f"[main] Allowing IP: {ip}")
                    except AddressValueError as e:
                        print(f"[main] Invalid IP {item}: {e}", file=sys.stderr)
                        continue
                
                # Check if it's an interface
                elif item in interfaces_data:
                    data = interfaces_data[item]
                    if 'ip' not in data:
                         print(f"[main] Interface {item} found but has no IP address")
                         continue
                    
                    ip_str = data['ip']
                    mask_str = data.get('netmask')
                    
                    if not mask_str:
                        print(f"[main] Interface {item} has no netmask, adding IP only: {ip_str}")
                        allowlist.add(ip_address(ip_str))
                        continue
                        
                    try:
                        mask_parts = [int(x) for x in mask_str.split('.')]
                        cidr = sum([bin(x).count('1') for x in mask_parts])
                        
                        if cidr == 32:
                             print(f"[main] Interface {item} is /32 (likely VPN), skipping subnet allowlist. (Use 'all' or specific IPs if needed)")
                             continue
                             
                        subnet = ip_network(f"{ip_str}/{cidr}", strict=False)
                        allowlist.add(subnet)
                        print(f"[main] Allowing subnet from {item}: {subnet}")
                    except Exception as e:
                        print(f"[main] Failed to calculate subnet for {item}: {e}", file=sys.stderr)
                
                else:
                    print(f"[main] Warning: '{item}' is not a valid IP, subnet, or interface name.", file=sys.stderr)
    else:
        # No --broadcast flag = localhost only
        print("[main] Localhost only (secure default)")
    
    # Add IP filtering middleware
    if not allow_all:
        @app.middleware("http")
        async def ip_filter_middleware(request: Request, call_next):
            client_ip = request.client.host
            
            # Check if IP is allowed
            try:
                client_addr = ip_address(client_ip)
                allowed = False
                
                print(f"[main] Checking IP: {client_ip} (parsed as {client_addr})")
                
                for allowed_item in allowlist:
                    if isinstance(allowed_item, type(client_addr)):
                        # Direct IP match
                        if client_addr == allowed_item:
                            print(f"[main] ✓ IP {client_ip} matched allowed IP {allowed_item}")
                            allowed = True
                            break
                    else:
                        # Network/subnet match
                        try:
                            if client_addr in allowed_item:
                                print(f"[main] ✓ IP {client_ip} matched subnet {allowed_item}")
                                allowed = True
                                break
                        except Exception as subnet_err:
                            print(f"[main] Subnet check failed for {allowed_item}: {subnet_err}", file=sys.stderr)
                
                if not allowed:
                    print(f"[main] ✗ BLOCKED connection from {client_ip} - not in allowlist")
                    return JSONResponse(
                        status_code=403,
                        content={"ok": False, "error": "Access denied"}
                    )
                
                # IP is allowed, proceed
                return await call_next(request)
            
            except Exception as e:
                print(f"[main] ✗ IP filter error for {client_ip}: {e}", file=sys.stderr)
                traceback.print_exc()
                # On error, block the request (fail secure)
                return JSONResponse(
                    status_code=403,
                    content={"ok": False, "error": "IP validation error"}
                )
    
    print(f"--- Starting ASGI Server on 0.0.0.0:8088 ---")
    if not allow_all and len(allowlist) > 2:  # More than just localhost
        print(f"[main] IP filtering enabled ({len(allowlist) - 2} filters + localhost)")
    
    uvicorn.run(
        app,
        host='0.0.0.0',
        port=8088,
    )
