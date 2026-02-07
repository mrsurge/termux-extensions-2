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

### Current milestone (read-only language intelligence)
Status: implemented and working for the deterministic read-only subset:
- `code-server` runs as a framework shell on fixed port `127.0.0.1:18180` with `--disable-workspace-trust`.
- Node workbench adapter runs as a framework shell on fixed port `127.0.0.1:18181`.
- `vscode_api` is a WS JSON-RPC server that bridges Monaco requests to the adapter and forwards diagnostics events.
- Working end-to-end (over `vscode_api_ws`): `vscode.openFile`, `vscode.documentSymbols`, `vscode.hover`.

Known limitation (expected right now):
- “Live typing” diagnostics will not be fully correct until we add a `didChange` sync path. Today, the sidecar becomes accurate at `openFile` time (and can be extended to update on save).

### Extension validation matrix (next milestone)
We will validate at least 2 deterministic features (hover + symbols + diagnostics) per language:
- Python: `ms-pyright` (baseline), optionally compare against `ms-python.python` / Pylance variants later.
- C++: `ms-vscode.cpptools`.
- Rust: `rust-lang.rust-analyzer`.
- Control: TypeScript/JavaScript (VS Code ships a built-in TS/JS language service as part of the OSS workbench/extensions set).

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

Framework shells (service processes owned by the framework_shells orchestrator)
  ├─ code-server: real VS Code-compatible backend + remote extension host
  ├─ workbench adapter (Node): initiates remote-agent WS connection; decodes/encodes workbench protocol
  └─ vscode_api (Node): browser-facing JSON-RPC bridge (Monaco → adapter), plus event fanout (diagnostics)
