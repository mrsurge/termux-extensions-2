# Plan: Align CM6 Indentation Guides With Inline Diff Gutter

## Context & Goal
- Roadmap item **Next Steps → Editor → #8** calls for keeping CodeMirror indentation markers aligned with the code column even when inline diffs inject their “+/−” gutter. (See `notes/2025-11-16_Short_Term_File_Editor_TODO.md`.)
- The existing indentation-guide implementation (`notes/2025-11-17_INDENTATION_GUIDES_IMPLEMENTATION.md`) relies on the vendored `@replit/codemirror-indentation-markers` extension (wired via `applyIndentGuides` in `app/static/vendor/nicegui/elements/codemirror/codemirror.js:363-410`). That extension hard-codes its pseudo-element offset to **2px** (`dist/index-*.js:32604-32634`).
- Inline diff styling (both in the iframe via `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:430-458` and in the host shell `app/apps/file_editor_cm6/template.html:360-402`) adds `padding-left: calc(var(--diff-marker-width) + 0.35rem)` to `.cm-line.cm-diff-line`. When guides are enabled, the markers still start at 2px, so they overlap the diff gutter instead of lining up with the actual text column.
- Per `docs/core/nicegui_iframe_feature_adding_guideline.md` (stateless iframe section around lines 957-1002), fixes should stay inside the NiceGUI iframe boundary and share one source of truth for assets, so we avoid poking the legacy CM6 host JS.

## Desired Outcome
When both **Show Inline Diffs** and **Indentation Guides** are enabled (menu wiring lives in `app/apps/file_editor_cm6/main.js:1730-1812` and backend toggles in `nicegui_editor/editor_app.py:748-784`), every guide column should start exactly where the code now begins (after the diff marker gutter) without affecting scenarios where diffs are off.

## Implementation Steps

1. **Baseline & Instrumentation**
   - Reproduce the issue by opening any file with nested blocks, toggling **View → Show Inline Diffs** and **Editor → Indentation Guides**. Capture DOM state inside the iframe to confirm that (a) every line receives `.cm-diff-line` while diffs are enabled (see `diff_decorations.js:300-360`) and (b) `.cm-indent-markers::before` still reads the old `left: 2px` rule from the bundle.
   - Verify that the dynamic indent-unit code (`LANGUAGE_INDENT_MAP` plus `indentUnitCompartment` inside `codemirror.js:1-330`) already produces correct column widths, so the only offset we need to correct is the extra gutter width.

2. **Single Source of Truth for the Diff Gutter Offset**
   - Inside the iframe style block (`editor_app.py:430-458`), introduce a CSS custom property such as `--cm-inline-diff-offset`, defaulting to `0px`. Assign `--cm-inline-diff-offset: calc(var(--diff-marker-width) + 0.35rem)` on `.cm-line.cm-diff-line` (and reuse it for `.cm-diff-line-removed`). Replace the raw `padding-left` expressions with the variable so the gutter width is defined once.
   - Mirror the same variable definition inside the host `template.html:360-402` so both documents stay in sync (this file duplicates the diff styles for when the iframe is eventually removed).
   - Document the new variable in the note or inline comment so future styling tweaks grab this variable instead of hard-coding the math again.

3. **Offset the Indentation Marker Pseudo-Element**
   - Because the bundle’s base theme pins `.cm-indent-markers::before { left: 2px; }`, add an overriding rule in the iframe head style (after the variable definition) so it becomes `left: calc(2px + var(--cm-inline-diff-offset, 0px));`. This keeps the guide start anchored to the actual text column whenever the diff class injects an offset, but preserves the old 2px baseline when diffs are off.
   - Apply the same override in `template.html` for parity, even though the iframe currently hosts the editor (future refactors can drop one copy without losing the fix).
   - No bundle rebuild is required: we’re overriding the generated CSS per the NiceGUI guideline (docs/core… lines 957-1002). If we later need finer control (e.g., per-language offsets), we can move this logic into a small helper inside `codemirror.js`, but CSS keeps this release scoped.

4. **Runtime Sync & Toggle Safety**
   - Confirm that enabling/disabling inline diffs via `/editor/set_view_settings` already calls `editor.set_diff_decorations([])` when off (see `editor_app.py:748-784`), which removes the `.cm-diff-line` class entirely. Because our CSS variable only overrides when that class is present, no extra JS is needed; still, we should smoke-test toggling diffs after the CSS change to ensure the guides snap back instantly.
   - Double-check that deletion widgets (`.cm-diff-line-removed`, inserted in `diff_decorations.js:120-180`) also define the variable so their padding matches and guides inside surrounding lines stay aligned.

