# Framework Startup to File Editor CM6 App - Runtime Path Analysis

## Executive Summary

This document traces the complete programmatic flow from starting the framework via `scripts/run_framework.sh` to loading and using the `file_editor_cm6` app. The analysis is based on source code inspection without external documentation.

---

## 1. Framework Initialization Path

### 1.1 Script Entry Point: `scripts/run_framework.sh`

**Location**: `scripts/run_framework.sh`

**Process**:
1. Parses command-line arguments (`--run-local` or `--broadcast`)
2. Sets `TE_RUN_MODE` environment variable
3. Generates a unique `TE_RUN_ID` (format: `run_{timestamp}_{uuid}`)
4. Checks if supervisor is already running; if so, attempts mode switch via REST API
5. **Starts IPC Server** (lines 166-190):
   - Checks for existing IPC server via PID file at `~/.cache/te_framework/ipc.pid`
   - If not running, spawns: `python -m app.ipc.server --host 127.0.0.1 --port 9123`
   - Stores PID in `TE_IPC_PID` environment variable
6. **Executes Supervisor**: `python -m app.supervisor` (line 192)

**Potential Issues**:
- **Issue #1**: If IPC server crashes during framework operation, there's no automatic restart mechanism
- **Issue #2**: PID file cleanup on forced shutdown may be incomplete, leading to stale PIDs

---

### 1.2 Supervisor Layer: `app/supervisor.py`

**Location**: `app/supervisor.py`

**Process**:
1. Ensures `TE_RUN_ID` exists (fallback generation if missing)
2. Sets `TE_SUPERVISOR_PID` environment variable
3. Writes run ID to `~/.cache/te_framework/run_id`
4. **Spawns Main Application**: `python -m app.main` (line 93)
   - Uses `os.setsid()` to create new process group
5. Sets up signal handlers (SIGTERM, SIGINT)
6. Monitors main app process with graceful/forced shutdown logic (10-second timeout)
7. On shutdown:
   - Cleans up framework shell logs (unless forced shutdown)
   - Stops IPC server
   - Removes run ID file

**Potential Issues**:
- **Issue #3**: The 10-second forced shutdown timeout is hardcoded; long-running cleanup operations may be killed prematurely
- **Issue #4**: If supervisor itself crashes, no orphaned process cleanup occurs

---

### 1.3 Main Application: `app/main.py`

**Location**: `app/main.py`

**Process**: The main application uses FastAPI with a lifespan context manager for startup/shutdown.

#### 1.3.1 Startup Sequence (lines 34-57)

1. **Load Settings** (`_apply_settings_to_config()`):
   - Reads from `~/.cache/termux_extensions/settings.json`
   - Note: Function is actually a no-op stub (line 210-212)

2. **Load Services** (`load_services()`):
   - Scans `app/libs/` directory
   - Imports all `.py` files (except `__init__`)
   - Registers job handlers and other service modules

3. **Load Extensions** (`load_extensions()`, lines 536-587):
   - Scans `app/extensions/` for directories with `manifest.json`
   - For each extension:
     - Loads manifest
     - If `entrypoints.backend_blueprint` exists:
       - Dynamically imports backend module
       - Searches for `APIRouter` instances
       - Registers router with `/api/ext/{ext_name}` prefix
       - **Special case**: Extension named "apps" gets no prefix
   - Captures and stores load errors in manifest metadata

4. **Load Apps** (`load_apps()`, lines 596-616):
   - Scans `app/apps/` for directories with `manifest.json`
   - Loads app metadata only (no blueprint registration at this stage)
   - Stores in `loaded_apps` list
   - **Important**: Apps don't auto-register routes like extensions do

5. **Restore Running Apps** (`initialize_running_apps()`):
   - Calls `app_manager._load_running_apps()`
   - Reads `~/.cache/te_framework/running_apps.json`
   - Validates that saved app workers are still alive
   - Adopts orphaned workers (those with label `app-worker:{app_id}` but not in saved state)

6. **Start Framework Shell Log Monitor**:
   - Background thread monitoring `~/.cache/te_framework/logs/`
   - Detects Python tracebacks in framework shell logs
   - Prints to console for debugging

7. **Start Lifecycle Background Tasks**:
   - Periodic cleanup of terminated app workers
   - Resource monitoring for running apps

**Potential Issues**:
- **Issue #5**: Settings loading is a no-op stub; old architecture remnant
- **Issue #6**: Extension load errors are silently stored in manifest but not logged to console
- **Issue #7**: App blueprints are never registered during main.py load; apps must be fully on-demand

---

## 2. Extension System and App Launcher

### 2.1 Apps Extension: `app/extensions/apps/`

**Location**: `app/extensions/apps/main.py`

