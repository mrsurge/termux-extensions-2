# code_cm6 Inline Diff Pipeline (status: 26 Oct 2025)

This note documents the current inline git diff implementation powering the `app/apps/file_editor_cm6` CodeMirror 6 editor. Paths and line numbers reference the working tree committed on 26 Oct 2025.

---

## 1. Overview
1. The editor saves files through `/api/app/file_editor_cm6/write`, which flushes the working tree and invalidates cached git metadata.  
2. Whenever the user opens a file, toggles “Show Inline Diffs”, saves, or the worker pushes a `replace_full` event, the frontend calls `/api/app/file_editor_cm6/diff?path=…`.  
3. The diff endpoint consults `diff_helper.collect_diff`, which runs `git diff --unified=0` inside the active project and memoises results for 5 s.  
4. The response feeds into a CodeMirror decoration controller (`diff_decorations.js`) that creates line highlights for additions and block widgets for deletions.  
5. Preferences persist the toggle state (`showInlineDiffs`) so future sessions restore the user’s choice.  
6. Styling lives in `template.html` and emphasises the diff markers; the status bar shows a Δ summary while diffs are present.

---

## 2. Backend Components

### 2.1 `diff_helper.py`
- **Cache & invalidation:** `invalidate_diff_cache` (lines 25‑42) clears the entire cache, a project-specific namespace, or one file (keyed `"<root>::<rel_path>"`).  
- **Collector:** `collect_diff` (lines 45‑182)  
  - Normalises `project_root` → key (line 63).  
  - Memoises positive results for `CACHE_TTL_SECONDS = 5.0` sec (lines 68‑72).  
  - Short-circuits if the directory is not a Git repo (lines 74‑77).  
  - Runs `git status --short -- <path>` to detect tracking (lines 81‑103).  
  - Spawns `git diff --unified=0 --no-color -- <path>` (lines 104‑118) with a 10 s timeout (lines 120‑125).  
  - Rejects non-zero/one exit codes, very large payloads (>512 KiB, line 136), or timeouts and records an error field.  
  - Parses hunks by walking `stdout.splitlines()` (lines 150‑175), counting added/deleted lines to build the `summary`.  
  - Helpers `_parse_hunk_header`, `_parse_range`, `_is_git_repo` live at lines 185‑213.

### 2.2 Flask routes (`main.py`)
- **Path normalisation:** `_normalize_rel_path` (lines 106‑123) ensures the supplied path lies under the active project root; converts to POSIX relative strings for git.  
- **Diff endpoint:** `GET /api/app/file_editor_cm6/diff` (lines 322‑343)  
  - Validates the query parameter, project selection, and directory accessibility.  
  - Calls `_normalize_rel_path` to guard against `..` escapes (lines 337‑340).  
  - Delegates to `collect_diff` and returns `{ ok: true, data: … }`.
- **Cache invalidation hooks:**  
  - `write_file_route` (lines 148‑199) invalidates both git status and diff caches after a successful write (lines 179‑181).  
  - `project_open` (lines 240‑244) wipes diff caches when the user switches projects.  
  - `_ensure_project_root_synced` (lines 24‑39) also calls `invalidate_diff_cache` if the saved project root differs from the runtime root (line 34).

---

## 3. Frontend Integration (`main.js`)

### 3.1 Diff service helpers
- **Fetcher:** `fetchDiffPayload` (lines 122‑135) issues `fetch('/api/app/file_editor_cm6/diff?path=…')`, propagates backend errors, and falls back to `{ tracked: false }` on failure.  
- **Status bridge:** `handleDiffStatus` (lines 137‑152) updates `#fe-status` with `Δ +x −y` labels when diffs exist; clears the indicator when summary is empty or the document is unsaved.
- **Controller wiring:** `createDiffController` is instantiated at lines 155‑160, and exposed for debugging via `window.__cm6Diff = …` (line 159).

### 3.2 Editor lifecycle
- **Extension assembly:** `makeExtensions` (lines 262‑301) pushes `diffController.extension` into the CM6 extension list when available (line 284).  
- **View creation:** `createView` (lines 304‑323) destroys the previous view, reattaches diff bindings, toggles according to `showInlineDiffs`, and triggers an initial `refresh()`.  
- **Preferences:**  
  - Default toggles loaded in `applyPreferencesFromStore` (lines 345‑356) and `loadPreferences` (lines 395‑399) map the persisted `showInlineDiffs` flag back onto runtime state, then call `diffController.setEnabled`.  
  - Defaults are declared in `preferences_store.py` (lines 9‑17).
