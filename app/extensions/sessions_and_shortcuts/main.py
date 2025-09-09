# Extension: Sessions & Shortcuts

import json
import os
import subprocess
from flask import Blueprint, jsonify, request

# Get the absolute path of the project's root directory
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
scripts_dir = os.path.join(project_root, 'scripts')

# Create a Blueprint
sessions_bp = Blueprint('sessions_and_shortcuts', __name__)

def run_script(script_name, args=None):
    """Helper function to run a shell script and return its output."""
    if args is None:
        args = []
    script_path = os.path.join(scripts_dir, script_name)
    try:
        subprocess.run(['chmod', '+x', script_path], check=True)
        result = subprocess.run([script_path] + args, capture_output=True, text=True, check=True)
        return result.stdout, None
    except subprocess.CalledProcessError as e:
        return None, e.stderr
    except FileNotFoundError:
        return None, f"Script not found: {script_path}"

# --- API Endpoints for this extension ---

@sessions_bp.route('/sessions', methods=['GET'])
def get_sessions():
    output, error = run_script('list_sessions.sh')
    if error:
        return jsonify({'error': error}), 500
    try:
        return jsonify(json.loads(output))
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to decode JSON from script.', 'output': output}), 500

@sessions_bp.route('/shortcuts', methods=['GET'])
def get_shortcuts():
    output, error = run_script('list_shortcuts.sh')
    if error:
        return jsonify({'error': error}), 500
    try:
        return jsonify(json.loads(output))
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to decode JSON from script.', 'output': output}), 500

@sessions_bp.route('/sessions/<string:sid>/command', methods=['POST'])
def run_command(sid):
    data = request.get_json()
    if not data or 'command' not in data:
        return jsonify({'error': 'Missing \'command\' in request body'}), 400
    _, error = run_script('run_in_session.sh', [sid, data['command']])
    if error:
        return jsonify({'error': error}), 500
    return jsonify({'status': 'success'})

@sessions_bp.route('/sessions/<string:sid>/shortcut', methods=['POST'])
def run_shortcut(sid):
    data = request.get_json()
    if not data or 'path' not in data:
        return jsonify({'error': 'Missing \'path\' in request body'}), 400
    _, error = run_script('run_in_session.sh', [sid, data['path']])
    if error:
        return jsonify({'error': error}), 500
    return jsonify({'status': 'success'})

@sessions_bp.route('/sessions/<string:sid>', methods=['DELETE'])
def kill_session(sid):
    try:
        os.kill(int(sid), 9)
        return jsonify({'status': 'success'})
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid session ID'}), 400
    except ProcessLookupError:
        return jsonify({'status': 'success', 'message': 'Session already terminated.'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500
