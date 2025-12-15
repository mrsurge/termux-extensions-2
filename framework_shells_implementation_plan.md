# Framework Shells Fork — Comprehensive Implementation Plan

**Date:** December 15, 2025  
**Status:** Ready for Execution  
**Prerequisite Documents:**
- `framework_shells_project_fork.md` — Product vision ("10/10" plan)
- `framework_shells_execution_plan.md` — Execution phases outline
- `app-worker_integration_issues.md` — TE2 app-worker integration
- `pillar4draft.md` — dtach PTY persistence

---

## Executive Summary

This document consolidates the complete implementation plan for transforming Framework Shells from an internal TE2 component into a **standalone, manifest-driven local process platform**. It synthesizes all companion documentation and source code analysis into a single actionable roadmap.

**End Goal:** `pipx install framework-shells` + `shellspec.yaml` = working local services with attach-like-tmux persistence.

---

## Part 1: Current Architecture Analysis

### 1.1 Core Components Inventory

| Component | File | Purpose | Fork Strategy |
|-----------|------|---------|---------------|
| `FrameworkShellManager` | `app/libs/framework_shells.py` | PTY spawn, record persistence, lifecycle | Extract to `framework_shells/manager.py` |
| `ShellRecord` | `app/libs/framework_shells.py` | Shell metadata dataclass | Extract to `framework_shells/record.py` |
| `PTYState` | `app/libs/framework_shells.py` | In-memory PTY tracking | Extract to `framework_shells/pty.py` |
| `PipeState` | `app/libs/framework_shells.py` | LSP stdin/stdout pipes | Extract to `framework_shells/pty.py` |
| `ProcessRegistry` | `app/ipc/process_manager.py` | Cross-process tracking | Keep in TE2; library emits events |
| `IPC Server` | `app/ipc/server.py` | Flask REST + SSE | Keep in TE2 |
| `IPC Client` | `app/ipc/client.py` | HTTP client helpers | Keep in TE2 as adapter |
| `app_lifecycle` | `app/libs/app_lifecycle.py` | App TTL, cleanup | Keep in TE2 |
| `app_manager` | `app/libs/app_manager.py` | App worker spawn | Keep in TE2 |
| `shell_groups` | `app/libs/shell_groups.py` | Group termination | Extract to library |
| `sessions_and_shortcuts` | `app/extensions/sessions_and_shortcuts/` | Dashboard UI | Keep in TE2; update for events |
| `run_framework.sh` | `scripts/run_framework.sh` | Startup script | Modify for secret plumbing |

### 1.2 Storage Layout (Current)

```
~/.cache/te_framework/
├── run_id                           # Current run identifier (persisted by supervisor)
├── ipc.pid                          # IPC server PID
├── running_apps.json                # App worker registry
├── meta/
│   └── <shell_id>/meta.json         # ShellRecord JSON
├── logs/
│   └── <shell_id>.stdout.log        # PTY/stdout output
├── preserved_logs/                  # Archived logs from previous runs
│   └── logs_<timestamp>/
└── sockets/                         # Unused currently
```

### 1.3 Process Hierarchy (Current)

```
Main Framework (app.supervisor)
├── IPC Server (app.ipc.server)
├── Framework Shell Manager (embedded in app.main)
│   ├── App Worker: file_editor_cm6 (label="app-worker:file_editor_cm6")
│   │   ├── LSP Server (label="lsp-pyright-<hash>", subgroups=["file_editor_cm6", "lsp"])
│   │   ├── Terminal (label="editor-terminal-<n>", subgroups=["file_editor_cm6", "project:myapp"])
│   │   └── Agent (label="agent-codex-<session>", subgroups=["file_editor_cm6"])
│   └── Service Shell: aria2 (label="aria2-rpc", subgroups=["download"])
```

### 1.4 Key Limitations Identified

1. **No Runtime Isolation**: Two repo clones share `~/.cache/te_framework/` — they can see/control each other's shells.
2. **No Record Signing**: Shell records are trusted implicitly — any process can forge them.
3. **Polling UI**: Sessions & Shortcuts polls every 5 seconds — wasteful and laggy.
4. **PTY Not Persistent**: If manager restarts, PTY master_fd is lost — shell becomes orphaned.
5. **No Standalone CLI**: Framework shells require TE2 FastAPI context — can't run independently.
6. **Auth Surface Fragmented**: `X-Framework-Key` header vs. no auth on read endpoints.

---

## Part 2: Target Architecture

### 2.1 Package Structure

```
framework_shells/
├── __init__.py
├── py.typed                      # PEP 561 marker
├── auth.py                       # Secret derivation, signing, token verification
├── store.py                      # RuntimeStore (namespaced paths)
├── record.py                     # ShellRecord dataclass + app context
├── manager.py                    # FrameworkShellManager (core logic)
├── events.py                     # EventBus, EventType, ShellEvent
├── shellspec.py                  # YAML manifest parser
├── orchestrator.py               # up/down, readiness probes, restart policies
├── diag.py                       # Diagnostics bundle generation
├── pty.py                        # PTY helpers, dtach integration
├── groups.py                     # Group operations (from shell_groups.py)
├── cli/
│   ├── __init__.py
│   └── main.py                   # Click CLI (`fs` command)
└── api/
    ├── __init__.py
    ├── fastapi_router.py         # FastAPI adapter
    └── websocket.py              # WS event stream adapter
```

### 2.2 TE2 Adapter Layer (Stays in TE2)

```
app/
├── libs/
│   ├── framework_shells_te2_adapter.py  # NEW: Thin glue layer
│   ├── app_manager.py                   # Uses adapter
│   └── app_lifecycle.py                 # Uses adapter
└── extensions/
    └── sessions_and_shortcuts/
        └── main.py                      # Event-driven updates
```

### 2.3 Storage Layout (New)

```
~/.cache/te_framework/
├── runtimes/
│   └── <repo_fingerprint>/              # sha256(realpath(REPO_ROOT))[:16]
│       ├── secret                       # 64-char hex secret (chmod 600)
│       └── <runtime_id>/                # sha256(secret)[:16]
│           ├── meta/
│           │   └── <shell_id>/meta.json # Signed ShellRecord
│           ├── logs/
│           │   └── <shell_id>.stdout.log
│           └── sockets/
│               └── <shell_id>.sock      # dtach socket (chmod 600)
├── preserved_logs/                      # Archived logs (unchanged)
└── ipc.pid                              # IPC server PID (unchanged)
```

