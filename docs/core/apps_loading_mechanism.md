# Apps Loading Mechanism

## Overview

The framework loads apps dynamically from the `app/apps/` directory. Each app runs as an independent Flask process in a "framework shell" and communicates with the main framework through a reverse proxy system.

## App Structure

Each app must have:

1. **manifest.json** - Metadata and configuration
2. **main.py** - Flask application entry point with blueprints
3. **template.html** - Frontend HTML template
4. **main.js** - Frontend JavaScript module

Example structure:
```
app/apps/file_editor_cm6/
├── manifest.json
├── main.py
├── template.html
└── main.js
```

## Loading Process

### 1. Discovery Phase (`app/main.py`)

Apps are discovered during framework startup:

```python
def load_apps():
    apps_dir = Path(__file__).parent / "apps"
    for app_dir in apps_dir.iterdir():
        if app_dir.is_dir():
            manifest_path = app_dir / "manifest.json"
            if manifest_path.exists():
                # Load and register app
```

### 2. Registration

Apps are registered in memory with their metadata:
- App ID (directory name)
- Display name
- Icon
- Category
- Path to main.py

### 3. Launch on Demand

When a user clicks an app in the UI:

**Frontend Request:**
```javascript
POST /api/apps/{app_id}/start
```

**Backend Process (`app/libs/app_manager.py`):**
1. Check if app is already running
2. If not, spawn new framework shell process
3. Framework shell starts Flask app on dynamic port
4. Return app info with port to frontend

### 4. Reverse Proxy

All app requests are proxied through the main framework:

**Request Flow:**
```
Browser → Main Framework (port 8088)
         → Reverse Proxy
         → App Flask Process (dynamic port)
         → Response
```

**Proxy Endpoint Pattern:**
```
/api/app/{app_id}/{path:path}
```

The main framework forwards requests to the app's Flask instance.

## App Lifecycle

### Starting

```python
# app/libs/app_manager.py
def ensure_app_running(app_id):
    if app_id not in RUNNING_APPS:
        # Spawn framework shell
        port = get_available_port()
        process = start_framework_shell(app_id, port)
        RUNNING_APPS[app_id] = {
            'port': port,
            'process': process,
            'pid': process.pid
        }
    return RUNNING_APPS[app_id]
```

### Framework Shell

Each app runs in a framework shell (`app/libs/app_worker.py`):
- Isolated Python process
- Dedicated port
- Independent Flask app
- Logs to framework log directory

### Communication

**WebSockets:**
Apps can use WebSockets for real-time communication. The framework proxies WebSocket connections:

```python
@app.websocket("/api/app/{app_id}/ws/{path:path}")
async def proxy_app_websocket(websocket, app_id, path):
    # Proxy WebSocket connection to app
```

**REST Endpoints:**
Apps define Flask blueprints that are accessed through the proxy:

```python
# In app's main.py
from flask import Blueprint

bp = Blueprint('app_name', __name__)

@bp.route('/state')
def get_state():
    return jsonify({"data": "value"})
```

Accessed via: `GET /api/app/{app_id}/state`

## App Manifest

Example `manifest.json`:

```json
{
  "id": "file_editor_cm6",
  "name": "Code Editor",
  "icon": "code",
  "category": "Development",
  "description": "Code editor with syntax highlighting",
  "version": "1.0.0",
  "main": "main.py",
  "frontend": {
    "template": "template.html",
    "script": "main.js"
  }
}
```

## Frontend Integration

### Loading App UI

1. Main framework serves `/app/{app_id}` route
2. Returns HTML that loads:
   - App template from `/apps/{app_id}/template.html`
   - App script from `/apps/{app_id}/main.js`

3. App JavaScript initializes and makes API calls to `/api/app/{app_id}/...`

### Static Assets

Apps can have static assets served from:
```
/apps/{app_id}/static/{path}
```

Mounted via:
```python
app.mount(
    f"/apps/{app_id}",
    StaticFiles(directory=app_dir),
    name=f"app_{app_id}"
)
```

## Port Management

- Main framework: Port 8088 (or configured port)
- Apps: Dynamic ports starting from 9000+
- Framework shells: Each gets unique port
- Port tracking: In-memory dictionary `RUNNING_APPS`

