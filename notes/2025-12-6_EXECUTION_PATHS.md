# Execution Path: run_framework.sh → file_editor_cm6 File Opening

## Date: 2025-12-06
## Traced Execution Path from scripts/run_framework.sh to opening a file in file_editor_cm6

---

## 1. Entry Point: scripts/run_framework.sh

**Location:** `/data/data/com.termux/files/home/mrselect5/scripts/run_framework.sh`

**Execution Steps:**
1. Script parses command-line arguments (lines 44-73)
2. Calls `generate_run_id_if_needed()` (line 81) which generates `TE_RUN_ID` environment variable (lines 75-79)
3. Calls `cleanup_framework_shell_logs()` (line 159) to archive old logs
4. Resolves script path and repository root (lines 145-157)
5. Changes directory to repository root (line 157)
6. Cleans Python cache files (line 162)
7. Checks if supervisor is already running (lines 170-173)
8. Sets up IPC configuration variables (lines 175-177)
9. Calls `start_ipc_server()` (line 203) which:
   - Starts IPC server on port 9123 (line 195)
   - Exports `TE_IPC_PID` environment variable (line 197)
10. Executes `python -m app.supervisor` with any extra arguments (line 205)

---

## 2. Supervisor Module: app/supervisor.py

**Location:** `/data/data/com.termux/files/home/mrselect5/app/supervisor.py`

**Execution Steps:**
1. Entry via `main()` function (line 141) which calls `run(sys.argv[1:])` (line 142)
2. `run()` function (line 54):
   - Calls `_ensure_run_id()` (line 55) to ensure `TE_RUN_ID` is set
   - Sets `TE_SUPERVISOR_PID` environment variable (line 56)
   - Writes run ID to file `~/.cache/te_framework/run_id` (lines 60-63)
   - Constructs command `[sys.executable, "-m", "app.main", *argv]` (line 65)
   - Spawns subprocess with `subprocess.Popen(cmd, preexec_fn=os.setsid)` (line 67)
   - Sets up signal handlers for SIGTERM and SIGINT (lines 106-107)
   - Waits for process to complete (line 111)

---

## 3. Main Application: app/main.py

**Location:** `/data/data/com.termux/files/home/mrselect5/app/main.py`

**Execution Steps:**

### 3.1 Module-level Setup (Import Time)
1. Adds vendor directory to Python path for modified NiceGUI (lines 7-9)
2. Creates FastAPI app with lifespan context manager (line 92)
3. Mounts static files directory (lines 95-99)
4. Imports framework shell manager and agent bridge (lines 101-102)
5. Initializes `TE_RUN_ID` if not already set (lines 106-111)

### 3.2 Lifespan Startup (lines 41-84)
1. Registers framework process with IPC server (lines 44-60)
2. Calls `_apply_settings_to_config()` (line 64) - currently a no-op
3. Calls `load_services()` (line 66) which:
   - Scans `app/libs` directory (line 521)
   - Imports service modules (line 529)
   - Auto-registers FastAPI routers (lines 533-539)
4. Calls `load_extensions()` (line 69) which:
   - Scans `app/extensions` directory (lines 551-556)
   - Loads extension manifests (lines 564-567)
   - Imports backend modules and registers routers (lines 569-598)
5. Calls `load_apps()` (line 72) which:
   - Scans `app/apps` directory (line 611)
   - Loads app manifests from `manifest.json` files (lines 616-625)
   - Returns list of app manifests (line 628)
6. Stores loaded apps in `app_manager._LOADED_APPS` (line 75)
7. Calls `await initialize_running_apps()` (line 78) which:
   - Calls `_load_running_apps()` from app_manager module
   - Restores previously running app workers from saved state
   - Adopts orphaned shell processes
8. Starts framework shell log monitor thread (line 81)
9. Calls `start_background_tasks()` (line 83) from app_lifecycle

### 3.3 Main Execution (lines 1383-1577)
When run as `__main__`:
1. Imports argparse, uvicorn, subprocess, re, ipaddress modules (lines 1391-1395)
2. Parses command-line arguments for broadcast options (lines 1397-1401)
3. Builds IP allowlist and configures middleware (lines 1413-1565)
4. Calls `uvicorn.run()` (lines 1573-1577) which starts ASGI server on host:port 8088

---

## 4. Apps Extension: app/extensions/apps

**Location:** `/data/data/com.termux/files/home/mrselect5/app/extensions/apps/`

