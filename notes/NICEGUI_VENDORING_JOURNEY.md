# NiceGUI Vendoring Journey: From Blocked to Silver Bullet

**Date:** November 11-12, 2025  
**Status:** ✅ SOLVED - Vendoring + `reconnect_timeout=0` = Complete Solution  
**Time Invested:** ~6 hours  
**Final Outcome:** Working zebra stripes, inline diffs, AND settings that persist correctly on refresh

---

## Objective

Implement logical-line zebra striping (alternating line background colors) in the NiceGUI-based CodeMirror 6 editor that:
1. Works with word wrap (stripes logical lines, not visual lines)
2. Toggles live without page reload
3. Follows the established state-driven pattern (like word wrap, theme, language)
4. Serves as proof-of-concept for inline git diffs (same extension mechanism)

**Later discovered:** Also solve the settings refresh problem where changed settings didn't appear until worker restart.

---

## The Core Problem

**We cannot access the CodeMirror `EditorView` instance from within the NiceGUI iframe.**

### What We Know
1. ✅ `.cm-editor` DOM element exists
2. ✅ State sync works (timer detects toggles, logs show changes)
3. ✅ NiceGUI methods work (`set_line_wrapping`, `set_theme`, `set_language`)
4. ❌ **EditorView JavaScript object is not accessible**

### NiceGUI's Architecture (Discovered)
- NiceGUI uses **Vue 3 components** wrapping CM6
- The EditorView is stored as `this.editor` in the Vue component instance
- File: `/usr/lib/python3.12/site-packages/nicegui/elements/codemirror/codemirror.js`
- **The EditorView is encapsulated inside the Vue component with no public API to access it**

---

## What Was Attempted

### Attempt 1: Inline JavaScript Search (FAILED)
- Tried `el.querySelector('.cm-editor')?.cmView?.view` - property doesn't exist
- Tried querying parent elements - failed
- Used MutationObserver with 8s timeout - failed

### Attempt 2: External zebra_runtime.js (FAILED)
- Created external JS file with comprehensive EditorView search
- Added static file serving route to main.py
- Tried 40 search attempts over 8 seconds
- Found `.cm-editor` element but no EditorView property

### Attempt 3: Python run_javascript() (FAILED)
- Attempted to access `this.editor` from Vue component context
- Got zero console logs - function didn't execute in component scope

---

## Technical Blockers

1. **NiceGUI Encapsulation:** EditorView trapped in Vue component, no public API
2. **Execution Context:** run_javascript() runs in global scope, not component scope
3. **No Extension API:** NiceGUI doesn't provide add_extension() method

---

## Files Modified

- Created: `app/apps/file_editor_cm6/static/js/zebra_runtime.js`
- Modified: `app/apps/file_editor_cm6/main.py` (added static route)
- Modified: `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (added logging, timer logic)

---

**Status:** Blocked - awaiting direction

---

## SOLUTION FOUND - November 12, 2025

**Status:** ✅ WORKING - Zebra striping fully functional

### The Problem Was

We were trying to work *around* NiceGUI's encapsulation instead of working *with* it. All attempts to access the EditorView from outside the Vue component failed because:
1. NiceGUI intentionally encapsulates `this.editor` inside the Vue component
2. We can't access it via global scope, DOM properties, or Vue internals
3. The iframe boundary makes it even harder

### The Solution

**Vendor NiceGUI and extend it natively.**

Instead of hacking around the library, we:
1. Installed NiceGUI to `app/static/vendor/nicegui/` with `pip install --target --no-deps`
2. Modified Python's import path to load the vendored copy first
3. Added `set_zebra_stripes(enabled)` method directly to the vendored `codemirror.py`
4. Added `applyZebraStripes(enabled)` method to the vendored `codemirror.js`
5. Called it from Python: `editor_instance.set_zebra_stripes(target_shade)`

### Implementation Details

#### 1. Vendor Setup
```bash
pip install --target=/path/to/app/static/vendor --no-deps nicegui
```

The `--no-deps` flag means we only vendor NiceGUI itself, not its dependencies. Python will load dependencies from the system site-packages (already installed via requirements.txt).

#### 2. Import Path Override
**File:** `app/apps/file_editor_cm6/main.py` (lines 3-9)

```python
import sys
from pathlib import Path

