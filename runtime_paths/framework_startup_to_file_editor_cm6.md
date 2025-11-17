# Framework Execution Trace: Startup → File Edit → Shutdown

## 1. STARTUP SEQUENCE

### scripts/run_framework.sh
- **Entry**: `bash scripts/run_framework.sh [--run-local|--broadcast]`
- **Variables Set**:
  - `TE_RUN_MODE`: "broadcast" or "local"
  - `TE_RUN_ID`: Generated via `generate_run_id()` → `run_{timestamp}_{uuid}`
  - `REPO_ROOT`: Repository root path
  - `IPC_HOST`, `IPC_PORT`: IPC server connection details (default 127.0.0.1:9123)
- **Actions**:
  1. `cleanup_framework_shell_logs()` → Archives leftover logs to `~/.cache/te_framework/preserved_logs/`
  2. `start_ipc_server()` → Spawns `python -m app.ipc.server` (PID stored in `~/.cache/te_framework/ipc.pid`)
  3. `exec python -m app.supervisor` → Replaces shell with supervisor

### app/supervisor.py
- **Entry**: `supervisor.run()`
- **Variables Set**:
  - `RUN_ID_FILE`: `~/.cache/te_framework/run_id`
  - `TE_SUPERVISOR_PID`: Current process PID
- **Actions**:
  1. Writes `TE_RUN_ID` to run_id file
  2. Spawns `python -m app.main` via `subprocess.Popen(preexec_fn=os.setsid)`
  3. Registers signal handlers: `SIGTERM`, `SIGINT` → `_handle_signal()`
  4. Waits on subprocess

### app/main.py
- **Entry**: FastAPI app with `lifespan()` context manager
- **Variables Set**:
  - `RUN_ID`: From `TE_RUN_ID` env var
  - `SETTINGS_FILE`: `~/.cache/termux_extensions/settings.json`
  - `STATE_STORE_FILE`: `~/.cache/termux_extensions/state_store.json`
  - `FRAMEWORK_LOG_ROOT`: `~/.cache/te_framework/logs`
- **Actions**:
  1. **Lifespan startup**:
     - `register_process()` → Registers with IPC server (type="framework")
     - `load_services()` → Imports modules from `app/libs/`
     - `load_extensions()` → Loads extensions from `app/extensions/`
     - `load_apps()` → Scans `app/apps/*/manifest.json`, stores in `loaded_apps`
     - `initialize_running_apps()` → Restores previously running apps
     - `_start_framework_shell_log_monitor()` → Starts `FrameworkShellLogMonitor` thread
     - `start_background_tasks()` → Starts lifecycle tasks
  2. Mounts FastAPI routers:
     - `bookmarks_bp` → `/api`
     - `framework_shells_bp` → Routes for shell management
     - `jobs_bp` → `/api`
  3. Uvicorn server runs on `0.0.0.0:8088`

### app/libs/app_manager.py
- **Function**: `ensure_app_running(app_id)`
- **Actions**:
  1. Checks `_running_apps` dict for existing worker
  2. If not running, spawns via `app/libs/app_worker.py`:
     - Finds free port
     - Registers with IPC (type="worker")
     - Spawns: `python -m app.libs.app_worker --app-id={app_id} --port={port} --backend-module={module_path}`
  3. Returns port number

### app/libs/app_worker.py
- **Entry**: `main()` with args: `--app-id`, `--port`, `--backend-module`
- **Actions**:
  1. Creates FastAPI app
  2. Imports backend module (e.g., `app.apps.file_editor_cm6.main`)
  3. Locates `{app_id}_bp` router (e.g., `file_editor_cm6_bp`)
  4. Calls `NICEGUI_INIT_HOOK(app)` if present → Initializes NiceGUI with Socket.IO
  5. Starts uvicorn on `127.0.0.1:{port}`

### app/apps/file_editor_cm6/main.py
- **Router**: `file_editor_cm6_bp` (APIRouter)
- **Initialization**:
  - Imports singletons: `_history_store`, `_preferences_store`
  - `_ensure_project_root_synced()` → Syncs project root from history
  - `set_project_root()` → Sets in-memory root
  - `edit_tracker.set_project_root()` → Tracks edits per project
- **Key Variables**:
  - `project_root`: Current working directory for file operations
  - `_history_store`: Manages recent files, active project, session cache
  - `_preferences_store`: Editor preferences per project

## 2. FILE OPEN → EDIT → SAVE FLOW

### Client Opens File
**Request**: `GET /api/app/file_editor_cm6/read?path={file_path}`

**Route Handler**: `file_editor_cm6_bp.get('/read')`
- **Function**: `read_file(path)`
- **Actions**:
  1. `_expand_and_validate_path(path)` → Validates within `~`
  2. Reads file content
  3. `_get_file_meta(path)` → Computes SHA256 hash
  4. Returns: `{"ok": True, "data": {"path", "content", "sha256"}}`

### Client Edits File (In-Memory)
- Editor maintains local state with:
  - `content`: Current text
  - `base_sha256`: SHA256 from initial read
  - `unsaved`: True

### Client Saves File
**Request**: `POST /api/app/file_editor_cm6/write`
**Body**: `{"path", "content", "base": {"sha256"}, "client_id", "op_id"}`