5. **QA / Regression Matrix**
   - Manual smoke test checklist:
     - Python file (4-space indent) and TypeScript file (2-space indent) with both inline diffs & guides on/off; confirm guides hug the code column.
     - Toggle inline diffs repeatedly to ensure the variable resets (no lingering offset once diffs are disabled).
     - Verify scroll performance and zebra stripes (`applyZebraStripes`) because both features use absolute-positioned overlays.
     - Confirm word-wrap mode (View → Word Wrap) doesn’t break the offset, since the diff gutter and indent guides both use `position:absolute`.
     - Spot-check deletion widgets (diffs that introduce “removed” blocks) so the gutter width stays consistent there as well.
   - Regression risk is limited to CSS, but capture before/after screenshots to hand back to design as proof for the roadmap item.

## Deliverables
- Updated iframe + host CSS with the shared `--cm-inline-diff-offset` variable and overriding `.cm-indent-markers::before` rule.
- Short changelog entry referencing `Next Steps #8` so the roadmap note can be marked “✅”.

---

## CORRECTED ANALYSIS: Using NiceGUI Inline Approach

**Timestamp:** 2025-11-18T20:34:22Z  
**Analyst:** Atlas 3 (Atlas)  
**Apology:** I repeatedly ignored your statements about the inline implementation and suggested using the wrong bundle. This is the correct analysis using the actual architecture.

### Current Architecture (THE ACTUAL ONE)

**Location:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js` (lines 50-186)

The diff decorations are **inlined directly in `codemirror.js`**, not in a separate file. They use:

```javascript
import * as CM from "nicegui-codemirror";  // Line 1

function buildDiffDecorations(view, hunks, CM, getWordWrap) {
  const { Decoration, RangeSetBuilder, WidgetType } = CM;  // Line 51
  
  // Line decorations with padding via CSS
  const lineAddedDeco = Decoration.line({
    class: 'cm-diff-line cm-diff-line-added',
    attributes: { 'data-diff-marker': '+' },
  });
  
  // Deletion widgets
  class RemovedLineWidget extends WidgetType {
    toDOM() {
      const lineEl = document.createElement('div');
      lineEl.className = 'cm-diff-line cm-diff-line-removed';
      lineEl.setAttribute('data-diff-marker', '−');
      // ...
    }
  }
}
```

**CSS approach (in `editor_app.py`):**
- `.cm-diff-line` gets `padding-left: calc(var(--diff-marker-width) + 0.35rem)`
- `::before` pseudo-element shows the diff marker ("+", "−", "│")

**The Problem:**
- Indentation guides use `::before` pseudo-element positioned at `left: 2px`
- When we add padding to the line, text shifts right
- But indentation guide gradients still calculate from the pseudo-element's edge
- Result: All guides stack vertically instead of spreading horizontally

### The CORRECT Solution: Use CM.gutter() - Inline in codemirror.js

**Step 1: Check if CM.gutter exists in the NiceGUI bundle**

```javascript
// In codemirror.js, line ~7 (add with other feature checks)
const gutter = typeof CM.gutter === 'function' ? CM.gutter : null;
const GutterMarker = CM.GutterMarker || null;
```

**Step 2: Create diff gutter inline (add after buildDiffDecorations function)**

```javascript
// Add around line 187, before export default
function createDiffGutter() {
  if (!gutter || !GutterMarker) {
    console.warn('[CM6] gutter API not available, diff markers will use padding method');
    return null;
  }
  
  class DiffMarker extends GutterMarker {
    constructor(marker) {
      super();
      this.marker = marker; // '+', '−', '│'
    }
    
    eq(other) {
      return this.marker === other.marker;
    }
    
    toDOM() {
      const span = document.createElement('span');
      span.className = 'cm-diff-gutter-marker';
      span.textContent = this.marker || '';
      
      if (this.marker === '+') span.classList.add('cm-diff-marker-add');
      else if (this.marker === '−') span.classList.add('cm-diff-marker-del');
      else if (this.marker === '│') span.classList.add('cm-diff-marker-context');
      
      return span;
    }
  }
  
  return {
    extension: gutter({
      class: 'cm-diff-gutter',
      markers: view => buildDiffGutterMarkers(view),
      initialSpacer: () => new DiffMarker('+'),
    }),
    DiffMarker: DiffMarker,
  };
}

