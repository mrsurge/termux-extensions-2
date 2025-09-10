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
from app.utils import run_script

app = Flask(__name__)


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

@app.route('/api/extensions')
def get_extensions():
    return jsonify(loaded_extensions)

@app.route('/api/system_stats')
def get_system_stats():
    output, error = run_script('get_system_stats.sh', app.root_path)
    if error:
        return jsonify({'error': error}), 500
    try:
        return jsonify(json.loads(output))
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to decode JSON from stats script.'}), 500

@app.route('/extensions/<path:ext_dir>/<path:filename>')
def serve_extension_file(ext_dir, filename):
    return send_from_directory(os.path.join(app.root_path, 'extensions', ext_dir), filename)

@app.route('/api/browse')
def browse_path():
    """Browses a given path, defaulting to the user's home directory."""
    path = request.args.get('path', '~')
    # Expand the tilde and normalize the path to resolve `..` etc.
    expanded_path = os.path.normpath(os.path.expanduser(path))

    # Basic security check to prevent path traversal
    if not os.path.abspath(expanded_path).startswith(os.path.expanduser('~')):
        return jsonify({'error': 'Access denied'}), 403

    output, error = run_script('browse.sh', app.root_path, [expanded_path])
    if error:
        return jsonify({'error': error}), 500
    try:
        return jsonify(json.loads(output))
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to decode JSON from browse script.'}), 500

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
    print("--- Starting Server ---")
    app.run(host='0.0.0.0', port=8080, debug=True)