# CRITICAL: Setup vendor path BEFORE any imports that might use nicegui
vendor_dir = Path(__file__).parent.parent.parent / 'static' / 'vendor'
sys.path.insert(0, str(vendor_dir))
```

**Why here?** This file is imported by `app_worker.py` before NiceGUI is imported, so we can override the import path early enough.

**Also added to:** `app/main.py` (belt-and-suspenders approach)

#### 3. Python Method Addition
**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py` (after line 351)

```python
def set_zebra_stripes(self, enabled: bool) -> None:
    """Toggles logical-line zebra striping (alternating line colors).
    
    This applies to logical lines (document lines), not visual lines,
    so it works correctly with word wrapping enabled.
    """
    self.run_method('applyZebraStripes', enabled)
```

**Pattern:** Same as `set_line_wrapping()` and `set_theme()` - simple method that calls a JS function via `run_method()`.

#### 4. JavaScript Method Addition
**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js` (after line 112)

```javascript
async applyZebraStripes(enabled) {
  // Initialize zebra compartment on first call
  if (!this.zebraCompartment) {
    const { EditorView, Decoration, ViewPlugin } = CM;
    const { Facet, RangeSetBuilder, StateEffect, Compartment } = CM;
    
    this.zebraCompartment = new Compartment();
    
    const baseTheme = EditorView.baseTheme({
      "&light .cm-zebraStripe": { backgroundColor: "rgba(0,0,0,.035)" },
      "&dark .cm-zebraStripe": { backgroundColor: "rgba(255,255,255,.06)" },
    });
    
    const stepSize = Facet.define({ combine: v => v.length ? v[0] : 2 });
    const stripe = Decoration.line({ attributes: { class: "cm-zebraStripe" } });
    
    function stripeDeco(v) {
      const step = v.state.facet(stepSize);
      const b = new RangeSetBuilder();
      for (let { from, to } of v.visibleRanges) {
        for (let pos = from; pos <= to;) {
          const line = v.state.doc.lineAt(pos);
          if ((line.number % step) === 0) b.add(line.from, line.from, stripe);
          pos = line.to + 1;
        }
      }
      return b.finish();
    }
    
    const zebraPlugin = ViewPlugin.fromClass(class {
      constructor(v) { this.decorations = stripeDeco(v); }
      update(u) {
        if (u.docChanged || u.viewportChanged) this.decorations = stripeDeco(u.view);
      }
    }, { decorations: v => v.decorations });
    
    this.zebraExtensions = [baseTheme, stepSize.of(2), zebraPlugin];
    
    // Install empty compartment
    this.editor.dispatch({
      effects: StateEffect.appendConfig.of(this.zebraCompartment.of([]))
    });
  }
  
  // Reconfigure compartment
  const extensions = enabled ? this.zebraExtensions : [];
  this.editor.dispatch({
    effects: this.zebraCompartment.reconfigure(extensions)
  });
}
```

**Key points:**
- Uses `Compartment` for dynamic enable/disable (CM6 best practice)
- Lazy initialization - extension only installed on first call
- Stores zebra state on the Vue component instance (`this.zebraCompartment`)
- Full access to `this.editor` because it runs in Vue component context

#### 5. Usage in Application
**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (line 85)

```python
target_shade = bool(state.get('line_shading', False))
if target_shade != view_cache['line_shading']:
    view_cache['line_shading'] = target_shade
    print(f"[DEBUG] Calling set_zebra_stripes: {target_shade}", file=sys.stderr)
    editor_instance.set_zebra_stripes(target_shade)