function buildDiffGutterMarkers(view) {
  const { RangeSetBuilder } = CM;
  const builder = new RangeSetBuilder();
  
  // This would need access to the current hunks
  // We'd need to store hunks in a StateField or pass them differently
  // For now, return empty - this is the structure
  
  return builder.finish();
}
```

**Step 3: Modify buildDiffDecorations to optionally build gutter markers instead of padding**

This requires rearchitecting how hunks are stored and accessed. The current `buildDiffDecorations` is called with hunks as a parameter, but gutter markers need to be computed via a `markers` function that only receives the view.

**The Real Issue:** Gutters in CodeMirror need markers to be computed from view state, not passed as parameters. We'd need to:

1. Store hunks in a StateField
2. Create a gutter that reads from that StateField
3. Still build deletion widgets separately (they're not gutter markers)

### Alternative: Fix the Gradient Positioning Directly

Since the diff decorations are **already inline in `codemirror.js`** and use the `CM` namespace, we can modify how they're applied.

**Option 1: Don't use padding - use a actual gutter**

If `CM.gutter` exists in the bundle, implement the gutter approach above (requires StateField refactor).

**Option 2: Keep padding but fix indentation markers to account for it**

The indentation markers extension is imported from the bundle:
```javascript
const indentationMarkers = typeof CM.indentationMarkers === 'function' ? CM.indentationMarkers : null;
```

We CANNOT modify the extension without rebuilding the NiceGUI bundle. But we CAN:

1. **Add a CSS variable that the indent guides can read**
2. **Use JavaScript to dynamically adjust the indent guide offset**

**Approach 2A: JavaScript-based offset**

```javascript
// In codemirror.js, modify applyIndentGuides function (line ~363)
async applyIndentGuides(enabled) {
  if (!this.indentCompartment) {
    // ... existing setup code ...
    
    // Add a custom extension that adjusts indent markers based on diff state
    const indentOffsetExtension = CM.ViewPlugin.fromClass(class {
      constructor(view) {
        this.view = view;
        this.updateOffset();
      }
      
      update(update) {
        // Check if diff decorations changed
        if (update.docChanged || update.viewportChanged) {
          this.updateOffset();
        }
      }
      
      updateOffset() {
        // Check if any lines have cm-diff-line class
        const hasDiffs = this.view.dom.querySelector('.cm-diff-line') !== null;
        const offset = hasDiffs ? 'calc(var(--diff-marker-width) + 0.35rem)' : '0px';
        
        // Update CSS variable that indent markers can read
        this.view.dom.style.setProperty('--indent-guide-offset', offset);
      }
    });
    
    this.indentExtensions = [
      indentationMarkers({
        // ... existing config ...
      }),
      indentOffsetExtension,
    ];
  }
  
  // ... rest of function ...
}
```

**Then in CSS:**
```css
.cm-editor .cm-indent-markers::before {
  /* This won't work because the bundle's baseTheme has higher specificity */
  /* We need a different approach */
}
```

**Approach 2B: Don't shift the pseudo-element, shift the background pattern**

Wait - we can't do this either because the bundle generates the background inline.

### The Brutal Truth

**We have 3 realistic options:**

**Option A: Add CM.gutter to NiceGUI bundle**

1. Check if `@codemirror/view` package in `app/static/vendor/nicegui/elements/codemirror/node_modules` exports `gutter` and `GutterMarker`
2. If yes: Add to `src/index.mjs` exports
3. Rebuild bundle: `cd app/static/vendor/nicegui/elements/codemirror && npm run build`
4. Implement inline gutter code in `codemirror.js`
5. Refactor diff system to use StateField for hunks

**Estimated effort:** 3-4 hours  
**Risk:** Medium (bundle rebuild, architecture change)

---

**Option B: Modify indentation markers extension in bundle**

1. Find the indentation markers source in `node_modules/@replit/codemirror-indentation-markers`
2. Modify `createGradient()` to read a CSS variable for left offset
3. Modify `indentTheme()` to apply that offset
4. Rebuild NiceGUI bundle
5. Wire offset variable from diff state in `codemirror.js`

**Estimated effort:** 4-5 hours  
**Risk:** High (modifying third-party extension, bundle rebuild)

---

**Option C: Disable indentation guides when diffs are enabled**

```javascript
// In codemirror.js
async applyIndentGuides(enabled) {
  // Check if diffs are currently active
  const diffsActive = /* check diff state somehow */;
  
  if (diffsActive && enabled) {
    console.warn('[CM6] Indentation guides disabled while diffs are active (incompatible features)');
    enabled = false;
  }
  
  // ... rest of existing code ...
}
```

**Estimated effort:** 30 minutes  
**Risk:** Low (feature limitation, but honest about it)

---

### Recommended Path Forward

**I recommend Option A** (add gutter to bundle) because:

1. It's the architecturally correct solution
2. Gutters are a core CodeMirror feature (likely already in the bundle)
3. Future features (like breakpoints, line blame) would benefit from gutter support
4. Cleaner separation between diff metadata and line content

**Next steps:**
1. Check if gutter is already exported from NiceGUI bundle
2. If not, add it and rebuild
3. Implement inline gutter code in `codemirror.js` 
4. Test with indentation guides

---

**Signed:** Atlas 3 (Atlas)  
**Status:** Awaiting your decision on which option to pursue


---

## FINAL SOLUTION: Diff Gutter Implementation

**Timestamp:** 2025-11-18T20:45:45Z  
**Analyst:** Atlas 3 (Atlas)

### Solution: Add a Dedicated Diff Gutter

Create a new gutter that appears **only when inline diffs are activated**. This gutter will display:
- **"+"** markers for added lines
- **"−"** markers for deletion widgets
- **"│"** markers for context lines

The gutter physically separates diff markers from line content, preventing coordinate system conflicts with indentation guides.

---

## Implementation Steps

### Step 1: Verify/Add Gutter Exports to NiceGUI Bundle

**Check if gutter is already exported:**

```bash
cd /data/data/com.termux/files/home/mrselect/app/static/vendor/nicegui/elements/codemirror
grep -r "export.*gutter\|export.*GutterMarker" dist/
```

**If not found, add to bundle:**

1. **Edit `src/index.mjs`** - Add gutter exports:
```javascript
// Add these imports if not present
import { gutter, GutterMarker, gutters } from '@codemirror/view';

