# Terminal Architecture Issue

**Date:** 2025-11-06  
**Status:** BLOCKING - Terminal feature non-functional after ASGI migration

---

## Current Problem

The integrated terminal in `file_editor_cm6` app is not creating PTY sessions. Worker endpoints timeout when called through the reverse proxy.

### Symptoms

1. **Main proxy timeouts:**
   ```
   INFO: 127.0.0.1:49866 - "GET /api/app/file_editor_cm6/terminal/shell-id HTTP/1.1" 500 Internal Server Error
   ERROR: httpx.ReadTimeout
   ```

2. **Direct worker test hangs:**
   ```bash
   curl -s -m 5 "http://127.0.0.1:44085/terminal/shell-id"
   # Times out - no response
   ```

3. **No terminal PTY created:**
   - Frontend calls `/terminal/shell-id` → timeout
   - Frontend calls `/terminal/create` → timeout  
   - No framework shell with label `code-editor-terminal` is ever spawned
   - WebSocket `/ws/app/file_editor_cm6/terminal/auto` connects but has nothing to attach to

---

## Root Cause

**Blocking I/O in async endpoints is freezing the ASGI worker event loop.**

### The Blocking Code Path

`terminal_backend.py` endpoints were calling synchronous `FrameworkShellManager` methods:

```python
@terminal_router.get('/terminal/shell-id')
async def get_terminal_shell_id():
    mgr = get_manager()  # Returns FrameworkShellManager singleton
    
    # BLOCKING CALLS - freeze entire event loop:
    shells = mgr.list_shells()        # Synchronous subprocess calls
    rec = mgr.get_shell(shell_id)     # Synchronous file I/O
    mgr.terminate_shell(orphan.id)    # Synchronous process termination
```

`FrameworkShellManager` methods use:
- Synchronous subprocess calls (`subprocess.run`, `subprocess.Popen`)
- Synchronous file I/O (reading logs, state files)
- Synchronous IPC (checking process status)

These block the entire ASGI worker thread, causing:
- The endpoint never returns
- The proxy times out after 30 seconds
- All other requests to that worker are blocked

### Why `anyio.to_thread.run_sync` Didn't Work

Attempted fix:
```python
shells = await anyio.to_thread.run_sync(mgr.list_shells)
```

**This still hung** because:
1. `FrameworkShellManager` is a singleton shared across threads
2. It maintains internal locks/state that aren't thread-safe
3. The manager calls back into framework shell manager which accesses shared global dictionaries
4. Deadlock or race conditions occur when multiple threads access manager state

---

## Intended Architecture

### How Terminal Should Work (Pre-ASGI, WSGI version)

1. **User Action:** User clicks "Toggle Terminal" in menu
2. **Frontend calls:** `GET /api/app/file_editor_cm6/terminal/shell-id`
   - Backend checks disk-persisted shell ID from `HistoryStore`
   - Returns stored ID or `null`
3. **If no shell exists:**
   - Frontend calls: `POST /api/app/file_editor_cm6/terminal/create`
   - Backend creates new PTY via `FrameworkShellManager.create_shell()`
   - Returns shell info: `{id: "fs_1762...", port: null}`
   - Frontend calls: `POST /api/app/file_editor_cm6/terminal/shell-id` to save ID
4. **Terminal UI connects:**
   - XTerm.js widget rendered in DOM
   - WebSocket connects: `/ws/app/file_editor_cm6/terminal/{shell_id}`
   - Backend pipes PTY I/O ↔ WebSocket
5. **Terminal resize:**
   - Frontend calls: `POST /api/app/file_editor_cm6/terminal/{shell_id}/resize`
   - Backend updates PTY dimensions
6. **Persistence:**
   - When user leaves app and returns, frontend reads stored shell ID
   - Reconnects to existing PTY (if still alive)
   - Loads scrollback history from PTY

### Key Design Principles

