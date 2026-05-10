#!/bin/env python
# /data/data/com.termux/files/home/mrselect/app/main.py
# main.py (project_root)
import asyncio
import sys
from pathlib import Path

# Add the vendor directory to the Python path to load our modified NiceGUI
vendor_dir = Path(__file__).parent / 'static' / 'vendor'
sys.path.insert(0, str(vendor_dir))

import importlib
import importlib.util
import json
import os
import re
import signal
import subprocess
import threading
import time
import traceback
import uuid
from typing import Any, Dict, Iterable, List, Optional

# Add project root to the Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from fastapi import FastAPI, Request, Query, Body, HTTPException, Header, Response
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from starlette.requests import ClientDisconnect
from app.libs.app_lifecycle import start_background_tasks, stop_background_tasks
from app.libs.app_manager import get_running_apps, initialize_running_apps

# Create FastAPI app instance with lifespan
from contextlib import asynccontextmanager, suppress

@asynccontextmanager
async def lifespan(_app_instance: FastAPI):
    """Startup/shutdown logic for FastAPI app."""
    async with te2_runtime_lifespan():
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
                "port": 8089,
            }
        )
        if registered:
            print(f"[framework] Registered with IPC (PID {framework_pid})")
        else:
            print(f"[framework] Warning: Failed to register with IPC", file=sys.stderr)

        # Enable SIGWINCH-on-resize for framework_shells by default.
        # This helps interactive shells (readline/TUIs) stay in sync with xterm's
        # computed cols/rows, especially for dtach-backed PTYs.
        os.environ.setdefault("FRAMEWORK_SHELLS_SIGWINCH_ON_RESIZE", "1")

        # Initialize framework_shells early with IPC lifecycle hooks so shell PIDs
        # are registered (and adoption re-registers as needed).
        try:
            from app.ipc.framework_shells_hooks import build_ipc_shell_hooks
            from app.ipc.fws_process_provider import IpcProcessProvider
            await get_manager(
                run_id=os.environ.get("TE_RUN_ID"),
                process_hooks=build_ipc_shell_hooks(),
                external_process_provider=IpcProcessProvider(),
            )
        except Exception as exc:
            print(f"[framework] Warning: Failed to init framework_shells IPC hooks: {exc}", file=sys.stderr)
        
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
        # App services are loaded in the main process via the apps extension loader.
        from app.extensions.apps import loader as apps_loader
        from app.extensions.apps.registry import ensure_user_local_layout
        ensure_user_local_layout()
        loaded_apps = apps_loader.load_apps_and_services(app)
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

        # Terminate all framework shells before exiting
        # This runs when framework receives SIGTERM from supervisor
        print("--- Stopping lifecycle background tasks ---")
        try:
            await stop_background_tasks()
        except Exception as e:
            print(f"  Error stopping lifecycle background tasks: {e}")

        print("--- Terminating framework shells ---")
        terminated_count = 0
        try:
            mgr = await get_manager()
            shells = await mgr.list_shells()
            for shell in shells:
                if shell.status != "running":
                    continue
                try:
                    await mgr.terminate_shell(shell.id, force=True)
                    terminated_count += 1
                    print(f"  Terminated: {shell.id} ({shell.label or 'unlabeled'})")
                except Exception as e:
                    print(f"  Failed to terminate {shell.id}: {e}")
            print(f"--- Terminated {terminated_count} framework shell(s) ---")
        except Exception as e:
            print(f"  Error during shell termination: {e}")
        
        print("--- Framework shutdown complete ---")


app: FastAPI = FastAPI(lifespan=lifespan)

# Mount static files
from fastapi.staticfiles import StaticFiles
static_dir = os.path.join(os.path.dirname(__file__), 'static')
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

from framework_shells import FrameworkShellManager, get_manager
from framework_shells.api.fastapi_router import router as framework_shells_router
from framework_shells.api.websocket import router as framework_shells_ws_router
from framework_shells.api.socketio_backend import mount_fws_dashboard_runtime
from app.te2_runtime_mounts import mount_te2_runtime_services, te2_runtime_lifespan

