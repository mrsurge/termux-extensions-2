# TE2 Framework Shell Integration

How the TE2 framework uses the `framework_shells` module for process management.

## Quick Start

```bash
# From repo root
scripts/run_framework.sh
```

The framework runs on `http://127.0.0.1:8088` by default.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         run_framework.sh                         │
│  - Sets FRAMEWORK_SHELLS_SECRET                                 │
│  - Sets TE_REPO_FINGERPRINT                                     │
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
│ (spawn_shell)     │ │ (spawn_shell_dtach│ │ (spawn_shell_pipe)│
└───────────────────┘ └───────────────────┘ └───────────────────┘
```

## Startup Flow

1. **run_framework.sh**:
   - Computes `TE_REPO_FINGERPRINT` from repo root path
   - Generates/loads `FRAMEWORK_SHELLS_SECRET`
   - Starts IPC server on port 9123
   - Starts supervisor

2. **supervisor.py**:
   - Starts framework (uvicorn with app/main.py)
   - Handles shutdown signals

3. **app/main.py lifespan startup**:
   - Calls `get_manager()` which triggers shell adoption
   - Orphaned shells from previous runs are adopted
   - Running apps are restored

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
   - IPC kills any remaining processes

6. **Supervisor stops IPC server**

## Integration Points

### App Workers

`app/libs/app_manager.py`:
```python
from framework_shells import get_manager

mgr = await get_manager()
record = await mgr.spawn_shell(
    command,
    label=f"app-worker:{app_id}",
    cwd=project_root,
    env={"TE_APP_ID": app_id, ...}
)
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

### Sessions & Shortcuts UI

`app/extensions/sessions_and_shortcuts/main.py`:
```python
from framework_shells import get_manager
from framework_shells.events import get_event_bus

# List shells for display
mgr = await get_manager()
shells = await mgr.list_shells()
frameworks = [await mgr.describe(s) for s in shells]

# Subscribe to events for live updates
bus = get_event_bus()
queue = bus.subscribe()
event = await queue.get()
```

## API Router Mount

`app/main.py`:
```python
from framework_shells.api.fastapi_router import router as framework_shells_router
from framework_shells.api.websocket import router as framework_shells_ws_router

app.include_router(framework_shells_router)
app.include_router(framework_shells_ws_router)
```

This provides:
- `GET /api/framework_shells` - List shells
- `POST /api/framework_shells` - Create shell
- `GET /api/framework_shells/{id}` - Get shell
- `POST /api/framework_shells/{id}/action` - Terminate, etc.
- `WS /ws/framework_shells/{id}` - PTY streaming

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
- Verify `FRAMEWORK_SHELLS_SECRET` and `TE_REPO_FINGERPRINT` match

### Shells surviving restart
- Dtach shells persist by design
- Use `fs down` or terminate from UI

### Orphaned dtach processes
- Kill manually: `pkill -f dtach`
- Or use `mgr.terminate_shell(id, force=True)` which removes socket

### Auth errors (403)
- Auth is currently disabled for development
- If enabled in future, set `TE_FRAMEWORK_SHELL_TOKEN` env var

## Logs

Shell logs are stored at:
```
~/.cache/te_framework/runtimes/<fingerprint>/<runtime_id>/logs/
├── <shell_id>.stdout.log
└── <shell_id>.stderr.log
```

Framework console output goes to stdout of the `run_framework.sh` process.

## Shell Grouping & UI Styling

Apps define shell grouping hints in `app/apps/<app_id>/manifest.json`:

```json
{
  "id": "file_editor_cm6",
  "framework_shell_ui": {
    "subgroup_styles": {
      "lsp": {
        "bg": "rgba(68, 45, 47, 0.80)",
        "border": "rgba(168, 85, 247, 0.60)"
      },
      "project:*": {
        "bg": "rgba(0, 0, 0, 0.88)",
        "border": "rgba(29, 70, 126, 0.88)"
      }
    }
  }
}
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

The sessions UI groups these shells under their parent app worker with the defined colors.