// Add to exports
export { gutter, GutterMarker, gutters };
```

2. **Rebuild bundle:**
```bash
cd /data/data/com.termux/files/home/mrselect/app/static/vendor/nicegui/elements/codemirror
npm run build
```

3. **Verify exports:**
```bash
grep -r "GutterMarker" dist/
```

---

### Step 2: Modify codemirror.js - Add Gutter Feature Check

**Location:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**After line 7** (after other feature checks), add:

```javascript
const gutter = typeof CM.gutter === 'function' ? CM.gutter : null;
const GutterMarker = CM.GutterMarker || null;
const gutters = typeof CM.gutters === 'function' ? CM.gutters : null;
```

---

### Step 3: Create Diff Gutter Classes and Builder

**Location:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**After line 186** (after `safeLine` function, before `export default`), add:

```javascript
// Diff gutter implementation
class DiffGutterMarker extends GutterMarker {
  constructor(marker) {
    super();
    this.marker = marker; // '+', '−', '│'
  }
  
  eq(other) {
    return other instanceof DiffGutterMarker && this.marker === other.marker;
  }
  
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-diff-gutter-marker';
    span.textContent = this.marker;
    
    if (this.marker === '+') {
      span.classList.add('cm-diff-marker-add');
    } else if (this.marker === '−') {
      span.classList.add('cm-diff-marker-del');
    } else if (this.marker === '│') {
      span.classList.add('cm-diff-marker-context');
    }
    
    return span;
  }
}

// StateField to store current diff hunks
const diffHunksField = CM.StateField.define({
  create() {
    return null; // null or {hunks: [...]}
  },
  update(value, tr) {
    // Check for effect that updates hunks
    for (const effect of tr.effects) {
      if (effect.is(updateDiffHunksEffect)) {
        return effect.value;
      }
    }
    return value;
  }
});

// Effect to update hunks
const updateDiffHunksEffect = CM.StateEffect.define();

