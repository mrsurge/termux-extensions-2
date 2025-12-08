# Dex Action Plan – 2025-12-08

## Dependencies
- Add `pyright` to `requirements.txt`; run lock/update if applicable.
- Confirm `typescript-language-server` and `typescript` are installed globally (npm) and on PATH; document install command for local dev if missing.

## LSP Shell Manager module (`app/apps/file_editor_cm6/lsp_shell_manager.py`)
- Define `LSP_COMMANDS` mapping (python → `pyright-langserver --stdio`; typescript/javascript → `typescript-language-server --stdio`).
- Implement binary availability check with `shutil.which` before spawn; log and return `None` on absence.
- Implement `get_or_spawn_lsp_shell(language_id, project_root)` using `FrameworkShellManager.spawn_shell` with label `lsp:{language}` and `cwd=project_root`.
- Track in-memory `language_id → shell_id` cache and `active_language_id`; on lookup, revalidate liveness via manager `get_shell`/`sweep` behavior.
- Implement `get_active_lsp_shell()` returning the active shell record if alive.
- Implement `switch_lsp_shell(new_language_id, project_root)` to update active pointer, optionally start missing shell, and handle unsupported IDs gracefully.
- Implement `shutdown_lsp_shell(language_id)` to gracefully terminate by label/id via manager.
- Add small comment blocks around significant new sections per style preference.

## Integration (`app/apps/file_editor_cm6/main.py`)
- Import the manager helpers; wire into file open/close flow to call `switch_lsp_shell` on language change.
- Consider lightweight API endpoints (start/stop/status) if frontend needs explicit control; keep FastAPI routing style.
- Ensure `cwd` passed to spawns respects home-dir constraint enforced by `FrameworkShellManager`.

## Verification
- Manual: call `get_or_spawn_lsp_shell("python", Path(project_root))`; confirm entry appears in `/api/framework_shells` list.
- Switch to TypeScript/JavaScript buffer; ensure reuse of `typescript-language-server` instance and active pointer updates.
- Shutdown via helper and confirm clean exit/logs; verify no orphaned PTY state (not used).

## Follow-ups
- Add future entries for `gopls`/`rust-analyzer` once binaries are available.
- Consider timeout/idle policy reuse from framework settings instead of bespoke timers.

---

## Report (Dex • 2025-12-08)
- Implemented `app/apps/file_editor_cm6/lsp_shell_manager.py` with vendored-first binary resolution, spawn/switch/shutdown helpers, and debug cache view.
- Added LSP debug endpoints in `app/apps/file_editor_cm6/main.py` (`/api/lsp/switch`, `/active`, `/shutdown`, `/debug/cache`).
- Vendored LSP servers under `app/static/vendor/lsp_servers` (`typescript`, `typescript-language-server`, `pyright`); adjusted manager and docs to prefer this path; removed PyPI `pyright` from `requirements.txt`.
- Created `scripts/test_lsp_switch.sh` (defaults to `http://localhost:8088/api/app/file_editor_cm6`) to exercise switch/active; logs to `~/.tmp/test.log`.
- Smoke test: `/api/lsp/switch` for TypeScript succeeded via framework proxy; shell `fs_1765170217_da6caf5a` running `typescript-language-server` from vendor dir.

---

**Gemini (Planning Buddy) Note:**
The plan above is solid. Just a small heads-up on the "Integration" step: ensure you don't tightly couple the `switch_lsp_shell` call to the `main.py` router if it doesn't belong there. It might be better invoked by the Socket.IO namespace (`lsp_ws.py`) in Step 3. However, exposing a debug endpoint in `main.py` is a good idea for testing.

---

## Report (Jimmy • 2025-12-08)
- Vendored `@codemirror/lsp-client` into `app/static/vendor/nicegui/elements/codemirror`.
- Updated `src/index.mjs` with `export * from "@codemirror/lsp-client";`.
- Rebuilt bundle (`npm run build`) and verified `LSPClient` export availability via grep.
- Verified dependencies: `@codemirror/lsp-client` version `^0.3.0` installed successfully.

---

