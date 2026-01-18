# "Attach That Feels Like tmux" — dtach Integration Plan v1

**Date:** December 14, 2025  
**Goal:** Pillar 4 from framework_shells_project_fork.md — PTY attach/reconnect with scrollback persistence

---

## v1 Clarifications (scope + guarantees)

This plan has two different “persistence” notions; it helps to be explicit:

1. **Shell process persistence** (the shell keeps running across browser disconnects and even a framework restart).
2. **Output persistence** (the user can reliably see past output / scrollback after reconnect).

### What v1 can guarantee (with dtach + existing log files)

- **Shell survives browser reloads**: yes.
- **Shell survives framework restart**: yes, *if* dtach continues running and the socket remains.
- **Scrollback on reconnect**: yes *for output that TE2 recorded into the `.stdout.log` file*.

### Important limitation (output while TE2 is down)

dtach itself is not a scrollback store; it’s a PTY multiplexer. If TE2 is restarted and **no dtach client is attached** during downtime, any output produced during that window will generally **not** be appended to TE2 logs (because TE2’s logger isn’t connected).

If we want “no missed output while the framework is down”, we need an always-on recorder/bridge (see Phase 2 below).

---

## Current State Analysis

### What Exists Today

1. **Framework Shells PTY Layer** (`app/libs/framework_shells.py`)
   - `_launch_pty()`: Creates raw `pty.openpty()` pair
   - `PTYState`: Tracks master_fd, subscribers, reader task
   - `_async_reader()`: Background task reading master_fd → log file + broadcast to subscribers
   - `write_to_pty()`, `resize_pty()`, `subscribe_output()`, `unsubscribe_output()`
   - **Problem:** PTY dies when manager restarts; no persistence layer

2. **dtach in Interactive Sessions** (`scripts/init.sh`)
   - Interactive shells wrap themselves in dtach: `dtach -A "$sock" bash --rcfile ...`
   - Socket stored at `${XDG_RUNTIME_DIR:-$HOME/.local/run}/te/<pid>-<$$>-<random>.sock`
   - `run_in_session.sh` uses `dtach -p "$sock"` to inject commands
   - **Limitation:** Only for interactive sessions, not framework shells

3. **Terminal App** (`app/apps/terminal/backend.py`)
   - Spawns PTY shells via `spawn_shell_pty()`
   - WebSocket `/ws/terminal/{shell_id}` for bidirectional streaming
   - Reads via `subscribe_output()`, writes via `write_to_pty()`
   - **Problem:** If browser disconnects + framework restarts, shell is orphaned (process may survive, but master_fd is gone)

4. **Log Persistence**
   - PTY output written to `~/.cache/te_framework/logs/<shell_id>.stdout.log`
   - Can be replayed for scrollback (file exists!)
   - **Gap:** No structured replay API; just raw bytes

### The Core Problem

```
Current Architecture:

  [Browser WS] ←→ [Manager PTYState] ←→ [pty.openpty() master_fd] ←→ [Shell Process]
                          ↓
                   [stdout.log file]

On Manager Restart:
  - PTYState lost (in-memory)
  - master_fd closed
  - Shell process still running but orphaned
  - Cannot reattach to existing shell
```

---

## Proposed Architecture: dtach as Persistence Layer

### Key Insight

Instead of `pty.openpty()` directly, spawn shells **inside dtach**. dtach owns the PTY master; our manager connects as a client.

```
New Architecture:

  [Browser WS] ←→ [Manager] ←→ [dtach socket] ←→ [dtach process] ←→ [Shell Process]
                     ↓                               ↓
              [subscription layer]            [PTY persistence]
                     ↓
              [stdout.log file]

On Manager Restart:
  - dtach socket survives (filesystem)
  - Shell process survives (dtach parent)
  - Manager reconnects to existing dtach socket
  - Replay scrollback from log file
```

### dtach Modes

| Mode | Flag | Behavior |
|------|------|----------|
| Create + Attach | `-A` | Create socket if not exists, attach |
| Create Only | `-n` | Create socket, don't attach (daemon mode) |
| Attach Only | `-a` | Attach to existing socket |
| Detach | Ctrl+\ | Detach client, socket stays |
| Push/Inject | `-p` | Send data to socket without attaching |