- **Toggle menu:**  
  - Template entry `View → Show Inline Diffs` lives at `template.html` line 124.  
  - `bindMenuToggle(miToggleDiffs, …)` (lines 962‑969) flips `showInlineDiffs`, applies menu state, calls `diffController.setEnabled()`, optionally forces `refresh(true)`, and persists via `/preferences`.

### 3.3 Events that refresh diffs
- **Opening a file:** `openFile` (lines 591‑644) sets `diffController.setContext({ path, sha })` after the document loads (lines 620‑623) and immediately calls `refresh(true)`.  
- **Save-as:** `saveAsDialog` (lines 726‑776) invalidates cache, updates context, and refreshes after the new path is committed (lines 752‑756).  
- **WebSocket push:** `handleWSMessage` (lines 529‑572) invalidates cache and refreshes when a `replace_full` arrives with new content (lines 559‑563).  
- **Manual resets:**  
  - New/Close/Quit menu actions clear the diff context (lines 880‑911).  
  - Keyboard “New” shortcut replicates the same invalidation (lines 1008‑1015).  
- **Status export:** `statusEl.dataset.diffSummary` stores the current Δ label so other UI code can inspect it.

---

## 4. Diff Decoration Controller (`static/js/diff_decorations.js`)
- **Imports:** Pulls `EditorView`, `StateEffect`, `StateField`, `RangeSetBuilder`, `Decoration`, `WidgetType` directly from `/static/vendor/codemirror.2/cm_state_view.bundle.js` (lines 3‑10).  
- **Factory:** `createDiffController` (lines 23‑209) returns an object with:
  - `extension`: a `StateField` (lines 30‑48) that injects decorations into the view.  
  - `setContext`, `setEnabled`, `refresh`, `invalidateCacheForPath`, `bindView`, `currentSummary`.  
  - An internal cache keyed by `"<abs_path>::<sha or no-sha>"` (lines 68‑161) to avoid redundant fetches.
- **Fetching logic:** `refresh()` (lines 117‑152) debounces concurrent requests via `pendingKey`, and on success composes a decoration set via `buildDecorations`.  
- **Decoration builders:**  
  - `buildDecorations` (lines 211‑241) iterates hunks, applying a line decoration (`cm-diff-line-added`) for additions and block widgets for deletions.  
  - `safeLine` (lines 244‑252) protects against out-of-range line lookups.  
  - `RemovedLineWidget` (lines 52‑64) produces the markup consumed by template CSS.

---

## 5. UI Styling & Indicators
- Diff visuals are defined in `template.html` (lines 60‑63) with stronger backgrounds and left borders for additions/deletions; the `.cm-diff-removed` block uses `white-space: pre-wrap` to show entire deleted lines.  
- The status bar entry `Δ +… −…` is injected by `handleDiffStatus`; the attribute `data-diff-summary` is cleared whenever no diff is present, so external scripts can test the state.  
- The View menu exposes the checkbox at `template.html:124`, matching the preferences toggle.

---

## 6. Supporting Assets
- The CodeMirror bundle that exports view/state primitives lives at `app/static/vendor/codemirror.2/cm_state_view.bundle.js`. It aggregates `@codemirror/state`, `@codemirror/view`, and `@marijn/find-cluster-break`, and its tail export block (lines … → see file) makes the symbols available to both `main.js` and `diff_decorations.js`.  
- Legacy bundles (`app/static/vendor/codemirror.1/codemirror.bundle.js`) still provide language packs/themes, but they do **not** expose the `Decoration` API, which is why the second bundle is required.

---

## 7. Known Limitations / Behavioural Notes
1. Diff data comes solely from `git diff --unified=0`; unsaved buffer edits are invisible until the file is written to disk.  
2. Files outside the active project root or inside non-git directories return `{ summary.tracked: false }`, so the overlay stays blank.  
3. The cache TTL (5 s) means very rapid save → query cycles may reuse stale hunks unless the frontend calls `refresh(true)` (all save/open paths already do this).  
4. Large diffs (>512 KiB) are skipped to avoid flooding the client; the controller currently treats this as “no diff” and does not display an error badge.  
5. The controller doesn’t diff against `HEAD` vs `staged` separately—it always compares the working tree to the index.  
6. Styling relies on `.cm-line` class overrides; if a future theme injects stronger `!important` rules, the diff colours may require adjustment.

---

**Diagnostic hook:** Use the browser console to call `window.__cm6Diff.refresh(true)` or inspect `window.__cm6Diff.currentSummary()` while looking at a tracked file to confirm whether the decoration layer is receiving data.  

This document should give any contributor enough context to audit the current inline diff pipeline and trace issues across the backend, fetch layer, decorations, and UI surface.하세요.