---

## Part 3: Implementation Phases

### Phase 1: Secret Plumbing

**Objective:** Establish per-repo clone secret for runtime isolation

#### 1.1 Bash Script Changes (`scripts/run_framework.sh`)

Add functions to compute repo fingerprint and manage secrets:

```bash
compute_repo_fingerprint() {
  local real_root
  real_root="$(readlink -f "$REPO_ROOT" 2>/dev/null || python3 -c "import os; print(os.path.realpath('$REPO_ROOT'))")"
  echo -n "$real_root" | sha256sum | cut -c1-16
}

ensure_framework_secret() {
  local fingerprint secret_dir secret_file
  fingerprint="$(compute_repo_fingerprint)"
  secret_dir="$HOME/.cache/te_framework/runtimes/$fingerprint"
  secret_file="$secret_dir/secret"
  
  if [ -f "$secret_file" ]; then
    FRAMEWORK_SHELLS_SECRET="$(cat "$secret_file")"
  else
    mkdir -p "$secret_dir"
    FRAMEWORK_SHELLS_SECRET="$(openssl rand -hex 32)"
    echo "$FRAMEWORK_SHELLS_SECRET" > "$secret_file"
    chmod 600 "$secret_file"
  fi
  
  export FRAMEWORK_SHELLS_SECRET
  export TE_REPO_FINGERPRINT="$fingerprint"
}
```

**Insert location:** After `generate_run_id_if_needed` call, before `cleanup_framework_shell_logs`.

#### 1.2 Auth Module (`framework_shells/auth.py`)

```python
import hashlib
import hmac
import json
import os
from typing import Optional

def get_secret() -> str:
    """Get secret from environment, raise if missing."""
    secret = os.environ.get("FRAMEWORK_SHELLS_SECRET", "")
    if not secret:
        raise RuntimeError("FRAMEWORK_SHELLS_SECRET is required")
    return secret

def derive_runtime_id(secret: str) -> str:
    """sha256(secret)[:16] — namespace identifier."""
    return hashlib.sha256(secret.encode()).hexdigest()[:16]

def derive_api_token(secret: str) -> str:
    """HMAC(secret, 'api') — bearer token for mutations."""
    return hmac.new(secret.encode(), b"api", hashlib.sha256).hexdigest()

def sign_record(secret: str, record_dict: dict) -> str:
    """HMAC signature over canonical JSON (excludes signature field)."""
    clean = {k: v for k, v in record_dict.items() if k != "signature"}
    canonical = json.dumps(clean, sort_keys=True, separators=(",", ":"))
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

def verify_record(secret: str, record_dict: dict) -> bool:
    """Verify record signature matches."""
    expected = sign_record(secret, record_dict)
    return hmac.compare_digest(record_dict.get("signature", ""), expected)
```

#### 1.3 Files Changed

| File | Change |
|------|--------|
| `scripts/run_framework.sh` | Add `compute_repo_fingerprint()`, `ensure_framework_secret()`, export vars |
| `framework_shells/auth.py` | New file |

#### 1.4 Acceptance Tests

- [ ] Two clones generate different `TE_REPO_FINGERPRINT` values
- [ ] Secret file created with correct permissions (0600)
- [ ] Re-running uses existing secret (stable)
- [ ] `derive_runtime_id()` produces consistent 16-char hex

---

### Phase 2: Runtime Isolation

**Objective:** Namespace storage, sign records, enforce auth

#### 2.1 RuntimeStore (`framework_shells/store.py`)

```python
from pathlib import Path
from typing import Optional
import os

from .auth import get_secret, derive_runtime_id

class RuntimeStore:
    """Namespaced storage paths for a framework runtime."""
    
    def __init__(self, base_dir: Optional[Path] = None):
        self.secret = get_secret()
        self.runtime_id = derive_runtime_id(self.secret)
        
        base = base_dir or Path.home() / ".cache" / "te_framework"
        fingerprint = os.environ.get("TE_REPO_FINGERPRINT")
        if not fingerprint:
            raise RuntimeError("TE_REPO_FINGERPRINT not set")
        
        self.root = base / "runtimes" / fingerprint / self.runtime_id
        self.metadata_dir = self.root / "meta"
        self.logs_dir = self.root / "logs"
        self.sockets_dir = self.root / "sockets"
        
        for d in (self.metadata_dir, self.logs_dir, self.sockets_dir):
            d.mkdir(parents=True, exist_ok=True)
```

#### 2.2 ShellRecord Extensions (`framework_shells/record.py`)

Add new fields to `ShellRecord`:

```python
@dataclass
class ShellRecord:
    # ... existing fields ...
    
    # Runtime isolation (Phase 2)
    runtime_id: Optional[str] = None
    signature: Optional[str] = None
    
    # App context (Phase 2A)
    app_id: Optional[str] = None
    parent_shell_id: Optional[str] = None
    is_app_worker: bool = False
    
    def derive_app_id(self) -> Optional[str]:
        """Extract app_id from label or subgroups."""
        if self.label and self.label.startswith("app-worker:"):
            return self.label.split(":", 1)[1]
        if self.subgroups:
            return self.subgroups[0]
        return None
    
    def sign(self, secret: str) -> None:
        """Sign record with secret."""
        from .auth import sign_record, derive_runtime_id
        self.runtime_id = derive_runtime_id(secret)
        self.signature = sign_record(secret, self.to_dict())
    
    def verify(self, secret: str) -> bool:
        """Verify record signature."""
        from .auth import verify_record, derive_runtime_id
        if self.runtime_id != derive_runtime_id(secret):
            return False
        return verify_record(secret, self.to_dict())
```

#### 2.3 Manager Changes (`framework_shells/manager.py`)

Update record creation and adoption:

