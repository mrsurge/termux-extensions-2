# CODE_TE2 (Monaco Iframe Editor) — End‑to‑End Reference

This document describes the **current** Monaco editor surface used by `file_editor_cm6` inside TE2:

- **Monaco runs inside an iframe** served by the **app worker** (FastAPI).
- The editor is controlled via a **dedicated Socket.IO channel** proxied by the **main framework**.
- Document content, drafts, and preferences are governed by SSOT (`_history_store` / project sidecar, `_preferences_store`).

This is intentionally written as a “wiring + protocol” reference: what runs where, what calls what, and what payloads exist.

---

## Roadmap (Monaco + Workbench Sidecar)

This is the current direction:
- TE2 remains the **only** authority for edit/save/draft/autosave/versioning (SSOT).
- VS Code compatible language intelligence is provided by a **sidecar** that talks to a real `code-server` extension host.
- Monaco stays thin and consumes normalized requests/events over a dedicated transport.

Cross references:
- `docs/apps/code_cm6/MONACO_WORKBENCH_SPRINT_PLAN.md`
- `docs/apps/code_cm6/VSCODE_API_CONTRACT.md`
- `docs/apps/code_cm6/VSCODE_API_STATE_OWNERSHIP.md`
- `docs/apps/code_cm6/VSCODE_API_DEPRECATIONS.md`

### Current milestone (read-only language intelligence + live diagnostics)
Status: implemented and working for **all built-in languages** (Python, TypeScript, JavaScript, CSS, HTML, JSON, etc.):
- `code-server` runs as a **pipe-backend** framework shell on fixed port `127.0.0.1:18180` with `--disable-workspace-trust`. Stdout is read by the Python shell manager for readiness detection ("HTTP server listening" regex). The pipe backend ensures code-server terminates automatically with the app worker.
- Node **workbench adapter** runs as a **pipe-backend** framework shell. All RPC (hover, symbols, openFile, didChange, diagnostics nudge) flows over **stdio JSON-RPC** (stdin/stdout pipe), not HTTP. The adapter's HTTP server on port `18181` is vestigial and will be removed.
- **No HTTP in the editor data flow.** The old `vscode_api` WS JSON-RPC bridge is bypassed. All language-feature requests go: browser → Socket.IO → `editor_ws.py` → stdin pipe → adapter → extension host → stdout pipe → browser.
- Diagnostics flow through a **server-side bridge** (`diagnostics_bridge.py`) over the editor Socket.IO channel. The diagnostics nudge (`vscode.openFile`) also uses the stdio pipe.
- **Live typing diagnostics** via `vscode.didChange`: Monaco’s 120ms debounced `onDidChangeModelContent` pushes the full buffer to the extension host via `$acceptModelChanged` (rpcId 85, `isFlush: true`). The ext host updates its mirror model, Pyright/TS re-analyzes, and fresh diagnostics flow back through the existing bridge. No file I/O, no save required.
- **Diagnostics counter** (toolbar badge) resets to zero on file switch, then updates when new diagnostics arrive for the new file.
- The workbench adapter and code-server are started eagerly at worker boot. Code-server readiness (pipe stdout regex) **gates** adapter startup, eliminating race conditions.
- Working end-to-end (over stdio pipe): `vscode.openFile`, `vscode.documentSymbols`, `vscode.hover`, `vscode.didChange`.
- **File watcher pipeline** (working): TE2 subscribes to code-server's native `remoteFilesystem` IPC channel to receive file change events — zero overhead, no extension needed. Triple fallback: VS Code IPC (default) → raise inotify limit (recovery) → watchexec poll (last resort) → none/lazy (manual). Watcher mode is persisted per-project in ProjectSidecar. Explorer git decorations propagate to parent directories on every change.
- **Builtin extensions** are loaded by default (95 scanned from code-server, filtered to ~30 language-related).
- **LanguageId detection**: the adapter infers language from file extension when not provided (supports 40+ extensions including `.mjs`, `.cjs`, `.mts`, `.cts`, `.jsx`, `.tsx`).

Known limitation (expected right now):
- Files without an LSP extension (e.g. Markdown) won’t get live diagnostics — the toolbar badge clears to zero on switch.

### Extension validation matrix (next milestone)
We will validate at least 2 deterministic features (hover + symbols + diagnostics) per language:
- Python: `ms-pyright` (baseline) — **validated**: open file, document symbols, hover, diagnostics.
- TypeScript/JavaScript: built-in TS language service — **validated**: diagnostics working for `.ts`, `.js`, `.mjs`, `.tsx`, `.jsx` files. JS files get JavaScript-level strictness (lenient), TS files get full type checking.
- C++: `llvm-vs-code-extensions.vscode-clangd` — **validated**: diagnostics on open + live diagnostics on edit (after endColumn fix). Clangd is strict about UTF-16 range validity — sentinel endColumn values like INT32_MAX cause `"utf-16 offset ... is invalid for line N"` rejection and break subsequent analysis.
- Rust: `rust-lang.rust-analyzer` — pending.

---

## 0) High‑level map

```
Browser host shell (file_editor_cm6/template.html + main.js)
  ├─ Explorer drawer (Socket.IO transport; worker-side server, main-process proxy)
  ├─ Terminal drawer (PTY plumbing; separate)
  └─ Editor iframe <iframe src="/api/app/file_editor_cm6/ui/nc?...">
        ├─ FastHTML harness: m_editor_app.py
        ├─ Monaco runtime:  m_editor_app.js
        ├─ Monaco assets:   /api/app/file_editor_cm6/ui/monaco_vscode/esm/...
        └─ Touch selection: /api/app/file_editor_cm6/static/vendor/monaco-touch-selection/...

Main framework process (app/main.py)
  ├─ Proxies /app/file_editor_cm6 → worker port
  ├─ Loads app services declared in manifest.json
  ├─ Explorer transport service (WS proxy): /explorer_ws/socket.io → worker
  ├─ LSP transport service (Socket.IO)    : /lsp_ws/socket.io
  ├─ Editor transport service (WS proxy)  : /editor_ws/socket.io  → worker
  └─ UI IPC transport service (WS proxy)  : /ui_ipc_ws/socket.io  → worker

App worker process (app/apps/file_editor_cm6/main.py)
  ├─ HTTP routes: /api/app/file_editor_cm6/*
  ├─ NiceGUI still mounted for legacy editor API endpoints (/editor/*)
  ├─ Monaco iframe routes under /ui/*
  ├─ Worker Socket.IO: /editor_ws/socket.io (EDITOR_ASGI_APP)
  ├─ Worker Socket.IO: /explorer_ws/socket.io (EXPLORER_ASGI_APP)
  ├─ Worker Socket.IO: /ui_ipc_ws/socket.io (UI_IPC_ASGI_APP)
  └─ SSOT stores: _history_store (project sidecar), _preferences_store

Framework shells (service processes owned by the framework_shells orchestrator)
  ├─ code-server (pipe backend): real VS Code-compatible backend + remote extension host
  │     stdout piped to Python for readiness detection; stderr fanned to UI via shell wrapper
  ├─ workbench adapter (pipe backend, Node): initiates remote-agent WS connection; decodes/encodes workbench protocol
  │     stdin/stdout = JSON-RPC transport (<<<RPC>>> prefix on responses)
  │     stderr = adapter logs (console.log redirected to console.error)
  └─ vscode_api (Node): browser-facing JSON-RPC bridge for VSIX/themes/grammars (NOT used for hover/symbols/openFile)

Diagnostics pipeline (server-side bridge, not browser WS):
  adapter WS (18181) → diagnostics_bridge.py → editor Socket.IO → browser

Language feature pipeline (stdio pipe, no HTTP):
  browser → Socket.IO (editor_workbench_*) → editor_ws.py → adapter stdin pipe → extension host
  extension host → adapter stdout pipe (<<<RPC>>>) → editor_ws.py → Socket.IO → browser

Live diagnostics pipeline (didChange, stdio pipe):
  Monaco onDidChangeModelContent (120ms debounce) → editor_workbench_did_change
    → editor_ws.py → adapter stdin → $acceptModelChanged (rpcId 85, isFlush:true)
    → ext host mirror model update → Pyright/TS re-analysis
    → $changeMany → diagnostics_bridge.py → editor Socket.IO → browser markers

File watcher pipeline (IPC — triple fallback):
  code-server parcel watcher detects disk change
    → remoteFilesystem IPC channel fires EventFire (ResponseType 204)
    → workbench_client.mjs onEvent({type: "watcher/fileChanges", changes: [...]})
    → diagnostics_bridge.py WS → abs→rel path conversion
    → explorer:event {type: "watcher:files", payload: {created, changed, deleted}}
    → main.js dispatch → explorer.js handleExplorerEvent
    → git:status refresh + directory re-listing + parent dir decoration propagation
  Fallbacks: raise inotify limit → watchexec --poll -- cat → none (manual refresh)

UI IPC pipeline (frontend-to-frontend relay via Python):
  iframe m_editor_app.js ─┬─ Ctrl+S → ui_event {type:"save"}
                          └─ editor focus → ui_event {type:"focus"}
    → Socket.IO /ui_ipc namespace (path: /ui_ipc_ws/socket.io)
    → ui_ipc_ws.py UIIPCNamespace (logs + rebroadcasts, skip sender)
    → main.js receives ui_event
      ├─ type:"save"  → synthetic Ctrl+S keydown → existing saveFile() handler
      └─ type:"focus" → synthetic click on body → existing closeAllMenus() handler
```

---

## 0.5) Framework Shells (Transport vs Execution)

Terminology used in TE2:
- A **framework shell** is a long-lived subprocess managed by `framework_shells` (start/adopt/terminate + readiness).
- **Transport level** is “how bytes move” (Socket.IO/WS/HTTP proxies). It must stay proxy-only.
- **Execution level** is “who runs logic/state” (worker SSOT, extension host, adapter decode/encode).

For `file_editor_cm6`, we intentionally separate responsibilities:
- **Editor SSOT transport (existing)**: `/editor_ws/socket.io` (main process proxies to worker).
- **Language feature transport (stdio pipe)**: `editor_ws.py` handlers → `adapter_rpc()` over stdin/stdout pipe to workbench adapter. No HTTP hop.
- **VSIX/grammar/theme transport (WS)**: `/vscode_api_ws` (main process proxies to `vscode_api` shell). Only used for extension management, NOT for hover/symbols/openFile.
- **Execution**:
  - Worker owns drafts/saves/versioning (`HistoryStore`/sidecar).
  - `code-server` owns extension execution (remote extension host).
  - Node workbench adapter owns the remote-agent WS session and workbench protocol encoding/decoding.

Deterministic ports (current):
- `code-server`: `127.0.0.1:18180` (pipe-backend framework shell)
  - `--user-data-dir ~/.config/code-server`
  - `--extensions-dir ~/.config/code-server/extensions`
  - `--disable-workspace-trust`
  - stdout piped to Python; stderr visible in framework shells UI via `2>&1 | while read` wrapper
- workbench adapter: `127.0.0.1:18181` (pipe-backend framework shell, HTTP port is vestigial)
  - stdin/stdout = JSON-RPC pipe transport
  - console.log redirected to console.error for UI visibility

Discovery endpoints (worker, proxied via main process):
- `GET /api/app/file_editor_cm6/code_server/discover`
- `GET /api/app/file_editor_cm6/workbench_adapter/discover`
- `GET /api/app/file_editor_cm6/vscode_api/discover`

Workbench adapter baton (deterministic startup):
- `GET /api/app/file_editor_cm6/workbench_adapter/start`
  - Starts/adopts code-server + adapter and returns a **baton token**.
- `GET /api/app/file_editor_cm6/workbench_adapter/status?token=...`
  - Poll until `state` is `connected` or `ready`.
- `POST /api/app/file_editor_cm6/workbench_adapter/cmd`
  - **Requires** header `x-te2-baton: <token>` (or `?token=` query).
  - Prevents early 502/500 races by ensuring the adapter is up before commands.

Spinner / Status indicator (host UI):
- The host UI uses a **3-state status indicator** (`#fe-lsp-spinner`) that is always visible:
  - **busy** (CSS `fe-lsp-status--busy`): animated spinner — adapter starting, readiness chain running, or diagnostics in progress.
  - **ok** (CSS `fe-lsp-status--ok`): green check — adapter connected and operational.
  - **error** (CSS `fe-lsp-status--error`): red X — adapter not connected (default on page load).
- State is managed by `_feUpdateLspSpinner()` which reads `window.__adapterConnected` (set by `_spinnerHide(true)` after baton completes) and `window.__feLspSpinnerUi.busyShow` to decide which class to apply.
- To avoid competing writers, the spinner has an explicit "activity owner" (`window.__feLspSpinnerUi.busyActivity`):
  - `workbench_adapter`: `ensureWorkbenchAdapterReady()` owns the spinner while starting/polling the adapter.
  - `diagnostics`: the diagnostics baton owns the spinner while waiting for per-file analysis.
- `ensureWorkbenchAdapterReady()` must not overwrite the spinner title while `busyActivity === 'diagnostics'`.
- Long-press / right-click on the indicator opens the adapter context menu (`#fe-adapter-dd`) with a "Reload Extension Adapter" option.

## 1) Key files (where to look)

