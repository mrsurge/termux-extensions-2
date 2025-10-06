import os
import json
import socket
import time
from pathlib import Path
from flask import Blueprint, jsonify, render_template, send_from_directory, current_app
from app.framework_shells import _manager as get_framework_shell_manager

# This blueprint is managed by the dynamic loader in app/main.py
# It is registered under the url_prefix /api/ext/apps
apps_bp = Blueprint('apps', __name__)

def find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

@apps_bp.route('/api/apps/<app_id>/start', methods=['POST'])
def start_app(app_id):
    if 'RUNNING_APPS' not in current_app.config:
        current_app.config['RUNNING_APPS'] = {}

    if app_id in current_app.config['RUNNING_APPS']:
        # App is already running
        return jsonify({"ok": True, "data": current_app.config['RUNNING_APPS'][app_id]})

    # Find the app's manifest
    app_manifest = None
    for app_data in current_app.config.get('LOADED_APPS', []):
        if app_data.get('id') == app_id:
            app_manifest = app_data
            break
    
    if not app_manifest:
        return jsonify({"ok": False, "error": "App not found"}), 404

    backend_module = app_manifest.get('entrypoints', {}).get('backend_blueprint')
    if not backend_module:
        # No backend, nothing to start
        return jsonify({"ok": True, "data": {"message": "No backend to start"}})

    port = find_free_port()
    backend_module_path = os.path.join(current_app.root_path, 'apps', app_manifest['_dir'], backend_module)

    project_root = os.path.join(current_app.root_path, '..')
    env = {
        "PYTHONPATH": f"{os.environ.get('PYTHONPATH', '')}:{project_root}"
    }
    command = [
        "python",
        "-m",
        "app.app_worker",
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
        # The shell died, try to get the error log
        error_log_path = Path(shell.stderr_log)
        error_output = ""
        if error_log_path.exists():
            error_output = error_log_path.read_text().strip()
        
        # Clean up the failed shell
        try:
            manager.remove_shell(shell.id)
        except Exception:
            pass # Ignore cleanup errors

        return jsonify({
            "ok": False, 
            "error": "App worker failed to start.",
            "details": error_output
        }), 500

    app_info = {"port": port, "shell_id": shell.id}
    current_app.config['RUNNING_APPS'][app_id] = app_info

    return jsonify({"ok": True, "data": app_info})

@apps_bp.route('/api/apps')
def get_apps():
    """
    This endpoint is now responsible for providing the list of available applications.
    The actual loading and blueprint registration still happens at startup in app/main.py,
    and the result is stored in `current_app.config`.
    """
    loaded_apps = current_app.config.get('LOADED_APPS', [])
    return jsonify({"ok": True, "data": loaded_apps})

@apps_bp.route('/app/<app_id>')
def app_shell(app_id):
    """Renders a generic shell for a single-page app."""
    return render_template('app_shell.html', app_id=app_id)

@apps_bp.route('/apps/<path:app_dir>/<path:filename>')
def serve_app_file(app_dir, filename):
    """Serves static assets for a specific app."""
    # Note: app.root_path is used to construct the absolute path to the 'app' directory.
    full_path = os.path.join(current_app.root_path, 'apps', app_dir, filename)
    if not os.path.isfile(full_path):
        from flask import abort
        return abort(404)
    # Ensure JS modules are served with a JS MIME type so dynamic import() works reliably
    if filename.endswith(('.js', '.mjs')):
        return send_from_directory(os.path.join(current_app.root_path, 'apps', app_dir), filename, mimetype='application/javascript')
    return send_from_directory(os.path.join(current_app.root_path, 'apps', app_dir), filename)