The "apps" extension is a special extension that provides the app launcher and management API. It is loaded as an extension but registered without a prefix (directly on the root path).

**Execution Steps:**

### 4.1 Extension Loading (in app/main.py load_extensions())
1. Extension loader scans `app/extensions` directory (line 551)
2. Finds `apps` directory with `manifest.json` (lines 556-567)
3. Loads `main.py` as backend_blueprint (lines 569-576)
4. Discovers `apps_bp = APIRouter()` (line 24 in apps/main.py)
5. Special handling: If extension name is `apps`, includes router without prefix (line 588 in app/main.py)
6. All routes in apps extension are registered at root level (e.g., `/api/apps`, `/app/{app_id}`)

### 4.2 Apps Extension Routes (app/extensions/apps/main.py)
Provides the following endpoints:

**App Management:**
- `POST /api/apps/{app_id}/open` (line 26) - Launch app and return deep-link URL with query params
- `POST /api/apps/{app_id}/start` (line 58) - Start app worker via `ensure_app_running()`
- `POST /api/apps/{app_id}/quit` (line 69) - Terminate app worker
- `POST /api/apps/{app_id}/lock` (line 91) - Lock app to prevent termination
- `POST /api/apps/{app_id}/unlock` (line 103) - Unlock app
- `GET /api/apps/running` (line 115) - List all running apps with stats
- `GET /api/apps` (line 133) - List all available apps from loaded manifests

**App Shell:**
- `GET /app/{app_id}` (line 141) - Serves app_shell.html for standard apps or redirects to NiceGUI port
  - For non-NiceGUI apps: Returns `app_shell.html` template with toolbar (Home, Reload, Recents, Lock, Quit)
  - For NiceGUI apps (like file_editor_cm6): Calls `ensure_app_running()`, waits 2 seconds, redirects to worker port

**Static Files:**
- `GET /apps/{app_dir}/{filename:path}` (line 173) - Serves app static files (JS, CSS, templates)

**Shell Logs:**
- `GET /shell-logs/{shell_id}` (line 192) - Serves shell log viewer HTML
- `WebSocket /ws/shell-logs/{shell_id}` (line 201) - Streams stdout/stderr logs for a shell

### 4.3 App Shell Template (app/templates/app_shell.html)
For non-NiceGUI apps, the app shell provides:
1. Toolbar with navigation and lifecycle controls (lines 33-165)
2. App container div for mounting app content (line 166)
3. Recents modal for switching between running apps (lines 169-177)
4. JavaScript initialization (lines 206-539):
   - Loads app definition from `/api/apps` (line 497)
   - Fetches app's frontend template from `/apps/{app_dir}/{template}` (line 505)
   - Injects template into container (line 507)
   - Dynamically imports app's frontend script (line 511)
   - Passes API helpers and host object to app (lines 512-518)
   - Host object provides: `saveState()`, `loadState()`, `clearState()`, `setTitle()`, `onBeforeExit()`, `toast()`

**Note:** file_editor_cm6 bypasses this shell because it uses NiceGUI, which provides its own UI framework.

---

## 5. App Manager: app/libs/app_manager.py

**Location:** `/data/data/com.termux/files/home/mrselect5/app/libs/app_manager.py`

**Execution Steps (when app is started):**

### 4.1 App Startup Request
Apps are started via `ensure_app_running(app_id)` function (line 152):
1. Checks if app is already running in `_RUNNING_APPS` dict (line 162)
2. If running, verifies shell is alive (lines 166-177)
3. If not running, finds app manifest from `_LOADED_APPS` (lines 187-194)
4. Extracts entrypoint configuration (lines 196-199)

### 4.2 Backend Worker Spawn (Non-NiceGUI path)
For `file_editor_cm6` which has `backend_blueprint` entrypoint:
1. Finds free port with `find_free_port()` (line 264)
2. Sets environment variables including `TE_APP_WORKER_PORT` (lines 203-206, 265)
3. Constructs command: `["python", "-m", "app.libs.app_worker", "--app-id", app_id, "--port", port, "--backend-module", backend_module_path]` (lines 267-274)
4. Calls `await manager.spawn_shell(command, label=f"app-worker:{app_id}", cwd=project_root, env=env)` (line 277)
5. Waits 1.5 seconds for startup (line 280)
6. Verifies shell is still running (lines 281-294)
7. Waits for port to become reachable (lines 296-301)
8. Registers app in `_RUNNING_APPS` dict (line 304)
9. Saves running apps to disk (line 307)
10. Registers with app_lifecycle service (line 308)

