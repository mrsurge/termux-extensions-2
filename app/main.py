#!/usr/bin/env python

print("DEBUG: Script starting...")

import json
import os
import subprocess
from flask import Flask, render_template, jsonify, request

print("DEBUG: Imports successful.")

app = Flask(__name__)
print(f"DEBUG: Flask app created. __name__ is: {__name__}")

# Get the absolute path of the project's root directory
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
scripts_dir = os.path.join(project_root, 'scripts')
print(f"DEBUG: Project root: {project_root}")

def run_script(script_name, args=None):
    """Helper function to run a shell script and return its output."""
    if args is None:
        args = []
    script_path = os.path.join(scripts_dir, script_name)
    try:
        # Ensure script is executable
        subprocess.run(['chmod', '+x', script_path], check=True)
        result = subprocess.run([script_path] + args, capture_output=True, text=True, check=True)
        return result.stdout, None
    except subprocess.CalledProcessError as e:
        return None, e.stderr
    except FileNotFoundError:
        return None, f"Script not found: {script_path}"

@app.route('/')
def index():
    """Serves the main HTML page."""
    return render_template('index.html')

# --- API Endpoints ---

@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Lists all active, interactive sessions."""
    output, error = run_script('list_sessions.sh')
    if error:
        return jsonify({'error': error}), 500
    try:
        return jsonify(json.loads(output))
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to decode JSON from script.', 'output': output}), 500

@app.route('/api/shortcuts', methods=['GET'])
def get_shortcuts():
    """Lists all available shortcuts."""
    output, error = run_script('list_shortcuts.sh')
    if error:
        return jsonify({'error': error}), 500
    try:
        return jsonify(json.loads(output))
    except json.JSONDecodeError:
        return jsonify({'error': 'Failed to decode JSON from script.', 'output': output}), 500

@app.route('/api/sessions/<string:sid>/command', methods=['POST'])
def run_command(sid):
    """Runs a command in a specific session."""
    data = request.get_json()
    if not data or 'command' not in data:
        return jsonify({'error': 'Missing \'command\' in request body'}), 400
    
    command = data['command']
    _, error = run_script('run_in_session.sh', [sid, command])
    
    if error:
        return jsonify({'error': error}), 500
    return jsonify({'status': 'success', 'message': f"Command sent to session {sid}."})

@app.route('/api/sessions/<string:sid>/shortcut', methods=['POST'])
def run_shortcut(sid):
    """Runs a shortcut script in a specific session."""
    data = request.get_json()
    if not data or 'path' not in data:
        return jsonify({'error': 'Missing \'path\' of the shortcut in request body'}), 400

    shortcut_path = data['path']
    # We execute the shortcut path directly, it's a command itself
    _, error = run_script('run_in_session.sh', [sid, shortcut_path])

    if error:
        return jsonify({'error': error}), 500
    return jsonify({'status': 'success', 'message': f"Shortcut {os.path.basename(shortcut_path)} sent to session {sid}."})


@app.route('/api/sessions/<string:sid>', methods=['DELETE'])
def kill_session(sid):
    """Kills a specific session by its PID."""
    try:
        # In Unix-like systems, the session ID (sid) is the process ID (PID).
        pid = int(sid)
        # Using os.kill to send SIGKILL signal
        os.kill(pid, 9) # 9 = SIGKILL
        return jsonify({'status': 'success', 'message': f"Session {sid} killed."})
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid session ID format.'}), 400
    except ProcessLookupError:
        return jsonify({'status': 'success', 'message': f"Session {sid} was already terminated."}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

print("DEBUG: Script definitions loaded. Checking __name__...")

if __name__ == '__main__':
    print("DEBUG: __name__ is '__main__', starting Flask server...")
    # Use '0.0.0.0' to make the server accessible from the network
    # Debug mode is on for development
    app.run(host='0.0.0.0', port=8080, debug=True)
else:
    print("DEBUG: __name__ is NOT '__main__', Flask server will not start.")
