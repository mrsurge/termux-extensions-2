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
- C++: `ms-vscode.cpptools` — pending.
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
  └─ Editor transport service (WS proxy)  : /editor_ws/socket.io  → worker

App worker process (app/apps/file_editor_cm6/main.py)
  ├─ HTTP routes: /api/app/file_editor_cm6/*
  ├─ NiceGUI still mounted for legacy editor API endpoints (/editor/*)
  ├─ Monaco iframe routes under /ui/*
  ├─ Worker Socket.IO: /editor_ws/socket.io (EDITOR_ASGI_APP)
  ├─ Worker Socket.IO: /explorer_ws/socket.io (EXPLORER_ASGI_APP)
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

Spinner ownership (host UI):
- The host UI uses a single spinner element (`#fe-lsp-spinner`) for multiple async flows.
- To avoid competing writers, the spinner has an explicit "activity owner" (`window.__feLspSpinnerUi.busyActivity`):
  - `workbench_adapter`: `ensureWorkbenchAdapterReady()` owns the spinner while starting/polling the adapter.
  - `diagnostics`: the diagnostics baton owns the spinner while waiting for per-file analysis.
- `ensureWorkbenchAdapterReady()` must not overwrite the spinner title while `busyActivity === 'diagnostics'`.

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
- Produced by: `gulp editor-distro` inside `worktrees/vscode-te2-diff`

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

## 13) Known issue (next investigation): Git diff + drafts “thrash” / assertion

When Git diff mode is enabled and drafts are updating, we can hit a diff-projection assertion:

```
errors.ts:26 Uncaught Error: Assertion Failed

Error: Assertion Failed
    at assertFn (assert.ts:72:21)
    at lineRangeMappingFromRangeMappings (rangeMapping.ts:301:2)
    at applyModifiedEditsToLineRangeMappings (diffEditorViewModel.ts:781:10)
    at applyModifiedEdits (diffEditorViewModel.ts:737:12)
    at diffEditorViewModel.ts:228:20
    at UniqueContainer.value (textModel.ts:206:79)
    at Emitter._deliver (event.ts:1187:13)
    at Emitter._deliverQueue (event.ts:1198:9)
    at Emitter.fire (event.ts:1222:9)
    at DidChangeContentEmitter.endDeferredEmit (textModel.ts:2598:23)
```

This is currently the primary “thrash” issue to tackle.

### Mitigation (TE2 pinned baseline)
When using the pinned-baseline diff mode (`modifiedBaseline`), TE2 can freeze projection updates so
typing/draft edits do not cause the diff engine to re-project on every keystroke.

This is enabled by passing:
- `te2FreezeProjection: true`

in the `diffEditor.setModel({ ... })` payload from `m_editor_app.js`.

Note: this flag is implemented in the VS Code fork (`worktrees/vscode-te2-diff`) and requires a rebuild
to take effect in the served Monaco bundle.

### Debugger note
If your browser keeps pausing on this, DevTools likely has “Pause on exceptions” enabled; disable it while iterating so the UI remains usable.

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
- Keepalive/ack handling is stable enough for iterative feature validation.

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
- `$initializeExtensionStorage` → `ReplyOkJson({})` (empty storage object; `undefined` causes silent activation failure)
- `$getTools` → `ReplyOkJson([])` (empty tools array)
- `$getInitialState` → `ReplyOkJson({ isFocused: true, isActive: true })`
- `$checkExists` → `ReplyOkJson(false)`
- `$requestWorkspaceTrust` → `ReplyOkJson(true)` (followed by `$onDidGrantWorkspaceTrust`)

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
3. C++ (candidate extension under test) - pending
   - target checks: provider registration, document symbols, hover, diagnostics
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
- The adapter tracks per-document `versionId` (monotonically increasing, reset to 1 on `openFile`) and previous line/char counts for correct range replacement
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