---

## 6. App Worker: app/libs/app_worker.py

**Location:** `/data/data/com.termux/files/home/mrselect5/app/libs/app_worker.py`

**Execution Steps:**
1. Entry via `main()` function (line 113)
2. Parses arguments: `--app-id`, `--port`, `--backend-module` (lines 14-18)
3. Creates FastAPI app instance (line 20)
4. Adds project root to Python path (lines 24-25)
5. Constructs module name and creates module spec (lines 27-28)
6. Loads module with `spec.loader.exec_module(module)` (line 32)
7. Searches for APIRouter with name `{app_id}_bp` (lines 36-59)
8. Includes router in FastAPI app (line 56)
9. Checks for `NICEGUI_INIT_HOOK` attribute (line 65)
10. If found, calls `nicegui_init(app)` to initialize NiceGUI (line 68)
11. Checks for `SUBAPPS` attribute for fallback mounting (lines 71-76)
12. Creates uvicorn server config (lines 93-99)
13. Sets up signal handlers (lines 102-108)
14. Calls `server.run()` to start server (line 110)

---

## 7. File Editor CM6 Backend: app/apps/file_editor_cm6/main.py

**Location:** `/data/data/com.termux/files/home/mrselect5/app/apps/file_editor_cm6/main.py`

**Important:** file_editor_cm6 is a **standard app** (not a "nicegui_shell" app). It follows the same execution pattern as all other apps, but embeds a NiceGUI editor inside an iframe in its frontend template.

**Execution Steps:**

### 7.1 Module Import (lines 1-52)
1. Adds vendor directory to Python path for NiceGUI (lines 7-9)
2. Imports FastAPI, WebSocket, and other dependencies (lines 11-52)

### 7.2 Router Creation (line 347)
Creates `file_editor_cm6_bp = APIRouter()`

### 7.3 Router Configuration (lines 354-375)
1. Includes agent routes sub-router (lines 354-355)
2. Registers static file serving endpoint (lines 358-365)
3. Includes terminal router (lines 368-369)
4. Adds WebSocket routes for agent and explorer (lines 370-371)
5. Includes nicegui_editor routes (lines 374-375)

### 7.4 NiceGUI Initialization Hook (lines 383-409)
Defines `init_nicegui_with_app(fastapi_app)` function:
1. Sets mount path to `/ui` (line 385)
2. Imports NiceGUI internal module (line 390)
3. Sets Socket.IO engine path to `/socket.io` (line 396)
   - This makes NiceGUI serve Socket.IO at `/ui/_nicegui_ws/socket.io`
   - The path is later proxied by main.py's dynamic proxy routes
4. Calls `ui.run_with(fastapi_app, mount_path=mount, storage_secret='file-editor-cm6-secret')` (lines 398-402)
   - Mounts NiceGUI as a sub-application at `/ui` on the worker's FastAPI app
   - Creates routes like `/ui/nc`, `/ui/_nicegui/{assets}`, `/ui/_nicegui_ws/socket.io/`
5. Imports page definitions from `nicegui_editor.editor_app` (line 405)

Exports hook as `NICEGUI_INIT_HOOK = init_nicegui_with_app` (line 409)

### 7.5 Module-level Initialization (lines 451-468)
1. Calls `_ensure_project_root_synced()` (line 453) to sync stored project path
2. Sets project root in edit_tracker (line 454)
3. Calls `cleanup_orphaned_sidecars()` (line 460)
4. Calls `initialize_project_session()` (line 466) which:
   - Gets active project from history store
   - Loads or creates ProjectSidecar
   - Increments session counter
   - Saves sidecar

---

## 8. NiceGUI WebSocket Proxy Routes: app/main.py

**Location:** `/data/data/com.termux/files/home/mrselect5/app/main.py`

The main framework provides dynamic proxy routes that forward NiceGUI requests from the browser to the correct app worker.

### 8.1 Referer-based App Detection (lines 1147-1167)
1. Defines regex pattern `_APP_IN_UI = re.compile(r"/api/app/([^/]+)/ui/")` (line 1153)
2. Function `_extract_app_id_from_referer(headers)` (line 1155):
   - Extracts app_id from Referer header
   - Pattern match: `/api/app/{app_id}/ui/...`
   - Falls back to `file_editor_cm6` if no Referer (lines 1178, 1230, 1282)

