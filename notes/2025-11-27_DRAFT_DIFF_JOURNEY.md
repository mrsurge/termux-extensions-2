# Draft Diff Engine Architecture & Interaction Log

**Date:** November 27, 2025
**Scope:** File Editor CM6 - Session Cache & Diffing Engine

---

## 1. Intended Architecture: Draft Diff Engine

The Draft Diff Engine is designed to visualize changes between the **Editor Buffer** (unsaved draft) and the **File on Disk** (ground truth), specifically when the application is in "Drafting Mode" (Autosave OFF).

### Core Principles
1.  **Dual Mode Support:** The system supports two distinct diffing strategies that can theoretically run simultaneously (though currently mutually exclusive via Autosave setting).
    *   **Git Diffs (Green/Red):** Compares Disk vs Git HEAD. Used when Autosave is ON.
    *   **Draft Diffs (Blue/Yellow):** Compares Editor Buffer vs Disk. Used when Autosave is OFF.
2.  **Stateless Styling:** Visual differentiation is driven by the data, not global state.
    *   "Git" decorations use `type: 'add'` / `'del'`.
    *   "Draft" decorations use `type: 'add-draft'` / `'del-draft'`.
    *   The frontend renders distinct CSS classes based on these types, ensuring styles persist across reloads/reconnects without relying on fragile "mode" flags.
3.  **Live Calculation:** Draft diffs are computed in real-time (debounced) as the user types, leveraging the session cache persistence loop.

### Component Breakdown

#### Backend (`editor_app.py` & `draft_diff_helper.py`)
*   **Logic Switch:** The persistence loop (`_persist_to_cache_debounced`) checks the `autoSave` preference.
    *   If **OFF**: Reads disk content, computes diff against editor content using `difflib`, and broadcasts hunks with `*-draft` types.
    *   If **ON**: Relies on existing file watcher to broadcast Git diffs.
*   **Preference Management:** `update_preference` handles mode switching when `autoSave` or diff visibility toggles are clicked, immediately refreshing the editor decorations.

#### Frontend (`codemirror.js` & `codemirror.py`)
*   **Decoration Builder:** `buildDiffDecorations` iterates through hunks.
    *   Detects `add-draft` → Applies `.cm-diff-line-added-draft` (Blue).
    *   Detects `del-draft` → Creates `RemovedLineWidget(isDraft=true)` → Applies `.cm-diff-line-removed-draft` (Yellow).
*   **CSS Injection:** Styles are injected into the iframe via `editor_app.py` (not the host template), defining the Blue/Yellow color scheme.

---

## 2. Files Touched & Modifications

### Configuration & Stores
*   **`app/apps/file_editor_cm6/preferences_store.py`**:
    *   Added `"showDraftDiffs": True` to `DEFAULT_EDITOR_PREFS`.

### Host Frontend (App Shell)
*   **`app/apps/file_editor_cm6/template.html`**:
    *   Removed `fe-confirm` modal HTML (Nuked).
    *   Renamed "Show Inline Diffs" to "Show Git Diffs".
    *   Added "Show Draft Diffs" menu item (`mi-toggle-draft-diffs`).
*   **`app/apps/file_editor_cm6/main.js`**:
    *   **Session Cache Fixes:**
        *   Refactored `applyCacheIndicator` to be a permanent UI element (Grey/Red toggle).
        *   Implemented "Message Bus" listener for `draft_state` to fix persistence race conditions.
        *   Implemented "Handshake" (`refresh_cache_state`) on boot.
        *   Removed `showConfirm` logic from `miNew` and `Ctrl+N`.
    *   **Menu Logic:**
        *   Bound `miToggleDraftDiffs` to `updatePreference('showDraftDiffs')`.