```python
class FrameworkShellManager:
    def __init__(self, *, store: Optional[RuntimeStore] = None, ...):
        self.store = store or RuntimeStore()
        self.metadata_dir = self.store.metadata_dir
        self.logs_dir = self.store.logs_dir
        self.sockets_dir = self.store.sockets_dir
        # ... rest unchanged ...
    
    async def _save_record(self, record: ShellRecord) -> None:
        # Sign before saving
        record.sign(self.store.secret)
        # ... existing save logic ...
    
    async def _load_record(self, shell_id: str) -> Optional[ShellRecord]:
        record = await self._load_record_raw(shell_id)
        if record and not record.verify(self.store.secret):
            # Foreign record — ignore (do not adopt, do not purge)
            return None
        return record
    
    async def _adopt_orphaned_shells(self) -> None:
        # Only adopt records that verify with our secret
        # Foreign/legacy records are ignored, NOT purged
        async for record in self._aiter_records():
            if not record.verify(self.store.secret):
                # Foreign record — skip silently, leave on disk
                continue
            # ... existing adoption logic ...
```

#### 2.4 Auth Enforcement (`framework_shells/api/fastapi_router.py`)

```python
from fastapi import Header, HTTPException, Depends
import hmac
from ..auth import get_secret, derive_api_token

async def require_auth(authorization: str = Header(...)) -> None:
    """Require valid Bearer token for mutating endpoints."""
    secret = get_secret()  # Raises if not set — no fallback
    expected = derive_api_token(secret)
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(403, "Authorization header must use Bearer scheme")
    
    token = authorization[7:]
    if not hmac.compare_digest(token, expected):
        raise HTTPException(403, "Invalid auth token")

# Apply to mutating endpoints
@router.post("/api/framework_shells")
async def create_shell(_: None = Depends(require_auth), ...):
    ...
```

#### 2.5 Files Changed

| File | Change |
|------|--------|
| `framework_shells/store.py` | New file — `RuntimeStore` |
| `framework_shells/record.py` | Add `signature`, `runtime_id`, `app_id`, `parent_shell_id`, `is_app_worker`, `sign()`, `verify()` |
| `framework_shells/manager.py` | Use `RuntimeStore`, sign on save, verify on load |
| `framework_shells/api/fastapi_router.py` | Add `require_auth` dependency |

#### 2.6 Acceptance Tests

- [ ] Clone A's shells invisible to Clone B
- [ ] Foreign (unsigned) records ignored on adopt (not purged)
- [ ] Mutating endpoints require valid `Authorization: Bearer` token

---

### Phase 3: Event Bus

**Objective:** Replace 5s polling with push-based lifecycle events

#### 3.0 Architectural Decision: Single Control-Plane Manager

TE2 runs multiple Python processes (framework + app workers). An in-process singleton `EventBus` won't work across process boundaries.

**Decision:** Single control-plane manager model.

- Only the **framework process** owns the `FrameworkShellManager` and event bus.
- App workers **never instantiate managers** — they call the framework via HTTP/WS for spawn/terminate/write/list.
- Events are emitted in the framework process and streamed to UI subscribers.

This matches the existing TE2 architecture where app workers already call the framework's API endpoints.

#### 3.1 Event Types (`framework_shells/events.py`)

```python
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional, Callable, Set
from asyncio import Queue as AsyncQueue
import asyncio
import time

class EventType(Enum):
    SHELL_CREATED = "shell.created"
    SHELL_SPAWNED = "shell.spawned"
    SHELL_READY = "shell.ready"
    SHELL_UPDATED = "shell.updated"
    SHELL_EXITED = "shell.exited"
    SHELL_REMOVED = "shell.removed"
    PTY_CHUNK = "shell.pty_chunk"
    LOG_CHUNK = "shell.log_chunk"

@dataclass
class ShellEvent:
    type: EventType
    shell_id: str
    timestamp: float = field(default_factory=time.time)
    data: Dict[str, Any] = field(default_factory=dict)
    
    # App context (derived from record)
    app_id: Optional[str] = None
    parent_shell_id: Optional[str] = None
    is_app_worker: bool = False
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "shell_id": self.shell_id,
            "timestamp": self.timestamp,
            "data": self.data,
            "app_id": self.app_id,
            "parent_shell_id": self.parent_shell_id,
            "is_app_worker": self.is_app_worker,
        }

class EventBus:
    """In-process event bus with subscription support.
    
    NOTE: This bus is local to a single Python process. TE2 uses a
    single control-plane manager model — only the framework process
    instantiates a manager. App workers call the framework via HTTP.
    """
    
    def __init__(self):
        self._subscribers: Set[AsyncQueue[ShellEvent]] = set()
    
    def subscribe(self) -> AsyncQueue[ShellEvent]:
        q: AsyncQueue[ShellEvent] = AsyncQueue()
        self._subscribers.add(q)
        return q
    
    def unsubscribe(self, q: AsyncQueue[ShellEvent]) -> None:
        self._subscribers.discard(q)
    
    async def publish(self, event: ShellEvent) -> None:
        for q in list(self._subscribers):
            try:
                await q.put(event)
            except Exception:
                self._subscribers.discard(q)

# Singleton
_bus: Optional[EventBus] = None

def get_event_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
```

#### 3.2 Manager Integration

Add event emission to lifecycle methods:

```python
class FrameworkShellManager:
    def __init__(self, ...):
        ...
        self._event_bus = get_event_bus()
    
    async def _emit(self, event_type: EventType, record: ShellRecord, **extra):
        event = ShellEvent(
            type=event_type,
            shell_id=record.id,
            data={**record.to_payload(), **extra},
            app_id=record.app_id or record.derive_app_id(),
            parent_shell_id=record.parent_shell_id,
            is_app_worker=record.is_app_worker,
        )
        await self._event_bus.publish(event)
    
    async def spawn_shell_pty(self, ...):
        record = self._create_record(...)
        await self._emit(EventType.SHELL_CREATED, record)
        
        record = await self._launch_pty(record)
        await self._emit(EventType.SHELL_SPAWNED, record)
        
        return record
    
    async def terminate_shell(self, shell_id: str, ...):
        ...
        await self._emit(EventType.SHELL_EXITED, record, exit_code=exit_code)
        return record
```

#### 3.3 WebSocket Transport (`framework_shells/api/websocket.py`)

