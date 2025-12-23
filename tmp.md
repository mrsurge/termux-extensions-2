# Code CM6 — Issues Overlay (Technical Description, Current State)

This document describes how the **Issues Overlay** + **squiggle underlines** work right now in Code CM6 (NiceGUI iframe + CM6 LSP bridge), and what is still broken.

## TE2 / Code CM6 Overview (Brief)

### TE2 runtime model

- **Termux Extensions 2 (TE2)** is a multi-app framework that runs a single “framework” web server and spawns **per-app workers** as separate processes.
- The framework proxies `/app/<app_id>` traffic to the correct worker port and provides shared services (notably **Framework Shells** for running commands/PTYs).
- App workers are responsible for their own FastAPI routes, websockets, and any embedded UI frameworks.

### Code CM6 structure

- Code CM6’s host UI (`app/apps/file_editor_cm6/template.html` + `app/apps/file_editor_cm6/main.js`) is the “chrome”:
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
  - A “replica line” preview for the active issue line
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
- `flat`: flattened, sorted list of “issue refs” used for navigation
- `counts`: `{ errors, warnings }`
- `activeIndex`: current selection in `flat`
- `suppressed`: `Set(sig)` (in-memory)

Severity bucketing policy (current):
- Error: LSP severity `1`
- Warning: severity `2`, `3`, `4` (info/hint currently treated as warning)

### 3) Squiggles: custom CM6 decoration field (diff-style pipeline)

We do **not** depend on `@codemirror/lint`’s `serverDiagnostics()` to render squiggles.
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

## Current Known Issues / Limitations

- The **Issues Overlay works for all languages**, but **Kotlin squiggles still do not render** (overlay counts + rows show, but no underline marks in the editor).
- The Issues feature **only works reliably for JavaScript on the initial page/LSP load**.
- If the page is reloaded while an LSP is already running, the Issues feature **does not mount / reattach** (no squiggles + no live issue updates, even though sticky scroll + LSP itself still work).
- Issues do **not update during live edits** (typing). Diagnostics/squiggles/overlay reflect the initial load state only (all languages).
- Dismiss is **in-memory only** right now (not persisted to HistoryStore/ProjectSidecar yet).

## Relevant Files

- Iframe (CM6 + overlay + squiggles): `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- Host chrome + buttons + badges: `app/apps/file_editor_cm6/template.html`, `app/apps/file_editor_cm6/main.js`
- Backend LSP transport (Framework Shells pipe ↔ Socket.IO): `app/apps/file_editor_cm6/lsp_ws.py`
