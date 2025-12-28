# Code CM6 — Issues Overlay (Technical Description, Current State)

**Last Updated:** 2025-12-27

This document describes how the **Issues Overlay** + **squiggle underlines** work right now in Code CM6 (NiceGUI iframe + CM6 LSP bridge), and what is still broken.

## TE2 / Code CM6 Overview (Brief)

### TE2 runtime model

- **Termux Extensions 2 (TE2)** is a multi-app framework that runs a single "framework" web server and spawns **per-app workers** as separate processes.
- The framework proxies `/app/<app_id>` traffic to the correct worker port and provides shared services (notably **Framework Shells** for running commands/PTYs).
- App workers are responsible for their own FastAPI routes, websockets, and any embedded UI frameworks.

### Code CM6 structure

- Code CM6's host UI (`app/apps/file_editor_cm6/template.html` + `app/apps/file_editor_cm6/main.js`) is the "chrome":
  - explorer drawer, terminal drawer, menus, toolbar, recents, etc.
- The actual editor surface is a **NiceGUI app embedded in an iframe** (`/api/app/file_editor_cm6/ui/nc`).
- Inside the iframe, CodeMirror 6 lives in a vendored NiceGUI element:
  - `app/static/vendor/nicegui/elements/codemirror/codemirror.js` (frontend component + CM6 extensions)
  - `app/static/vendor/nicegui/elements/codemirror/codemirror.py` (backend element wrapper / `run_method` bridge)
  - `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (NiceGUI page + server-driven hooks)

### LSP integration

- LSP servers run as **Framework Shells** (pipe-based processes) and are bridged via Socket.IO:
  - Browser ↔ Socket.IO `/lsp` ↔ `app/apps/file_editor_cm6/lsp_ws.py` ↔ Framework Shell pipes ↔ language server stdio.
- The host and iframe communicate via a simple postMessage bus to avoid introducing extra websockets.

## What The Feature Does

- Shows **issue counts** (errors/warnings) next to the filename in the host toolbar.
- Provides **Prev/Next** navigation buttons (host toolbar) that jump between issues.
- Shows an **LSP busy spinner** in the host toolbar when a backend task is running (notably **Android Gradle compile** for `kotlin-android`).
- Shows lightweight **toasts** for longer-running background tasks (start/end), so background work is visible on mobile.
- Renders an **Issues Overlay panel inside the iframe** with:
  - A "replica line" preview for the active issue line
  - 1..N issue rows under that line (severity + message + optional source/code)
  - Per-issue **dismiss** button (currently in-memory only)
- Renders **squiggle underlines in the editor text** driven by LSP diagnostics (custom decoration field, not @codemirror/lint).
- Supports **Export Diagnostics…** (Editor menu) which saves a JSON snapshot under `.code_cm6/diagnostics/` in the project root.

## Architecture / Data Flow

### 1) LSP diagnostics enter the iframe via the existing Socket.IO LSP bridge

- Each LSP server runs as a Framework Shell and is bridged to the browser via Socket.IO (`/lsp` namespace).
- The iframe component `app/static/vendor/nicegui/elements/codemirror/codemirror.js` subscribes to `lsp_server_to_client`.
- When it receives a JSON-RPC notification:
  - `method: "textDocument/publishDiagnostics"`
  - `params: { uri, diagnostics }`
  it forwards the payload into the Issues subsystem (no extra websocket/bus required).

Some servers (notably Kotlin) use **pull diagnostics** (`textDocument/diagnostic`) instead of push (`publishDiagnostics`). Code CM6 supports both.

### 2) Iframe Issues state model (per-URI)

Maintained in `codemirror.js` as an internal map keyed by document URI:

- `rawDiagnostics`: raw LSP diagnostics for the URI
- `filteredDiagnostics`: raw minus suppressed signatures (suppression is in-memory right now)
- `flat`: flattened, sorted list of "issue refs" used for navigation
- `counts`: `{ errors, warnings }`
- `activeIndex`: current selection in `flat`
- `suppressed`: `Set(sig)` (in-memory)

Severity bucketing policy (current):
- Error: LSP severity `1`
- Warning: severity `2`, `3`, `4` (info/hint currently treated as warning)

### 3) Squiggles: custom CM6 decoration field (diff-style pipeline)

We do **not** depend on `@codemirror/lint`'s `serverDiagnostics()` to render squiggles.
Instead, squiggles are rendered by a custom pipeline similar to the inline-diff decorations:

- A `StateEffect` carries the current diagnostics list.
- A `StateField` converts diagnostics → CM document positions → `Decoration.mark` ranges.
- The decorations are installed via `EditorView.decorations` and are mapped forward through edits.
- Styling is done via our own CSS classes:
  - `.cm-issuesRange-error`
  - `.cm-issuesRange-warning`

This makes squiggles independent from the lint panel/theme being present.

### 4) Overlay UI: iframe-owned (no host rendering)

The overlay is a DOM element attached to the editor surface and re-rendered from the iframe state:

- Header: title + position (N/total) + prev/next + close
- Line preview: `{lineNo} | <replica line with squiggle spans>`
- Items: one card per diagnostic on that line with a dismiss X

### 5) Host chrome wiring: existing postMessage bus

Host toolbar controls are in `app/apps/file_editor_cm6/template.html` and are wired in `app/apps/file_editor_cm6/main.js`.

Messaging uses the existing iframe message bus (`window.postMessage`):

- Host → iframe command:
  - `type: "issues_cmd"` with `{ action: "toggle" | "prev" | "next" | "dump" }`
- Iframe → host state:
  - `type: "cm6-issues-state"` with `{ errors, warnings, total, activeIndex, overlayVisible, uri }`

The host uses `cm6-issues-state` to:
- Update badges (red error count, yellow warning count)
- Enable/disable prev/next buttons depending on `total`

### 6) LSP Request Broker (NEW)

Added to prevent request flooding and handle coalescing:

- **Per-method debouncing**: `documentSymbol` (800ms), `hover` (150ms), `completion` (100ms)
- **Max-1-in-flight per method**: new requests supersede pending ones
- **Stale response detection**: nonce-based, prevents old responses from clobbering state
- **Instrumentation counters**: `requestsSent`, `requestsDropped`, `requestsCoalesced`, `responsesReceived`, `responsesStale`

### 7) Explicit didChange notifications (NEW)

The `@codemirror/lsp-client` library's auto-sync wasn't reliably sending `didChange`. We now explicitly send `textDocument/didChange` from the `changeSender` ViewPlugin:

- 150ms debounced after document changes
- Full document content (not incremental)
- Version counter tracked at component level (`_lspDocumentVersion`)

### 8) Diagnostics nudge on reconnect (NEW)

To handle the reload race condition (server already has file open, won't re-emit diagnostics):

- 500ms after `didOpen`, send a `didChange` with current content
- This triggers the server to re-emit `publishDiagnostics`

### 9) Per-LSP workspace root overrides (project-scoped)

Some projects contain nested “real” workspace roots (example: a Gradle project under `android/`). Code CM6 supports a per-server **Project root (relative)** override:

- UI: Language Servers modal input per server row
- Storage: project-scoped SSOT via `_history_store` / ProjectSidecar
- Connect behavior: backend passes an **effective projectRoot** (projectRoot + override) into `connect_lsp`
- Change behavior: changing a root while a server is running **shuts it down immediately**; it restarts on next supported file entry or manual Start

### 10) Export Diagnostics (JSON snapshot)

Code CM6 can export the current file’s diagnostics/Issues state to a JSON file (useful for sharing with agents and debugging LSP behavior):

- Host triggers export via **Editor → Export Diagnostics…**
- Host asks the iframe for a dump via `postMessage` (`issues_cmd: dump`)
- Iframe responds with `cm6-issues-dump` containing: raw/filtered diagnostics, flat list, counts, suppressed sigs, LSP stats
- Host uses the shared file picker (`window.teFilePicker.saveFile`) and writes the JSON using Code CM6’s existing `POST /write` endpoint
- Default save directory: `<projectRoot>/.code_cm6/diagnostics/`
  - If `.code_cm6/diagnostics` does not exist, the host prompts with a confirm dialog and creates it if approved
- Default filename: `<project-relative-path with '/' replaced by '.'>.json` (example: `app.main.py.json`)

### 11) Repo-local metadata (.code_cm6)

Code CM6 keeps repo-scoped metadata under a single dot directory at the repo root:

- `.code_cm6/diagnostics/` — default target for exported diagnostics JSON snapshots.
- `.code_cm6/lang/python/workers.json` — Python **App Worker Registry** (multi-root scan/LSP routing).

## Current Known Issues / Limitations

### ✅ FIXED
- ~~Issues do **not update during live edits** (typing)~~ — **FIXED**: Explicit `didChange` notifications now trigger diagnostics refresh
- ~~If the page is reloaded while an LSP is already running, the Issues feature **does not mount / reattach**~~ — **FIXED** (for TypeScript/JavaScript): Diagnostics nudge after `didOpen` triggers refresh
- ~~Android Gradle compile runs “silently” with no UI feedback~~ — **FIXED**: `kotlin-android` emits LSP work progress and the host toolbar shows a spinner + start/end toasts.

### ⏳ REMAINING
- Dismiss is **in-memory only** right now (not persisted to HistoryStore/ProjectSidecar yet).
- Exported diagnostics are a **snapshot**; they do not embed the full document text (yet).

## Relevant Files

- Iframe (CM6 + overlay + squiggles + LSP broker): `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- Host chrome + buttons + badges: `app/apps/file_editor_cm6/template.html`, `app/apps/file_editor_cm6/main.js`
- Backend LSP transport (Framework Shells pipe ↔ Socket.IO): `app/apps/file_editor_cm6/lsp_ws.py`
- LSP project-root overrides (project SSOT): `app/apps/file_editor_cm6/history_store.py`, `app/apps/file_editor_cm6/project_sidecar.py`, `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

## Debugging

### LSP Stats (console)
```javascript
// In iframe console:
cmComponent.getLspStats()
// Returns: { broker: {...}, didChangeExplicit, didChangeSentTotal, diagnosticsReceived, documentVersion }

