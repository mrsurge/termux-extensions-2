# Code CM6 — Issues Overlay (Technical Description, Current State)

**Last Updated:** 2025-12-23 02:30 UTC

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

## Architecture / Data Flow

### 1) LSP diagnostics enter the iframe via the existing Socket.IO LSP bridge

- Each LSP server runs as a Framework Shell and is bridged to the browser via Socket.IO (`/lsp` namespace).
- The iframe component `app/static/vendor/nicegui/elements/codemirror/codemirror.js` subscribes to `lsp_server_to_client`.
- When it receives a JSON-RPC notification:
  - `method: "textDocument/publishDiagnostics"`
  - `params: { uri, diagnostics }`
  it forwards the payload into the Issues subsystem (no extra websocket/bus required).

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
  - `type: "issues_cmd"` with `{ action: "toggle" | "prev" | "next" }`
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

## Current Known Issues / Limitations

### ✅ FIXED
- ~~Issues do **not update during live edits** (typing)~~ — **FIXED**: Explicit `didChange` notifications now trigger diagnostics refresh
- ~~If the page is reloaded while an LSP is already running, the Issues feature **does not mount / reattach**~~ — **FIXED** (for TypeScript/JavaScript): Diagnostics nudge after `didOpen` triggers refresh

### 🔄 IN PROGRESS
- **Kotlin diagnostics broken**: Symbols work (sticky scroll), but `publishDiagnostics` not being received/processed. Needs investigation.

### ⏳ REMAINING
- The **Issues Overlay works for all languages**, but **Kotlin squiggles still do not render** (overlay counts + rows show, but no underline marks in the editor).
- Dismiss is **in-memory only** right now (not persisted to HistoryStore/ProjectSidecar yet).

## Relevant Files

- Iframe (CM6 + overlay + squiggles + LSP broker): `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- Host chrome + buttons + badges: `app/apps/file_editor_cm6/template.html`, `app/apps/file_editor_cm6/main.js`
- Backend LSP transport (Framework Shells pipe ↔ Socket.IO): `app/apps/file_editor_cm6/lsp_ws.py`

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

## Kotlin Diagnostics Investigation (2025-12-23 04:00 UTC)

### Current Status
Kotlin LSP diagnostics (`publishDiagnostics`) are not being received. The LSP server is running and responding to `documentSymbol` requests (sticky scroll works), but no diagnostics are emitted.

### What We've Tried

1. **Added backend logging for `publishDiagnostics`** (`lsp_ws.py`)
   - Result: No `publishDiagnostics` messages logged for Kotlin
   - Confirms the Kotlin LSP server is simply not sending diagnostics

2. **Added frontend URI comparison logging** (`codemirror.js`)
   - Result: No logs because no diagnostics arrive at the frontend
   - URI normalization added as a precaution for `file://` vs `file:///` differences

3. **Disabled `--isolated-documents` flag** (`lsp_shell_manager.py`)
   - Hypothesis: `--isolated-documents` mode disables project-wide analysis, which may disable diagnostics
   - Changed default from `_is_termux_android()` to `False`
   - Result: Still no diagnostics after LSP restart

### Technical Details

**Kotlin LSP Launch Command** (from `ps aux`):
```
java ... com.jetbrains.ls.kotlinLsp.KotlinLspServerKt --stdio --system-path <cache> --isolated-documents
```

**Backend logs show:**
- `didOpen` ✓
- `documentSymbol` request/response ✓
- `publishDiagnostics` ✗ (never logged)

**Project Structure:**
- Workspace root: `/data/data/com.termux/files/home/mrselect5`
- Kotlin file: `android/app/src/gecko/java/com/termux/extensions/MainActivity.kt`
- Gradle project at: `android/build.gradle.kts`

### Possible Remaining Causes

1. **Workspace root mismatch** — The LSP `rootUri` is set to the repo root, but the Gradle project is in `android/`. Kotlin LSP may not detect the project.

2. **JetBrains Kotlin LSP requires explicit project import** — Unlike tsserver/pyright, it may need Gradle sync or explicit project configuration.

3. **Diagnostics capability not negotiated** — The LSP client may not be requesting diagnostics in the `initialize` capabilities.

4. **Server-side diagnostics disabled** — The JetBrains Kotlin LSP may have diagnostics disabled by default or require a specific setting.

5. **Async diagnostics** — Kotlin LSP might use pull-based diagnostics (`textDocument/diagnostic`) instead of push-based (`publishDiagnostics`).

### Next Steps to Try

1. Check the `initialize` response for `diagnosticProvider` capability
2. Try setting `rootUri` to the `android/` subdirectory for Kotlin files
3. Look for JetBrains Kotlin LSP documentation on enabling diagnostics
4. Try sending `textDocument/diagnostic` pull request instead of waiting for push
5. Check if the Kotlin LSP needs workspace/configuration settings for diagnostics

---

## Kotlin Diagnostics RESOLVED (2025-12-23 04:44 UTC)

### Root Cause
JetBrains Kotlin LSP uses **pull-based diagnostics** (`textDocument/diagnostic` request) instead of push-based (`textDocument/publishDiagnostics` notification). The client must explicitly request diagnostics.

### Fix Implemented

#### 1. Pull Diagnostics Request (`codemirror.js`)
Added `requestPullDiagnostics()` method that:
- Sends `textDocument/diagnostic` request (Kotlin only)
- Converts response to `publishDiagnostics` format
- Feeds into existing Issues pipeline (squiggles, overlay, counts)

Called:
- 1500ms after `didOpen` (initial load)
- After each `didChange` (debounced 500ms via `_pullDiagnosticsDebounce`)

#### 2. Workspace Root Override (`codemirror.js`)
Added `_getLspWorkspaceOverrides(languageId, projectRoot, filePath)` stub:
- Kotlin files use `projectRoot + '/android'` as workspace root
- Allows Gradle project detection and import resolution
- **STUB**: Will be replaced with HistoryStore singleton for per-project config

#### 3. Broker Configuration
Added `textDocument/diagnostic` to LSP Request Broker with 600ms debounce.

### Results
- Before: 316 errors (all unresolved imports)
- After: 1 warning (actual code issue)

### Files Modified
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - `_getLspWorkspaceOverrides()` — workspace root stub
  - `requestPullDiagnostics()` — pull diagnostics for Kotlin
  - `_pullDiagnosticsDebounce` — debounced refresh on edits
  - LSPClient creation uses `effectiveRootUri` from overrides

### Next Steps
- Replace hardcoded `android/` path with HistoryStore-backed per-project LSP workspace configuration
- Consider auto-detection of Gradle/Maven project root by walking up directory tree