This extension provides the app launcher UI and management endpoints.

**Key Routes**:
- `GET /api/apps` - Returns list of available apps
- `POST /api/apps/{app_id}/start` - Starts an app worker
- `POST /api/apps/{app_id}/quit` - Terminates an app worker
- `POST /api/apps/{app_id}/lock` - Locks app (prevents auto-termination)
- `GET /api/apps/running` - Lists running apps with stats
- `GET /app/{app_id}` - Renders app shell HTML

**Blueprint Registration**:
- Because extension directory is named "apps", it gets registered with **no prefix** (line 576 in main.py)
- Routes are available directly (e.g., `/api/apps` not `/api/ext/apps/api/apps`)

---

## 3. User Clicks "Code Viewer (CM6)" in Launcher

### 3.1 Frontend: Launcher UI (`app/extensions/apps/template.html` + `main.js`)

**User Action**: Clicks on an app tile (e.g., "Code Viewer (CM6)")

**Frontend Flow**:
1. Launcher fetches app list from `GET /api/apps`
2. User clicks app tile with `app.id = "file_editor_cm6"`
3. Frontend navigates to: `GET /app/file_editor_cm6`

---

### 3.2 App Shell Rendering: `/app/{app_id}`

**Location**: `app/extensions/apps/main.py`, line 110-140

**Process**:
1. Looks up app manifest from loaded apps list
2. Checks for `entrypoints.nicegui_shell`:
   - If true: Starts NiceGUI worker and redirects to dedicated port
   - If false: Renders `app/templates/app_shell.html`
3. For file_editor_cm6 (non-NiceGUI):
   - Returns `app_shell.html` with `app_id` injected as JSON

**Potential Issues**:
- **Issue #8**: NiceGUI apps redirect after a fixed 2-second delay; no readiness check
- **Issue #9**: Template uses string replacement instead of proper templating engine

---

### 3.3 App Shell Template: `app/templates/app_shell.html`

**Location**: `app/templates/app_shell.html`

**Frontend Initialization** (lines 467-500):
1. Extracts `app_id` from embedded JSON script tag
2. Creates `host` API object for app:
   - `host.saveState()` / `host.loadState()` - Persistent state management
   - `host.setTitle()` - Set window title
   - `host.onBeforeExit()` - Register cleanup handler
   - `host.toast()` - Show notifications
3. Fetches app manifest from `GET /api/apps`
4. **Loads app template**: `GET /apps/{app._dir}/{frontend_template}`
5. Injects template HTML into `#app-container`
6. **Loads app script**: Dynamic import of `/apps/{app._dir}/{frontend_script}`
7. Calls `module.default(appContainer, api, host)` to initialize app

**App-Level API**:
- `api.get(endpoint)` → `GET /api/app/{app_id}/{endpoint}`
- `api.post(endpoint, body)` → `POST /api/app/{app_id}/{endpoint}`
- `api.delete(endpoint)` → `DELETE /api/app/{app_id}/{endpoint}`

**Potential Issues**:
- **Issue #10**: App scripts are loaded with `Cache-Control: no-cache` but browser may still cache aggressively
- **Issue #11**: No error boundary; app init errors crash entire shell

---

## 4. App Backend Worker Spawning

### 4.1 On-Demand Backend: App Proxy Routes

**Location**: `app/main.py`, lines 949-1005

**Process**:
When frontend makes first request to `/api/app/file_editor_cm6/*`:

1. **Check Running Apps**: Looks up `app_id` in `_RUNNING_APPS` dict (line 953)
2. **If not running**: Returns HTTP 503 error
   - Frontend must call `POST /api/apps/file_editor_cm6/start` first
3. **If running**: Proxies request to worker's local port

**Critical Discovery**:
- **App workers are NOT auto-started on first request**
- User must explicitly start app via launcher or API call
- Proxy is "dumb" - just forwards HTTP/WebSocket traffic

**Potential Issues**:
- **Issue #12**: No built-in auto-start on proxy miss; 503 errors likely if user bookmarks app URL
- **Issue #13**: Worker health checks are passive; proxy only fails when connection refused

---

### 4.2 App Worker Lifecycle: `app/libs/app_manager.py`

**Location**: `app/libs/app_manager.py`

**Function**: `ensure_app_running(app_id)`

**Process**:
1. **Check Cache**: If `app_id` in `_RUNNING_APPS`:
   - Verify shell is still running via framework shell manager
   - If alive: return cached info
   - If dead: remove from cache and restart

2. **Find Manifest**: Search `_LOADED_APPS` for matching app