### 8.2 NiceGUI Static Asset Proxy (lines 1170-1218)
Route: `@app.api_route("/ui/_nicegui/{rest:path}", methods=[...])` (line 1170)
1. Extracts app_id from Referer or query params (line 1173)
2. Looks up running app port from `running_apps` dict (line 1186)
3. Forwards HTTP request to worker: `http://127.0.0.1:{port}/ui/_nicegui/{rest}` (line 1187)
4. Streams response back to client (lines 1206-1217)

### 8.3 NiceGUI Engine.IO HTTP Proxy (lines 1224-1271)
Route: `@app.api_route("/ui/_nicegui_ws/socket.io/{rest:path}", methods=[...])` (line 1224)

**Purpose:** Handles Engine.IO HTTP long-polling before WebSocket upgrade

1. Extracts app_id from Referer (line 1226)
2. Builds worker URL: `http://127.0.0.1:{port}/ui/_nicegui_ws/socket.io{rest_path}` (line 1240)
3. Forwards HTTP request with all headers and body (lines 1242-1254)
4. Streams response back to client (lines 1259-1271)

### 8.4 NiceGUI WebSocket Proxy (lines 1274-1379)
Route: `@app.websocket("/ui/_nicegui_ws/socket.io/{rest:path}")` (line 1274)

**Purpose:** Proxies Socket.IO WebSocket connections between browser and worker

**Execution Steps:**
1. Accepts WebSocket connection (line 1277)
2. Extracts app_id from Referer header (line 1279)
3. Falls back to `file_editor_cm6` if no Referer (lines 1281-1283)
4. Looks up running app port (lines 1285-1290)
5. Builds worker WebSocket URL: `ws://127.0.0.1:{port}/ui/_nicegui_ws/socket.io{rest_path}` (line 1295)
6. Preserves headers: origin, cookie, user-agent, X-Forwarded-* (lines 1299-1323)
7. Connects to worker WebSocket (lines 1328-1331)
8. Creates bidirectional forwarding:
   - `forward_client_to_worker()` (lines 1332-1350) - browser → worker
   - `forward_worker_to_client()` (lines 1352-1363) - worker → browser
9. Runs both tasks concurrently until one completes (lines 1365-1371)

**WebSocket Path Resolution:**
```
Browser iframe src: /api/app/file_editor_cm6/ui/nc
    ↓ (proxied by line 974)
Worker NiceGUI page: http://localhost:{port}/ui/nc
    ↓ (NiceGUI client connects to)
Framework proxy: /ui/_nicegui_ws/socket.io/
    ↓ (proxied by line 1295)
Worker Socket.IO: ws://localhost:{port}/ui/_nicegui_ws/socket.io/
```

### 8.5 Standard WebSocket Proxy (lines 1035-1094)
Route: `@app.websocket('/ws/app/{app_id}/{route:path}')` (line 1035)

**Purpose:** Proxies standard (non-Socket.IO) WebSocket connections to app workers

**Difference from NiceGUI WebSocket:** 
- NiceGUI uses Socket.IO protocol (requires special Engine.IO handling)
- Standard WebSockets use plain WebSocket protocol (simpler proxying)

**Execution Steps:**
1. Accepts WebSocket connection (line 1037)
2. Looks up running app port from `app_id` (lines 1041-1049)
3. Builds worker WebSocket URL: `ws://127.0.0.1:{port}/ws/{route}` (line 1053)
4. Connects to worker WebSocket (line 1058)
5. Creates bidirectional forwarding:
   - `forward_client_to_worker()` (lines 1061-1068) - browser → worker
   - `forward_worker_to_client()` (lines 1070-1077) - worker → browser
6. Runs both tasks concurrently until one completes (lines 1079-1088)

**Example: Explorer WebSocket Flow**

**Step 1: Worker Registration** (app/apps/file_editor_cm6/main.py line 371)
```python
file_editor_cm6_bp.add_api_websocket_route("/ws/explorer", explorer_websocket)
```

**Step 2: WebSocket Handler** (app/apps/file_editor_cm6/explorer_ws.py line 991)
```python
async def explorer_websocket(websocket: WebSocket):
    dispatcher = ExplorerDispatcher(websocket)
    await dispatcher.initialize()
    
    try:
        while True:
            data = await websocket.receive_text()
            await dispatcher.handle_message(data)
    except WebSocketDisconnect:
        await dispatcher.cleanup()
```

