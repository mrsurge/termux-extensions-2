# Draft Diffs Preference Loading Issue - Investigation Report

**Date:** 2025-12-01  
**Issue:** Draft diffs (and associated widgets) appear briefly on first-time page load, then vanish. A page reload fixes the issue.

---

## Executive Summary

The issue appears to be a **race condition** between two separate code paths that both load diff decorations during the initial app worker startup:

1. **NiceGUI iframe page load** (`editor_page()` in `editor_app.py`) - loads diffs immediately
2. **Host boot sequence** (`main()` in `main.js`) - calls `openFile()` ~400ms later which reloads diffs

The first path loads diffs correctly, but the second path (with the 400ms delay) re-calls `set_content` which triggers a fresh diff calculation. If the preferences aren't fully synchronized yet, or if the `set_content` call arrives before the iframe is fully ready, the diffs get cleared.

---

## Initialization Flow

### Phase 1: NiceGUI Page Load (`editor_app.py:519-800`)

```
1. editor_page() starts
2. Load preferences from disk via _preferences_store.get_preferences()
3. Determine initial file from _history_store
4. Read file content, check for cached draft
5. Create CodeMirror editor with constructor args
6. Apply runtime preferences (shading, guides, font scale, etc.)
7. Load diffs via _get_combined_diffs() → editor.set_diff_decorations(hunks)  ← FIRST DIFF LOAD
8. Subscribe to file watcher
```

### Phase 2: Host Boot Sequence (`main.js:2358-2475`)

```
1. main() starts (after iframe loads)
2. syncEditorState(true) - fetch server state
3. refreshMenuState() - load menu settings
4. apiPost('editor/refresh_cache_state') - re-broadcast cache state
5. Wait 150ms
6. fetchPersistedSessionState()
7. initSessionStateContext()
8. Check if file should be opened:
   - If adopting restored session: adoptIframeRestoredDocument()
   - Otherwise: setTimeout(400ms) → openFile()  ← 400ms DELAY
```

### Phase 3: openFile() Triggers set_content (`main.js:1484-1552`)

```
1. openFile() called
2. Check for cached draft via apiPost('editor/check_cache')
3. Read file via apiGet('read')
4. apiPost('editor/set_content', {...}) ← SECOND DIFF LOAD
   - This calls _get_combined_diffs() again
   - Then editor.set_diff_decorations(hunks)
```

---

## Root Cause Analysis

### Theory A: Double Diff Load Race Condition

The diff decorations are loaded **twice**:
1. In `editor_page()` at iframe load time (line 747-748)
2. In `/editor/set_content` endpoint when host calls `openFile()` (line 1228-1229)

If the second load happens before the first has fully rendered to the DOM (JavaScript is async), the second call might:
- Clear the decorations (if hunks are empty due to timing)
- Overwrite with different data

### Theory B: Preferences Not Yet Committed

The `_get_combined_diffs()` function checks:
```python
prefs = _preferences_store.get_preferences().get('editor', {})
if not prefs.get('autoSave', False) and prefs.get('showDraftDiffs', True):
    # compute draft diffs
```

If the preferences file hasn't been written yet on first run, or if there's a race reading from disk, the defaults might not be what's expected.

**Default values in `preferences_store.py`:**
- `autoSave`: `True` (default)
- `showDraftDiffs`: `True` (default)

With defaults: `not True and True` = `False` → Draft diffs should NOT show.

But if `autoSave` is `False` in user prefs: `not False and True` = `True` → Draft diffs SHOULD show.

### Theory C: adoptIframeRestoredDocument vs openFile Branch

In `main.js`, there are two paths:
1. `adoptIframeRestoredDocument()` - syncs host state with already-loaded iframe content
2. `openFile()` - calls `set_content` which reloads everything

The condition for adopting is:
```javascript
if (currentPath && restoredPath && currentPath === restoredPath) {
  await adoptIframeRestoredDocument(restoredPath, restoredSha);
} else {
  // 400ms delay then openFile()
}
```

On **first-time worker startup**, `currentPath` might not be set when this check runs, causing it to fall into the `openFile()` branch which triggers the double-load.

---

## Key Code Locations

### Diff Decoration Application Points

| Location | Line | Trigger |
|----------|------|---------|
| `editor_app.py` | 747-748 | Initial page load |
| `editor_app.py` | 1228-1229 | `set_content` endpoint |
| `editor_app.py` | 1190-1191 | File watcher callback |
| `editor_app.py` | 357-358 | `_persist_to_cache_debounced` |
| `editor_app.py` | 405-406 | `_on_editor_change` |
| `editor_app.py` | 483-484 | `_apply_watcher_replace` |

### Diff Clearing Points

| Location | Line | Condition |
|----------|------|-----------|
| `editor_app.py` | 284 | External change detected |
| `editor_app.py` | 1232 | `set_content` exception |
| `editor_app.py` | 1234 | No path in `set_content` |
| `editor_app.py` | 1736 | `set_content_from_disk` exception |
| `editor_app.py` | 1836 | `save_editor_content` exception |

