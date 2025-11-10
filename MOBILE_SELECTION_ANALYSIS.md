# Mobile Native Selection System Analysis - CM6 File Editor

## Overview

The CM6 file editor implements a custom native mobile selection system designed specifically for Android devices. The system temporarily enables Android's native text selection handles by dynamically modifying the CodeMirror 6 editor's DOM properties.

## Selection Method Traced

### Core Mechanism

**Location:** `app/apps/file_editor_cm6/main.js` (lines 1537-1726)

The selection system uses the following approach:

1. **Trigger Methods:**
   - Long-press detection (450ms threshold)
   - Double-click/tap

2. **Activation Process:**
   When triggered, the system executes `enableNativeSelection()`:
   ```javascript
   - Sets `.cm-content` element's `contenteditable` attribute to `'true'`
   - Applies `webkitUserModify: 'read-write-plaintext-only'`
   - Sets `userSelect: 'text'`
   - Focuses the content element
   ```

3. **Empty Line Handling:**
   - Injects WORD JOINER characters (`\u2060`) into empty lines via CM6 decoration widgets
   - Provides invisible anchors for selection on blank lines
   - Enabled only during active selection via a Compartment

4. **Deactivation Triggers:**
   - User starts typing (`beforeinput` event)
   - Selection collapses
   - Focus leaves editor
   - Click/pointer outside editor
   - Page visibility changes

## Identified Issues

### 1. **Race Condition with Touch Events**

**Severity:** Medium

**Issue:** The long-press timer can conflict with scroll gestures:
- `touchstart` begins timer (450ms)
- `touchmove` cancels timer
- `touchend` also cancels timer

However, rapid tap-scroll-tap sequences could trigger unintended selection mode if the touch coordinates land within editor bounds during a scroll momentum phase.

**Impact:** Occasional spurious selection mode activation during rapid scrolling.

### 2. **Incomplete Autosave State Restoration**

**Severity:** Low-Medium

**Issue:** Line 1632-1635:
```javascript
if (autoSaveWasEnabled) {
  console.log('[NativeSelection] Re-enabling autosave');
  autoSaveWasEnabled = false;  // ← Sets to false but doesn't restore autoSaveEnabled
}
```

The logic stores the pre-selection state but doesn't actually restore `autoSaveEnabled` when exiting selection mode.

**Impact:** Autosave remains disabled after selection until user manually toggles or reopens file.

### 3. **Memory Leak Risk in Cleanup Debounce**

**Severity:** Low

**Issue:** The `cleanupDebounce` timer (line 1545) is cleared but never explicitly nulled after execution. Multiple rapid selection toggles could accumulate stale timeout references.

**Current code:**
```javascript
clearTimeout(cleanupDebounce);
cleanupDebounce = setTimeout(() => { ... }, 120);
```

**Impact:** Minor memory overhead in edge cases with frequent selection mode cycling.

### 4. **Selection Change Event Listener Efficiency**

**Severity:** Low

**Issue:** Line 1708:
```javascript
document.addEventListener('selectionchange', requestDisableIfIdle, true);
```

This listener fires on **every** selection change across the entire document, not just the editor. The `requestDisableIfIdle` function checks `nativeSelectionActive` flag, but the event still triggers for all text selections in menus, dialogs, etc.

**Impact:** Unnecessary function calls and debounce timer churn when selecting text in other UI elements.

### 5. **Double-Click Prevention Side Effect**

**Severity:** Low

**Issue:** Lines 661-666 completely disable CM6's double-click word selection:
```javascript
exts.push(EditorView.domEventHandlers({
  dblclick: (event, view) => {
    event.preventDefault();
    return true;
  }
}));
```

This is done globally (always active), even when native selection isn't active. Users lose double-click word selection in non-mobile contexts (desktop browsers).

**Impact:** Reduced UX consistency on desktop environments.

### 6. **Commented-Out ZWSP Purge Function**

**Severity:** Informational

**Issue:** Lines 1566-1583 contain a commented-out ZWSP (Zero-Width Space) purge function, suggesting the old approach used `\u200B` characters that needed cleanup. The current implementation uses WORD JOINER (`\u2060`) via decorations, which are ephemeral and don't persist in the document.

