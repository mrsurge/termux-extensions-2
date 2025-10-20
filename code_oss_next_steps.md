# Code OSS Enhancement Plan

This document captures the detailed implementation plan for two outstanding items on the Code OSS roadmap.

---

## 2. Restore Menu Actions & Auto-Save Toggle

### Goals
1. Wire the File/Edit menu items so Save/Save As/Open/Undo/Redo execute real commands.
2. Introduce an auto-save toggle (disk-backed) that drives when CM6 pushes edits to code-server.

### Backend Work
- **New endpoint**: `POST /api/app/code_oss/open`
  - File: `app/apps/code_oss/backend.py`
  - Validate the requested path, reuse the logic from `/file`, and return `{path, content}`.
- **Ensure edit queue** (`enqueue_edits`) handles both `replace_full` and `apply_edits` payloads (already present in current code path but confirm).
- **Preferences store** (`app/apps/code_oss/preferences_store.py`)
  - Extend default editor prefs with `autoSave`.
  - Allow `update_preferences()` to accept/return the flag.

### Frontend Work (`app/apps/code_oss/static/js/ide_fullpage.js`)
- Extend `DEFAULT_EDITOR_PREFS` and `getCurrentEditorPrefs()` with `autoSave`.
- Add a checkable menu item (e.g., File → “Auto Save”) wired to `persistEditorPreferences()`.
- Update `cmState` to track `autoSave`; when ON, debounce CM6 change events and call `/api/app/code_oss/edits`. When OFF, surface a “dirty” indicator until the user saves.
- Wire menu commands:
  - File → “Open…”: use `teFilePicker.openFile()`, call `POST /api/app/code_oss/open`, feed into `setEditorDocument()`, update history/prefs.
  - File → “Save”: gather CM6 text and hit `/api/app/code_oss/edits` with `replace_full` payload; throttle button state to avoid rapid repeats.
  - File → “Save As…”: prompt for a target path via picker, then call the same endpoint with `target_path` (future-friendly for multi-save scenarios).
  - Edit → Undo/Redo: call the CM6 undo/redo commands (`undo`/`redo` from the CM6 keymap).
- Update the status area (toolbar or title) to reflect `Auto Save (On)` vs `Manual (unsaved)` states.

---

## 5. Inline Git Diffs

### Goals
Render staged/unstaged diffs directly in CM6 using decoration overlays.

### Backend Work
- **Diff endpoint**: `GET /api/app/code_oss/diff`
  - Input: `path`, optional `staged=true|false`.
  - Implementation: run `git diff [--cached] -- <path>`, parse hunks to JSON (original line start, new line start, per-line status/text).
  - Reuse `_GIT_STATUS_CACHE` to avoid redundant invocations.
- Optionally extend `_gather_git_status()` so the explorer payload notes whether staged/unstaged diffs exist (drives UI badges).

### Frontend Work (`ide_fullpage.js`)
- When a file is opened in CM6, check git metadata; if the file has pending hunks, fetch the diff endpoint.
- Maintain a `diffDecorations` set:
  - Added lines get a green background highlight.
  - Removed lines can be represented with line widgets or gutter markers (since they aren’t present in the doc).
  - Modified lines can combine both markers.
- Add a checkable menu item in View → “Show Inline Diffs”, persisted via preferences. When off, skip diff fetches and clear decorations.
- After every save (manual or auto), clear diff overlays until the backend reports new changes.
- Debounce diff refreshes to avoid hammering the backend during rapid edits.
- Show errors (non-git repo, large diff) via the status area and disable the toggle for the affected file.

---

This plan builds on the current disk-backed preference infrastructure and git status cache, keeping all persistent state on the filesystem while enhancing editor functionality.