// Function to build gutter markers from current hunks
function buildDiffGutterMarkers(view) {
  const { RangeSetBuilder } = CM;
  const hunksData = view.state.field(diffHunksField);
  
  if (!hunksData || !hunksData.hunks || hunksData.hunks.length === 0) {
    return CM.RangeSet.empty;
  }
  
  const builder = new RangeSetBuilder();
  const doc = view.state.doc;
  const hunks = hunksData.hunks;
  
  // Build map of line numbers to markers
  const lineMarkers = new Map();
  
  for (const hunk of hunks) {
    let newLine = Math.max(1, hunk.newStart || 1);
    
    for (const line of hunk.lines || []) {
      const kind = line.type;
      
      if (kind === 'add') {
        lineMarkers.set(newLine, new DiffGutterMarker('+'));
        newLine++;
      } else if (kind === 'context') {
        lineMarkers.set(newLine, new DiffGutterMarker('│'));
        newLine++;
      } else if (kind === 'del') {
        // Deletion widgets: mark the line where they'll be inserted
        if (!lineMarkers.has(newLine)) {
          lineMarkers.set(newLine, new DiffGutterMarker('−'));
        }
        // Note: Multiple deletions at same line will only show one marker
      }
    }
  }
  
  // Add markers to builder
  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    if (lineMarkers.has(lineNum)) {
      const lineInfo = safeLine(doc, lineNum);
      if (lineInfo) {
        builder.add(lineInfo.from, lineInfo.from, lineMarkers.get(lineNum));
      }
    }
  }
  
  return builder.finish();
}

// Create the diff gutter extension
function createDiffGutterExtension() {
  if (!gutter || !GutterMarker) {
    console.warn('[CM6] Gutter API not available in bundle');
    return null;
  }
  
  return gutter({
    class: 'cm-diff-gutter',
    markers: view => buildDiffGutterMarkers(view),
    initialSpacer: () => new DiffGutterMarker('+'), // Size gutter to widest marker
  });
}
```

---

### Step 4: Integrate Gutter into Component

**Location:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Find the component's `mounted()` function** (around line 500+), and add a compartment for the diff gutter:

**In the component's data section** (around line 220), add:

```javascript
diffGutterCompartment: null,
currentDiffHunks: null,
```

**In the `mounted()` function**, after editor creation, initialize the gutter:

```javascript
// After: this.editor = new EditorView({ ... })

// Initialize diff gutter compartment
if (typeof CM.Compartment !== 'undefined') {
  this.diffGutterCompartment = new CM.Compartment();
  
  const diffGutterExt = createDiffGutterExtension();
  const extensions = [];
  
  if (diffGutterExt) {
    extensions.push(diffGutterExt);
  }
  
  // Add the hunks field and compartment
  this.editor.dispatch({
    effects: CM.StateEffect.appendConfig.of([
      diffHunksField,
      this.diffGutterCompartment.of(extensions)
    ])
  });
}
```

---

### Step 5: Modify buildDiffDecorations to NOT Add Padding

**Location:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Modify line decorations** (around line 58-66) to remove padding:

```javascript
// OLD:
const lineAddedDeco = Decoration.line({
  class: 'cm-diff-line cm-diff-line-added',
  attributes: { 'data-diff-marker': '+' },
});

// NEW:
const lineAddedDeco = Decoration.line({
  class: 'cm-diff-line-added', // Remove base 'cm-diff-line' class
  // Remove data-diff-marker attribute (gutter handles markers now)
});

// OLD:
const lineContextDeco = Decoration.line({
  class: 'cm-diff-line cm-diff-line-context',
  attributes: { 'data-diff-marker': '│' },
});

// NEW:
const lineContextDeco = Decoration.line({
  class: 'cm-diff-line-context',
  // Remove data-diff-marker attribute
});

// linePlainDeco can be removed entirely (no longer needed)
```

**In the decoration builder loop** (around line 130-135), remove the `linePlainDeco` additions:

```javascript
// DELETE these lines:
builder.add(lineInfo.from, lineInfo.from, linePlainDeco);
```

---

### Step 6: Wire Diff Hunks to State

**Location:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Find where diffs are set** (the method that calls `buildDiffDecorations`), likely in a method like `set_diff_decorations`:

**Add effect to update hunks state:**

```javascript
// In set_diff_decorations method (find this in codemirror.py bindings)
// After building decorations, also dispatch hunks to state:

const decorations = buildDiffDecorations(this.editor, hunks, CM, () => this.lineWrapping);

// Add this: Update hunks in state for gutter
if (this.diffGutterCompartment) {
  this.editor.dispatch({
    effects: updateDiffHunksEffect.of({ hunks: hunks })
  });
}

// Then apply decorations as before
```

If diffs are cleared:

```javascript
// When clearing diffs:
if (this.diffGutterCompartment) {
  this.editor.dispatch({
    effects: updateDiffHunksEffect.of(null)
  });
}
```

---

### Step 7: Update CSS

**Location:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

**In the `<style>` block** (around line 440-480), update CSS:

```css
/* Add diff gutter styles */
.cm-diff-gutter {
  width: 1.65rem;
  min-width: 1.65rem;
}

.cm-diff-gutter-marker {
  display: block;
  text-align: center;
  font-weight: 600;
  line-height: inherit;
  user-select: none;
  padding: 0 0.25rem;
}

.cm-diff-marker-add {
  color: rgba(52, 211, 153, 0.9);
}

.cm-diff-marker-del {
  color: rgba(248, 113, 113, 0.85);
}

.cm-diff-marker-context {
  color: rgba(148, 163, 184, 0.55);
}

/* Line decorations - NO MORE PADDING */
.cm-diff-line-added {
  background: rgba(52, 211, 153, 0.22) !important;
  border-left: 3px solid rgba(52, 211, 153, 0.75) !important;
}

.cm-diff-line-context {
  border-left: 3px solid rgba(148, 163, 184, 0.35);
}

/* Remove old padding rules for .cm-diff-line */
/* DELETE these:
.cm-line.cm-diff-line {
  padding-left: calc(var(--diff-marker-width) + 0.35rem);
}
.cm-line.cm-diff-line::before {
  content: attr(data-diff-marker);
  ...
}
*/

/* Deletion widgets still need their own markers */
.cm-diff-line-removed {
  position: relative;
  padding: 0 10px 0 calc(1.65rem + 6px); /* Align with gutter width */
  border-left: 3px solid rgba(248, 113, 113, 0.7);
  background: rgba(248, 113, 113, 0.18);
  color: rgba(248, 113, 113, 0.95);
  font: inherit;
  white-space: pre;
  line-height: inherit;
  user-select: none;
  contain: layout paint;
}

.cm-diff-line-removed::before {
  content: attr(data-diff-marker);
  position: absolute;
  left: 0;
  width: 1.65rem;
  text-align: center;
  font-weight: 600;
  color: rgba(248, 113, 113, 0.85);
  user-select: none;
}

/* Keep other diff styles (wrap, etc.) */
```

**Also update in `template.html`** (line 360-420) with the same changes.

---

### Step 8: Remove Old Indentation Guide Overrides

**Location:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` and `template.html`

**DELETE these CSS rules** that were trying to fix the indentation guide offset:

```css
/* DELETE THIS:
.cm-editor .cm-indent-markers::before {
  left: calc(2px + var(--cm-inline-diff-offset, 0px)) !important;
}
*/

/* DELETE THIS:
--cm-inline-diff-offset: 0px;
*/
```

Indentation guides will now work normally because there's no padding shifting the coordinate system.

---

## Testing Checklist

1. **Enable inline diffs** → Verify gutter appears on left side
2. **Check added lines** → Green "+" in gutter, green background on line
3. **Check deleted lines** → Red "−" in gutter where deletion widget appears
4. **Check context lines** → Gray "│" in gutter
5. **Enable indentation guides** → Verify they spread horizontally at correct indent levels
6. **Disable inline diffs** → Verify gutter disappears
7. **Test with word wrap** → Verify deletion widgets still align correctly
8. **Test with zebra stripes** → Verify no visual conflicts

---

## Summary

This solution:
- ✅ Uses CodeMirror's native gutter API
- ✅ Keeps diff markers physically separate from line content
- ✅ Eliminates padding that breaks indentation guide coordinates
- ✅ All code is inline in `codemirror.js` using `CM` namespace
- ✅ Follows NiceGUI vendoring guidelines
- ✅ No external file dependencies
- ✅ Clean separation of concerns

**Estimated implementation time:** 2-3 hours  
**Risk level:** Low-Medium (uses native API, may need bundle rebuild)

---

**Signed:** Atlas 3 (Atlas)  
**Status:** Ready for implementation

