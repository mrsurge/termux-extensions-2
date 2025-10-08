import os
import json
from flask import Blueprint, jsonify, render_template, send_from_directory, current_app
from app.utils.app_manager import ensure_app_running
from app.libs import app_lifecycle
from app.framework_shells import _manager as get_framework_shell_manager

# This blueprint is managed by the dynamic loader in app/main.py
# It is registered under the url_prefix /api/ext/apps
apps_bp = Blueprint('apps', __name__)



@apps_bp.route('/api/apps/<app_id>/start', methods=['POST'])
def start_app(app_id):
    try:
        app_info = ensure_app_running(app_id)
        return jsonify({"ok": True, "data": app_info})
    except (ValueError, RuntimeError) as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@apps_bp.route('/api/apps/<app_id>/quit', methods=['POST'])
def quit_app(app_id: str):
    """
    A new, specific endpoint for quitting an app.
    """
    manager = get_framework_shell_manager()
    running_apps = app_lifecycle.get_running_apps(manager)
    app_to_quit = next((app for app in running_apps if app.get("app_id") == app_id), None)

    if not app_to_quit:
        return jsonify({"ok": False, "error": "App is not running or already terminated."}), 404

    shell_id = app_to_quit["shell_id"]
    terminated = app_lifecycle.terminate_app(manager, shell_id)

    if terminated:
        return jsonify({"ok": True, "data": {"message": f"App {app_id} terminated."}})
    else:
        return jsonify({"ok": False, "error": "Failed to terminate app."}), 500

@apps_bp.route('/api/apps/<app_id>/lock', methods=['POST'])
def lock_app(app_id: str):
    """Sets the lock state for an app to true."""
    manager = get_framework_shell_manager()
    running_apps = app_lifecycle.get_running_apps(manager)
    app_to_lock = next((app for app in running_apps if app.get("app_id") == app_id), None)
    if not app_to_lock:
        return jsonify({"ok": False, "error": "App not running."}), 404
    
    updated_app = app_lifecycle.set_lock_state(app_to_lock["shell_id"], True)
    return jsonify({"ok": True, "data": updated_app})

@apps_bp.route('/api/apps/<app_id>/unlock', methods=['POST'])
def unlock_app(app_id: str):
    """Sets the lock state for an app to false."""
    manager = get_framework_shell_manager()
    running_apps = app_lifecycle.get_running_apps(manager)
    app_to_unlock = next((app for app in running_apps if app.get("app_id") == app_id), None)
    if not app_to_unlock:
        return jsonify({"ok": False, "error": "App not running."}), 404
    
    updated_app = app_lifecycle.set_lock_state(app_to_unlock["shell_id"], False)
    return jsonify({"ok": True, "data": updated_app})

@apps_bp.route('/api/apps/running', methods=['GET'])
def get_running_apps():
    """Returns a list of all currently running app shells with stats."""
    manager = get_framework_shell_manager()
    running_apps = app_lifecycle.get_running_apps(manager)
    # We need to augment this with data from the main app manifests (like name and icon)
    all_apps = {app['id']: app for app in current_app.config.get('LOADED_APPS', [])}
    
    augmented_apps = []
    for app in running_apps:
        manifest_data = all_apps.get(app.get('app_id'))
        if manifest_data:
            app['name'] = manifest_data.get('name')
            app['icon_emoji'] = manifest_data.get('icon_emoji')
        augmented_apps.append(app)
        
    return jsonify({"ok": True, "data": augmented_apps})

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