# Project Specification: termux-extensions-2

This document outlines the architecture and design of the `termux-extensions-2` project.

## 1. Core Framework

The backend is a Python web server built with the Flask framework. It uses a helper function to execute shell scripts from a dedicated `scripts/` directory, which act as a bridge to the Termux environment.

**`app/main.py` - Flask App Initialization:**
```python
import json
import os
import subprocess
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
scripts_dir = os.path.join(project_root, 'scripts')

def run_script(script_name, args=None):
    """Helper function to run a shell script and return its output."""
    # ... implementation ...
```

## 2. REST API

The Flask server exposes a simple REST API that the frontend consumes to get data and perform actions. The API endpoints call the underlying shell scripts and return their output as JSON.

**`app/main.py` - Session API Endpoint:**
```python
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
```

## 3. Shell Interaction Layer

The interaction between the web server and the live Termux shells is the core of the project. This is handled by a set of robust shell scripts.

### 3.1. Session Hooking (`init.sh`)

When sourced, this script wraps the current interactive shell in a `dtach` session, making it controllable. It forces the new `dtach`-managed shell to re-source this same script, which then proceeds to create a metadata directory in `~/.cache/te/` that makes the session discoverable.

**`scripts/init.sh` - Snippet:**
```bash
# 2. If not already inside dtach, re-execute the shell inside dtach.
if [ "${TE_DTACH:-0}" != "1" ] && command -v dtach >/dev/null 2>&1; then
  run_base="${XDG_RUNTIME_DIR:-$HOME/.local/run}/te"
  mkdir -p "$run_base"
  sock="$run_base/$PPID-$-$RANDOM.sock"

  export TE_DTACH=1
  export TE_SOCK="$sock"

  # Use --rcfile to force the new shell to source this script
  # before becoming interactive.
  exec dtach -A "$sock" bash --rcfile "${BASH_SOURCE[0]}"
fi

# 3. If we are here, we are inside the dtach-managed shell.
#    Run the setup function.
setup_session_metadata
```

### 3.2. Session Discovery (`list_sessions.sh`)

This script is called by the `/api/sessions` endpoint. It scans the `~/.cache/te` directory, filters for valid sessions where `SESSION_TYPE` is `interactive`, and outputs a clean JSON array.

**`scripts/list_sessions.sh` - Snippet:**
```bash
# ...
find "$CACHE_DIR" -mindepth 1 -maxdepth 1 -type d | while read -r session_dir;
do
  meta_file="$session_dir/meta"

  if [ ! -f "$meta_file" ]; then continue; fi

  CWD=""; SID=""; SESSION_TYPE=""; SOCK=""
  . "$meta_file"

  if [ "$SESSION_TYPE" != "interactive" ]; then continue; fi
  if ! ps -p "$SID" > /dev/null; then
    rm -rf "$session_dir"
    continue
  fi

  if [ "$first" = true ]; then first=false; else echo ","; fi

  # ... escape values ...

  # Print the session details as a compact JSON object
  printf '{"sid":"%s","cwd":"%s","sock":"%s"}' "$sid_esc" "$cwd_esc" "$sock_esc"
done
```

## 4. Frontend UI

The user interface is a single HTML file that uses modern CSS for styling and vanilla JavaScript to dynamically interact with the backend API.

**`app/templates/index.html` - Session Rendering Snippet:**
```javascript
const renderSessions = (sessions) => {
    sessionsList.innerHTML = '';
    if (sessions.length === 0) {
        sessionsList.innerHTML = '<p style="color: var(--muted-foreground);">No interactive sessions found.</p>';
        return;
    }
    sessions.forEach(session => {
        const sessionEl = document.createElement('div');
        sessionEl.className = 'session';
        sessionEl.innerHTML = `
            <div class="session-header">
                <div class="session-title">SID: ${session.sid}</div>
                <button class="menu-btn" data-sid="${session.sid}">&#8942;</button>
            </div>
            <div class="session-cwd">${session.cwd}</div>
            <div class="menu" id="menu-${session.sid}">
                <div class="menu-item" data-action="run-shortcut">Run Shortcut...</div>
                <div class="menu-item" data-action="run-command">Run Command...</div>
                <div class="menu-item destructive" data-action="kill">Kill Session</div>
            </div>
        `;
        sessionsList.appendChild(sessionEl);
    });
};
```
