import os
import sys
import json
import socket
import subprocess
import time
from pathlib import Path
from app.libs.framework_shells import get_manager as get_framework_shell_manager
from app.libs import app_lifecycle

# Module-level storage for running apps (replaces Flask's current_app.config)
_RUNNING_APPS = {}
_LOADED_APPS = []

# Persistent storage file for app workers (only valid while framework is running)
_RUNNING_APPS_FILE = Path.home() / '.cache' / 'te_framework' / 'running_apps.json'

def _load_running_apps():
    """
    Load app workers from disk ONLY if they're still alive.
    This handles the case where framework is still running but user navigated away.
    NOT for framework restarts - workers die when framework dies.
    """
    global _RUNNING_APPS
    _RUNNING_APPS_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    if not _RUNNING_APPS_FILE.exists():
        print("[AppManager] No saved running apps found (first run or fresh start)")
        return
    
    try:
        with open(_RUNNING_APPS_FILE, 'r') as f:
            saved_apps = json.load(f)
        
        # Validate each saved app - only restore if shell is STILL alive
        manager = get_framework_shell_manager()
        restored = 0
        for app_id, app_info in saved_apps.items():
            shell = manager.get_shell(app_info.get('shell_id'))
            if shell and shell.status == 'running':
                _RUNNING_APPS[app_id] = app_info
                restored += 1
                print(f"[AppManager] Restored worker: app_id={app_id}, shell_id={app_info.get('shell_id')}, port={app_info.get('port')}")
            else:
                print(f"[AppManager] Discarded stale worker: app_id={app_id} (shell not running)")
        
        if restored > 0:
            print(f"[AppManager] Restored {restored}/{len(saved_apps)} workers from previous navigation")
        else:
            print(f"[AppManager] All saved workers dead (framework was restarted), starting fresh")
            # Clear the stale file
            _RUNNING_APPS_FILE.unlink()
    except Exception as e:
        print(f"[AppManager] Failed to load running apps: {e}")
        _RUNNING_APPS = {}

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

def ensure_app_running(app_id):
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
        manager = get_framework_shell_manager()
        shell = manager.get_shell(app_info.get('shell_id'))
        if shell:
            print(f"[AppManager] Shell found with status: {shell.status}")
        else:
            print(f"[AppManager] Shell NOT FOUND in manager!")
        
        if shell and shell.status == 'running':
            print(f"[AppManager] Worker still running, returning existing app_info")
            return app_info
        # Shell is not running, remove it from the list and restart
        print(f"[AppManager] Shell dead or missing, removing from cache and restarting")
        _RUNNING_APPS.pop(app_id, None)

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

    # Go up 3 levels: app/libs/app_manager.py -> app/libs -> app -> project_root
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env = {
        "PYTHONPATH": f"{os.environ.get('PYTHONPATH', '')}:{project_root}"
    }

    if nicegui_module and nicegui_shell:
        port = find_free_port()
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

        manager = get_framework_shell_manager()
        shell = manager.spawn_shell(command, label=f"asgi-app:{app_id}", cwd=project_root, env=env)

        time.sleep(1.5)
        updated_shell = manager.get_shell(shell.id)

        if not updated_shell or updated_shell.status != 'running':
            error_log_path = Path(shell.stderr_log)
            error_output = ""
            if error_log_path.exists():
                error_output = error_log_path.read_text().strip()

            try:
                manager.remove_shell(shell.id)
            except Exception:
                pass

            raise RuntimeError(f"App worker failed to start: {error_output}")

        app_info = {"port": port, "shell_id": shell.id, "nicegui_shell": True}
        _RUNNING_APPS[app_id] = app_info
        _save_running_apps()  # Persist to disk
        app_lifecycle.register_app(app_id, shell.id, port)
        return app_info

    if not backend_module:
        # No backend, nothing to start
        return {"message": "No backend to start"}

    port = find_free_port()
    backend_module_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', app_manifest['_dir'], backend_module)
    command = [
        "python",
        "-m",
        "app.libs.app_worker",
        "--app-id", app_id,
        "--port", str(port),
        "--backend-module", backend_module_path
    ]

    manager = get_framework_shell_manager()
    shell = manager.spawn_shell(command, label=f"app-worker:{app_id}", cwd=project_root, env=env)

    # Wait a moment and check if the shell is still alive
    time.sleep(1.5)
    updated_shell = manager.get_shell(shell.id)
    
    if not updated_shell or updated_shell.status != 'running':
        error_log_path = Path(shell.stderr_log)
        error_output = ""
        if error_log_path.exists():
            error_output = error_log_path.read_text().strip()
        
        try:
            manager.remove_shell(shell.id)
        except Exception:
            pass

        raise RuntimeError(f"App worker failed to start: {error_output}")

    app_info = {"port": port, "shell_id": shell.id}
    _RUNNING_APPS[app_id] = app_info
    print(f"[AppManager] Registered new worker: app_id={app_id}, shell_id={shell.id}, port={port}")
    print(f"[AppManager] _RUNNING_APPS now contains: {list(_RUNNING_APPS.keys())}")
    _save_running_apps()  # Persist to disk
    app_lifecycle.register_app(app_id, shell.id, port)
    return app_info

def get_running_apps():
    """
    Returns the dict of currently running apps.
    Fast lookup - no shell validation, just returns the cached dict.
    """
    return _RUNNING_APPS

def get_loaded_apps():
    """Returns the list of loaded app manifests."""
    return _LOADED_APPS

# Load running apps from disk when module is imported
_load_running_apps()