## Actionable Steps: LSP Socket.IO Bridge (tmp4) — vectorArc • 2025-12-08 05:44 UTC

**Status:** tmp2 (Shell Manager) and tmp3 (Vendor LSP Client) complete. Ready to implement tmp4.

### Step 1: Create LSP Socket.IO Namespace (`lsp_ws.py`)

**File:** `app/apps/file_editor_cm6/lsp_ws.py`

- [ ] Define `LSPSocketIONamespace(socketio.AsyncNamespace)` with namespace `/lsp`
- [ ] Implement `on_connect(sid, environ)` — stub, wait for initialize
- [ ] Implement `on_initialize(sid, data)` — extract `languageId`, `projectRoot`; call `get_or_spawn_lsp_shell()`; store shell reference in `active_shells[sid]`
- [ ] Implement `on_lsp_client_to_server(sid, message)` — serialize JSON, prepend `Content-Length` header, write to shell stdin
- [ ] Implement `bridge_shell_output(sid, shell)` — async task that:
  - Reads from shell stdout buffer
  - Parses `Content-Length` headers
  - Extracts exactly N bytes of JSON body
  - Emits `lsp:server_to_client` to client
- [ ] Implement `on_disconnect(sid)` — clean up `active_shells[sid]` (don't kill shell; may be shared)

### Step 2: Implement LSP Framing Parser

**In:** `lsp_ws.py` (helper class or function)

- [ ] Create `LSPFrameParser` class with buffer and state machine:
  - State: `READING_HEADER` / `READING_BODY`
  - `feed(data: bytes)` — append to buffer, yield complete messages
  - Parse `Content-Length: N\r\n\r\n` pattern
  - Read exactly N bytes for body
  - Return parsed JSON objects
- [ ] Handle partial reads gracefully (network chunking)

### Step 3: Wire Shell STDIO to Namespace

**Consideration:** Framework shells write to log files, not live streams. Options:

- [ ] **Option A:** Use PTY shell (`uses_pty=True`) for bidirectional streaming — preferred for LSP
- [ ] **Option B:** Modify `lsp_shell_manager.py` to expose raw stdin/stdout pipes
- [ ] **Decision needed:** Check if current shell spawns support direct pipe access or if PTY is required

### Step 4: Register Namespace in `main.py`

**File:** `app/apps/file_editor_cm6/main.py`

- [ ] Import `LSPSocketIONamespace` from `lsp_ws`
- [ ] In `init_nicegui_with_app()`, add: `ng.sio.register_namespace(LSPSocketIONamespace('/lsp'))`

### Step 5: Client-Side SocketIOTransport (tmp5 scope, but note here)

**File:** Vendored CM6 LSP client or `template.html`

- [ ] Implement `SocketIOTransport` class that:
  - Connects to `/lsp` namespace
  - Emits `lsp:client_to_server` for outgoing LSP messages
  - Listens on `lsp:server_to_client` for incoming LSP messages
  - Adapts to `@codemirror/lsp-client` transport interface

### Step 6: Testing

- [ ] Manual: Open Python file, verify `pyright-langserver` shell spawns
- [ ] Manual: Check Socket.IO `/lsp` connection in browser devtools
- [ ] Manual: Send `initialize` request, verify response flows back
- [ ] Manual: Trigger hover/completion, verify LSP roundtrip

### Open Questions

1. **Shell STDIO access:** Does `FrameworkShellManager` expose live stdin/stdout or only log files? If log-only, need PTY or pipe modification.
2. **Multi-client:** Should multiple browser tabs share one LSP shell per language? Current design: yes (shell per language, not per sid).
3. **Lifecycle:** When to shutdown LSP shells? On last client disconnect? Idle timeout?

---

*vectorArc • 2025-12-08 05:44 UTC*

---

**Gemini (Planning Buddy) to VectorArc (Step 3):**

**Ref: Open Question 1 (Shell STDIO access)**

You correctly identified that `FrameworkShellManager` defaults to log-file redirection, which is insufficient for real-time LSP byte streaming.

**Decision:**
We will modify the core `FrameworkShellManager` to support a "Live Pipe" mode framework-wide. This is better than a local hack.

**Action Plan Update for VectorArc:**

1.  **Modify `app/libs/framework_shells.py`:**
    *   Add a new parameter to `spawn_shell`: `enable_pipes=False`.
    *   If `True`:
        *   Set `stdout=subprocess.PIPE` and `stdin=subprocess.PIPE`.
        *   Do *not* overwrite them with log file handles.
        *   (Optional but good) Start a background thread to tee the pipe output to the log file so we don't lose logging.
2.  **Update `lsp_shell_manager.py`:**
    *   Call `spawn_shell(..., enable_pipes=True)`.
3.  **Implement `bridge_shell_output`:**
    *   Now you can safely read from `shell.process.stdout`.

Proceed with this infrastructure upgrade as part of Step 3.

---

## Action Plan: Live Pipe Mode — vectorArc • 2025-12-08 05:54 UTC

**Per Gemini's guidance on Open Question 1:**

1. **Modify `app/libs/framework_shells.py`** — Add `enable_pipes=False` param to `spawn_shell()`; when `True`, use `subprocess.PIPE` for stdin/stdout
2. **Update `lsp_shell_manager.py`** — Spawn LSP shells with `enable_pipes=True`
3. **Implement `bridge_shell_output` in `lsp_ws.py`** — Read from `shell.process.stdout` directly

---

*vectorArc • 2025-12-08 05:54 UTC*

---

## Implementation Complete: LSP Socket.IO Bridge (tmp4) — vectorArc • 2025-12-08 06:15 UTC

**Files Modified:**
1. `app/libs/framework_shells.py` — Added `uses_pipes` field, `PipeState` dataclass, `_launch_pipe()`, `spawn_shell_pipe()`, `get_pipe_state()`, `_stop_pipe()`
2. `app/apps/file_editor_cm6/lsp_shell_manager.py` — Changed to use `spawn_shell_pipe()` instead of `spawn_shell()`
3. `app/apps/file_editor_cm6/main.py` — Registered `/lsp` namespace

**Files Created:**
1. `app/apps/file_editor_cm6/lsp_ws.py` — LSPSocketIONamespace with LSPFrameParser

**Next Steps (tmp5):**
- Client-side SocketIOTransport in CM6 to connect to `/lsp` namespace
- Wire up to `@codemirror/lsp-client`

---

*vectorArc • 2025-12-08 06:15 UTC*

---

## Progress Report: LSP Socket.IO Bridge (tmp4) — vectorArc • 2025-12-08 06:09 UTC

**Completed:**

1. **Framework infrastructure** (`app/libs/framework_shells.py`):
   - Added `uses_pipes: bool` field to `ShellRecord`
   - Created `PipeState` dataclass for live stdin/stdout access
   - Implemented `_launch_pipe()` — spawns with `subprocess.PIPE`
   - Implemented `spawn_shell_pipe()` — public API
   - Implemented `get_pipe_state()` — returns `PipeState` for direct I/O
   - Implemented `_stop_pipe()` — cleanup
   - Updated `terminate_shell()`, `restart_shell()`, `remove_shell()` to handle pipes

2. **LSP Shell Manager** (`app/apps/file_editor_cm6/lsp_shell_manager.py`):
   - Changed `spawn_shell()` → `spawn_shell_pipe()` for bidirectional streaming

3. **LSP Socket.IO Namespace** (`app/apps/file_editor_cm6/lsp_ws.py`) — NEW FILE:
   - `LSPFrameParser` — Content-Length header parsing state machine
   - `LSPSocketIONamespace` — `/lsp` namespace handler
   - Events: `on_initialize`, `on_lsp_client_to_server`, `on_disconnect`
   - Background reader task bridges shell stdout → Socket.IO

4. **Namespace Registration** (`app/apps/file_editor_cm6/main.py`):
   - Added `/lsp` namespace alongside `/explorer`

**All files compile.** Ready for tmp5 (client-side SocketIOTransport).

---

*vectorArc • 2025-12-08 06:09 UTC*
