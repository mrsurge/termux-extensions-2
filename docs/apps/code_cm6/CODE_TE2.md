# CODE_TE2 (Monaco Iframe Editor) — End‑to‑End Reference

This document describes the **current** Monaco editor surface used by `file_editor_cm6` inside TE2:

- **Monaco runs inside an iframe** served by the **app worker** (FastAPI).
- The editor is controlled via a **dedicated Socket.IO channel** proxied by the **main framework**.
- Document content, drafts, and preferences are governed by SSOT (`_history_store` / project sidecar, `_preferences_store`).

This is intentionally written as a “wiring + protocol” reference: what runs where, what calls what, and what payloads exist.

---

## 0) High‑level map

```
Browser host shell (file_editor_cm6/template.html + main.js)
  ├─ Explorer drawer (separate Socket.IO transport; main process service)
  ├─ Terminal drawer (PTY plumbing; separate)
  └─ Editor iframe <iframe src="/api/app/file_editor_cm6/ui/nc?...">
        ├─ FastHTML harness: m_editor_app.py
        ├─ Monaco runtime:  m_editor_app.js
        ├─ Monaco assets:   /api/app/file_editor_cm6/ui/monaco_vscode/esm/...
        └─ Touch selection: /api/app/file_editor_cm6/static/vendor/monaco-touch-selection/...

Main framework process (app/main.py)
  ├─ Proxies /app/file_editor_cm6 → worker port
  ├─ Loads app services declared in manifest.json
  ├─ Explorer transport service (Socket.IO)  : /explorer_ws/socket.io
  ├─ LSP transport service (Socket.IO)       : /lsp_ws/socket.io
  └─ Editor transport service (WS proxy only): /editor_ws/socket.io  → worker

App worker process (app/apps/file_editor_cm6/main.py)
  ├─ HTTP routes: /api/app/file_editor_cm6/*
  ├─ NiceGUI still mounted for legacy editor API endpoints (/editor/*)
  ├─ Monaco iframe routes under /ui/*
  ├─ Worker‑owned Socket.IO server mounted at /editor_ws/socket.io (ASGI subapp)
  └─ SSOT stores: _history_store (project sidecar), _preferences_store
```

---

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

### Editor transport proxy (main process)
- `app/apps/file_editor_cm6/services/editor_transport.py`
  - **Main‑process shim only**: proxies websocket frames to the app worker port
  - Must not touch SSOT

### Host shell (browser, worker‑served)
- `app/apps/file_editor_cm6/template.html`
  - Layout + iframe placement
- `app/apps/file_editor_cm6/main.js`
  - Toolbar/menu logic, explorer integration, session state UI
  - Calls backend editor API endpoints (preferences, check_cache, etc.)
  - Emits `editor_open_request` and `editor_save_request` over editor Socket.IO

### SSOT and persistence
- `app/apps/file_editor_cm6/stores.py`
  - Singleton store instances: `_history_store`, `_preferences_store`
- `app/apps/file_editor_cm6/project_sidecar.py`
  - Disk‑backed “session_cache” (draft cache entries)
- `app/apps/file_editor_cm6/preferences_store.py`
  - Disk‑backed preferences (editor settings)

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
Drafts are stored in project sidecar “session_cache” entries:
- key = absolute file path
- content = entire draft text (current buffer)
- metadata includes:
  - `base_sha256` (disk baseline hash when draft started)
  - `content_sha256` (draft content hash)
  - `unsaved` (True/False)
  - runtime identifiers (run_id, etc.)

The editor Socket.IO server (`editor_ws.py`) is the worker‑side entry point for persisting drafts from the iframe.

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

---

## 11) Monaco language bundles + workers (recent learnings)

### Invariants (must hold)
- **Syntax highlighting must work** (non-plaintext languages set correctly).
- **Syntax checking + autocomplete must work** (Monaco language services).
- These are considered **hard invariants** for the Monaco iframe.

### What broke (symptoms)
- Language registry returned only `['plaintext']`.
- Model language stayed `plaintext` even for `.py`/`.js`.
- Console showed:
  - `Failed to load language bundles`
  - `Import Map ... monaco-editor-core ... blocked by a null value`
  - `Failed to load .../basic-languages/monaco.contribution.js (404)`

### Root cause
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

---

## 7) Monaco asset pipeline (pinned VS Code build)

The Monaco iframe uses the pinned VS Code `monaco-editor-core` ESM output:
- mounted at `/api/app/file_editor_cm6/ui/monaco_vscode/esm/...`

The harness also serves a TE2 language bundle directory:
- `/api/app/file_editor_cm6/ui/monaco_vscode/lang/...`

Because the VS Code Monaco ESM imports CSS files, the harness serves `.css` as:
- `Content-Type: application/javascript` module shim (injects `<link>` to `?raw=1`)
- raw CSS is available when `?raw=1` is present

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
- theme (mapped to `vs` / `vs-dark`)

### Diff mode behavior
- Git diff mode uses Monaco DiffEditor in inline mode (not side-by-side).
- Draft diff mode is a custom overlay (decorations + view zones).
- Minimap is forced off in diff mode to avoid layout artifacts.

---

## 9) Debugging checklist (what to verify first)

### 1) Transport is correct (no reconnect loops)
- Confirm the main process proxy is active: `app/apps/file_editor_cm6/services/editor_transport.py`
- Confirm the worker subapp mount exists: `SUBAPPS = [("/editor_ws/socket.io", EDITOR_ASGI_APP)]`
- Socket.IO client must connect to:
  - namespace `/editor`
  - path `/editor_ws/socket.io`

### 2) SSOT is present
- `GET /api/app/file_editor_cm6/state` returns:
  - `activeProject`, `preferences`, `lastFile`, etc.

### 3) Open path convergence
- `editor_open_request` should lead to `editor:open` for all connected clients.

### 4) Draft persistence
- `editor_mirror` should produce a cached draft entry (project sidecar).
- `editor_save_request` should clear the draft and write disk.

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
