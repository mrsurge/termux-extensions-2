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

# Project Specification: termux-extensions-2

This document outlines the implemented architecture of the `termux-extensions-2` project.

## 1. Modular Architecture

The framework is built on a modular architecture where features are encapsulated in self-contained **extensions**. The main Flask application is responsible for discovering, loading, and serving these extensions.

### 1.1. Extension Discovery

On startup, the main application scans the `app/extensions/` directory for subdirectories. Each valid extension is identified by the presence of a `manifest.json` file.

**`app/extensions/sessions_and_shortcuts/manifest.json`:**
```json
{
  "name": "Sessions & Shortcuts",
  "version": "0.1.0",
  "description": "View and interact with active Termux sessions and run shortcuts.",
  "author": "Gemini",
  "entrypoints": {
    "backend_blueprint": "main.py",
    "frontend_template": "template.html",
    "frontend_script": "main.js"
  }
}
```

### 1.2. Backend Loading

The core backend in `app/main.py` dynamically loads each extension's Python code as a Flask **Blueprint**. This registers the extension's specific API routes under a unique prefix (e.g., `/api/ext/sessions_and_shortcuts`).

**`app/main.py` - Extension Loading Snippet:**
```python
def load_extensions():
    # ...
    for ext_name in os.listdir(extensions_dir):
        # ... read manifest ...

        # Dynamically load and register the blueprint
        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
        if backend_file:
            # ... importlib code to load module ...
            
            # Find the blueprint object in the loaded module
            from flask import Blueprint
            for obj_name in dir(module):
                obj = getattr(module, obj_name)
                if isinstance(obj, Blueprint):
                    app.register_blueprint(obj, url_prefix=f"/api/ext/{ext_name}")
                    break
    return extensions
```

### 1.3. Frontend Loading

The main `index.html` page acts as a shell. Its JavaScript fetches a list of available extensions from the `/api/extensions` endpoint. For each extension, it dynamically fetches the HTML template and injects it into the page, then loads the corresponding JavaScript module to make it interactive.

**`app/templates/index.html` - Extension Loader Snippet:**
```javascript
async function loadExtensions() {
    const response = await fetch('/api/extensions');
    const extensions = await response.json();

    for (const ext of extensions) {
        // ... create container div ...

        // 1. Fetch and inject the extension's HTML template
        const templatePath = `/extensions/${ext._ext_dir}/${ext.entrypoints.frontend_template}`;
        const templateResponse = await fetch(templatePath);
        extContainer.innerHTML = await templateResponse.text();

        // 2. Dynamically import and initialize the extension's JavaScript module
        const scriptPath = `/extensions/${ext._ext_dir}/${ext.entrypoints.frontend_script}`;
        const module = await import(scriptPath);
        
        // Create a scoped API object for the extension and initialize
        const api = { /* ... */ };
        module.default(extContainer, api);
    }
}
```

## 2. Shell Interaction Layer

The bridge to the Termux environment is a set of shell scripts in the `/scripts` directory.

*   **`init.sh`**: Hooks into interactive shells using `dtach` to make them controllable.
*   **`list_sessions.sh`**: Scans for metadata files in `~/.cache/te` and produces a JSON list of active sessions.
*   **`run_in_session.sh`**: Injects a command into a specified session's `dtach` socket.
*   **`list_shortcuts.sh`**: Scans `~/.shortcuts` for executable files.


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
