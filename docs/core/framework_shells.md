# Framework Shells Architecture

**Last Updated:** November 17, 2025  
**Updated by:** Atlas

## 1. Motivation

Services such as on-demand application backends, aria2 RPC daemons, container helpers, or local LLM runtimes need
long-lived processes but should not consume the finite interactive shells surfaced
by the Sessions extension. Framework shells provide a core-managed way to spawn and
observe background jobs tagged with `TE_SESSION_TYPE=framework`, keeping them out of
user-visible session lists while remaining easy to manage.

**Key Benefits:**
- **Process isolation** - Each shell runs in its own process group
- **Automatic cleanup** - Supervisor terminates all shells on exit, preventing orphans
- **Lifecycle tracking** - Creation, restart, graceful/forced shutdown
- **Log capture** - Persistent stdout/stderr logs for debugging
- **Resource monitoring** - CPU, memory, thread counts (requires psutil)
- **Label discovery** - Apps can find their dedicated shells by label
- **Configurable timeouts** - User-adjustable shell lifetimes via Settings app

## 2. Current Capabilities

- **Manager module:** `FrameworkShellManager` (in `app/libs/framework_shells.py`) stores
  metadata, launches processes via **FastAPI/asyncio** (not Flask), captures stdout/stderr logs,
  and updates status across restarts.
- **PTY support:** Shells can optionally use pseudo-terminals (`uses_pty=True`) for interactive
  processes, with output streaming via WebSocket subscriptions.
- **IPC integration:** Framework shells register with the IPC server (`app/ipc/server.py`) for
  coordinated shutdown. The IPC `ProcessRegistry` tracks all processes (type="framework", "worker", "shell").
- **Metadata layout:**
  - `~/.cache/te_framework/meta/<id>.json` — serialized `ShellRecord` data (flat JSON file, not subdirectory).
  - `~/.cache/te_framework/logs/fs-<id>/stdout.log` and `stderr.log` — append-only logs organized by shell ID directory.
- **Lifecycle operations:** spawn (with optional PTY), list, describe, graceful terminate, force kill,
  restart, and full removal (including logs and metadata). **IPC-orchestrated shutdown** replaces
  supervisor-managed cleanup: `POST /actions/shutdown` on IPC server triggers `ProcessRegistry.shutdown_all()`,
  which terminates workers/shells first, then framework process sequentially.
- **Resource stats:** When `psutil` is installed the manager reports CPU%, RSS, and
  thread counts; otherwise only basic uptime/alive flags are provided.
- **Access control:** Mutating endpoints may require the `X-Framework-Key` header if
  `TE_FRAMEWORK_SHELL_TOKEN` is configured. Read operations remain open.
- **Limits:** 
  - `TE_MAX_APP_SHELLS` (default 5) caps app-related shells
  - `TE_MAX_SERVICE_SHELLS` (default 5) caps service-related shells
  - Total limit is sum of both categories
- **Run tracking:** Every shell record includes the launcher PID, run ID, and
  `uses_pty` flag. The supervisor writes the current run ID to
  `~/.cache/te_framework/run_id` so dtach sessions and other helpers can discover
  it on restart.
- **Shell adoption:** On startup, manager calls `_adopt_orphaned_shells()` to reclaim
  shells from previous runs (if PIDs still alive) or mark them as exited.
- **Runtime metrics:** `GET /api/framework/runtime/metrics` aggregates all running
  shells (and matching interactive sessions) for use in the Settings app or other
  diagnostics.

## 3. Core API Surface