```python
from fastapi import WebSocket, WebSocketDisconnect
from ..events import get_event_bus

async def shell_events_ws(websocket: WebSocket):
    """Stream all shell lifecycle events."""
    await websocket.accept()
    bus = get_event_bus()
    q = bus.subscribe()
    
    try:
        while True:
            event = await q.get()
            await websocket.send_json(event.to_dict())
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(q)
```

#### 3.4 Sessions & Shortcuts Migration

Update `app/extensions/sessions_and_shortcuts/main.py`:

```python
# BEFORE (polling)
@sessions_bp.websocket('/ws')
async def sessions_ws(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # ... collect data ...
            await websocket.send_json(payload)
            await asyncio.sleep(5)  # 5s polling
    except WebSocketDisconnect:
        return

# AFTER (event-driven)
@sessions_bp.websocket('/ws')
async def sessions_ws(websocket: WebSocket):
    await websocket.accept()
    from framework_shells.events import get_event_bus
    
    bus = get_event_bus()
    q = bus.subscribe()
    
    # Send initial snapshot
    frameworks = await _list_framework_shells()
    ipc_processes = await _list_ipc_processes()
    shell_trees = _build_shell_trees(frameworks, ipc_processes)
    framework_ui = _load_framework_shell_ui_by_app()
    
    await websocket.send_json({
        "type": "snapshot",
        "frameworks": frameworks,
        "shell_trees": shell_trees,
        "framework_ui": framework_ui,
    })
    
    # Stream incremental events
    try:
        while True:
            event = await q.get()
            await websocket.send_json({
                "type": "event",
                "event": event.to_dict(),
            })
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(q)
```

#### 3.6 Files Changed

| File | Change |
|------|--------|
| `framework_shells/events.py` | New file — `EventType`, `ShellEvent`, `EventBus` |
| `framework_shells/manager.py` | Add `_emit()` calls at lifecycle points |
| `framework_shells/api/websocket.py` | New file — `/ws/events` endpoint |
| `app/extensions/sessions_and_shortcuts/main.py` | Migrate from polling to events |

#### 3.7 Acceptance Tests

- [ ] Event emitted on shell spawn
- [ ] Event emitted on shell exit
- [ ] WebSocket receives events in real-time
- [ ] Sessions & Shortcuts updates instantly on spawn/exit
- [ ] App workers use HTTP API (not local manager instances)

---

### Phase 4: dtach-Backed PTY Persistence

**Objective:** Attach/reconnect without losing the shell

#### 4.1 Prerequisites

- `dtach` installed (`pkg install dtach` on Termux)
- dtach socket permissions enforced (0600)

#### 4.2 DTachState Dataclass (`framework_shells/pty.py`)

```python
@dataclass
class DTachState:
    socket_path: Path
    shell_id: str
    label: Optional[str] = None
    
    # Bridge process (dtach -a subprocess behind local PTY)
    bridge_process: Optional[asyncio.subprocess.Process] = None
    bridge_master_fd: Optional[int] = None
    
    subscribers: List[AsyncQueue[str]] = field(default_factory=list)
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    reader: Optional[asyncio.Task] = None
```

#### 4.3 Launch with dtach (`framework_shells/manager.py`)

Replace `pty.openpty()` spawn with dtach:

```python
async def _launch_pty(self, record: ShellRecord) -> ShellRecord:
    record.uses_pty = True
    socket_path = self.store.sockets_dir / f"{record.id}.sock"
    
    # Spawn command inside dtach (daemon mode)
    dtach_cmd = ["dtach", "-n", str(socket_path)] + record.command
    envp = self._prepare_env(record)
    envp.setdefault("TERM", "xterm-256color")
    
    proc = await asyncio.create_subprocess_exec(
        *dtach_cmd,
        cwd=record.cwd,
        env=envp,
        start_new_session=True,
    )
    
    # Wait for socket to appear
    await self._wait_for_socket(socket_path, timeout=5.0)

    # IMPORTANT: record.pid tracks the dtach daemon PID.
    #
    # dtach owns the real PTY and supervises the child shell. Using the dtach PID
    # as the managed PID makes liveness/adoption reliable without needing fragile
    # “find the child pid” logic.
    #
    # If we later want to expose the child PID for diagnostics, we can derive it
    # via process-tree inspection (psutil) as an optional enhancement, but it is
    # not required for correctness.
    record.pid = proc.pid
    record.status = "running"
    record.updated_at = time.time()
    await self._save_record(record)
    
    # Connect bridge for reading
    state = await self._connect_dtach(record.id, socket_path, record.label)
    self._dtach[record.id] = state
    
    return record

async def _connect_dtach(self, shell_id: str, socket_path: Path, label: str) -> DTachState:
    """Create bridge subprocess for reading from dtach."""
    # Create local PTY for bridge
    master_fd, slave_fd = await asyncio.to_thread(pty.openpty)
    
    # Run dtach -a with slave as its TTY
    proc = await asyncio.create_subprocess_exec(
        "dtach", "-a", str(socket_path),
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
    )
    
    await asyncio.to_thread(os.close, slave_fd)
    
    state = DTachState(
        socket_path=socket_path,
        shell_id=shell_id,
        label=label,
        bridge_process=proc,
        bridge_master_fd=master_fd,
    )
    
    # Start reader task
    state.reader = asyncio.create_task(self._dtach_reader(state))
    return state
```

#### 4.4 Reconnection on Adopt

```python
async def _adopt_orphaned_shells(self) -> None:
    async for record in self._aiter_records():
        if not record.verify(self.store.secret):
            # Foreign/legacy record — ignore (do not adopt, do not purge)
            continue
        
        if record.uses_pty:
            socket_path = self.store.sockets_dir / f"{record.id}.sock"
            if socket_path.exists() and await self._is_pid_alive(record.pid):
                # Shell survived! Reconnect to dtach
                state = await self._connect_dtach(record.id, socket_path, record.label)
                self._dtach[record.id] = state
                record.adopted = True
                await self._save_record(record)
```

#### 4.5 Replay API (`framework_shells/api/fastapi_router.py`)