### NiceGUI Iframe Backend
*   **`app/apps/file_editor_cm6/nicegui_editor/editor_app.py`**:
    *   **CSS Injection:** Added `.cm-diff-mode-draft` and specific `*-draft` class definitions (Blue/Yellow variables).
    *   **Endpoints:** Added `/editor/refresh_cache_state` for frontend handshake.
    *   **Logic:**
        *   Updated `_persist_to_cache_debounced` to compute draft diffs.
        *   Updated `update_preference` to handle separate `showInlineDiffs` (Git) and `showDraftDiffs` (Draft) flags based on `autoSave` state.
        *   Updated initialization logic to respect the correct mode on load.

### Logic Helpers
*   **`app/apps/file_editor_cm6/draft_diff_helper.py`** (The Relic):
    *   Updated `compute_draft_diff` to return `add-draft` and `del-draft` types instead of generic types.

### Vendored CodeMirror
*   **`app/static/vendor/nicegui/elements/codemirror/codemirror.py`**:
    *   Added `set_diff_mode` (deprecated/removed in final refactor, but initially added).
    *   Added `notify_parent` for message bus.
*   **`app/static/vendor/nicegui/elements/codemirror/codemirror.js`**:
    *   Added `notifyParent` method.
    *   Updated `RemovedLineWidget` to accept `isDraft` param.
    *   Updated `buildDiffDecorations` to handle `*-draft` types and apply distinct styling classes.

---

## 3. Interaction History

### Phase 1: Session Cache Stabilization
1.  **Initial State:** Repo was reset. Features existed but were buggy/disconnected.
2.  **Discard Fix:** The "Discard Draft" button (asterisk) was broken. We fixed the `api.delete` call to include the required `project` parameter.
3.  **Indicator Persistence:** The asterisk would disappear or turn grey after reload due to race conditions.
    *   **Solution:** We re-implemented the "Message Bus" (iframe -> host communication) to allow the backend to explicitly signal "Draft Restored" (`draft_state`).
    *   **Handshake:** Added a `refresh_cache_state` call on frontend boot to catch "missed messages".
    *   **UI Refactor:** Changed the asterisk from "Hidden/Visible" to "Grey/Red" to prevent layout shifts and flickering.
4.  **Dialog Nuke:** Removed the redundant "Unsaved Changes" confirmation dialogs from New/Keyboard shortcuts, relying entirely on the session cache for safety.

### Phase 2: Draft Diff Engine POC
1.  **Concept:** Use `draft_diff_helper.py` (a file that survived the reset) to compute diffs between the Editor and Disk when Autosave is OFF.
2.  **Initial Attempt (Mode Switching):**
    *   Implemented a toggle that added a `.cm-diff-mode-draft` class to the editor wrapper.
    *   **Bug:** On Android/Mobile suspend-resume, the editor would revert to "Git Colors" (Red/Green) because the wrapper class was lost/reset, even though draft diffs were showing.
3.  **Refactor (Stateless Styling):**
    *   **Strategy Shift:** Instead of a global mode class, we moved the semantic meaning into the diff data itself.
    *   **Implementation:** `draft_diff_helper` now emits `add-draft` / `del-draft`. The frontend renderer (`codemirror.js`) sees these specific types and applies specific CSS classes (`.cm-diff-line-added-draft`).
    *   **Result:** Visuals are now tied to the data. If the backend sends a draft diff, it renders Blue/Yellow regardless of environment state.
4.  **Explicit Control:** Added a specific "Show Draft Diffs" menu item to decouple it from "Show Git Diffs", preparing the architecture for a future "Dual Mode" where both could be visi
ble simultaneously.
# Draft Diff Engine Analysis

## 1. Issue: "Git Red" instead of "Draft Yellow" for Deletions

**Diagnosis:**
The issue lies in the frontend rendering logic within `app/static/vendor/nicegui/elements/codemirror/codemirror.js`.

While `RemovedLineWidget` correctly accepts an `isDraft` flag and applies the `.cm-diff-line-removed-draft` class to the *content* of the deleted line (rendering the text yellow), the **gutter marker** (the "-" symbol) does not distinguish between draft and git diffs.

The `widgetMarker` callback in `diffGutterExtension` unconditionally returns `minusMarker` for any `RemovedLineWidget`:

```javascript
// codemirror.js
widgetMarker: (view, widget, block) => {
  if (widget instanceof RemovedLineWidget) {
    return minusMarker; // Always returns the standard (red) marker
  }
  return null;
}
```

The `minusMarker` is an instance of `MinusGutterMarker`, which renders a span with class `.cm-diff-minus-marker`. In `editor_app.py`, this class is styled with red:

```css
/* editor_app.py */
.cm-diff-minus-marker {
  /* ... */
  color: var(--diff-del-marker); /* Red */
}
```

**Recommended Fix:**
1.  **Frontend (`codemirror.js`):** Create a `MinusDraftGutterMarker` class that renders a span with class `.cm-diff-minus-marker-draft`. Update the `widgetMarker` logic to check `widget.isDraft` and return the appropriate marker.
2.  **Backend (`editor_app.py`):** Add CSS definition for `.cm-diff-minus-marker-draft` using the yellow draft color variables.

---

## 2. Issue: Draft Content Clearing on Restart

**Diagnosis:**
The draft content is being correctly restored from the `HistoryStore` sidecar on startup, but is immediately overwritten and cleared by the file watcher.

1.  **Startup Sequence:** `editor_page` initializes, restores the draft from cache, and sets `cached_was_restored = True`.
2.  **Subscription:** It subscribes to the file watcher. `subscribe` immediately calls the callback with a snapshot. The logic correctly ignores this *first* snapshot using `first_snapshot_seen` flag.
3.  **The Double Event:** `core_read.py`'s `PollingWatcher` (used as fallback or on systems where `watchdog` triggers initial events) performs an initial scan and emits `modified` events for existing files. This results in a **second** `replace_full` event sent to `on_file_change`.
4.  **Overwrite:** `on_file_change` processes this second event. It calls `_apply_watcher_replace`, which:
    *   **Unconditionally** sets the editor content to the disk content (wiping the draft from the editor).
    *   Compares the draft SHA (cached) with the disk SHA (event). Since they differ (due to the unsaved draft), it interprets this as an "External Edit" and **clears the session cache sidecar**.

**Recommended Fix:**
In `editor_app.py`, update `on_file_change` (or `_apply_watcher_replace`) to check if the incoming event's SHA matches the current session's **Base SHA** (`initial_sha256`).

If `event_sha256 == base_sha256`, it implies the file on disk has *not* changed since the draft was created (or the session started). The event is redundant and should be ignored to preserve the draft.

```python
# Logic to add in on_file_change:
current_base = get_current_file_sha256()
if current_base and new_sha256 == current_base:
    # Disk matches what we based our draft on; ignore spurious watcher event
    return
```

---

## 3. Code Consistency Checks

*   **`draft_diff_helper.py`**: Correctly returns `del-draft` and `add-draft` types. Logic is sound.
*   **`preferences_store.py`**: Correctly includes `"showDraftDiffs": True` in defaults.
*   **CSS Injection**: `cm-diff-line-added-draft` and `cm-diff-line-removed-draft` are correctly defined with Blue/Yellow styling.

The implementation is largely solid, with the exception of the two specific issues identified above.


---
Signed-off-by: Jimmy - TE2 Contributor
Date: November 27, 2025
# Draft Diff Feature – Implementation Notes

## Findings

### 1. Draft deletions inherit git styling
- The backend now emits `del-draft` lines (`app/apps/file_editor_cm6/draft_diff_helper.py`) and the frontend marks draft deletions with `.cm-diff-line-removed-draft`. However, the injected CSS defines the draft-specific styles at `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:610-631` and later redefines the base `.cm-diff-line-removed` block at `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:732-766`. Because both selectors have the same specificity and the git rule comes last, the git background/border wins and deletions stay “git red”. That explains why the UI never shows the intended “draft yellow”, even though the data pipeline is emitting the right `*-draft` types described in `tmp.md`.
- **Impact:** Draft deletions are visually indistinguishable from git deletions, so the “stateless styling” requirement in @docs/core/nicegui_iframe_feature_adding_guideline.md is not met—the visualization does not follow the data.
- **Fix idea:** Either move the `.cm-diff-line-removed-draft` block after the base git styles or add `!important` overrides (similar to the added-line rule) so the yellow palette wins.

