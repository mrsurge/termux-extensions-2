# Framework Shells Fork — Execution Plan v1

**Date:** December 14, 2025  
**Goal:** Transform Framework Shells from "internal TE2 shell manager" into a **standalone, manifest-driven local process platform**

## Companion documents (read together)

- `framework_shells_project_fork.md` — the “10/10” product framing + pillars (authoritative high-level direction).
- `app-worker_integration_issues.md` — **required** TE2-specific integration notes for app-workers/child-shells (the missing chapter from this v1 plan).
- `pillar4draft.md` — deeper notes for Pillar 4 (“attach that feels like tmux”), with v1/v2 clarifications.

Notes:

- This file (`framework_shells_execution_plan.md`) is intentionally “execution shaped” (phases, files, checklists).
- The authoritative plan is `framework_shells_project_fork.md`; this file should reference it rather than diverge.

---

## Executive Summary

This plan covers the 5-step execution path to make Framework Shells forkable:

1. **Secret plumbing** — per-repo `FRAMEWORK_SHELLS_SECRET`
2. **Runtime isolation** — namespaced store, signed records, auth
3. **Event bus** — push-based shell lifecycle events
4. Attach like tmux — dtach-backed persistence
5. **Shellspec + CLI** — declarative manifests, `fs` command
6. **Package extraction** — standalone `framework_shells/` core

**End state:** `pipx install framework-shells` + `shellspec.yaml` = working local services

---

## Current Codebase Inventory

### Core Files

| File | Purpose | Reuse in Fork |
|------|---------|---------------|
| `app/libs/framework_shells.py` | Manager, PTY, records, FastAPI routes | Core logic → extract |
| `app/libs/shell_groups.py` | Group termination helper | Keep as utility |
| `app/ipc/server.py` | Process registry, shutdown | Integrate or adapt |
| `app/ipc/client.py` | IPC client helpers | Keep for TE2 glue |
| `scripts/run_framework.sh` | Startup, run_id, log cleanup | Modify for secrets |
| `app/extensions/sessions_and_shortcuts/` | Dashboard UI (polling WS) | Update for event bus |

### Storage Layout (Current)

```
~/.cache/te_framework/
├── run_id                    # Current run identifier
├── ipc.pid                   # IPC server PID
├── meta/
│   └── <shell_id>/meta.json  # ShellRecord JSON
├── logs/
│   └── <shell_id>.stdout.log # PTY/stdout output
└── sockets/                  # (unused currently)
```

---

## Phase 1: Secret Plumbing

**Objective:** Establish per-repo clone secret for isolation

### 1.1 Secret Generation & Persistence

**Location:** `~/.cache/te_framework/runtimes/<repo_fingerprint>/secret`

```bash
# scripts/run_framework.sh additions

compute_repo_fingerprint() {
  # SHA256 of canonical repo root path (first 16 chars)
  local real_root
  real_root="$(readlink -f "$REPO_ROOT")"
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
}
```

### 1.2 Derived Values

```python
# framework_shells/auth.py (new file)

import hashlib
import hmac
import json
import os

def get_secret() -> str:
    return os.environ.get("FRAMEWORK_SHELLS_SECRET", "")

def derive_runtime_id(secret: str) -> str:
    """sha256(secret)[:16] — namespace identifier"""
    return hashlib.sha256(secret.encode()).hexdigest()[:16]

def derive_api_token(secret: str) -> str:
    """HMAC(secret, 'api') — bearer token for mutations"""
    return hmac.new(secret.encode(), b"api", hashlib.sha256).hexdigest()

def sign_record(secret: str, record_dict: dict) -> str:
    """HMAC signature over canonical JSON (excludes signature field)"""
    clean = {k: v for k, v in record_dict.items() if k != "signature"}
    canonical = json.dumps(clean, sort_keys=True, separators=(",", ":"))
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()

def verify_record(secret: str, record_dict: dict) -> bool:
    """Verify record signature matches"""
    expected = sign_record(secret, record_dict)
    return hmac.compare_digest(record_dict.get("signature", ""), expected)
```

### 1.3 Files Changed

| File | Change |
|------|--------|
| `scripts/run_framework.sh` | Add `compute_repo_fingerprint()`, `ensure_framework_secret()` |
| `framework_shells/auth.py` | New — derivation functions |
| Environment | Export `FRAMEWORK_SHELLS_SECRET` to supervisor + shells |

