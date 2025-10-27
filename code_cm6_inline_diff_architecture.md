# code_cm6 Inline Diff Pipeline (status: 27 Oct 2025)

This note documents the current inline git diff implementation powering the `app/apps/file_editor_cm6` CodeMirror 6 editor. Paths and line numbers reference the working tree as of 27 Oct 2025.

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

This document should give any contributor enough context to audit the current inline diff pipeline and trace issues across the backend, fetch layer, decorations, and UI surface.

---

## 8. Critical Bug Fix (26 Oct 2025 22:00 UTC)

### Issue: Inline Diffs Not Rendering in UI

**Problem:**
The inline diff decorations were completely failing to appear in the editor despite all backend endpoints working correctly and returning proper diff data. The decoration system was silently failing without any console errors.

**Root Cause:**
The application was using **two separate CodeMirror bundles** with incompatible module instances:

1. **Bundle #1** (`/static/vendor/codemirror.1/codemirror.bundle.js`):
   - Used by `main.js` to create the EditorView and EditorState instances
   - Provided language packs, themes, and core editor functionality
   - Already exported `StateField` and `StateEffect`
   - **Missing exports:** `Decoration`, `WidgetType`, `RangeSetBuilder`

2. **Bundle #2** (`/static/vendor/codemirror.2/cm_state_view.bundle.js`):
   - Used exclusively by `diff_decorations.js`
   - Created specifically to provide state/view/decoration APIs
   - Exported `Decoration`, `StateField`, `StateEffect`, `WidgetType`, `RangeSetBuilder`, `EditorView`

The critical issue: `diff_decorations.js` created a `StateField` that called `EditorView.decorations.from()` using the `EditorView` class from bundle #2, but the actual editor instance running in the browser was created from bundle #1's `EditorView`. Because these were separate module instances with their own internal state and facet registries, the decoration provider never connected to the actual editor view. The StateField's `provide: field => EditorView.decorations.from(field)` was registering with bundle #2's facet system, while bundle #1's EditorView instance was looking for decorations in its own separate facet registry.

**Investigation:**
1. Verified backend `/api/app/file_editor_cm6/diff` endpoint returned correct hunk data
2. Confirmed `fetchDiffPayload` successfully retrieved diff payloads
3. Checked that `diffController.extension` was being added to editor extensions array
4. Discovered the module mismatch by tracing import paths in both files
5. Confirmed that all required classes (`Decoration`, `WidgetType`, `RangeSetBuilder`) existed internally in bundle #1 but were not exported

**Solution:**
The fix required two surgical changes to unify all CodeMirror imports under a single bundle:

1. **Modified `app/static/vendor/codemirror.1/codemirror.bundle.js` (line 30696):**
   
   Added three missing class exports to the export statement:
   ```javascript
   // Before:
   export { Compartment, EditorState, EditorView$1 as EditorView, LanguageSupport, 
            SearchQuery, StateEffect, StateField, Transaction, ... };
   
   // After:
   export { Compartment, Decoration, EditorState, EditorView$1 as EditorView, 
            LanguageSupport, RangeSetBuilder, SearchQuery, StateEffect, StateField, 
            Transaction, WidgetType, ... };
   ```
   
   The classes were already present in the bundle at:
   - `Decoration` class at line 5544
   - `WidgetType` class at line 5450  
   - `RangeSetBuilder` class at line 3487

2. **Modified `app/apps/file_editor_cm6/static/js/diff_decorations.js` (line 10):**
   
   Changed the import source from the separate bundle to the unified bundle:
   ```javascript
   // Before:
   import {
     EditorView, StateEffect, StateField, RangeSetBuilder, Decoration, WidgetType,
   } from '/static/vendor/codemirror.2/cm_state_view.bundle.js';
   
   // After:
   import {
     EditorView, StateEffect, StateField, RangeSetBuilder, Decoration, WidgetType,
   } from '/static/vendor/codemirror.1/codemirror.bundle.js';
   ```

**Result:**
All CodeMirror classes now share the same module instance. The `StateField` created by `diff_decorations.js` uses the same `EditorView.decorations` facet that the actual editor instance recognizes, allowing the decoration system to function correctly. The inline diffs now render as intended:
- Added lines appear with green background highlighting and left border
- Deleted lines render as red block widgets showing the removed content
- The status bar displays `Δ +n −m` summary when diffs are present

**Verification:**
```bash
# Confirmed exports are present:
$ node -e "import('./app/static/vendor/codemirror.1/codemirror.bundle.js').then(cm => {
    console.log('Decoration:', typeof cm.Decoration);
    console.log('WidgetType:', typeof cm.WidgetType);  
    console.log('RangeSetBuilder:', typeof cm.RangeSetBuilder);
  })"
# Output: All show 'function'
```

**Historical Note:**
Bundle #2 was originally created because bundle #1 appeared to lack the decoration APIs. However, this was a misconception—the classes existed but simply weren't exported. The proper solution was to export them from the primary bundle rather than maintaining a second incompatible bundle. Bundle #2 can now be deprecated since bundle #1 provides all necessary functionality.