### 2. Switching files wipes other cached drafts
- `/editor/set_content` now deletes the cached draft for whichever file was active before switching (`app/apps/file_editor_cm6/nicegui_editor/editor_app.py:851-865`). Any time the host opens a different file, `_history_store.clear_cached_document` is invoked for the previously open path even if the user never discarded or saved that draft.
- This contradicts the documented contract that cache cleanup only happens on explicit discard/save or when a watcher detects an external overwrite (`docs/apps/code_cm6/TECHNICAL.md:1763-1784`). It also defeats the purpose of the disk-backed cache described in Section 13.1; only the currently focused file survives a worker restart. That matches the reported behaviour (“after the worker restarts it clears all draft content”) because every background draft was deleted the moment the user navigated away.
- **Fix idea:** Remove the unconditional clear. Navigation should leave the previous file’s sidecar alone so it can be restored later unless the user explicitly discards, saves, or an external edit invalidates it.

### 3. Navigation/watchers still force git diffs when Autosave is OFF
- The new architecture in tmp.md calls for “Dual Mode Support”—git diffs when Autosave is ON, draft diffs (blue/yellow) when it is OFF. The initialization path follows that rule, but the shared helper paths do not:
  - `set_content` always recomputes git diffs when `showInlineDiffs` is true, even if Autosave is off (`app/apps/file_editor_cm6/nicegui_editor/editor_app.py:925-932`). Draft-specific toggles aren’t consulted, and the `else` branch simply clears decorations.
  - The watcher callback registered in the same function also re-runs `collect_diff` (git) on every disk change without checking `autoSave` (`app/apps/file_editor_cm6/nicegui_editor/editor_app.py:889-905`).
- As a result, entering “drafting mode” via the Autosave toggle still renders HEAD vs disk diffs (red/green) whenever a file is opened or refreshed, overriding the expected draft palette until the debounced draft diff routine runs again. This is inconsistent with the documented design and makes the feature feel broken even if the CSS were fixed.
- **Fix idea:** Gate those git `set_diff_decorations` calls behind `autoSave` and add the symmetric `showDraftDiffs` branch so that navigation + watcher updates respect whichever mode the preference store currently advertises.

## Notes
- I didn’t modify the codebase per the request; this file only documents the issues I found.

---

Signed: Dex - TE2 Contributor — 2025-11-27T22:25Z

## Addendum – External Reports Review (2025-11-27T22:25Z)

### tmp5.md – “Draft Diffing Implementation Analysis” (Atlas)
- The observations about direct `editor.value` reads ignore that Code CM6 runs as a single-user code-server style app. Every handler in `editor_app.py` executes on the same thread as the NiceGUI loop, so grabbing `editor.value` during preference toggles does not race another client. Swapping in `_get_cached_editor_content()` would be tidier, but it is not the root cause of draft instability and won’t fix the restart-loss regression.
- The “blocking file I/O” critique is technically correct (reads happen synchronously), yet we’re talking about local disk reads inside Termux on a single device. The debounce already caps it at ~1 read/sec, so the larger problem is that `_apply_watcher_replace` clears drafts unconditionally—not that the reads are sync. Converting to `anyio.to_thread` would be nice-to-have, not the reason the feature broke.
- Atlas is right that we duplicated diff-refresh snippets, but that duplication is why draft mode even renders at startup today—the helpers were intentionally forked while we figure out dual-mode coexistence. Consolidating prematurely is what created the original red/green coupling; I’d rather fix the behavior (CSS precedence + mode gating) before we try to dedupe again.
- The report leans heavily on multi-user safety (telemetry, cache hit tracking, etc.). Those guardrails matter when multiple browsers hit the same worker, but Code CM6 explicitly mirrors code-server’s single-user expectations. The immediate regressions are visual styling and watcher thrash, not the lack of global analytics instrumentation.