| Method & Path | Description |
| --- | --- |
| `GET /api/framework_shells` | List shells with status and resource stats. |
| `POST /api/framework_shells` | Spawn a new shell (`command`, optional `cwd`, `env`, `label`, `autostart`, `uses_pty`). |
| `GET /api/framework_shells/<id>` | Detailed record; use `logs=true&tail=200` to fetch log tails. |
| `POST /api/framework_shells/<id>/action` | Accepted actions: `stop`/`terminate` (SIGTERM), `kill`/`force` (SIGKILL + remove), `restart`. |
| `DELETE /api/framework_shells/<id>` | Remove metadata/logs. `?force=1` forces termination first. |
| `POST /api/framework_shells/terminate_group` | Terminate all shells matching a group label. |
| **PTY-specific routes** | |
| `POST /api/framework_shells/spawn_pty` | Spawn shell with PTY support (returns shell_id). |
| `POST /api/framework_shells/<id>/write` | Write data to PTY master (for interactive shells). |
| `GET /api/framework_shells/<id>/stream` | SSE stream of PTY output. |
| `WS /api/framework_shells/<id>/ws` | WebSocket bidirectional PTY stream. |

All responses honour the `{ "ok": true|false, ... }` envelope.

## 4. Manager Behaviour

1. **Spawn (Regular)**
   - Validates that the command is a list of strings and the working directory
     (default `~`) resolves inside the home directory.
   - Creates unique shell ID `fs_{timestamp}_{uuid8}`, prepares log directory
     `~/.cache/te_framework/logs/fs-{id}/`, and launches the process with
     `start_new_session=True` so it survives Flask reloads.
   - Uses `subprocess.Popen` with stdout/stderr redirected to log files.
   - Persists metadata to `~/.cache/te_framework/meta/{id}.json` (flat JSON file).
   - Registers shell with IPC server (type="shell") for coordinated shutdown.
   - Returns the running `ShellRecord`.

2. **Spawn (PTY)**
   - Similar to regular spawn but uses `pty.openpty()` to create pseudo-terminal pair.
   - Process runs with PTY slave as stdin/stdout/stderr.
   - Sets `TE_TTY=pty` environment variable.
   - Starts background asyncio task to read from PTY master and broadcast to subscribers.
   - Enables interactive I/O via `/api/framework_shells/<id>/write` and streaming endpoints.
   - Stores `PTYState` in manager's `_pty` dict with master FD, subscribers queue, and reader task.

3. **Terminate / Kill**
   - Sends `SIGTERM` to the entire process group using `os.killpg` when asked to `stop` or `terminate`.
     This ensures that the main process and all of its children (e.g., a python worker and a `tee` logger)
     are terminated together, preventing orphans.
   - For PTY shells, stops the PTY reader task and closes the master FD.
   - Escalates to `SIGKILL` if the process group fails to exit within a short timeout
     (or immediately when action is `kill` or `force`).
   - `kill`/`force` actions also remove the shell metadata/logs after termination.
   - Updates metadata with exit code (positive = exit status, negative = signal).

4. **Restart**
   - Forces termination (including PTY cleanup), resets timestamps, and relaunches the original
     command with the same overrides/log files while keeping the shell ID stable.
   - Re-creates PTY if `uses_pty=True`.

5. **Removal**
   - Optionally terminates the process (including PTY cleanup), prunes metadata file, and deletes
     log directory (`~/.cache/te_framework/logs/fs-{id}/`).
   - **IPC shutdown**: IPC server's `ProcessRegistry.shutdown_all()` terminates all registered
     processes sequentially (workers and shells first, framework last), then cleans registry.
     Shell logs are preserved during shutdown; next startup archives them to
     `~/.cache/te_framework/preserved_logs/logs_{timestamp}/`.

6. **Sweep**
   - Opportunistically marks shells as `exited` when the process is no longer alive.
   - For PTY shells, checks if master FD is still valid.

7. **Adoption**
   - On manager initialization, `_adopt_orphaned_shells()` scans metadata directory.
   - If shell PID is still alive, adopts it into current run (sets `adopted=True`).
   - If shell PID is dead, marks as exited with exit code.
   - Cleans up stale PTY state from previous runs.

## 5. Authentication & Configuration