**Route Handler**: `file_editor_cm6_bp.post('/write')`
- **Function**: `write_file_route(data)`
- **Actions**:
  1. `get_project_root()` → Retrieves current project root
  2. `_normalize_rel_path(project_root, path)` → Converts to relative path
  3. `init_watcher(project_root)` → Starts file watcher if needed
  4. **Core Save**: `write_full(project_root, rel_path, content, base_sha256=base_sha256)`
     - **File**: `app/apps/file_editor_cm6/core_write.py`
     - **Function**: `write_full()`
     - **Steps**:
       a. `_get_file_meta(target_path)` → Get current file SHA256
       b. If `base_sha256` provided: Check for conflicts
          - Mismatch? → Raise `BaseMismatchError`
       c. Create temp file in same directory: `tempfile.NamedTemporaryFile()`
       d. Write content to temp file
       e. `os.fsync(tmp.fileno())` → Flush to disk
       f. `os.replace(tmp_path, target_path)` → Atomic rename
       g. `os.fsync(dir_fd)` → Sync directory
       h. Return new file metadata (SHA256, size, mtime)
  5. Clear session cache: `_history_store.clear_cached_document()`
  6. `emit_diff_changed()` → Notify subscribers of file change
  7. `push_save_ack(client_id, op_id)` → ACK to client
  8. `mark_git_cache_dirty()` → Invalidate git status cache
  9. Return: `{"ok": True, "data": {"sha256", "size", "mtime"}}`

**Key Functions**:
- **core_write.py**:
  - `write_full()`: Atomic write with conflict detection
  - `_get_file_meta()`: SHA256 hash computation
  - `BaseMismatchError`: Raised on SHA256 mismatch

## 3. SHUTDOWN SEQUENCE (Ctrl+C)

### Signal Received: SIGINT/SIGTERM → supervisor
**Handler**: `supervisor._handle_signal(signum, _frame)`

**Actions**:
1. Sets `shutting_down = True`
2. **IPC-orchestrated shutdown**:
   - `POST http://127.0.0.1:9123/actions/shutdown` (30s timeout)
   - IPC calls `process_registry.shutdown_all()`

### app/ipc/process_manager.py
- **Function**: `ProcessRegistry.shutdown_all(logger)`
- **Process Order**:
  1. Workers (type="worker") and shells (type="shell")
  2. Framework (type="framework")
- **Per-Process Actions**:
  1. `os.kill(pid, signal.SIGTERM)` → Send SIGTERM
  2. Poll for 2s max:
     - Check `/proc/{pid}/stat` → Read state field
     - State 'Z' (zombie) → Clean exit
     - No `/proc/{pid}` → Process reaped
  3. If still alive after 2s:
     - `os.kill(pid, signal.SIGKILL)` → Force kill
     - Track `shell_id` in `force_killed_shells[]` (logs preserved)
  4. `_processes.pop(pid)` → Remove from registry
- **Returns**: Stats dict with counts (terminated, clean_exits, force_killed)

### supervisor cleanup
**After IPC shutdown**:
1. `_stop_ipc_server(SIGTERM)` → Kill IPC server (PID from `TE_IPC_PID`)
2. `RUN_ID_FILE.unlink()` → Delete run_id file
3. Exit with framework exit code

### Logs & Artifacts
- **Shell logs**: Left in `~/.cache/te_framework/logs/` (archived on next startup)
- **Session cache**: Preserved in `~/.cache/termux_extensions/state_store.json`
- **Force-killed shells**: Logs marked for preservation, archived as `preserved_logs/logs_{timestamp}/`

## KEY FILES SUMMARY

### Startup Chain
1. `scripts/run_framework.sh` → `TE_RUN_ID`, `TE_RUN_MODE`, IPC spawn
2. `app/supervisor.py` → Process management, signal handling
3. `app/main.py` → FastAPI app, lifespan, extensions/apps loading
4. `app/libs/app_worker.py` → App worker subprocess spawner
5. `app/apps/file_editor_cm6/main.py` → Editor router, project root sync

### File Operations
1. `app/apps/file_editor_cm6/main.py` → `/read`, `/write` routes
2. `app/apps/file_editor_cm6/core_write.py` → `write_full()` atomic save
3. `app/apps/file_editor_cm6/core_read.py` → `init_watcher()`, `emit_diff_changed()`
4. `app/apps/file_editor_cm6/history_store.py` → Session cache management

### Shutdown Chain
1. `app/supervisor.py` → `_handle_signal()` → IPC shutdown request
2. `app/ipc/server.py` → `/actions/shutdown` endpoint
3. `app/ipc/process_manager.py` → `ProcessRegistry.shutdown_all()` sequential kill
4. `scripts/run_framework.sh` → `cleanup_framework_shell_logs()` on next startup

## VARIABLES & STATE

### Environment Variables
- `TE_RUN_ID`: Unique run identifier
- `TE_RUN_MODE`: "local" or "broadcast"
- `TE_SUPERVISOR_PID`: Supervisor process PID
- `TE_IPC_PID`: IPC server PID
- `TE_FRAMEWORK_SHELL_TOKEN`: Auth token for internal APIs
- `TE_IPC_HOST`, `TE_IPC_PORT`: IPC server address

### Runtime State
- `~/.cache/te_framework/run_id`: Current run ID
- `~/.cache/te_framework/ipc.pid`: IPC server PID
- `~/.cache/termux_extensions/state_store.json`: Persistent app state
- `~/.cache/te_framework/logs/fs-*/`: Framework shell logs
- `~/.cache/te_framework/preserved_logs/`: Archived logs from crashed runs

### In-Memory State
- `app.main._loaded_extensions`: Loaded extension manifests
- `app.main.loaded_apps`: Loaded app manifests
- `app.libs.app_manager._running_apps`: Active app workers {app_id: {pid, port}}
- `process_registry._processes`: IPC-tracked processes {pid: ProcessRecord}
- `file_editor_cm6._history_store`: Recent files, session cache
- `file_editor_cm6.project_root`: Active project directory
