# Code CM6: “Any‑Room DVR” Mirroring (SSOT, multi-client)

## Contract / UX
- The runtime is **single‑document SSOT**: at any moment, `file_editor_cm6` has exactly one active file open (all connected clients view the same document).
- If a client has a **stable websocket**, they can “watch” the editor from anywhere (desktop, GeckoView, etc.).
- **Authoring client stays stable** (cursor/selection must not be clobbered).
- Other connected clients are **viewers**: they can be overwritten by the author’s buffer (code‑server style).

## Key implementation points (bookmarks)

### 1) Multi-client registry (NiceGUI runtime)
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:39-50`
  - `_active_editors` stores `{client_id -> editor instance}`.
  - `_register_editor_for_client` wires the current client id to its editor instance.

### 2) Author-safe mirroring (server-side, no parent/iframe round-trip)
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:1210-1264`
  - `_on_editor_change` derives `source_client_id` from `context.client.id` (`editor_app.py:1236-1241`).
  - Mirroring loop updates **all other clients** (not the author) via:
    - `ed.run_method('setEditorValue', value)` (`editor_app.py:1243-1256`)
  - Rationale: avoids destructive “rebuilt editor” behavior on the authoring client.

### 3) Receiver apply method (CM6-side, viewer-friendly)
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js:1505-1537`
  - `setEditorValue(value)` applies text changes in CM6.
  - Uses a viewport/selection preservation path when the editor is not focused, so viewers don’t get yanked while reading.

### 4) Draft persistence + live inline diffs
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:696-811`
  - `_persist_to_cache_debounced()` persists draft sidecar state.
  - Restored diff refresh gated by preferences (`showInlineDiffs` / `showDraftDiffs`):
    - `editor_app.py:802-810` calls `_schedule_diff_refresh(..., "persist")`.

### 5) Draft bus (host shell integration)
- Draft content broadcasts still exist (explorer Socket.IO bus):
  - `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:764-783` broadcasts `draft:content`.
- Host-side draft apply uses the existing “bus” style and applies via iframe message (non-destructive):
  - `app/apps/file_editor_cm6/main.js:1853-1883` (`window.__cm6ApplyRemoteDraft`)

### 6) Autosave (live propagation + host state sync)
- Cache-state now includes autosave mode so other host shells don’t “imagine drafts”:
  - `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:476-515` adds `auto_save` to the `cm6-cache-state` payload.
  - `app/apps/file_editor_cm6/main.js:1466-1512` consumes `auto_save` (and `autoSave` fallback) and updates menu/UI state.
- Autosave now broadcasts the saved buffer over the explorer bus:
  - `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:2579-2725` `POST /editor/save` emits `autosave:content` when `autoSave` is enabled.
  - `app/apps/file_editor_cm6/main.js:1898-1926` applies `autosave:content` via `cm6_mirror` to viewer clients and marks `unsaved=false`.
  - `app/apps/file_editor_cm6/static/js/explorer.js:1892-1902` routes `autosave:content` to `window.__cm6ApplyAutosaveContent`.

## Anti-patterns / pitfalls (what broke cursor stability)
- Do **not** apply draft/mirror updates by calling backend `editor/set_content` from the host shell; it can reset CM6 selection/scroll and feel like an editor rebuild.
- Do **not** treat the author client as “just another viewer” receiving its own broadcasted content.
- Avoid relying on “parent window” postMessage for cross-client mirroring; it only reaches the parent tab, not other clients. Keep mirroring inside the NiceGUI runtime (server pushes to other NiceGUI clients).

## Notes / TODO
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:52-55` contains an outdated comment about mirroring being moved to `codemirror.js`; the actual mirror is now server-side in `_on_editor_change`.