```python
@router.get("/api/framework_shells/{shell_id}/replay")
async def replay_shell_output(
    shell_id: str,
    mgr: FrameworkShellManager = Depends(get_manager),
    lines: int = Query(1000),
) -> Any:
    """Return historical output for scrollback restoration."""
    record = await mgr.get_shell(shell_id)
    if not record:
        raise HTTPException(404, "Shell not found")
    
    log_path = Path(record.stdout_log)
    if not log_path.exists():
        return {"ok": True, "data": {"lines": [], "total": 0}}
    
    content = await mgr._read_log_tail(log_path, lines)
    return {"ok": True, "data": {"lines": content, "total": len(content)}}
```

#### 4.6 ShellRecord Schema Update

```python
@dataclass
class ShellRecord:
    # ... existing fields ...
    uses_dtach: bool = False
    dtach_socket: Optional[str] = None  # Path to socket
```

#### 4.7 Files Changed

| File | Change |
|------|--------|
| `framework_shells/pty.py` | New file — `DTachState`, dtach helpers |
| `framework_shells/manager.py` | `_launch_pty()` uses dtach, `_connect_dtach()`, adopt reconnects |
| `framework_shells/record.py` | Add `uses_dtach`, `dtach_socket` |
| `framework_shells/api/fastapi_router.py` | Add `/replay` endpoint |

#### 4.8 Acceptance Tests

- [ ] Shell survives browser reload
- [ ] Shell survives framework restart (dtach socket persists)
- [ ] Scrollback restored on reconnect
- [ ] Resize works after reconnection
- [ ] dtach sockets have correct permissions (0600)

---

### Phase 5: Shellspec + CLI

**Objective:** Declarative manifests, standalone CLI

#### 5.1 Shellspec Schema (`framework_shells/shellspec.py`)

```python
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional
import os
import yaml

@dataclass
class ReadinessProbe:
    type: str  # "stdout_regex" | "tcp_port" | "http_ok"
    timeout: float = 30.0
    pattern: Optional[str] = None      # stdout_regex
    port: Optional[int] = None         # tcp_port
    url: Optional[str] = None          # http_ok
    status_codes: List[int] = field(default_factory=lambda: [200])

@dataclass
class RestartPolicy:
    policy: str = "never"  # "never" | "on-failure" | "always"
    max_restarts: int = 3
    backoff_ms: int = 1000

@dataclass
class ShellSpec:
    id: str
    command: List[str]
    cwd: Optional[str] = None
    env: Dict[str, str] = field(default_factory=dict)
    subgroups: List[str] = field(default_factory=list)
    ui: Dict[str, Any] = field(default_factory=dict)
    readiness: Optional[ReadinessProbe] = None
    restart: RestartPolicy = field(default_factory=RestartPolicy)

def parse_shellspec(path: Path) -> List[ShellSpec]:
    """Parse shellspec.yaml into list of ShellSpec."""
    with open(path) as f:
        raw = yaml.safe_load(f)
    
    specs = []
    for shell_id, shell_def in raw.get("shells", {}).items():
        cwd = shell_def.get("cwd")
        if cwd:
            cwd = os.path.expandvars(os.path.expanduser(cwd))
        
        readiness = None
        if "readiness" in shell_def:
            r = shell_def["readiness"]
            readiness = ReadinessProbe(
                type=r.get("type", "stdout_regex"),
                timeout=r.get("timeout", 30.0),
                pattern=r.get("pattern"),
                port=r.get("port"),
                url=r.get("url"),
            )
        
        restart = RestartPolicy()
        if "restart" in shell_def:
            rp = shell_def["restart"]
            restart = RestartPolicy(
                policy=rp.get("policy", "never"),
                max_restarts=rp.get("max_restarts", 3),
                backoff_ms=rp.get("backoff_ms", 1000),
            )
        
        specs.append(ShellSpec(
            id=shell_id,
            command=shell_def.get("command", []),
            cwd=cwd,
            env=shell_def.get("env", {}),
            subgroups=shell_def.get("subgroups", []),
            ui=shell_def.get("ui", {}),
            readiness=readiness,
            restart=restart,
        ))
    
    return specs
```

#### 5.2 Orchestrator (`framework_shells/orchestrator.py`)

```python
import asyncio
import re
import socket
from pathlib import Path
from typing import Dict, List
import httpx

from .shellspec import ShellSpec, ReadinessProbe, parse_shellspec
from .manager import FrameworkShellManager
from .record import ShellRecord
from .events import get_event_bus, EventType, ShellEvent

class Orchestrator:
    def __init__(self, manager: FrameworkShellManager):
        self.manager = manager
        self._specs: Dict[str, ShellSpec] = {}
        self._restart_counts: Dict[str, int] = {}
    
    async def up(self, spec_path: Path) -> List[ShellRecord]:
        """Start all shells defined in shellspec."""
        specs = parse_shellspec(spec_path)
        records = []
        
        for spec in specs:
            self._specs[spec.id] = spec
            record = await self._start_spec(spec)
            records.append(record)
        
        return records
    
    async def down(self, spec_path: Path) -> int:
        """Stop all shells defined in shellspec."""
        specs = parse_shellspec(spec_path)
        count = 0
        
        for spec in specs:
            shell = await self.manager.find_shell_by_label(spec.id)
            if shell:
                await self.manager.terminate_shell(shell.id, force=True)
                count += 1
        
        return count
    
    async def _start_spec(self, spec: ShellSpec) -> ShellRecord:
        record = await self.manager.spawn_shell_pty(
            spec.command,
            cwd=spec.cwd,
            env=spec.env,
            label=spec.id,
            subgroups=spec.subgroups,
            ui=spec.ui,
        )
        
        if spec.readiness:
            await self._wait_ready(record, spec.readiness)
            # Emit ready event
            bus = get_event_bus()
            await bus.publish(ShellEvent(
                type=EventType.SHELL_READY,
                shell_id=record.id,
                data=record.to_payload(),
            ))
        
        return record
    
    async def _wait_ready(self, record: ShellRecord, probe: ReadinessProbe) -> None:
        deadline = asyncio.get_event_loop().time() + probe.timeout
        
        while asyncio.get_event_loop().time() < deadline:
            if probe.type == "tcp_port" and await self._check_tcp(probe.port):
                return
            elif probe.type == "http_ok" and await self._check_http(probe.url, probe.status_codes):
                return
            elif probe.type == "stdout_regex" and await self._check_stdout(record, probe.pattern):
                return
            await asyncio.sleep(0.5)
        
        raise TimeoutError(f"Shell {record.id} did not become ready")
    
    async def _check_tcp(self, port: int) -> bool:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection("127.0.0.1", port),
                timeout=1.0
            )
            writer.close()
            await writer.wait_closed()
            return True
        except Exception:
            return False
    
    async def _check_http(self, url: str, status_codes: List[int]) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(url)
                return resp.status_code in status_codes
        except Exception:
            return False
    
    async def _check_stdout(self, record: ShellRecord, pattern: str) -> bool:
        log_path = Path(record.stdout_log)
        if not log_path.exists():
            return False
        try:
            content = log_path.read_text()
            return bool(re.search(pattern, content))
        except Exception:
            return False
```