- **Disk-based persistence:** Shell ID stored in `HistoryStore` (JSON file), NOT browser localStorage
- **Stateless frontend:** JS should only render UI and forward events to backend
- **Backend owns PTY lifecycle:** All shell creation/destruction/cleanup is server-side
- **One terminal per app instance:** Frontend requests `/terminal/auto` path, backend resolves to actual shell ID
- **Graceful reconnection:** If stored shell is dead, backend clears stale ID and frontend creates new one

---

## What Needs to Happen

### Immediate Fix (Workaround)

**Strip heavy logic from GET endpoint** - make it lightweight:

```python
@terminal_router.get('/terminal/shell-id')
async def get_terminal_shell_id():
    """Just return the stored shell ID - no validation, no cleanup."""
    history_store = get_history_store()
    shell_id = history_store.get_terminal_shell_id()
    return {"ok": True, "data": {"shell_id": shell_id}}
```

Move orphan cleanup and validation to:
- App worker startup hook
- Separate background task
- Or remove entirely (let framework cleanup handle it)

### Proper Fix (Refactor for ASGI)

**Option A: Make FrameworkShellManager async-native**
- Rewrite all shell manager methods to use `asyncio.subprocess`
- Use `aiofiles` for log reading
- Replace locks with `asyncio.Lock`
- This is a large refactor affecting entire framework

**Option B: Offload shell operations to separate process**
- Run shell manager in dedicated process
- Communicate via IPC (ZMQ, pipes, HTTP)
- Worker sends async requests to manager process
- Manager handles all blocking I/O

**Option C: Hybrid - minimal async wrapper**
- Keep manager synchronous
- Run it in dedicated thread pool executor
- Carefully manage state access with proper locking
- Accept some performance overhead

### Testing Checklist

After fix is applied, verify:

- [ ] `GET /terminal/shell-id` returns within <100ms
- [ ] `POST /terminal/create` spawns framework shell with label `code-editor-terminal`
- [ ] `ps aux | grep bash` shows PTY process running
- [ ] WebSocket `/ws/app/file_editor_cm6/terminal/{shell_id}` connects successfully
- [ ] Typing in XTerm.js widget shows output
- [ ] Shell ID persists when leaving/returning to app
- [ ] Multiple rapid app open/close cycles don't create orphan shells
- [ ] Terminal resize events work
- [ ] Scrollback history loads on reconnect

---

## Related Files

### Backend (Python)
- `app/apps/file_editor_cm6/terminal_backend.py` - Terminal REST/WS endpoints
- `app/apps/file_editor_cm6/terminal_integration.py` - Shell creation/destroy helpers
- `app/apps/file_editor_cm6/history_store.py` - Disk persistence for shell ID
- `app/libs/framework_shell_manager.py` - Global shell lifecycle manager (BLOCKING)

### Frontend (JavaScript)
- `app/apps/file_editor_cm6/static/js/terminal.js` - XTerm.js integration, event handlers
- `app/apps/file_editor_cm6/template.html` - Menu button with toggle handler

### Proxy
- `app/main.py:proxy_app_request()` - HTTP reverse proxy to worker (30s timeout)

---

## Timeline

1. **Pre-ASGI (Flask + flask-sock):** Terminal worked perfectly
2. **ASGI migration started:** Terminal endpoints converted to FastAPI
3. **Issue discovered:** Endpoints timeout, no PTY created
4. **Attempted fix #1:** Made endpoints `async def` - still hung
5. **Attempted fix #2:** Wrapped manager calls in `anyio.to_thread.run_sync` - deadlocked
6. **Current workaround:** Strip validation/cleanup from GET endpoint
7. **Next step:** Choose refactor strategy (A/B/C above) and implement

---

## Notes

- This issue affects **all apps** that use framework shells (not just file_editor_cm6)
- The ASGI migration exposed a fundamental incompatibility: blocking subprocess I/O in async handlers
- Other apps (settings, extensions) may have similar latent issues with shell operations
- The framework was designed for WSGI (multi-process, blocking I/O per request) and needs architectural updates for ASGI (single event loop, non-blocking I/O)

**Priority:** HIGH - Terminal is core feature for code editor app