| Setting | Source | Effect |
| --- | --- | --- |
| `TE_FRAMEWORK_SHELL_TOKEN` | Env or settings | Required value for `X-Framework-Key` header on mutating requests. Leave unset to allow local access without a token. |
| `TE_MAX_APP_SHELLS` | Env or settings | Max number of concurrent app-related shells (default 5). |
| `TE_MAX_SERVICE_SHELLS` | Env or settings | Max number of concurrent service-related shells (default 5). |
| `TE_FRAMEWORK_SHELL_DIR` | Env (deprecated) | Override metadata/log base directory. **Note:** Current implementation uses hardcoded `~/.cache/te_framework`. |
| `TE_RUN_ID` | Env (set by startup script) | Unique run identifier written to `~/.cache/te_framework/run_id` for cross-process coordination. |
| `TE_IPC_HOST`, `TE_IPC_PORT` | Env (default 127.0.0.1:9123) | IPC server address for process registry and coordinated shutdown. |

## 6. Usage Walkthrough

1. **Spawn aria2 daemon**
   ```bash
   curl -X POST http://localhost:8088/api/framework_shells \
     -H 'Content-Type: application/json' \
     -d '{"command":["aria2c","--enable-rpc"],"label":"aria2"}'
   ```
   Save the returned `id`.

2. **List shells**
   ```bash
   curl http://localhost:8088/api/framework_shells
   ```

3. **Inspect logs**
   ```bash
   curl 'http://localhost:8088/api/framework_shells/<id>?logs=true&tail=200'
   ```

4. **Stop / Remove**
   ```bash
   curl -X POST http://localhost:8088/api/framework_shells/<id>/action \
     -H 'Content-Type: application/json' \
     -d '{"action":"stop"}'
   curl -X DELETE http://localhost:8088/api/framework_shells/<id>
   ```

## 7. User-Configurable Shell Timeouts

**As of November 2, 2025**, framework shells support configurable timeouts via the Settings app.

**Timeout Types:**
- **App Framework Shells** - Shells spawned by apps for their own use (e.g., terminal PTY, file watcher)
- **Utility Framework Shells** - Shells spawned for shared services (e.g., Codex MCP server, aria2 daemon)

**Default Behavior:**
- Idle shells cleaned up after 30 minutes of inactivity
- User can configure via Settings app: 10min, 30min, 1hr, 4hr, 24hr, or "Never"
- Supervisor respects these settings on cleanup sweep

**Storage:**
```python
# Stored in app.config or environment
TE_APP_SHELL_TIMEOUT = 1800       # 30 minutes (default)
TE_UTILITY_SHELL_TIMEOUT = 1800   # 30 minutes (default)
```

**Settings Endpoints:**
```
GET  /api/settings/shell_timeouts
POST /api/settings/shell_timeouts
  Body: {
    "app_timeout": 3600,      # seconds
    "utility_timeout": 14400  # seconds
  }
```

## 8. Real-World Example: Code CM6 Agent Drawer

The **Code CM6 agent drawer** uses framework shells to manage the Codex MCP server:

**Flow:**
1. User opens agent drawer
2. Backend checks for existing shell via label: `codex mcp-server`
3. If not found, spawns new shell:
   ```python
   shell = spawn_shell(
       command=['codex', 'mcp-server'],
       label='codex mcp-server',
       cwd='/path/to/project',
       autostart=False
   )
   ```
4. Backend connects to shell PTY for bidirectional JSON-RPC communication
5. Multiple agent sessions multiplex through single shared shell
6. Shell lifetime managed by utility timeout setting
7. On supervisor shutdown, shell terminated gracefully

**Key Architecture Details:**
- **Single shell, multiple sessions** - One MCP server for all conversations
- **Session persistence** - Conversations survive shell restarts via backend storage
- **Conversation restoration** - If shell dies, next message auto-restores conversation history
- **Browser can close** - Backend keeps processing, captures full response

**Reference:** See `docs/apps/code_cm6/AGENT_DRAWER.md` for complete architecture.

## 9. Converting CLI Programs to Framework Shells

Framework shells are perfect for wrapping any CLI program that uses STDIO for communication. This guide shows how to convert a STDIO-based program into a managed framework shell.