**Step 3: Frontend Connection** (app/apps/file_editor_cm6/main.js line 72)
```javascript
const wsUrl = `${protocol}//${window.location.host}/ws/app/file_editor_cm6/explorer`;
explorerSocket = new ReconnectingWebSocket(wsUrl);
```

**Step 4: Proxy Resolution**
```
Browser connects to: ws://localhost:8088/ws/app/file_editor_cm6/explorer
    ↓ (main.py line 1035 matches route)
Framework extracts: app_id="file_editor_cm6", route="explorer"
    ↓ (main.py line 1053 builds worker URL)
Framework proxies to: ws://127.0.0.1:45678/ws/explorer
    ↓ (worker FastAPI routes to handler)
Worker handler: explorer_websocket(websocket)
```

**Comparison: NiceGUI Socket.IO vs Standard WebSocket**

| Aspect | NiceGUI Socket.IO | Standard WebSocket |
|--------|-------------------|-------------------|
| Protocol | Socket.IO (Engine.IO transport) | Plain WebSocket |
| Path Pattern | `/ui/_nicegui_ws/socket.io/{rest}` | `/ws/app/{app_id}/{route}` |
| App Detection | Referer header extraction | URL path parameter `{app_id}` |
| HTTP Polling | Supported (line 1224) | N/A |
| Fallback App | `file_editor_cm6` (hardcoded) | None (requires valid `app_id`) |
| Header Preservation | Extensive (origin, cookie, UA, X-Forwarded-*) | Minimal (basic proxy) |
| Registration | NiceGUI automatic (ui.run_with) | Manual (add_api_websocket_route) |

---

## 9. NiceGUI Editor App: app/apps/file_editor_cm6/nicegui_editor/editor_app.py

**Location:** `/data/data/com.termux/files/home/mrselect5/app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

**Execution Steps:**

### 7.1 Module Imports (lines 1-27)
Imports NiceGUI, FastAPI, stores, helpers, and core functionality modules

### 7.2 NiceGUI Page Definition
When NiceGUI imports the module, it discovers and registers pages decorated with `@ui.page()`.

The main editor page is created via a page decorator that sets up:

### 7.3 Editor Initialization (lines 500-770+)
When a user navigates to the editor UI page:

1. **Query Parameter Processing:**
   - Extracts `path` from query parameters for initial file
   - Extracts `project` from query parameters for project root

2. **Project and File Setup:**
   - Gets active project from history store
   - Determines initial file path
   - Checks if path exists

3. **Cache Recovery (lines 545-588):**
   - Calls `_history_store.get_cached_document(project_path, initial_path)` to check for saved drafts
   - Determines state: "clean", "mid_session", or "crashed" based on run_id comparison
   - If cached content exists, loads it instead of disk content

4. **Content Loading:**
   - If no cache, reads file from disk using `Path(initial_path).read_text()`
   - Calculates SHA256 hash of content
   - Detects file language from extension

5. **UI Construction (lines 590-633):**
   - Adds font-face CSS for JetBrains Mono
   - Creates container divs with flex layout

6. **Editor Creation (lines 638-706):**
   - Defines `_on_editor_change` callback (lines 639-657)
   - Loads theme preference and maps to CodeMirror theme (lines 660-665)
   - Determines initial scroll line from sidecar or session state (lines 669-694)
   - Creates `ui.codemirror()` instance with:
     - Initial content (from disk or cache)
     - Language mode
     - Theme
     - Line wrapping setting
     - Font scale
     - Initial scroll position
     - Change callback
   - Stores cached content in `editor._cached_content`

7. **Global State Setup (lines 709-725):**
   - Sets `_active_editor` global to editor instance
   - Calls `set_current_file(initial_path, initial_sha256)`
   - Applies runtime preferences:
     - Zebra stripes (line 717)
     - Font scale (line 718)
     - Indent guides (line 719)
     - Color picker (line 721)
     - Read-only mode (line 722)
     - Sticky scroll (line 723)

8. **Cache State Broadcasting (lines 727-758):**
   - If cache was restored, broadcasts cache state with reason "restore"
   - If fresh load, broadcasts "clean" state with reason "init"
   - If crashed state, shows notification to user