## State Persistence

Apps can store state via:

```python
# Global state API
POST /api/state
GET /api/state?key=app_state:{app_id}
```

Per-app state is namespaced: `app_state:{app_id}`

## Stopping Apps

Apps can be stopped via:
```
POST /api/apps/{app_id}/stop
```

This terminates the framework shell process.

## Migration to ASGI

In the ASGI migration, the reverse proxy uses `httpx` for async HTTP forwarding:

```python
@app.api_route("/api/app/{app_id}/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_app_request(app_id: str, path: str, request: Request):
    app_info = await anyio.to_thread.run_sync(ensure_app_running, app_id)
    
    async with httpx.AsyncClient() as client:
        resp = await client.request(
            method=request.method,
            url=f"http://127.0.0.1:{app_info['port']}/{path}",
            content=await request.body(),
            headers=dict(request.headers)
        )
        return Response(content=resp.content, status_code=resp.status_code)
```

WebSocket proxying uses Starlette's WebSocket support with bidirectional forwarding.

## Error Handling

- Connection failures: Retry logic or restart app
- Port conflicts: Find next available port
- Crashes: Framework shell monitor detects and can restart
- Logs: Each app logs to `~/.cache/te_framework/logs/{app_id}/`

## Reading Framework Shell Logs

Framework shell logs are stored directly in `~/.cache/te_framework/logs/` with **NO subdirectories**. All logs dump directly to this directory.

```
~/.cache/te_framework/logs/
├── fs_*
└── (all framework shell logs with fs_ prefix)
```

### Log File Naming Convention

All framework shell logs use the pattern: `fs_*`

Typically: `fs_{app_id}_{timestamp}.log` or similar variations

### Reading Logs Manually

To view framework shell logs:

```bash
# List all framework shell logs
ls ~/.cache/te_framework/logs/fs_*

# View all logs in real-time
tail -f ~/.cache/te_framework/logs/fs_*

# View specific app logs (replace with actual app_id)
tail -f ~/.cache/te_framework/logs/fs_{app_id}*

# View most recent log
ls -t ~/.cache/te_framework/logs/fs_* | head -1 | xargs tail -f
```

### Framework Log Monitor

The framework includes a log monitor (`FrameworkLogMonitor` in `app/main.py`) that:

1. Watches the logs directory for changes
2. Polls log files periodically (default: 1 second)
3. Can replay existing logs on startup (if enabled)
4. Forwards log output to the main framework console

The monitor is started during framework initialization:

```python
# In app/main.py
@app.on_event("startup")
async def startup():
    # ... other startup tasks ...
    print("--- Starting Framework Shell Log Monitor ---")
    monitor = FrameworkLogMonitor(
        log_dir=Path.home() / ".cache" / "te_framework" / "logs",
        poll_interval=1.0,
        replay_existing=False
    )
    asyncio.create_task(monitor.monitor())
```

### Debugging App Issues

When debugging app startup or runtime issues:

1. **Check if app process started**:
   ```bash
   ps aux | grep file_editor_cm6
   ```

2. **Check framework shell logs for errors**:
   ```bash
   cat ~/.cache/te_framework/logs/fs_*
   ```

3. **Check specific app logs**:
   ```bash
   cat ~/.cache/te_framework/logs/fs_file_editor_cm6*
   ```

4. **Monitor logs in real-time**:
   ```bash
   tail -f ~/.cache/te_framework/logs/fs_*
   ```

### Common Log Patterns

**Successful app startup**:
```
 * Running on http://127.0.0.1:9001
 * Debug mode: off
```

**Connection errors** (app trying to connect to something):
```
httpcore.ConnectError: All connection attempts failed
```

**Import errors**:
```
ModuleNotFoundError: No module named 'xyz'
```

**Port conflicts**:
```
OSError: [Errno 98] Address already in use
```

## Key Files

- `app/main.py` - Main framework, proxy endpoints, log monitor
- `app/libs/app_manager.py` - App lifecycle management
- `app/libs/app_worker.py` - Framework shell worker process
- `app/libs/framework_shells.py` - Shell process management
- `app/apps/*/main.py` - Individual app Flask applications
- `~/.cache/te_framework/logs/` - Runtime logs for all framework shells