**For Framework Shells:**
- Spawn: `dtach -n <socket> <command>`
- Attach (for reading): connect to socket, read from dtach
- Write: `dtach -p <socket>` or direct socket I/O

---

## Implementation Phases

### Phase 1: dtach-Backed Spawn (Core Change)

**File:** `app/libs/framework_shells.py`

**Changes to `_launch_pty()`:**

```python
# Before (simplified)
async def _launch_pty(self, record: ShellRecord) -> ShellRecord:
    master_fd, slave_fd = pty.openpty()
    proc = subprocess.exec(*record.command, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd)
    # reader task reads master_fd
    ...

# After
async def _launch_pty(self, record: ShellRecord) -> ShellRecord:
    socket_path = self.sockets_dir / f"{record.id}.sock"
    
    # Spawn command inside dtach (daemon mode)
    dtach_cmd = ["dtach", "-n", str(socket_path), *record.command]
    proc = await asyncio.create_subprocess_exec(
        *dtach_cmd,
        cwd=record.cwd,
        env=envp,
        start_new_session=True,
    )
    
    # Wait for socket to appear
    await self._wait_for_socket(socket_path, timeout=5.0)
    
    # Connect to dtach for reading
    state = await self._connect_dtach(record.id, socket_path)
    ...
```

**New `DTachState` dataclass:**

```python
@dataclass
class DTachState:
    socket_path: Path
    client_fd: int  # Our connection to dtach socket
    shell_id: str
    label: Optional[str] = None
    subscribers: List[AsyncQueue[str]] = field(default_factory=list)
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    reader: Optional[asyncio.Task] = None
```

**Socket protocol:**
- dtach uses Unix socket + custom protocol
- We can either:
  1. Shell out to `dtach -a` with PTY passthrough (simpler, more overhead)
  2. Implement dtach client protocol directly (faster, complex)

**Recommendation:** Start with option 1 (subprocess), optimize later.

**Note:** the `dtach -a` client behaves like a terminal program; it tends to work best if *it* has a PTY/TTY. The simplest robust approach is:

- TE2: create a local pty pair for the attach client subprocess
- run `dtach -a <sock>` with its stdin/stdout/stderr bound to the slave fd
- TE2 reads/writes via the master fd (recreated on reconnect/re-adopt)

This keeps the dtach server-side PTY persistent, while TE2’s “client bridge” is disposable.

### Phase 2: Reconnection on Adopt

**In `_adopt_orphaned_shells()`:**

```python
async def _adopt_orphaned_shells(self) -> None:
    for record in self._aiter_records():
        if record.uses_pty:
            socket_path = self.sockets_dir / f"{record.id}.sock"
            if socket_path.exists() and await self._is_pid_alive(record.pid):
                # Shell survived! Reconnect to dtach
                state = await self._connect_dtach(record.id, socket_path)
                record.adopted = True
                await self._save_record(record)
```

### Phase 3: Scrollback Replay API

**New endpoint:** `GET /api/framework_shells/{id}/replay`

```python
@framework_shells_bp.get("/api/framework_shells/{shell_id}/replay")
async def replay_shell_output(
    shell_id: str,
    mgr: FrameworkShellManager = Depends(get_manager),
    lines: int = Query(1000),
    offset: int = Query(0),
) -> Any:
    """Return historical output for scrollback restoration."""
    record = await mgr.get_shell(shell_id)
    if not record:
        raise HTTPException(404, "Shell not found")
    
    log_path = Path(record.stdout_log)
    if not log_path.exists():
        return {"ok": True, "data": {"lines": [], "total": 0}}
    
    # Read and return structured output
    content = await mgr._read_log_tail(log_path, lines)
    return {"ok": True, "data": {"lines": content, "total": len(content)}}
```

**Client flow:**
1. Connect to WebSocket `/ws/terminal/{id}`
2. GET `/api/framework_shells/{id}/replay?lines=1000`
3. Render replay, then switch to live stream

### Phase 4: Resize Propagation

dtach handles resize via `SIGWINCH`. When client resizes:

