# Extension: Sessions & Shortcuts

import json
import os
import subprocess
from flask import Blueprint, jsonify, request, current_app
from app.utils import run_script

# Create a Blueprint
sessions_bp = Blueprint('sessions_and_shortcuts', __name__)

# --- API Endpoints for this extension ---

@sessions_bp.route('/sessions', methods=['GET'])
def get_sessions():
    output, error = run_script('list_sessions.sh', current_app.root_path)
    if error:
        return jsonify({'error': error}), 500
    try:
        return jsonify(json.loads(output))
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to decode JSON from script.', 'output': output}), 500

@sessions_bp.route('/shortcuts', methods=['GET'])
def get_shortcuts():
    output, error = run_script('list_shortcuts.sh', current_app.root_path)
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
    _, error = run_script('run_in_session.sh', current_app.root_path, [sid, data['command']])
    if error:
        return jsonify({'error': error}), 500
    return jsonify({'status': 'success'})

@sessions_bp.route('/sessions/<string:sid>/shortcut', methods=['POST'])
def run_shortcut(sid):
    data = request.get_json()
    if not data or 'path' not in data:
        return jsonify({'error': 'Missing \'path\' in request body'}), 400
    _, error = run_script('run_in_session.sh', current_app.root_path, [sid, data['path']])
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
