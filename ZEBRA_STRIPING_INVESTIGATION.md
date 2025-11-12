# Zebra Striping Investigation Report
**Date:** November 11, 2025  
**Status:** BLOCKED - Cannot access CodeMirror EditorView from NiceGUI context  
**Time Invested:** ~4 hours

---

## Objective

Implement logical-line zebra striping (alternating line background colors) in the NiceGUI-based CodeMirror 6 editor that:
1. Works with word wrap (stripes logical lines, not visual lines)
2. Toggles live without page reload
3. Follows the established state-driven pattern (like word wrap, theme, language)
4. Serves as proof-of-concept for inline git diffs (same extension mechanism)

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

1. **When a library blocks you, vendor and extend it** - Don't fight the architecture
2. **Import order matters** - `sys.path.insert()` must happen before the first import
3. **Read the source** - Understanding NiceGUI's Vue wrapper was key
4. **Start simple** - Global variable attempt taught us what we needed
5. **Copy existing patterns** - `set_line_wrapping()` showed us the way

---

### Path Forward: Inline Diffs

**Zebra stripes prove the pattern works.** Inline diffs are now feasible:

1. Add `set_diff_decorations(hunks)` method to `codemirror.py`
2. Add `applyDiffDecorations(hunks)` method to `codemirror.js`
3. Use `Decoration.line()` for changed lines
4. Use `Decoration.widget()` for deletion markers
5. Call from timer when diff state changes

**Difficulty: 5/10** (down from 9/10 impossible)

The infrastructure is proven. Diffs are just more complex decorations.

---

### Files Modified (Final)

**Vendored:**
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py` - Added `set_zebra_stripes()`
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js` - Added `applyZebraStripes()`

**Application:**
- `app/main.py` - Added vendor path setup (lines 4-9)
- `app/apps/file_editor_cm6/main.py` - Added vendor path setup (lines 3-9)
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` - Calls `set_zebra_stripes()` (line 85)

**Time invested:** ~5 hours  
**Result:** ✅ Working, maintainable, extensible

---

**Investigation complete.**  
**Feature delivered.**  
**Architecture validated for future extensions.**