### Monaco iframe (worker)
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.py`
  - FastHTML entrypoint route: `/ui/nc` (worker‑relative; proxied under `/api/app/file_editor_cm6/ui/nc`)
  - Serves pinned Monaco assets under `/ui/monaco_vscode/*`
  - Provides a **CSS‑import shim** for Monaco ESM (`import './foo.css'`)
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js`
  - Monaco editor bootstrap
  - Model management (plain editor vs diff editor)
  - Draft overlay decorations (blue inserts / yellow deletes)
  - Editor Socket.IO client wiring (namespace `/editor`, path `/editor_ws/socket.io`)

### Editor Socket.IO (worker)
- `app/apps/file_editor_cm6/monaco_editor/editor_socketio.py`
  - `EDITOR_SIO` (worker server) and `EDITOR_ASGI_APP` (mounted at `/editor_ws/socket.io`)
- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
  - Namespace logic (`EditorSocketIONamespace("/editor")`)
  - SSOT snapshot on connect
  - Open, mirror, git baselines, draft diff, save
  - `on_editor_mirror`: persists draft, emits `editor:cache_state`, triggers `notify_draft_state_changed`
  - `on_editor_workbench_did_change`: fire-and-forget `vscode.didChange` to adapter via stdio
  - `on_editor_save_request`: writes to disk, clears draft, emits clean `editor:cache_state`

### Explorer Socket.IO (worker)
- `app/apps/file_editor_cm6/explorer_socketio.py`
  - `EXPLORER_SIO` (worker server) and `EXPLORER_ASGI_APP` (mounted at `/explorer_ws/socket.io`)
- `app/apps/file_editor_cm6/explorer_ws.py`
  - `ExplorerSocketIONamespace("/explorer")`: routes events to `ExplorerDispatcher` per client
  - `ExplorerDispatcher`: file tree, git status, review panel, search, draft decorations
  - `notify_draft_state_changed()`: debounced broadcast of `explorer:updateDecorations` + `review:setEntries`
  - `_broadcast_draft_decorations()`: reads `DraftIndexSidecar`, broadcasts decorations and review list
  - `broadcast_review_state()`: broadcasts review entries + draft decorations to all clients
  - `_notify_editor_draft_cleared()`: cross-transport emit to editor SIO (`editor:cache_state`) for toolbar badge
  - `handle_review_save` / `handle_review_discard`: save/discard drafts, notify editor + explorer

### Transport proxies (main process, all proxy-only)
- `app/apps/file_editor_cm6/services/editor_transport.py`
  - Proxies `/editor_ws/socket.io` websocket frames to worker port
- `app/apps/file_editor_cm6/services/explorer_transport.py`
  - Proxies `/explorer_ws/socket.io` websocket frames to worker port
  - Previously ran explorer business logic in-process (architectural violation, fixed)
- `app/apps/file_editor_cm6/services/vscode_rpc_transport.py`
  - Proxies `/vscode_rpc_ws` websocket frames to vscode_rpc framework shell
- `app/apps/file_editor_cm6/services/ui_ipc_transport.py`
  - Proxies `/ui_ipc_ws/socket.io` websocket frames to worker port
  - Frontend-to-frontend relay (iframe ↔ main page communication)
- All transports: bidirectional WS frame forwarding, no SSOT access, no payload parsing

### Host shell (browser, worker-served)
- `app/apps/file_editor_cm6/template.html`
  - Layout + iframe placement
- `app/apps/file_editor_cm6/main.js`
  - Toolbar/menu logic, explorer integration, session state UI
  - Calls backend editor API endpoints (preferences, check_cache, etc.)
  - Emits `editor_open_request` and `editor_save_request` over editor Socket.IO
  - `_applyEditorCacheState()`: receives `editor:cache_state`, updates draft badge + path display
  - `_applyCacheIndicatorImpl()`: sets `#fe-file-draft-badge` color/text (orange=draft, red=crash, grey=clean)
- `app/apps/file_editor_cm6/static/js/explorer.js`
  - File tree rendering, search, review panel
  - `fetchReviewResults()`: sends `review:list` via explorer bus
  - `review:setEntries` handler: stores entries, re-renders if review overlay visible
  - `renderReviewResults()`: review toolbar, Select All, Save/Discard buttons
  - Draft decorations: `applyDraftFlag(rel, hasDraft)` sets `data-hasDraft` attribute on tree nodes

### SSOT and persistence
- `app/apps/file_editor_cm6/stores.py`
  - Singleton store instances: `_history_store`, `_preferences_store`
- `app/apps/file_editor_cm6/project_sidecar.py`
  - Disk-backed "session_cache" (draft cache entries) at `~/.cache/cm6_editor/projects/{hash}.json`
  - `_instances`: per-process ClassVar cache (not shared across processes)
  - `reload()`: re-reads from disk to pick up cross-process writes
- `app/apps/file_editor_cm6/draft_index_sidecar.py`
  - Lightweight per-project draft index at `{hash}.draft_index.json`
  - `snapshot()` returns `(draft_files, draft_dirs)` sets for O(1) hasDraft checks
  - `_rebuild_from_project_sidecar()`: reads ProjectSidecar file directly from disk
- `app/apps/file_editor_cm6/history_store.py`
  - `upsert_cached_document()`: writes to ProjectSidecar + updates DraftIndexSidecar
  - `list_project_drafts()`: calls `sidecar.reload()` before reading (cross-process safe)
  - `get_cached_document()`: calls `sidecar.reload()` before reading
- `app/apps/file_editor_cm6/explorer/review.py`
  - `list_reviews(project, lightweight)`: queries drafts, optionally computes diff hunks
  - `discard_reviews(project, files)`: clears drafts, reverts active editor if file is open
- `app/apps/file_editor_cm6/preferences_store.py`
  - Disk-backed preferences (editor settings)

---

## 2) URL & mount conventions (the “prefix math”)

### User‑facing routes
- App HTML: `/app/file_editor_cm6`
- App API prefix: `/api/app/file_editor_cm6/...`

### Monaco iframe routes (served by the worker, under the app API prefix)
- Iframe page: `/api/app/file_editor_cm6/ui/nc`
- Monaco ESM: `/api/app/file_editor_cm6/ui/monaco_vscode/esm/vs/...`
- Monaco “lang bundles”: `/api/app/file_editor_cm6/ui/monaco_vscode/lang/...`
- Iframe runtime JS: `/api/app/file_editor_cm6/ui/monaco_editor/m_editor_app.js`

### Editor Socket.IO transport
- Client path: `/editor_ws/socket.io`
- Namespace: `/editor`

Important:
- The **main process** registers `/editor_ws/socket.io` and proxies it to the worker.
- The **worker** mounts Socket.IO ASGI app at `/editor_ws/socket.io` (see `SUBAPPS` in `app/apps/file_editor_cm6/main.py`).
- The transport is intended to be **websocket‑only** (Socket.IO transport = `websocket`).

---

## 3) Main‑process service loader (why services exist)

Services declared in `app/apps/file_editor_cm6/manifest.json`:

```json
"services": {
  "path": "services",
  "modules": ["explorer_transport", "lsp_transport", "editor_transport"]
}
```

Loaded by the main framework’s apps extension loader:
- `app/extensions/apps/loader.py`
  - imports each `services/<module>.py`
  - calls `register(app)` if present
  - auto‑includes any `APIRouter` objects found in the service module

Services run in the **main process** and should provide only:
- Transport shims/proxies
- Infrastructure that must outlive worker restarts

They must **not** mutate app worker SSOT (HistoryStore / ProjectSidecar).

---

## 4) SSOT (HistoryStore / PreferencesStore) model

### Active project
SSOT tracks a single “active project root”. The worker derives most behavior from:
- `_history_store.get_active_project()`

### Active file (single‑doc model)
SSOT maintains a single current document concept (the editor is “one file at a time”):
- `_history_store.get_session_state()` includes `currentPath`
- `_history_store.update_session_state({"currentPath": abs_path})`

### Drafts (project sidecar / session_cache)
Drafts are stored in project sidecar "session_cache" entries:
- key = absolute file path
- content = entire draft text (current buffer)
- metadata includes:
  - `base_sha256` (disk baseline hash when draft started)
  - `content_sha256` (draft content hash)
  - `unsaved` (True/False, computed as `content_sha256 != base_sha256`)
  - runtime identifiers (run_id, etc.)

The editor Socket.IO server (`editor_ws.py`) is the worker-side entry point for persisting drafts from the iframe.

Draft mutations trigger the following pipeline:
1. `on_editor_mirror` persists to `ProjectSidecar.session_cache` via `upsert_cached_document`
2. `DraftIndexSidecar` is updated with the file's unsaved status (fast O(1) hasDraft)
3. `editor:cache_state` is emitted to all editor clients (updates toolbar badge)
4. `notify_draft_state_changed()` broadcasts `explorer:updateDecorations` + `review:setEntries` to explorer clients

### DraftIndexSidecar (fast hasDraft lookups)
- Lightweight per-project index separate from ProjectSidecar
- Stores only relative paths of unsaved files (no content)
- `snapshot()` returns `(files, dirs)` sets for hasDraft icons on files and folders
- Reads directly from the ProjectSidecar **disk file** (not `_instances` cache), so it works cross-process

### Cross-process sync (important architectural note)
- `ProjectSidecar._instances` is a per-process in-memory cache
- Worker process writes drafts; explorer (also in worker after refactor) reads them
- `sidecar.reload()` re-reads from disk before any read operation that might see stale data
- `DraftIndexSidecar._rebuild_from_project_sidecar()` reads disk directly, bypassing `_instances`


### Preferences (PreferencesStore)
Editor preferences are stored per active project and used to initialize the iframe editor options.

Preferences changes are performed via legacy `/editor/*` endpoints (NiceGUI router), but are broadcast to the Monaco iframe via `EDITOR_SIO` (worker Socket.IO server).

---

## 5) HTTP endpoints the Monaco iframe uses (worker API)

The iframe computes `apiBase` from its own URL:
- served at `/api/app/file_editor_cm6/ui/nc`
- `apiBase` becomes `/api/app/file_editor_cm6`

It then fetches:

### SSOT snapshot
- `GET /api/app/file_editor_cm6/state`
  - returns project, recents, preferences, git diff base info, runtime metadata

### Read from disk
- `GET /api/app/file_editor_cm6/read?path=<abs_or_rel>`
  - returns `{path, content, sha256}`
  - the endpoint enforces that `path` must remain under `$HOME`

### Draft cache lookup (legacy editor router, still used)
- `POST /api/app/file_editor_cm6/editor/check_cache`
  - returns `{has_draft, content, base_sha256}` when a cached draft exists
  - implemented in `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (APIRouter prefix `/editor`)

Notes:
- The Monaco iframe uses `/editor/check_cache` as a “draft wins” read path when opening/restoring a file.
- The authoritative “open payload” for socket‑based opens comes from the editor Socket.IO server (see below).

---

## 6) Editor Socket.IO transport (events + payloads)

### Transport
- path: `/editor_ws/socket.io`
- namespace: `/editor`
- room used by server: `"file_editor_cm6"`

Clients:
- Host shell connects with query: `{app_id:'file_editor_cm6', role:'host'}`

### Connection
- see `connectEditorSocket()` in `app/apps/file_editor_cm6/main.js`
- Monaco iframe connects with query: `{app_id:'file_editor_cm6'}`
  - see `connectEditorSocket()` in `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js`

### Naming convention
- Client → server emits underscore events: `editor_open_request`, `editor_mirror`, `editor_save_request`, etc.
- Server → clients broadcasts colon events: `editor:open`, `editor:mirror`, `editor:cache_state`, etc.

### Server: connect snapshot (`editor:ssot`)
Emitted to the connecting client only:
```js
editor:ssot {
  project: "<abs project root>" | null,
  session_state: { currentPath?: "<abs file>" ... },
  preferences: { editor: { ... } ... },
  currentPath: "<abs file>" | null,
  file?: { ...open payload... }     // present when project+currentPath known
}
```

### Open flow
Host initiates:
```js
emit('editor_open_request', { path: "<abs>" })
```

Worker validates and updates SSOT (`currentPath`, recents), then broadcasts:
```js
editor:open {
  path: "<abs>",
  content: "<text>",
  has_draft: boolean,
  base_sha256: "<sha256>",
  content_sha256: "<sha256>",
  state: "clean" | "mid_session" | "crashed",
  unsaved: boolean,
  reason: "disk" | "restore" | ...,
  preferences: {...},
  auto_save: boolean | null,
  source_client: "<sid>"
}
```

The Monaco iframe treats `editor:open` as authoritative content and updates its model directly.

### Draft mirror flow (live buffer)
Iframe emits full‑text mirror updates (debounced):
```js
emit('editor_mirror', {
  path: "<abs>",
  content: "<full buffer>",
  base_sha256: "<baseline sha>"
})
```

Worker persists draft cache into ProjectSidecar and broadcasts:
```js
editor:mirror {
  path: "<abs>",
  content: "<full buffer>",
  base_sha256: "<baseline sha>",
  content_sha256: "<sha>",
  unsaved: true,
  source_client: "<sid>"
}
```

Other iframes apply the remote buffer; the source client ignores self‑echo by SID.

### Git baseline flow (pinned diff)
Iframe requests:
```js
emit('editor_git_baselines_request', { path: "<abs>" })
```

Worker responds to requester only:
```js
editor:git_baselines {
  path: "<abs>",
  tracked: boolean,
  base_ref: "HEAD",
  head_content: "<text>" | null,
  head_sha256: "<sha>" | null,
  disk_content: "<text>",
  disk_sha256: "<sha>",
  source_client: "<sid>"
}
```

Client uses this to build the “native” Git diff view. In pinned mode:
- Git diff compares **HEAD ↔ disk baseline** (not the live buffer)
- Draft edits do not retarget the Git diff baselines

### Draft diff overlay flow (custom decorations)
Iframe requests:
```js
emit('editor_draft_diff_request', { path: "<abs>", requestId, reason })
```

Worker responds:
```js
editor:draft_diff {
  path: "<abs>",
  hunks: [...],
  summary: { added, deleted, tracked },
  error?: "<string>",
  disk_sha256?: "<sha>",
  content_sha256?: "<sha>",
  requestId?: "<id>",
  ms?: <elapsed>,
  source_client: "<sid>"
}
```

Client renders draft overlay decorations (blue insertions / yellow deletions) independent of Git diff.

### Preferences propagation (backend → all clients)
Preferences are changed via HTTP:
- `POST /api/app/file_editor_cm6/editor/update_preference { key, value, nicegui_client_id? }`

The backend:
- persists SSOT preference store
- broadcasts to host shells via explorer bus (for menus)
- broadcasts to Monaco iframes via editor Socket.IO:

```js
editor:prefs_changed {
  project_path: "<abs>",
  key: "<pref key>",
  value: <any>,
  view_state: {...},
  preferences: {...},
  source_client: "<nicegui client id or similar>"
}
```

### Save flow (draft → disk)
Host initiates save with Socket.IO ack:
```js
emit('editor_save_request', {
  path: "<abs>",
  client_id: "<host client id>",
  op_id: "<op id>",
  base_sha256?: "<sha>",
  force?: true
}, ack)
```

Worker:
- reads draft from ProjectSidecar cache for the file
- writes to disk via `write_full()` with base‑sha guard (unless `force`)
- clears draft cache entry + prunes clean drafts
- invalidates git/draft caches and notifies explorer
- emits `editor:cache_state { unsaved:false }` to all clients
- returns ack:
```js
{ ok: true, data: { sha256, size, mtime } }
// or
{ ok: false, error: "BASE_MISMATCH", current_meta: {...} }
```

### Cache state flow (draft indicator + toolbar badge)
Emitted by the server after draft mutations or save operations:
```js
editor:cache_state {
  path: "<abs>",
  state: "clean" | "mid_session" | "crashed",
  unsaved: boolean,
  reason: "mirror" | "save" | "clear" | "discard",
  content_sha256?: "<sha>",
  base_sha256?: "<sha>",
  source_client?: "<sid>"
}
```

Consumers:
- **Host shell** (`main.js`): `_applyEditorCacheState()` updates `#fe-file-draft-badge` (asterisk indicator)
- **Monaco iframe** (`m_editor_app.js`): clears draft decorations on `unsaved:false`, requests fresh draft diff on `unsaved:true`

Cross-transport note: when drafts are cleared via the explorer review panel (save/discard), `_notify_editor_draft_cleared()` in `explorer_ws.py` emits `editor:cache_state` via `EDITOR_SIO` (the editor Socket.IO server), not the explorer bus.

### Diagnostics flow (server-side bridge)
Emitted by the diagnostics bridge when the adapter reports `$changeMany`:
```js
editor:diagnostics {
  type: "diagnostics/update",
  path: "<abs>",
  owner: "<marker owner>",
  markers: [...],
  ts_ms: <timestamp>
}
```

The Monaco iframe converts markers to `monaco.editor.setModelMarkers()` calls.
On file switch, `_clearDiagnosticsForSwitch()` resets all markers and counts to zero.

### didChange flow (live typing diagnostics)
Iframe emits (debounced 120ms):
```js
emit('editor_workbench_did_change', {
  path: "<abs>",
  text: "<full buffer>",
  languageId: "<language>",
  generation: <int>
})
```

Server forwards to adapter via stdio pipe. The adapter calls `$acceptModelChanged` (rpcId 85, `isFlush: true`) on the extension host. Diagnostics flow back through the bridge.
Safety invariant: `didChange` and symbols are accepted only after `openFile` baseline exists for the same `(path, generation)`.

**Range correctness (critical for clangd):** The `$acceptModelChanged` change event contains a `range` that must span the entire previous document. The `endColumn` must be the **actual length of the last line + 1** (1-based columns). Using sentinel values like `2147483647` (INT32_MAX) or `1000000` causes the VS Code mirror model to clamp silently, but clangd's LSP server rejects the invalid UTF-16 offset: `"Failed to update ... utf-16 offset 2147483646 is invalid for line N"`. After rejection, clangd loses track of the document (`"trying to get AST for non-added document"`). The adapter tracks `_docLastLineLength` per path and uses it for correct range construction.

### Relay events (UI commands)
```js
// Marker navigation (next/prev issue)
emit('editor_issues_cmd', { action: "next" | "prev" }) → editor:issues_cmd
// Find/replace
emit('editor_find_cmd', { action: "find" | "replace" | ... }) → editor:find_cmd
```

---

## 6.5) Explorer Socket.IO transport (events + payloads)

### Transport
- path: `/explorer_ws/socket.io`
- namespace: `/explorer`
- Worker-side server: `ExplorerSocketIONamespace` in `explorer_ws.py`
- Main-process proxy: `services/explorer_transport.py` (WS frame forwarding only)

### Connection
Client connects with query: `{app_id: 'file_editor_cm6'}`

On connect, the server creates an `ExplorerDispatcher` per client SID and sends:
- Initial file tree for active project
- Git status decorations
- Draft decorations (hasDraft flags on files/folders)

### Client → Server events
All sent via `explorer_send` with JSON `{type, payload}`:

| Type | Purpose |
|------|---------|
| `tree:list` | Request directory listing |
| `tree:expand` | Expand a directory node |
| `search:query` | Full-text search |
| `review:list` | Request review entries (drafts with optional diff hunks) |
| `review:save` | Save selected drafts to disk |
| `review:discard` | Discard selected drafts |
| `prefs:updateUi` | Update a single global UI preference key (backend validates type) |
| `prefs:vendorAgentIcon` | Vendor an icon asset into the SSOT cache dir (returns a stable asset name) |

### UI Preferences (global)
- Store: `_preferences_store` (disk-backed) in `~/.local/share/termux-extensions-2/code_oss_prefs.json` under the `ui` object
- Update flow:
  - client → server: `prefs:updateUi` payload `{key, value}`
  - server → all clients: `prefs:setUi` payload `{ui: { ...full snapshot... }}`
- Icon vending flow (used by agent shortcuts/toggle):
  - client → server: `prefs:vendorAgentIcon` payload `{abs_path: "/abs/to/icon.svg"}`
  - server → requesting client: `prefs:vendorAgentIconResult` payload `{ok: true, name, url}`
  - asset URL is served by the worker: `GET /api/app/file_editor_cm6/agent_icons/{name}`

### Agent Toggle + Shortcuts (host shell)
The agent toggle is owned by the **host shell** (`template.html` + `main.js`) and is configured entirely via the **Explorer Socket.IO** UI preference channel (`prefs:setUi`).

Behavior:
- The toolbar button (`#fe-agent-toggle`) is always **icon-only**.
- The `icon/text/both` setting applies **only** to how entries render inside the agent shortcuts dropdown (`#fe-agent-dd`).
- Toolbar icon precedence:
  1) If the active `agentDrawerIframeUrl` matches a shortcut that has an icon, that shortcut icon wins.
  2) Otherwise use the global `agentToggleIcon` (emoji/asset).
  3) If `agentToggleIcon.kind == "default"`, keep the default/manifest icon.
- Dropdown open gesture:
  - right-click (desktop) or long-press (touch) opens the shortcuts dropdown.
- Selecting a shortcut updates `agentDrawerIframe=true` and sets `agentDrawerIframeUrl` via `prefs:updateUi`.
- No full page reload: mode/header changes hot-swap the agent controller in-place to preserve SSOT session/editor state.

### Server → Client broadcasts

| Type | Purpose |
|------|---------|
| `explorer:updateDecorations` | Draft flags `{drafts: {rel: {hasDraft: true}}}` |
| `review:setEntries` | Review list `{entries: [{path, rel, has_draft, hunks?, timestamp}]}` |
| `explorer:tree` | File tree data |
| `explorer:gitStatus` | Git status decorations |

### Draft decoration pipeline
When a file is edited:
1. `on_editor_mirror` → `upsert_cached_document` → `DraftIndexSidecar.update_from_abs_file`
2. `notify_draft_state_changed()` fires (debounced)
3. `_broadcast_draft_decorations()` reads `DraftIndexSidecar.snapshot()` and broadcasts:
   - `explorer:updateDecorations` with `{drafts: {rel: {hasDraft: true}, ...}}`
   - `review:setEntries` with full review list (including diff hunks)
4. Explorer UI applies `data-hasDraft="1"` attribute to file/folder nodes (CSS handles visual indicator)

### Review panel flow
1. User opens Review Edits tab → frontend sends `review:list`
2. Server calls `review.list_reviews(project, lightweight=False)` → computes diff hunks per draft
3. Server broadcasts `review:setEntries` with entries
4. **Live updates**: `_broadcast_draft_decorations()` also broadcasts `review:setEntries`, so the review list auto-refreshes when drafts change
5. User selects files and clicks Save/Discard:
   - `review:save` → `handle_review_save` → writes to disk, clears caches, emits `editor:cache_state` to editor transport
   - `review:discard` → `handle_review_discard` → clears caches, reverts editor if file open, emits `editor:cache_state`

### Cross-transport communication (explorer → editor)
Both Socket.IO servers (`EXPLORER_SIO` and `EDITOR_SIO`) run in the same worker process.
Explorer can emit to editor clients via:
```python
from .monaco_editor.editor_socketio import EDITOR_SIO
await EDITOR_SIO.emit('editor:cache_state', payload, namespace='/editor')
```
Used by `_notify_editor_draft_cleared()` to update the toolbar draft badge when drafts are saved/discarded from the review panel.

---

## 7) Monaco asset pipeline (pinned VS Code build)

The Monaco iframe uses the pinned VS Code `monaco-editor-core` ESM output:
- mounted at `/api/app/file_editor_cm6/ui/monaco_vscode/esm/...`

The harness also serves a TE2 language bundle directory:
- `/api/app/file_editor_cm6/ui/monaco_vscode/lang/...`

Because the VS Code Monaco ESM imports CSS files, the harness serves `.css` as:
- `Content-Type: application/javascript` module shim (injects `<link>` to `?raw=1`)
- raw CSS is available when `?raw=1` is present

### Build procedure (correct)
There are **two** build outputs that must exist, otherwise `/api/app/file_editor_cm6/ui/nc` will not serve the Monaco iframe correctly:

1) **Pinned Monaco ESM** (VS Code fork)
- Output dir: `worktrees/vscode-te2-diff/out-monaco-editor-core/esm/`
- Produced by: `NODE_OPTIONS="--max-old-space-size=4096" npx gulp editor-distro` inside `worktrees/vscode-te2-diff`

2) **TE2 language bundles + language-service workers**
- Output dir: `worktrees/vscode-te2-diff/out-monaco-editor-core/te2-lang/`
- Produced by: `scripts/build_monaco_language_workers.mjs`

Recommended build command (does both):
```
cd worktrees/vscode-te2-diff && ./build_monaco_te2.sh
```
### Common failure mode: `/ui/nc` 404 but worker is “running”
Symptom:
- Browser requests `GET /api/app/file_editor_cm6/ui/nc?...` and gets 404 or falls back to a NiceGUI HTML page.

Cause:
- `register_monaco_editor_routes(...)` did not mount the FastHTML routes because required build artifacts were missing (most commonly `te2-lang/`).

Fix:
- Run the build above, restart the `file_editor_cm6` worker, hard refresh.

---

## 8) UI “knobs” (what you can safely tune)

### Preferences → Monaco options mapping
The iframe builds Monaco options from SSOT preferences (`buildMonacoOptionsFromPrefs()`):
- line numbers
- word wrap
- minimap on/off (but forced off in Git diff mode)
- indent guides
- auto closing brackets
- autocompletion toggles (`quickSuggestions`, `suggestOnTriggerCharacters`, etc.)
- font scale → `fontSize`
- font family (default JetBrains Mono)
- theme (Monaco base: `vs` / `vs-dark`, plus official `monaco-editor-themes` ids)
  - `github-dark-default` (preferred)
  - `github-light-default` (preferred)
  - `github-dark` (legacy alias → `github-dark-default`)
  - `github-light` (legacy alias → `github-light-default`)
  - `atom-dark`
  - `atom-light`
  - `material-dark`
  - `material-light`
  - `darcula`
  - `monokai-pro`
  - `one-dark-pro`
  - TE2-local extras (optional):
    - `te2-dark` (diff colors match `github-dark-default`)
    - `te2-light` (diff colors match `github-light-default`)

Note: TE2 loads Monaco first (`editor.main.js`), then registers official themes from
`/api/app/file_editor_cm6/ui/monaco_editor/themes/*.json`. If Monaco isn't loaded yet,
theme registration is skipped (by design) to avoid caching a no-op run.

### Diff mode behavior
- Git diff mode uses Monaco DiffEditor in inline mode (not side-by-side).
- Draft diff mode is a custom overlay (decorations + view zones).
- Minimap is forced off in diff mode to avoid layout artifacts.

---

## 9) Debugging checklist (what to verify first)

### 1) Transport is correct (no reconnect loops)
- Confirm editor proxy: `app/apps/file_editor_cm6/services/editor_transport.py`
- Confirm explorer proxy: `app/apps/file_editor_cm6/services/explorer_transport.py`
- Confirm worker SUBAPPS mount:
  ```python
  SUBAPPS = [
      ("/editor_ws/socket.io", EDITOR_ASGI_APP),
      ("/explorer_ws/socket.io", EXPLORER_ASGI_APP),
  ]
  ```
- Editor Socket.IO: namespace `/editor`, path `/editor_ws/socket.io`
- Explorer Socket.IO: namespace `/explorer`, path `/explorer_ws/socket.io`

### 2) Iframe loads (no `/ui/nc` 404)
- The Monaco iframe entrypoint is `/api/app/file_editor_cm6/ui/nc?app_id=file_editor_cm6`.
- If you see a `404` on that URL, it means the worker failed to register the Monaco FastHTML routes.
  - Check the worker stderr logs for `[MonacoEditor] Failed to register routes`.
  - The worker now returns a `503` HTML error (instead of silent 404) when registration fails.
- A common cause is a Python exception inside `app/apps/file_editor_cm6/monaco_editor/m_editor_app.py` during route registration (e.g. bad route string formatting).

### 2) SSOT is present
- `GET /api/app/file_editor_cm6/state` returns:
  - `activeProject`, `preferences`, `lastFile`, etc.

### 3) Open path convergence
- `editor_open_request` should lead to `editor:open` for all connected clients.

### 4) Draft persistence and live indicators
- `editor_mirror` should produce a cached draft entry (project sidecar).
- `editor_save_request` should clear the draft and write disk.
- On save, the server broadcasts `editor:cache_state` with `unsaved:false`; the iframe must then refresh git baselines so the inline git diff view updates.
- On edit, `on_editor_mirror` emits `editor:cache_state` with `unsaved:true` (updates toolbar badge live).
- On edit, `notify_draft_state_changed()` broadcasts `explorer:updateDecorations` + `review:setEntries` (updates explorer hasDraft icons and review list live).
- On review save/discard, `_notify_editor_draft_cleared()` emits `editor:cache_state` via editor SIO (clears toolbar badge).

### 5) Cross-process consistency
- If drafts appear empty in the review panel, verify `sidecar.reload()` is called before reads.
- If explorer shows stale hasDraft icons, verify `DraftIndexSidecar` is being updated by `upsert_cached_document`.
- Both editor and explorer Socket.IO must run in the same worker process (not main process). Check `SUBAPPS` mount.

---

## 10) Transitional state (what is still “legacy”)

As of now:
- The Monaco editor surface is **not** NiceGUI.
- However, several `/editor/*` HTTP endpoints still live in `nicegui_editor/editor_app.py` and are still used by the host/iframe (e.g. `editor/check_cache`, `editor/update_preference`).

The long‑term direction is to migrate needed editor endpoints into a dedicated non‑NiceGUI API module, but the current system is intentionally functional during the transition.

---

## 11) Monaco language bundles + workers (recent learnings)

### Invariants (must hold)
- Syntax highlighting must work (non-plaintext languages set correctly).
- Syntax checking + autocomplete must work (Monaco language services).

### Symptoms we hit
- `monaco.languages.getLanguages()` returned only `['plaintext']`.
- `model.getLanguageId()` stayed `plaintext` even for `.py`/`.js`.
- Console showed:
  - `Failed to load language bundles`
  - `Import Map ... monaco-editor-core ... blocked by a null value`
  - 404 for `/api/app/file_editor_cm6/ui/monaco_vscode/lang/basic-languages/monaco.contribution.js`

### Root cause
Language bundles were bundling a **second** Monaco instance, so contributions attached to a different registry.

### Fix (what actually works)
1) **Language bundles must keep `monaco-editor-core` external**
   - `scripts/build_monaco_language_workers.mjs`
   - Add: `external: ['monaco-editor-core']` for the **contrib build**
   - Do **not** resolve `monaco-editor-core` to `editor.api.js` in the contrib build plugin.

2) **Import map must point to the worker-served Monaco API**
   - `app/apps/file_editor_cm6/monaco_editor/m_editor_app.py`
   - Use an absolute path:
     - `"monaco-editor-core": "/api/app/file_editor_cm6/ui/monaco_vscode/esm/vs/editor/editor.api.js"`

3) **Force-load language bundles and re-apply model language**
   - `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js`
   - Import language bundles from `/ui/monaco_vscode/lang/...`
   - On failure, retry with cache-bust query
   - After `ensureEditorWithPrefs()`, call:
     - `monaco.editor.setModelLanguage(model, languageFromPath(currentPath))`

### Build command (language bundles + workers)
```
/data/data/com.termux/files/usr/opt/nodejs-22/bin/node scripts/build_monaco_language_workers.mjs
```

### Validation (after worker restart + hard refresh)
```
monaco.languages.getLanguages().map(l => l.id)
monaco.editor.getModels()[0].getLanguageId()
```
Expected: language list includes python/js/etc, model language matches file extension.

If still `plaintext`, check:
- 404s under `/api/app/file_editor_cm6/ui/monaco_vscode/lang/...`
- `[Monaco] Failed to load language bundles` warnings

### Why this avoids regressions
Keeping `monaco-editor-core` external guarantees all contributions attach to the **same** Monaco registry used by the main editor ESM import. This prevents the “works once, then breaks” behavior caused by duplicate registries.

---

## 12) Draft deletion widgets ordering (Git diff + Draft diff together)

### The “3-row” mental model (recommended)
When both Git diff and Draft diff are enabled, the intended visual model is:
- Git baseline row (HEAD)
- Current disk/SSOT row
- Draft-applied row (what you’ll save)

### Ordering invariant (important)
In unified inline Git diff mode, Git deletions are rendered using Monaco **view zones**.
Our draft deletion widgets are also view zones.

To keep the UI readable:
- Draft deletion zones must render **below** Git deletion zones.

### Implementation note
We re-append the draft zones after Git diff updates by:
- installing a `onDidChangeViewZones` hook on the DiffEditor’s **modified** editor
- re-applying the last computed draft zones after Git diff inserts/removes its own view zones

Primary implementation lives in:
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js`
  - `_installDraftZoneOrderingHook()`
  - `applyDraftZones(...)`
  - `reapplyDraftZones()`

---

## 13) Resolved: Git diff + drafts assertion / thrash

When Git diff mode is enabled and the user types at EOF, the diff-projection engine previously
hit an assertion in `lineRangeMappingFromRangeMappings` (trailing-line invariant). This caused
visual thrash (green insertion flash, editor re-render on every keystroke) unless the last line
happened to have a deletion widget.

### Root cause

Stock Monaco had `applyModifiedEdits` and `applyOriginalEdits` **stubbed out** (`return undefined; // TODO@hediet`).
The TE2 pinned-baseline branch un-stubbed them for draft-diff projection but did not re-stub them
for autosave mode. The un-stubbed projection produced bad mappings at EOF boundaries where the
trailing-line invariant (`originalTrailing === modifiedTrailing`) fails.

`assertFn` in Monaco calls `onUnexpectedError` which is **non-throwing** (fires via `setTimeout`),
so try/catch at the call site cannot intercept it.

### Fix: Projection gating (`diffEditorViewModel.ts`)

All 3 projection zones are now gated with `!model.te2AutosaveMode`:

| Zone | Location | Gate |
|------|----------|------|
| 1 | `modified.onDidChangeContent` (~line 239) | `if (diff && !model.te2AutosaveMode)` |
| 2 | `original.onDidChangeContent` (~line 271) | `if (diff && !model.te2AutosaveMode)` |
| 3 | post-`computeDiff` autorun (~line 367) | `else if (!model.te2AutosaveMode)` |

When `te2AutosaveMode = true`: projection skipped entirely (stock behavior), debouncer does clean
full `computeDiff` — no thrash, no assertion.

When `te2AutosaveMode = false`: projection runs for pinned-baseline draft-diff tracking.

### Fix: EOF trailing-line invariant (`rangeMapping.ts`)

Instead of `assertFn` (non-throwing, crashes error handler), the last mapping is **extended to
absorb the EOF boundary** — simulating what a deletion widget naturally provides:

```typescript
const origTrailing = originalLines.length.lineCount - lastChange.original.endLineNumberExclusive;
const modTrailing = modifiedLines.length.lineCount - lastChange.modified.endLineNumberExclusive;
if (origTrailing !== modTrailing) {
    const maxTrailing = Math.max(origTrailing, modTrailing);
    changes[changes.length - 1] = new DetailedLineRangeMapping(
        new LineRange(lastChange.original.startLineNumber,
                      lastChange.original.endLineNumberExclusive + maxTrailing),
        new LineRange(lastChange.modified.startLineNumber,
                      lastChange.modified.endLineNumberExclusive + maxTrailing),
        lastChange.innerChanges,
    );
}
```

### Fix: Mode switch baseline snapshot (`m_editor_app.js`)

When toggling autosave OFF → draft mode, the baseline is now a **snapshot of the current editor
content** (not `gitDiskModel`, which after autosave equals the editor = empty diff):

```javascript
var baselineContent = model.getValue();
diffModel.modifiedBaseline = monaco.editor.createModel(baselineContent, lang);
```

Applied in both `applyGitBaselines` (~line 2716) and `prefs_changed` handler (~line 4071).

### Fix: Mirror client autosave suppression (`main.js`)

Mirror clients no longer trigger autosave for mirrored content. `markUnsaved(flag, opts)` accepts
`{ skipAutosave: true }`, passed when `reason === 'mirror'` in `_applyCacheIndicatorImpl`.

### Debugger note
If your browser keeps pausing on this, DevTools likely has "Pause on exceptions" enabled; disable it while iterating so the UI remains usable.

---

## 14) Planned removal: `vscode_rpc` and `vscode_api` standalone harnesses

### Background
Early in development, two standalone Node.js JSON-RPC harnesses were created as separate framework shells:
- **`vscode_rpc`**: a minimal WS JSON-RPC server intended to provide semantic tokens, themes, and grammars.
- **`vscode_api`**: a larger harness intended to manage VSIX install/registry, TextMate grammars, themes, and eventually language features.

These were designed before the **workbench adapter** (stdio pipe transport) was fully operational. Now that the adapter provides direct access to the real VS Code extension host (diagnostics, hover, symbols, didChange — all working), the standalone harnesses are redundant for language features.

### What the adapter already covers
The workbench adapter (`workbench_client.mjs` + `server.mjs`) talks to the real code-server extension host and provides:
- All language intelligence (diagnostics, hover, symbols, didChange) via stdio pipe
- All built-in extension activation (~30 language extensions)
- Provider registration and handle tracking
- Document model synchronization

### What `vscode_api` still provides (to be migrated)
The `vscode_api` harness currently handles a few things the adapter does not:
- **VSIX install/registry**: `vscode.vsix.*` methods (install, list, enable/disable per-project)
- **TextMate grammars**: `vscode.textmate.grammars.list` / `vscode.textmate.grammars.load`
- **Theme loading**: `vscode.themes.list` / `vscode.themes.load`
- **Language configuration**: `vscode.languages.list` (returns `configuration_raw` for bracket matching, comments, etc.)
- **Bootstrap snapshot**: `vscode.bootstrap.snapshot` (cached grammar/theme/language index)

These are all **static asset queries** (reading installed extension files) — they don't need a running extension host. They should be migrated to either:
1. The workbench adapter (if they benefit from extension host context), or
2. A simple Python-side utility that reads the VSIX install pool directly (preferred for static assets)

### Files to remove (`vscode_rpc`)
| File | Purpose |
|------|---------|
| `services/vscode_rpc_transport.py` | Main-process WS proxy |
| `vscode_rpc_shell_manager.py` | Shell lifecycle manager |
| `shellspec/vscode_rpc.yaml` | Framework shell definition |
| `main.py` (references) | Discovery/start endpoints |
| `manifest.json` (references) | Service registration |

### Files to remove (`vscode_api`, after migration)
| File | Purpose |
|------|---------|
| `services/vscode_api_transport.py` | Main-process WS proxy |
| `vscode_api_shell_manager.py` | Shell lifecycle manager |
| `shellspec/vscode_api.yaml` | Framework shell definition |
| `main.py` (references) | Discovery/resolve endpoints |
| `main.js` (references) | Frontend bootstrap/snapshot calls |
| `m_editor_app.js` (references) | Grammar/theme loading calls |
| `m_editor_app.py` (references) | Bootstrap snapshot route |

### Migration strategy (workbench adapter first)
The workbench adapter already scans all extensions at startup (`_buildExtensionsSnapshot()`), so it has the full `contributes.grammars`, `contributes.themes`, and `contributes.languages` metadata in memory. The preferred migration path is to add new JSON-RPC methods to the adapter rather than building separate Python utilities.

**Phase 1: Grammar/theme/language queries via adapter** (preferred path)
Add these methods to `server.mjs` `handleJsonRpc()`:

| Method | What it does | Data source |
|--------|-------------|-------------|
| `vscode.grammars.list` | List all contributed grammars (scopeName, language, path) | Scanned extensions `contributes.grammars` |
| `vscode.grammars.load` | Load raw `.tmLanguage.json` content by scopeName or path | `fs.readFile` on extension content path |
| `vscode.themes.list` | List all contributed themes (label, uiTheme, path) | Scanned extensions `contributes.themes` |
| `vscode.themes.load` | Load raw theme JSON by path or label | `fs.readFile` on extension content path |
| `vscode.languages.list` | List language contributions + configuration | Scanned extensions `contributes.languages` |
| `vscode.languages.config` | Load raw language configuration JSONC | `fs.readFile` on extension content path |

These reuse the existing stdio pipe transport (browser → Socket.IO → `editor_ws.py` → adapter stdin → response). No new transport or framework shell needed.

Python-side: add corresponding `editor_ws.py` handlers (same pattern as `on_editor_workbench_hover`).
Frontend: update `m_editor_app.js` to call these via editor Socket.IO instead of the `vscode_api` WS harness.

**Phase 2: VSIX management via Python**
VSIX install/registry is pure file management (download, extract, update `extensions.json`). This doesn't need the adapter or an extension host. A Python utility reading `~/.local/share/termux-extensions-2/code-te2-extensions/` directly is sufficient.

**Phase 3: Bootstrap snapshot consolidation**
Replace the `vscode.bootstrap.snapshot` call (currently via `vscode_api` harness) with a single adapter call that returns grammars + themes + languages in one response, or combine the Phase 1 calls at the Python layer.

### Priority
- `vscode_rpc`: can be removed immediately (nothing depends on it in production).
- `vscode_api`: remove after Phase 1 migrates grammar/theme/language queries to the workbench adapter. The frontend currently calls these on boot for TextMate tokenization and theme loading.

---

## 15) Legacy: `vscode_api` harness (extension host + VSIX pipeline, pending removal)

`vscode_api` is the next step after `vscode_rpc`.

Goal:
- Provide a **single** WS JSON-RPC connection that becomes the long-lived “VS Code API harness”.
- This is the place where TE2 will eventually support:
  - VSIX install/registry
  - TextMate grammars + themes from installed extensions
  - Extension host services (vscode.* APIs) where needed
  - Language feature providers (semantic tokens, diagnostics, completions, etc.)

Important invariant:
- TE2 main process is **proxy-only**; all SSOT interaction remains in the worker.

### Current scaffolding (v0)
- Worker discovery: `GET /api/app/file_editor_cm6/vscode_api/discover`
  - starts/adopts a framework shell
  - returns `ws_url` like `/vscode_api_ws?shell_id=<shell_id>`
  - returns `instance_id` (currently always `"primary"`)
- Host WS shim (service): `WS /vscode_api_ws?shell_id=<shell_id>`
  - proxy-only, forwards frames verbatim to the shell’s WS
- Shellspec: `app/apps/file_editor_cm6/shellspec/vscode_api.yaml#vscode-api`
- Server entrypoint: `worktrees/vscode-te2-diff/te2/vscode_api_server.mjs`
  - currently supports:
    - `rpc.ping`
    - `vscode_api.version`
    - `vscode_api.capabilities`
    - `vscode.vsix.*` (registry + per-project enable/disable)
    - `vscode.themes.*` (list/load raw theme json)
    - `vscode.textmate.*` (list/load raw grammars)
    - `vscode.languages.list` (enabled extensions only; includes `configuration_raw`)

Storage:
- Global VSIX install pool: `~/.local/share/termux-extensions-2/code-te2-extensions/`
- Per-project enablement SSOT: `ProjectSidecar.vscode_api.enabled_extensions`

Resolve by path (future multi-instance hook):
- `GET /api/app/file_editor_cm6/vscode_api/resolve?path=<abs>`
  - Today: only resolves if `path` is under the active project root.
  - Future: selects the best running instance by workspace-folder match (code-server session registry pattern).

Themes (global SSOT):
- Theme selection is stored in `_preference_store` using the existing `theme` preference key.
- Built-in themes use simple ids like `te2-dark`, `te2-light`, `github-dark-default`, etc.
- VSIX-provided themes use: `vscode:<extensionId>:<relPath>`
  - Example: `vscode:GitHub.github-vscode-theme:extension/themes/dark-default.json`
- The Monaco iframe converts VS Code theme `tokenColors` into Monaco theme rules and applies it after loading via `vscode_api` (`vscode.themes.load`).

TextMate apply (grammars from VSIX):
- Monaco iframe uses `vscode-oniguruma` + `vscode-textmate` (UMD globals) to tokenize lines using TextMate grammars.
- Grammar resolution prefers `vscode_api` (`vscode.textmate.grammars.list` + `vscode.textmate.grammars.load`) and falls back to legacy static assets under `monaco_editor/textmate/` when present.
- Boot-time prefetch:
  - `vscode.bootstrap.snapshot` (cached on `window.__te2VscodeBootstrap`)
    - includes `languages` (enabled extensions only), plus `themes` and `grammars`
  - `_refreshVscodeGrammarIndex()` (cached for scopeName/language mapping)
- Scope selection:
  - Uses VSIX grammar `language` field when available to map to Monaco `languageId`.
  - Supports extension-sensitive scopes for `.jsx`/`.tsx` when present.
  - Falls back to the previous hard-coded scope map when no VSIX grammar matches.

VSIX language configuration (per-project):
- `vscode.languages.list` returns `contributes.languages` (only for enabled extensions) plus `configuration_raw` (jsonc).
- Monaco iframe calls `monaco.languages.setLanguageConfiguration(languageId, cfg)` so bracket auto-closing, comments, etc. follow VSIX language configs.

Next step:
- Replace the placeholder server implementation with a real extension-host-backed JSON-RPC surface and keep *all* future VSIX-related integration behind this API.

Language providers (working):
- **Stdio LSP bridge has been removed** (2026-02-07). It caused marker owner collisions with the workbench adapter path.
- Diagnostics now flow exclusively through the **server-side diagnostics bridge** (`diagnostics_bridge.py`):
  - Subscribes to adapter WS (`127.0.0.1:18181/ws`) for `diagnostics/update` events
  - Caches per-path (max 100 entries) and broadcasts via editor Socket.IO (`editor:diagnostics`)
  - On client connect (`on_connect`): sends cached diagnostics + nudges adapter for fresh ones
  - On file switch (`on_editor_open_request`): sends cached diagnostics for the new file + nudges adapter
  - Nudge mechanism: POST `vscode.openFile` to adapter `/cmd` to force extension host re-emit
  - Monaco iframe handler converts bridge payload to `_applyDiagnosticsUpdate()` format
- **All built-in language extensions** are loaded (filtered to language-only subset, ~30 of 95 scanned).
- Diagnostics work for Python, TypeScript, JavaScript, CSS, HTML, JSON, and all other languages with built-in VS Code support.
- RPC features (hover, symbols, openFile, didChange) flow through editor Socket.IO → `editor_ws.py` → adapter stdio pipe

Socket.IO relay handlers (`editor_ws.py`):
- `on_editor_issues_cmd` → `editor:issues_cmd` — relays marker navigation commands (next/prev) to iframe
- `on_editor_find_cmd` → `editor:find_cmd` — relays find/replace commands to iframe

Diagnostics debug overlay + logs (current):
- Debug overlay text (lower-left): `ext=yes/no og=yes/no diag=rx/ap/np/nm/mm` plus optional `touch=reinit:*`.
  - `ext`: `monaco-touch-selection` helper detected.
  - `og`: `.overflow-guard` element present in current editor DOM.
  - `diag=rx/ap/np/nm/mm` counters:
    - `rx`: diagnostics events received by Monaco iframe.
    - `ap`: `setModelMarkers` calls performed (includes cache reapply and empty arrays).
    - `np`: dropped because path could not be derived from URI.
    - `nm`: dropped because no model available.
    - `mm`: dropped because item path != active model path.
  - Counters are cumulative for the iframe lifetime (not per file).
  - `touch=reinit:*` appears when touch-selection UI re-installs after editor DOM rebuild.
- Frontend console logs (Monaco iframe):
  - `[editor:diagnostics] rx diagnostics/update path=... markers=N currentPath=...`
  - `[vscode_api] setModelMarkers count=... sevs=[...] lines=[...]`
  - `[vscode_api] verify getModelMarkers count=...`
- Adapter-side console logs (Node workbench adapter):
  - `[wb_client] $changeMany owner=... pairs=... markerCounts=[...]`
  - `[server] diagnostics/changeMany -> norm=owner=... items=... markerCounts=[...]`


Legacy LSP config (`lsp_servers.json`) is no longer used. The following section is preserved for reference only:

LSP server mapping (legacy — removed):
- The bridge was driven by a json mapping file:
  - default path: `~/.local/share/termux-extensions-2/code-te2-extensions/lsp_servers.json`
  - override: `TE2_LSP_CONFIG_PATH=/abs/path/to/lsp_servers.json`
- Format:
  - `servers.<languageId>.cmd` is an argv array (first item is executable).
  - Optional: `servers.<languageId>.key` lets multiple languageIds share one spawned server.
  - Optional: `servers.<languageId>.env` and `servers.<languageId>.initializationOptions`.
  - Template vars inside `cmd` strings:
    - `${project_root}` → active project root
    - `${ext:<publisher.name>}` → VSIX install content root for that extension (e.g. `${ext:ms-python.python}`)
- Minimal built-ins:
  - JS/TS uses vendored `app/static/vendor/lsp_servers/node_modules/.bin/typescript-language-server --stdio`
  - Python uses `pyright-langserver --stdio` **only if present on PATH**

Example `lsp_servers.json`:
```json
{
  "version": 1,
  "servers": {
    "typescript": { "key": "ts", "cmd": ["typescript-language-server", "--stdio"] },
    "javascript": { "key": "ts", "cmd": ["typescript-language-server", "--stdio"] },
    "python": { "key": "pyright", "cmd": ["pyright-langserver", "--stdio"] }
  }
}
```

Example (use a VSIX-bundled language server binary):
```json
{
  "version": 1,
  "servers": {
    "python": {
      "key": "pyright",
      "cmd": ["${ext:ms-python.python}/node_modules/.bin/pyright-langserver", "--stdio"]
    }
  }
}
```

---

## 16) Multi-client fanout + future multi-instance (code-server pattern)

### Goal (TE2 direction)
Maintain **multiple clients → single backend instance** fanout as the default:
- Many browser clients (desktop/mobile, multiple tabs, GeckoView, etc.) can attach to the same active project editor.
- The backend is the authority for “workspace-ish” runtime state (enabled extensions, indexing, language services, etc.).
- SSOT remains worker-owned (`_history_store`/ProjectSidecar + `_preferences_store`).

Keep the option open to support **multiple editor instances** later (e.g. two projects, or two “workspaces” under one project) without redesign.

### Why this is the right default
- TE2 already uses a SSOT model and atomic persistence (drafts + writes).
- Multi-client fanout is easier to reason about than multi-instance from day 1:
  - one set of indexes
  - one extension host
  - one language-service hub
  - one source of truth for “what is enabled”

### The minimal invariant to keep multi-instance possible later
Make instance identity explicit **now**, even if we only run one instance:

- `project_root`: absolute path for the active project
- `instance_id`: stable string for a backend instance (default: `"primary"`)
- `client_id`: stable per-browser/tab id (already exists in other TE2 transports)

Every client→server request should carry at least `{project_root, instance_id, client_id}` so later we can add parallel instances without changing payload formats.

### Discovery & routing contract (recommended)
Two related but distinct problems:

1) **Discover**: “Start or adopt an instance for the *current* active project.”
   - This is what `GET /api/app/file_editor_cm6/vscode_api/discover` does today (returns `ws_url` with a `shell_id`).

2) **Resolve**: “Given a file path, which running instance should handle it?”
   - This is the missing piece that enables “open file from outside,” multi-tab/multi-instance, and clean attach behavior.

Recommended resolve endpoint (worker-owned API, host proxy-only):
- `GET /api/app/file_editor_cm6/vscode_api/resolve?path=<abs>`
  - returns `{ws_url, token, project_root, instance_id, shell_id}`

### Reference pattern (code-server)
The code-server project solved the “which instance should handle this file?” problem by maintaining a session registry:

- Patch: `../mrselect6-2/code-server/patches/store-socket.diff`
  - The extension host registers its IPC socket + workspace folders into a local session manager server.
- Implementation: `../mrselect6-2/code-server/src/node/vscodeSocket.ts`
  - Keeps a Map of active sessions.
  - Selects the best session by:
    - “workspace folder prefix match” against the file path
    - “can connect” probing to prune dead sockets

The TE2 analogue is:
- A registry of active `vscode_api` shells keyed by `{project_root, instance_id}` (and optionally workspace folders).
- A resolve routine that selects the right backend for a given absolute path.

### Storage / collision notes (important for multi-client)
If multiple workspaces can be served under the same origin, avoid browser-storage collisions:
- Reference: `../mrselect6-2/code-server/patches/unique-db.diff`
  - Hashes by `location.pathname` to prevent IndexedDB collisions between `/workspace1` and `/workspace2`.

TE2 should apply the same principle anywhere we persist client-side state:
- per-app localStorage keys
- IndexedDB keys (if used)
- caches related to `client_id`

### What stays where (TE2 boundary rule)
- **Main framework**: proxy-only (services provide WS shims, no SSOT writes).
- **App worker**: SSOT owner (preferences/history/project sidecar).
- **vscode_api shell**: heavy work (VSIX, TextMate, LSP / language features, indexing).
- **Browser iframe**: thin renderer (Monaco UI + provider shims that call backend).

### Immediate follow-ups (ties to your priorities)
1) **TextMate/grammars/tokens/styling**
   - Move grammar/theme indexing fully into `vscode_api` (already started).
   - Keep TextMate as baseline tokenization; semantic detail comes from language features.
2) **Language servers**
   - Provide document symbols, diagnostics, semantic tokens over the same WS JSON-RPC surface.
3) **Extension UI iframes**
   - Defer; this becomes “webviews” and CSP/origin problems (see code-server `patches/webview.diff`).

---

## 17) Workbench protocol proxy plan (code-server “black box”)

Goal: **avoid rebuilding** VS Code / code-server workbench JS while still extracting language “gold” (diagnostics, hover, completion, symbols) into TE2.

Approach:
- Run stock code-server as-is.
- Put a small **WS mirror+decode proxy** in front of it (transparent relay).
- Decode the workbench protocol frames (Mgmt + ExtHost) and publish a **TE2-friendly side channel**.

### Important non-goal
- **Do not** treat any “trace replay” as a production protocol. Traces/HARs are for discovery + debugging only.

### Key reference
- `../mrselect6-2/vscode-protocol/README.md`
  - Documents the **wire framing protocol** (Regular/Ack/KeepAlive/etc) and the **two WS connections**:
    - renderer-Management (channel protocol)
    - renderer-ExtensionHost (RPC protocol)

### Offline decoder (protocol discovery)
Tooling (TE2):
- `scripts/vscode_ws_decode_har.py`
  - Decodes Firefox HAR `_webSocketMessages` and prints:
    - handshake type counts (auth/sign/connectionType/ok)
    - wire frame type counts
    - management channel top methods
    - extension host top methods
  - Recent improvements:
    - tolerates “comment line” prefix before JSON in HAR files
    - decodes ExtHost **mixed-args** frames (RequestMixedArgs / RequestMixedArgsWithCancellation)

Captured HARs (examples):
- `newwsdata1.har`, `newwsdata2-oneclient.har`, `newwsdata3-oneclient-second_stream.har`
- `newestws1.har`, `newestws2.har`

### Live decoder proxy (Go, current)
For live interception + decoding (browser or headless client → proxy → code-server):
- Upstream proxy/decoder: `../mrselect6-2/vscode-protocol/proxy.go`
  - Can emit TE2-friendly JSON events (`-te2-json`) and optionally write a capped JSONL trace (`-trace-out ... -trace-max-bytes ...`).
- Example trace file (repo-local): `tmp/go_te2_decoder_trace.jsonl`

Use this as:
- a transparent relay
- a deterministic “ground truth” logger/decoder for what the real workbench does

Do not use it as:
- a “replay engine” that pretends to be the workbench

### What we know works from HARs (important findings)

#### Two websockets per session (invariant)
Each captured HAR contains **2 WS URLs** (same base path, different reconnection tokens):
- one Management stream
- one ExtensionHost stream

#### Language features seen on ExtensionHost stream
These are already present in the traces (so proxy extraction is feasible):
- `$provideHover`
- `$provideCompletionItems`
- `$provideDocumentSymbols`
- `$provideCodeActions`

#### Diagnostics payload shape (confirmed)
Diagnostics are pushed via ExtensionHost method:
- **`$changeMany`**

Decoded example (normalized):
```json
[
  "python",
  [
    [
      {"scheme":"vscode-remote","authority":"localhost:8080","path":"/.../agent_bridge.py"},
      [
        {
          "startLineNumber":12,"startColumn":11,"endLineNumber":12,"endColumn":16,
          "message":"SyntaxError: invalid syntax (agent_bridge.py, line 12)",
          "source":"compile","severity":8,
          "modelVersionId":1
        }
      ]
    ]
  ]
]
```

Interpretation:
- arg0: marker owner / source id (here: `"python"`)
- arg1: list of `[resourceUri, markers[]]`

This is the payload we want to convert into TE2 diagnostics to render in Monaco.

#### Hover request/response (confirmed)
Hover is served via ExtensionHost method:
- **`$provideHover`**

Observed request shape (from `maximal-hover-scrape.hal` via `scripts/vscode_ws_decode_har.py --extract-te2 --extract-method '$provideHover'`):
```json
{
  "type": "ext/request",
  "method": "$provideHover",
  "args": [
    25,
    {"scheme":"vscode-remote","authority":"localhost:8080","path":"/.../agent_bridge.py"},
    {"lineNumber": 25, "column": 16},
    {}
  ]
}
```

Observed reply shapes:
- `ReplyOKEmpty` when nothing applies
- `ReplyOKJSON` with a payload like:
```json
{
  "range": {"startLineNumber":25,"startColumn":8,"endLineNumber":25,"endColumn":18},
  "contents": [{"value": "```python\\n...```\\n---\\n```text\\n...```", "isTrusted": false}],
  "id": 0
}
```

Important: the first argument (`25` in the example) is a **provider handle/id** chosen by the workbench session.
It is **not stable across sessions** unless we derive it by observing provider registrations (e.g. `$registerHoverProvider`)
or by piggybacking on real workbench requests.

### Proxy POC (do this first)
**POC v0** (“observe-only”):
- proxy WS frames untouched (browser ↔ proxy ↔ code-server)
- decode ExtHost frames and stream TE2 events:
  - `diagnostics/changed` (from `$changeMany`)
  - `hover/response`, `completion/response`, `symbols/response` (observe-only for now)

**POC v1** (“inject one request”):
- pick a single predetermined opened file in code-server session
- inject exactly one request and wait for response:
  - hover request → hover response

Notes:
- For injection, the document must already exist in code-server’s model.
- Later we can drive open/close via Management channel (workbench actions) or by reproducing doc/editor delta traffic, but that is out of scope for v0/v1.

### Headless workbench adapter (Node, stdio pipe transport)
The adapter is a headless workbench client that replaces browser-based bootstrapping:
- Server: `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
  - Exposes **stdio JSON-RPC** (production transport): Python writes JSON-RPC to stdin, reads `<<<RPC>>>` prefixed responses from stdout.
  - Also exposes HTTP JSON-RPC on port 18181 (vestigial, will be removed).
  - `console.log` is redirected to `console.error` so adapter logs go to stderr (visible in framework shells UI) while stdout is reserved for the pipe protocol.
- Client core: `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`
  - Uses VS Code OSS remote agent connection/runtime code (`remoteAgentConnection`, `browserSocketFactory`, IPC runtime) to connect in **remote mode**
  - Sends the ExtensionHost init JSON over the ExtHost websocket
  - Sends the minimal editor/document delta events required to open a file (`$acceptDocumentsAndEditorsDelta`, tab model, editor properties, dirty state)
  - Learns provider handles by observing `$register*Provider` frames (when present)
  - Universal provider lookup: `_findProviderHandle(type, languageId)` searches registered providers by language

Python-side integration:
- `workbench_adapter_shell_manager.py`:
  - `adapter_rpc(method, params, timeout)` — sends JSON-RPC over stdin, awaits `<<<RPC>>>` response from stdout reader
  - `_stdout_reader_loop()` — reads adapter stdout in 1MB chunks (no line length limit), routes `<<<RPC>>>` lines to pending futures, logs the rest
  - `ensure_workbench_adapter_shell()` — spawns adapter (pipe backend, `wait_ready=False`), does stdio ping readiness loop, then calls `adapter.connect` bootstrap with code-server URL
- `editor_ws.py` handlers:
  - `on_editor_workbench_open_file` → `adapter_rpc("vscode.openFile", ...)`
  - `on_editor_workbench_hover` → `adapter_rpc("vscode.hover", ...)`
  - `on_editor_workbench_symbols` → `adapter_rpc("vscode.documentSymbols", ...)`
  - `on_editor_workbench_did_change` → `adapter_rpc("vscode.didChange", ...)` (fire-and-forget)
- `diagnostics_bridge.py`:
  - `nudge_diagnostics_for_file()` → `adapter_rpc("vscode.openFile", ...)` (replaced old httpx POST)

Current status (facts observed in adapter runs):
- Adapter can establish remote-mode mgmt+ext connections and keep them alive.
- `vscode.openFile`, `vscode.documentSymbols`, `vscode.hover`, and `vscode.didChange` are wired end-to-end through the stdio pipe.
- **All built-in language extensions** are loaded and activated (TypeScript, JavaScript, Python, CSS, HTML, JSON, etc.)
- Python provider flow is validated with `ms-pyright.pyright` in the current dev setup.
- TS/JS provider flow validated via built-in `typescript-language-features` — diagnostics, hover, symbols all working.
- C++ (clangd): validated — diagnostics on open and **live diagnostics on edit** working after endColumn fix.
- Keepalive/ack handling is stable enough for iterative feature validation.

Per-document tracking maps (in `workbench_client.mjs`):
- `_docVersions`: path → versionId (monotonically increasing, reset to 1 on openFile)
- `_docLineCount`: path → number of lines
- `_docCharCount`: path → total character count (for `rangeLength`)
- `_docLastLineLength`: path → character length of the last line (for valid `endColumn`)

### Extension host protocol findings (important for future work)

#### Builtin extension loading
- code-server scans ~95 builtin extensions. Including all of them causes the ext host to hang.
- **Root cause**: non-language extensions (git-base, emmet, npm, etc.) activate on `"*"` event and try filesystem operations (`$ensureActivation("file")`) that the headless adapter cannot serve. This blocks the serial activation queue.
- **Solution**: `_buildExtensionsSnapshot()` applies a language-only filter that keeps:
  - All user-installed extensions (always)
  - `*-language-features` extensions (typescript-language-features, css-language-features, etc.)
  - Grammar/language extensions (vscode.python, vscode.javascript, etc.) without `"*"` activation
  - Theme extensions
  - `vscode.configuration-editing` (JSON schema completions)
- This reduces ~95 → ~30 extensions and allows full activation in under 2 seconds.
- Controlled via env: `TE2_INCLUDE_BUILTIN_EXTS=0` reverts to user-extensions-only mode.

#### Extension host RPC reply requirements
Not all ext host requests can be answered with `ReplyOkEmpty`. Key methods that need typed replies:
- `$initializeExtensionStorage` → `ReplyOkJson("{}")` (JSON string — ext host calls `JSON.parse()` on the deserialized result, then `safeParseValue` calls `JSON.parse("{}")` → `{}`)
- `$getTools` → `ReplyOkJson([])` (empty tools array)
- `$getInitialState` → `ReplyOkJson({ isFocused: true, isActive: true })`
- `$checkExists` → `ReplyOkJson(false)`
- `$requestWorkspaceTrust` → `ReplyOkJson(true)` (followed by `$onDidGrantWorkspaceTrust`)
- `$register` (rpcId 29, MainThreadOutputService) → `ReplyOkJson("<channelId>")` (string — clangd blocks waiting for this; returns a synthetic channel ID like `"te2-output-<req>"`)
- `$startFileSearch` → `ReplyOkJson([])`
- `$startTextSearch` → `ReplyOkJson(null)`
- `$executeCommand` → `ReplyOkEmpty`

#### Activation events
- `$activateByEvent("*")` must NOT be sent — it activates problematic non-language extensions.
- `$activateByEvent("onLanguage")` is sent at bootstrap (generic).
- `$activateByEvent("onLanguage:<id>")` is sent per-file at openFile time (e.g. `"onLanguage:python"`).

#### LanguageId detection
- `workbench_client.mjs` includes a `_languageIdFromPath()` helper (40+ file extensions → VS Code language IDs).
- Falls back to path-based detection when `params.languageId` is empty/missing.
- Critical for correct activation: `$activateByEvent("onLanguage:javascript")` vs `"onLanguage:typescript"` determines which extensions activate and what strictness level applies.

### Extension validation milestones (current track)
Goal: verify deterministic language-feature parity (open file -> symbols/hover/diagnostics) across popular ecosystems before broadening scope.

Execution reference:
- `docs/apps/code_cm6/MONACO_WORKBENCH_SPRINT_PLAN.md`
- `docs/apps/code_cm6/README.md` (Roadmap Update section)
- `docs/apps/code_cm6/VSCODE_API_CONTRACT.md`
- `docs/apps/code_cm6/VSCODE_API_STATE_OWNERSHIP.md`
- `docs/apps/code_cm6/VSCODE_API_DEPRECATIONS.md`

1. Python (`ms-pyright.pyright`) - **validated**
   - validated: open file, document symbols, hover, diagnostics
   - pending: sustained diagnostics/completions stability under longer sessions
2. TypeScript/JavaScript (built-in TS service) - **validated**
   - validated: diagnostics for `.ts`, `.js`, `.mjs`, `.jsx`, `.tsx` files
   - JS files receive JavaScript-level strictness (lenient); TS files receive full type checking
   - pending: hover, symbols, completions verification
3. C++ (`llvm-vs-code-extensions.vscode-clangd`) - **validated**
   - validated: diagnostics on open, live diagnostics on edit
   - required fix: `endColumn` must use actual last-line length (clangd rejects INT32_MAX as invalid UTF-16 offset)
   - required fix: `$register` (rpcId 29, OutputService) must return a string channel ID (clangd blocks on this)
   - pending: hover, symbols verification
4. Rust (candidate extension under test) - pending
   - target checks: provider registration, document symbols, hover, diagnostics

Baseline note:
- TypeScript/JavaScript language intelligence is built into the VS Code stack (TypeScript service), so TS/JS acts as a baseline control in this milestone plan rather than an external-extension test case.

Planning boundary:
- `CODE_TE2.md` remains architecture/protocol truth.
- `MONACO_WORKBENCH_SPRINT_PLAN.md` remains the actionable sprint execution plan.

### Minified code reverse engineering workflow (policy)
When we need to learn the “real” sequence from installed/minified code-server JS, use a stream-only workflow:
- Prefer: `prettier <file> 2>/dev/null | nl -ba | rg -n '<pattern>'` for deterministic line numbers
- Then: re-run and extract context with `sed -n '<start>,<end>p'`

See:
- `AGENTS.md` (“Minified Code Search Policy”)
- `CTAG-ANNOTATIONS.md` (tagging prettified functions for later lookup)

### TE2 integration surface (current)
Diagnostics use a **server-side bridge** over the existing editor Socket.IO channel:
- `editor:diagnostics` event: `{ type: "diagnostics/update", path, owner, markers[], ts_ms }`
- Server-side cache in `diagnostics_bridge.py` (per-path, max 100 entries)
- Nudge-on-connect: `adapter_rpc("vscode.openFile", ...)` over stdio pipe to force fresh diagnostics

RPC features use **editor Socket.IO → stdio pipe** (no separate WS):
- `editor_workbench_open_file` → `adapter_rpc("vscode.openFile", { path, languageId, generation })` → `{ ok }`
- `editor_workbench_hover` → `adapter_rpc("vscode.hover", { path, lineNumber, column, languageId })` → `{ hover }`
- `editor_workbench_symbols` → `adapter_rpc("vscode.documentSymbols", { path, languageId, generation })` → `{ symbols[] }`
- `editor_workbench_did_change` → `adapter_rpc("vscode.didChange", { path, text, languageId, generation })` → fire-and-forget (diagnostics arrive via bridge)

Live diagnostics data flow:
- User types in Monaco → 120ms debounce → `editor_workbench_did_change` → `editor_ws.py` → adapter stdin → `$acceptModelChanged` (rpcId 85, full text replace via `isFlush: true`) → extension host re-analyzes → `$changeMany` → diagnostics bridge → browser
- The adapter tracks per-document `versionId` (monotonically increasing, reset to 1 on `openFile`), previous line count, char count, and **last line length** for correct range replacement
- **endColumn tracking**: `_docLastLineLength` map stores the character length of each document's last line. Initialized on `openFile()` from `lines[lines.length - 1].length`, updated on every `didChange()` after splitting the new text. Used as `endColumn: prevLastLineLen + 1` in the change range. Fallback is `10000` for documents opened before tracking was added (safe for clangd, clamped by the mirror model).
- File watchers (Section 19) handle post-save diagnostics automatically — code-server's parcel watcher detects disk changes and feeds `$onFileEvent` to the extension host; TE2 subscribes to the same IPC channel for explorer updates

Document-symbol ordering hardening (validated):
- Monaco now gates workbench flow by `(path, generation)` and requires `open_file` ack before queued `didChange` and symbols flush.
- `editor:ssot`, `editor:open`, baton replay, and `openPathFromBackend` all use the same ordered open flow.
- `editor_ws.py` serializes `open_file`/`didChange`/symbols per path and tracks open baselines.
- Adapter invariants return `document_not_open` / `stale_generation` for out-of-order requests.
- Adapter stdio writes are serialized in `workbench_adapter_shell_manager.py` to avoid request interleaving.

The old `vscode_api_ws` WS path is **bypassed** for all language feature RPC. It remains only for VSIX/grammar/theme management.

The UI (Monaco iframe) remains a thin renderer:
- It subscribes to TE2 events, updates Monaco markers/hover providers, and never runs an extension host itself.
- Hover and symbol providers are registered immediately for the current file's language (no async dependency on VSIX language list).
---

## 18) Planned: Breadcrumb navigation widget (extracted from VS Code)

### Goal
Add a VS Code-style breadcrumb bar above the Monaco iframe showing:
- File path segments (project root → current file)
- Document symbols (outline: classes → methods → current scope based on cursor position)

Clicking path segments navigates the explorer; clicking symbol segments scrolls to that symbol.

### Source reference
The VS Code breadcrumb implementation lives in the code-server submodule:
- **Worktree**: `../mrselect6-2/code-server/lib/vscode/src/vs/`
- **Core widget** (standalone, extractable):
  - `base/browser/ui/breadcrumbs/breadcrumbsWidget.ts` (~366 lines)
  - `base/browser/ui/breadcrumbs/breadcrumbsWidget.css` (37 lines)
- **Workbench integration** (NOT extractable, too entangled):
  - `workbench/browser/parts/editor/breadcrumbsControl.ts` (~878 lines)
  - `workbench/browser/parts/editor/breadcrumbsModel.ts` (~147 lines)
  - `workbench/browser/parts/editor/breadcrumbsPicker.ts` (~438 lines)
  - `workbench/browser/parts/editor/breadcrumbs.ts` (~308 lines)
  - `workbench/browser/parts/editor/media/breadcrumbscontrol.css`

### Feasibility analysis

**The core `BreadcrumbsWidget` is highly extractable.** It's a pure DOM widget with minimal dependencies:
- `vs/base/browser/dom.js` — DOM helpers (createElement, classList, events)
- `vs/base/browser/ui/scrollbar/scrollableElement.js` — Horizontal scrollbar
- `vs/base/common/event.js` — Event emitters (Emitter, Event)
- `vs/base/common/lifecycle.js` — Disposable pattern
- `vs/base/common/themables.js` — ThemeIcon (for separator chevron)

It renders with plain DOM manipulation (no React, no VS Code UI framework). The `BreadcrumbsItem` is abstract — you subclass it and implement `render(container: HTMLElement)` to put whatever you want in each crumb.

**The workbench integration layer is NOT extractable.** `BreadcrumbsControl` depends on 12+ VS Code services (IOutlineService, IEditorService, IWorkspaceContextService, IConfigurationService, etc.). Don't even try.

### Recommended approach: extract widget, build our own data model

**Step 1: Transpile the core widget (~400 lines)**
- Extract `breadcrumbsWidget.ts` + its `vs/base/` dependencies
- Transpile to ES module (esbuild single-file bundle, externalize nothing)
- Dependencies are all from `vs/base/` (utility code, no workbench)
- The `DomScrollableElement` is the biggest transitive dep (~600 lines) but also standalone
- Estimated total bundle: ~2-3KB minified

**Step 2: Build a TE2 `BreadcrumbsItem` subclass**
- `FilePathItem`: renders seti icon + directory/file name per path segment
- `SymbolItem`: renders codicon + symbol name from document outline
- Both use the existing seti icons (`app/static/vendor/seti-icons/`) for file type icons

**Step 3: Wire data from the workbench adapter**
- **File path**: already known from SSOT (`currentPath` + `project_root`). Split into segments. No adapter call needed.
- **Document symbols**: already available via `vscode.documentSymbols` adapter RPC. Returns a symbol tree.
- **Cursor → symbol mapping**: when cursor position changes, walk the symbol tree to find the deepest symbol whose range contains the cursor. This is ~20 lines of JS.

**Step 4: Mount in the editor UI**
- Place between `fe-toolbar` and the Monaco iframe
- Update on: file open (`editor:open`), cursor move (Monaco `onDidChangeCursorPosition`), symbol response
- Click handler: path segments emit `editor_open_request` (for folder nav) or scroll to symbol range

### Icon infrastructure (already available)
- **Seti icons**: `app/static/vendor/seti-icons/` — `getIcon(fileName)` returns SVG + color for 500+ file types
- **Codicons**: available from the Monaco bundle (`vs/base/common/codicons`) for symbol kind icons
- No additional icon assets needed

### What this does NOT need
- No `IOutlineService` — we have `vscode.documentSymbols` via the adapter
- No `IEditorService` — we have SSOT `currentPath`
- No `IWorkspaceContextService` — we have SSOT `project_root`
- No `BreadcrumbsControl` or `BreadcrumbsModel` — we build our own (much simpler)
- No `BreadcrumbsPicker` — optional future addition (dropdown on click)

### Build plan (esbuild from code-server worktree)

**Why esbuild, not manual vendoring:**
The core widget imports ~54 transitive files from `vs/base/` (dom.ts alone is 2633 lines, event.ts is 1812, lifecycle.ts is 888). Manually copying and maintaining those is impractical. Instead, we use esbuild to bundle the widget + all deps into a single tree-shaken ESM file.

**Directory structure:**
```
app/apps/file_editor_cm6/monaco_editor/vscode_build_src/
  ├─ README.md                  # What this is, how to rebuild
  ├─ build.mjs                  # esbuild script
  ├─ breadcrumbs_entry.ts       # Thin entrypoint (re-exports BreadcrumbsWidget)
  └─ out/
      └─ breadcrumbsWidget.js   # Bundled ESM artifact (served to browser)
```

**Build script (`build.mjs`):**
- Uses esbuild with `bundle: true, format: 'esm', platform: 'browser'`
- Resolves imports from `../mrselect6-2/code-server/lib/vscode/src/` (the worktree)
- Tree-shakes unused exports (breadcrumbsWidget.ts only uses ~10 functions from dom.ts's 2633 lines)
- Outputs single file to `out/breadcrumbsWidget.js`
- CSS is embedded (breadcrumbsWidget.css is 37 lines)
- Expected output: ~10-20KB minified (the widget + scrollbar + event/lifecycle/dom utilities)

**Entrypoint (`breadcrumbs_entry.ts`):**
```typescript
export { BreadcrumbsWidget, BreadcrumbsItem, IBreadcrumbsWidgetStyles, IBreadcrumbsItemEvent }
  from 'vs/base/browser/ui/breadcrumbs/breadcrumbsWidget';
export { ScrollbarVisibility } from 'vs/base/common/scrollable';
export { ThemeIcon } from 'vs/base/common/themables';
export { Codicon } from 'vs/base/common/codicons';
```

**Dependency resolution chain:**
```
breadcrumbsWidget.ts (366 lines)
  ├─ dom.ts (2633 lines, but tree-shaken to ~10 used functions)
  ├─ domStylesheets.ts (~50 lines)
  ├─ mouseEvent.ts (~100 lines)
  ├─ ui/scrollbar/scrollableElement.ts + 6 scrollbar files
  ├─ common/event.ts (1812 lines)
  ├─ common/lifecycle.ts (888 lines)
  ├─ common/arrays.ts (949 lines, tree-shaken to commonPrefixLength)
  ├─ common/themables.ts (117 lines)
  └─ common/scrollable.ts (522 lines)
Total transitive: ~54 unique .ts files from vs/base/ (all MIT licensed)
```

### Integration plan (after build)

**Step 1: Build the widget bundle**
- Create `vscode_build_src/` with build script + entrypoint
- Run esbuild → `out/breadcrumbsWidget.js`
- Serve via existing Monaco static route

**Step 2: Create TE2 breadcrumb component (`te2_breadcrumbs.js`)**
- Import `BreadcrumbsWidget`, `BreadcrumbsItem` from the bundle
- Implement `FilePathItem extends BreadcrumbsItem`:
  - `render()`: seti icon + segment name
  - Click → navigate explorer to that directory
- Implement `SymbolItem extends BreadcrumbsItem`:
  - `render()`: codicon + symbol name (class/function/variable)
  - Click → scroll Monaco to symbol range
- Mount widget in a container div between `fe-toolbar` and the iframe

**Step 3: Wire data sources**
- **File path**: listen to `editor:open` → split `currentPath` relative to `project_root` → update crumbs
- **Document symbols**: call `editor_workbench_symbols` on file open (already implemented)
- **Cursor tracking**: listen to Monaco `onDidChangeCursorPosition` → walk symbol tree → update active symbol crumbs
- **Symbol tree walk**: find deepest symbol whose `range.startLineNumber <= cursor.lineNumber <= range.endLineNumber`

**Step 4: Style to match TE2 theme**
- Map `IBreadcrumbsWidgetStyles` colors to TE2 CSS variables
- Separator icon: `Codicon.chevronRight` (already in the bundle)
- Height: ~22px (matches VS Code's breadcrumb bar)

## 19) File watcher pipeline — triple fallback

**Status**: working end-to-end. IPC watcher tested on small repos; ENOSPC recovery and watchexec fallback wired.

### Architecture

Code-server runs VS Code's native parcel watcher (`@parcel/watcher`) internally — it manages inotify watches in a separate child process. The extension host does NOT run its own watcher; code-server feeds it `$onFileEvent` automatically. TE2 does NOT need to send file events to the extension host.

Instead, TE2 subscribes to code-server's `remoteFilesystem` IPC channel (management connection) to **receive** file change events as the workbench client. This is zero-overhead — we piggyback on the watcher code-server already runs.

### IPC protocol

- **Channel**: `"remoteFilesystem"`
- **Subscribe**: `listen("remoteFilesystem", "fileChange", [sessionUUID])` → sends `[102, requestId, "remoteFilesystem", "fileChange"]` (EventListen)
- **Watch**: `call("remoteFilesystem", "watch", [sessionUUID, watchId, uri, {recursive, excludes}])`
- **Events**: arrive as EventFire (ResponseType 204): `header=[204, requestId]`, `body=[{resource: {path, scheme, authority}, type: 0|1|2}]`
- **FileChangeType**: 0=UPDATED, 1=ADDED, 2=DELETED (VS Code enum)
- **ENOSPC errors**: arrive as string body (not array), e.g. `"[File Watcher ('parcel')] Inotify limit reached (ENOSPC) (path: ...)"`
- **URI format**: `{$mid:1, path:"/abs/path", scheme:"vscode-remote", authority:"localhost:18180"}`

### Pipeline

```
code-server parcel watcher detects disk change
  → remoteFilesystem IPC EventFire (ResponseType 204)
  → workbench_client.mjs _setupFileWatcher() onEvent callback
    → event body is array? → emit {type: "watcher/fileChanges", changes: [...]}
    → event body is ENOSPC string? → emit {type: "watcher/enospc", message: "..."}
  → diagnostics_bridge.py WS handler
    → watcher/fileChanges: parse changes, convert abs→rel paths
      → EXPLORER_SIO.emit("explorer:event", {type: "watcher:files", payload: {created, changed, deleted}})
      → external edit detection: if active file in changed/created → handle_external_file_change()
        → re-read disk, compare SHA, clear draft if stale, broadcast editor:open reason="external_change"
    → watcher/enospc: forward as watcher:error (suppressed when mode ≠ ipc)
      → EXPLORER_SIO.emit("explorer:event", {type: "watcher:error", payload: {message}})
  → main.js explorer:event listener → dispatch to explorer.js
    → watcher:files: git:status refresh + directory re-listing for open dirs
      → handle_git_status() calls broadcast_git_status() + broadcast_git_decorations()
      → applyAggregatedGitStatusFlags() propagates decorations to parent directory DOM nodes
    → watcher:error: showWatcherLimitModal() (standalone raise modal)
```

### Triple fallback (4 modes)

Watcher mode is persisted per-project in `ProjectSidecar._data.watcher`:

| Mode | Description | Overhead |
|------|-------------|----------|
| `ipc` (default) | Subscribe to code-server's native parcel watcher via IPC | Zero — piggybacks on existing watcher |
| raise inotify limit | On ENOSPC: modal prompts user to raise `fs.inotify.max_user_watches` via `sysctl`, then resubscribe IPC | One-time sysctl call |
| `watchexec` | `watchexec --poll --emit-events-to json-stdio --shell=none -- cat` in a framework shell | Stat-polling: SSD=1500ms, HDD=4500ms |
| `none` | No background watching; manual refresh button in explorer | Zero |

Mode selection is in the Editor Settings modal (`Editor > Settings… > File Watcher`). The ENOSPC standalone modal appears automatically when the IPC watcher hits the limit. The user can raise the limit or switch to watchexec/none from either modal.

### watchexec framework shell

When watchexec mode is active, a framework shell runs `watchexec --poll <interval> --emit-events-to json-stdio --shell=none -- cat`:

- `--emit-events-to json-stdio` pipes JSON events to the child command's stdin
- `cat` reads stdin → stdout (thinnest possible passthrough)
- Stdout is fanned to both the pipe (for Python reader) and stderr (for observability), same pattern as code-server's shell wrapper
- `--ignore ".git" --ignore ".git/**"` (need both — glob only matches contents, not the dir itself)
- `--shell=none` (not `--no-shell` — removed in watchexec v2.3.3)
- Events are parsed by `watchexec_shell_manager._stdout_reader_loop()` and forwarded into the same `watcher:files` pipeline

### Adapter RPCs for watcher lifecycle

- `adapter.resubscribeWatcher` — dispose old IPC subscription, call `_setupFileWatcher()` again (used after raising inotify limit)
- `adapter.reconnect({workspaceFolder})` — `disconnect()` + `connect()` with new workspace (used on project switch; adapter process stays alive)

### Key files

- `workbench_client.mjs`: `_setupFileWatcher()` (~line 2075), `resubscribeWatcher()` (~line 2126), `_fsWatcherSub` field
- `server.mjs`: `adapter.resubscribeWatcher` and `adapter.reconnect` RPC handlers
- `vscode_oss_runtime/.../ipc.mjs`: `EventListen` (102), `EventFire` (204), `EventDispose` (103), `listen()` method
- `diagnostics_bridge.py`: `watcher/enospc` and `watcher/fileChanges` handlers
- `explorer_ws.py`: `handle_watcher_setMode`, `handle_watcher_getConfig`, `handle_watcher_raiseLimit`, eager start on connect
- `watchexec_shell_manager.py`: `ensure_watchexec_shell()`, `stop_watchexec_shell()`, `is_watchexec_available()`, `_forward_watchexec_event()`
- `shellspec/watchexec.yaml`: framework shell spec with VS Code parity ignore patterns
- `project_sidecar.py`: `watcher` field in `_default_data()`: `{mode, storage_type, poll_interval_ms}`
- `main.js`: watcher settings UI wiring, ENOSPC modal, `watcher:config`/`watcher:modeStatus` handlers
- `explorer.js`: `watcher:files` handler, `watcher:modeChanged` handler, manual refresh button
- `template.html`: File Watcher section in editor-settings-modal, refresh bar in explorer drawer

### External edit detection (watcher → editor pipeline)

When a watcher event (IPC or watchexec) reports a change to the **currently active file**, the server automatically:
1. Re-reads the file from disk and computes a fresh SHA256
2. Suppresses the event if the SHA matches our own last save (`_LAST_SAVE_SHA` — prevents reload loops)
3. Clears any active draft for the file (stale draft eviction via `clear_cached_document`)
4. Broadcasts `editor:open` with `reason: "external_change"` to all editor clients
5. The inline diff editor also updates — `requestGitBaselines()` fetches fresh HEAD + disk content

**Scroll preservation**: External edits use `model.applyEdits()` (not `model.setValue()`) to update content atomically without resetting scroll position, cursor, or decorations. The diff editor skips `diffEditor.setModel()` when models are already bound — content updates on existing models trigger recomputation without scroll reset.

**Editor mode transitions** (plain ↔ diff): Scroll position is captured from the active editor before disposal and restored on the new editor after creation. `applyGitBaselines()` uses deferred restore (immediate + 50ms + 300ms) to survive the async diff computation and view zone scroll sync that follows `setModel()`.

**ENOSPC suppression**: When the watcher mode is not `ipc` (i.e., user has switched to watchexec, polling, or none), `watcher/enospc` events from the IPC watcher are silently suppressed — the user already knows inotify is limited.

**Key files**:
- `editor_ws.py`: `handle_external_file_change()`, `_LAST_SAVE_SHA` save-suppress dict
- `diagnostics_bridge.py`: IPC watcher path hook (calls `handle_external_file_change` for changed/created), ENOSPC suppression
- `watchexec_shell_manager.py`: watchexec path hook (schedules `handle_external_file_change` via `loop.create_task`)
- `m_editor_app.js`: `model.applyEdits()` for external changes, scroll save/restore in `ensureDiffEditorWithPrefs`/`ensurePlainEditorWithPrefs`/`applyGitBaselines`

### VS Code watcher settings sync (dual-watcher suppression)

When the custom watcher (watchexec) is active, both it AND VS Code's built-in IPC watcher would fire simultaneously on file changes, causing double-refresh and cursor jumps. Fix: `sync_vscode_watcher_settings(watcher_mode)` writes `"files.watcherExclude": {"**": true}` to code-server's `User/settings.json` when custom watcher is active, suppressing VS Code's watcher entirely. When mode is `ipc`, the key is removed so VS Code's watcher resumes.

Called from:
1. `ensure_code_server_shell()` — before shell launch (code-server reads settings on boot)
2. `handle_watcher_setMode()` in `explorer_ws.py` — on runtime mode changes
3. `_ensure_workbench_json_sync()` in `main.py` — called from `_eager_start_code_server()` before shell launch

**Key files**:
- `code_server_shell_manager.py`: `sync_vscode_watcher_settings()` (~line 48-73), `_CODE_SERVER_DATA_DIR`, `_USER_SETTINGS_PATH`

## 20) Cursor Stability Hardening (Autosave + Git Diff)

This section documents the stabilization work that removed full-page thrash and significantly reduced cursor jumps under rapid typing.

### Root causes observed

1. **Diff mode flag drift in iframe context**  
   In `applyGitBaselines()`, `diffEditor.setModel(...)` was skipped when model refs matched, even if `te2AutosaveMode` / `te2FreezeProjection` / `modifiedBaseline` flags were stale.

2. **Mirror echo/jitter under autosave**  
   `editor:mirror` applied full-buffer updates (`model.setValue(...)`) during active typing windows.

3. **Git baseline recompute racing typing**  
   In autosave + inline diff mode, baseline updates could apply while the user was still entering text.

### Runtime fixes (iframe-only)

#### A) Diff flag parity enforcement

Inside `applyGitBaselines()`:
- Compute desired flags from current prefs (`autoSave`, inline diff state).
- If refs match but flags differ, force `diffEditor.setModel(desiredModel)` (no stale mode drift).
- Debug badge now surfaces this via:
  - `flags=ok as=<0|1> fr=<0|1> mb=<0|1>`
  - `flags=rebind ...`
  - `flags=set ...`

#### B) Mirror echo guards + autosave debounce

Mirror publisher/consumer now includes:
- Local mirror publish debounce:
  - autosave ON: `1000ms`
  - autosave OFF: `180ms`
- Hot-typing guard for inbound `editor:mirror`:
  - autosave ON: `850ms`
  - autosave OFF: `250ms`
- Drop conditions in mirror handler:
  - self echo (`source_client` matches socket id)
  - stale/no-op SHA (`payload.content_sha256 == lastContentSha256`)
  - hot typing window

Overlay counters:
- `mir=rx<...>/ap<...>/self<...>/sha<...>/hot<...>`

#### C) Debounced git baseline requests

Client-side request debounce:
- autosave ON: `320ms`
- autosave OFF: `180ms`
- Save-complete path still uses immediate request (`requestGitBaselines({ immediate: true })`).

#### D) Idle apply for autosave + diff

For **autosave ON + inline diff ON**, incoming `editor:git_baselines` payloads are deferred until typing is idle:
- apply idle window: `1000ms`
- latest payload wins (`pendingGitBaselinePayload`)
- debug badge shows `git=defer <ms>` while deferring.

### Build/linking caveat (critical)

If you copy build artifacts with:
`cp -r out-monaco-editor-core/esm/ app/static/vendor/monaco-editor-core/esm/`
you can accidentally create `esm/esm/...` and serve stale code from root `esm/...`.

Correct copy pattern:
`cp -r out-monaco-editor-core/esm/* app/static/vendor/monaco-editor-core/esm/`

Verification checks:
- `app/static/vendor/monaco-editor-core/esm/vs/.../diffEditorViewModel.js` contains `te2AutosaveMode` logic.
- `app/static/vendor/monaco-editor-core/te2-lang/bootstrap/monaco.bootstrap.bundle.js` contains matching logic.

### Key files

- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js`
  - flag parity check in `applyGitBaselines()`
  - mirror debounce/guards and mirror debug counters
  - debounced/idle git baseline scheduling
- `worktrees/vscode-te2-diff/src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts`
  - autosave-gated TE2 diff control flow (`te2AutosaveMode`)
- `worktrees/vscode-te2-diff/src/vs/editor/common/editorCommon.ts`
  - `IDiffEditorModel.te2AutosaveMode?: boolean`

---

## 21) UI IPC — Frontend-to-Frontend Communication

### Problem

The editor runs in an iframe with its own document context. UI actions in the iframe (Ctrl+S, editor focus) need to trigger behavior on the main page (save file, close menus). Direct function calls are impossible across iframe boundaries, and `postMessage` lacks observability.

### Architecture

A dedicated Socket.IO namespace (`/ui_ipc`) acts as a thin relay. Python logs all traffic for observability but contains no business logic — it just rebroadcasts events to all other clients in the room (skip sender).

```
Editor iframe (m_editor_app.js)           Main page (main.js)
  │                                          │
  ├─ Ctrl+S keybinding ──┐                   │
  ├─ editor focus ────────┤                   │
  │                       ▼                   │
  │              ui_event {type:...}          │
  │                       │                   │
  │              ┌────────▼────────┐          │
  │              │  /ui_ipc namespace │        │
  │              │  ui_ipc_ws.py      │        │
  │              │  (log + rebroadcast)│       │
  │              └────────┬────────┘          │
  │                       │                   │
  │                       ▼                   │
  │              ui_event {type:...}          │
  │                       │                   │
  │                       ├─ type:"save"  → synthetic Ctrl+S keydown
  │                       └─ type:"focus" → synthetic click on body
```

### Event types

| `type`   | Source         | Effect on main page                     |
|----------|----------------|-----------------------------------------|
| `save`   | Ctrl+S in iframe | Dispatches synthetic `Ctrl+S` keydown → existing `saveFile()` handler |
| `focus`  | Editor widget focus | Dispatches synthetic click on `document.body` → existing `closeAllMenus()` handler |

### Why synthetic DOM events?

The `ui_event` handler runs in the `connectUIIPC()` closure, which is defined early in `main.js` (line ~995). Functions like `saveFile()` and `closeAllMenus()` are defined later. Rather than dealing with hoisting/scope issues in an ES module, the handler dispatches native DOM events that trigger the same `document.addEventListener` handlers those functions are already wired to.

### Key files

- `app/apps/file_editor_cm6/ui_ipc/__init__.py` — empty package init
- `app/apps/file_editor_cm6/ui_ipc/ui_ipc_ws.py` — `UIIPCNamespace`: logs event type + sender sid, rebroadcasts to room (skip sender)
- `app/apps/file_editor_cm6/ui_ipc/ui_ipc_socketio.py` — creates `UI_IPC_SIO` server + `UI_IPC_ASGI_APP`
- `app/apps/file_editor_cm6/services/ui_ipc_transport.py` — main-process websocket proxy at `/ui_ipc_ws/socket.io`
- `app/apps/file_editor_cm6/manifest.json` — `ui_ipc_transport` in services modules list
- `app/apps/file_editor_cm6/main.py` — `UI_IPC_ASGI_APP` mounted in SUBAPPS
- `app/apps/file_editor_cm6/main.js` — `connectUIIPC()`, `ui_event` listener with synthetic event dispatch
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js` — `connectUIIPC()`, `bindUIIPCEditorHooks()`, `_bindEditorSaveKey()`, `_bindEditorFocusRelay()`

### Extending

To add a new IPC event type:
1. Emit `ui_event` with a new `type` string from either page
2. Add a handler in the receiving page's `ui_event` listener
3. Python relay requires no changes — it rebroadcasts all `ui_event` payloads

## 22) Extension Configuration Auto-Extraction

### Problem

VS Code extensions read settings during `activate()` via `workspace.getConfiguration("section").get("key")`.
This reads from the ext host's in-memory configuration model, which is populated by the
`$initializeConfiguration` RPC (rpcId=80) sent from the workbench adapter at boot.

If an extension's config keys are missing from the data we send, `get()` returns `undefined`.
Extensions that gate on enable flags (e.g. clangd checks `clangd.enable`) silently skip
starting their language server — no error, no crash, just no providers registered.

Previously `_buildConfigurationInitData()` hardcoded per-extension configs (Python only).
Every new extension required manual additions. This doesn't scale and is fragile.

### Solution — automatic defaults from `package.json`

Every VS Code extension declares its settings in `package.json` under
`contributes.configuration.properties`. Each property has a dotted key and a schema with a
`"default"` value:

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "clangd.enable": { "type": "boolean", "default": true },
        "clangd.path":   { "type": "string",  "default": "clangd" }
      }
    }
  }
}
```

`_buildConfigurationInitData(folder, authority, scannedExtensions)` now:

1. Iterates ALL `scannedExtensions` (already available from mgmt scan)
2. For each extension, reads `packageJSON.contributes.configuration.properties`
3. For each property with a `"default"` value, splits the key at dots
   (e.g. `"clangd.enable"` → section `clangd`, prop `enable`) and nests it into a
   `contents` object — handles deeply nested keys like `"python.analysis.autoSearchPaths"`
4. Sends the whole thing as the `defaults` field of `IConfigurationInitData`
5. User/extension overrides come from `User/settings.json` via `userRemote` (see §29)

The result: any installed extension gets its declared defaults automatically. No hardcoding.

### Wire format

The `$initializeConfiguration` payload is `IConfigurationInitData`:

```
{ defaults, policy, application, userLocal, userRemote, workspace, folders, configurationScopes }
```

Each section is an `IConfigurationModel`:

```
{ contents: { section: { key: value, ... } }, overrides: [], keys: ["section.key", ...] }
```

`defaults` carries the extension-contributed defaults. `userRemote` carries TE2 overrides.
All other sections are empty.

After `$initializeConfiguration`, we also send `$acceptConfigurationChanged` with the same
data and the full key list so extensions that listen for config changes pick up the values.

### TE2 overrides (applied after scan)

No hardcoded overrides remain in `_buildConfigurationInitData()`. All extension
settings now flow from two external sources:

1. **Extension config UI** → `configuration_values` in the registry
2. **Custom Settings textarea** → `custom_settings` in the registry

Both are written to `User/settings.json` by `rebuild_settings_gate()`, and the
adapter reads that file into `userRemote` at boot (see §29).

To add a forced override, use the Custom Settings UI in the extension manager
or set keys directly in `User/settings.json` (non-managed keys are preserved).

### Key file

`workbench_client.mjs` → `_buildConfigurationInitData()` (~line 1120)


## 29) Settings Pipeline — Extension Config, Custom Settings, and Adapter Relay

### Overview

TE2 has three layers that produce the final `User/settings.json` that the
workbench adapter reads at boot:

```
┌──────────────────────┐   ┌──────────────────────────┐
│  Extension Config UI │   │  Custom Settings textarea │
│  (per-extension)     │   │  (global JSON)            │
└──────────┬───────────┘   └─────────┬────────────────┘
           │ configuration_values     │ custom_settings
           ▼                          ▼
┌─────────────────────────────────────────────────────┐
│              te2_extension_registry.json             │
└──────────────────────┬──────────────────────────────┘
                       │ rebuild_settings_gate()
                       ▼
┌─────────────────────────────────────────────────────┐
│              User/settings.json                      │
│  (global gate + per-language overrides + ext config  │
│   + custom settings)                                 │
└──────────────────────┬──────────────────────────────┘
                       │ readFileSync() at boot
                       ▼
┌─────────────────────────────────────────────────────┐
│  workbench_client.mjs  _buildConfigurationInitData() │
│  → $initializeConfiguration (rpcId=80) userRemote    │
└─────────────────────────────────────────────────────┘
```

### Merge priority in `rebuild_settings_gate()`

Applied in this order (later wins, with one exception):

1. **Preserved keys** — non-managed keys from the existing `settings.json`
   (e.g. `files.watcherExclude` set by watcher sync)
2. **Global gate** — `_GLOBAL_GATE` dict (disables smart features globally)
3. **Per-language overrides** — `_LANGUAGE_SLOT_OVERRIDES` for active slots
   (re-enables smart features per language)
4. **Extension `configuration_values`** — keys set via the per-extension config
   modal. `editor.*` keys go into the `[lang]` override block; all others go
   top-level.
5. **Custom settings** — keys from the "Custom Settings (JSON)" textarea.
   **Exception:** keys already managed by extension `configuration_values` are
   skipped. This ensures the extension config UI always wins over the raw
   JSON escape hatch.

### Adapter relay (`workbench_client.mjs`)

`_buildConfigurationInitData()` (~line 1120) reads `User/settings.json` and
populates the `userRemote` section of `IConfigurationInitData`:

- Flat keys like `basedpyright.analysis.typeCheckingMode` are split at dots and
  nested: `{ basedpyright: { analysis: { typeCheckingMode: "off" } } }`
- Language-scoped overrides like `[python]` become `IOverrides` entries with
  `identifiers: ["python"]`
- Sent via `$initializeConfiguration` (rpcId=80), then immediately followed by
  `$acceptConfigurationChanged` so extensions listening for config changes pick
  up the values

### Project config files override everything

Extensions like basedpyright read their own project config files directly from
disk (e.g. `pyrightconfig.json`, `pyproject.toml [tool.basedpyright]`). These
**always take priority** over VS Code settings. If a `pyrightconfig.json` sets
`typeCheckingMode: "strict"`, it overrides `settings.json`'s `"off"` regardless
of what the UI shows. If the project config has an invalid value, the extension
falls back to its **compiled-in default** (not `settings.json`).

### Custom Settings UI

Accessible from the extension manager modal (collapsible "⚙ Custom Settings
(JSON)" section). Accepts arbitrary JSON key-value pairs:

```json
{
  "editor.semanticHighlighting.enabled": true,
  "basedpyright.analysis.diagnosticMode": "workspace"
}
```

Values are persisted in the registry under `custom_settings` and merged into
`settings.json` on save. Requires code-server restart to take effect.

### Key files

| File | Role |
|------|------|
| `extension_registry.py` | `rebuild_settings_gate()`, `get/set_custom_settings()` |
| `explorer_ws.py` | `handle_ext_configure`, `handle_ext_custom_settings_get/set` |
| `workbench_client.mjs` | `_buildConfigurationInitData()` reads `settings.json` |
| `main.js` | Extension config modal, Custom Settings textarea UI |
| `template.html` | Modal markup for ext config + custom settings |


## 23) Semantic Tokens Pipeline (End-to-End)

### Problem

Monaco standalone has no built-in semantic token support from VS Code's extension host. Five barriers had to be overcome:

1. **CancellationToken argument bug** — VS Code's RPC layer auto-pushes a real `CancellationToken` onto the args array. Passing `{}` as a placeholder shifted all parameters, causing `n.onCancellationRequested is not a function` errors on every semantic token request.

2. **Uint32Array alignment crash** — Node.js Buffer pool uses a shared ArrayBuffer. `buf.byteOffset` isn't guaranteed to be 4-byte aligned, so `new Uint32Array(buf.buffer, buf.byteOffset, ...)` throws RangeError. This crash was caught silently and returned as a JSON-RPC error to the frontend.

3. **Monaco `semanticHighlighting = false`** — `standaloneThemeService.ts` hardcodes this flag to `false`, so `isSemanticColoringEnabled()` always returns false and Monaco never applies semantic tokens even when data arrives.

4. **No semantic-to-TextMate scope mapping** — Monaco standalone's `getTokenStyleMetadata()` matches semantic token type names directly against theme rules, but themes only define TextMate scope names. Without a bridge, `function` tokens get white instead of purple, `variable` tokens get orange instead of white, etc.

5. **`setColorMap` palette conflict** — Encoded TextMate tokenization (`tokenizeLine2`) requires `setColorMap()` to sync the ~300-color TextMate palette to Monaco. But this replaces the rendering palette, making semantic token foreground indices (compiled against the ~20-color theme palette from `defineTheme`) point to wrong colors. E.g., index 7 = orange in the theme palette but some random blue in the TextMate palette.

### Solution

1. **CancellationToken fix**: Never include `{}` in args for cancellable requests. The `cancellable: true` flag sets wire type 2/4, and the RPC layer handles the rest. See `WORKBENCH_SEMANTIC_COMPLETIONS_KNOWLEDGE.md` for the full arg patterns table.

2. **Alignment fix**: Copy buffer to a fresh aligned `Uint8Array` before creating `Uint32Array`. Applied to both `semanticTokens()` and `semanticTokensRange()` in `workbench_client.mjs`.

3. **semanticHighlighting source fix**: Changed `standaloneThemeService.ts:182` from `false` to `true` in the TE2 Monaco build. A runtime monkey-patch (`_forceSemanticHighlighting()`) also exists as a fallback.

4. **Semantic token color mapping**: `_buildSemanticTokenRules()` in `m_editor_app.js` mirrors VS Code's `TokenClassificationRegistry` by mapping each semantic token type (e.g., `function`, `variable`, `parameter`) to its equivalent TextMate scope (e.g., `entity.name.function`, `variable.other.readwrite`, `variable.parameter`), resolves the color from the theme's `tokenColors`, and injects the rules into the Monaco theme.

5. **Palette index translation**: `_patchSemanticTokenColorIndices()` monkey-patches `getTokenStyleMetadata` on the active theme object. After `setColorMap` overrides the rendering palette, the patch translates foreground indices: tokenTheme index → hex color (via `Color.toString()`) → find matching hex in TextMate color map → return TextMate index. This ensures semantic tokens render the correct color even when the rendering palette has been overridden.

### Encoded TextMate tokenization

TE2 uses vscode-textmate's encoded mode (`tokenizeLine2`) instead of text mode (`tokenizeLine`). Text mode only provides the innermost scope string per token — Monaco matching this single scope against theme rules produces different colors than code-server, which evaluates the full scope stack.

Encoded mode resolves the full scope stack against the theme internally and returns a `Uint32Array` with pre-computed color indices, matching code-server exactly. Requirements:
- `registry.setTheme(IRawTheme)` must be called before tokenization
- `monaco.languages.setColorMap(registry.getColorMap())` syncs the rendering palette
- Provider exposes `tokenizeEncoded(line, state)` — Monaco auto-detects this via `isEncodedTokensProvider()`

### Data flow

```
ext host ($provideDocumentRangeSemanticTokens)
  → workbench_client.mjs (decode Uint32Array, attach legend)
  → server.mjs (vscode.semanticTokensRange route)
  → Socket.IO (editor_workbench_semantic_tokens_range)
  → editor_ws.py (adapter_rpc bridge)
  → m_editor_app.js (DocumentRangeSemanticTokensProvider)
  → Monaco getTokenStyleMetadata() → _patchSemanticTokenColorIndices translation → rendered colors
```

### Token data format

5-element tuples in a flat Uint32Array: `[deltaLine, deltaStartChar, length, tokenTypeIndex, tokenModifiersMask]`

- `tokenTypeIndex` indexes into `legend.tokenTypes` (e.g., 0 = "namespace", 7 = "variable", 11 = "function")
- `tokenModifiersMask` is a bitmask indexing into `legend.tokenModifiers` (e.g., bit 0 = "declaration", bit 3 = "readonly")

### Monaco build required

The `semanticHighlighting = true` source change requires a Monaco rebuild:

```bash
cd worktrees/vscode-te2-diff
NODE_OPTIONS="--max-old-space-size=4096" npx gulp editor-distro
# Copy ESM artifacts
VENDOR_DIR="../../app/static/vendor/monaco-editor-core"
rm -rf "$VENDOR_DIR/esm" && mkdir -p "$VENDOR_DIR/esm"
cd out-monaco-editor-core/esm
find . \( -name "*.js" -o -name "*.css" -o -name "*.ttf" \) \
  -exec sh -c 'mkdir -p "'"$VENDOR_DIR"'/esm/$(dirname "$1")" && cp "$1" "'"$VENDOR_DIR"'/esm/$1"' _ {} \;
# Rebuild bootstrap bundle
cd ../.. && node ../../scripts/build_monaco_iframe_bootstrap_bundle.mjs
```

### Key files

| File | Role |
|---|---|
| `workbench_client.mjs` | CancellationToken fix, Uint32Array alignment fix, legend extraction, semantic token RPC, `resync()` |
| `server.mjs` | `vscode.semanticTokensRange` route, `te2.resync` RPC |
| `editor_ws.py` | Socket.IO ↔ adapter bridge for semantic tokens, resync trigger in readiness check |
| `m_editor_app.js` | `_buildSemanticTokenRules()`, `_forceSemanticHighlighting()`, `_patchSemanticTokenColorIndices()`, encoded TextMate provider (`tokenizeEncoded`), `_applyThemeToTextmateRegistry()` |
| `standaloneThemeService.ts` | Source fix: `semanticHighlighting = true` |
| `tokenClassificationRegistry.ts` | VS Code's semantic-to-TextMate mapping (reference) |

### Page reload / multi-client: `te2.resync`

Provider registrations are one-time events from ext host boot. A fresh frontend (page reload) or second client never sees them. The `te2.resync` RPC solves this:

1. Python's `on_editor_readiness_check()` finds adapter already running
2. Calls `te2.resync` → adapter replays cached provider events via `onEvent`
3. Events flow through stdout pipe → Python → Socket.IO → frontend
4. Frontend registers providers with legends — semantic tokens work immediately

Properties:
- No adapter restart — ext host stays hot, baton sequence untouched
- Multi-client safe — each client gets its own resync
- Idempotent — `registeredSemanticTokens` set guards against duplicates
- First step toward Option 3 architecture (adapter as stateful backend)

### Known limitations

- **Hover tooltip colors**: Hover code blocks use `colorize()` (TextMate tokenization), not semantic tokens. Parameter colors in hovers may be a slightly different shade than the editor's semantic token color (TextMate-resolved vs semantic-resolved for the same scope).
- **Python semantic tokens**: Pyright (open-source) does not register a semantic token provider. Only TypeScript/JavaScript get semantic tokens from the ext host. Python semantic tokens require Pylance (proprietary, unavailable for code-server). Python coloring is purely TextMate-based.
- **Palette patch timing**: `_patchSemanticTokenColorIndices()` must run after editor creation + tmRegistry initialization + setColorMap. Multiple call sites ensure at least one hits the right timing window.

## 24) Completions Pipeline (End-to-End)

### Overview

Completions flow from the frontend through the same 4-layer RPC pipeline as other language features. The user types → Monaco fires `provideCompletionItems` → frontend serializes the request → Python bridge relays it → adapter calls `$provideCompletionItems` on the ext host → results come back as a minified `ISuggestResultDto` → adapter inflates the DTO → results propagate back to Monaco.

### Data flow

```
Monaco CompletionItemProvider.provideCompletionItems()
  → m_editor_app.js: serialize (path, language, line, col, trigger)
  → editor_ws.py: relay via adapter_rpc("vscode.completions", ...)
  → server.mjs: route to wb.completions()
  → workbench_client.mjs: $provideCompletionItems(handle, resource, position, context, token)
  → ext host: language server computes completions
  ← ISuggestResultDto (minified wire format)
  ← workbench_client.mjs: _inflateCompletionItems() → Monaco suggestions
  ← server.mjs → editor_ws.py → m_editor_app.js → Monaco widget
```

### The debounce race condition

The ext host computes completions against its internal document model. `didChange` events are debounced at 180ms (`_localMirrorDebounceMs`) before being sent to the ext host. Completion requests fire immediately on every keystroke. Result: the ext host's document is 1 keystroke behind.

**Symptoms**:
- First character after trigger: zero-width completion range (ext host has no word yet)
- Second character: range covers only 1 char, results are generic globals instead of contextual
- Third character: finally correct (previous didChange has arrived)
- Deleting back makes results work for the position that previously failed

### Solution: pre-flight document sync

Two-part fix ensures the ext host always has the latest document content:

**Part 1 — Frontend (`m_editor_app.js`)**:
- `_flushMirrorDebounce()` force-fires the pending debounce timer before each completion request
- `text: m.getValue()` is included in every completion RPC as the authoritative full document content

**Part 2 — Adapter (`workbench_client.mjs`)**:
- `completions()` checks for `params.text`; if present, calls `this.didChange()` synchronously before `$provideCompletionItems`
- `didChange()` writes `$acceptModelChanged` directly to the ext host's stdin pipe — synchronous, no transport delay
- The ext host processes the didChange before the completion request because both run in the same Node.js event loop tick

### Wire format — `ISuggestResultDto`

The ext host returns a minified DTO with single-letter field names for wire efficiency:

**Top-level `ISuggestResultDto`**:
- `a`: defaultRanges (applied to items without their own range)
- `b`: completions array (`ISuggestDataDto[]`)
- `c`: isIncomplete flag
- `d`: duration
- `x`: cache ID for `$releaseCompletionItems`

**Per-item `ISuggestDataDto`**:
- `a`: label, `b`: kind, `c`: detail, `d`: documentation
- `e`: sortText, `f`: filterText, `g`: preselect
- `h`: insertText, `i`: insertTextRules
- `j`: range (overrides defaultRanges), `k`: commitCharacters
- `l`: additionalTextEdits, `m`: kindModifier (tags)
- `n/o/p`: command (ident/id/arguments), `x`: item cache ID

### Key files

| File | Role |
|---|---|
| `m_editor_app.js` | `provideCompletionItems`, `_flushMirrorDebounce()`, sends `text` param |
| `editor_ws.py` | `on_editor_workbench_completions()` — passes text to adapter RPC |
| `server.mjs` | `vscode.completions` route — passes text to `wb.completions()` |
| `workbench_client.mjs` | `completions()` — pre-flight didChange, `$provideCompletionItems`, `_inflateCompletionItems()` |

### Inflation and range handling

`_inflateCompletionItems()` in `workbench_client.mjs`:
1. Reads `dto.a` as `defaultRanges` (insert + replace ranges for all items)
2. For each item in `dto.b`: maps minified fields to Monaco's `CompletionItem` shape
3. If an item has its own `c.j` range, uses that; otherwise uses `defaultRanges`
4. Ranges are `{ insert: { startLineNumber, startColumn, endLineNumber, endColumn }, replace: {...} }` (1-based, Monaco convention)

### Resolve and release

- `$resolveCompletionItem(handle, id, token)` — lazily loads full documentation for a selected item
- `$releaseCompletionItems(handle, id)` — frees the cached completion set when the widget closes

## 25) Console Observability System (vConsole + Socket.IO)

A browser-side console log viewer built on [Tencent vConsole](https://github.com/Tencent/vConsole), integrated into the terminal drawer as a second tab.  Multiple frontends (main page, editor iframe, future apps) ship serialized `console.*` output through the existing `ui_ipc` Socket.IO namespace to a single vConsole drawer UI.

### Architecture overview

```
┌─────────────┐  console:log   ┌──────────────┐  console:log   ┌────────────────┐
│  main page  │───────────────▸│              │───────────────▸│  Console tab   │
│  (bridge)   │                │  Python      │                │  (vConsole UI) │
├─────────────┤  console:log   │  relay       │  replay on     │  in drawer     │
│  editor     │───────────────▸│  + disk      │  connect       │                │
│  iframe     │                │  append      │───────────────▸│  origin filter │
│  (bridge)   │                └──────────────┘                └────────────────┘
└─────────────┘                  ▼
                          ~/.cache/cm6_editor/
                          console_log.jsonl
```

- **No in-memory log buffer** on the Python side — relay is pass-through + disk append.
- Disk log is **wiped on server boot** (one session per Python process lifetime).
- New drawer connections get a **full replay** from disk before switching to live.

### Files

| File | Role |
|------|------|
| `static/js/console_bridge.js` | Agnostic console monkey-patcher — patches `console.*`, serializes args, emits `console:log` on ui_ipc. Reusable on any frontend. |
| `static/js/console.js` | Drawer UI module — loads vConsole dynamically, connects as `role: 'drawer'`, renders incoming `console:log` events via `vConsole.log.<level>()` plugin API. |
| `static/vendor/vconsole/vconsole.min.js` | Vendored vConsole 3.x dist (MIT). |
| `ui_ipc/console_ws.py` | Python event handlers — `console:register`, `console:log`, `console:eval`, `console:evalResult`. Disk-backed JSONL append + replay. |
| `ui_ipc/ui_ipc_ws.py` | Delegates `console:*` events to `console_ws.py`. |
| `template.html` | Drawer tab bar (Terminal \| Console), console header (origin dropdown + clear), `#console-container`, vConsole CSS overrides. |
| `main.js` | Imports bridge + console modules, wires tab switching, View menu toggle. |
| `monaco_editor/m_editor_app.js` | Inline bridge for the editor iframe — reuses `uiIpcSocket`, registers as `editor_iframe` worker. |

### Event protocol (all on `/ui_ipc` namespace)

| Event | Direction | Payload | Notes |
|-------|-----------|---------|-------|
| `console:register` | client → server | `{ role: 'drawer' \| 'worker', workerId? }` | Drawer joins `console:drawers` room + gets replay. Worker joins `console:<workerId>` room. |
| `console:log` | worker → server → drawers | `{ workerId, level, ts, args[] }` | `args` are JSON-safe (pre-serialized by bridge via `safeSerialize()`). Appended to disk. |
| `console:eval` | drawer → server → worker | `{ targetWorkerId, reqId, code }` | Routed to `console:<workerId>` room only. |
| `console:evalResult` | worker → server → drawers | `{ workerId, reqId, ok, value\|error }` | Forwarded to `console:drawers` room. |

### Room layout

- `console:drawers` — all drawer clients (receives fan-out of every `console:log`)
- `console:<workerId>` — per-worker room (used for targeted `console:eval` routing)

### Console bridge (`console_bridge.js`)

The bridge is **not** a vConsole instance — it's a lightweight monkey-patcher + serializer:

1. Wraps `console.log/info/warn/error/debug` — captures method name (categorization) + args
2. `safeSerialize()` handles circular refs, BigInt, Error objects, DOM elements → JSON-safe output
3. Adds `Date.now()` timestamp and `workerId`
4. Emits over socket as `console:log`
5. Captures `window.onerror` and `unhandledrejection` as error-level entries
6. Supports `console:eval` for remote code execution from the drawer

vConsole is only needed on the **drawer side** for rendering. The bridge just ships data.

### Origin filter (drawer header)

The console tab header contains a "Source" dropdown (uses `fe-menu` / `fe-dropdown` CSS classes) that filters incoming logs by `workerId`:
- **All** — shows everything with `[workerId]` prefix tags
- **\<workerId\>** — shows only that origin's logs

Workers are discovered dynamically from incoming `console:log` events and added to the dropdown. A "Clear" button calls `vConsole.log.clear()`.

### Disk persistence

- **Path**: `~/.cache/cm6_editor/console_log.jsonl`
- **Format**: Newline-delimited JSON, one `console:log` payload per line
- **Lifecycle**: Wiped on Python server boot → accumulates for session → wiped next boot
- **Replay**: On drawer `console:register`, the entire file is streamed line-by-line via `ns.emit("console:log", entry, to=sid)`
- **No memory buffer**: Python holds zero log data in RAM — reads from disk for replay, appends via open file handle with per-write flush

### Script loading

Template HTML is injected via `innerHTML` (app_shell.html line 547–549), which **does not execute `<script>` tags**. vConsole and Socket.IO are loaded dynamically via `document.createElement('script')`:

```js
function ensureVConsoleLoaded() {
  if (window.VConsole) return Promise.resolve(window.VConsole);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/apps/file_editor_cm6/static/vendor/vconsole/vconsole.min.js';
    script.onload = () => resolve(window.VConsole);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}
```

Same pattern as `ensureSocketIoLoaded()` in main.js. Both must resolve before their dependents initialize.

### Duplicate suppression (vConsole capture bypass)

vConsole monkey-patches `console.*` on instantiation, which would double-display main-page logs (once from vConsole's own capture, once from our bridge round-trip). To prevent this, `console.js` saves the current `console.*` methods — which are already our bridge wrappers — **before** calling `new VConsole()`, then restores them immediately after:

```js
// Before vConsole init:
const saved = { log: console.log, info: console.info, ... };

// After new VConsole():
console.log = saved.log;  // restore bridge wrappers
```

This neuters vConsole's built-in capture layer. All log traffic flows exclusively through the bridge → Python → drawer socket path, where each entry carries a `workerId` label and is persisted to disk. vConsole only renders what we explicitly feed it via `vConsole.log.<level>()`.

### Remote eval via vConsole command bar

The vConsole command bar normally calls `eval.call(window, cmd)` locally. Since our console is a remote viewer, `console.js` monkey-patches `evalCommand` on the log model singleton to route through the socket:

1. User types command in vConsole's input bar
2. Patched `evalCommand` emits `console:eval` to the worker selected in the origin dropdown
3. Worker's bridge calls `eval()` locally and emits `console:evalResult`
4. Result is displayed in vConsole via `model.addLog()` with `cmdType: 'output'`

The log model singleton is accessed via `vConsoleInstance.pluginList['default'].model` (`pluginList` is a dict keyed by plugin id in the minified build).

### Filter-triggered replay

When the user changes the origin dropdown selection, the drawer:
1. Calls `vConsole.log.clear()` to wipe the current display
2. Emits `console:replay` to Python, which re-streams the entire disk log
3. `_handleLog()` applies the new `activeFilter`, showing only matching entries

This ensures users see the complete filtered history, not just logs from the moment of filter change.

### vConsole integration notes

- vConsole keeps **raw JS references** (`origData: any`) in its internal log store — not serializable. The pretty-printing happens in Svelte render components, not in the data model.
- `vConsole.log.log()` / `.info()` / `.warn()` / `.error()` write to the Log panel **only** (no browser console echo) — this prevents infinite loops when the bridge is also active.
- `vConsole.hideSwitch()` hides the floating toggle button; `vConsole.show()` opens the panel. We control visibility from the drawer tab, not vConsole's own UI.
- CSS overrides in template.html force `#__vconsole` into relative positioning to fill `#console-container` instead of using vConsole's default fixed overlay.

## 26) Monarch Palette Corruption Fix (Universal)

### Problem

Monaco has two independent tokenization systems:

| System   | Path | Token encoding |
|----------|------|---------------|
| TextMate | `vscode-textmate` registry → `tokenizeLine2()` | `Uint32Array` with foreground indices from the TextMate color map (~300 colors) |
| Monarch  | Regex rules → `tokenTheme.match(languageId, scopes)` | Packed metadata with foreground indices from tokenTheme's internal palette (~20 colors) |

When `setColorMap()` overrides the rendering palette with TextMate's color map, Monarch-only languages (Kotlin, TOML, Makefile, etc.) resolve their foreground indices against the wrong palette, producing incorrect colors.

### Root cause

`TokenTheme.match()` returns metadata containing foreground indices from its own small palette. After `setColorMap()`, the renderer uses the TextMate color map (which is much larger and has different index→color mappings). The Monarch indices now point to the wrong colors.

### Fix: `_colorIndexTranslation` in `TokenTheme`

**File**: `worktrees/vscode-te2-diff/src/vs/editor/common/languages/supports/tokenization.ts`

A translation array is added to `TokenTheme`:

```
_colorIndexTranslation: Uint32Array | null = null;
```

In `match()`, when `_colorIndexTranslation` is set, the foreground index is extracted from the metadata, looked up in the translation table, and repacked:

```
const fg = (metadata & 0x00FFFF80) >>> 15;
if (fg < this._colorIndexTranslation.length) {
    const mapped = this._colorIndexTranslation[fg];
    metadata = ((metadata & ~0x00FFFF80) | (mapped << 15)) >>> 0;
}
```

**MetadataConsts bit layout** (from `encodedTokenAttributes.ts`):
- `FOREGROUND_MASK`: `0x00FF8000` → bits 15–22
- `FOREGROUND_OFFSET`: 15

### Wiring

`_patchSemanticTokenColorIndices()` in `m_editor_app.js` builds the translation table by matching colors from tokenTheme's small palette to their indices in the TextMate color map, then sets it directly on the tokenTheme object:

```js
theme.tokenTheme._colorIndexTranslation = indexTranslation;
theme.tokenTheme._cache.clear();
```

The cache must be cleared because previously cached metadata has stale foreground indices.

**Tree-shaking note**: The `setColorIndexTranslation()` method was tree-shaken from the Monaco build because it was only called through `as any` casts. The field `_colorIndexTranslation` and the `match()` logic survive because they execute in the hot path.

### Key files

| File | Role |
|------|------|
| `tokenization.ts` (patched source) | `_colorIndexTranslation` field + translation logic in `match()` |
| `standaloneThemeService.ts` (patched source) | `setColorMapOverride()` builds translation + forwards |
| `m_editor_app.js` `_patchSemanticTokenColorIndices()` | App-layer: sets field directly on tokenTheme |
| `monaco.bootstrap.bundle.js` | Built bundle containing the fix (~line 164490) |

## 27) Dynamic Theme System

### Architecture overview

Themes are discovered from two sources:

1. **Vendored themes** — shipped in `monaco_editor/themes/vendored/{vendor}/`
2. **Extension themes** — discovered via `contributes.themes[]` in installed VSIX extensions

Both sources are merged by `GET /monaco_editor/available_themes` and returned as:

```json
{
  "id": "github-dark-default",
  "label": "GitHub Dark Default",
  "uiTheme": "vs-dark",
  "source": "vendored",
  "sourceLabel": "GitHub Theme (Bundled)",
  "serveUrl": "/api/app/file_editor_cm6/ui/monaco_editor/themes/vendored/github/github-dark-default.json"
}
```

### Vendored themes

Located at `monaco_editor/themes/vendored/github/`:
- `theme_index.json` — manifest mapping theme IDs to filenames
- 9 theme JSON files (GitHub Dark Default, GitHub Light, Dimmed, High Contrast, etc.)

### Extension `contributes.themes` parsing

`extension_registry.py` → `_parse_extension_package()` extracts `contributes.themes[]` entries from each extension's `package.json`:

```python
themes = pkg.get("contributes", {}).get("themes", [])
```

Each entry yields `{id, label, uiTheme, path}`. These appear in the `available_themes` response with `source: "extension"`.

### Frontend registry

`m_editor_app.js`:
- `_ensureThemeRegistry()` — fetches `available_themes` once, builds a `Map<id, entry>`
- `_getVscodeThemeJsonUrl(themeId)` — looks up serve URL from registry; fallback to vendored path map
- `loadVscodeTextmateThemes()` — loads ALL themes from registry into `_jsonCache`, calls `defineTheme()` for each
- `_resolveMonacoThemeId(themeKey)` — normalizes theme key to Monaco-registered theme ID
- `applyMonacoTheme(themeKey)` — applies theme + lazy load + TextMate sync + palette patch + retokenization

### Theme submodal (UI)

| Element | Purpose |
|---------|---------|
| `#editor-themes-modal` (z-index 345) | Full theme browser, fe-modal pattern |
| `#editor-settings-theme-strip` | Clickable strip in settings modal → opens theme browser |

Sections: **Bundled** (vendored), **From Extensions** (installed).

> **Built-in Monaco themes disabled** — `vs`, `vs-dark`, `hc-black`, `hc-light` are hidden from the theme picker and their IDs redirect to the closest GitHub vendored theme. These built-in themes lack a `tokenColors` array, so after `setColorMap()` overrides the rendering palette for TextMate, semantic tokens resolve foreground indices against the wrong palette (producing black or invisible text). Only vscode-style themes with full `tokenColors` JSON are supported. This will be revisited when a proper `setColorMap(null)` → retokenize pipeline is implemented.

### Key files

| File | Role |
|------|------|
| `m_editor_app.js` | Theme registry, loading, application |
| `m_editor_app.py` | `GET /available_themes` endpoint, vendored theme serving |
| `extension_registry.py` | `contributes.themes[]` parsing |
| `main.js` | Theme submodal open/close/refresh logic |
| `template.html` | `#editor-themes-modal` markup |
| `themes/vendored/github/theme_index.json` | Vendored theme manifest |

### Gotchas

- **Short hex colors**: Monaco's tokenization parser rejects 3/4-char CSS shorthand hex (`#fff`, `#0008`). The converter functions `_expandShortHex()` and `_toMonacoColorHex()` in `m_editor_app.js` expand these to 6/8-char before passing to `defineTheme()`.
- **Built-in themes disabled**: `vs`, `vs-dark`, `hc-black`, `hc-light` are hidden from the picker. They lack `tokenColors` so semantic tokens resolve to wrong palette indices after `setColorMap()`. IDs redirect to closest GitHub vendored theme via `_resolveMonacoThemeId()`. See §28 for related retokenization details.

## 28) Theme-Switch Retokenization

### Problem

After `applyMonacoTheme()` calls `setTheme()` + `setColorMap()` + `_patchSemanticTokenColorIndices()`, the already-tokenized lines in the editor model still contain cached token data from the **old** theme. Colors only update after a full page reload.

### Fix

At the end of `applyMonacoTheme()`, after all theme/palette/translation updates are complete, force retokenization on every open model:

```js
var models = window.monaco.editor.getModels();
for (var mi = 0; mi < models.length; mi++) {
  if (models[mi] && typeof models[mi].resetTokenization === 'function') {
    models[mi].resetTokenization();
  }
}
```

`resetTokenization()` invalidates the model's line-level token cache, causing Monaco to re-run all tokenizers (TextMate `tokenizeLine2` and Monarch `match()`) against the updated color map and translation table.

### Execution order in `applyMonacoTheme()`

1. `loadVscodeTextmateThemes()` — ensure all themes defined
2. `_resolveMonacoThemeId()` — normalize theme key
3. Lazy-load single theme if not cached
4. `monaco.editor.setTheme(resolvedId)` — activates theme, rebuilds `tokenTheme`
5. `_applyThemeToTextmateRegistry(tmActiveThemeJson)` — updates TextMate color map via `setColorMap()`
6. `_forceSemanticHighlighting()` — ensures semantic tokens enabled
7. `_patchSemanticTokenColorIndices()` — rebuilds `_colorIndexTranslation` on new tokenTheme + clears cache
8. **`resetTokenization()` on all models** — flushes stale line tokens, triggers full retokenization

---

## 30) RPC Protocol IDs (`rpcId`) — How They Work and Auto-Discovery

### How VS Code assigns rpcIds

The extension-host ↔ renderer protocol uses numeric IDs (`rpcId`) to route
messages to the correct service (LanguageFeatures, OutputService, Configuration,
etc.).  These IDs are **not negotiated at runtime** — they are determined by
**declaration order** of `createProxyIdentifier()` calls in a single file:

```
src/vs/workbench/api/common/extHost.protocol.ts
```

`ProxyIdentifier` has a static counter (`ProxyIdentifier.count`) that starts at 0
and auto-increments with each call.  All ~150 identifiers (both `MainContext.*`
and `ExtHostContext.*`) share the same counter, so the nid is simply the 1-based
position in the file.

**There are no other files that call `createProxyIdentifier()`** — the mapping
is fully contained in `extHost.protocol.ts`.

### How the real front end resolves them

Both sides (renderer and extension host) import the same `MainContext` /
`ExtHostContext` objects from `extHost.protocol.ts`.  When either side calls
`getProxy(identifier)`, it reads `identifier.nid` and uses that as the `rpcId`
for all `_remoteCall()` invocations:

```typescript
// rpcProtocol.ts:243
public getProxy<T>(identifier: ProxyIdentifier<T>): Proxied<T> {
    const { nid: rpcId, sid } = identifier;
    if (!this._proxies[rpcId]) {
        this._proxies[rpcId] = this._createProxy(rpcId, sid);
    }
    return this._proxies[rpcId];
}
```

Because both sides import the same module, the nids always agree.  There is no
handshake or discovery step.

### How TE2 handles them — `rpc-config.json` auto-discovery

The workbench adapter (`workbench_client.mjs`) replaces the real renderer.
Since it doesn't import `extHost.protocol.ts`, the rpcIds are resolved via a
**cached config file** (`te2_rpc_config.json`) that is auto-generated by
grepping the installed code-server bundle.

**The 13 rpcIds the adapter uses** (out of ~150 total):

| nid  | `ProxyIdentifier` name         | TE2 usage |
|------|--------------------------------|-----------|
| 29   | `MainThreadOutputService`      | Reply to `$register` with synthetic channel ID (unblocks clangd) |
| 80   | `ExtHostConfiguration`         | `$initializeConfiguration`, `$acceptConfigurationChanged` |
| 84   | `ExtHostDocumentsAndEditors`   | `$acceptDocumentsAndEditorsDelta` |
| 85   | `ExtHostDocuments`             | `$acceptModelChanged`, `$acceptDirtyStateChanged` |
| 88   | `ExtHostEditors`               | `$acceptEditorDiffInformation`, `$acceptEditorPropertiesChanged`, `$acceptEditorPositionData` |
| 91   | `ExtHostFileSystemInfo`        | `$acceptProviderInfos` |
| 93   | `ExtHostLanguages`             | `$acceptLanguageIds` |
| 94   | `ExtHostLanguageFeatures`      | `$setWordDefinitions`, `$acceptInlineCompletionsUnificationState` |
| 97   | `ExtHostStatusBar`             | `$acceptStaticEntries` |
| 99   | `ExtHostExtensionService`      | `$activateByEvent` |
| 106  | `ExtHostWorkspace`             | `$initializeWorkspace`, `$onDidGrantWorkspaceTrust` |
| 113  | `ExtHostEditorTabs`            | `$acceptEditorTabModel`, `$acceptTabOperation` |
| 122  | `ExtHostOutputService`         | `$setVisibleChannel` |

### Auto-discovery pipeline

The nid extraction is **version-gated** and runs automatically at boot:

1. **Python helper** (`extension_registry.py: ensure_rpc_config()`) runs before
   the adapter launches (called from `workbench_adapter_shell_manager.py`).

2. **Version check** — runs `code-server --version`, compares against the cached
   `te2_rpc_config.json`.  If version + commit match → cache hit, skip.

3. **Block-scoped extraction** — if regeneration is needed, reads the installed
   minified bundle (`extensionHostProcess.js`) and:
   - Isolates the single `var Q={MainThread...:N("MainThread..."),...};` block
   - Discovers the minified `createProxyIdentifier` function name dynamically
     (it's `N` in the current build but could change across bundler versions)
   - Extracts **property keys** (not string arguments — there are 9 known
     key≠string mismatches in VS Code's source) with positional nids

4. **Validation** — aborts and keeps stale config if entry count is outside
   100–300 range or any of the 13 required names are missing.

5. **Writes** `~/.config/code-server/te2_rpc_config.json` with all ~150 nids.

6. **Adapter loads** the config synchronously at startup into `_rpcIds`.
   All `_sendExt()` calls use named lookups (`_rpcIds.ExtHostConfiguration`
   instead of literal `80`).  If the config file is missing, hardcoded
   defaults remain as fallback.

### Logging

- Python side: `[rpc-config] wrote 150 nids → ...` or `[rpc-config] cache hit — 150 nids ...`
- Adapter side: `[rpc-config] source: rpc-config.json (code-server 4.109.2, 13/13 applied)`
  or `[rpc-config] source: hardcoded-defaults` (logged during `connect()`)

### Grep pattern details

The minified bundle contains a single object literal with all proxy declarations:
```
var Q={MainThreadAuthentication:N("MainThreadAuthentication"),MainThreadBulkEdits:N("MainThreadBulkEdits"),...};
```

String identifiers survive minification (they're runtime values, not type annotations).
The block-scoped approach (extract the `var X={MainThread...` block first, then
parse within it) avoids false hits elsewhere in the 1.7MB file (e.g., `tN("module")`
where `N(` is a substring of a different function name).

### Key files

| File | Role |
|------|------|
| `extHost.protocol.ts` (code-server) | Single source of all `createProxyIdentifier()` calls |
| `proxyIdentifier.ts` (code-server) | `ProxyIdentifier` class with static counter |
| `rpcProtocol.ts` (code-server) | `getProxy()` / `_remoteCall()` — wires nid to RPC |
| `workbench_client.mjs` (TE2) | Named `_rpcIds` lookups, config loader, hardcoded fallback defaults |
| `extension_registry.py` (TE2) | `ensure_rpc_config()` — version-gated extraction and caching |
| `workbench_adapter_shell_manager.py` (TE2) | Calls `ensure_rpc_config()` before adapter launch |
| `~/.config/code-server/te2_rpc_config.json` | Cached nid map (auto-generated, version-gated) |

## 31) Adapter Auto-Restart & Status Indicator

### Problem

When extensions are installed, uninstalled, toggled, or reconfigured, the workbench adapter (and sometimes code-server) must be restarted for changes to take effect. Previously this required a full page reload. There was also no persistent visual indicator showing whether the adapter was connected.

### Solution: auto-restart pipeline

Extension operations trigger automatic shell termination and iframe reload:

| Operation | Shells killed | Handler |
|-----------|--------------|---------|
| Install / Uninstall | code-server + adapter | `_restart_code_server_and_adapter()` |
| Toggle / Configure / Custom Settings | adapter only | `_restart_adapter_only()` |
| Manual restart (UI menu) | adapter only | `handle_ext_restart_adapter()` |

### Restart flow

1. **Backend**: extension handler (e.g. `handle_ext_configure`) calls `_restart_adapter_only()`
2. **Backend**: `terminate_adapter_shell()` kills the Node process, clears pipe/reader/RPC state, cancels pending futures
3. **Backend**: emits `ext:adapter_restarting` to frontend via explorer WS
4. **Frontend**: save handler calls `_reloadEditorIframe()` which:
   - Resets `window.__adapterConnected = false`
   - Sets spinner to busy state
   - Reloads the iframe after 1.5 s delay (let shell terminate)
   - Re-invokes `ensureWorkbenchAdapterReady()` after 2 s (let iframe connect)
5. **Iframe**: loads → emits `editor_readiness_check` → backend launches new adapter → baton completes → spinner goes green

The `ext:adapter_restarting` event handler in `connectExplorerSocket()` is a safety-net backup. The primary reload is triggered directly by the save/install handlers. The event handler uses `typeof` guards because those functions are defined later in main.js (not hoisted).

### 3-state status indicator

The spinner element (`#fe-lsp-spinner`) is always visible with three CSS states:

| State | CSS class | Visual | Meaning |
|-------|-----------|--------|---------|
| busy | `fe-lsp-status--busy` | Animated spinner | Adapter starting or diagnostics running |
| ok | `fe-lsp-status--ok` | Green check (✓) | Adapter connected |
| error | `fe-lsp-status--error` | Red X (✗) | Adapter not connected |

State is managed by `_feUpdateLspSpinner()` which reads:
- `window.__feLspSpinnerUi.busyShow` — true while an activity is in progress
- `window.__adapterConnected` — set to true by `_spinnerHide()` after baton completes

### Adapter context menu

Long-press (touch) or right-click (desktop) on the status indicator opens a dropdown (`#fe-adapter-dd`) with:
- **Reload Extension Adapter** — sends `ext:restart_adapter` to backend, triggers full restart flow

Uses the `fe-menubar` dropdown pattern (not native browser menus).

### Shell termination helpers

- `terminate_adapter_shell()` in `workbench_adapter_shell_manager.py`: kills adapter process, clears `_adapter_pipe`, `_pipe_reader_task`, `_rpc_pending` futures, resets `_adapter_ready`
- `terminate_code_server_shell()` in `code_server_shell_manager.py`: kills code-server process, resets `_code_server_ready` event

Both use the framework-shells `terminate` endpoint to kill the underlying shell.

### Key files

| File | Role |
|------|------|
| `workbench_adapter_shell_manager.py` | `terminate_adapter_shell()` — adapter teardown |
| `code_server_shell_manager.py` | `terminate_code_server_shell()` — code-server teardown |
| `explorer_ws.py` | `_restart_adapter_only()`, `_restart_code_server_and_adapter()`, restart handlers |
| `template.html` | 3-state CSS classes, `#fe-adapter-dd` dropdown, spinner default class |
| `main.js` | `_reloadEditorIframe()`, `_feUpdateLspSpinner()`, adapter dropdown, event handlers |

## 32) Touch Selection Extension (`monaco-touch-selection`)

Mobile touch handling (teardrops, selection handles, context menu) is provided by
a **vendored, patched fork** of the
[monaco-touch-selection](https://github.com/nicepkg/monaco-collection) library
(upstream v1.1.1 by _potmot_).  The fork lives in a local worktree, is built from
TypeScript source, and the UMD output is deployed into the editor's static vendor
directory.

### Overview

The extension hooks into a Monaco `ICodeEditor` and adds:

- **Teardrop cursor indicator** — a draggable handle below the cursor.
- **Selection handle bars** — left/right draggable handles around a selection range.
- **Touch context menu** — a floating toolbar with clipboard, selection, hover, and undo/redo tools.
- **Drag-to-reveal** — while dragging a handle, the editor auto-scrolls to keep the cursor visible.
- **Touch offset** — during drag, the target position is shifted up by 1.5 line-heights so the user's finger doesn't occlude the text.

### TE2-specific patches (on top of upstream)

| Patch | What it does |
|-------|-------------|
| **Dynamic `EditorOption` lookup** | Resolves `fontSize` / `lineHeight` enum IDs at call-time via `globalThis.monaco`, not at UMD-load-time (avoids wrong fallback values in TE2's Monaco build) |
| **`bottomCursor` positioning fix** | Uses `top` + `marginTop` instead of `bottom` so the teardrop renders at the correct vertical offset |
| **Config-change listener** | Re-reads `fontSize` / `lineHeight` on `editor.onDidChangeConfiguration` so teardrop position updates after settings changes |
| **Touch offset correction** | During drag, targets `clientY + touchOffsetY - lineHeight * 1.5` for finger clearance |
| **Drag debounce** | `setInterval` for cursor tracking only starts on the first `touchmove`, not `touchstart` — so taps on the teardrop open the menu instead of repositioning the cursor |
| **Select Word tool** | Built-in tool that selects the word at the cursor position |
| **Hover tool** | Built-in tool (🚁) that closes the menu and triggers `editor.action.showHover` at the cursor |

> **Critical timing note**: `EditorOption` enum lookup **must** happen inside
> `editorTouchSelectionHelp()` at call-time, not at module/UMD-load-time.
> `globalThis.monaco` is not yet available when the UMD script is first evaluated.
> Placing the lookup at module scope causes fallback values (52/67) to be used,
> which breaks teardrop positioning.

### Build process

```bash
# 1. Source lives in the local worktree
cd worktrees/monaco-touch-selection/

# 2. Compile TypeScript
npx tsc

# 3. Build UMD bundle with Vite
npx vite build
#    → dist/index.umd.cjs   (deployed file)
#    → dist/index.js         (ESM, not used)

# 4. Back up the existing vendored file
cp app/apps/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js \
   app/apps/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js.bak

# 5. Deploy
cp dist/index.umd.cjs \
   app/apps/file_editor_cm6/static/vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js
```

The CSS file (`monaco-touch-selection.css`) is **manually patched** in the vendor
directory (larger touch targets, bigger menu, `::before` pseudo-elements for hit area).
It is NOT built from source — do not overwrite it during deploy.

### Gesture reference

| Gesture | Target | Action |
|---------|--------|--------|
| **Tap** | Editor surface | Set cursor position |
| **Double-tap** | Editor surface | Select word at tap position |
| **Tap** | Teardrop (cursor handle) | Open touch context menu |
| **Drag** | Teardrop (cursor handle) | Reposition cursor (with 1.5-line vertical offset for finger clearance) |
| **Drag** | Selection handle bar | Adjust selection range boundary |
| **Tap** | Line number gutter | Select entire line above the tapped line |
| **Tap then drag** | Line number gutter | Change line range selection |

### Touch menu tools

Tools appear in the context menu in the order listed below.

| # | Tool | Icon | Action | Menu after |
|---|------|------|--------|------------|
| 1 | **Copy** | 📋 (clipboard SVG) | Copy selection to clipboard | Stays open |
| 2 | **Cut** | ✂️ (scissors SVG) | Cut selection to clipboard | Stays open |
| 3 | **Paste** | 📥 (paste SVG) | Paste from clipboard at cursor | Stays open |
| 4 | **Undo** | ↩ (undo SVG) | Undo last edit | Stays open |
| 5 | **Redo** | ↪ (redo SVG) | Redo last edit | Stays open |
| 6 | **Select Word** | ⬚ (dashed box SVG) | Select the word at cursor position | Stays open |
| 7 | **Select All** | ↔ (expand arrows SVG) | Select all text in editor | Stays open |
| 8 | **Hover** | 🚁 (helicopter emoji) | Close menu, show hover info at cursor position | Closes |
| 9 | **Close** | ✕ (X SVG) | Dismiss the touch menu | Closes |

### Initialization

The extension is loaded in `m_editor_app.js` as a UMD global:

```js
// Called after editor DOM is ready (and on re-init after language switches)
window['monaco-touch-selection'].editorTouchSelectionHelp(editor);
```

No options object is passed — all tools (including Hover) are built into the
extension source.  The `tools` callback is available for external consumers who
need to add custom tools, but TE2 does not use it.

### Key files

| File | Role |
|------|------|
| `worktrees/monaco-touch-selection/src/index.ts` | TypeScript source — all patches, tools, and logic |
| `worktrees/monaco-touch-selection/dist/index.umd.cjs` | Build output (UMD) |
| `app/.../vendor/monaco-touch-selection/monaco-touch-selection.patched.umd.js` | Deployed vendored UMD (copy of build output) |
| `app/.../vendor/monaco-touch-selection/monaco-touch-selection.css` | Manually patched CSS (do NOT overwrite) |
| `app/.../monaco_editor/m_editor_app.js` | Initialization call (`editorTouchSelectionHelp(editor)`) |