### 9.1. Prerequisites

**Your CLI program should:**
- Read input from stdin (line-by-line or streaming)
- Write output to stdout (responses, events, logs)
- Optionally write errors to stderr
- Use a structured format (JSON, JSON-RPC, plain text)
- Run as a long-lived process (server mode)

**Examples that fit:**
- Language servers (LSP)
- MCP servers (Model Context Protocol)
- JSON-RPC servers
- Custom chatbots or agents
- Database query engines
- File processors

### 9.2. Basic Pattern

```python
# In your app backend (e.g., app/apps/my_app/backend.py)

from app.framework_shells import get_framework_shell_manager

def get_or_spawn_my_service():
    """Get existing shell or spawn new one."""
    manager = get_framework_shell_manager()
    
    # Check if shell already exists by label
    shells = manager.list_shells()
    for shell in shells:
        if shell.label == 'my-service' and shell.alive:
            return shell
    
    # Spawn new shell
    shell = manager.spawn_shell(
        command=['my-cli-tool', '--server-mode'],
        label='my-service',
        cwd='/path/to/workdir',
        env={'MY_VAR': 'value'},
        autostart=False  # Don't auto-start on framework restart
    )
    
    return shell
```

### 9.3. Writing to the Shell (Sending Input)

**For JSON-RPC or line-based protocols:**

```python
import json

def send_request_to_shell(shell, payload):
    """Send JSON-RPC request to shell's stdin."""
    if not shell.alive:
        raise RuntimeError("Shell is not running")
    
    # Convert to JSON string
    line = json.dumps(payload) + '\n'
    
    # Write to shell's stdin
    shell.process.stdin.write(line.encode('utf-8'))
    shell.process.stdin.flush()
```

**Example:**
```python
shell = get_or_spawn_my_service()
send_request_to_shell(shell, {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": "req-1",
    "params": {"name": "hello", "arguments": {}}
})
```

### 9.4. Reading from the Shell (Receiving Output)

**Option 1: Read from stdout log file (simple, polling-based)**

```python
def read_shell_logs(shell, tail_lines=100):
    """Read recent lines from shell's stdout log."""
    manager = get_framework_shell_manager()
    result = manager.get_shell_details(shell.id, logs=True, tail=tail_lines)
    return result.get('stdout_lines', [])
```

**Option 2: Stream from stdout (real-time, blocking)**

```python
def stream_shell_output(shell):
    """Stream lines from shell's stdout."""
    if not shell.process or not shell.process.stdout:
        raise RuntimeError("Shell process not available")
    
    for line in iter(shell.process.stdout.readline, b''):
        if not line:
            break
        yield line.decode('utf-8').rstrip('\n')
```

**Example:**
```python
shell = get_or_spawn_my_service()
for line in stream_shell_output(shell):
    data = json.loads(line)
    if data.get('method') == 'response':
        print(f"Got response: {data}")
```

**Option 3: Non-blocking read with select/poll**

```python
import select
import json

def read_shell_nonblocking(shell, timeout=0.1):
    """Read available lines from shell without blocking."""
    if not shell.process or not shell.process.stdout:
        return []
    
    lines = []
    while True:
        ready, _, _ = select.select([shell.process.stdout], [], [], timeout)
        if not ready:
            break
        line = shell.process.stdout.readline()
        if not line:
            break
        lines.append(line.decode('utf-8').rstrip('\n'))
    
    return lines
```

### 9.5. Complete Example: JSON-RPC Service