#### 5.3 CLI (`framework_shells/cli/main.py`)

```python
import asyncio
import sys
from pathlib import Path
import click

@click.group()
def cli():
    """Framework Shells - Local process orchestration."""
    pass

@cli.command()
@click.argument("spec_file", type=click.Path(exists=True))
def up(spec_file: str):
    """Start all shells defined in SPEC_FILE."""
    from ..manager import FrameworkShellManager
    from ..orchestrator import Orchestrator
    
    async def _up():
        manager = FrameworkShellManager()
        await manager._adopt_orphaned_shells()
        orch = Orchestrator(manager)
        records = await orch.up(Path(spec_file))
        for r in records:
            click.echo(f"✓ {r.label or r.id} (pid={r.pid})")
    
    asyncio.run(_up())

@cli.command()
@click.argument("spec_file", type=click.Path(exists=True))
def down(spec_file: str):
    """Stop all shells defined in SPEC_FILE."""
    from ..manager import FrameworkShellManager
    from ..orchestrator import Orchestrator
    
    async def _down():
        manager = FrameworkShellManager()
        orch = Orchestrator(manager)
        count = await orch.down(Path(spec_file))
        click.echo(f"Stopped {count} shell(s)")
    
    asyncio.run(_down())

@cli.command()
@click.option("--app", "app_id", help="Filter by app ID")
def ps(app_id: str):
    """List running shells."""
    from ..manager import FrameworkShellManager
    
    async def _ps():
        manager = FrameworkShellManager()
        shells = await manager.list_shells()
        
        if app_id:
            shells = [s for s in shells if s.derive_app_id() == app_id]
        
        for s in shells:
            status = "●" if s.status == "running" else "○"
            app = s.derive_app_id() or "-"
            click.echo(f"{status} {s.id}  {s.label or '-'}  app={app}  pid={s.pid}  {s.status}")
    
    asyncio.run(_ps())

@cli.command()
@click.argument("shell_id")
@click.option("-n", "--lines", default=100, help="Number of lines")
def logs(shell_id: str, lines: int):
    """Show logs for SHELL_ID."""
    from ..manager import FrameworkShellManager
    
    async def _logs():
        manager = FrameworkShellManager()
        record = await manager.get_shell(shell_id)
        if not record:
            record = await manager.find_shell_by_label(shell_id, status=None)
        if not record:
            click.echo(f"Shell not found: {shell_id}", err=True)
            sys.exit(1)
        
        desc = await manager.describe(record, include_logs=True, tail_lines=lines)
        for line in desc.get("logs", {}).get("stdout_tail", []):
            click.echo(line, nl=False)
    
    asyncio.run(_logs())

@cli.command()
@click.argument("shell_id")
def attach(shell_id: str):
    """Attach to a running shell's PTY."""
    click.echo(f"Attaching to {shell_id}... (Ctrl+\\ to detach)")
    # TODO: Implement terminal attach via dtach
    click.echo("Not yet implemented")

@cli.command()
@click.argument("shell_id_or_group")
def diag(shell_id_or_group: str):
    """Generate diagnostics bundle."""
    from ..diag import generate_diag_bundle
    
    async def _diag():
        bundle = await generate_diag_bundle(shell_id_or_group)
        click.echo(bundle)
    
    asyncio.run(_diag())

@cli.command()
@click.option("--app", "app_id", required=True, help="App ID to terminate")
def down_app(app_id: str):
    """Terminate all shells belonging to an app."""
    from ..manager import FrameworkShellManager
    
    async def _down_app():
        manager = FrameworkShellManager()
        count = await manager.terminate_app_shells(app_id)
        click.echo(f"Terminated {count} shell(s) for app {app_id}")
    
    asyncio.run(_down_app())

if __name__ == "__main__":
    cli()
```

#### 5.4 Manager App-Aware Helpers

```python
class FrameworkShellManager:
    # ... existing methods ...
    
    async def list_shells_by_app(self, app_id: str) -> List[ShellRecord]:
        """List all shells belonging to an app (app worker + children)."""
        shells = []
        async for record in self._aiter_records():
            if (record.app_id or record.derive_app_id()) == app_id:
                shells.append(record)
        return shells
    
    async def terminate_app_shells(self, app_id: str, *, force: bool = True) -> int:
        """Terminate all shells belonging to an app (children first, then worker)."""
        shells = await self.list_shells_by_app(app_id)
        
        # Sort: non-workers first, then app-worker last
        shells.sort(key=lambda s: (s.is_app_worker, s.created_at))
        
        count = 0
        for shell in shells:
            try:
                await self.terminate_shell(shell.id, force=force)
                count += 1
            except Exception:
                continue
        return count
```

#### 5.5 pyproject.toml