# Mount the framework shells API router
app.include_router(framework_shells_router)
app.include_router(framework_shells_ws_router)
mount_fws_dashboard_runtime(app)
mount_te2_runtime_services(app)



run_id_env = os.environ.get("TE_RUN_ID")
if not run_id_env:
    run_id_env = f"run_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
    os.environ["TE_RUN_ID"] = run_id_env
else:
    os.environ.setdefault("TE_RUN_ID", run_id_env)


APP_STARTED_AT = time.time()

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


def _runtime_loop_probe_payload(process_kind: str) -> dict[str, Any]:
    loop = asyncio.get_running_loop()
    loop_type = type(loop)
    return {
        "process_kind": process_kind,
        "pid": os.getpid(),
        "loop_module": loop_type.__module__,
        "loop_class": loop_type.__name__,
        "is_uvloop": loop_type.__module__.startswith("uvloop"),
    }


# Ensure importlib-based imports and spec-based module loads receive the current run id
# This allows extension/app modules to access TE_RUN_ID at import time (as a global)
try:
    _orig_module_from_spec = importlib.util.module_from_spec

    def _module_from_spec_with_runid(spec):
        mod = _orig_module_from_spec(spec)
        try:
            run_id = os.environ.get("TE_RUN_ID")
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
            run_id = os.environ.get("TE_RUN_ID")
        except Exception:
            run_id = None
        if run_id is not None:
            setattr(mod, 'TE_RUN_ID', run_id)
            mod.__dict__['TE_RUN_ID'] = run_id
        return mod

    importlib.import_module = _import_module_with_runid
except Exception:
    pass


def _load_settings() -> dict[str, Any]:
    try:
        if SETTINGS_FILE.is_file():
            with SETTINGS_FILE.open('r', encoding='utf-8') as fh:
                data = json.load(fh)
                if isinstance(data, dict):
                    return data
    except Exception as exc:
        print(f"Failed to load settings: {exc}")
    return {}


def _save_settings(payload: dict[str, Any]) -> dict[str, Any]:
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
        


def _load_state_store() -> dict[str, Any]:
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


def _save_state_store(store: dict[str, Any]) -> None:
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

def _resolve_symlink_target(full_path: str) -> tuple[str | None, bool | None, str | None]:
    try:
        raw_target = os.readlink(full_path)
    except Exception:
        return None, None, None

    if os.path.isabs(raw_target):
        target_path = os.path.abspath(raw_target)
    else:
        target_path = os.path.abspath(os.path.join(os.path.dirname(full_path), raw_target))

    target_exists = os.path.exists(target_path)
    if target_exists:
        if os.path.isdir(target_path):
            target_type = 'directory'
        elif os.path.isfile(target_path):
            target_type = 'file'
        elif os.path.islink(target_path):
            target_type = 'symlink'
        else:
            target_type = 'unknown'
    else:
        target_type = 'missing'

    return target_path, target_exists, target_type


def _scandir_entries(
    path: str,
    include_hidden: bool,
    resolve_symlinks: bool = False,
    display_path: str | None = None,
) -> list[dict[str, Any]]:
    scan_path = os.path.abspath(path)
    display_base = os.path.abspath(display_path or scan_path)
    entries: list[dict[str, Any]] = []
    with os.scandir(scan_path) as handle:
        for entry in handle:
            name = entry.name
            if not include_hidden and name.startswith('.'):
                continue
            full_scan_path = os.path.abspath(os.path.join(scan_path, name))
            full_display_path = os.path.abspath(os.path.join(display_base, name))
            entry_type = 'unknown'
            is_symlink = False
            symlink_target = None
            symlink_target_exists = None
            symlink_target_type = None
            try:
                if entry.is_symlink():
                    is_symlink = True
                    entry_type = 'symlink'
                    symlink_target, symlink_target_exists, symlink_target_type = _resolve_symlink_target(full_scan_path)
                    if resolve_symlinks and symlink_target_type in {'directory', 'file'}:
                        entry_type = symlink_target_type
                elif entry.is_dir(follow_symlinks=False):
                    entry_type = 'directory'
                else:
                    entry_type = 'file'
            except PermissionError:
                entry_type = 'unknown'
            entries.append({
                'name': name,
                'type': entry_type,
                'path': full_display_path,
                'is_symlink': is_symlink,
                'symlink_target': symlink_target,
                'symlink_target_exists': symlink_target_exists,
                'symlink_target_type': symlink_target_type,
            })
    entries.sort(key=lambda item: (item['type'] != 'directory', item['name'].lower()))
    return entries


