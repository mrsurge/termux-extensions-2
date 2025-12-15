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

## Directory Structure

```
framework_shells/
├── __init__.py          # Package exports and get_manager() singleton
├── manager.py           # FrameworkShellManager - core orchestration
├── record.py            # ShellRecord dataclass
├── store.py             # RuntimeStore - namespaced storage paths
├── auth.py              # Secret handling and token derivation
├── events.py            # EventBus for shell lifecycle events
├── pty.py               # PTYState and PipeState dataclasses
├── spec.py              # YAML spec loader (for declarative shell definitions)
├── orchestrator.py      # Spec-based shell orchestration
├── cli/
│   └── main.py          # CLI tool (fs list, fs up, fs down, fs attach)
└── api/
    ├── fastapi_router.py   # REST API endpoints
    └── websocket.py        # WebSocket endpoints for PTY streaming
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
- Dies when framework restarts

**Pipes** (`spawn_shell_pipe`):
- Stdin/stdout/stderr as separate streams
- Good for LSP servers, daemons
- Dies when framework restarts

**Dtach** (`spawn_shell_dtach`):
- Wraps shell in dtach for persistence
- Survives framework restarts
- Can attach/detach from CLI
- Socket-based communication

### Runtime Isolation

Shells are stored under:
```
~/.cache/te_framework/runtimes/<repo_fingerprint>/<runtime_id>/
├── metadata/<shell_id>/meta.json
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

# Lifecycle
await mgr.terminate_shell(shell_id, force=True)
await mgr.remove_shell(shell_id, force=True)  # Also removes logs/metadata
```

### REST API

```
GET  /api/framework_shells              # List all shells
POST /api/framework_shells              # Create shell
GET  /api/framework_shells/{id}         # Get shell details
POST /api/framework_shells/{id}/action  # Terminate, etc.
GET  /api/framework_shells/{id}/replay  # Get stdout log
```

### Events

```python
from framework_shells.events import get_event_bus, EventType

bus = get_event_bus()
queue = bus.subscribe()

while True:
    event = await queue.get()
    # event.type: SHELL_CREATED, SHELL_STARTED, SHELL_OUTPUT, SHELL_EXITED
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
```

The CLI auto-detects the repo fingerprint from cwd and loads the stored secret.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FRAMEWORK_SHELLS_SECRET` | Secret for runtime ID derivation and API auth |
| `TE_REPO_FINGERPRINT` | Override auto-computed repo fingerprint |
| `TE_RUN_ID` | Current framework run ID (for adoption tracking) |

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

Token is derived from `FRAMEWORK_SHELLS_SECRET`. If `TE_FRAMEWORK_SHELL_TOKEN` env var is not set, auth is disabled (dev mode).