3. **Spawn Worker**:
   - **For NiceGUI apps** (lines 208-258):
     - Allocate free port
     - Run: `python app/apps/nicegui_shell/worker.py --module app.apps.{app_dir}.{nicegui_module}`
     - Wait 1.5 seconds
     - Verify shell is running and port is reachable (10-second timeout)
   
   - **For standard apps** (lines 260-309):
     - Allocate free port
     - Run: `python -m app.libs.app_worker --app-id {app_id} --port {port} --backend-module {backend_path}`
     - Wait 1.5 seconds
     - Verify shell is running and port is reachable

4. **Register App**:
   - Add to `_RUNNING_APPS` dict
   - Save to persistent file: `~/.cache/te_framework/running_apps.json`
   - Register with lifecycle service for monitoring

**Potential Issues**:
- **Issue #14**: Fixed 1.5-second startup delay is arbitrary; slow apps may fail health check
- **Issue #15**: Port allocation uses ephemeral OS port; potential conflicts if many apps start simultaneously
- **Issue #16**: Worker crashes after startup won't be detected until next request

---

### 4.3 File Editor CM6 Worker: `app/apps/file_editor_cm6/main.py`

**Location**: `app/apps/file_editor_cm6/main.py`

**Blueprint**: `file_editor_cm6_bp = APIRouter()`

**Key Components**:
1. **Core File Operations**:
   - `GET /read?path=...` - Read file contents with SHA256 hash
   - `POST /write` - Atomic file write with optional conflict detection
   - `WebSocket /ws/read?path=...` - Real-time file change notifications

2. **Project Management**:
   - `POST /project/open` - Set active project directory
   - `GET /project/current` - Get current project path

3. **Git Integration**:
   - `GET /git/branches` - List branches
   - `POST /git/checkout` - Switch branches
   - `POST /git/commit` - Commit changes
   - `GET /git/status` - Get working tree status

4. **State Management**:
   - `GET /state` - Consolidated editor state (project, recent files, preferences)
   - `POST /state/file_activity` - Record file access for recents list
   - `GET /preferences` - User preferences
   - `POST /preferences` - Update preferences

5. **Advanced Features**:
   - `GET /diff?path=...` - Git diff hunks for file
   - `GET /explorer/list?rel=...` - Directory listing
   - `WebSocket /ws/agent` - AI agent communication
   - Terminal backend routes (embedded terminal emulator)

**Startup Behavior** (lines 69-73):
- On module import, syncs project root from persistent storage
- Initializes edit tracker with project root
- No explicit server startup code (handled by app_worker)

---

## 5. Worker Process Architecture

### 5.1 Standard App Worker: `app/libs/app_worker.py`

**Invocation**: `python -m app.libs.app_worker --app-id file_editor_cm6 --port {PORT} --backend-module {PATH}`

**Process**:
1. Dynamically imports backend module
2. Extracts `APIRouter` instance from module
3. Creates FastAPI app and mounts router at `/`
4. Starts Uvicorn server on allocated port
5. Binds to `0.0.0.0` (configurable via `TE_APP_WORKER_HOST`)

**Key Point**: Worker is a standalone ASGI process with its own event loop, completely isolated from main framework.

**Potential Issues**:
- **Issue #17**: Workers bind to 0.0.0.0 by default; potential security risk if ports are exposed
- **Issue #18**: No graceful shutdown handler; SIGTERM immediately terminates workers

---

## 6. Request Flow: User Opens File in Editor

### 6.1 Frontend Request

**Action**: User clicks "Open File" in file_editor_cm6

**Request**: `POST /api/app/file_editor_cm6/project/open`

**Path**:
1. Browser → Main Framework (port 8088)
2. Main Framework Proxy (`app/main.py:949`) → Worker (ephemeral port)
3. Worker APIRouter (`file_editor_cm6_bp`) → Route handler
4. Route handler → File system / Git operations
5. Response flows back through proxy to browser

---

### 6.2 WebSocket Connections

**Example**: File change notifications

**Request**: `WebSocket /ws/app/file_editor_cm6/read?path=...`

**Path**:
1. Browser → Main Framework (port 8088)
2. Main Framework WebSocket Proxy (`app/main.py:1023`) establishes connection
3. Proxy opens WebSocket to worker: `ws://127.0.0.1:{PORT}/ws/read?path=...`
4. **Bidirectional forwarding**: Proxy bridges browser ↔ worker
5. Worker uses watchdog file system watcher to detect changes
6. Changes pushed via WebSocket through proxy to browser

**Potential Issues**:
- **Issue #19**: WebSocket proxy has no ping/pong keepalive; connections may time out on mobile networks
- **Issue #20**: File watcher initialization happens on first WebSocket connection (lazy); may miss early changes

---

## 7. IPC Server Role

### 7.1 Purpose and Architecture

**Location**: `app/ipc/server.py`

