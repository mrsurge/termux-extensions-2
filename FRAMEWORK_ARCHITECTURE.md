# Termux Extensions Framework - Technical Architecture Reference

**Document Version:** 1.0  
**Last Updated:** 2025-11-07  
**Framework Entry Point:** `scripts/run_framework.sh`

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Component Architecture](#component-architecture)
3. [Startup Sequence](#startup-sequence)
4. [Runtime Operation](#runtime-operation)
5. [Shutdown Sequence](#shutdown-sequence)
6. [Identified Issues](#identified-issues)
7. [Shutdown Hang Analysis](#shutdown-hang-analysis)

---

## System Overview

The Termux Extensions framework is a multi-process ASGI application that provides:
- **Extension system** for pluggable functionality modules
- **App launcher** for spawning isolated application workers
- **Framework shells** for managing long-running background processes
- **IPC microservice** for external process communication

### Process Hierarchy

```
run_framework.sh (bash)
├── IPC Server (Flask, port 9123) - Independent background process
└── Supervisor (python)
    └── Main Framework (FastAPI/Uvicorn, port 8088) - Process group leader
        ├── App Worker 1 (Uvicorn, dynamic port) - Framework shell
        ├── App Worker 2 (Uvicorn, dynamic port) - Framework shell
        └── Service Shell N (arbitrary process) - Framework shell
```

### Key Paths

| Component | Path | Description |
|-----------|------|-------------|
| Entry point | `scripts/run_framework.sh` | Bash script that orchestrates startup |
| Supervisor | `app/supervisor.py` | Process manager for main framework |
| Main app | `app/main.py` | FastAPI application with lifespan management |
| IPC server | `app/ipc/server.py` | Standalone Flask microservice |
| Framework shells | `app/libs/framework_shells.py` | Process orchestration manager |
| App manager | `app/libs/app_manager.py` | Application worker spawning |
| App lifecycle | `app/libs/app_lifecycle.py` | TTL-based cleanup and tracking |
| App worker | `app/libs/app_worker.py` | Generic worker subprocess |

### Data Directories

| Path | Purpose | Cleanup |
|------|---------|---------|
| `~/.cache/te_framework/ipc.pid` | IPC server PID | Never (stale) |
| `~/.cache/te_framework/run_id` | Current framework run ID | On shutdown |
| `~/.cache/te_framework/meta/` | Framework shell metadata | On remove_shell() |
| `~/.cache/te_framework/logs/` | Framework shell stdout/stderr | On remove_shell() |
| `~/.cache/te_framework/running_apps.json` | App worker registry | Never (dead code) |
| `~/.cache/termux_extensions/settings.json` | User settings | Persisted |

---

## Component Architecture

### 1. IPC Server (`app/ipc/server.py`)

**Technology:** Flask (synchronous) on port 9123  
**Lifecycle:** Independent daemon, can survive framework restarts  
**Purpose:** Synchronous REST API for external tools and shell scripts

#### Endpoints

| Method | Path | Purpose | Forwards To |
|--------|------|---------|-------------|
| GET | `/health` | Health check | - |
| GET | `/stream` | Server-Sent Events stream | - |
| POST | `/messages` | Broadcast to SSE listeners | - |
| POST | `/actions/shutdown` | Shutdown framework | Framework `/api/framework/runtime/shutdown` |
| POST | `/actions/agent-spawn` | Spawn agent shell | Framework `/api/internal/agents/spawn` ⚠️ MISSING |

**Source References:**
- Server implementation: `app/ipc/server.py:74-176`
- Control helpers: `app/ipc/control.py:14-37`
- Startup logic: `scripts/run_framework.sh:137-161`
- Shutdown logic: `app/supervisor.py:66-76`

#### Key Features

**SSE Broadcast Mechanism** (`server.py:26-52`)
```python
_listeners: Set[queue.Queue] = set()  # Thread-safe set of listener queues

def _broadcast(event: Dict[str, Any]):
    """Push event to all connected SSE clients"""
    with _listeners_lock:
        listeners = list(_listeners)
    for listener in listeners:
        listener.put_nowait(event)
```

**Reuse Detection** (`run_framework.sh:139-146`)
```bash
if [ -f "$IPC_PID_FILE" ]; then
    existing_pid=$(cat "$IPC_PID_FILE")
    if kill -0 "$existing_pid" 2>/dev/null; then
        export TE_IPC_PID="$existing_pid"
        echo "[run_framework] Reusing existing IPC server"
        return 0
    fi
fi
```

---

### 2. Supervisor (`app/supervisor.py`)

**Technology:** Python subprocess manager  
**Lifecycle:** Replaced by shell script via `exec`, owns main framework process group  
**Purpose:** Wrapper that spawns/monitors FastAPI app, handles graceful shutdown

**Source References:**
- Main entry: `app/supervisor.py:80-93`
- Signal handling: `app/supervisor.py:112-123`
- Cleanup: `app/supervisor.py:126-151`

#### Responsibilities

1. **Ensure single run ID** - Creates or reuses `TE_RUN_ID` (`supervisor.py:24-28`)
2. **Spawn main framework** - Launches FastAPI in new process group (`supervisor.py:91-95`)
3. **Handle signals** - SIGTERM/SIGINT trigger graceful shutdown (`supervisor.py:112-123`)
4. **Force kill timeout** - SIGKILL after grace period (`supervisor.py:136-141`)
5. **Cleanup framework shells** - Best-effort termination (`supervisor.py:32-54, 142`)
6. **Stop IPC server** - Signal IPC process (`supervisor.py:66-76`)

#### Signal Flow

```
User: Ctrl+C (SIGINT) or kill -TERM
  ↓
supervisor._handle_signal(signum)
  ├─→ shutting_down = True
  ├─→ os.killpg(proc.pid, SIGTERM)           # Kill FastAPI group
  ├─→ if SIGINT: _schedule_force_kill()       # 10-second timer
  └─→ if SIGTERM: _stop_ipc_server(SIGTERM)   # Immediate IPC kill

After proc.wait() returns:
  ├─→ _safe_cleanup_wrapper()                 # Cleanup shells (⚠️ RACE)
  ├─→ _stop_ipc_server(SIGTERM)
  └─→ Remove run_id file
```

---

### 3. Main Framework (`app/main.py`)

**Technology:** FastAPI with Uvicorn (async) on port 8088  
**Lifecycle:** Managed by supervisor, dies with supervisor  
**Purpose:** Core API server, extension host, app proxy

**Source References:**
- Lifespan: `app/main.py:30-79`
- App proxy: `app/main.py:902-943`
- WebSocket proxy: `app/main.py:945-972`

#### Lifespan Events

**Startup** (`main.py:32-58`)
```python
@asynccontextmanager
async def lifespan(app_instance):
    # 1. Load settings from disk
    _apply_settings_to_config()
    
    # 2. Import all service modules (app/libs/*.py)
    load_services()
    
    # 3. Load and register extensions (app/extensions/*/manifest.json)
    _loaded_extensions = load_extensions()
    
    # 4. Load app manifests (app/apps/*/manifest.json)
    loaded_apps = load_apps()
    app_manager._LOADED_APPS = loaded_apps
    
    # 5. Attempt to restore app workers from disk (⚠️ BROKEN)
    await initialize_running_apps()
    
    # 6. Start log monitor thread
    _log_monitor_thread = _start_framework_shell_log_monitor()
    
    # 7. Start background cleanup task
    start_background_tasks()
    
    yield  # Framework runs...
```

**Shutdown** (`main.py:60-79`)
```python
    # Shutdown triggered by supervisor SIGTERM
    
    # 1. Terminate all tracked app workers
    manager = await get_manager()
    await app_lifecycle.shutdown_lifecycle(manager)
    
    # 2. Force-kill ALL framework shells (⚠️ RACE with supervisor)
    shells = await manager.list_shells()
    for shell in shells:
        await manager.terminate_shell(shell.id, force=True, timeout=2.0)
```

#### Extension Loading

**Process** (`main.py:642-685`)
```python
def load_extensions():
    extensions = []
    for ext_name in os.listdir('app/extensions'):
        # Load manifest
        manifest = json.load(open(f'app/extensions/{ext_name}/manifest.json'))
        
        # Import backend_blueprint if defined
        backend_file = manifest.get('entrypoints', {}).get('backend_blueprint')
        if backend_file:
            module = importlib.import_module(f"app.extensions.{ext_name}.{backend_file}")
            
            # Register FastAPI router
            for obj in dir(module):
                if isinstance(obj, APIRouter):
                    if ext_name == 'apps':
                        app.include_router(obj)  # No prefix for apps extension
                    else:
                        app.include_router(obj, prefix=f"/api/ext/{ext_name}")
    return extensions
```

**Special Case:** The `apps` extension is mounted without prefix, making its routes appear at `/api/apps/...` instead of `/api/ext/apps/...`.

---

### 4. Framework Shells (`app/libs/framework_shells.py`)

**Technology:** Async subprocess orchestration with asyncio  
**Purpose:** Manages long-running background processes (app workers, services)

**Source References:**
- Manager class: `framework_shells.py:113-899`
- Singleton: `framework_shells.py:910-960`
- API routes: `framework_shells.py:963-1050`

#### FrameworkShellManager

**Responsibilities:**
1. Spawn processes with pty or redirect stdout/stderr
2. Track metadata in `~/.cache/te_framework/meta/{shell_id}/meta.json`
3. Log output to `~/.cache/te_framework/logs/{shell_id}.{stdout,stderr}.log`
4. Enforce resource limits (max_app_shells, max_service_shells)
5. Terminate/restart/remove shells on demand
6. Sweep for dead processes and update status

**Key Methods:**

| Method | Location | Purpose |
|--------|----------|---------|
| `spawn_shell()` | `framework_shells.py:603-651` | Launch subprocess with redirected I/O |
| `spawn_shell_pty()` | `framework_shells.py:653-699` | Launch with pty for interactive shells |
| `terminate_shell()` | `framework_shells.py:749-785` | SIGTERM → wait → SIGKILL |
| `remove_shell()` | `framework_shells.py:802-816` | Terminate + delete metadata |
| `list_shells()` | `framework_shells.py:578-585` | Get all tracked shells |
| `sweep()` | `framework_shells.py:818-825` | Update status of dead processes |
| `_adopt_orphaned_shells()` | `framework_shells.py:148-165` | ⚠️ COMMENTED OUT |

**Shell Record Structure:**
```python
@dataclass
class ShellRecord:
    id: str                    # fs_{timestamp}_{random}
    command: List[str]         # Argv
    label: Optional[str]       # Human-readable identifier
    cwd: str                   # Working directory
    env_overrides: Dict        # Additional env vars
    pid: Optional[int]         # Process ID (None if not started)
    status: str                # pending|running|exited
    created_at: float          # Unix timestamp
    updated_at: float          # Unix timestamp
    autostart: bool            # Restart on crash (unused)
    stdout_log: str            # Path to stdout log
    stderr_log: str            # Path to stderr log
    exit_code: Optional[int]   # Exit status (None if running)
    run_id: Optional[str]      # TE_RUN_ID when created
    launcher_pid: Optional[int]# Supervisor PID
    adopted: bool              # Adopted from previous run
    uses_pty: bool             # PTY vs redirected I/O
```

**Environment Variables Set:**
```python
def _prepare_env(self, record: ShellRecord) -> Dict[str, str]:
    env = os.environ.copy()
    env.update({
        "TE_RUN_ID": record.run_id,
        "TE_FRAMEWORK_SHELL_RUN_ID": record.run_id,
        "TE_FRAMEWORK_LAUNCHER_PID": str(self.launcher_pid),
        "TE_SESSION_TYPE": "framework",  # Distinguishes from interactive sessions
        "TE_FRAMEWORK_SHELL_ID": record.id,
        "TE_FRAMEWORK_SHELL_ADOPTED": "1" if record.adopted else "0",
        **record.env_overrides
    })
    return env
```

#### Singleton Pattern

**Implementation** (`framework_shells.py:910-960`)
```python
_manager_instance: Optional[FrameworkShellManager] = None

async def get_manager() -> FrameworkShellManager:
    global _manager_instance
    if _manager_instance is None:
        async with get_manager._lock:  # Per-function lock
            if _manager_instance is None:
                # Read settings
                max_app_shells = get_setting("TE_MAX_APP_SHELLS", 5)
                max_service_shells = get_setting("TE_MAX_SERVICE_SHELLS", 5)
                
                # Create instance
                instance = FrameworkShellManager(
                    base_dir=Path("~/.cache/te_framework"),
                    max_app_shells=int(max_app_shells),
                    max_service_shells=int(max_service_shells),
                    auth_token=os.getenv("TE_FRAMEWORK_SHELL_TOKEN"),
                    run_id=os.getenv("TE_RUN_ID"),
                )
                
                # ⚠️ Orphan adoption disabled
                # await instance._adopt_orphaned_shells()
                
                _manager_instance = instance
    return _manager_instance
```

**Issue:** `_adopt_orphaned_shells()` is commented out in `__init__` (`framework_shells.py:137`), preventing recovery from framework crashes.

---

### 5. Apps Extension (`app/extensions/apps/`)

**Technology:** FastAPI blueprint  
**Purpose:** Application launcher UI and worker orchestration

**Source References:**
- Backend API: `extensions/apps/main.py:1-254`
- Frontend UI: `extensions/apps/main.js:1-75`
- Template: `extensions/apps/template.html`

#### API Endpoints

| Method | Path | Purpose | Implementation |
|--------|------|---------|----------------|
| GET | `/api/apps` | List available apps | `extensions/apps/main.py:106-110` |
| GET | `/api/apps/running` | List running workers | `extensions/apps/main.py:85-101` |
| POST | `/api/apps/{id}/start` | Spawn app worker | `extensions/apps/main.py:27-36` |
| POST | `/api/apps/{id}/quit` | Terminate worker | `extensions/apps/main.py:38-58` |
| POST | `/api/apps/{id}/lock` | Prevent auto-cleanup | `extensions/apps/main.py:60-71` |
| POST | `/api/apps/{id}/unlock` | Allow auto-cleanup | `extensions/apps/main.py:73-83` |
| GET | `/app/{id}` | Render app shell | `extensions/apps/main.py:112-140` |
| GET | `/apps/{dir}/{file}` | Serve app assets | `extensions/apps/main.py:142-158` |

#### App Spawning Flow

**Trigger:** User clicks app in launcher → `POST /api/apps/{app_id}/start`

**Sequence:**
```
1. extensions/apps/main.py:start_app()
     ↓
2. app_manager.ensure_app_running(app_id)
     ├─ Check if already running in _RUNNING_APPS dict
     ├─ If yes: Verify shell alive, return existing
     └─ If no: Continue to spawn...
     ↓
3. Find app manifest in _LOADED_APPS (loaded at startup)
     ↓
4. Allocate free port with find_free_port()
     ↓
5. Build worker command:
     command = [
         "python", "-m", "app.libs.app_worker",
         "--app-id", app_id,
         "--port", str(port),
         "--backend-module", "app/apps/{app_id}/main.py"
     ]
     ↓
6. Spawn framework shell:
     manager = await get_framework_shell_manager()
     shell = await manager.spawn_shell(
         command,
         label=f"app-worker:{app_id}",
         cwd=project_root,
         env={"PYTHONPATH": project_root}
     )
     ↓
7. Wait for port to become reachable (timeout 10s)
     await _wait_for_port(port, host="127.0.0.1")
     ↓
8. Register in tracking systems:
     _RUNNING_APPS[app_id] = {"port": port, "shell_id": shell.id}
     _save_running_apps()  # ⚠️ Broken persistence
     await app_lifecycle.register_app(app_id, shell.id, port)
     ↓
9. Return app_info to client
```

**App Worker Implementation** (`app/libs/app_worker.py:1-81`)
```python
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-id", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--backend-module", required=True)
    args = parser.parse_args()
    
    app = FastAPI()
    
    # Dynamically import app's backend module
    module_name = f"app.apps.{args.app_id}.{Path(args.backend_module).stem}"
    spec = importlib.util.spec_from_file_location(module_name, args.backend_module)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    
    # Find APIRouter named {app_id}_bp
    expected_router_name = f"{args.app_id}_bp"
    for obj_name in dir(module):
        obj = getattr(module, obj_name)
        if isinstance(obj, APIRouter) and obj_name == expected_router_name:
            app.include_router(obj)
            break
    else:
        raise RuntimeError(f"No router '{expected_router_name}' found")
    
    # Start uvicorn
    uvicorn.run(app, host='127.0.0.1', port=args.port)
```

**App Proxying** (`main.py:902-943`)

All app traffic is proxied through the framework:
```
Client request: /api/app/{app_id}/{subpath}
  ↓
Framework: Lookup app_id in running_apps
  ↓
Forward to: http://127.0.0.1:{worker_port}/{subpath}
  ↓
Worker: Handle request
  ↓
Framework: Stream response back to client
```

Implementation uses `httpx.AsyncClient` with 30-second timeout.

---

### 6. App Lifecycle (`app/libs/app_lifecycle.py`)

**Technology:** Async background task  
**Purpose:** TTL-based cleanup of unlocked app workers

**Source References:**
- Lifecycle task: `app_lifecycle.py:23-50`
- Registration: `app_lifecycle.py:72-83`
- Termination: `app_lifecycle.py:130-143`

#### In-Memory State

```python
_running_apps: Dict[str, Dict] = {
    "fs_1234_abcd5678": {
        "app_id": "file_editor_cm6",
        "shell_id": "fs_1234_abcd5678",
        "port": 8091,
        "created_at": 1699381234.567,
        "locked": False  # Prevents TTL cleanup if True
    }
}
```

#### Background Cleanup Task

**Implementation** (`app_lifecycle.py:23-50`)
```python
async def _background_cleanup():
    while True:
        await asyncio.sleep(60)  # Poll every minute
        
        manager = await get_framework_shell_manager()
        app_ttl_seconds = get_setting("APP_TTL_SECONDS", 1800)  # Default 30 min
        
        async with _get_lock():
            now = time.time()
            stale_apps = []
            
            for shell_id, app_info in list(_running_apps.items()):
                if not app_info.get("locked"):
                    age = now - app_info.get("created_at", now)
                    if age > app_ttl_seconds:
                        stale_apps.append(shell_id)
            
            for shell_id in stale_apps:
                await terminate_app(manager, shell_id)
```

**Startup:** `start_background_tasks()` called from framework lifespan (`main.py:59`)

---

## Startup Sequence

### Phase 1: Shell Script (`scripts/run_framework.sh`)

**Lines 27-54:** Parse command-line arguments
```bash
REQUESTED_MODE="broadcast"  # or "local"
EXTRA_ARGS=()

while [ "$#" -gt 0 ]; do
    case "$1" in
        --run-local) REQUESTED_MODE="local" ;;
        --broadcast) REQUESTED_MODE="broadcast" ;;
        *) EXTRA_ARGS+=("$1") ;;
    esac
    shift
done

export TE_RUN_MODE="$REQUESTED_MODE"
```

**Lines 58-64:** Generate run ID
```bash
generate_run_id_if_needed() {
    if [ -z "${TE_RUN_ID:-}" ]; then
        export TE_RUN_ID="$(generate_run_id)"  # run_{timestamp}_{random}
    fi
}
```

**Lines 94-131:** Check for existing supervisor
```bash
supervisor_running() {
    pid=$(pgrep -f "python -m app.supervisor" || true)
    [ -n "$pid" ]
}

if supervisor_running; then
    # Attempt to switch bind mode via API
    if request_mode_switch; then
        exit 0  # Reuse existing framework
    fi
    echo "Existing supervisor detected but bind switch failed; starting fresh."
fi
```

**Lines 137-161:** Start IPC server
```bash
start_ipc_server() {
    local existing_pid=""
    if [ -f "$IPC_PID_FILE" ]; then
        existing_pid="$(cat "$IPC_PID_FILE")"
        if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
            export TE_IPC_PID="$existing_pid"
            echo "[run_framework] Reusing existing IPC server (pid $existing_pid)"
            return 0
        fi
        rm -f "$IPC_PID_FILE"
    fi
    
    echo "[run_framework] Starting IPC server on $IPC_HOST:$IPC_PORT"
    TE_FRAMEWORK_URL="${TE_FRAMEWORK_URL:-http://127.0.0.1:8088}" \
    IPC_LOG_PREFIX=1 \
    python -m app.ipc.server --host "$IPC_HOST" --port "$IPC_PORT" &
    TE_IPC_PID=$!
    export TE_IPC_PID
    
    mkdir -p "$(dirname "$IPC_PID_FILE")"
    echo "$TE_IPC_PID" > "$IPC_PID_FILE"
}

start_ipc_server
```

**Line 163:** Execute supervisor (replaces shell process)
```bash
exec python -m app.supervisor "${EXTRA_ARGS[@]}"
```

---

### Phase 2: Supervisor (`app/supervisor.py`)

**Lines 80-88:** Setup
```python
def run(argv: List[str]) -> int:
    run_id = _ensure_run_id()  # Create or reuse from env
    os.environ.setdefault("TE_SUPERVISOR_PID", str(os.getpid()))
    
    # Write run ID to cache file
    RUN_ID_FILE.parent.mkdir(parents=True, exist_ok=True)
    RUN_ID_FILE.write_text(run_id)
```

**Lines 91-95:** Spawn FastAPI
```python
    cmd = [sys.executable, "-m", "app.main", *argv]
    proc = subprocess.Popen(cmd, preexec_fn=os.setsid)  # New process group
```

**Lines 122-123:** Setup signal handlers
```python
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
```

**Lines 126-130:** Wait for exit
```python
    try:
        exit_code = proc.wait()
    except KeyboardInterrupt:
        _handle_signal(signal.SIGINT, None)
        exit_code = proc.wait()
```

---

### Phase 3: FastAPI App (`app/main.py`)

**Lines 32-67:** Lifespan startup
```python
@asynccontextmanager
async def lifespan(app_instance):
    print("--- Loading Settings ---")
    _apply_settings_to_config()  # ⚠️ No-op function
    
    print("--- Loading Services ---")
    load_services()  # Import all app/libs/*.py modules
    
    print("--- Loading Extensions ---")
    global _loaded_extensions, loaded_apps
    _loaded_extensions = load_extensions()  # Scan app/extensions/
    
    print("--- Loading Apps ---")
    loaded_apps = load_apps()  # Scan app/apps/
    app_manager._LOADED_APPS = loaded_apps  # Store for spawning
    
    print("--- Restoring Running Apps ---")
    await initialize_running_apps()  # ⚠️ Broken restoration logic
    
    print("--- Starting Framework Shell Log Monitor ---")
    _log_monitor_thread = _start_framework_shell_log_monitor()
    
    print("--- Starting Lifecycle Background Tasks ---")
    start_background_tasks()  # TTL cleanup loop
    
    yield  # Application runs
    
    # Shutdown happens below...
```

**Lines 83-88:** Mount static files and blueprints
```python
app = FastAPI(lifespan=lifespan)

static_dir = os.path.join(os.path.dirname(__file__), 'static')
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

app.include_router(bookmarks_bp, prefix="/api")
app.include_router(framework_shells_bp)  # Mounted at /api/framework_shells
app.include_router(jobs_bp, prefix="/api")
```

**First API Call:** When first request arrives, `get_manager()` dependency creates FrameworkShellManager singleton.

---

## Runtime Operation

### Request Flow

```
Client (Browser/curl)
  ↓ HTTP/WebSocket
┌─────────────────────────────────────────┐
│ FastAPI App (port 8088)                 │
│                                         │
│ Routes:                                 │
│ • /api/apps/* ────────────────────────→ Apps Extension
│ • /api/app/{id}/* ─────────────────────→ App Proxy → Worker
│ • /api/framework_shells/* ─────────────→ Shell Manager API
│ • /api/ext/{ext}/* ────────────────────→ Other Extensions
│ • /static/* ───────────────────────────→ Static Files
│ • / ───────────────────────────────────→ index.html
└─────────────────────────────────────────┘
  ↓ (if /api/app/{id}/*)
┌─────────────────────────────────────────┐
│ App Worker (dynamic port)               │
│ • Uvicorn server                        │
│ • FastAPI app with {app_id}_bp router  │
│ • Runs as framework shell               │
└─────────────────────────────────────────┘
```

### App Request Example

**User opens file editor:**

1. Browser: `GET /app/file_editor_cm6`
2. Apps extension: Check if worker running
   - If not: Spawn via `ensure_app_running()`
   - Wait for port reachable
3. Apps extension: Render `app_shell.html` template
4. Browser: Loads app's `main.js`
5. JavaScript: Makes requests to `/api/app/file_editor_cm6/*`
6. Framework: Proxies to `http://127.0.0.1:{worker_port}/*`
7. Worker: Handles request, returns response
8. Framework: Streams response back to browser

### Framework Shell Operations

**Spawn shell:**
```python
manager = await get_manager()
shell = await manager.spawn_shell(
    command=["python", "script.py"],
    label="my-service",
    cwd="/path/to/dir",
    env={"KEY": "value"}
)
# Returns ShellRecord with id, pid, status
```

**Monitor shell:**
```python
shells = await manager.list_shells()
for shell in shells:
    details = await manager.describe(shell, include_logs=True, tail_lines=50)
    print(f"{shell.label}: {shell.status} (pid {shell.pid})")
```

**Terminate shell:**
```python
await manager.terminate_shell(shell_id, force=False, timeout=5.0)
# Sends SIGTERM, waits up to 5s, then SIGKILL if needed
```

**Remove shell:**
```python
await manager.remove_shell(shell_id, force=True)
# Terminates + deletes metadata and logs
```

---

## Shutdown Sequence

### Trigger

User presses **Ctrl+C** or sends **SIGTERM** to supervisor process.

### Timeline

```
T+0ms:   Signal arrives at supervisor
T+10ms:  supervisor._handle_signal() fires
           ├─ Sets shutting_down flag
           ├─ os.killpg(proc.pid, SIGTERM) → Kills FastAPI group
           └─ Schedules force-kill timer (SIGINT only)

T+50ms:  FastAPI receives SIGTERM
           └─ Uvicorn begins graceful shutdown
             └─ Stops accepting new connections
             └─ Waits for in-flight requests to complete

T+100ms: FastAPI lifespan shutdown begins
           ├─ app_lifecycle.shutdown_lifecycle()
           │   ├─ Iterates _running_apps
           │   └─ manager.terminate_shell(shell_id, force=True) for each
           └─ Cleanup all framework shells
               ├─ manager.list_shells()  [ACQUIRES manager._lock]
               └─ manager.terminate_shell(shell_id, force=True) for each

T+200ms: FastAPI process exits
           └─ proc.wait() returns in supervisor

T+210ms: Supervisor cleanup begins
           ├─ _safe_cleanup_wrapper()  [⚠️ RACE CONDITION]
           │   └─ asyncio.run(_cleanup_framework_shells())
           │       ├─ Creates NEW event loop
           │       ├─ manager = await get_manager()
           │       └─ manager.list_shells()  [TRIES to acquire manager._lock]
           ├─ _stop_ipc_server(SIGTERM)
           └─ Remove run_id file

T+220ms: Supervisor exits
```

### Parallel Cleanup Paths (Race Condition)

**Path A: FastAPI Lifespan** (`main.py:60-79`)
```python
# Shutdown lifecycle apps
await app_lifecycle.shutdown_lifecycle(manager)
  └─ await terminate_all_apps(manager)
    └─ for shell_id in _running_apps.keys():
          await manager.terminate_shell(shell_id, force=True)

# Cleanup framework shells  
shells = await manager.list_shells()  # Acquires lock
for shell in shells:
    await manager.terminate_shell(shell.id, force=True, timeout=2.0)
```

**Path B: Supervisor Cleanup** (`supervisor.py:32-54, 142`)
```python
async def _cleanup_framework_shells():
    manager = await get_manager()
    shells = await manager.list_shells()  # Tries to acquire lock
    for shell in shells:
        await manager.terminate_shell(shell.id, force=True)

def _safe_cleanup_wrapper():
    try:
        loop = asyncio.get_running_loop()
        asyncio.create_task(_cleanup_framework_shells())  # Fire-and-forget!
    except RuntimeError:
        asyncio.run(_cleanup_framework_shells())  # New event loop
```

**Problem:** Both paths try to cleanup the same shells simultaneously, causing:
- Duplicate SIGKILL signals to same PIDs
- Race conditions accessing shell metadata files
- Potential deadlock if both acquire `manager._lock` from different event loops

### Force Kill Timer (SIGINT Only)

**Implementation** (`supervisor.py:98-109, 118`)
```python
def _schedule_force_kill():
    def _worker():
        time.sleep(10.0)  # Wait 10 seconds
        if proc.poll() is not None:
            return  # Process already exited
        print("[supervisor] Graceful shutdown timed out; forcing cleanup")
        _safe_cleanup_wrapper()
        _kill_process_group(proc.pid, signal.SIGKILL)
        _stop_ipc_server(signal.SIGKILL)
    
    threading.Thread(target=_worker, daemon=True).start()

# Only scheduled for SIGINT:
if signum == signal.SIGINT:
    _schedule_force_kill()
```

**Issue:** SIGTERM does not schedule force-kill timer, so framework can hang indefinitely if graceful shutdown fails.

### IPC Server Shutdown

**Implementation** (`supervisor.py:66-76`)
```python
def _stop_ipc_server(sig: signal.Signals = signal.SIGTERM):
    ipc_pid = os.environ.get("TE_IPC_PID")
    if not ipc_pid:
        return
    try:
        os.kill(int(ipc_pid), sig)
        print(f"[supervisor] Sent {sig.name} to IPC server pid {ipc_pid}")
    except ProcessLookupError:
        pass  # Already dead
```

**Issue:** If IPC server was reused from previous run (shared), sending signal affects other framework instances.

---

## Identified Issues

### Critical Issues (🔴)

#### Issue #1: Race Condition - Dual Cleanup Paths
**Locations:** `supervisor.py:142`, `main.py:69-79`

**Description:** Both supervisor and FastAPI lifespan attempt to cleanup framework shells simultaneously after FastAPI exits.

**Impact:**
- Duplicate SIGKILL signals to same processes
- Race conditions on metadata file access
- Potential deadlock with `manager._lock` across event loops
- Confusing duplicate log messages

**Root Cause:** Supervisor doesn't trust FastAPI lifespan to cleanup completely, so adds redundant cleanup.

**Fix:** Remove `_safe_cleanup_wrapper()` from supervisor. Let FastAPI lifespan handle all cleanup exclusively.

---

#### Issue #2: Orphaned Shell Adoption Disabled
**Location:** `framework_shells.py:137`

**Description:** 
```python
def __init__(self, ...):
    # ... setup ...
    # self._adopt_orphaned_shells()  # COMMENTED OUT
```

**Impact:**
- If framework crashes (not graceful shutdown), shells keep running
- Metadata becomes stale on next startup
- No automatic recovery from crashes
- Accumulation of zombie processes over time

**Fix:** Uncomment and test adoption logic, or implement periodic sweep in background task.

---

#### Issue #3: Missing Agent Spawn Endpoint
**Location:** `app/ipc/control.py:32`

**Description:** IPC server's `/actions/agent-spawn` forwards to `/api/internal/agents/spawn`, which doesn't exist in framework.

**Impact:**
- Agent spawning via IPC is completely broken
- Returns 404 or 502 to clients
- External tools cannot spawn agents

**Fix:** Implement `/api/internal/agents/spawn` endpoint in framework, or remove IPC endpoint.

---

#### Issue #4: Shared IPC Server Across Restarts
**Location:** `scripts/run_framework.sh:139-146`

**Description:** IPC server is reused if PID file exists and process is alive, allowing multiple frameworks to share one IPC.

**Impact:**
- Shutdown request affects all frameworks sharing IPC
- Messages broadcast to wrong framework
- PID file becomes stale if IPC crashes
- No namespace isolation between runs

**Fix:** Include run_id in PID file, refuse to reuse if run_id doesn't match, or make IPC per-framework.

---

### Important Issues (⚠️)

#### Issue #5: Force Kill Timer Only on SIGINT
**Location:** `supervisor.py:118`

**Description:**
```python
if signum == signal.SIGINT:
    _schedule_force_kill()
else:
    _stop_ipc_server(signal.SIGTERM)
```

**Impact:** SIGTERM does not schedule force-kill timer. If graceful shutdown hangs, framework never exits.

**Fix:** Schedule force-kill timer for both SIGINT and SIGTERM with same timeout.

---

#### Issue #6: Async Cleanup in Sync Context
**Location:** `supervisor.py:45-54`

**Description:**
```python
try:
    loop = asyncio.get_running_loop()
    asyncio.create_task(_cleanup_framework_shells())  # Fire-and-forget
except RuntimeError:
    asyncio.run(_cleanup_framework_shells())  # Creates new loop
```

**Impact:**
- If loop exists, task is created but not awaited
- Supervisor exits immediately, killing cleanup task
- Only RuntimeError path (new loop) actually waits for completion

**Fix:** Use `asyncio.run_coroutine_threadsafe()` and wait for result, or remove entirely (see Issue #1).

---

#### Issue #7: App Worker Restoration Logic Broken
**Location:** `app_manager.py:19-56`

**Description:** Tries to restore app workers from disk on framework startup.

**Impact:**
- Workers are framework shells (children of supervisor)
- When supervisor dies, ALL children die (process group termination)
- Restoration will never find live workers after framework restart
- File persists stale data indefinitely

**Fix:** Remove restoration logic and file persistence, or implement persistent worker pool outside supervisor's process group.

---

#### Issue #8: No Authentication on IPC Endpoints
**Location:** `app/ipc/server.py`

**Description:** Only `/actions/shutdown` and `/actions/agent-spawn` forward framework auth token. `/messages` and `/stream` have no authentication.

**Impact:**
- Local privilege escalation vector
- Any process on localhost can broadcast messages
- Information disclosure via SSE stream

**Fix:** Add authentication to all endpoints, or document that IPC is localhost-only trusted service.

---

#### Issue #9: IPC Uses Sync Flask, Framework Uses Async FastAPI
**Location:** `app/ipc/server.py` vs `app/main.py`

**Description:** IPC is synchronous Flask with threading, framework is async FastAPI. IPC calls framework with blocking `requests.post()`.

**Impact:**
- IPC requests can block entire Flask thread
- No backpressure handling
- Thread pool exhaustion if framework is slow

**Fix:** Migrate IPC to async (aiohttp/FastAPI) or use thread pool executor for framework calls.

---

### Minor Issues (🟡)

#### Issue #10: CORS Wildcard on IPC
**Location:** `app/ipc/server.py:58-62`

```python
response.headers["Access-Control-Allow-Origin"] = "*"
```

**Impact:** Any website can call IPC from browser if bound to 0.0.0.0.

**Fix:** Restrict CORS to localhost or remove entirely.

---

#### Issue #11: SSE Stream Has No Max Listeners
**Location:** `app/ipc/server.py:31`

```python
_listeners: Set[queue.Queue] = set()  # Unbounded
```

**Impact:** Memory exhaustion via many `/stream` connections.

**Fix:** Limit max concurrent listeners, implement backpressure.

---

#### Issue #12: IPC PID File Never Cleaned
**Location:** `scripts/run_framework.sh:157`

**Description:** PID written to file but never deleted on shutdown.

**Impact:** Stale PID causes false reuse attempts on next startup.

**Fix:** Add cleanup in supervisor shutdown, or implement PID staleness check.

---

#### Issue #13: Lock State Not Persisted
**Location:** `app_lifecycle.py`

**Description:** App lock state stored in memory only, lost on framework restart.

**Impact:** User-locked apps treated as unlocked after restart.

**Fix:** Persist lock state to disk or mark as locked in shell metadata.

---

#### Issue #14: No Resource Limits Per-App
**Location:** `app/libs/app_manager.py`

**Description:** Apps can spawn unlimited framework shells, no CPU/memory quotas.

**Impact:** Rogue app can exhaust system resources.

**Fix:** Implement per-app shell limits, cgroups, or resource monitoring.

---

#### Issue #15: Proxy Timeout Hardcoded
**Location:** `main.py:927`

```python
resp = await client.request(..., timeout=30.0)
```

**Impact:** Long-running operations (file uploads) fail after 30 seconds.

**Fix:** Make timeout configurable per-app or per-route.

---

#### Issue #16: WebSocket Proxy Fragile
**Location:** `main.py:945-972`

**Description:** No ping/pong keepalive, no automatic reconnection.

**Impact:** Connection drops leave orphaned state.

**Fix:** Implement WebSocket heartbeat, reconnection logic.

---

#### Issue #17: Uvicorn Workers Lack Signal Handlers
**Location:** `app/libs/app_worker.py:76`

```python
uvicorn.run(app, host='127.0.0.1', port=args.port)
# No signal handlers, no graceful shutdown timeout
```

**Impact:** Workers ignore SIGTERM, wait indefinitely for requests to complete.

**Fix:** Add signal handlers, configure `timeout_graceful_shutdown`.

---

#### Issue #18: Settings Loading is No-Op
**Location:** `main.py:194-200`

```python
def _apply_settings_to_config():
    """Legacy function - settings now read directly via get_setting()."""
    pass
```

**Description:** Function called but does nothing. Settings read on-demand via `get_setting()`.

**Impact:** Misleading function name suggests configuration happening at startup.

**Fix:** Remove function or rename to `_log_settings_loaded()`.

---

## Shutdown Hang Analysis

### Problem Statement

When app workers are running during framework shutdown, the process may **hang indefinitely** instead of completing within the expected grace period. This section analyzes three probable root causes based on the architecture.

---

### Possibility #1: App Worker Ignores SIGTERM, Waits for Graceful Uvicorn Shutdown

**Affected Component:** App workers spawned by `app_manager.py`

**Theory:**

When supervisor sends SIGTERM to the FastAPI process group (`supervisor.py:116`), the signal propagates to all children including app workers. However:

1. **Uvicorn's default shutdown behavior:**
   - Stops accepting new connections
   - Waits for all in-flight requests to complete
   - Only exits when all handlers return
   - **No timeout** on graceful shutdown

2. **If an app has long-running handlers:**
   - WebSocket connections (e.g., file editor live updates)
   - Server-Sent Events streams
   - Long-polling requests
   - Large file uploads

3. **Shutdown sequence:**
   - Supervisor sends SIGTERM → Uvicorn starts graceful shutdown
   - Uvicorn waits indefinitely for active requests
   - Supervisor times out after 1 second (`supervisor.py:136`)
   - Supervisor sends SIGKILL to process group
   - But process may be in uninterruptible sleep (I/O wait)

**Evidence:**

```python
# app/libs/app_worker.py:76
uvicorn.run(app, host='127.0.0.1', port=args.port)
# No timeout_graceful_shutdown parameter
# No signal handlers registered
```

**Reproduction Scenario:**

```
1. User opens file_editor_cm6 app
2. Editor establishes WebSocket for live file updates
3. User switches away but doesn't close editor tab
4. WebSocket connection remains open
5. User presses Ctrl+C on framework terminal
6. SIGTERM sent → Uvicorn begins graceful shutdown
7. Uvicorn waits for WebSocket.close() which never comes
8. Supervisor times out → sends SIGKILL
9. Process dies but cleanup races cause hang
```

**Call Stack During Hang:**

```
App Worker Process (pid 12345)
  ├─ uvicorn.run()
  │   └─ Server.serve()
  │       └─ lifespan.shutdown()
  │           └─ wait_for_tasks()  ← Waiting here
  │               └─ WebSocket.receive()  ← Active connection
  │
  └─ SIGTERM handler: <default> → begins graceful shutdown
  └─ SIGKILL arrives after 1s → forces exit
```

**Why It Causes Framework Hang:**

- FastAPI lifespan shutdown (`main.py:60-79`) runs BEFORE worker terminates
- Lifespan tries to `terminate_shell(worker_shell_id, force=True)`
- But worker is stuck in Uvicorn shutdown, not responding
- `terminate_shell()` sends SIGKILL, but process already received it from supervisor
- Race condition on cleanup causes deadlock or indefinite wait

**Fix:**

```python
# app/libs/app_worker.py
import signal
import sys

def handle_shutdown(signum, frame):
    print(f"[Worker] Received signal {signum}, forcing immediate shutdown", file=sys.stderr)
    sys.exit(0)  # Hard exit, no graceful cleanup

signal.signal(signal.SIGTERM, handle_shutdown)
signal.signal(signal.SIGINT, handle_shutdown)

uvicorn.run(
    app,
    host='127.0.0.1',
    port=args.port,
    timeout_graceful_shutdown=2,  # Max 2 seconds for graceful shutdown
)
```

---

### Possibility #2: Framework Proxy Has Open Connection to Dead Worker

**Affected Component:** App proxy in `main.py:902-943`

**Theory:**

When an app worker dies during active request proxying, the framework's httpx connection can hang:

1. **Request in progress:**
   - Client makes request to `/api/app/{app_id}/some_endpoint`
   - Framework proxy opens connection to worker via httpx
   - Worker begins streaming response

2. **Worker receives SIGTERM:**
   - Worker dies mid-response (see Possibility #1)
   - TCP connection breaks without proper FIN handshake
   - Framework proxy holds broken httpx connection

3. **Connection cleanup hangs:**
   - httpx AsyncClient tries to cleanup connection pool
   - TCP socket stuck in CLOSE_WAIT state
   - Connection cleanup waits for TCP timeout (120s default)
   - Framework shutdown blocked waiting for proxy to finish

**Evidence:**

```python
# app/main.py:927-943
async with httpx.AsyncClient() as client:
    resp = await client.request(
        method=request.method,
        url=url,
        params=request.query_params,
        headers=headers,
        content=body,
        timeout=30.0,  # Only applies to request, not cleanup
    )
    
    return StreamingResponse(
        resp.iter_bytes(chunk_size=10240),  # Streaming response
        status_code=resp.status_code,
        headers=resp_headers,
    )
# AsyncClient.__aexit__ waits for connection pool cleanup
```

**Reproduction Scenario:**

```
1. User opens file_editor_cm6 app
2. User requests large file: GET /api/app/file_editor_cm6/files/large.txt
3. Worker begins streaming response (10MB file)
4. After 2MB sent, user presses Ctrl+C on framework
5. SIGTERM arrives → worker dies immediately (no graceful shutdown)
6. Framework proxy has open StreamingResponse
7. resp.iter_bytes() raises ConnectionError
8. AsyncClient tries to cleanup broken connection
9. TCP socket stuck in CLOSE_WAIT waiting for FIN
10. Framework lifespan shutdown blocked waiting for proxy cleanup
```

**Call Stack During Hang:**

```
Framework Process (main.py)
  ├─ Lifespan shutdown
  │   └─ await manager.terminate_shell(worker_shell_id)
  │       └─ os.killpg(worker_pid, SIGKILL)
  │           └─ Worker dies
  │
  └─ Parallel: proxy_app_request() still executing
      └─ async with httpx.AsyncClient() as client:
          └─ client.__aexit__()  ← Waiting here
              └─ pool.aclose()
                  └─ connection.aclose()
                      └─ socket.wait_for(FIN)  ← TCP CLOSE_WAIT
```

**Why It Causes Framework Hang:**

- Framework lifespan shutdown and active proxy handlers run simultaneously
- Lifespan kills worker → proxy connection breaks
- httpx waits for TCP FIN from worker that will never come
- Python's asyncio TCP cleanup has 120-second timeout by default
- Framework hangs for up to 120 seconds

**TCP State Diagram:**

```
Framework Socket          Worker Socket
─────────────────────────────────────────
ESTABLISHED    ←────────→  ESTABLISHED
                           ↓ SIGKILL arrives
ESTABLISHED    ←────────→  (process dies)
↓ Detects broken pipe
CLOSE_WAIT     ← - - - -   (orphaned socket)
↓ Waiting for FIN...
↓ Timeout after 120s
CLOSED
```

**Fix:**

```python
# app/main.py
# Option 1: Per-request client (closes immediately)
async def proxy_app_request(...):
    running_apps = await get_running_apps()
    if app_id not in running_apps:
        raise HTTPException(status_code=503)
    
    port = running_apps[app_id]['port']
    url = f"http://127.0.0.1:{port}/{subpath}"
    
    # Create client per-request with aggressive timeout
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(30.0, connect=5.0, pool=5.0)
    ) as client:
        try:
            resp = await client.request(...)
            return StreamingResponse(...)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Worker unreachable")

# Option 2: Global client with keepalive limits
httpx_client = httpx.AsyncClient(
    timeout=30.0,
    limits=httpx.Limits(
        max_connections=100,
        max_keepalive_connections=10,
        keepalive_expiry=5.0,  # Close idle connections quickly
    )
)
```

---

### Possibility #3: Race Condition Between Dual Cleanup Paths Creates Deadlock

**Affected Components:** `supervisor.py:142`, `main.py:69-79`, `framework_shells.py:140`

**Theory:**

The dual cleanup paths (Issue #1) create a deadlock scenario involving asyncio.Lock across different event loops:

1. **FastAPI lifespan shutdown starts** (in main event loop):
   ```python
   # main.py:71-79
   shells = await manager.list_shells()  # Acquires manager._lock
   for shell in shells:
       await manager.terminate_shell(shell.id, force=True)
   ```

2. **Simultaneously, supervisor cleanup runs** (in separate thread):
   ```python
   # supervisor.py:142
   _safe_cleanup_wrapper()
     → asyncio.run(_cleanup_framework_shells())  # Creates NEW event loop
       → manager = await get_manager()  # Returns singleton
         → await manager.list_shells()  # Tries to acquire manager._lock
   ```

3. **Deadlock mechanism:**
   - Thread A (FastAPI main loop): Holds `manager._lock`, iterating shells
   - Thread B (Supervisor cleanup): Tries to acquire same `manager._lock` in different event loop
   - asyncio.Lock is bound to specific event loop - **cannot be shared**
   - Results in undefined behavior, typically hangs both threads

**Evidence:**

```python
# framework_shells.py:139-143
def _get_lock(self):
    """Get or create the instance lock (lazy initialization)."""
    if not hasattr(self, '_lock_instance'):
        self._lock_instance = asyncio.Lock()  # Per-INSTANCE lock
    return self._lock_instance

# Both cleanup paths access SAME manager instance
# But asyncio.Lock cannot be used across event loops
```

**Reproduction Scenario:**

```
1. App worker running (file_editor_cm6)
2. User presses Ctrl+C
3. SIGTERM arrives at supervisor
4. Supervisor signals FastAPI process group
5. FastAPI lifespan shutdown begins:
   - Acquires manager._lock in event loop A
   - Begins iterating shells
   - Calls terminate_shell(app_worker_id)
   - Sends SIGKILL to worker
   - Waits for worker exit...
6. FastAPI process exits (proc.wait() returns)
7. Supervisor cleanup begins:
   - Calls asyncio.run() → creates event loop B
   - Tries to acquire manager._lock
   - DEADLOCK: Lock held by loop A, which is shutting down
8. Supervisor hangs forever
```

**Call Stack During Deadlock:**

```
Thread A (FastAPI Lifespan)
  └─ async with manager._lock:  [ACQUIRED]
      └─ for shell in shells:
          └─ await terminate_shell(shell.id)
              └─ os.killpg(shell.pid, SIGKILL)
                  └─ await asyncio.sleep(0.1)  ← Waiting in cleanup loop

Thread B (Supervisor Cleanup)
  └─ asyncio.run(_cleanup_framework_shells())
      └─ async with manager._lock:  [BLOCKED]
          └─ Waiting for Thread A to release lock...
              └─ But Thread A's event loop is shutting down
```

**Why It Causes Framework Hang:**

- asyncio.Lock is NOT thread-safe across event loops
- Lock acquired in event loop A cannot be released in event loop B
- Both threads wait indefinitely
- Supervisor cannot complete shutdown
- Framework process hangs until killed externally

**Additional Complication:**

```python
# supervisor.py:49-54
def _safe_cleanup_wrapper():
    try:
        loop = asyncio.get_running_loop()
        asyncio.create_task(_cleanup_framework_shells())  # Fire-and-forget!
    except RuntimeError:
        asyncio.run(_cleanup_framework_shells())  # New loop
```

If running loop exists (Uvicorn still alive), `create_task()` fires without waiting. Task gets cancelled when Uvicorn exits, leaving cleanup incomplete.

**Fix:**

**Option 1 (Recommended):** Remove duplicate cleanup from supervisor entirely.

```python
# supervisor.py:142
# _safe_cleanup_wrapper()  # DELETE THIS LINE
_stop_ipc_server(signal.SIGTERM)
```

Let FastAPI lifespan handle ALL framework shell cleanup exclusively. Supervisor only needs to kill process group and cleanup IPC.

**Option 2:** Use threading.Lock instead of asyncio.Lock for cross-thread safety.

```python
# framework_shells.py:139-143
import threading

def _get_lock(self):
    if not hasattr(self, '_lock_instance'):
        self._lock_instance = threading.Lock()  # Thread-safe
    return self._lock_instance

# But this requires making all manager methods sync, defeating async benefits
```

**Option 3:** Make supervisor wait for FastAPI lifespan to complete before attempting cleanup.

```python
# supervisor.py:136-142
if proc.poll() is None:
    time.sleep(1.0)  # Give FastAPI lifespan time to cleanup
    if proc.poll() is None:
        print("[supervisor] Forcing shutdown")
        _kill_process_group(proc.pid, signal.SIGKILL)

# Only cleanup if FastAPI failed to
if proc.poll() != 0:
    _safe_cleanup_wrapper()
```

---

## Root Cause Summary

The shutdown hang with running app workers is caused by **combination of all three possibilities:**

1. **Uvicorn workers wait indefinitely** for long-running requests (WebSocket, uploads) because no signal handlers or graceful timeout configured
2. **Proxy connections orphaned** when workers die mid-stream, httpx TCP cleanup waits up to 120s for FIN
3. **Dual cleanup creates deadlock** between supervisor and FastAPI lifespan using same asyncio.Lock across different event loops

**Recommended fixes in priority order:**

1. **Remove supervisor cleanup** (`supervisor.py:142`) - Eliminates deadlock (Possibility #3)
2. **Add worker signal handlers** (`app_worker.py`) - Prevents indefinite wait (Possibility #1)
3. **Use per-request httpx clients** (`main.py`) - Avoids connection pool hangs (Possibility #2)
4. **Schedule force-kill for SIGTERM** (`supervisor.py:118`) - Provides timeout safety net (Issue #5)

---

## Appendix: Environment Variables Reference

| Variable | Default | Set By | Used By | Purpose |
|----------|---------|--------|---------|---------|
| `TE_RUN_ID` | `run_{ts}_{rand}` | `run_framework.sh` | All components | Unique framework run identifier |
| `TE_RUN_MODE` | `broadcast` | `run_framework.sh` | Framework | Bind mode (local/broadcast) |
| `TE_SUPERVISOR_PID` | - | `supervisor.py` | Framework | Supervisor process ID for shutdown |
| `TE_IPC_PID` | - | `run_framework.sh` | Supervisor | IPC server process ID |
| `TE_IPC_HOST` | `127.0.0.1` | User | IPC server | IPC bind address |
| `TE_IPC_PORT` | `9123` | User | IPC server | IPC bind port |
| `TE_FRAMEWORK_URL` | `http://127.0.0.1:8088` | User | IPC server | Main framework URL |
| `TE_FRAMEWORK_SHELL_TOKEN` | - | User | Framework/IPC | Auth token for internal APIs |
| `TE_SESSION_TYPE` | `framework` | Shell manager | Shells | Distinguishes shell type |
| `TE_FRAMEWORK_SHELL_ID` | - | Shell manager | Shells | Shell identifier |
| `TE_MAX_APP_SHELLS` | `5` | Settings/env | Shell manager | Max app worker limit |
| `TE_MAX_SERVICE_SHELLS` | `5` | Settings/env | Shell manager | Max service shell limit |
| `IPC_LOG_PREFIX` | `1` | `run_framework.sh` | IPC server | Enable `[ipc]` log prefix |

---

**End of Document**