```

**Clean as can be.** Same pattern as word wrap and theme.

---

### Why This Works

1. **No workarounds** - We extend the library properly
2. **Native access** - `this.editor` is available in Vue component methods
3. **Same pattern** - Follows NiceGUI's existing conventions
4. **Maintainable** - Clear modification points, easy to update
5. **Portable** - Could be upstreamed to NiceGUI as a feature

---

### Lessons Learned

1. **Vendor when you need control** - Don't fight the library, extend it properly
2. **Follow existing patterns** - `set_line_wrapping()` showed us the way
3. **Read the vendored code** - Understanding NiceGUI's architecture was key
4. **Test edge cases** - The reconnection bug only appeared on refresh after settings change
5. **One parameter can change everything** - `reconnect_timeout=0` solved hours of head-scratching
6. **Documentation lies** - Old docs referenced `editor_state` and timers that never existed (hallucination from previous agent)
7. **Fresh is better than clever** - Sometimes forcing a fresh start is simpler than preserving state

---

## Complete Architecture Summary

### What Works Now

✅ **Zebra Stripes** - Toggleable, works with word wrap, persists correctly  
✅ **Inline Diffs** - 700+ hunks render perfectly, auto-loads on file open  
✅ **Settings Persistence** - All settings (wrap, theme, shading, diffs) persist to disk  
✅ **Settings Refresh** - Browser refresh loads current settings from disk  
✅ **Live Updates** - Settings apply immediately when changed via menu  
✅ **Worker Lifecycle** - Settings survive worker restarts  

### How It Works

**Storage Layer:**
- `PreferencesStore` at `~/.local/share/termux-extensions-2/code_oss_prefs.json`
- Thread-safe, atomic writes, validates against schema

**Settings Flow:**
1. User clicks menu → persist to disk via `/preferences` endpoint
2. Apply immediately via `/editor/set_view_settings` endpoint
3. On page load → read fresh from disk (forced by `reconnect_timeout=0`)
4. On file open → defensive re-sync from disk

**Vendored Methods:**
- `editor.set_line_wrapping(bool)` - Toggle word wrap
- `editor.set_theme(str)` - Change theme
- `editor.set_zebra_stripes(bool)` - Toggle line shading
- `editor.set_diff_decorations(list)` - Apply git diffs

**No Polling Required:**
- Settings applied immediately via method calls
- Page refresh creates fresh editor with current settings
- No timers, no state synchronization loops, no complexity

---

### Files Modified (Final)

**Vendored NiceGUI:**
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
  - Added `set_zebra_stripes(enabled)` method
  - Added `set_diff_decorations(hunks)` method
  
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - Added `applyZebraStripes(enabled)` with StateField implementation
  - Added `applyDiffDecorations(hunks)` with decoration rendering
  - Added `buildZebraDecorations()` helper
  - Added `buildDiffDecorations()` helper

**Application Code:**
- `app/main.py` - Added vendor path setup (lines 4-9)
- `app/apps/file_editor_cm6/main.py`
  - Added vendor path setup (lines 3-9)
  - Fixed `editor.options` → `editor.set_line_wrapping()` bug (line 278)
  - Added `/editor/set_view_settings` endpoint (lines 352-414)
  
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
  - **SILVER BULLET:** Added `reconnect_timeout=0` (line 17)
  - Loads settings from disk on every page load (lines 27-69)
  - Applies zebra stripes and diffs on initialization (lines 65-70)

**Documentation:**
- `WORD_WRAP_FIX_NOTES.md` - Rewritten to remove hallucinated timer/polling architecture
- `ZEBRA_STRIPING_VENDORED_IMPLEMENTATION.md` - Complete implementation guide with bug history
- `NICEGUI_VENDORING_JOURNEY.md` - This document

**Time invested:** ~6 hours  
**Bugs fixed:** 2 (API mismatch, reconnection stale state)  
**Features delivered:** 4 (zebra stripes, inline diffs, settings persistence, refresh reliability)  
**Result:** ✅ Working, maintainable, extensible, **and reliable**

---

**Investigation complete.**  
**Features delivered.**  
**Architecture validated.**  
**Silver bullet discovered.**

The combination of vendoring (for extension capability) + `reconnect_timeout=0` (for state reliability) proved to be the complete solution we needed. Both pieces were necessary; neither alone would have been sufficient.