**Role**: Provides out-of-band control plane for:
- Termux shell integration (commands from shell prompt)
- Agent communication (AI agents running in separate processes)
- Framework control without depending on main ASGI event loop

**Key Features**:
1. **REST Endpoints**: `/api/agent/spawn`, `/api/framework/control`
2. **WebSocket Routes**: Real-time agent communication
3. **SSE Streams**: Broadcast events to listeners
4. **Module Loading**: Dynamically loads IPC modules from apps (line 81-120)

**File Editor CM6 IPC Module**: `app/apps/file_editor_cm6/ipc_stack/`
- Registers agent-specific IPC handlers
- Allows agents to communicate with editor backend

**Potential Issues**:
- **Issue #21**: No authentication on IPC endpoints beyond optional token; security risk if exposed

---

## 8. Summary of Critical Path Components

### Startup Chain
```
run_framework.sh
  ↓
IPC Server (Flask, port 9123)
  ↓
supervisor.py
  ↓
app.main (FastAPI, port 8088)
  ↓ (lifespan startup)
Load Extensions → Load Apps → Restore Running Apps
```

### App Launch Chain
```
User clicks launcher tile
  ↓
GET /app/file_editor_cm6
  ↓
Render app_shell.html
  ↓ (frontend JS)
Import /apps/file_editor_cm6/main.js
  ↓
App initialization (UI setup)
  ↓ (on user action)
POST /api/apps/file_editor_cm6/start
  ↓
ensure_app_running()
  ↓
Spawn framework shell: python -m app.libs.app_worker
  ↓
Worker starts Uvicorn on allocated port
  ↓
Register in _RUNNING_APPS and lifecycle service
```

### Request Flow
```
Browser: POST /api/app/file_editor_cm6/project/open
  ↓
Main Framework Proxy (app/main.py)
  ↓
Worker APIRouter (file_editor_cm6_bp)
  ↓
Route handler: project_open()
  ↓
File system operations
  ↓
Response back through proxy
```

---

## 9. Identified Issues Summary

### High Priority
1. **Issue #7**: Apps never register blueprints during startup; completely on-demand architecture not clearly documented
2. **Issue #12**: No auto-start on proxy miss leads to confusing 503 errors
3. **Issue #14**: Fixed startup delays may cause false negatives for slow-starting apps
4. **Issue #17**: Workers bind to 0.0.0.0 by default; security concern

### Medium Priority
5. **Issue #1**: IPC server has no restart mechanism if it crashes
6. **Issue #6**: Extension load errors are silently stored but not logged
7. **Issue #10**: Aggressive browser caching despite no-cache headers
8. **Issue #16**: Worker crashes after startup won't be detected until next request
9. **Issue #19**: WebSocket proxy lacks keepalive mechanism

### Low Priority
11. **Issue #3**: Hardcoded 10-second forced shutdown timeout
12. **Issue #5**: Settings loading is a no-op stub (legacy code)
13. **Issue #8**: NiceGUI redirect uses fixed delay instead of readiness probe
14. **Issue #15**: Ephemeral port allocation may conflict under load
15. **Issue #20**: Lazy file watcher initialization may miss early file changes

---

## 10. Architecture Observations

### Strengths
1. **Process Isolation**: Each app runs in its own process with isolated event loop
2. **Resource Efficiency**: Workers are on-demand and can be terminated when idle
3. **Modular Design**: Extensions and apps are self-contained with clear boundaries
4. **Transparent Proxy**: Main framework acts as reverse proxy, hiding worker ports from clients

### Weaknesses
1. **Startup Complexity**: 3+ processes (script → supervisor → main → IPC) before apps can run
2. **Silent Failures**: Many error conditions are logged but not surfaced to users
3. **State Distribution**: Running apps tracked in memory, on disk, and in lifecycle service (3 sources of truth)

### Design Patterns
1. **On-Demand Activation**: Apps spawn only when needed
2. **Manager-Worker Pattern**: Main framework manages worker processes via framework shell manager
3. **Proxy Gateway**: Single entry point (port 8088) for all app traffic
4. **Discovery via Manifests**: Extensions and apps declare capabilities in manifest.json

---

## Conclusion

The framework exhibits a sophisticated multi-process architecture optimized for resource efficiency and process isolation. The primary complexity lies in the startup sequence and the on-demand worker spawning system. The file_editor_cm6 app demonstrates a full-featured worker with WebSocket support, file watching, and Git integration.

The most significant architectural concern is the proliferation of process coordination mechanisms (supervisor, framework shell manager, lifecycle service, IPC server) which may increase maintenance burden and failure modes.

**Document generated**: 2025-11-09  
**Framework version**: ASGI migration (FastAPI-based)  
**Analysis scope**: Source code only, no runtime testing