cmComponent.resetLspStats()
```

### Console Logs
- `[LSP Stats] didChange → server: #N, v=V` — outgoing didChange notifications
- `[LSP Stats] publishDiagnostics received: #N, X issues` — incoming diagnostics
- `[LSP Broker] Sending METHOD (nonce=N)` — broker request dispatch

---

# Android LSP (kotlin-android) — Current Implementation Deep Dive

**Timestamp:** 2025-12-26T05:11:56.406Z

This section documents how the **Android Kotlin LSP** integration currently works in this repo (server + sidecars + diagnostics transport), *as implemented right now*.

## 0) Big picture
There are 3 cooperating layers:

1) **Editor buffer + draft SSOT** (NiceGUI iframe)
- The user edits in the iframe (CodeMirror 6).
- The NiceGUI backend debounces draft persistence into a **per-project sidecar** (session cache), which is the SSOT for drafts/crash recovery.

2) **LSP transport** (Socket.IO bridge)
- Browser/iframe talks to `/lsp` Socket.IO namespace.
- `app/apps/file_editor_cm6/lsp_ws.py` bridges Socket.IO messages to a language server running in a **Framework Shell** (stdio pipes).

3) **Android Kotlin LSP-specific state** (TE2 Android sidecar + config injection)
- `te2_android_sidecar.json` is maintained by TE2 code to provide the kotlin-android server with stable fingerprints and a dependency-model skeleton.
- On save/sync, TE2 injects `workspace/didChangeConfiguration` with `te2Android` settings to the kotlin-android server.