**Lesson:**
When working with ES modules and facet-based extension systems like CodeMirror 6, all components must import from the exact same module instance. Separate bundles, even if they contain identical CodeMirror source code, create incompatible class instances with separate internal registries. Always verify that exports are truly missing from a bundle before creating a duplicate—often the classes exist internally and only need to be added to the export statement.

## 4. Styling considerations (26 Oct 2025 update)
- `diff_decorations.js` now tags each rendered line with `data-diff-marker` while the deletion widget produces a DOM node that mimics a native CM6 line.  
- `template.html` applies shared gutter styling through `.cm-diff-line` / `.cm-diff-line-removed`, rendering `│`, `+`, or `−` via pseudo-elements so we never mutate document text directly.  
- Added lines keep the existing green highlight; context lines receive a faint vertical bar, and removed blocks align with editor line-height to prevent line-number drift.  
- Because the widget mimics line structure, Android selection and CM6 scrolling remain unaffected—the widget is marked `ignoreEvent()` to keep native gestures intact.
- The removal widget shares the theme’s typography/background, uses zero vertical padding, and collapses adjacent `cm-widgetBuffer` spacers so no extra gap appears around deleted blocks; `--diff-del-gap` governs any optional trailing space.

---

## 9. Word Wrap Feature Enhancement (27 Oct 2025 02:00 UTC)

### Issue: Deletion Widgets Not Inheriting Word Wrap Setting

**Problem:**
Deleted lines rendered as block widgets had hardcoded `white-space: pre` in CSS, causing them to always use horizontal overflow regardless of the user's word wrap preference. The editor lines would wrap when `EditorView.lineWrapping` was enabled, but deletion widgets remained unwrapped, creating an inconsistent editing experience.

**Root Cause:**
CodeMirror's `EditorView.lineWrapping` extension only affects `.cm-line` elements (actual editor lines). Widget elements created by `RemovedLineWidget` are standalone DOM nodes with their own styling, completely independent of the editor's line-wrapping system. The CSS explicitly set `white-space: pre` on both `.cm-diff-line-removed` and `.cm-diff-removed-text`, with no mechanism to detect or respond to the user's wrap preference.

**Solution Approach:**
Implemented **dynamic CSS class approach** where widgets receive a `cm-diff-wrap` class when word wrapping is enabled, allowing CSS to conditionally apply `white-space: pre-wrap`.

**Implementation Details:**

1. **Modified `diff_decorations.js`:**
   - Added `getWordWrap` callback parameter to `createDiffController` options (line 27)
   - Default implementation returns `false` if not provided
   - Updated `RemovedLineWidget` constructor to accept `(text, wordWrap)` parameters
   - In `RemovedLineWidget.toDOM()`, conditionally add `cm-diff-wrap` class:
     ```javascript
     if (this.wordWrap) {
       lineEl.classList.add('cm-diff-wrap');
     }
     ```
   - Updated `buildDecorations` to accept `getWordWrap` callback
   - Query current wrap state: `const wordWrap = getWordWrap();`
   - Pass wrap state to each widget: `new RemovedLineWidget(line.text || '', wordWrap)`

2. **Modified `template.html` CSS:**
   - Added conditional wrapping rules (lines 107‑108):
     ```css
     .cm-diff-line-removed.cm-diff-wrap { white-space: pre-wrap; word-break: break-word; }
     .cm-diff-line-removed.cm-diff-wrap .cm-diff-removed-text { white-space: pre-wrap; word-break: break-word; }
     ```
   - These rules override the default `white-space: pre` when the `cm-diff-wrap` class is present

3. **Modified `main.js`:**
   - Updated controller initialization (line 157):
     ```javascript
     const diffController = createDiffController({
       fetchDiff: fetchDiffPayload,
       onStatus: handleDiffStatus,
       getWordWrap: () => wordWrap,
     });
     ```
   - Updated word wrap toggle handler (lines 950‑953):
     ```javascript
     bindMenuToggle(miToggleWrap, () => {
       wordWrap = !wordWrap;
       applyMenuState();
       createView(getText());
       if (showInlineDiffs && currentPath && currentPathExists) {
         diffController.refresh(true);  // Rebuild decorations with new wrap state
       }
       persistEditorPreferences({ wordWrap });
     });
     ```

**Result:**
- When word wrap is OFF: Deleted lines use `white-space: pre` (horizontal overflow)
- When word wrap is ON: Deleted lines use `white-space: pre-wrap` (text wraps at viewport edge)
- Toggling word wrap immediately refreshes diff decorations with the new setting
- The wrap state is queried live via callback, ensuring consistency
- Deleted line widgets now match the editor's wrapping behavior exactly