```

---

## 0.5) Framework Shells (Transport vs Execution)

Terminology used in TE2:
- A **framework shell** is a long-lived subprocess managed by `framework_shells` (start/adopt/terminate + readiness).
- **Transport level** is “how bytes move” (Socket.IO/WS/HTTP proxies). It must stay proxy-only.
- **Execution level** is “who runs logic/state” (worker SSOT, extension host, adapter decode/encode).

For `file_editor_cm6`, we intentionally separate responsibilities:
- **Editor SSOT transport (existing)**: `/editor_ws/socket.io` (main process proxies to worker).
- **Language sidecar transport (new)**: `/vscode_api_ws` (main process proxies to `vscode_api` shell).
- **Execution**:
  - Worker owns drafts/saves/versioning (`HistoryStore`/sidecar).
  - `code-server` owns extension execution (remote extension host).
  - Node workbench adapter owns the remote-agent WS session and workbench protocol encoding/decoding.

Deterministic ports (current):
- `code-server`: `127.0.0.1:18180` (framework shell)
  - `--user-data-dir ~/.config/code-server`
  - `--extensions-dir ~/.config/code-server/extensions`
  - `--disable-workspace-trust`
- workbench adapter: `127.0.0.1:18181` (framework shell)

Discovery endpoints (worker, proxied via main process):
- `GET /api/app/file_editor_cm6/code_server/discover`
- `GET /api/app/file_editor_cm6/workbench_adapter/discover`
- `GET /api/app/file_editor_cm6/vscode_api/discover`

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
- Confirm the main process proxy is active: `app/apps/file_editor_cm6/services/editor_transport.py`
- Confirm the worker subapp mount exists: `SUBAPPS = [("/editor_ws/socket.io", EDITOR_ASGI_APP)]`
- Socket.IO client must connect to:
  - namespace `/editor`
  - path `/editor_ws/socket.io`

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

### 4) Draft persistence
- `editor_mirror` should produce a cached draft entry (project sidecar).
- `editor_save_request` should clear the draft and write disk.
- On save, the server broadcasts `editor:cache_state` with `unsaved:false`; the iframe must then refresh git baselines so the inline git diff view updates.

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

## 14) Planned: `vscode_rpc` service contract (TE2 “services” + Framework Shell)

This section documents the **target contract** for integrating a VS Code-style server protocol into TE2, without mixing SSOT logic into the host process.

### Goal
- Run a VS Code-derived JSON-RPC server **server-side** (a “framework shell” process).
- Expose exactly **one** WebSocket endpoint to the browser (same-origin via TE2 proxy).
- Keep TE2 main process as **proxy-only**: it should not mutate `file_editor_cm6` SSOT (`_history_store` / `_preference_store`) or interpret RPC payloads.
- Model this like existing TE2 “services” (see `app/apps/file_editor_cm6/services/README.md`): the service exists to bridge transports, not own app state.

### Pieces
- **Framework shell runtime**: `framework_shells` (see `/data/data/com.termux/files/home/downloads/agent_log_server/fws_README.md`)
  - Responsible for starting/stopping the RPC server process and capturing logs.
- **Service shim (TE2 host)**: a **single** WS proxy route that forwards frames to the shell’s WS.
- **Discovery endpoint (worker or host)**: returns the browser-facing WS URL + metadata (and token if needed).

### Discovery endpoint (browser-facing)
Proposed shape (exact mount TBD; keep under `file_editor_cm6`):

`GET /api/app/file_editor_cm6/vscode_rpc/discover`

Response:
```json
{
  "ok": true,
  "data": {
    "project_root": "/abs/path/to/project",
    "ws_url": "/ws/app/file_editor_cm6/vscode_rpc?token=...",
    "token": "...",
    "expires_at": 1760000000
  }
}
```

Notes:
- `ws_url` should be a **same-origin** URL the browser can connect to (TE2 host will proxy it).
- `token` is optional in dev mode; when present, it is **opaque** to the browser and validated only by the proxy/shim.
- `project_root` is the SSOT “current project” root as seen by the worker.

### WebSocket proxy endpoint (TE2 host, proxy-only)
Proposed:

`WS /ws/app/file_editor_cm6/vscode_rpc?token=...`

Contract:
- Accepts a browser WS connection.
- Opens a WS connection to the framework shell’s RPC server (local-only).
- Forwards **all frames verbatim** both directions.
- Does not parse/transform payloads.

Error handling:
- If the worker/shell isn’t running: return `503 Service Unavailable`.
- If token is invalid/expired: return `401/403` (consistent with TE2 auth conventions).
- If the upstream WS closes unexpectedly: close the downstream WS with a reason and let the browser reconnect.

### RPC payload framing
Baseline: JSON-RPC 2.0 messages over WS, treated as opaque payloads by TE2.

Non-negotiable invariant:
- The RPC connection must support **bidirectional** messaging and must not depend on HTTP POST “command” endpoints.

### Process lifecycle (shellspec-first)
The RPC server process should be started via a shellspec (recommended) and managed by `framework_shells`:
- A `shellspec/*.yaml` defines how to start the process (cwd, env, args, port).
- The system can adopt/reuse the shell if already running under the same repo fingerprint/runtime secret.

### Security notes
- Prefer short-lived tokens for WS discovery (rotated per UI session).
- The token should not grant access outside the current repo fingerprint / runtime namespace.

### Why we need this (ties back to Monaco vs “VS Code semantics”)
Monaco’s built-in tokenization is often too coarse to replicate VS Code’s “GitHub Dark Default” semantic coloring (function names/imports/args, etc.) without the broader VS Code service layer (semantic tokens, richer language pipelines).

`vscode_rpc` is the planned bridge to bring those semantics back while staying compatible with TE2’s proxy/service architecture.

### Current status (scaffolding)
The following pieces exist now (v0, minimal):
- Worker discovery: `GET /api/app/file_editor_cm6/vscode_rpc/discover`
  - ensures the framework shell is running
  - returns `ws_url` like `/vscode_rpc_ws?shell_id=<shell_id>`
- Host WS shim (service): `WS /vscode_rpc_ws?shell_id=<shell_id>`
  - proxy-only, forwards frames verbatim to the shell’s WS
- Shellspec: `app/apps/file_editor_cm6/shellspec/vscode_rpc.yaml#vscode-rpc`
- Server entrypoint: `worktrees/vscode-te2-diff/te2/vscode_rpc_server.mjs`
  - currently supports `rpc.ping` + a minimal `initialize`

### Shell grouping / FWS kill semantics
The `vscode_rpc` shellspec mirrors the Android LSP shellspec subgroup pattern so that:
- The shell appears under the `file_editor_cm6` group in the FWS dashboard.
- TE2 process-manager “kill app” operations include the rpc shell.

Specifically, `app/apps/file_editor_cm6/shellspec/vscode_rpc.yaml` includes:
- `${ctx:APP_ID}` (e.g. `file_editor_cm6`)
- `vscode_rpc`
- `project:${ctx:PROJECT_HASH}`

---

## 15) In-progress: `vscode_api` harness (extension host + VSIX pipeline)

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

Language providers (POC stage):
- `vscode_api` also hosts a minimal **stdio LSP bridge** (diagnostics-first) over the same `vscode_api_ws` IPC:
  - Client → `vscode_api` JSON-RPC notifications:
    - `vscode.lsp.didOpen` `{uri, languageId, version, text}`
    - `vscode.lsp.didChange` `{uri, languageId, version, contentChanges:[{range,text}]}`
    - `vscode.lsp.didClose` `{uri, languageId}`
  - Client (request): `vscode.lsp.languages` → `{languages:[...]}`
    - Used by the iframe to decide which `languageId`s should emit LSP traffic.
  - Server spawns **one stdio LSP process per configured server key** and broadcasts raw notifications
    (notably `textDocument/publishDiagnostics`) to all connected clients.
  - Monaco iframe consumes `textDocument/publishDiagnostics` and applies markers via:
    `monaco.editor.setModelMarkers(..., 'vscode_api', markers)`

LSP server mapping (POC contract):
- The bridge is driven by a json mapping file:
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

## 12) Workbench protocol proxy plan (code-server “black box”)

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

### Headless workbench adapter (Node, in-progress)
There is an in-repo headless “workbench-ish” client intended to replace “open a hidden iframe” for bootstrapping:
- Server: `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/server.mjs`
  - Exposes HTTP JSON-RPC (dev-only ergonomics) for driving the adapter: `adapter.connect`, `vscode.openFile`, `vscode.documentSymbols`, `vscode.hover`, etc.
- Client core: `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/workbench_client.mjs`
  - Uses VS Code OSS remote agent connection/runtime code (`remoteAgentConnection`, `browserSocketFactory`, IPC runtime) to connect in **remote mode**
  - Sends the ExtensionHost init JSON over the ExtHost websocket
  - Sends the minimal editor/document delta events required to “open” a file (`$acceptDocumentsAndEditorsDelta`, tab model, editor properties, dirty state)
  - Learns provider handles by observing `$register*Provider` frames (when present)

Current status (facts observed in adapter runs):
- Adapter can establish remote-mode mgmt+ext connections and keep them alive.
- `vscode.openFile`, `vscode.documentSymbols`, and `vscode.hover` are wired end-to-end through the adapter server.
- Python provider flow is validated with `ms-pyright.pyright` in the current dev setup:
  - provider registration observed
  - symbols and hover requests return results via the proxy/adapter surface
- Keepalive/ack handling is stable enough for iterative feature validation, but bootstrap parity work remains for broader extension compatibility.

### Extension validation milestones (current track)
Goal: verify deterministic language-feature parity (open file -> symbols/hover/diagnostics) across popular ecosystems before broadening scope.

Execution reference:
- `docs/apps/code_cm6/MONACO_WORKBENCH_SPRINT_PLAN.md`
- `docs/apps/code_cm6/README.md` (Roadmap Update section)
- `docs/apps/code_cm6/VSCODE_API_CONTRACT.md`
- `docs/apps/code_cm6/VSCODE_API_STATE_OWNERSHIP.md`
- `docs/apps/code_cm6/VSCODE_API_DEPRECATIONS.md`

1. Python (`ms-pyright.pyright`) - in progress / partially validated
   - validated: open file, document symbols, hover
   - pending: sustained diagnostics/completions stability under longer sessions
2. C++ (candidate extension under test) - pending
   - target checks: provider registration, document symbols, hover, diagnostics
3. Rust (candidate extension under test) - pending
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

### TE2 integration surface (target)
Expose a TE2-side channel (format is intentionally boring):
- A single WS endpoint (or long-poll) that emits normalized events:
  - `diagnostics/update { uri, owner, markers[] }`
  - `hover/result { uri, pos, hover }`
  - `completion/result { uri, pos, items[] }`
  - `symbols/result { uri, symbols[] }`

The UI (Monaco iframe) remains a thin renderer:
- It subscribes to TE2 events, updates Monaco markers/hover providers, and never runs an extension host itself.