However, the copy handler (line 1692) still strips both characters:
```javascript
const text = sel.toString().replace(/[\u200B\u2060]/g, '');
```

**Impact:** None functionally, but indicates incomplete refactoring/cleanup.

## Improvement Recommendations

### 1. **Fix Autosave Restoration**
```javascript
function disableNativeSelection(scrubDoc = false) {
  // ... existing code ...
  
  // Re-enable autosave if it was on before
  if (autoSaveWasEnabled) {
    console.log('[NativeSelection] Re-enabling autosave');
    autoSaveEnabled = true;  // ← Add this line
    autoSaveWasEnabled = false;
  }
}
```

### 2. **Scope Selection Change Listener**
```javascript
// Replace document-level listener with editor-specific:
cmHost.addEventListener('selectionchange', requestDisableIfIdle, true);
```

Alternative: Add early guard in `requestDisableIfIdle`:
```javascript
function requestDisableIfIdle(reason = '') {
  if (!nativeSelectionActive) return;
  
  // Check if selection is actually in editor before debouncing
  const sel = document.getSelection();
  const cmContent = cmHost?.querySelector('.cm-content');
  if (!sel || !cmContent || !cmContent.contains(sel.anchorNode)) {
    return; // Selection not in editor, ignore
  }
  
  clearTimeout(cleanupDebounce);
  // ... rest of function
}
```

### 3. **Improve Touch Gesture Detection**
Add velocity/distance threshold to distinguish intentional long-press from scroll:
```javascript
let touchStartX = 0, touchStartY = 0;

cmHost.addEventListener('touchstart', (ev) => {
  touchStartX = ev.touches[0].clientX;
  touchStartY = ev.touches[0].clientY;
  scheduleLongPress(ev);
}, { passive: true });

cmHost.addEventListener('touchmove', (ev) => {
  const deltaX = Math.abs(ev.touches[0].clientX - touchStartX);
  const deltaY = Math.abs(ev.touches[0].clientY - touchStartY);
  const MOVE_THRESHOLD = 10; // pixels
  
  if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
    cancelLongPress();
  }
}, { passive: true });
```

### 4. **Conditional Double-Click Prevention**
Only disable CM6's double-click on mobile/touch devices:
```javascript
// In makeExtensions():
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

if (isTouchDevice) {
  exts.push(EditorView.domEventHandlers({
    dblclick: (event, view) => {
      event.preventDefault();
      return true;
    }
  }));
}
```

### 5. **Explicit Cleanup Timer Nullification**
```javascript
function requestDisableIfIdle(reason = '') {
  if (!nativeSelectionActive) return;
  
  if (cleanupDebounce) {
    clearTimeout(cleanupDebounce);
    cleanupDebounce = null;  // ← Add explicit null
  }
  
  cleanupDebounce = setTimeout(() => {
    // ... existing logic ...
  }, 120);
}
```

### 6. **Layout Lock Telemetry**
The `layoutLocks` counter mechanism is solid, but add defensive reset:
```javascript
function disableNativeSelection(scrubDoc = false) {
  // ... existing code ...
  
  // Force unlock in case of counter drift
  layoutLocks = 0;
  unlockLayout();
}
```

## System Strengths

1. **Compartment-Based Widget Management:** Using CM6's Compartment for empty line anchors is elegant and ensures clean enable/disable without recreating the entire view.

2. **Layout Locking:** The diff decoration suspension during selection prevents expensive DOM rerenders.

3. **Multi-Trigger Support:** Supporting both long-press and double-click accommodates different user preferences.

4. **Clipboard Scrubbing:** Proactively cleaning invisible characters from clipboard ensures clean paste operations elsewhere.

5. **Comprehensive Deactivation:** Multiple exit triggers (blur, visibility change, pointerdown outside) prevent stuck selection mode.

## Conclusion

The native mobile selection system is well-architected overall, with the contenteditable toggle approach being the correct solution for Android's text selection APIs. The primary issues are minor bugs (autosave restoration) and efficiency optimizations (scoped event listeners). The system would benefit from the suggested touch gesture improvements and conditional double-click handling for better cross-platform behavior.

**Confidence Level:** High - The mechanism is clearly traced through event handlers, DOM manipulation, and CM6 extension system.
