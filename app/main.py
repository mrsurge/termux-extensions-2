#!/usr/bin/env python

import os
import sys
import json
import importlib.util
import subprocess

# Add project root to the Python path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from flask import Flask, render_template, jsonify, send_from_directory, request
from app.framework_shells import framework_shells_bp

app = Flask(__name__)
app.register_blueprint(framework_shells_bp)

# Pre-initialize to avoid NameError if imported differently
loaded_extensions = []
loaded_apps = []

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
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            from flask import Blueprint
            for obj_name in dir(module):
                obj = getattr(module, obj_name)
                if isinstance(obj, Blueprint):
                    app.register_blueprint(obj, url_prefix=f"/api/ext/{ext_name}")
                    break
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

        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
        if backend_file:
            module_name = f"app.apps.{app_name}.{backend_file.replace('.py', '')}"
            spec = importlib.util.spec_from_file_location(module_name, os.path.join(app_path, backend_file))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

            from flask import Blueprint
            for obj_name in dir(module):
                obj = getattr(module, obj_name)
                if isinstance(obj, Blueprint):
                    app_id = manifest.get('id', app_name)
                    app.register_blueprint(obj, url_prefix=f"/api/app/{app_id}")
                    break
    return apps


@app.route('/extensions/<path:ext_dir>/<path:filename>')
def serve_extension_file(ext_dir, filename):
    return send_from_directory(os.path.join(app.root_path, 'extensions', ext_dir), filename)

@app.route('/api/extensions')
def get_extensions():
    return jsonify({"ok": True, "data": loaded_extensions})

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
    # Expand the tilde and normalize the path to resolve `..` etc.
    expanded_path = os.path.normpath(os.path.expanduser(path))

    # Basic security check to prevent path traversal
    if not os.path.abspath(expanded_path).startswith(os.path.expanduser('~')):
        return jsonify({"ok": False, "error": 'Access denied'}), 403

    output, error = run_script('browse.sh', app.root_path, [expanded_path])
    if error:
        return jsonify({"ok": False, "error": error}), 500
    try:
        return jsonify({"ok": True, "data": json.loads(output)})
    except json.JSONDecodeError:
        return jsonify({"ok": False, "error": 'Failed to decode JSON from browse script.'}), 500

@app.route('/api/apps')
def get_apps():
    return jsonify({"ok": True, "data": loaded_apps})

@app.route('/app/<app_id>')
def app_shell(app_id):
    """Renders a generic shell for a single-page app."""
    # We can pass the app_id to the template if it needs to fetch its own details
    return render_template('app_shell.html', app_id=app_id)

@app.route('/apps/<path:app_dir>/<path:filename>')
def serve_app_file(app_dir, filename):
    return send_from_directory(os.path.join(app.root_path, 'apps', app_dir), filename)


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


if __name__ == '__main__':
    print("--- Loading Extensions ---")
    loaded_extensions = load_extensions()
    print(f"Loaded {len(loaded_extensions)} extensions.")
    print("--- Loading Apps ---")
    loaded_apps = load_apps()
    print(f"Loaded {len(loaded_apps)} apps.")
    print("--- Starting Server ---")
    app.run(host='0.0.0.0', port=8080, debug=True)