```python
# app/apps/my_app/my_service.py

import json
import uuid
from app.framework_shells import get_framework_shell_manager

class MyServiceClient:
    def __init__(self):
        self.manager = get_framework_shell_manager()
        self.shell = None
        self.pending_requests = {}
    
    def connect(self):
        """Connect to existing shell or spawn new one."""
        # Check for existing shell
        shells = self.manager.list_shells()
        for shell in shells:
            if shell.label == 'my-service' and shell.alive:
                self.shell = shell
                return
        
        # Spawn new shell
        self.shell = self.manager.spawn_shell(
            command=['my-service', '--json-rpc'],
            label='my-service',
            cwd='/tmp',
            autostart=False
        )
    
    def send_request(self, method, params=None):
        """Send JSON-RPC request, return request ID."""
        if not self.shell or not self.shell.alive:
            raise RuntimeError("Not connected")
        
        request_id = str(uuid.uuid4())
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "id": request_id,
            "params": params or {}
        }
        
        line = json.dumps(payload) + '\n'
        self.shell.process.stdin.write(line.encode('utf-8'))
        self.shell.process.stdin.flush()
        
        return request_id
    
    def read_responses(self, timeout=0.1):
        """Read all available responses from shell."""
        if not self.shell or not self.shell.process:
            return []
        
        import select
        responses = []
        
        while True:
            ready, _, _ = select.select([self.shell.process.stdout], [], [], timeout)
            if not ready:
                break
            
            line = self.shell.process.stdout.readline()
            if not line:
                break
            
            try:
                data = json.loads(line.decode('utf-8'))
                responses.append(data)
            except json.JSONDecodeError:
                continue
        
        return responses
    
    def shutdown(self):
        """Gracefully shutdown the shell."""
        if self.shell:
            self.manager.stop_shell(self.shell.id)
            self.shell = None

# Usage:
client = MyServiceClient()
client.connect()

# Send request
req_id = client.send_request('my_method', {'arg': 'value'})

# Read responses
for response in client.read_responses():
    if response.get('id') == req_id:
        print(f"Got result: {response['result']}")

# Clean up
client.shutdown()
```

### 9.6. WebSocket Integration Pattern

**For apps that need to expose shell I/O via WebSocket:**

```python
# app/apps/my_app/main.py

from flask import Blueprint
from flask_sock import Sock

bp = Blueprint('my_app', __name__)
sock = Sock()

@sock.route('/ws/my_service')
def my_service_websocket(ws):
    """WebSocket endpoint that bridges to framework shell."""
    from .my_service import MyServiceClient
    
    client = MyServiceClient()
    client.connect()
    
    try:
        while True:
            # Receive from WebSocket
            msg = ws.receive()
            if not msg:
                break
            
            data = json.loads(msg)
            
            # Send to shell
            req_id = client.send_request(data['method'], data.get('params'))
            
            # Read responses from shell
            for response in client.read_responses(timeout=30.0):
                # Forward to WebSocket
                ws.send(json.dumps(response))
                
                if response.get('id') == req_id:
                    break
    
    finally:
        # Don't shutdown shell - keep it running for other connections
        pass
```

### 9.7. Best Practices

**1. Use labels for discovery**
```python
# Good: Apps can find their shell by label
shell = manager.spawn_shell(
    command=['my-service'],
    label='my-service'  # Unique, descriptive
)
```

**2. Check if shell exists before spawning**
```python
# Good: Reuse existing shell
shells = manager.list_shells()
existing = next((s for s in shells if s.label == 'my-service' and s.alive), None)
if existing:
    return existing
else:
    return manager.spawn_shell(...)
```

**3. Handle shell death gracefully**
```python
# Good: Detect and respawn
if not shell.alive:
    manager.remove_shell(shell.id, force=True)
    shell = manager.spawn_shell(...)
```

**4. Don't rely on shell persistence**
```python
# Bad: Storing critical state in shell process
# Good: Store state in backend (database, files)
```

**5. Clean up on app shutdown**
```python
# In your app's cleanup hook
def cleanup():
    manager = get_framework_shell_manager()
    shells = manager.list_shells()
    for shell in shells:
        if shell.label == 'my-service':
            manager.stop_shell(shell.id)
```

**6. Use structured logging**
```python
# Shell's stdout/stderr are captured to log files
# Make your CLI tool log JSON for easy parsing:
# {"level": "info", "msg": "Started processing", "timestamp": "..."}
```

