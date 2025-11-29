# 2025-11-29 – Recents Dropdown “Missing File” Fix

## Summary

After a framework reload, the **Recents** dropdown in the Code CM6 toolbar was incorrectly marking all recent files as “missing”, even though the underlying files and history data were present. The issue self-corrected as soon as the user opened any file in the session.

Root cause: the legacy `/state` endpoint used by `explorer.js` returned bare history entries without an `exists` flag, while `/state/file_activity` used a newer helper to enrich entries with file existence metadata. The mismatch caused the initial payload to be interpreted as “missing” by the frontend.

## Symptoms

- Immediately after opening Code CM6 (or reloading the app shell), the **Recents ▾** dropdown listed recent files with a “(missing)” suffix.
- Clicking a “missing” entry showed a toast complaining that the file could not be found, even though the file was on disk and still openable via the explorer tree.
- Once the user opened *any* file, the dropdown refreshed and started showing the correct “existing” state for all entries.

## Technical Root Cause

Two different state pipelines were in play:

- `GET /api/app/file_editor_cm6/state` (legacy combined state endpoint)
  - Implemented in `app/apps/file_editor_cm6/main.py:get_editor_state_deprecated`.
  - Returned:
    - `activeProject`, `currentPath`, `unsaved`, `recents`, `gitDiffBase`, etc.
  - Critically, `recents` here came directly from `_history_store.list_files(...)` with **no `exists` field**.

- `POST /api/app/file_editor_cm6/state/file_activity`
  - Called whenever a file is opened via `openFile()` / `appOpenFileRel`.
  - Used `_build_state_payload()` to construct a richer snapshot:
    - Each recent entry was wrapped as:
      - `{"path", "label", "opened_at", "exists": bool(Path(path).is_file())}`

On the frontend:

- `app/apps/file_editor_cm6/static/js/explorer.js` uses:
  - `getEditorState(forceRefresh)` → `/state`
  - `renderRecentMenu(state)` → accesses `state.recents`
- The renderer expects `entry.exists` to be a boolean:

```js
const allFiles = s?.recents || [];
const span = document.createElement('span');
span.textContent = entry.exists
  ? (entry.label || entry.path)
  : `${entry.label || entry.path} (missing)`;
```

When `exists` is absent:

- JavaScript treats `undefined` as falsy, so all entries were rendered as “(missing)”.
- After the first `state/file_activity` call, `broadcastRecentsUpdate()` pushed a new state built via `_build_state_payload()`, which *did* include `exists`, and the UI corrected itself.

## Fix

We unified the two code paths by making `/state` reuse `_build_state_payload()`:

- **File:** `app/apps/file_editor_cm6/main.py`
- **Function:** `get_editor_state_deprecated` (`@file_editor_cm6_bp.get('/state')`)

### Before

- `/state` manually reconstructed:
  - active project / origin
  - session state
  - git diff base
  - recents via `history.list_files(active_project)`
- It did **not** add `exists`, so the shape of `recents` was:

```json
{ "path": "...", "label": "...", "opened_at": "..." }
```

### After

- `/state` now:
  1. Calls `_build_state_payload()` to obtain:
     - `activeProject`, `activeProjectExists`, `activeProjectLabel`
     - `lastFile`, `lastFileExists`, etc.
     - `recents` with `exists` computed using `Path(entry_path).is_file()`
     - `preferences`, `gitDiffBase`, `runtime`
  2. Augments this payload with:
     - `projectOrigin` (via existing origin-cache logic)
     - `currentPath`, `unsaved`, `editorState` (from `_history_store.get_session_state()`)

Resulting contract:

```json
{
  "activeProject": "...",
  "activeProjectExists": true,
  "activeProjectLabel": "mrselect",
  "projectOrigin": "...",
  "currentPath": "...",
  "unsaved": false,
  "recents": [
    {
      "path": "/abs/path/to/file",
      "label": "file",
      "opened_at": "2025-11-29T02:01:11Z",
      "exists": true
    }
  ],
  "gitDiffBase": { "...": "..." },
  "editorState": { "...": "..." },
  "runtime": { "...": "..." }
}
```

The `recents` payload now matches what `/state/file_activity` already provided, so:

- `renderRecentMenu()` can rely on `entry.exists` being defined from the very first render.
- The “(missing)” label only appears when the file is truly absent on disk.

## Impact & Safety

- No behavior change for:
  - `activeProject*`
  - `currentPath`, `unsaved`
  - `gitDiffBase`
- The change is localized to the `/state` implementation and simply reuses a canonical helper (`_build_state_payload`) that was already well tested via other endpoints.

## Related Files

- `app/apps/file_editor_cm6/main.py`
  - `_build_state_payload`
  - `get_editor_state_deprecated` (`/state`)
  - `record_file_activity` (`/state/file_activity`)
- `app/apps/file_editor_cm6/history_store.py`
  - `list_files`, `get_session_state`, `get_diff_base`
- `app/apps/file_editor_cm6/static/js/explorer.js`
  - `getEditorState`
  - `renderRecentMenu`