def _scandir_with_sudo(
    path: str,
    include_hidden: bool,
    resolve_symlinks: bool = False,
    display_path: str | None = None,
) -> list[dict[str, Any]]:
    scan_path = os.path.abspath(path)
    display_base = os.path.abspath(display_path or scan_path)
    script = (
        'import json, os, sys\n'
        f"path = {json.dumps(scan_path)}\n"
        f"display_path = {json.dumps(display_base)}\n"
        f"include_hidden = { 'True' if include_hidden else 'False' }\n"
        f"resolve_symlinks = { 'True' if resolve_symlinks else 'False' }\n"
        'entries = []\n'
        'def resolve_target(full_path):\n'
        '    try:\n'
        '        raw_target = os.readlink(full_path)\n'
        '    except Exception:\n'
        '        return None, None, None\n'
        '    if os.path.isabs(raw_target):\n'
        '        target_path = os.path.abspath(raw_target)\n'
        '    else:\n'
        '        target_path = os.path.abspath(os.path.join(os.path.dirname(full_path), raw_target))\n'
        '    target_exists = os.path.exists(target_path)\n'
        '    if target_exists:\n'
        '        if os.path.isdir(target_path):\n'
        "            target_type = 'directory'\n"
        '        elif os.path.isfile(target_path):\n'
        "            target_type = 'file'\n"
        '        elif os.path.islink(target_path):\n'
        "            target_type = 'symlink'\n"
        '        else:\n'
        "            target_type = 'unknown'\n"
        '    else:\n'
        "        target_type = 'missing'\n"
        '    return target_path, target_exists, target_type\n'
        'try:\n'
        '    with os.scandir(path) as handle:\n'
        '        for entry in handle:\n'
        '            name = entry.name\n'
        '            if not include_hidden and name.startswith(\'.\'):\n'
        '                continue\n'
        '            full_scan_path = os.path.abspath(os.path.join(path, name))\n'
        '            full_display_path = os.path.abspath(os.path.join(display_path, name))\n'
        "            entry_type = 'unknown'\n"
        "            is_symlink = False\n"
        "            symlink_target = None\n"
        "            symlink_target_exists = None\n"
        "            symlink_target_type = None\n"
        '            try:\n'
        '                if entry.is_symlink():\n'
        "                    is_symlink = True\n"
        "                    entry_type = 'symlink'\n"
        '                    symlink_target, symlink_target_exists, symlink_target_type = resolve_target(full_scan_path)\n'
        "                    if resolve_symlinks and symlink_target_type in ('directory', 'file'):\n"
        '                        entry_type = symlink_target_type\n'
        '                elif entry.is_dir(follow_symlinks=False):\n'
        "                    entry_type = 'directory'\n"
        '                else:\n'
        "                    entry_type = 'file'\n"
        '            except PermissionError:\n'
        "                entry_type = 'unknown'\n"
        '            entries.append({'
        '"name": name, '
        '"type": entry_type, '
        '"path": full_display_path, '
        '"is_symlink": is_symlink, '
        '"symlink_target": symlink_target, '
        '"symlink_target_exists": symlink_target_exists, '
        '"symlink_target_type": symlink_target_type'
        '})\n'
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


def _resolve_browse_path(raw_path: str, root: str) -> tuple[str | None, str | None, str | None]:
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
        logical_path = os.path.abspath(expanded)
    except Exception as exc:
        return None, None, f'Invalid path: {exc}'

    if not allow_outside and not logical_path.startswith(home_dir):
        return None, None, 'Access denied'

    scan_path = logical_path
    return logical_path, scan_path, None


def _ipc_host() -> str:
    return os.environ.get("TE_IPC_HOST", "127.0.0.1")


def _ipc_port() -> int:
    raw = os.environ.get("TE_IPC_PORT", "9099")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 9099

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
            if spec is None or spec.loader is None:
                manifest['__load_error__'] = f"ImportError: failed to create module spec for {module_name}"
                continue
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
async def run_command_endpoint(payload: dict[str, Any] = Body(...)):
    """Executes a shell command and returns its stdout."""
    import subprocess
    if not payload or 'command' not in payload:
        raise HTTPException(status_code=400, detail='"command" field is required.')
    
    command = payload['command']
    
    try:
        result = await to_thread.run_sync(
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
    resolve_symlinks: bool = Query(False),
):
    try:
        logical_path, scan_path, err = _resolve_browse_path(path, root)
        if err:
            raise HTTPException(status_code=400, detail=err)
        if logical_path is None or scan_path is None:
            raise HTTPException(status_code=400, detail="Invalid path")
        
        if sudo:
            entries = _scandir_with_sudo(scan_path, hidden, resolve_symlinks, display_path=logical_path)
        else:
            entries = _scandir_entries(scan_path, hidden, resolve_symlinks, display_path=logical_path)
        
        return {
            "ok": True,
            "data": {
                "path": logical_path,
                "resolved_path": os.path.realpath(scan_path),
                "entries": entries,
            },
        }
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
async def post_settings(payload: dict[str, Any] = Body(...)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    try:
        saved = _save_settings(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {exc}")
    return {"ok": True, "data": saved}


@app.get("/api/android/config")
async def get_android_config():
    """
    Small, stable config surface for the Android wrappers (GeckoView/WebView).

    This intentionally avoids returning the entire settings.json to reduce coupling.
    """
    enabled = bool(get_setting("persistent_network_notification", False))
    return {"ok": True, "data": {"persistent_network_notification": enabled}}


@app.get("/api/editor_version")
async def get_editor_version():
    """Return the current editor static-asset version (plain text).

    The Android app's EditorAssetManager.checkServerVersion() polls this
    endpoint to decide whether to download a fresh asset bundle.
    """
    vfile = Path(__file__).parent / "apps" / "file_editor_cm6" / "static" / "version.txt"
    if not vfile.exists():
        raise HTTPException(status_code=404, detail="version.txt not found")
    return Response(content=vfile.read_text().strip(), media_type="text/plain")


# ── Asset bundle zip (Android OTA-style update) ─────────────────────
import zipfile
import tempfile

_asset_bundle_cache: Dict[str, str] = {}  # version -> zip path

def _get_editor_version_str() -> str:
    vfile = Path(__file__).parent / "apps" / "file_editor_cm6" / "static" / "version.txt"
    return vfile.read_text().strip() if vfile.exists() else "0"


def _build_asset_bundle_zip() -> str:
    """Build a zip of editor static assets, mirroring bundle_gecko_assets.sh.

    Returns the path to the cached zip file.  Re-uses a cached zip if the
    version hasn't changed.
    """
    version = _get_editor_version_str()
    if version in _asset_bundle_cache:
        cached = _asset_bundle_cache[version]
        if os.path.exists(cached):
            return cached

    app_dir = Path(__file__).parent
    tmp = tempfile.NamedTemporaryFile(
        prefix=f"editor_assets_{version}_", suffix=".zip", delete=False
    )
    tmp.close()

    EXCLUDE_EXT = {'.map', '.bak', '.bak2', '.pyc'}
    EXCLUDE_DIRS = {'__pycache__', 'node_modules'}

    def _should_include(p: Path) -> bool:
        if p.suffix in EXCLUDE_EXT:
            return False
        for part in p.parts:
            if part in EXCLUDE_DIRS:
                return False
        return True

    def _add_tree(zf: zipfile.ZipFile, src: Path, arc_prefix: str):
        if not src.is_dir():
            return
        for f in src.rglob("*"):
            if f.is_file() and _should_include(f):
                arcname = arc_prefix + "/" + str(f.relative_to(src))
                zf.write(str(f), arcname)

    def _add_file(zf: zipfile.ZipFile, src: Path, arcname: str):
        if src.is_file():
            zf.write(str(src), arcname)

    with zipfile.ZipFile(tmp.name, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 1. Shared statics
        _add_tree(zf, app_dir / "static" / "fonts", "static/fonts")
        _add_tree(zf, app_dir / "static" / "js", "static/js")
        for fname in ("icon.png", "move.png", "manifest.webmanifest", "bookmarks.json"):
            _add_file(zf, app_dir / "static" / fname, f"static/{fname}")

        # 2. Vendor libs
        for vdir in ("codicons", "seti-icons", "es-module-shims", "xterm", "ws"):
            _add_tree(zf, app_dir / "static" / "vendor" / vdir, f"static/vendor/{vdir}")
        _add_file(zf, app_dir / "static" / "vendor" / "socket.io.min.js",
                  "static/vendor/socket.io.min.js")

        # 3. Monaco te2-lang (no workers)
        te2lang = app_dir / "static" / "vendor" / "monaco-editor-core" / "te2-lang"
        for ext in ("js", "css"):
            bfile = te2lang / "bootstrap" / f"monaco.bootstrap.bundle.{ext}"
            _add_file(zf, bfile, f"static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.{ext}")
        # chunks
        if te2lang.is_dir():
            for f in te2lang.glob("chunk-*.js"):
                _add_file(zf, f, f"static/vendor/monaco-editor-core/te2-lang/{f.name}")
        _add_tree(zf, te2lang / "basic-languages",
                  "static/vendor/monaco-editor-core/te2-lang/basic-languages")
        _add_tree(zf, te2lang / "language",
                  "static/vendor/monaco-editor-core/te2-lang/language")

        # 4. Monaco ESM worker entrypoint. The main Monaco UI is in the
        # te2-lang bootstrap bundle; Android only needs this worker URL.
        monaco_worker = (
            app_dir
            / "static"
            / "vendor"
            / "monaco-editor-core"
            / "esm"
            / "vs"
            / "editor"
            / "common"
            / "services"
            / "editorWebWorkerMain.bundle.js"
        )
        _add_file(
            zf,
            monaco_worker,
            "static/vendor/monaco-editor-core/esm/vs/editor/common/services/"
            "editorWebWorkerMain.bundle.js",
        )

        # 5. file_editor_cm6 statics
        cm6_static = app_dir / "apps" / "file_editor_cm6" / "static"
        cm6_static_prefix = "apps/file_editor_cm6/static"
        _add_file(zf, cm6_static / "dist" / "host.js", f"{cm6_static_prefix}/dist/host.js")
        _add_file(
            zf,
            cm6_static / "dist" / "explorer.css",
            f"{cm6_static_prefix}/dist/explorer.css",
        )
        _add_file(zf, cm6_static / "version.txt", f"{cm6_static_prefix}/version.txt")
        _add_tree(zf, cm6_static / "icons", f"{cm6_static_prefix}/icons")
        _add_tree(
            zf,
            cm6_static / "vendor" / "monaco-touch-selection",
            f"{cm6_static_prefix}/vendor/monaco-touch-selection",
        )
        _add_file(
            zf,
            cm6_static / "vendor" / "vconsole" / "vconsole.min.js",
            f"{cm6_static_prefix}/vendor/vconsole/vconsole.min.js",
        )
        _add_tree(
            zf,
            app_dir / "apps" / "file_editor_cm6" / "vendor" / "android-terminalapp-assets-js",
            "apps/file_editor_cm6/vendor/android-terminalapp-assets-js",
        )

        # 6. TE2 editor libs
        cm6_monaco = app_dir / "apps" / "file_editor_cm6" / "monaco_editor"
        ui_prefix = "api/app/file_editor_cm6/ui/monaco_editor"
        # The current Android entrypoint is the built host bundle. inline_host.ts
        # imports the editor runtime into host.js, so there is no separate
        # m_editor_app.js publication path here.
        _add_tree(zf, cm6_monaco / "textmate", f"{ui_prefix}/textmate")
        _add_tree(zf, cm6_monaco / "themes", f"{ui_prefix}/themes")
        _add_file(
            zf,
            cm6_monaco / "vscode_build_src" / "out" / "breadcrumbsWidget.css",
            f"{ui_prefix}/vscode_build_src/out/breadcrumbsWidget.css",
        )
        # top-level files
        _add_file(
            zf,
            app_dir / "apps" / "file_editor_cm6" / "template.html",
            "apps/file_editor_cm6/template.html",
        )
        # editor_iframe.html → nc.html
        _add_file(zf, cm6_monaco / "editor_iframe.html",
                  "api/app/file_editor_cm6/ui/nc.html")

        # 7. HTML pages
        _add_file(zf, app_dir / "templates" / "index.html", "index.html")
        app_shell = app_dir / "templates" / "app_shell.html"
        if app_shell.is_file():
            content = app_shell.read_text()
            content = content.replace("{{ app_id|tojson }}", '"file_editor_cm6"')
            content = content.replace(
                "{{ url_for('static', filename='js/ws_port.js') }}",
                "/static/js/ws_port.js")
            zf.writestr("app_shell_file_editor_cm6.html", content)

        # Version file
        zf.writestr("version.txt", version)

    # Update cache (clear old entries)
    for old_ver, old_path in list(_asset_bundle_cache.items()):
        try:
            os.unlink(old_path)
        except OSError:
            pass
    _asset_bundle_cache.clear()
    _asset_bundle_cache[version] = tmp.name
    return tmp.name


@app.get("/api/editor_assets_bundle")
async def get_editor_assets_bundle():
    """Serve the editor static assets as a zip bundle.

    The Android app downloads this when its local version differs from
    the server's.  The zip mirrors the directory structure expected by
    filesDir/editor_static/.
    """
    from anyio import to_thread
    zip_path = await to_thread.run_sync(_build_asset_bundle_zip)
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=500, detail="Bundle generation failed")
    version = _get_editor_version_str()
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"editor_assets_{version}.zip"
    )


@app.get("/api/state")
async def get_state(key: List[str] = Query(...)):
    """Get state values for one or more keys. Use ?key=x&key=y for multiple."""
    if not key:
        raise HTTPException(status_code=400, detail="query parameter \"key\" is required")
    store = _load_state_store()
    data = {k: store.get(k) for k in key}
    return {"ok": True, "data": data}

@app.post("/api/state")
async def post_state(payload: dict[str, Any] = Body(...)):
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


@app.get("/api/internal/runtime/loop")
async def get_internal_runtime_loop(
    token: Optional[str] = Header(default=None, alias="X-Framework-Key"),
):
    _verify_internal_token(token)
    return {"ok": True, "data": _runtime_loop_probe_payload("framework")}


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
    # Read the asset version so the SW cache name auto-bumps on asset changes
    vfile = Path(__file__).parent / "apps" / "file_editor_cm6" / "static" / "version.txt"
    version = vfile.read_text().strip() if vfile.exists() else "0"
    sw_path = os.path.join(project_root, 'app', 'static', 'js', 'sw.js')
    with open(sw_path, 'r') as f:
        content = f.read().replace('__ASSET_VERSION__', version)
    return Response(content=content, media_type='application/javascript')


# --- Lazy initialization compatible with Flask 3.x (before_first_request removed) ---
_initialized = False
_init_lock: Any = None
try:
    _init_lock = threading.Lock()
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
    lock = _init_lock
    if lock is None:
        return
    with lock:
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
                from app.extensions.apps import loader as apps_loader
                loaded_apps = apps_loader.load_apps_and_services(app)
                from app.libs import app_manager
                app_manager._LOADED_APPS = loaded_apps

        except Exception as e:
            print(f"Error loading apps: {e}")
        _initialized = True







import httpx
from anyio import to_thread

@app.api_route('/api/app/{app_id}/{subpath:path}', methods=['GET','POST','PUT','DELETE','PATCH','OPTIONS'])
async def proxy_app_request(app_id: str, subpath: str, request: Request):
    # Fast lookup - don't spawn workers on every request
    # Apps must be started via POST /api/apps/{app_id}/start first
    running_apps = await get_running_apps()

    # Minimal CORS passthrough for agent iframe → host HTTP bridge (iframe at 12359).
    origin = request.headers.get("origin")
    if (
        origin in {"http://127.0.0.1:12359", "http://localhost:12359"}
        and app_id == "file_editor_cm6"
        and (subpath == "agent/cwd" or subpath.startswith("agent/"))
    ):
        cors_headers = {
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
        }
        if request.method == "OPTIONS":
            cors_headers.update({
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Access-Control-Max-Age": "600",
            })
            return Response(status_code=204, headers=cors_headers)
    else:
        cors_headers = {}
    
    if app_id not in running_apps:
        return JSONResponse({
            "ok": False, 
            "error": f"App '{app_id}' is not running. Start it from the launcher first."
        }, status_code=503, headers=cors_headers)  # Service Unavailable
    
    port = running_apps[app_id]['port']
    url = f"http://127.0.0.1:{port}/{subpath}"
    
    # Forward headers minus 'host'
    headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
    try:
        body = await request.body()
    except ClientDisconnect:
        return Response(status_code=499)

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
    if cors_headers:
        # Ensure a single Access-Control-Allow-Origin header (avoid duplicates).
        resp_headers.pop("access-control-allow-origin", None)
        resp_headers.pop("Access-Control-Allow-Origin", None)
        resp_headers.update(cors_headers)

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
@app.websocket('/ws/app/{app_id}/{route:path}')
async def proxy_app_websocket(websocket: WebSocket, app_id: str, route: str):
    await websocket.accept()
    print(f"[AppProxy][WebSocket] Client connected app={app_id} route={route}")
    
    # Fast lookup - apps must be started via launcher first
    running_apps = await get_running_apps()
    
    if app_id not in running_apps:
        with suppress(WebSocketDisconnect, RuntimeError):
            await websocket.send_json({
                "type": "error",
                "message": f"App '{app_id}' is not running. Start it from the launcher first."
            })
        with suppress(Exception):
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
                        if isinstance(msg, (bytes, bytearray)):
                            await websocket.send_bytes(bytes(msg))
                        else:
                            await websocket.send_text(msg)
                except websockets.ConnectionClosedOK:
                    print(f"[AppProxy][WebSocket] Worker closed connection app={app_id}")
                except WebSocketDisconnect:
                    print(f"[AppProxy][WebSocket] Client disconnected while forwarding worker output app={app_id}")
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

if __name__ == '__main__':
    # Use the app instance from the imported module to ensure consistency
    # with extensions that import 'app.main'.
    # This prevents "split-brain" where __main__.app runs but extensions
    # attach to/read from app.main.app.
    from app import main as app_main_module
    fastapi_app = app_main_module.app

    import argparse
    import uvicorn
    from ipaddress import ip_address, ip_network, AddressValueError
    
    parser = argparse.ArgumentParser(description='Termux Extensions Framework')
    parser.add_argument('--broadcast', nargs='+', metavar='IP_SUBNET_OR_IFACE',
                        help='Enable broadcasting. Requires args: "all", IPs, subnets, or interfaces')
    parser.add_argument('--list-interfaces', action='store_true', help='Show network interfaces and exit')
    parser.add_argument('--port', type=int, default=int(os.environ.get('TE_PORT', '8089')),
                        help='Bind port (default: 8089)')
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
    use_middleware = False  # Default to False (for localhost/adapter modes)
    host_ip = '127.0.0.1'   # Default to localhost

    # Always allow localhost
    allowlist.add(ip_address('127.0.0.1'))
    allowlist.add(ip_address('::1'))
    
    if args.broadcast is not None:
        host_ip = '0.0.0.0'  # Broadcast implies listening on all interfaces (covering localhost + adapter)
        
        if 'all' in args.broadcast:
            # --broadcast all = allow everything, no middleware
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
                        use_middleware = True # Specific filter requested
                        print(f"[main] Allowing subnet: {network}")
                    except (AddressValueError, ValueError) as e:
                        print(f"[main] Invalid subnet {item}: {e}", file=sys.stderr)
                        continue
                
                # Check if it's an IP address
                elif re.match(r'^\d+\.\d+\.\d+\.\d+$', item):
                    try:
                        ip = ip_address(item)
                        allowlist.add(ip)
                        use_middleware = True # Specific filter requested
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
                    
                    # Interface found - we are in "Adapter Broadcast" mode.
                    # We rely on 0.0.0.0 binding and skip middleware for performance,
                    # effectively trusting the network on that interface.
                    print(f"[main] Broadcast on interface {item} ({ip_str}) - Middleware Skipped")
                    
                    if not mask_str:
                        # Fallback calculation just in case we need it later
                        allowlist.add(ip_address(ip_str))
                        continue
                        
                    try:
                        mask_parts = [int(x) for x in mask_str.split('.')]
                        cidr = sum([bin(x).count('1') for x in mask_parts])
                        if cidr == 32:
                             print(f"[main] Interface {item} is /32 (likely VPN)")
                             continue
                        subnet = ip_network(f"{ip_str}/{cidr}", strict=False)
                        allowlist.add(subnet)
                    except Exception as e:
                        print(f"[main] Failed to calculate subnet for {item}: {e}", file=sys.stderr)
                
                else:
                    print(f"[main] Warning: '{item}' is not a valid IP, subnet, or interface name.", file=sys.stderr)
    else:
        # No --broadcast flag = localhost only
        print("[main] Localhost only (secure default)")
    
    # Add IP filtering middleware ONLY if enabled
    if use_middleware and not allow_all:
        @app.middleware("http")
        async def ip_filter_middleware(request: Request, call_next):
            client = request.client
            if client is None:
                return JSONResponse(
                    status_code=403,
                    content={"ok": False, "error": "Missing client information"}
                )
            client_ip = client.host
            
            # Check if IP is allowed
            try:
                client_addr = ip_address(client_ip)
                allowed = False
                
                # print(f"[main] Checking IP: {client_ip}") 
                
                for allowed_item in allowlist:
                    if isinstance(allowed_item, type(client_addr)):
                        # Direct IP match
                        if client_addr == allowed_item:
                            allowed = True
                            break
                    else:
                        # Network/subnet match
                        try:
                            if client_addr in allowed_item:
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
    
    print(f"--- Starting ASGI Server on {host_ip}:{args.port} ---")
    if use_middleware:
        print(f"[main] IP filtering enabled ({len(allowlist) - 2} filters + localhost)")
    else:
        print(f"[main] IP filtering DISABLED (Performance Mode)")
    
    uvicorn.run(
        fastapi_app,
        host=host_ip,
        port=args.port,
        timeout_graceful_shutdown=2,
    )