**7. Respect timeout settings**
```python
# Framework automatically cleans up idle shells based on timeout
# Don't keep shells alive artificially - let them timeout
```

### 9.8. Debugging Framework Shells

**View shell list:**
```bash
curl http://localhost:8088/api/framework_shells | jq
```

**View shell logs:**
```bash
curl 'http://localhost:8088/api/framework_shells/<shell-id>?logs=true&tail=100' | jq
```

**Manual log file inspection:**
```bash
# Stdout log
tail -f ~/.cache/te_framework/logs/fs_<shell-id>.stdout.log

# Stderr log
tail -f ~/.cache/te_framework/logs/fs_<shell-id>.stderr.log
```

**Check shell metadata:**
```bash
cat ~/.cache/te_framework/meta/<shell-id>/meta.json | jq
```

**Force kill stuck shell:**
```bash
curl -X POST http://localhost:8088/api/framework_shells/<shell-id>/action \
  -H 'Content-Type: application/json' \
  -d '{"action":"kill"}'
```

### 9.9. Common Patterns

**Pattern: Request-Response (Synchronous)**
```python
# Send request
req_id = send_request(shell, {'method': 'query', 'params': {...}})

# Wait for response
for line in stream_shell_output(shell):
    data = json.loads(line)
    if data.get('id') == req_id:
        return data['result']
```

**Pattern: Streaming Events (Asynchronous)**
```python
# Send request
send_request(shell, {'method': 'subscribe', 'params': {'topic': 'events'}})

# Stream events indefinitely
for line in stream_shell_output(shell):
    event = json.loads(line)
    handle_event(event)
```

**Pattern: Multiple Clients, Single Shell**
```python
# Client 1 sends request with id='req-1'
# Client 2 sends request with id='req-2'
# Both read from same shell stdout
# Each filters responses by matching request ID
```

## 10. Future Enhancements

- Declarative auto-start file (`config/framework_shells.toml`)
- Event bus hooks for crash notifications
- Optional process quotas per extension/app
- Richer metrics (I/O, GPU) and WebSocket log streaming
- Integration UI for managing framework shells graphically
- Built-in bridging helpers for common protocols (LSP, MCP, JSON-RPC)

## 11. Operator Controls & UI

- **🎛️ Settings App:** Surfaces the metrics endpoint, lists all framework shells
  with stop/kill/restart/remove actions, and exposes the supervisor shutdown
  control. Extension ordering is also managed here via `/api/settings`. Shell
  timeout configuration also available.
- **Supervisor script (`scripts/run_framework.sh`):** Preferred entry point; tags
  the current run, writes the ID to disk, launches `app.supervisor`, and cleans up
  shells on exit. Respects user-configured timeout settings.

---

**Last Updated:** November 17, 2025  
**Updated by:** Atlas

---

## 12. Architecture Integration

### Shutdown Sequence

The framework uses **IPC-orchestrated shutdown** instead of direct supervisor management:

1. **User triggers**: `Ctrl+C` or `kill` signal to supervisor process
2. **Supervisor handler** (`app/supervisor.py`): 
   - Catches `SIGTERM`/`SIGINT`
   - POSTs to `http://127.0.0.1:9123/actions/shutdown` (IPC server)
3. **IPC ProcessRegistry** (`app/ipc/process_manager.py`):
   - `shutdown_all()` terminates registered processes sequentially:
     - Workers (type="worker") and shells (type="shell") first
     - Framework (type="framework") last
   - Per-process: `SIGTERM` → poll up to 2s (checking `/proc/{pid}/stat`) → `SIGKILL` if needed
   - Tracks force-killed shells for log preservation
4. **Supervisor cleanup**:
   - Kills IPC server (`TE_IPC_PID`)
   - Deletes `~/.cache/te_framework/run_id`
   - Exits
