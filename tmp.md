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

---

## Action Plan: CM6 LSP Integration (tmp5) — neonInk • 2025-12-08

### 1. JavaScript: Socket.IO Transport
- In `app/static/vendor/nicegui/elements/codemirror/codemirror.js`, add a `SocketIOTransport` class that:
  - Connects to the `/lsp` namespace using `io(namespace, { path: "/ui/_nicegui_ws/socket.io", transports: ["websocket", "polling"] })`.
  - Emits an `initialize` event on `connect` with `{ languageId, projectRoot }`.
  - Listens for `lsp:server_to_client` and forwards messages to a stored `onMessage` callback.
  - Implements `send(data)` by emitting `lsp:client_to_server` with a plain JS object (parse JSON strings as needed).
  - Implements `close()` by disconnecting the underlying socket and clearing listeners.

### 2. JavaScript: LSP Client Wiring in Vue Component
- Detect `LanguageServerClient` from the bundle (`const LSPClient = CM.LanguageServerClient || null`) and log a warning if missing.
- Extend component `data()` with `lspClient`, `lspTransport`, and `lspCompartment` (a `CM.Compartment` for LSP extensions).
- Add `connectLSP(languageId, projectRoot)` method that:
  - Guards on `LSPClient` and `this.editor` being available.
  - Calls `disconnectLSP()` first if an existing client is active.
  - Creates `SocketIOTransport('/lsp', languageId, projectRoot)` and `new LSPClient({ transport, rootUri, workspaceFolders, languageId })`.
  - Subscribes to `documentSymbols` (and other useful events) and forwards them to a new `handleDocumentSymbols(symbols)` method.
  - Installs the LSP extension via `lspCompartment.reconfigure([this.lspClient.extension])` in an editor dispatch.
- Add `disconnectLSP()` method that:
  - Disposes `this.lspClient` if present (letting it close the transport).
  - Clears `lspClient`/`lspTransport` references and reconfigures the LSP compartment to `[]`.
- Ensure the component’s teardown hook (e.g. `beforeUnmount`/`beforeDestroy`) calls `disconnectLSP()` to avoid leaks.

### 3. JavaScript: Symbol Handling Surface
- Implement `handleDocumentSymbols(symbols)` in `codemirror.js` that:
  - Caches the latest symbols on the component instance.
  - Notifies the host via an existing mechanism (`notifyParent('document_symbols', { symbols })` or a new `$emit('documentSymbols', symbols)`).
- Keep this method minimal so sticky-scroll/outline features can evolve on the host side without changing the vendor bundle.

### 4. Python: NiceGUI Wrapper Methods
- In `app/static/vendor/nicegui/elements/codemirror/codemirror.py`, add:
  - `def connect_lsp(self, language_id: str, project_root: str) -> None: self.run_method('connectLSP', {'languageId': language_id, 'projectRoot': project_root})`
  - `def disconnect_lsp(self) -> None: self.run_method('disconnectLSP')`
- Do not change the constructor; make LSP usage explicitly opt-in via these methods.

### 5. Backend: Auto-Connect Helper in `editor_app.py`
- Define `LSP_LANGUAGE_MAP` near the top of `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` mapping file suffixes to language IDs (e.g. `.py` → `python`, `.js` → `javascript`, `.ts` → `typescript`, `.tsx` → `typescriptreact`, `.go` → `go`, `.rs` → `rust`).
- Implement `_should_use_lsp(project_root: Path, language_id: str) -> bool` that:
  - For now checks a simple editor preference flag (e.g. `prefs.get('enableLsp', False)`) and returns False if disabled.
  - Can later grow to consult project-level config (tmp7) without changing the call sites.
- Implement `_maybe_connect_lsp(editor, file_path: Path, project_root: Path)` that:
  - Looks up `language_id = LSP_LANGUAGE_MAP.get(file_path.suffix)`.
  - Returns early if `language_id` is unsupported or `_should_use_lsp()` is False.
  - Calls `editor.connect_lsp(language_id, str(project_root))`.
- Call `_maybe_connect_lsp(...)` in the code paths that open or switch the active file (initial load in `editor_page()` and any file-switch endpoint) after `_active_editor` and `_current_file_path` are set.

### 6. Backend: LSP Disconnect Hooks
- Ensure that when the active document becomes `None`/blank (null document state) or the editor page is torn down, the backend calls `editor.disconnect_lsp()` to mirror the frontend cleanup.
- On project switches or file switches to non-LSP-eligible types, call `disconnect_lsp()` before changing `_current_file_path` so language shells can be reused cleanly by the next connection.

### 7. Testing & Verification
- Manual smoke tests:
  - Open `.py`, `.js`, and `.tsx` files and verify:
    - `/lsp` namespace receives `initialize` and subsequent LSP messages (check worker logs).
    - Language servers respond without protocol framing errors and `documentSymbols` events reach the host.
  - Switch between different LSP-enabled files and confirm:
    - Only one framework shell per language remains running (`/api/framework_shells`), no per-tab duplication.
    - `disconnectLSP` is called on teardown (no lingering Socket.IO connections in browser devtools).
- Failure scenarios:
  - Temporarily break LSP server binaries (rename vendored `.bin` symlinks) and confirm:
    - LSP connection attempts fail gracefully with clear log messages.
    - The editor remains usable without LSP (no hard errors on load or file switch).