---

## Potential Fixes

### Fix 1: Skip Diff Load in set_content if Already Loaded

Add a flag to track whether diffs were already loaded during page init:
```python
# In editor_page()
_diffs_loaded_on_init = True

# In set_content endpoint
if not _diffs_loaded_on_init:
    hunks = _get_combined_diffs(...)
    editor.set_diff_decorations(hunks)
```

### Fix 2: Debounce/Coalesce Diff Loads

Use a debounce timer for diff decoration updates:
```python
_diff_update_timer = None

def _schedule_diff_update():
    global _diff_update_timer
    if _diff_update_timer:
        _diff_update_timer.cancel()
    _diff_update_timer = Timer(0.1, _apply_diff_decorations)
    _diff_update_timer.start()
```

### Fix 3: Improve adoptIframeRestoredDocument Detection

Ensure the host adopts the iframe state instead of calling `openFile()`:
```javascript
// Wait for iframe to signal its state before deciding
await new Promise(resolve => setTimeout(resolve, 200));
if (restoredSessionActive) {
  await adoptIframeRestoredDocument(restoredPath, restoredSha);
} else {
  await openFile(serverState.lastFile, ...);
}
```

### Fix 4: Single Source of Truth for Initial Load

Have the NiceGUI page signal to the host when it's done loading, and have the host **not** call `set_content` if the iframe already loaded the file:
```python
# In editor_page() after all init
editor.notify_parent('editor_init_complete', {
    'path': initial_path,
    'sha256': initial_sha256,
    'diffs_loaded': True
})
```

---

## Additional Observations

### Potential Streamlining Opportunities

1. **Redundant Preference Reads:** Both `editor_page()` and `set_content` read preferences from disk. Could cache in memory for the request lifecycle.

2. **Double File Watcher Subscription:** The watcher is subscribed both in `editor_page()` (line 756) and `set_content` (line 1203). The first subscription might not be cleaned up properly.

3. **Duplicate `editor.update()` Calls:** In `set_content`, preferences are applied then `update()` is called (line 1217), but individual preference setters might also trigger updates.

4. **400ms Magic Number:** The `setTimeout(400ms)` in `main.js` is a guess at iframe readiness. A proper handshake would be more reliable.

5. **Console Logging:** Heavy console.log in `applyDiffDecorations` (lines 722-824 in codemirror.js) could slow down first render.

---

## Recommended Next Steps

1. **Add Telemetry:** Log timestamps for each diff load to confirm the race condition theory
2. **Test Fix 3:** Improve the adoption detection logic in main.js
3. **Test Fix 4:** Implement proper iframe-to-host handshake for init completion
4. **Consider Fix 2:** Debouncing would be the most robust long-term solution

---

## Fix Applied (2025-12-01)

The boot sequence in `main.js` was refactored to trust the backend SSOT instead of re-issuing file loads.

### Changes Made

**Removed:**
- `bootAutoOpenTimer` variable
- `bootAutoOpenPath` variable  
- `cancelBootAutoOpen()` function
- `adoptIframeRestoredDocument()` function
- 400ms `setTimeout` delay for deferred file open
- 150ms wait for "iframe to signal restored state"
- Complex branching logic in boot sequence

**Simplified Boot Sequence:**
```javascript
// Before: Complex multi-path logic with 400ms delays
if (fileFromUrl) { ... }
else if (serverState.lastFile && serverState.lastFileExists) {
  if (currentPath && restoredPath && currentPath === restoredPath) {
    await adoptIframeRestoredDocument(...);
  } else {
    setTimeout(400ms, () => openFile(...));
  }
}

// After: Trust the SSOT
if (restoredPath) {
  // Sync host bookkeeping with backend - iframe already loaded the file
  currentPath = restoredPath;
  currentPathExists = !!serverState.lastFileExists;
  lastSha256 = restoredSha;
  updatePathDisplay();
  openWebSocket(restoredPath);
}

// Only call openFile() for explicit URL parameter
if (fileFromUrl && fileFromUrl !== restoredPath) {
  await openFile(fileFromUrl);
}
```

### Why This Works

1. **NiceGUI iframe loads file from SSOT** (`_history_store.get_last_file()`)
2. **Host reads same SSOT** (`/state` endpoint returns `lastFile`, `lastFileSha256`)
3. **Both arrive at same answer** - no synchronization needed
4. **Host just updates its bookkeeping** - doesn't re-issue `set_content`
5. **Diffs loaded once** in iframe, never clobbered by redundant host calls

### Files Modified

- `app/apps/file_editor_cm6/main.js`

---

## Additional Fix: Minimap Initialization Order (2025-12-01)

