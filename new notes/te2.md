# TE2 Framework Shell Integration

How the TE2 framework uses the `framework_shells` module for process management.

## Quick Start

```bash
# From repo root
scripts/run_framework.sh
```

The framework runs on `http://127.0.0.1:8089` by default.

Ports and sleep mode can be controlled from the entrypoint:
```bash
scripts/run_framework.sh --port 8089 --ipc-port 9099
scripts/run_framework.sh --sleep --port 8089 --ipc-port 9099
# Wake/sleep (sleep listener is always on :9100)
curl -X POST http://127.0.0.1:9100/actions/wake
curl -X POST http://127.0.0.1:9100/actions/sleep
```

### Secret Surface (TE2)

The stable “surface” for the runtime secret is `scripts/run_framework.sh`:

- It creates/loads `~/.cache/te_framework/runtimes/<fingerprint>/secret`
- Exports `FRAMEWORK_SHELLS_SECRET` (used to derive the runtime namespace and API tokens)
- Exports `FRAMEWORK_SHELLS_BASE_DIR=~/.cache/te_framework` so `framework_shells` stores runtime data under the TE2 cache root

### TE2 Environment Variables (FWS Integration)

These are TE2-only knobs used by TE2’s scripts/apps; `framework_shells` itself does not read or inject `TE_*` variables.

| Variable | Description |
|----------|-------------|
| `TE_RUN_ID` | Current framework run ID (TE2 app/IPC correlation) |
| `TE_PORT` | Framework bind port (default 8089) |
| `TE_IPC_HOST`, `TE_IPC_PORT` | IPC server address (default 127.0.0.1:9099) |


## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         run_framework.sh                         │
│  - Sets FRAMEWORK_SHELLS_SECRET                                 │
│  - Sets FRAMEWORK_SHELLS_REPO_FINGERPRINT                       │
│  - Starts IPC server                                            │
│  - Starts supervisor                                            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                          supervisor.py                           │
│  - Manages framework lifecycle                                  │
│  - On shutdown: SIGTERM → framework → wait → IPC cleanup        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                       app/main.py (FastAPI)                      │
│  - Mounts framework_shells API router                           │
│  - Lifespan startup: adopts orphaned shells                     │
│  - Lifespan shutdown: terminates all shells                     │
└─────────────────────────────────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│   App Workers     │ │    Terminals      │ │   LSP Servers     │
│ (shellspec/orch)  │ │ (spawn_shell_dtach│ │ (spawn_shell_pipe)│
└───────────────────┘ └───────────────────┘ └───────────────────┘
```

## Startup Flow

1. **run_framework.sh**:
   - Computes `FRAMEWORK_SHELLS_REPO_FINGERPRINT` from repo root path
   - Generates/loads `FRAMEWORK_SHELLS_SECRET`
   - Starts IPC server (`--ipc-port`, default 9099) and a sleep listener on port 9100
   - Starts supervisor (unless `--sleep`, which leaves the framework stopped until /actions/wake)

2. **supervisor.py**:
   - Starts framework (uvicorn with app/main.py)
   - Handles shutdown signals

3. **app/main.py lifespan startup**:
  - Calls `get_manager()` (configured with IPC lifecycle hooks) which triggers shell adoption
   - Orphaned shells from previous runs are adopted
   - Running apps are restored
  - Adopted/running shell PIDs are (re)registered with IPC

## Shutdown Flow

1. **Ctrl+C or SIGTERM** → supervisor catches signal

2. **Supervisor sends SIGTERM to framework**:
   ```python
   os.kill(proc.pid, signal.SIGTERM)
   ```

3. **Framework lifespan shutdown**:
   ```python
   mgr = await get_manager()
   for shell in await mgr.list_shells():
       if shell.status == "running":
           await mgr.terminate_shell(shell.id, force=True)
   ```

4. **Supervisor waits** (up to 10s) for framework to exit

5. **IPC cleanup** (only if framework hung):
   - Supervisor calls IPC `/actions/shutdown`
  - IPC terminates framework shells first (including dtach-backed shells)
  - IPC terminates registered processes in dependency order (children first, framework last)
  - IPC logs the shutdown ordering plan (pid/type/label/parent/depth)

6. **Supervisor stops IPC server**

## Integration Points

### App Workers

TE2 treats app workers as **shellspec-defined shells**. Each app should ship a shellspec file describing how to launch its app worker, and the app manifest should reference it.

**Convention:**
- `app/apps/<app_id>/shellspec/app_worker.yaml` defines shell `app-worker`
- `app/apps/<app_id>/manifest.json` includes:
  ```json
  {
    "shellspec": {
      "app_worker": "shellspec/app_worker.yaml#app-worker"
    }
  }
  ```

`app/libs/app_manager.py` uses this ref (with a fallback to `shellspec/app_worker.yaml#app-worker` if present) and renders templates like `${free_port}` / `${ctx:APP_ID}` before spawning the worker via `Orchestrator`.

`app/libs/app_manager.py`:
```python
from framework_shells import get_manager
from framework_shells.orchestrator import Orchestrator
from framework_shells.shellspec import parse_shellspec_ref

mgr = await get_manager()
orch = Orchestrator(mgr)

# From the app's manifest.json (typically "shellspec/app_worker.yaml#app-worker")
shellspec_ref = app_manifest["shellspec"]["app_worker"]
_ref_path, spec_shell_id = parse_shellspec_ref(shellspec_ref)
record_spec_id = f"app:{app_id}:{spec_shell_id}"

shell = await orch.start_from_ref(
    shellspec_ref,
    base_dir=app_dir,
    ctx={
        "APP_ID": app_id,
        "PROJECT_ROOT": project_root,
        "BACKEND_MODULE_PATH": backend_module_path,
    },
    label=f"app-worker:{app_id}",
    record_spec_id=record_spec_id,
    wait_ready=False,
)

# Port is provided by shellspec via env var (often using ${free_port})
port = int(shell.env_overrides["TE_APP_WORKER_PORT"])
```

### Editor Terminals

`app/apps/file_editor_cm6/terminal_shell.py`:
```python
from framework_shells import get_manager

mgr = await get_manager()

# Check for existing shell first
existing = await mgr.find_shell_by_label(label, status="running")
if existing:
    return await mgr.describe(existing)

# Spawn new dtach-backed terminal
record = await mgr.spawn_shell_dtach(
    ["bash", "-l", "-i"],
    label=label,
    subgroups=["file_editor_cm6", "terminal"],
    cwd=project_path
)
```

### LSP Servers

`app/apps/file_editor_cm6/lsp_shell_manager.py`:
```python
from framework_shells import get_manager

mgr = await get_manager()
record = await mgr.spawn_shell_pipe(
    ["pyright-langserver", "--stdio"],
    label="lsp:python",
    subgroups=["file_editor_cm6", "lsp"],
    cwd=project_root
)
```

**Note on pipe shells:** pipe-backed shells are only usable in the process that spawned them (the live stdin/stdout handles are in-memory). If an app worker restarts, any surviving LSP server process must be terminated and respawned.

Code CM6’s frontend is stateless and will reconnect often; the `/lsp` bridge keeps a long-lived backend session and short-circuits repeat JSON-RPC `initialize` to avoid spawning extra TypeScript `tsserver` child processes on reload.

### Sessions & Shortcuts UI

The framework shells dashboard is now hosted by the `framework_shells` module itself at:

- `/fws/` (UI)
- `/fws/logs/{shell_id}` + `WS /ws/fws/logs/{shell_id}` (log viewer)

TE2’s `sessions_and_shortcuts` extension is now a thin iframe shim that embeds `/fws/`.

Compatibility routes are also provided:
- `/shell-logs/{shell_id}`
- `WS /ws/shell-logs/{shell_id}`

The `/fws/` toolbar includes **Truncate Logs**, which truncates all stdout/stderr logs for the current runtime (shell records remain). The Exited section includes **Purge Exited** to delete exited shells’ logs + metadata.

## API Router Mount

`app/main.py`:
```python
from framework_shells.api.fastapi_router import router as framework_shells_router
from framework_shells.api.websocket import router as framework_shells_ws_router
from framework_shells.api.fws_ui import router as fws_ui_router

app.include_router(framework_shells_router)
app.include_router(framework_shells_ws_router)
app.include_router(fws_ui_router)
```

This provides:
- `GET /api/framework_shells` - List shells
- `POST /api/framework_shells` - Create shell
- `GET /api/framework_shells/{id}` - Get shell
- `POST /api/framework_shells/{id}/action` - Terminate, etc.
- `WS /ws/events` - Shell lifecycle event stream
- `GET /fws/` - Framework shells dashboard (HTML)
- `WS /ws/fws` - Dashboard live updates (HTML snapshots)

## Compatibility Shim

`app/libs/framework_shells.py` is now a thin shim:
```python
# Re-exports from new package for any legacy imports
from framework_shells import (
    FrameworkShellManager,
    ShellRecord,
    get_manager,
    ...
)
```

All new code should import directly from `framework_shells`.

## Key Differences from Old System

| Aspect | Old (`app.libs.framework_shells`) | New (`framework_shells/`) |
|--------|-----------------------------------|---------------------------|
| Location | Single 1300+ line file | Separate package |
| Manager | Created per API call | Singleton |
| Storage | Flat `~/.cache/te_framework/` | Namespaced by repo+secret |
| Dtach | Basic support | Full support with socket cleanup |
| Events | None | EventBus with subscribe/unsubscribe |
| CLI | None | `fs list`, `fs up`, `fs down`, `fs attach` |
| UI Updates | Polling every 5s | Event-driven (instant) |

## Troubleshooting

### Shells not showing in UI
- Check `python -m framework_shells.cli.main list`
- Verify `FRAMEWORK_SHELLS_SECRET` and `FRAMEWORK_SHELLS_REPO_FINGERPRINT` match

### “Why do I see extra processes under an LSP shell?”
Use `python -m framework_shells.cli.main tree --depth 4` to show procfs-discovered descendants (e.g. `node tsserver.js` children under `lsp:javascript`).

### `[JOB_PUMP] Missed event for untracked job ...`
This message comes from Code CM6’s explorer websocket job pump, not `framework_shells`.

The TE2 job registry is global (shared across apps), so consumers should only forward jobs they explicitly track for the current project/session and ignore the rest.

### Shells surviving restart
- Dtach shells persist by design
- Use `fs down` or terminate from UI
- If the framework hung and IPC shutdown ran, shells should no longer be adopted on next start

### Orphaned dtach processes
- Kill manually: `pkill -f dtach`
- Or use `mgr.terminate_shell(id, force=True)` which removes socket

### IPC shutdown says it killed everything, but shells get adopted
This used to happen when only the framework PID was registered with IPC. Shells are spawned in new sessions,
so killing the framework process does not kill the shells.

Current behavior:
- Framework initializes `framework_shells` with IPC lifecycle hooks so each running/adopted shell PID is registered.
- IPC shutdown also performs a best-effort `framework_shells` termination pass to catch any shells that were not registered.

### Auth errors (403)
- Mutating FWS endpoints require a token derived from `FRAMEWORK_SHELLS_SECRET`.
- If you see 403s, verify `FRAMEWORK_SHELLS_SECRET` and `FRAMEWORK_SHELLS_REPO_FINGERPRINT` match what the framework exported.

## Logs

Shell logs are stored at:
```
~/.cache/te_framework/runtimes/<fingerprint>/<runtime_id>/logs/
├── <shell_id>.stdout.log
└── <shell_id>.stderr.log
```

Exited-shell cleanup in the UI uses the framework_shells API:
- `DELETE /api/framework_shells/{id}` (purge one shell’s metadata/logs)
- `POST /api/framework_shells/purge_exited` (purge all exited shells)

Truncate-all is available in the `/fws/` toolbar and truncates (does not delete) log files so running shells can continue writing safely.

Framework console output goes to stdout of the `run_framework.sh` process.

## Shell Grouping & UI Styling

Apps define FWS UI styling in their shellspec YAML (typically `app/apps/<app_id>/shellspec/app_worker.yaml`) under `ui.subgroup_styles`:

```yaml
ui:
  subgroup_styles:
    lsp:
      bg: rgba(68, 45, 47, 0.80)
      border: rgba(168, 85, 247, 0.60)
    project:*:
      bg: rgba(0, 0, 0, 0.88)
      border: rgba(29, 70, 126, 0.88)
```

When spawning shells, use `subgroups` to associate them with an app:
```python
await mgr.spawn_shell_dtach(
    ["bash", "-l", "-i"],
    label="terminal",
    subgroups=["file_editor_cm6", "project:myproject"],  # [umbrella, subgroup]
    cwd=project_path
)
```

- First element (`file_editor_cm6`) = umbrella (matches app worker)
- Second element (`project:myproject`) = subgroup (matches `project:*` pattern)

The FWS UI (`/fws/`) groups these shells under their parent app worker with the defined colors.
