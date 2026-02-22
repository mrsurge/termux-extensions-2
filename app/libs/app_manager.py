import os
import sys
import json
import socket
import subprocess
import asyncio
import time
import contextlib
from pathlib import Path
from typing import Optional
from framework_shells import get_manager as get_framework_shell_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.shellspec import parse_shellspec_data, parse_shellspec_ref
from app.libs import app_lifecycle

# Module-level storage for running apps (replaces Flask's current_app.config)
_RUNNING_APPS = {}
_LOADED_APPS = []

# Persistent storage file for app workers (only valid while framework is running)
_RUNNING_APPS_FILE = Path.home() / '.cache' / 'te_framework' / 'running_apps.json'


def _parse_port(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _resolve_app_worker_shellspec_ref(app_manifest: dict, app_dir: Path) -> tuple[Optional[str], Optional[dict]]:
    shellspec_cfg = app_manifest.get("shellspec")
    if isinstance(shellspec_cfg, dict):
        ref = shellspec_cfg.get("app_worker") or shellspec_cfg.get("worker")
        if isinstance(ref, str) and ref.strip():
            return ref.strip(), None
        if isinstance(ref, dict):
            return None, ref

    default_path = app_dir / "shellspec" / "app_worker.yaml"
    if default_path.exists():
        return "shellspec/app_worker.yaml#app-worker", None

    return None, None


async def _register_running_app(app_id: str, shell_id: str, port: int, *, nicegui: bool = False) -> None:
    """Track a running app worker and register it with the lifecycle service."""
    _RUNNING_APPS[app_id] = {"port": port, "shell_id": shell_id}
    if nicegui:
        _RUNNING_APPS[app_id]["nicegui_shell"] = True
    await app_lifecycle.register_app(app_id, shell_id, port)


async def _adopt_running_shells(manager) -> int:
    """Discover running app-worker shells without saved entries."""
    adopted = 0
    shells = await manager.list_shells()
    for record in shells:
        label = record.label or ""
        if not label.startswith("app-worker:"):
            continue
        app_id = label.split(":", 1)[1]
        if not app_id or app_id in _RUNNING_APPS:
            continue
        if record.status != "running" or not record.pid:
            continue
        port = _parse_port(record.env_overrides.get("TE_APP_WORKER_PORT"))
        if port is None:
            print(f"[AppManager] Cannot adopt {record.id}: missing TE_APP_WORKER_PORT")
            continue
        await _register_running_app(app_id, record.id, port)
        adopted += 1
        print(f"[AppManager] Adopted running worker: app_id={app_id}, shell_id={record.id}, port={port}")
    return adopted


async def _load_running_apps():
    """
    Restore app workers that survived a browser refresh or framework restart.
    """
    global _RUNNING_APPS
    _RUNNING_APPS_FILE.parent.mkdir(parents=True, exist_ok=True)
    manager = await get_framework_shell_manager()

    restored = 0
    if _RUNNING_APPS_FILE.exists():
        try:
            with open(_RUNNING_APPS_FILE, 'r') as f:
                saved_apps = json.load(f)
        except Exception as e:
            print(f"[AppManager] Failed to load running apps: {e}")
            saved_apps = {}

        for app_id, app_info in saved_apps.items():
            shell = await manager.get_shell(app_info.get('shell_id'))
            if shell and shell.status == 'running':
                port = _parse_port(app_info.get('port'))
                if port is None:
                    print(f"[AppManager] Saved worker missing valid port; skipping app_id={app_id}")
                    continue
                await _register_running_app(
                    app_id,
                    app_info.get('shell_id'),
                    port,
                    nicegui=app_info.get("nicegui_shell", False),
                )
                restored += 1
                print(f"[AppManager] Restored worker: app_id={app_id}, shell_id={app_info.get('shell_id')}, port={port}")
            else:
                print(f"[AppManager] Discarded stale worker: app_id={app_id} (shell not running)")

        if restored == 0 and saved_apps:
            print("[AppManager] All saved workers dead; clearing saved state")
            with contextlib.suppress(Exception):
                _RUNNING_APPS_FILE.unlink()

    adopted = await _adopt_running_shells(manager)

    if restored or adopted:
        _save_running_apps()
    else:
        print("[AppManager] No running app workers detected during startup")

async def initialize_running_apps():
    """Async initializer to load running apps within an event loop."""
    await _load_running_apps()


def _save_running_apps():
    """Save app workers to disk."""
    _RUNNING_APPS_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        with open(_RUNNING_APPS_FILE, 'w') as f:
            json.dump(_RUNNING_APPS, f, indent=2)
        print(f"[AppManager] Saved {len(_RUNNING_APPS)} running apps to disk")
    except Exception as e:
        print(f"[AppManager] Failed to save running apps: {e}")

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

async def _wait_for_port(port: int, *, host: str = "127.0.0.1", timeout: float = 10.0, interval: float = 0.2) -> bool:
    """
    Wait for a TCP port to become reachable.
    Returns True if the connection succeeds within the timeout, otherwise False.
    """
    print(f"[AppManager] Waiting for port {port} on {host} (timeout {timeout}s)")
    deadline = time.time() + timeout
    start = time.time()
    while time.time() < deadline:
        try:
            reader, writer = await asyncio.open_connection(host, port)
        except (OSError, ConnectionError):
            await asyncio.sleep(interval)
            continue
        else:
            writer.close()
            with contextlib.suppress(Exception):
                await writer.wait_closed()
            elapsed = time.time() - start
            print(f"[AppManager] Port {port} became reachable after {elapsed:.2f}s")
            return True
    print(f"[AppManager] Port {port} did not become reachable within {timeout}s")
    return False

async def ensure_app_running(app_id):
    """
    Ensures an app's backend is running. If not, it spawns it.
    Returns the app's info (port, shell_id) or raises an exception.
    """
    global _RUNNING_APPS
    
    print(f"[AppManager] ensure_app_running called for: {app_id}")
    print(f"[AppManager] Current _RUNNING_APPS keys: {list(_RUNNING_APPS.keys())}")
    
    if app_id in _RUNNING_APPS:
        # App is already running, verify the shell is alive
        app_info = _RUNNING_APPS[app_id]
        print(f"[AppManager] Found in _RUNNING_APPS: shell_id={app_info.get('shell_id')}, port={app_info.get('port')}")
        cached_port = _parse_port(app_info.get('port'))
        if cached_port and await _wait_for_port(cached_port, host="127.0.0.1", timeout=0.75, interval=0.15):
            print(f"[AppManager] Cached worker port is reachable, returning existing app_info")
            await app_lifecycle.register_app(app_id, app_info.get('shell_id'), app_info.get('port'))
            return app_info

        manager = await get_framework_shell_manager()
        try:
            shell = await asyncio.wait_for(manager.get_shell(app_info.get('shell_id')), timeout=1.5)
        except asyncio.TimeoutError:
            print(f"[AppManager] Timed out while checking shell {app_info.get('shell_id')}; treating as stale")
            shell = None
        if shell:
            print(f"[AppManager] Shell found with status: {shell.status}")
        else:
            print(f"[AppManager] Shell NOT FOUND in manager!")
        
        if shell and shell.status == 'running':
            print(f"[AppManager] Worker still running, returning existing app_info")
            # Ensure lifecycle tracking knows about this worker
            await app_lifecycle.register_app(app_id, app_info.get('shell_id'), app_info.get('port'))
            return app_info
        # Shell is not running, remove it from the list and restart
        print(f"[AppManager] Shell dead or missing, removing from cache and restarting")
        _RUNNING_APPS.pop(app_id, None)
        try:
            await app_lifecycle.unregister_app(app_info.get('shell_id'))
        except Exception:
            pass

    # Find the app's manifest
    app_manifest = None
    for app_data in _LOADED_APPS:
        if app_data.get('id') == app_id:
            app_manifest = app_data
            break
    
    if not app_manifest:
        raise ValueError(f"App '{app_id}' not found")

    entrypoints = app_manifest.get('entrypoints', {})
    nicegui_module = entrypoints.get('nicegui_module')
    nicegui_shell = entrypoints.get('nicegui_shell', False)
    backend_module = entrypoints.get('backend_blueprint')
    framework_shell_ui = app_manifest.get('framework_shell_ui')
    if not isinstance(framework_shell_ui, dict):
        framework_shell_ui = None

    # Go up 3 levels: app/libs/app_manager.py -> app/libs -> app -> project_root
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env = {
        "PYTHONPATH": f"{os.environ.get('PYTHONPATH', '')}:{project_root}",
        "TE_APP_ID": app_id,
    }
    if os.environ.get("TE_FRAMEWORK_URL"):
        env["TE_FRAMEWORK_URL"] = os.environ.get("TE_FRAMEWORK_URL")

    if nicegui_module and nicegui_shell:
        port = find_free_port()
        env["TE_APP_WORKER_PORT"] = str(port)
        shell_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'nicegui_shell', 'worker.py')
        module_name = f"app.apps.{app_manifest['_dir']}.{Path(nicegui_module).stem}"
        command = [
            "python",
            shell_path,
            "--app-id",
            app_id,
            "--module",
            module_name,
            "--host",
            os.environ.get("TE_NICEGUI_HOST", "0.0.0.0"),
            "--port",
            str(port),
        ]

        manager = await get_framework_shell_manager()
        shell = await manager.spawn_shell(command, label=f"asgi-app:{app_id}", cwd=project_root, env=env, ui=framework_shell_ui)

        await asyncio.sleep(1.5)
        updated_shell = await manager.get_shell(shell.id)

        if not updated_shell or updated_shell.status != 'running':
            error_log_path = Path(shell.stderr_log)
            error_output = ""
            if error_log_path.exists():
                error_output = error_log_path.read_text().strip()

            try:
                await manager.remove_shell(shell.id)
            except Exception:
                pass

            raise RuntimeError(f"App worker failed to start: {error_output}")

        listen_host = os.environ.get("TE_NICEGUI_HOST", "0.0.0.0") or "0.0.0.0"
        wait_host = "127.0.0.1" if listen_host in ("0.0.0.0", "::") else listen_host
        if not await _wait_for_port(port, host=wait_host):
            try:
                await manager.remove_shell(shell.id, force=True)
            except Exception:
                pass
            raise RuntimeError(f"App worker started but port {port} did not become reachable")

        app_info = {"port": port, "shell_id": shell.id, "nicegui_shell": True}
        _RUNNING_APPS[app_id] = app_info
        _save_running_apps()  # Persist to disk
        await app_lifecycle.register_app(app_id, shell.id, port)
        return app_info

    if not backend_module:
        # No backend, nothing to start
        return {"message": "No backend to start"}

    manager = await get_framework_shell_manager()
    orch = Orchestrator(manager)

    backend_module_path = os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "apps", app_manifest["_dir"], backend_module)
    )
    app_dir = Path(backend_module_path).resolve().parent

    shellspec_ref, shellspec_inline = _resolve_app_worker_shellspec_ref(app_manifest, app_dir)
    if not shellspec_ref and not shellspec_inline:
        raise RuntimeError(
            f"App '{app_id}' is missing shellspec for app worker (expected manifest.shellspec.app_worker or {app_dir}/shellspec/app_worker.yaml)"
        )

    ctx = {
        "APP_ID": app_id,
        "PROJECT_ROOT": project_root,
        "BACKEND_MODULE_PATH": backend_module_path,
    }

    if shellspec_ref:
        _ref_path, spec_shell_id = parse_shellspec_ref(shellspec_ref)
        if not spec_shell_id:
            raise RuntimeError(f"shellspec ref '{shellspec_ref}' must include '#<id>' for app workers")
        record_spec_id = f"app:{app_id}:{spec_shell_id}"
        shell = await orch.start_from_ref(
            shellspec_ref,
            base_dir=app_dir,
            ctx=ctx,
            label=f"app-worker:{app_id}",
            record_spec_id=record_spec_id,
            ui=framework_shell_ui,
            wait_ready=False,
        )
    else:
        specs_map = parse_shellspec_data(shellspec_inline, default_id="app-worker")
        if not specs_map:
            raise RuntimeError(f"Invalid inline shellspec for app '{app_id}'")
        spec = specs_map.get("app-worker") or next(iter(specs_map.values()))
        record_spec_id = f"app:{app_id}:{spec.id}"
        shell = await orch.start_spec(
            spec,
            ctx=ctx,
            label=f"app-worker:{app_id}",
            record_spec_id=record_spec_id,
            ui=framework_shell_ui,
            wait_ready=False,
        )

    port = _parse_port(shell.env_overrides.get("TE_APP_WORKER_PORT"))
    if port is None:
        raise RuntimeError(f"App worker shellspec did not set TE_APP_WORKER_PORT for app '{app_id}'")

    # Wait a moment and check if the shell is still alive
    await asyncio.sleep(1.5)
    updated_shell = await manager.get_shell(shell.id)
    
    if not updated_shell or updated_shell.status != 'running':
        error_log_path = Path(shell.stderr_log)
        error_output = ""
        if error_log_path.exists():
            error_output = error_log_path.read_text().strip()
        
        try:
            await manager.remove_shell(shell.id)
        except Exception:
            pass

        raise RuntimeError(f"App worker failed to start: {error_output}")

    if not await _wait_for_port(port, host="127.0.0.1"):
        try:
            await manager.remove_shell(shell.id, force=True)
        except Exception:
            pass
        raise RuntimeError(f"App worker started but port {port} did not become reachable")

    app_info = {"port": port, "shell_id": shell.id}
    _RUNNING_APPS[app_id] = app_info
    print(f"[AppManager] Registered new worker: app_id={app_id}, shell_id={shell.id}, port={port}")
    print(f"[AppManager] _RUNNING_APPS now contains: {list(_RUNNING_APPS.keys())}")
    _save_running_apps()  # Persist to disk
    await app_lifecycle.register_app(app_id, shell.id, port)
    return app_info

async def get_running_apps():
    """
    Returns the dict of currently running apps.
    Fast lookup - no shell validation, just returns the cached dict.
    """
    return _RUNNING_APPS

def get_loaded_apps():
    """Returns the list of loaded app manifests."""
    return _LOADED_APPS

# Running apps are now initialized explicitly during FastAPI startup to avoid
# creating nested event loops at import time.