### tmp8.md – “Draft Diff Engine Analysis” (Jimmy)
- Jimmy’s diagnosis of the color bug focuses on the gutter “−” marker. That marker does stay red, but even if we add a `MinusDraftGutterMarker`, the body of the deleted line will still render red because `.cm-diff-line-removed` is defined *after* `.cm-diff-line-removed-draft` in `editor_app.py`. The later rule wins with the same specificity, so the widget styling never applies. We have to fix the CSS ordering (or add `!important`), otherwise the gutter tweak alone won’t give us the yellow background users expect.
- The restart/“double watcher event” theory rightly points at `_apply_watcher_replace`, but the proposed SHA comparison misses how the cache currently works. That helper rewrites the editor with disk content **before** it looks at the cached entry, and then it compares the cached draft’s `content_sha256` (which reflects the user’s unsaved edits) against the incoming disk SHA. Those will always differ after a crash restore, so the sidecar gets deleted even without an actual file change. The fix isn’t just “ignore if watcher SHA equals base”; we need to stop overwriting the editor + cache when the watcher fires during a restored session, or at least compare against the cached **base** SHA before mutating anything.
- Net: Jimmy’s report captures the symptoms but only halfway to the cause. The yellow styling failure is CSS precedence, and the draft-loss issue is `_apply_watcher_replace` nuking content before it consults the cache, not an extra watcher event per se.

---

## Next Steps (2025-11-27T22:44Z)
1. **Fix draft deletion styling precedence**
   - Move the `.cm-diff-line-removed-draft` block (or add `!important` flags) so it lives *after* the `.cm-diff-line-removed` definition inside `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`, guaranteeing the yellow palette wins for draft widgets.
   - Mirror the change for the gutter marker by adding a `.cm-diff-minus-marker-draft` class and toggling it inside `codemirror.js` only after the base rule ordering is corrected.
2. **Respect diff mode in navigation/watchers**
   - In `set_content` and the associated watcher callback, gate the git diff refresh behind `autoSave` and add the complementary draft branch so navigation doesn’t immediately revert to red/green when Autosave is OFF.
   - Extract a helper (e.g., `_refresh_diff_mode(mode, path, content)`) so both code paths call the same logic and we don’t regress again during dual-mode work.
3. **Guard single-document sidecar through restart**
   - Keep the existing “one active document” policy, but harden `_apply_watcher_replace` for the currently focused file: before it overwrites the editor, check whether we just restored a draft (e.g., `_broadcast_cache_state` reason `restore`) and ensure the incoming watcher SHA differs from the stored `base_sha256`. If the watcher event matches the base snapshot, ignore it so the draft stays intact.
   - When we do detect a genuine external change (SHA differs from `base_sha256`), continue clearing the cache exactly once so the single-document invariant remains intact.
4. **Add regression test harness (optional but recommended)**
   - Script the “restore after crash” scenario Jimmy is trying to reproduce: write draft via `_persist_to_cache_debounced`, restart worker, assert the cache survives and the editor still contains the draft after the watcher stabilizes.

Signed: Dex - TE2 Contributor — 2025-11-27T22:50Z

A couple concrete ways we can evolve this without touching the repo yet:

- **Represent both layers explicitly.** Instead of reusing the same API, add a “multi-diff” payload so the backend can send `{git: [...], draft: [...]}`. The JS side can maintain two compartments (one for git, one for draft) or a combined builder that preserves both sets simultaneously. That keeps the data stateless—the decorations you see reflect exactly which arrays are populated.

- **Introduce a deliberate “combined” mode.** Today we infer the mode from `autoSave`. We could make it explicit: `mode='git'`, `mode='draft'`, or `mode='combined'`. When Autosave is OFF and both toggles are true, we switch to `combined` and render both arrays at once. CSS already distinguishes `'add'` vs `'add-draft'`, so as long as the decoration data includes both types at the same time, the existing stateless styling plan snaps into place.