5. **Next startup**:
   - `scripts/run_framework.sh` calls `cleanup_framework_shell_logs()`
   - Archives leftover logs to `~/.cache/te_framework/preserved_logs/logs_{timestamp}/`
   - Cleans archives older than 7 days

### PTY Architecture

For interactive shells (`uses_pty=True`):

```
┌─────────────────────────────────────────────────────────┐
│ Client (Browser/API)                                              │
│  ↓ POST /spawn_pty                                                │
│  ↓ WS /api/framework_shells/<id>/ws (bidirectional)               │
│  ↓ POST /api/framework_shells/<id>/write                          │
└─────────────────────────────────────────────────────────┘
                    ↓ ↑
┌─────────────────────────────────────────────────────────┐
│ FrameworkShellManager                                             │
│  - PTYState(master_fd, subscribers[], reader_task)                │
│  - _pty[shell_id] → PTY state tracking                           │
│  - Background task: read master_fd → broadcast chunks            │
│  - write_to_pty(): client input → master_fd                      │
│  - subscribe_output(): register client queue                      │
└─────────────────────────────────────────────────────────┘
                    ↓ ↑
┌─────────────────────────────────────────────────────────┐
│ PTY Pair (from pty.openpty())                                     │
│  - master_fd: manager reads/writes                                │
│  - slave_fd: process stdin/stdout/stderr                          │
└─────────────────────────────────────────────────────────┘
                    ↓ ↑
┌─────────────────────────────────────────────────────────┐
│ Shell Process                                                     │
│  - command[0] as PID with env: TE_TTY=pty                         │
│  - Interactive I/O via PTY slave                                  │
└─────────────────────────────────────────────────────────┘
```

### Log Architecture

```
~/.cache/te_framework/
├── run_id                           # Current run ID (deleted on shutdown)
├── ipc.pid                          # IPC server PID
├── meta/
│   ├── fs_1700000001_abc123.json   # ShellRecord (flat JSON)
│   └── fs_1700000002_def456.json
├── logs/
│   ├── fs-1700000001_abc123/       # Shell-specific log directory
│   │   ├── stdout.log
│   │   └── stderr.log
│   └── fs-1700000002_def456/
│       ├── stdout.log
│       └── stderr.log
└── preserved_logs/
    ├── logs_1700000000/            # Archived from previous run
    │   └── fs-<old_id>/
    └── logs_1699999000/            # Cleaned after 7 days
```

### Process Registry (IPC)

All framework-managed processes register with IPC:

```python
# Registration at startup (app/main.py lifespan)
register_process(
    pid=framework_pid,
    type="framework",
    label="main-framework",
    metadata={"run_id": TE_RUN_ID, "port": 8088}
)

# Workers register via app_manager.py
register_process(
    pid=worker_pid,
    type="worker",
    label=f"worker-{app_id}",
    metadata={"app_id": app_id, "port": port}
)

# Shells register via framework_shells.py
register_process(
    pid=shell.pid,
    type="shell",
    label=shell.label or f"shell-{shell.id}",
    metadata={"shell_id": shell.id, "uses_pty": shell.uses_pty}
)
```

### Missing from Original Documentation

1. **PTY support**: Entire PTY infrastructure (`spawn_pty`, `/write`, `/ws`, streaming)
2. **IPC integration**: Process registry, coordinated shutdown sequence
3. **Adoption behavior**: `_adopt_orphaned_shells()` reclaiming processes from crashes
4. **Log directory structure**: Flat JSON metadata files, shell-specific log directories
5. **Separate limits**: `TE_MAX_APP_SHELLS` vs `TE_MAX_SERVICE_SHELLS`
6. **Group termination**: `POST /api/framework_shells/terminate_group`
7. **FastAPI migration**: No longer uses Flask (now async FastAPI with APIRouter)

---

These notes reflect the implementation currently available in
`app/libs/framework_shells.py`, `app/supervisor.py`, `app/ipc/process_manager.py`,
`scripts/run_framework.sh`, and the Settings app.

**Last Updated:** November 17, 2025  
**Updated by:** Atlas
