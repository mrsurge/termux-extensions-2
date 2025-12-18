# Framework Shells Module

A standalone Python package for process orchestration with PTY, pipe, and dtach backends.

## Dependencies

- Python 3.9+
- `fastapi`, `uvicorn` (for API)
- `pyyaml` (for spec files)
- `dtach` (system binary, for persistent shells)

## Overview

`framework_shells/` is a self-contained module that manages long-running background processes ("shells") with:

- **Multiple backends**: PTY (interactive terminals), pipes (stdin/stdout), dtach (persistent sessions)
- **Runtime isolation**: Shells are namespaced by repo fingerprint + secret-derived runtime ID
- **Event bus**: Real-time notifications for shell lifecycle events
- **Singleton manager**: One manager instance per process, thread-safe
- **Integration hooks (optional)**: Host apps can observe shell lifecycle events (e.g., for external process registries)

## Directory Structure

```
framework_shells/
├── __init__.py          # Package exports and get_manager() singleton
├── manager.py           # FrameworkShellManager - core orchestration
├── record.py            # ShellRecord dataclass
├── store.py             # RuntimeStore - namespaced storage paths
├── auth.py              # Secret handling and token derivation
├── events.py            # EventBus for shell lifecycle events
├── hooks.py             # Optional lifecycle hook dataclasses (host integration)
├── pty.py               # PTYState and PipeState dataclasses
├── process_snapshot.py  # Host-agnostic process snapshot types
├── shutdown.py          # Shutdown planner/executor helpers
├── shellspec.py         # YAML shellspec loader + template renderer
├── orchestrator.py      # Shellspec-based orchestration
├── cli/
│   └── main.py          # CLI tool (fs list, fs up, fs down, fs attach)
└── api/
    ├── fastapi_router.py   # REST API endpoints
    ├── fws_ui.py           # Self-hosted dashboard + logs (/fws, /ws/fws)
    └── websocket.py        # WebSocket endpoints for shell events
├── ui/
│   ├── index.html          # Dashboard page
│   ├── fws.css             # Dashboard styles
│   ├── fws.js              # Minimal dashboard websocket client
│   └── logs.html           # Log viewer page
```

## Core Concepts

### ShellRecord

Metadata for a managed process:

```python
@dataclass
class ShellRecord:
    id: str                    # Unique ID (fs_<timestamp>_<random>)
    command: List[str]         # Command and arguments
    label: Optional[str]       # Human-readable label
    subgroups: List[str]       # Grouping hierarchy (e.g., ["file_editor_cm6", "terminal"])
    cwd: str                   # Working directory
    pid: Optional[int]         # Process ID (None if not started)
    status: str                # "pending", "running", "exited"
    created_at: float          # Unix timestamp
    uses_pty: bool             # PTY backend
    uses_pipes: bool           # Pipe backend
    uses_dtach: bool           # Dtach backend (persistent)
    stdout_log: str            # Path to stdout log
    stderr_log: str            # Path to stderr log
    exit_code: Optional[int]   # Exit code (if exited)
    runtime_id: str            # Namespace for this runtime
```

### Backends

**PTY** (`spawn_shell_pty`):
- Full terminal emulation
- Supports resize, input/output streaming
- Good for interactive shells
- **Not re-attachable across manager process restarts** (PTY file descriptors are in-memory)

**Pipes** (`spawn_shell_pipe`):
- Stdin/stdout/stderr as separate streams
- Good for LSP servers, daemons
- **Not re-attachable across manager process restarts** (pipe handles are in-memory)

**Dtach** (`spawn_shell_dtach`):
- Wraps shell in dtach for persistence
- Survives framework restarts
- Can attach/detach from CLI
- Socket-based communication

### Runtime Isolation

Shells are stored under:
```
~/.cache/te_framework/runtimes/<repo_fingerprint>/<runtime_id>/
├── meta/<shell_id>/meta.json
├── logs/<shell_id>.stdout.log
├── logs/<shell_id>.stderr.log
└── sockets/<shell_id>.sock  (dtach only)
```

- `repo_fingerprint`: SHA256 of repo root path (first 16 chars)
- `runtime_id`: Derived from `FRAMEWORK_SHELLS_SECRET`

This ensures different repos and different secrets don't see each other's shells.

## API