## 0.1) User-visible Android LSP controls (host UI)
The Language Servers modal exposes Android-specific controls:

- **Start/Stop + running state** for `kotlin-android` (same UX as other LSPs).
- **Variant selector** (custom JS dropdown; does not rely on native `<select>` behavior so it works in GeckoView).
- **Sync Project** button (forces the TE2 Android sidecar refresh + triggers server-side re-index behavior).

## 1) Where persistent state lives (two distinct sidecars)

### 1.1 ProjectSidecar (editor SSOT)
**File:** `app/apps/file_editor_cm6/project_sidecar.py`

- Stored under: `~/.cache/cm6_editor/projects/<sha1(project_root)>.json`
- Holds (among many things):
  - `session_cache`: per-file cached draft content and metadata
  - `lsp.enabled` and per-server enable flags
  - project-scoped LSP settings (root overrides etc.)

This is the sidecar the editor uses for drafts and for LSP project preferences.

### 1.2 TE2 Android sidecar (kotlin-android SSOT)
**Files:**
- `app/apps/file_editor_cm6/android_lang/android_sidecar.py`
- `app/apps/file_editor_cm6/android_lang/android_lsp_bridge.py`

- Stored under: `~/.cache/te2_android_lsp/<lspProjectId>/te2_android_sidecar.json` (cache root overridable via `TE2_ANDROID_LSP_CACHE_ROOT`).
- `lspProjectId` is **stable for the base project root** (not the rootRel) via `ProjectSidecar.get_or_create_lsp_project_id()`.

Why two sidecars:
- ProjectSidecar = editor UX + drafts + preferences
- te2_android_sidecar.json = android LSP dependency/fingerprint “feed” and cache keys

