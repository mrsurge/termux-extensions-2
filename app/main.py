#!/usr/bin/env python

import os
import json
import importlib.util
from flask import Flask, render_template, jsonify, send_from_directory

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
            # Add extension directory name to manifest data for later use
            manifest['_ext_dir'] = ext_name
            extensions.append(manifest)

        # Dynamically load and register the blueprint
        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
        if backend_file:
            module_name = f"app.extensions.{ext_name}.{backend_file.replace('.py', '')}"
            spec = importlib.util.spec_from_file_location(
                module_name, 
                os.path.join(ext_path, backend_file)
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            
            # Find the blueprint object in the loaded module
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
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/api/extensions', methods=['GET'])
def get_extensions():
    """Returns the list of loaded extension manifests."""
    return jsonify(loaded_extensions)

@app.route('/extensions/<path:ext_dir>/<path:filename>')
def serve_extension_file(ext_dir, filename):
    """Serves a static file from a specific extension's directory."""
    return send_from_directory(os.path.join(app.root_path, 'extensions', ext_dir), filename)


if __name__ == '__main__':
    print("--- Loading Extensions ---")
    loaded_extensions = load_extensions()
    print(f"Loaded {len(loaded_extensions)} extensions.")
    print("--- Starting Server ---")
    app.run(host='0.0.0.0', port=8080, debug=True)
