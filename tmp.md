# Code CM6 — Issues Overlay (Technical Description, Current State)

**Last Updated:** 2025-12-24

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
- Renders an **Issues Overlay panel inside the iframe** with:
  - A "replica line" preview for the active issue line
  - 1..N issue rows under that line (severity + message + optional source/code)
  - Per-issue **dismiss** button (currently in-memory only)
- Renders **squiggle underlines in the editor text** driven by LSP diagnostics (custom decoration field, not @codemirror/lint).
- Supports **Export Diagnostics…** (Editor menu) which saves a JSON snapshot under `.diagnostics/` in the project root.

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
- Default save directory: `<projectRoot>/.diagnostics/`
  - If `.diagnostics` does not exist, the host prompts with a confirm dialog and creates it if approved
- Default filename: `<project-relative-path with '/' replaced by '.'>.json` (example: `app.main.py.json`)

## Current Known Issues / Limitations

### ✅ FIXED
- ~~Issues do **not update during live edits** (typing)~~ — **FIXED**: Explicit `didChange` notifications now trigger diagnostics refresh
- ~~If the page is reloaded while an LSP is already running, the Issues feature **does not mount / reattach**~~ — **FIXED** (for TypeScript/JavaScript): Diagnostics nudge after `didOpen` triggers refresh

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