```python
async def resize_pty(self, shell_id: str, cols: int, rows: int) -> None:
    state = self._dtach.get(shell_id)
    if not state:
        raise KeyError("No dtach for this shell")
    
    # Option 1: dtach -r for redraw (triggers resize)
    # Option 2: Send SIGWINCH to dtach process
    # Option 3: If we have direct FD access, ioctl TIOCSWINSZ
```

### Phase 5: Terminal App Integration

**Update `app/apps/terminal/backend.py`:**

```python
@terminal_bp.websocket("/ws/terminal/{shell_id}")
async def terminal_ws(websocket: WebSocket, shell_id: str):
    await websocket.accept()
    m = await _manager()
    
    # NEW: Replay existing scrollback first
    try:
        record = await m.get_shell(shell_id)
        if record:
            log_path = Path(record.stdout_log)
            if log_path.exists():
                # Send historical output for scrollback
                async with aiofiles.open(log_path, "r") as f:
                    content = await f.read()
                    if content:
                        await websocket.send_text(content)
    except Exception:
        pass
    
    # Then subscribe to live output
    q = await m.subscribe_output(shell_id)
    ...
```

---

## Hard Switch (this branch)

Pillar 4 is a hard switch:

1. **dtach is required** for dtach-backed framework PTY shells.
2. No fallback to `pty.openpty()` for “persistent terminals”.
3. Record schema should record dtach usage explicitly (`uses_dtach`, `dtach_socket`) for clarity/debugging.

### Prerequisites

- dtach must be installed (Termux: `pkg install dtach`).

---

## Open Questions

1. **dtach vs abduco vs others?**
   - dtach: minimal, widely available, simple protocol
   - abduco: dtach fork with session naming, harder to find
   - screen/tmux: overkill, complex
   - **Recommendation:** dtach (already in use for interactive sessions)

2. **Direct socket vs subprocess wrapper?**
   - Direct: lower latency, more complex
   - Subprocess: simpler, proven pattern from `run_in_session.sh`
   - **Recommendation:** Start subprocess, profile, optimize if needed

3. **Log format for replay?**
   - Raw bytes (current): simple, but no timestamps
   - Timestamped chunks: better for debugging, more complex
   - **Recommendation:** Keep raw for now, timestamp in v2

4. **Multiple clients attaching?**
   - dtach supports multiple clients natively
   - Our subscriber model already handles this
   - Need to test resize conflicts

---

## File Changes Summary

| File | Change |
|------|--------|
| `app/libs/framework_shells.py` | Add DTachState, modify `_launch_pty()`, add `_connect_dtach()`, update adoption |
| `app/libs/framework_shells.py` | New `/replay` endpoint |
| `app/apps/terminal/backend.py` | WebSocket replay on connect |
| `ShellRecord` schema | Add `uses_dtach`, `dtach_socket` fields |

---

## Success Criteria

- [ ] Framework can restart without losing terminal sessions
- [ ] Client can reconnect to existing shell (WebSocket → dtach → shell)
- [ ] Scrollback shows historical output on reconnect
- [ ] Resize works after reconnection
- [ ] Two clones don't interfere (runtime isolation applies to socket paths)

---

## Next Steps

1. **Spike:** Test dtach subprocess integration in isolation
2. **Implement Phase 1:** dtach-backed spawn (no feature flag)
3. **Test adoption flow:** Kill manager, verify reconnect
4. **Implement replay API**
5. **Update terminal app**
6. **Integration test with Sessions & Shortcuts UI**

---

## Security / hygiene notes (important for “two clones” safety)

- dtach sockets must be **runtime namespaced** (use the runtime-id namespacing from the split plan) so two clones don’t collide on disk.
- ensure sockets are not world-readable/writable (`chmod 0600` or equivalent creation strategy).
- treat “socket path existence” as a capability: if another runtime can open your socket, it can inject input regardless of API auth.

---

## Phase 2 (“no missed output during framework downtime”)

If we truly want tmux-like “output continuity even if TE2 restarts”, add a tiny recorder process that stays attached:

- When a dtach-backed shell is spawned, also spawn a lightweight “log tap” process that attaches to the dtach socket and appends output to the `.stdout.log` file continuously.
- TE2 UI clients still connect to TE2 for live streaming; TE2 can tail the same log file (plus the live bus).

This makes the system more complex (a second always-on process per dtach shell), but it fully closes the “downtime output gap”.