---

## Phase 2: Runtime Isolation

**Objective:** Namespace storage, sign records, enforce auth

### 2.1 Namespaced Store

**New layout:**
```
~/.cache/te_framework/
├── runtimes/
│   └── <repo_fingerprint>/
│       ├── secret              # 64-char hex
│       └── <runtime_id>/       # Derived from secret
│           ├── meta/
│           │   └── <shell_id>/meta.json
│           ├── logs/
│           │   └── <shell_id>.stdout.log
│           └── sockets/
│               └── <shell_id>.sock
```

### 2.2 Manager Changes

```python
# framework_shells/store.py (new file)

from pathlib import Path
from .auth import get_secret, derive_runtime_id

class RuntimeStore:
    def __init__(self, base_dir: Path = None):
        self.secret = get_secret()
        self.runtime_id = derive_runtime_id(self.secret) if self.secret else "default"
        
        base = base_dir or Path.home() / ".cache" / "te_framework"
        if not self.secret:
            raise RuntimeError("FRAMEWORK_SHELLS_SECRET is required (no fallback mode).")

        fingerprint = os.environ.get("TE_REPO_FINGERPRINT", "unknown")
        self.root = base / "runtimes" / fingerprint / self.runtime_id
        
        self.metadata_dir = self.root / "meta"
        self.logs_dir = self.root / "logs"
        self.sockets_dir = self.root / "sockets"
        
        for d in (self.metadata_dir, self.logs_dir, self.sockets_dir):
            d.mkdir(parents=True, exist_ok=True)
```

### 2.3 Record Signing

```python
# In framework_shells/record.py

@dataclass
class ShellRecord:
    # ... existing fields ...
    signature: Optional[str] = None  # NEW
    runtime_id: Optional[str] = None  # NEW (for verification)

    def sign(self, secret: str) -> None:
        from .auth import sign_record, derive_runtime_id
        self.runtime_id = derive_runtime_id(secret)
        self.signature = sign_record(secret, self.to_dict())
    
    def verify(self, secret: str) -> bool:
        from .auth import verify_record, derive_runtime_id
        if self.runtime_id != derive_runtime_id(secret):
            return False
        return verify_record(secret, self.to_dict())
```

### 2.4 Auth Enforcement

```python
# In framework_shells/api/fastapi_router.py

from fastapi import Header, HTTPException, Depends
from ..auth import get_secret, derive_api_token

def require_auth(
    authorization: str = Header(None),
) -> None:
    secret = get_secret()
    if not secret:
        return  # No secret configured, allow all
    
    expected = derive_api_token(secret)
    token = None
    
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(403, "Invalid or missing auth token")

# Apply to mutating endpoints
@router.post("/api/framework_shells")
async def create_shell(
    _: None = Depends(require_auth),
    ...
):
    ...
```

### 2.5 Adopt Verification

```python
async def _adopt_orphaned_shells(self) -> None:
    secret = get_secret()
    async for record in self._aiter_records():
        # Only adopt if signature verifies (same runtime)
        if secret and not record.verify(secret):
            # Foreign record — skip or remove
            await self._purge_record_files(record)
            continue
        
        # ... existing adoption logic ...
```

### 2.6 Files Changed

| File | Change |
|------|--------|
| `framework_shells/store.py` | New — `RuntimeStore` with namespacing |
| `framework_shells/record.py` | Add `signature`, `runtime_id`, `sign()`, `verify()` |
| `framework_shells/manager.py` | Use `RuntimeStore`, sign on save, verify on load |
| `framework_shells/api/fastapi_router.py` | Add `require_auth` dependency |

---

## Phase 3: Event Bus

**Objective:** Replace 5s polling with push-based lifecycle events

### 3.1 Event Types

```python
# framework_shells/events.py (new file)

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional
import time

class EventType(Enum):
    SHELL_CREATED = "shell.created"
    SHELL_SPAWNED = "shell.spawned"
    SHELL_READY = "shell.ready"      # Readiness probe passed
    SHELL_UPDATED = "shell.updated"
    SHELL_EXITED = "shell.exited"
    SHELL_REMOVED = "shell.removed"
    PTY_CHUNK = "shell.pty_chunk"    # For streaming
    LOG_CHUNK = "shell.log_chunk"

@dataclass
class ShellEvent:
    type: EventType
    shell_id: str
    timestamp: float = field(default_factory=time.time)
    data: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type.value,
            "shell_id": self.shell_id,
            "timestamp": self.timestamp,
            "data": self.data,
        }
```