- **Backend helper to assemble the payload.** Pull the diff refresh logic into one helper that:
  1. Computes git hunks if `showInlineDiffs` is on (regardless of autosave).
  2. Computes draft hunks if `!autoSave && showDraftDiffs`.
  3. Returns both hunks so callers don’t fight over the same API.
  That helper becomes the single source of truth for `_persist_to_cache_debounced`, the watcher callbacks, and the preference toggles.

- **Codemirror support.** On the JS side, we either:
  1. Extend `applyDiffDecorations` to accept the new object and internally call `buildDiffDecorations` twice, inserting both sets into separate `RangeSet`s so they can overlap, or
  2. Add a new method (e.g., `applyCombinedDiffs`) that installs two state fields—`gitDiffField` and `draftDiffField`. Each field gets its own gutter classes (`cm-diff-line-added` vs `cm-diff-line-added-draft`) and they coexist without clobbering each other.

- **UX expectations.** Combined mode only makes sense when Autosave is OFF (there’s actually a draft). If someone enables “Show Git Diffs” while Autosave is ON, we keep today’s behavior (just git). If they then disable Autosave without touching toggles, we flip into combined mode automatically because both checkboxes are already true.

I’d start by sketching that helper + payload shape on the backend and a complementary JS method that can render both sets at once; once the data model supports both hunks simultaneously, the rest of the race conditions disappear by construction.

- Dex.

2025-11-27_16:00-CST
# Plan: Treat Clean Sidecars as Non-Restored Sessions (Option 2)

Goal: Prevent the editor from flagging every reload as a restored session by recognizing when a cache entry represents a clean buffer (`unsaved=False`). This keeps the single-document cache pipeline intact and prepares us for future multi-file sessions.

## Step 1 – Audit cache consumers
- Confirm every path that reads cached entries (`editor_page`, `/editor/refresh_cache_state`, `/editor/cache_state`) simply checks for entry presence, not `unsaved`.
- Note: these are currently in `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (lines ~420-470, 820-860) and `app/apps/file_editor_cm6/main.py` for the REST endpoint.

## Step 2 – Update `editor_page` restore logic
- After fetching `cached_entry = _history_store.get_cached_document(...)`, inspect `cached_entry.get('unsaved', False)`.
- If `unsaved` is false (or missing), skip the restore path entirely:
  * Do **not** overwrite `initial_content`.
  * Broadcast `state='clean'` rather than `mid_session`.
  * Avoid sending the “Restored unsaved draft” notification and `draft_state` postMessage.
- If `unsaved` is true, keep the existing restore workflow (load cached content, mark state `mid_session`/`crashed`).

## Step 3 – Align broadcast helpers
- `_broadcast_cache_state` currently reuses whatever entry we pass. Ensure callers that send cache payloads after init also skip the “restored” reason when `unsaved=False`.
- Example: `/editor/refresh_cache_state` should detect clean entries and return `state='clean'`, avoiding the forced badge toggle on the frontend.

## Step 4 – REST `/editor/cache_state`
- `get_cache_state` (query endpoint) should mirror the same behavior: when `unsaved=False`, respond with `state='clean'` so external consumers don’t mistake a clean sidecar for an active draft.

## Step 5 – Telemetry/logging adjustments
- Optional but recommended: when we encounter a clean sidecar, log once that it was skipped (helps confirm behavior during roll-out).
- No change to `HistoryStore`; we still retain the entry, keeping the path open for future multi-file caches.

## Step 6 – Validation checklist
- Open file, make no edits, reload: state should stay “clean”, no warning.
- Open file, type once (draft exists), reload: state should be “mid_session” and restore as today.
- Save file after editing (sidecar written with `unsaved=False`): reload should now be clean again.
- Regression tests: discard draft, toggle autosave/diff prefs, ensure cache state events remain accurate.

- Dex

2025-11-27_16:47

### Option 2 implement and tested
 - all testing looks good 👍
 - mrSurge - TE2 Team