## 2) Fingerprints (what they are, where computed)
**File:** `app/apps/file_editor_cm6/android_lang/android_fingerprints.py`

There are multiple fingerprints, serving different invalidation domains:

- `repoFingerprint`: best-effort **git HEAD + status + diff** hash, fallback to filesystem fingerprint.
  - used to know “the repo changed, Gradle results may be stale”.

## 11) Progress + spinner/toasts (Gradle compile visibility)

Android diagnostics work involves real Gradle work (compile / analysis). The MVP surfaces this work to the user:

- The `kotlin-android` language server emits LSP work progress using:
  - `window/workDoneProgress/create`
  - `$/progress` (`begin` / `report` / `end`)
- The TE2 LSP broker (`app/apps/file_editor_cm6/lsp_ws.py`) intercepts `window/workDoneProgress/create` and **auto-ACKs** it (the iframe client does not implement that request), ensuring the server can proceed to emit `$/progress`.
- The broker converts `$/progress` into a shared-bus event (`lsp:busy`) with an activity label (ex: `gradle_compile`), and the host UI (`main.js`) shows:
  - a toolbar spinner while any busy task is active, and
  - start/end toasts for longer tasks (rate-limited to avoid spam).

Fallback behavior:
- If a save triggers compile but the server does not emit `$/progress` (or progress is delayed), the broker may start a delayed “Compiling (on save)…” busy indicator and then end it once diagnostics settle.

- `draftFingerprint`: hash of **(project-relative path + content_sha256)** for all draft entries.
  - computed from `ProjectSidecar.list_project_drafts()`.

- `syncFingerprint`: hash of pinned Gradle/config inputs (settings/build.gradle/etc + module + variant).
  - meant to detect “dependency model should be rebuilt”.

## 3) Dependency model v1 (what we actually store today)
**File:** `app/apps/file_editor_cm6/android_lang/android_dependency_model.py`

`build_dependency_model_v1()` is intentionally cheap and currently collects:
- Android SDK root → picks `android.jar` by best-effort `compileSdk` extraction from build.gradle(.kts) (fallback: highest installed platform).
- JDK info from `JAVA_HOME` (+ `jmods` path if present).
- `GRADLE_USER_HOME` (default `~/.gradle`).
- Best-effort “generated roots” under `<module>/build/generated`.
- Best-effort discovery of `R.jar` / `R.txt` under `<module>/build`.

**Important:** It does *not* yet build a full class/package dependency index. It’s a skeleton with pointers.

## 4) How te2_android_sidecar.json is written
**File:** `app/apps/file_editor_cm6/android_lang/android_lsp_bridge.py`

`update_android_sidecar_for_project(project_root, effective_project_root, module="app", variant="GeckoDebug")`:
- `lspProjectId` is derived from **base project root** (stable across rootRel overrides).
- Fingerprints + dependency model are computed relative to the **effective project root** (rootRel-aware).
- Writes:
  - `repoFingerprint`, `draftFingerprint`, `syncFingerprint`
  - `dependencyModel` (v1)
  - placeholder `lastGradleCompile`
  - `effectiveProjectRoot`

## 5) LSP transport details (Socket.IO ↔ Framework Shell ↔ stdio)
**Files:**
- `app/apps/file_editor_cm6/lsp_ws.py`
- `app/apps/file_editor_cm6/lsp_shell_manager.py`

### 5.1 Spawning servers
- Most servers use `LSP_COMMANDS`.
- **kotlin-android** is special-cased and spawned via shellspec (`_spawn_android_kotlin_lsp`).

### 5.2 Session keying + rootRel awareness
In `lsp_ws.py`, backend sessions are keyed by:
- `(language_id, project_root)`

For kotlin-android, `project_root` should be the **effective project root** (e.g. `<repo>/android`).
This is why save/sync paths explicitly compute `effective_project_root` from the project’s configured rootRel.

### 5.3 Diagnostics caching
While bridging server stdout → client, `lsp_ws.py`:
- parses framed LSP messages
- for each `textDocument/publishDiagnostics`:
  - logs it (`[LSP WS] publishDiagnostics uri=... count=N`)
  - caches it into `session["diagnostics_by_uri"][uri] = diagnostics`

This cache is then used by:
- server-side diagnostic summary aggregation (`get_diagnostics_summary_for_project()`)
- TE2-side “draft diagnostics” merging (`publish_draft_diagnostics_to_client()`)