### 3.2 Event Bus (In-Process)

```python
# framework_shells/events.py (continued)

import asyncio
from typing import Callable, List, Set
from asyncio import Queue as AsyncQueue

class EventBus:
    def __init__(self):
        self._subscribers: Set[AsyncQueue[ShellEvent]] = set()
        self._handlers: Dict[EventType, List[Callable]] = {}
    
    def subscribe(self) -> AsyncQueue[ShellEvent]:
        """Create a new subscription queue."""
        q: AsyncQueue[ShellEvent] = AsyncQueue()
        self._subscribers.add(q)
        return q
    
    def unsubscribe(self, q: AsyncQueue[ShellEvent]) -> None:
        self._subscribers.discard(q)
    
    async def publish(self, event: ShellEvent) -> None:
        """Broadcast event to all subscribers."""
        for q in list(self._subscribers):
            try:
                await q.put(event)
            except Exception:
                self._subscribers.discard(q)
    
    def on(self, event_type: EventType, handler: Callable) -> None:
        """Register a handler for specific event type."""
        self._handlers.setdefault(event_type, []).append(handler)

# Global instance
_bus: Optional[EventBus] = None

def get_event_bus() -> EventBus:
    global _bus
    if _bus is None:
        _bus = EventBus()
    return _bus
```

### 3.3 Manager Integration

```python
# In framework_shells/manager.py

from .events import get_event_bus, ShellEvent, EventType

class FrameworkShellManager:
    def __init__(self, ...):
        ...
        self._event_bus = get_event_bus()
    
    async def _emit(self, event_type: EventType, record: ShellRecord, **extra):
        event = ShellEvent(
            type=event_type,
            shell_id=record.id,
            data={**record.to_payload(), **extra},
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

### 3.4 WebSocket Transport

```python
# framework_shells/api/websocket.py (new file)

from fastapi import WebSocket, WebSocketDisconnect
from ..events import get_event_bus, ShellEvent

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

### 3.5 Sessions & Shortcuts Migration

**Before (polling):**
```python
# app/extensions/sessions_and_shortcuts/main.py
@sessions_bp.websocket('/ws')
async def sessions_ws(websocket: WebSocket):
    while True:
        frameworks = await _list_framework_shells()  # Poll
        await websocket.send_json({"type": "update", ...})
        await asyncio.sleep(5)  # 5s interval
```

**After (event-driven):**
```python
@sessions_bp.websocket('/ws')
async def sessions_ws(websocket: WebSocket):
    await websocket.accept()
    bus = get_event_bus()
    q = bus.subscribe()
    
    # Initial snapshot
    frameworks = await _list_framework_shells()
    await websocket.send_json({"type": "snapshot", "frameworks": frameworks})
    
    # Stream incremental updates
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

### 3.6 Files Changed

| File | Change |
|------|--------|
| `framework_shells/events.py` | New — `EventType`, `ShellEvent`, `EventBus` |
| `framework_shells/manager.py` | Add `_emit()` calls at lifecycle points |
| `framework_shells/api/websocket.py` | New — `/ws/events` endpoint |
| `app/extensions/sessions_and_shortcuts/main.py` | Migrate from polling to event subscription |

---

## Phase 4: Shellspec + CLI

**Objective:** Declarative manifests, standalone CLI

### 4.1 Shellspec Schema (v0)

```yaml
# shellspec.yaml example
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

  watcher:
    command: ["watchexec", "-e", "py", "--", "echo", "changed"]
    cwd: ${PROJECT_ROOT}
    subgroups: [dev]
    restart:
      policy: never
```

### 4.2 Shellspec Parser

```python
# framework_shells/shellspec.py (new file)

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional
import os
import yaml

@dataclass
class ReadinessProbe:
    type: str  # "stdout_regex" | "tcp_port" | "http_ok"
    timeout: float = 30.0
    # Type-specific fields
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
        # Expand env vars in cwd
        cwd = shell_def.get("cwd")
        if cwd:
            cwd = os.path.expandvars(os.path.expanduser(cwd))
        
        # Parse readiness
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
        
        # Parse restart
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