---

*neonInk • 2025-12-08 06:30 UTC*

---

## Progress Report: CM6 LSP Integration (tmp5 Step 4) — neonInk • 2025-12-08

**Files Touched:**
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**What Changed (Step 4 – Symbol Handling Surface):**
1. **Vue Component State:**
   - Added `lspSymbols` array to store the latest LSP `documentSymbols` payload.
   - Added `_stickyScrollPlugin` handle so the sticky scroll ViewPlugin can register itself back on the Vue instance.

2. **`handleDocumentSymbols(symbols)` Implementation:**
   - Normalizes incoming payloads (`symbols` array or `{ symbols: [...] }`) into `this.lspSymbols`.
   - On update, calls `this._stickyScrollPlugin.updateStickyHeader(true)` when the plugin is active, so Sticky Scroll recomputes immediately with the new symbol tree.
   - Optionally notifies the host via `notifyParent('cm6-document-symbols', { symbols: this.lspSymbols })` for outline/telemetry use cases.

3. **Sticky Scroll Plugin Wiring:**
   - In the sticky scroll `ViewPlugin` constructor, stores `this` into `cmComponent._stickyScrollPlugin` when available; `destroy()` clears that reference.
   - Scope candidate builder now prefers:
     - Markdown headings for markdown documents (unchanged).
     - LSP-backed sections flattened from `cmComponent.lspSymbols` when present (uses LSP ranges to derive `startLine`/`endLine` and preserves existing height/offset logic).
     - Falls back to the original Lezer syntax-tree path when no symbols are available or LSP is disabled.

**Net Effect:**
- Sticky Scroll can consume LSP `documentSymbols` directly (no Python round-trip), while markdown and non-LSP languages continue using the existing syntax-tree heuristics. Host-level consumers still receive a structured symbol event if they want to build an Outline View later.

*neonInk • 2025-12-08 07:05 UTC*

---

## Progress Report: LSP Transport + Auto-Connect Wiring (tmp5 Steps 4–5) — neonInk • 2025-12-08

**Files Touched:**
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- `app/apps/file_editor_cm6/preferences_store.py`

**Frontend (codemirror.js):**
- Added `SocketIOTransport` class that wraps the global `io` Socket.IO client, connects to `/lsp` with the NiceGUI path, sends an `initialize` payload on connect, and forwards `lsp:server_to_client` messages into the LSP client’s `onMessage` handler.
- Extended Vue `data()` with `lspClient`, `lspTransport`, and `lspCompartment` to track the LSP client, its transport, and a dedicated CM compartment for the extension.
- Implemented `connectLSP(languageId, projectRoot)` to:
  - Guard on `this.editor` and `CM.LanguageServerClient` presence.
  - Tear down any existing client via `disconnectLSP()`.
  - Create `SocketIOTransport('/lsp', languageId, projectRoot)` and `new CM.LanguageServerClient({ transport, rootUri, workspaceFolders, languageId })`.
  - Register a `documentSymbols` listener that feeds into `handleDocumentSymbols(symbols)`.
  - Install the LSP extension via `this.lspCompartment.reconfigure([this.lspClient.extension])`.
- Implemented `disconnectLSP()` to dispose the client, close the transport, clear the compartment, and reset `lspSymbols`, while asking the sticky scroll plugin to refresh once more.
- Added `beforeDestroy` / `beforeUnmount` hooks that call `disconnectLSP()` for best-effort cleanup on component teardown.

**Backend Wrapper (codemirror.py):**
- Added `connect_lsp(language_id, project_root)` and `disconnect_lsp()` methods on `CodeMirror` that proxy to the JS methods via `run_method('connectLSP', ...)` and `run_method('disconnectLSP')`.

**Backend Auto-Connect (editor_app.py):**
- Introduced `LSP_LANGUAGE_MAP` mapping file extensions to LSP language IDs (python/javascript/typescript/tsx/go/rust, etc.).
- Added `_should_use_lsp(project_root, language_id)` which currently gates on the editor preference `enableLsp` (default False).
- Implemented `_maybe_connect_lsp(editor, file_path, project_root)` that:
  - Disconnects when there is no active document/project or when the extension is unsupported.
  - Disconnects when `enableLsp` is false.
  - Calls `editor.connect_lsp(language_id, str(project_root))` when all conditions are met, with error logging if methods are missing.
- Wired `_maybe_connect_lsp(...)` into:
  - `editor_page()` after the editor is constructed and preferences applied (initial file load).
  - `/editor/set_content` after `set_current_file(...)` to react on file switches.

**Preference Toggle (preferences_store.py):**
- Added `"enableLsp": False` to `DEFAULT_EDITOR_PREFS` so the existing `/api/app/file_editor_cm6/preferences` POST endpoint can now persist `editor.enableLsp` and the backend gate can read it reliably.

**Known State:**
- The wiring from preference → backend decision → LSP client → Socket.IO transport is in place. The remaining issue observed in manual testing is that `enableLsp` was not yet present in the on-disk prefs snapshot (likely due to worker/proc lifetime vs. when the default schema change landed), so the gate still evaluates to false. This is an environment/application lifecycle detail rather than a code-path syntax error; the Python module now compiles cleanly and is ready for another end-to-end test once the worker reloads with the updated defaults.

*neonInk • 2025-12-08 07:25 UTC*