## 6) How “save” affects kotlin-android
**Files:**
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- `app/apps/file_editor_cm6/lsp_ws.py`

When the user saves (`POST /editor/save`):

1) Buffer is written to disk.
2) The session cache entry is updated to “clean”.
3) A kotlin-android-specific hook runs:
   - `send_android_did_save_for_path(project_root=effective_project_root, abs_path=current_file)`
   - This injects:
     - `workspace/didChangeConfiguration` with `te2Android.repoFingerprint` (+ currently `dirtyFiles=[]`)
     - then `textDocument/didSave` for the saved URI

This is the pathway that causes the kotlin-android server to decide whether it should reuse cached Gradle results or run a compile.

## 7) Android Sync endpoint (manual re-sidecar + push settings)
**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

`POST /editor/android/sync`:
- Rebuilds `te2_android_sidecar.json` via `update_android_sidecar_for_project(...)`
- Computes `repoFingerprint`
- Sends `workspace/didChangeConfiguration` to kotlin-android (no Gradle compile)

This is intended as a fast “refresh dependency model pointers / fingerprints” button.

## 8) Draft diagnostics (TE2-generated) and arbitration
**Files:**
- `app/apps/file_editor_cm6/android_lang/draft_diagnostics.py`
- `app/apps/file_editor_cm6/android_lang/diagnostic_arbitration.py`
- `app/apps/file_editor_cm6/lsp_ws.py` (`publish_draft_diagnostics_to_client`)

Current state:
- `build_draft_diagnostics()` only emits conservative environment warnings:
  - `ANDROID_SDK_MISSING`
  - `JDK_MISSING`
- `publish_draft_diagnostics_to_client()` merges TE2 draft diagnostics with backend diagnostics per-URI.
- `merge_android_diagnostics()` currently suppresses backend “ghost” patterns ("Unresolved reference" / "Unresolved import") when `has_drafts=True`, unless the draft diagnostics indicate env problems.

## 9) Explorer “error dot” integration (diagnostics summary + cache)
**Files:**
- `app/apps/file_editor_cm6/explorer_ws.py`
- `app/apps/file_editor_cm6/lsp_ws.py` (`get_diagnostics_summary_for_project`)
- `app/apps/file_editor_cm6/project_sidecar.py` (persisted cache)
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (Pyright scan endpoint)

- The explorer connects to a WS and receives periodic diagnostics snapshots.
- Backend aggregates cached LSP diagnostics per project-relative file path (rootRel-aware).
- The frontend renders an inline marker next to explorer entries based on `{errors,warnings}` counts.

### 9.1 Persisted diagnostics cache (Pyright workspace scan)
Pyright supports a repo-wide “scan” that updates explorer dots for all Python files under the configured Pyright root:

- Trigger: Language Servers modal → **Pyright → 🔄 Scan**
- Backend: `POST /editor/pyright/scan`
  - runs `pyright --outputjson --project <effectiveRoot>` as a temporary **Framework Shell** (pipe backend) using shellspec (`app/apps/file_editor_cm6/shellspec/pyright_scan.yaml`)
  - parses `generalDiagnostics` and stores a lightweight `{rel: {errors,warnings}}` summary under:
    - `ProjectSidecar.diagnostics_cache.pyright.summaryByRel`

This cache allows explorer dots to survive worker restarts and avoids needing the LSP to “touch” every file.

### 9.2 Clearing dots without a full rescan (live LSP reconciliation)
Pyright LSP does not reliably publish “empty diagnostics” for every file that becomes clean.
To prevent stale dots:

- On `textDocument/publishDiagnostics` from the Pyright LSP, TE2 updates the same persisted `summaryByRel` entry for that file.
  - If the file is clean (0/0), the entry is removed.
  - If it has issues, the counts are updated.
- After updating, TE2 broadcasts an updated `explorer:updateDiagnostics` snapshot immediately so the UI clears dots promptly.

### 9.3 Severity bucketing
- Explorer counts:
  - **Errors**: LSP severity `1`, Pyright severity `"error"`
  - **Warnings**: LSP severities `2/3/4`, Pyright severities `"warning"`, `"information"`, `"hint"`

## 10) Known limitation (current implementation)
- The system does **not yet** compute a full dependency class/package index.
- Therefore it cannot currently emit draft-time unresolved import/class diagnostics based on the editor’s draft buffer.
- Sprint E is where the missing piece lands: build a compiled dependency index and overlay a shadow index driven by drafts, then publish draft diagnostics on debounce.