9. **Diff Loading (lines 761-770):**
   - Calls `_get_combined_diffs(project_root, initial_path, initial_content)`
   - Collects Git diffs if `showInlineDiffs` preference enabled
   - Collects draft diffs if autosave disabled and `showDraftDiffs` enabled
   - Calls `editor.set_diff_decorations(hunks)` to display diffs

10. **File Watcher Subscription (lines 773-820+):**
    - Calls `init_watcher(project_root)` to start file watcher
    - Defines `on_file_change` callback
    - Subscribes to file changes via `subscribe(str(rel_path), client_id, on_file_change)`
    - Watcher will notify when file changes on disk
    - Callback handles cache conflict detection and content updates

---

## 10. File Opening Flow Summary

### Standard App Flow (How file_editor_cm6 Actually Works):

1. **scripts/run_framework.sh** → Generates run ID, starts IPC, executes supervisor
2. **app/supervisor.py** → Spawns main application process
3. **app/main.py** → Starts FastAPI, loads services/extensions/apps, initializes app manager
4. **User navigates to launcher (/)** → Sees list of available apps
5. **User clicks on file_editor_cm6** → Frontend calls apps extension API
6. **POST /api/apps/file_editor_cm6/start** → Apps extension (app/extensions/apps/main.py) receives request (line 58)
7. **Apps extension calls ensure_app_running()** → Delegates to app_manager.py (line 62)
8. **app/libs/app_manager.py** → Spawns app worker subprocess (line 277)
9. **app/libs/app_worker.py** → Loads backend module, calls NICEGUI_INIT_HOOK (lines 65-68)
10. **app/apps/file_editor_cm6/main.py** → Router registered, NiceGUI mounted at `/ui` on worker
11. **User navigates to /app/file_editor_cm6** → Apps extension serves app_shell.html (line 141 in apps/main.py)
12. **app_shell.html loads template.html** → Standard app loading (line 505 in app_shell.html)
13. **template.html contains iframe** → `<iframe src="/api/app/file_editor_cm6/ui/nc">` (line 1479 in template.html)
14. **Iframe src proxied to worker** → main.py line 974: `http://127.0.0.1:{port}/ui/nc`
15. **Worker serves NiceGUI page** → NiceGUI decorator executes, creates editor
16. **NiceGUI client connects WebSocket** → Connects to `/ui/_nicegui_ws/socket.io/`
17. **WebSocket proxied to worker** → main.py line 1295: `ws://127.0.0.1:{port}/ui/_nicegui_ws/socket.io/`
18. **Editor displays in iframe** → Shows file with:
    - Active project from history store (last opened project)
    - Last opened file in that project (from history store)
    - Content from cache if unsaved draft exists, else from disk
    - Scroll position from sidecar or session state
    - Theme and preferences from preferences store
    - Diff decorations from Git and/or draft changes
    - File watcher subscription for live updates

### Key Proxy Routes:

**HTTP Proxies (main.py):**
- `/api/app/{app_id}/{subpath}` (line 961) → `http://127.0.0.1:{port}/{subpath}`
- `/ui/_nicegui/{rest}` (line 1170) → `http://127.0.0.1:{port}/ui/_nicegui/{rest}`
- `/ui/_nicegui_ws/socket.io/{rest}` (line 1224) → `http://127.0.0.1:{port}/ui/_nicegui_ws/socket.io{rest}` (Engine.IO polling)

**WebSocket Proxies (main.py):**
- `/ui/_nicegui_ws/socket.io/{rest}` (line 1274) → `ws://127.0.0.1:{port}/ui/_nicegui_ws/socket.io{rest}`
- `/ws/app/{app_id}/{route}` (line 1051) → `ws://127.0.0.1:{port}/ws/{route}`

### Architecture Summary:

