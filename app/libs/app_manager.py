import os
import socket
import time
from pathlib import Path
from flask import current_app
from app.libs.framework_shells import _manager as get_framework_shell_manager
from app.libs import app_lifecycle

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

def ensure_app_running(app_id):
    """
    Ensures an app's backend is running. If not, it spawns it.
    Returns the app's info (port, shell_id) or raises an exception.
    """
    if 'RUNNING_APPS' not in current_app.config:
        current_app.config['RUNNING_APPS'] = {}

    if app_id in current_app.config['RUNNING_APPS']:
        # App is already running, verify the shell is alive
        app_info = current_app.config['RUNNING_APPS'][app_id]
        manager = get_framework_shell_manager()
        shell = manager.get_shell(app_info.get('shell_id'))
        if shell and shell.status == 'running':
            return app_info
        # Shell is not running, remove it from the list and restart
        current_app.config['RUNNING_APPS'].pop(app_id, None)

    # Find the app's manifest
    app_manifest = None
    for app_data in current_app.config.get('LOADED_APPS', []):
        if app_data.get('id') == app_id:
            app_manifest = app_data
            break
    
    if not app_manifest:
        raise ValueError(f"App '{app_id}' not found")

    backend_module = app_manifest.get('entrypoints', {}).get('backend_blueprint')
    if not backend_module:
        # No backend, nothing to start
        return {"message": "No backend to start"}

    port = find_free_port()
    backend_module_path = os.path.join(current_app.root_path, 'apps', app_manifest['_dir'], backend_module)
    project_root = os.path.join(current_app.root_path, '..')
    
    env = {
        "PYTHONPATH": f"{os.environ.get('PYTHONPATH', '')}:{project_root}"
    }
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
    current_app.config['RUNNING_APPS'][app_id] = app_info
    app_lifecycle.register_app(app_id, shell.id, port)
    return app_info