### 4.3 Orchestrator

```python
# framework_shells/orchestrator.py (new file)

import asyncio
from pathlib import Path
from typing import Dict, List
from .shellspec import ShellSpec, parse_shellspec
from .manager import FrameworkShellManager
from .record import ShellRecord

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
        
        return record
    
    async def _wait_ready(self, record: ShellRecord, probe: ReadinessProbe) -> None:
        """Wait for shell to become ready per probe config."""
        deadline = asyncio.get_event_loop().time() + probe.timeout
        
        while asyncio.get_event_loop().time() < deadline:
            if probe.type == "tcp_port":
                if await self._check_tcp(probe.port):
                    return
            elif probe.type == "http_ok":
                if await self._check_http(probe.url, probe.status_codes):
                    return
            elif probe.type == "stdout_regex":
                if await self._check_stdout(record, probe.pattern):
                    return
            await asyncio.sleep(0.5)
        
        raise TimeoutError(f"Shell {record.id} did not become ready")
```

### 4.4 CLI

```python
# framework_shells/cli/main.py (new file)

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
def ps():
    """List running shells."""
    from ..manager import FrameworkShellManager
    
    async def _ps():
        manager = FrameworkShellManager()
        shells = await manager.list_shells()
        for s in shells:
            status = "●" if s.status == "running" else "○"
            click.echo(f"{status} {s.id}  {s.label or '-'}  pid={s.pid}  {s.status}")
    
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
            # Try by label
            record = await manager.find_shell_by_label(shell_id, status=None)
        if not record:
            click.echo(f"Shell not found: {shell_id}", err=True)
            sys.exit(1)
        
        desc = await manager.describe(record, include_logs=True, tail_lines=lines)
        for line in desc.get("logs", {}).get("stdout_tail", []):
            click.echo(line, nl=False)
    
    asyncio.run(_logs())

@cli.command()
@click.argument("shell_id_or_group")
def diag(shell_id_or_group: str):
    """Generate diagnostics bundle."""
    from ..diag import generate_diag_bundle
    
    async def _diag():
        bundle = await generate_diag_bundle(shell_id_or_group)
        click.echo(bundle)
    
    asyncio.run(_diag())

if __name__ == "__main__":
    cli()
```

### 4.5 Entry Point

```toml
# pyproject.toml (for standalone package)
[project.scripts]
fs = "framework_shells.cli.main:cli"
```

### 4.6 Files Changed

| File | Change |
|------|--------|
| `framework_shells/shellspec.py` | New — YAML parser, `ShellSpec` dataclass |
| `framework_shells/orchestrator.py` | New — `up()`, `down()`, readiness probes |
| `framework_shells/cli/main.py` | New — Click CLI (`fs up/down/ps/logs/diag`) |
| `pyproject.toml` | Add `[project.scripts]` entry |

---

## Phase 5: Diagnostics Bundles

**Objective:** `fs diag <id|group>` for shareable troubleshooting

### 5.1 Bundle Contents

```python
# framework_shells/diag.py (new file)

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
    logs: Dict[str, List[str]]  # stdout/stderr tails
    events: List[Dict[str, Any]]  # Recent events
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
    from .events import get_event_bus
    
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
            "framework_shells_version": "0.1.0",  # TODO: from package
        },
    )
    
    return bundle.to_json()
```

---

## Phase 6: Package Extraction

**Objective:** Standalone `framework_shells/` package, thin TE2 glue

### 6.1 Package Structure

```
framework_shells/
├── __init__.py
├── auth.py           # Secret derivation, signing
├── store.py          # RuntimeStore (namespaced paths)
├── record.py         # ShellRecord dataclass
├── manager.py        # FrameworkShellManager (core logic)
├── events.py         # EventBus, ShellEvent
├── shellspec.py      # YAML parser
├── orchestrator.py   # up/down, readiness probes
├── diag.py           # Diagnostics bundles
├── pty.py            # PTY helpers (dtach-backed persistence)
├── cli/
│   ├── __init__.py
│   └── main.py       # Click CLI
└── api/
    ├── __init__.py
    ├── fastapi_router.py  # FastAPI adapter
    └── websocket.py       # WS event stream
```

### 6.2 TE2 Glue Layer