```
┌─────────────────────────────────────────────────────────────┐
│ Browser                                                      │
│  └─ /app/file_editor_cm6 (app_shell.html)                  │
│      └─ template.html (toolbar, explorer, menus)            │
│          └─ <iframe src="/api/app/file_editor_cm6/ui/nc">  │
│              └─ NiceGUI page (CodeMirror editor)            │
│                  └─ WebSocket: /ui/_nicegui_ws/socket.io/   │
└─────────────────────────────────────────────────────────────┘
                           ↓ (HTTP/WS proxies)
┌─────────────────────────────────────────────────────────────┐
│ Main Framework (port 8088)                                   │
│  ├─ GET /app/{app_id} → app_shell.html                     │
│  ├─ GET /apps/{app_dir}/{file} → static assets             │
│  ├─ HTTP /api/app/{app_id}/{path} → worker:{port}/{path}   │
│  ├─ HTTP /ui/_nicegui/{assets} → worker:{port}/ui/...      │
│  └─ WS /ui/_nicegui_ws/socket.io/ → worker:ws://...        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ App Worker (dynamic port, e.g. 45678)                       │
│  ├─ file_editor_cm6_bp routes (/, /read, /write, etc.)     │
│  └─ NiceGUI mounted at /ui                                  │
│      ├─ GET /ui/nc → NiceGUI page (editor)                 │
│      ├─ GET /ui/_nicegui/{assets} → NiceGUI static files   │
│      └─ WS /ui/_nicegui_ws/socket.io/ → Socket.IO server   │
└─────────────────────────────────────────────────────────────┘
```

---

## 11. Key Components and Data Flow

### Environment Variables:
- `TE_RUN_ID`: Generated in run_framework.sh, used for crash detection
- `TE_SUPERVISOR_PID`: Set in supervisor, used for shutdown
- `TE_IPC_HOST`, `TE_IPC_PORT`: IPC server configuration
- `TE_IPC_PID`: IPC server process ID
- `TE_APP_WORKER_PORT`: Port for app worker subprocess
- `TE_FRAMEWORK_SHELL_ID`, `TE_FRAMEWORK_SHELL_RUN_ID`: Shell tracking

### Persistent Storage:
- `~/.cache/te_framework/run_id`: Current run ID
- `~/.cache/te_framework/running_apps.json`: Running app workers
- `~/.cache/te_framework/ipc.pid`: IPC server PID
- `~/.cache/termux_extensions/settings.json`: Global settings
- `~/.cache/termux_extensions/state_store.json`: State storage
- `~/.cache/te_framework/logs/`: Framework shell logs
- Project-specific sidecars in `~/.cache/termux_extensions/projects/`: Session cache, tracked jobs, diff base

### Process Hierarchy:
```
run_framework.sh (bash)
  └── IPC Server (python -m app.ipc.server) [port 9123]
  └── Supervisor (python -m app.supervisor)
      └── Main Framework (python -m app.main) [port 8088]
          └── App Worker: file_editor_cm6 (python -m app.libs.app_worker) [dynamic port]
```

### Request Flow for File Opening:
```
Browser → Main Framework :8088 → Proxy → App Worker :dynamic_port → NiceGUI Page → Editor Component
```

### WebSocket Connections:
- **App-specific WebSockets** (proxied through main framework):
  - Agent: `/ws/app/file_editor_cm6/ws/agent` → worker `/ws/agent`
  - Explorer: `/ws/app/file_editor_cm6/ws/explorer` → worker `/ws/explorer`
  - File Watcher: `/api/app/file_editor_cm6/ws/read?path=...` → worker `/ws/read`
  - Edit Tracker: `/api/app/file_editor_cm6/ws/edit_tracker` → worker `/ws/edit_tracker`
- **NiceGUI Socket.IO** (dynamic proxy based on Referer):
  - Client connects to: `/ui/_nicegui_ws/socket.io/`
  - Framework extracts app_id from Referer: `/api/app/file_editor_cm6/ui/nc`
  - Framework proxies to: `ws://127.0.0.1:{worker_port}/ui/_nicegui_ws/socket.io/`
  - Worker serves: NiceGUI's Socket.IO server at that path

---

## 12. File Opening States

### State 1: Clean Load
- No cached content exists
- File read from disk
- SHA256 calculated
- No unsaved changes
- Diff decorations show Git changes only (if enabled)

### State 2: Mid-Session Restore
- Cached content exists from same run_id
- User had unsaved changes
- Cache restored to editor
- "Restored unsaved draft" notification shown
- Diff decorations show Git + draft changes

### State 3: Crash Recovery
- Cached content exists from different run_id
- Previous session crashed or was force-killed
- Cache restored to editor
- "Recovered changes from prior crash" notification shown
- Diff decorations show Git + draft changes

### State 4: External Edit Conflict
- Cached draft exists
- File modified on disk by external process
- Disk SHA256 ≠ cached base SHA256
- Cache cleared, disk content loaded
- User notified of conflict
- Diff decorations reset

---

## End of Execution Path Documentation