After the boot sequence fix, diffs still disappeared when scrolling too early. The root cause: **minimap was initialized before diffField existed**.

### The Problem

In `codemirror.js`, the initialization order was:

```javascript
// mounted()
this.updateMinimapState(); // ← Creates minimap with diffField as dependency
                           // But diffField doesn't exist yet!

// Later, Python calls set_diff_decorations()
applyDiffDecorations(hunks) // ← Creates diffField for the first time
                            // Minimap already built without it!
```

The minimap extension uses `this.diffField` as a dependency (line 1151):
```javascript
const deps = this.diffField ? ['doc', this.diffField] : ['doc'];
```

But `this.diffField` was `undefined` during initial mount, so the minimap was built without the diff dependency. When scrolling triggered a minimap update, it would interfere with the diff state.

### The Fix

Created `initDiffCompartments()` method that initializes the diff compartments **before** the minimap:

```javascript
// mounted() - NEW ORDER
this.initDiffCompartments();  // ← Create diffField FIRST (empty)
this.updateMinimapState();    // ← Now minimap can reference diffField
```

The `applyDiffDecorations()` method now just checks if compartments exist and calls `initDiffCompartments()` as a fallback, but normally they're already initialized.

### Why This Works

1. **diffField exists before minimap** - minimap can properly declare it as a dependency
2. **Subsequent updates work correctly** - minimap reconfigures with diffField already in place
3. **No race condition** - initialization order is now deterministic

### Files Modified

- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

---

## Final Fix: File Watcher Diff Override (2025-12-01)

The minimap initialization fix was an optimization, but the actual root cause was found through stack trace debugging.

### The Problem

On cold load, `set_diff_decorations` was being called **twice**:
1. First call: 2 hunks (correct - from `editor_page()` init)
2. Second call: 1 hunk (wrong - from file watcher callback)

Server log showed:
```
[DIFF_TRACE] set_diff_decorations called with 2 hunks
[FILE_WATCH] Skipping initial snapshot, cache was restored
[SESSION_CACHE] Ignoring watcher event for ...; disk matches draft base
[DIFF_TRACE] set_diff_decorations called with 1 hunks  ← WHO CALLED THIS?
```

Stack trace revealed the culprit:
```
File "editor_app.py", line 793, in on_file_change
    editor.set_diff_decorations(diff_data.get('hunks', []))
```

### Root Cause

The file watcher's `on_file_change` callback had this logic:
```python
def on_file_change(event):
    if event.get('type') == 'replace_full':
        # Skip first snapshot if restored from cache
        if not first_snapshot_seen and cached_was_restored:
            first_snapshot_seen = True
            return  # ← First event skipped correctly
        
        first_snapshot_seen = True
        _apply_watcher_replace(...)  # ← Returns False (ignored)
        
        # BUG: Still recalculates diffs even when event was ignored!
        if showInlineDiffs:
            editor.set_diff_decorations(diff_data.get('hunks', []))
```

The watcher fired **twice**:
1. First event: skipped via `first_snapshot_seen` check
2. Second event: `_apply_watcher_replace` returned `False` (ignored because disk matches draft base), but code **still continued** to recalculate diffs

The second diff calculation used **git diffs** (not draft diffs), which had fewer hunks, overwriting the correct draft diffs.

### The Fix

Only recalculate diffs if `_apply_watcher_replace` actually applied content:

```python
was_applied = _apply_watcher_replace(...)
# Only recalculate diffs if content was actually replaced
if was_applied and showInlineDiffs:
    editor.set_diff_decorations(diff_data.get('hunks', []))
```

Also updated `_apply_watcher_replace` return value semantics:
- Returns `True` if content was applied to editor
- Returns `False` if event was ignored (disk matches draft base)

### Files Modified

- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py` (debug tracing, to be removed)

---

## Summary of All Fixes (2025-12-01)

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Diffs appeared then vanished on first load | Host `main.js` called `openFile()` 400ms after iframe loaded, triggering redundant `set_content` | Removed boot `openFile()` call; host now trusts SSOT |
| Diffs disappeared on scroll (cold load only) | File watcher fired twice; second event ignored but still recalculated diffs | Check `_apply_watcher_replace` return value before recalculating |
| Minimap initialization order | Minimap created before `diffField` existed | Added `initDiffCompartments()` called before minimap init |

### Removed Complexity

- `bootAutoOpenTimer` / `bootAutoOpenPath` variables
- `cancelBootAutoOpen()` function
- `adoptIframeRestoredDocument()` function
- 400ms `setTimeout` delay
- 150ms "wait for iframe" delay
- Crash recovery diff re-apply timer (was a workaround, not needed)

### Key Insight

The SSOT pattern (`_history_store`, `_preferences_store`) works correctly. The bugs were caused by:
1. Host not trusting the SSOT and re-issuing commands
2. Callbacks not checking if their triggering action was actually applied

---

_VectorArc, 2025-12-01_