```toml
[project]
name = "framework-shells"
version = "0.1.0"
description = "Manifest-driven local process orchestration"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
    "aiofiles>=23.0",
    "click>=8.0",
    "fastapi>=0.100",
    "httpx>=0.24",
    "psutil>=5.9",
    "pyyaml>=6.0",
]

[project.optional-dependencies]
dev = ["pytest", "pytest-asyncio", "ruff", "mypy"]

[project.scripts]
fs = "framework_shells.cli.main:cli"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

#### 5.6 Files Changed

| File | Change |
|------|--------|
| `framework_shells/shellspec.py` | New — YAML parser, dataclasses |
| `framework_shells/orchestrator.py` | New — `up()`, `down()`, readiness probes |
| `framework_shells/cli/main.py` | New — Click CLI |
| `framework_shells/manager.py` | Add `list_shells_by_app()`, `terminate_app_shells()` |
| `pyproject.toml` | New — Package configuration |

#### 5.7 Acceptance Tests

- [ ] `fs up shellspec.yaml` starts all shells
- [ ] `fs down shellspec.yaml` stops all shells
- [ ] `fs ps` lists running shells
- [ ] `fs ps --app <id>` filters by app
- [ ] `fs logs <id>` shows output
- [ ] Readiness probes work (tcp_port, stdout_regex, http_ok)

---

### Phase 6: Diagnostics Bundles

**Objective:** Shareable troubleshooting bundles

#### 6.1 Diag Module (`framework_shells/diag.py`)

```python
import json
import platform
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

@dataclass
class DiagBundle:
    generated_at: str
    shell_id: str
    spec_snapshot: Optional[Dict[str, Any]]
    record: Dict[str, Any]  # Sanitized (env keys only)
    logs: Dict[str, List[str]]
    events: List[Dict[str, Any]]
    runtime_info: Dict[str, Any]
    
    def to_json(self) -> str:
        return json.dumps({
            "generated_at": self.generated_at,
            "shell_id": self.shell_id,
            "spec_snapshot": self.spec_snapshot,
            "record": self.record,
            "logs": self.logs,
            "events": self.events,
            "runtime_info": self.runtime_info,
        }, indent=2)

async def generate_diag_bundle(shell_id: str) -> str:
    from .manager import FrameworkShellManager
    
    manager = FrameworkShellManager()
    record = await manager.get_shell(shell_id)
    if not record:
        record = await manager.find_shell_by_label(shell_id, status=None)
    if not record:
        return json.dumps({"error": f"Shell not found: {shell_id}"})
    
    desc = await manager.describe(record, include_logs=True, tail_lines=200)
    
    # Sanitize env (keys only)
    sanitized_record = desc.copy()
    sanitized_record["env_keys"] = list(record.env_overrides.keys())
    sanitized_record.pop("env_overrides", None)
    
    bundle = DiagBundle(
        generated_at=datetime.utcnow().isoformat() + "Z",
        shell_id=record.id,
        spec_snapshot=None,  # TODO: link to originating spec
        record=sanitized_record,
        logs={
            "stdout_tail": desc.get("logs", {}).get("stdout_tail", []),
            "stderr_tail": desc.get("logs", {}).get("stderr_tail", []),
        },
        events=[],  # TODO: capture recent events
        runtime_info={
            "python_version": sys.version,
            "platform": platform.platform(),
            "framework_shells_version": "0.1.0",
        },
    )
    
    return bundle.to_json()
```

#### 6.2 Files Changed

| File | Change |
|------|--------|
| `framework_shells/diag.py` | New file |

---

### Phase 7: Package Extraction

**Objective:** Standalone package, thin TE2 glue

#### 7.1 Package Extraction Steps

1. Create `framework_shells/` directory in project root
2. Move/refactor code from `app/libs/framework_shells.py`
3. Create `pyproject.toml` for packaging
4. Create TE2 adapter layer

#### 7.2 TE2 Adapter (`app/libs/framework_shells_te2_adapter.py`)

```python
"""Thin adapter connecting TE2 to the standalone framework_shells package.

IMPORTANT: Single control-plane model. Only the framework process should
instantiate a manager. App workers call the framework via HTTP API.
"""

from typing import Optional
import os

from framework_shells import FrameworkShellManager
from framework_shells.api.fastapi_router import create_router
from framework_shells.events import get_event_bus

# Singleton — only one manager per process, and only the framework
# process should have one. App workers use HTTP.
_manager: Optional[FrameworkShellManager] = None

async def get_te2_manager() -> FrameworkShellManager:
    """Get or create manager with TE2 settings.
    
    WARNING: Only call from the framework process. App workers should
    use the HTTP API instead of instantiating their own manager.
    """
    global _manager
    if _manager is not None:
        return _manager
    
    from app.main import get_setting
    
    max_app_shells = get_setting("TE_MAX_APP_SHELLS")
    max_service_shells = get_setting("TE_MAX_SERVICE_SHELLS")
    
    if max_app_shells is None:
        max_app_shells = int(os.getenv("TE_MAX_APP_SHELLS", "5"))
    if max_service_shells is None:
        max_service_shells = int(os.getenv("TE_MAX_SERVICE_SHELLS", "5"))
    
    _manager = FrameworkShellManager(
        max_app_shells=max_app_shells,
        max_service_shells=max_service_shells,
    )
    await _manager._adopt_orphaned_shells()
    return _manager

def get_te2_router():
    """Create FastAPI router for TE2."""
    return create_router(manager_factory=get_te2_manager)
```

#### 7.3 Update TE2 Imports

Replace throughout TE2:

```python
# Before
from app.libs.framework_shells import get_manager, FrameworkShellManager