**Flow:**
1. User toggles "View → Word Wrap"
2. `wordWrap` variable updates (true/false)
3. Editor view is recreated with/without `EditorView.lineWrapping` extension
4. `diffController.refresh(true)` is called
5. Controller calls `buildDecorations()` which invokes `getWordWrap()`
6. Each `RemovedLineWidget` is instantiated with current `wordWrap` state
7. Widget's `toDOM()` adds or omits `cm-diff-wrap` class accordingly
8. CSS applies appropriate `white-space` rule based on class presence

**Benefits:**
- Clean separation of concerns (CSS handles styling, JS provides state)
- No inline styles (easier to maintain and override)
- Follows CodeMirror's pattern of using classes for state-dependent styling
- Minimal performance impact (decorations already rebuild frequently)
- User preference respected and persisted across sessions

---

## 10. Alignment Fix: Universal Left Padding (27 Oct 2025 05:00 UTC)

### Issue: Non-Decorated Lines Misaligned with Diff Lines

**Problem:**
Lines without diff decorations (plain lines) were visually offset from lines with diff decorations (added/context/removed). In Python code with indentation, this created a misaligned, hard-to-read appearance where plain lines started approximately 4 characters to the left of diff-decorated lines.

**Root Cause:**
Only lines with the `.cm-diff-line-added` or `.cm-diff-line-context` classes received the left padding to accommodate the diff marker gutter. Plain lines had no decoration applied at all, so they started at column 0.

**CSS Analysis:**
```css
.cm-line.cm-diff-line { 
  padding-left: calc(var(--diff-marker-width) + 0.35rem); 
}
```

This padding (approximately 2rem or 32px, equivalent to 4 characters) was only applied to lines that received a diff decoration class. Regular lines had no class, no padding, and therefore no offset.

**Solution:**
Created a new "plain line" decoration that applies to ALL lines when inline diffs are enabled, ensuring universal left padding.

**Implementation:**

1. **Modified `diff_decorations.js`:**
   - Added `linePlainDeco` constant (lines 62-64):
     ```javascript
     const linePlainDeco = Decoration.line({
       class: 'cm-diff-line cm-diff-line-plain',
     });
     ```
   - Modified `buildDecorations` to apply plain decoration to every line (lines 248-345)
   - Key algorithm change: Process decorations in strict position order
     - Build Map of line numbers → specific decorations
     - Collect deletion widgets in array
     - Sort deletion widgets by line number
     - Walk through lines 1 to N:
       - Add deletion widgets that come before/at this line
       - Add plain decoration (every line)
       - Add specific decoration if line has diff
     - Add remaining deletion widgets after last line

2. **Modified `template.html` CSS:**
   - Added transparent border for alignment (line 86):
     ```css
     .cm-line.cm-diff-line-plain { border-left: 3px solid transparent; }
     ```
   - This ensures plain lines have the same 3px border as diff lines, but invisible
   
   - Fine-tuned deletion widget padding (line 90):
     ```css
     padding: 0 10px 0 calc(var(--diff-marker-width) + 6px);
     ```
   - Reduced from original `+ 10px` to `+ 6px` for pixel-perfect alignment

**Technical Challenge: RangeSetBuilder Sort Order**

CodeMirror's `RangeSetBuilder` requires decorations to be added in strictly ascending position order. Initial implementation failed with error: "Ranges must be added sorted by `from` position and `startSide`"

**Problem:** We were adding all line decorations (1→N), then all deletion widgets, but deletion widgets could be anchored at earlier line positions already processed.

**Solution:** Interleave deletion widgets with line decorations during the single-pass line loop. Since deletion widgets use `side: -1` (appear before position), they must be added BEFORE their anchor line's decorations.

**Result:**
✓ All lines have consistent left padding (4 spaces worth)
✓ Plain lines have invisible 3px transparent border
✓ Diff lines have visible 3px colored border
✓ Deletion widgets aligned with pixel-perfect precision
✓ Python indentation (and all code) displays perfectly aligned
✓ Decorations are unselectable (don't interfere with text selection)
✓ No performance impact (CodeMirror handles line decorations efficiently)

**Flow:**
1. When diffs are enabled, `buildDecorations` is called
2. Parse hunks into `lineDecorations` Map and `deletionWidgets` array
3. Sort `deletionWidgets` by line number
4. For each line 1 to doc.lines:
   - Add deletion widgets before/at this line (side: -1)
   - Add plain decoration (alignment padding)
   - Add specific decoration if line has diff
5. Add remaining deletion widgets after last line
6. CodeMirror renders with perfect alignment

**CSS Box Model:**
- Before (misaligned): Plain lines had no border, diff lines had 3px border
- After (aligned): All lines have 3px border (visible or transparent)
- Deletion widgets: Padding reduced by 4px for perfect text alignment

**Lessons Learned:**
- CodeMirror's decoration system requires strict position ordering
- Multiple decorations can layer at same position (plain + specific)
- Deletion widgets with `side: -1` must precede their anchor line's decorations
- Transparent borders maintain layout without visual impact
- Pixel-perfect alignment requires fine-tuning padding values

