# Analysis Report: Asterisk Persistence Issue

I've identified the root cause of why the red asterisk doesn't persist after a page reload when a cached draft exists.

## The Problem

**Timeline of events on page load with cached draft:**

1. **main.js initialization** (~line 2108):
   ```javascript
   createView(initialDoc);
   lastSavedContent = getText();
   markUnsaved(false);  // <-- This explicitly sets unsaved = false
   updatePathDisplay();
   ```

2. **NiceGUI iframe loads** (editor_app.py line 476-483):
   - Detects cached session
   - Restores content
   - Broadcasts cache state via `_broadcast_cache_state()`:
     ```python
     state=restored_state or 'mid_session',
     unsaved=cached_entry.get('unsaved', False),
     reason='restore',
     ```

3. **main.js receives cache state** (line 767-772):
   ```javascript
   applyCacheIndicator({
     state: data.state,
     unsaved: data.unsaved,
     reason: data.reason,
     restoredActive: restoredSessionActive,
   });
   ```

4. **applyCacheIndicator updates badge** (line 1303):
   - Badge gets set to red with `*` character ✓
   - Badge state is correctly updated ✓

## The Bug

**The asterisk badge is correctly set to red, BUT the `unsaved` variable in main.js stays `false`!**

Here's why:

1. `markUnsaved(false)` is called during init (line 2112) - sets `unsaved = false`
2. `applyCacheIndicator()` updates the **badge** but does NOT call `markUnsaved(true)`
3. The badge shows red, but the global `unsaved` variable is still `false`
4. Various functions that check `if (unsaved)` will think there are no changes

## The Missing Link

Looking at line 1301:
```javascript
const isActiveDraft = (state === 'mid_session' && unsaved);
```

This checks `info.unsaved` (from the cache state payload), not the global `unsaved` variable. The badge gets updated correctly, but the global state doesn't.

## The Fix Needed

In `applyCacheIndicator()` function (around line 1303-1305), you need to also update the global `unsaved` variable:

```javascript
if (isCrashed || isRestored || isActiveDraft) {
  setIndicatorActive(badge, isCrashed ? '!' : '*');
  badge.dataset.state = isCrashed ? 'crashed' : (isRestored ? 'restored' : 'cached');
  
  // ADD THIS: Sync the global unsaved flag
  markUnsaved(true);  // <-- This is missing!
}
```

## Why This Matters

Without calling `markUnsaved(true)`, these behaviors will be broken:

1. **Line 898**: `fileNameEl.classList.toggle('fe-unsaved', unsaved)` - filename won't show unsaved styling
2. **Line 1627**: Auto-save won't trigger (checks `if (unsaved && currentPath...)`)
3. **Line 1736, 1957, 2156**: Quit/close warnings won't appear (all check `if (unsaved)`)
4. **Line 899**: `syncSessionPath()` won't save the correct unsaved state to session

## Recommended Solution

Add one line in `applyCacheIndicator()`:

```javascript
if (isCrashed || isRestored || isActiveDraft) {
  setIndicatorActive(badge, isCrashed ? '!' : '*');
  badge.dataset.state = isCrashed ? 'crashed' : (isRestored ? 'restored' : 'cached');
  markUnsaved(true); // <-- ADD THIS LINE
} else {
  if (!restoredSessionActive) {
    setIndicatorInactive(badge);
    badge.dataset.state = '';
    markUnsaved(false); // <-- And also add this for symmetry
  }
}
```

This will ensure that whenever the badge turns red, the global `unsaved` flag is also set to `true`, keeping all the UI states in sync.