# After
from app.libs.framework_shells_te2_adapter import get_te2_manager as get_manager
from framework_shells import FrameworkShellManager
```

#### 7.4 Files Changed

| File | Change |
|------|--------|
| `framework_shells/` | New package directory |
| `app/libs/framework_shells_te2_adapter.py` | New adapter |
| `app/libs/app_manager.py` | Update imports |
| `app/libs/app_lifecycle.py` | Update imports |
| `app/extensions/sessions_and_shortcuts/main.py` | Update imports |
| `app/main.py` | Mount new router |

---

## Part 4: Execution Checklist

### Phase 1: Secret Plumbing ⬜

- [ ] Add `compute_repo_fingerprint()` to `run_framework.sh`
- [ ] Add `ensure_framework_secret()` to `run_framework.sh`
- [ ] Export `FRAMEWORK_SHELLS_SECRET` and `TE_REPO_FINGERPRINT`
- [ ] Create `framework_shells/auth.py`
- [ ] Test: two clones generate different fingerprints/secrets

### Phase 2: Runtime Isolation ⬜

- [ ] Create `framework_shells/store.py` with `RuntimeStore`
- [ ] Add `signature`, `runtime_id`, `app_id`, `parent_shell_id`, `is_app_worker` to `ShellRecord`
- [ ] Sign records on save, verify on load
- [ ] Add `require_auth` to mutating endpoints (`Authorization: Bearer` only)
- [ ] Test: clone A cannot see/control clone B's shells
- [ ] Test: foreign records ignored (not purged) on adopt

### Phase 3: Event Bus ⬜

- [ ] Create `framework_shells/events.py`
- [ ] Add `_emit()` calls to manager lifecycle methods
- [ ] Create `framework_shells/api/websocket.py`
- [ ] Migrate Sessions & Shortcuts from polling to events
- [ ] Test: UI updates instantly on shell spawn/exit
- [ ] Verify: app workers use HTTP API, not local manager instances

### Phase 4: dtach Persistence ⬜

- [ ] Create `framework_shells/pty.py` with dtach support
- [ ] Modify `_launch_pty()` to use dtach
- [ ] Implement `_connect_dtach()` for bridge
- [ ] Update adoption to reconnect dtach
- [ ] Add `/replay` endpoint
- [ ] Add `uses_dtach`, `dtach_socket` to ShellRecord
- [ ] Test: shell survives framework restart

### Phase 5: Shellspec + CLI ⬜

- [ ] Create `framework_shells/shellspec.py`
- [ ] Create `framework_shells/orchestrator.py`
- [ ] Implement readiness probes (tcp_port, stdout_regex, http_ok)
- [ ] Create `framework_shells/cli/main.py`
- [ ] Add `list_shells_by_app()`, `terminate_app_shells()` to manager
- [ ] Create `pyproject.toml`
- [ ] Test: `fs up shellspec.yaml` works

### Phase 6: Diagnostics ⬜

- [ ] Create `framework_shells/diag.py`
- [ ] Implement `fs diag <id>` command
- [ ] Test: bundle contains sanitized record + logs

### Phase 7: Package Extraction ⬜

- [ ] Move core into `framework_shells/` package
- [ ] Create `app/libs/framework_shells_te2_adapter.py`
- [ ] Update all TE2 imports
- [ ] Test: `pip install -e .` works standalone
- [ ] Test: TE2 still works with new package

---

## Part 5: Success Criteria ("10/10")

- [ ] `pipx install framework-shells` works
- [ ] `fs up shellspec.yaml` starts defined shells
- [ ] `fs ps` / `fs logs` / `fs diag` work standalone
- [ ] Two repo clones can run concurrently without interference
- [ ] TE2 Sessions & Shortcuts UI works with event-driven updates
- [ ] Auth protects mutating endpoints
- [ ] Records are signed and verified
- [ ] Shells survive framework restart (dtach)
- [ ] Scrollback restored on reconnect

---

## Part 6: Open Questions

1. **When to extract to separate repo?**
   - After Phase 5, or keep in-tree until v1.0?
   - Recommendation: Keep in-tree until all phases complete and stable.

2. **Restart supervisor integration?**
   - Does orchestrator need to hook into manager's sweep for auto-restart?
   - Recommendation: Phase 5B addition — not critical for v1.

3. **IPC server fate?**
   - Keep as separate Flask process, or merge into manager?
   - Recommendation: Keep separate — it serves cross-process communication needs beyond shell management.

4. **UI hints in standalone mode?**
   - When running without TE2, no app manifests exist.
   - Recommendation: `shellspec.yaml` can include `ui:` section; standalone mode ignores TE2 manifests.

5. **Cross-app shell visibility?**
   - Can app A see app B's shells via `fs ps`?
   - Recommendation: Yes (same runtime_id), but TE2 UI can filter by app.

---

## Appendix A: Example shellspec.yaml

```yaml
version: "1"

shells:
  aria2:
    command: ["aria2c", "--enable-rpc", "--rpc-listen-port=6800"]
    cwd: ~/Downloads
    env:
      ARIA2_OPTS: "--max-concurrent-downloads=5"
    subgroups: [download, service]
    readiness:
      type: tcp_port
      port: 6800
      timeout: 10
    restart:
      policy: on-failure
      max_restarts: 3
      backoff_ms: 1000
    ui:
      icon: "📥"
      color: "#22c55e"

  mcp-server:
    command: ["codex", "mcp-server"]
    cwd: ${PROJECT_ROOT}
    subgroups: [ai, mcp]
    readiness:
      type: stdout_regex
      pattern: "MCP server listening"
      timeout: 30
    restart:
      policy: always
    ui:
      icon: "🤖"

  watcher:
    command: ["watchexec", "-e", "py", "--", "echo", "changed"]
    cwd: ${PROJECT_ROOT}
    subgroups: [dev]
    restart:
      policy: never
```

---

## Appendix B: Migration Path for Existing TE2 Deployments

1. **Backup existing state**: Copy `~/.cache/te_framework/` before upgrade
2. **Install new version**: Package update or git pull
3. **First startup creates secret**: `run_framework.sh` generates secret automatically
4. **Existing shells orphaned**: Old records lack signatures and will be ignored (left on disk / unmanaged)
5. **Restart services**: Apps need to be relaunched (one-time migration cost)
6. **Verify operation**: Check Sessions & Shortcuts shows shells correctly

---

## Appendix C: Security Considerations

### C1: Secret Storage
- Secret stored at `~/.cache/te_framework/runtimes/<fingerprint>/secret`
- File permissions 0600 (owner read/write only)
- No transmission over network — derived tokens used for API auth

### C2: dtach Socket Security
- Sockets stored at `<runtime>/sockets/<shell_id>.sock`
- File permissions 0600
- Socket path is a capability — access grants control

### C3: Record Signing
- HMAC-SHA256 over canonical JSON
- Prevents cross-runtime shell adoption/control
- Does NOT encrypt data — records are still readable

### C4: API Auth
- Bearer token derived from secret (HMAC)
- Required for all mutating operations
- Read operations unauthenticated (intentional — useful for monitoring)