### Manager Methods

```python
from framework_shells import get_manager

mgr = await get_manager()

# Advanced: configure the singleton once (must be consistent per-process)
# mgr = await get_manager(process_hooks=..., enable_dtach_proxy=False)

# Spawn shells
record = await mgr.spawn_shell_pty(["bash", "-l", "-i"], label="terminal", cwd="/home/user")
record = await mgr.spawn_shell_pipe(["pyright-langserver", "--stdio"], label="lsp:python")
record = await mgr.spawn_shell_dtach(["bash", "-l", "-i"], label="persistent-shell")

# List and find
shells = await mgr.list_shells()
shell = await mgr.get_shell(shell_id)
shell = await mgr.find_shell_by_label("terminal", status="running")

# Describe (with stats)
info = await mgr.describe(record, include_logs=True, tail_lines=100)

# PTY I/O
queue = await mgr.subscribe_output(shell_id)
await mgr.write_to_pty(shell_id, "ls -la\n")
await mgr.resize_pty(shell_id, cols=120, rows=40)
await mgr.unsubscribe_output(shell_id, queue)

# Pipe I/O (in-memory only)
pipe_state = mgr.get_pipe_state(shell_id)

# Lifecycle
await mgr.terminate_shell(shell_id, force=True)
await mgr.remove_shell(shell_id, force=True)  # Also removes logs/metadata

# Optional: enumerate running PIDs for external monitoring
pids = await mgr.list_active_pids()

# Optional: provide lightweight aggregated stats (requires psutil for per-process CPU/RSS)
stats = await mgr.aggregate_resource_stats()
```

### REST API

```
GET    /api/framework_shells                 # List all shells
POST   /api/framework_shells                 # Create shell
GET    /api/framework_shells/{id}            # Get shell details
POST   /api/framework_shells/{id}/action     # Terminate, etc.
DELETE /api/framework_shells/{id}            # Purge metadata/logs (Exited-shell cleanup)
POST   /api/framework_shells/purge_exited    # Purge metadata/logs for all exited shells
GET    /api/framework_shells/{id}/replay     # Get stdout log
```

## Self-hosted UI (FWS)

When mounted in a FastAPI app, `framework_shells` can self-host a simple dashboard:

- `GET /fws/` dashboard (live-updating via `WS /ws/fws`)
- `GET /fws/logs/{shell_id}` log viewer (tail + follow via WebSocket)

The dashboard toolbar includes **Truncate Logs**, which truncates all `.stdout.log`/`.stderr.log` files in the current runtime (it does not delete shell records). Exited shells can be fully removed via **Purge Exited** in the Exited section (deletes metadata + logs).

### UI Hints

Shells can carry optional UI metadata via `ShellSpec.ui` / `ShellRecord.ui`. The dashboard currently supports `ui.subgroup_styles` to color subgroup “cards” and accents:

```yaml
ui:
  subgroup_styles:
    lsp:
      bg: rgba(68, 45, 47, 0.80)
      border: rgba(168, 85, 247, 0.60)
```

## Shellspec Convention (Recommended)

`framework_shells` is framework-agnostic, but the intended integration pattern is:

- Describe host-run processes as `ShellSpec` (YAML).
- Start shells via `Orchestrator` (from a spec or spec ref).
- Keep optional UI hints in the shellspec under `ui` (not host-specific code).

### Per-app Shellspec Layout

A common layout is to keep shellspecs next to an app/module:

```
app/apps/<app_id>/
└── shellspec/
    └── app_worker.yaml
```

Example minimal spec (TE2-style, but generic):

```yaml
version: "1"
shells:
  app-worker:
    backend: proc
    cwd: ${ctx:PROJECT_ROOT}
    command:
      - python
      - -m
      - app.libs.app_worker
      - --app-id
      - ${ctx:APP_ID}
      - --port
      - ${free_port}
      - --backend-module
      - ${ctx:BACKEND_MODULE_PATH}
    env:
      TE_APP_ID: ${ctx:APP_ID}
      TE_APP_WORKER_PORT: ${free_port}
```

Then start it from a shellspec ref (`<path>#<id>`) with a render context:

```python
shell = await Orchestrator(mgr).start_from_ref(
    "shellspec/app_worker.yaml#app-worker",
    base_dir=app_dir,
    ctx={"APP_ID": app_id, "PROJECT_ROOT": project_root, "BACKEND_MODULE_PATH": backend_module_path},
    label=f"app-worker:{app_id}",
)
```

### Events

```python
from framework_shells.events import get_event_bus, EventType

bus = get_event_bus()
queue = bus.subscribe()

while True:
    event = await queue.get()
    # event.type: shell.created, shell.spawned, shell.pty_chunk, shell.exited, ...
    # event.shell_id, event.data, event.timestamp
```

## CLI

```bash
# List shells
python -m framework_shells.cli.main list

# Apply spec file
python -m framework_shells.cli.main up shells.yaml

# Terminate all shells
python -m framework_shells.cli.main down

# Attach to dtach shell
python -m framework_shells.cli.main attach <shell_id>

# Show process trees (managed shells + procfs descendants)
python -m framework_shells.cli.main tree --depth 4
```

The CLI auto-detects the repo fingerprint from cwd and loads the stored secret.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FRAMEWORK_SHELLS_SECRET` | Secret for runtime ID derivation and API auth |
| `FRAMEWORK_SHELLS_REPO_FINGERPRINT` | Override auto-computed repo fingerprint |

## Secret & Fingerprint Surface

`framework_shells` has two key inputs that define where it stores metadata/logs and which shells belong to the current runtime:

- `FRAMEWORK_SHELLS_REPO_FINGERPRINT`: repo-scoped namespace (defaults to a SHA256 of `cwd` if unset)
- `FRAMEWORK_SHELLS_SECRET`: secret used to derive the `runtime_id` (and API tokens when auth is enabled)

### TE2 (Reference)

TE2’s `scripts/run_framework.sh` is the canonical place where the secret is created/loaded and exported:

- Secret file path: `~/.cache/te_framework/runtimes/<fingerprint>/secret`
- If present, it is loaded; otherwise it is generated and written, then exported as `FRAMEWORK_SHELLS_SECRET`.

### Standalone / CLI

The CLI tries to be usable outside TE2:

- If `FRAMEWORK_SHELLS_REPO_FINGERPRINT` is missing, it computes one from `cwd` (and sets the env var).
- If `FRAMEWORK_SHELLS_SECRET` is missing, it tries to load the same stored secret file under the computed fingerprint.
- If no stored secret exists, it falls back to a temporary secret (good for one-off runs, but you won’t be able to recover/attach to that runtime after restart).


## Integration Hooks (Optional)

`FrameworkShellManager` supports optional host-provided lifecycle hooks via `ShellLifecycleHooks`.

This stays intentionally framework-agnostic: the library does not know about IPC, FastAPI, systemd, etc.
Hooks are best-effort (errors are swallowed) and may be sync or async.

Common uses:
- Register/unregister shell PIDs in an external process registry
- Emit metrics/telemetry for shell start/adopt/exit events
- Maintain parent/child graphs outside of `framework_shells`

Exposed hook points:
- `on_shell_running(record)`
- `on_shell_adopted(record)`
- `on_shell_exited(record, last_pid)`

## Notes on Detach / Process Groups

Shell processes are launched with `start_new_session=True` for isolation. This means:
- Killing the host process does not necessarily kill the shells it spawned.
- Host frameworks should call `terminate_shell()` on shutdown.
- If a host framework uses an external “last resort” killer, it should either:
    - scan `framework_shells` runtime metadata and terminate shells, or
    - ensure shell PIDs are registered with that external supervisor.

## Runtime Isolation

The secret's primary purpose is **runtime isolation** - it derives the `runtime_id` that namespaces shell storage:

```
~/.cache/te_framework/runtimes/<repo_fingerprint>/<runtime_id>/
```

Two instances with different secrets won't see each other's shells, even if running from the same repo. This enables running multiple clones on different ports without interference.

## Auth

Mutating API endpoints can require authentication via:
- `X-Framework-Key` header (frontend uses this)
- `Authorization: Bearer <token>` header

Token is derived from `FRAMEWORK_SHELLS_SECRET`.

- If `FRAMEWORK_SHELLS_SECRET` is unset/empty, auth is disabled (dev mode).
- If `FRAMEWORK_SHELLS_SECRET` is set, mutating endpoints require a valid token.