```python
# app/libs/framework_shells_te2_adapter.py (stays in TE2)

from framework_shells import FrameworkShellManager
from framework_shells.api.fastapi_router import create_router
from app.main import get_setting
import os

def get_te2_manager() -> FrameworkShellManager:
    """Create manager with TE2 settings."""
    return FrameworkShellManager(
        max_app_shells=get_setting("TE_MAX_APP_SHELLS") or 5,
        max_service_shells=get_setting("TE_MAX_SERVICE_SHELLS") or 5,
    )

def get_te2_router():
    """Create FastAPI router for TE2."""
    return create_router(manager_factory=get_te2_manager)
```

### 6.3 pyproject.toml

```toml
[project]
name = "framework-shells"
version = "0.1.0"
description = "Manifest-driven local process orchestration"
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
dev = ["pytest", "pytest-asyncio", "ruff"]

[project.scripts]
fs = "framework_shells.cli.main:cli"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

---

## Execution Checklist

### Step 1: Secret Plumbing ✅
- [ ] Add `compute_repo_fingerprint()` to `run_framework.sh`
- [ ] Add `ensure_framework_secret()` to `run_framework.sh`
- [ ] Export `FRAMEWORK_SHELLS_SECRET` before supervisor
- [ ] Create `framework_shells/auth.py`
- [ ] Test: two clones generate different secrets

### Step 2: Runtime Isolation
- [ ] Create `framework_shells/store.py` with `RuntimeStore`
- [ ] Add `signature`, `runtime_id` to `ShellRecord`
- [ ] Sign records on save, verify on load
- [ ] Add `require_auth` to mutating endpoints
- [ ] Accept both `Authorization: Bearer` and `X-Framework-Key`
- [ ] Test: clone A cannot see/control clone B's shells

### Step 3: Event Bus
- [ ] Create `framework_shells/events.py`
- [ ] Add `_emit()` calls to manager lifecycle methods
- [ ] Create `/ws/events` WebSocket endpoint
- [ ] Migrate Sessions & Shortcuts from polling to events
- [ ] Test: UI updates instantly on shell spawn/exit

### Step 4: Shellspec + CLI
- [ ] Create `framework_shells/shellspec.py`
- [ ] Create `framework_shells/orchestrator.py`
- [ ] Implement readiness probes (tcp_port, stdout_regex, http_ok)
- [ ] Create `framework_shells/cli/main.py`
- [ ] Test: `fs up shellspec.yaml` starts all shells
- [ ] Test: `fs down shellspec.yaml` stops all shells

### Step 5: Diagnostics
- [ ] Create `framework_shells/diag.py`
- [ ] Implement `fs diag <id>` command
- [ ] Test: bundle contains sanitized record + logs

### Step 6: Package Extraction
- [ ] Move core into `framework_shells/` package
- [ ] Create `pyproject.toml`
- [ ] Create TE2 adapter glue
- [ ] Test: `pip install -e .` works standalone
- [ ] Test: TE2 still works with new package

---

## Success Criteria (The "10/10")

- [ ] `pipx install framework-shells` works
- [ ] `fs up shellspec.yaml` starts defined shells
- [ ] `fs ps` / `fs logs` / `fs diag` work standalone
- [ ] Two repo clones can run concurrently without interference
- [ ] TE2 Sessions & Shortcuts UI works with event-driven updates
- [ ] Auth protects mutating endpoints
- [ ] Records are signed and verified

---

## Open Questions

1. **When to extract to separate repo?**
   - After Step 5, or keep in-tree until v1.0?

2. **Readiness probe defaults?**
   - Should `stdout_regex` be the default if unspecified?

3. **Restart supervisor integration?**
   - Does orchestrator need to hook into manager's sweep for auto-restart?

4. **IPC server fate?**
   - Keep as separate process, or merge ProcessRegistry into manager?

---

## Important missing piece (addressed in companion doc)

This v1 plan does not fully capture TE2’s reality that:

- **app workers are framework shells** (`label="app-worker:<app_id>"`)
- apps spawn child shells (terminals, LSP servers, agents) that must inherit app context (`subgroups[0]=app_id`)
- UI and shutdown ordering care about the **hierarchy** (children first, then app worker)

Implementation guidance and contention notes live in `app-worker_integration_issues.md`.
