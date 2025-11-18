# FINAL CORRECT Solution: Diff Gutter Using Actual Pattern

**Timestamp:** 2025-11-18T21:12:00Z  
**Analyst:** Atlas 3 (Atlas)

## The Pattern (From Actual Code)

**Inline diffs use this pattern** (`codemirror.js:453-510`):

1. **First call**: Create `Compartment`, install with `StateEffect.appendConfig.of(compartment.of([field]))`
2. **Subsequent calls**: Dispatch effects to update state (`setDiffEffect` or `clearDiffEffect`)
3. **Empty array** = turn off, **Non-empty array** = turn on

**We use the SAME pattern for the gutter.**

---

## Implementation

### Step 1: Verify Gutter is Already Exported

Gutter is already in the bundle via `src/index.mjs` line 2:
```javascript
export * from "@codemirror/view";  // Includes gutter, GutterMarker
```

No rebuild needed.

---

### Step 2: Add DiffGutterMarker Class (codemirror.js ~line 187)

Add after `safeLine` function:

```javascript
// Diff gutter marker class
class DiffGutterMarker extends CM.GutterMarker {
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

// Build gutter markers from hunks
function buildDiffGutterMarkers(view, hunks) {
  if (!hunks || hunks.length === 0) {
    return CM.RangeSet.empty;
  }
  
  const { RangeSetBuilder } = CM;
  const builder = new RangeSetBuilder();
  const doc = view.state.doc;
  
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
        if (!lineMarkers.has(newLine)) {
          lineMarkers.set(newLine, new DiffGutterMarker('−'));
        }
      }
    }
  }
  
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
```

---

### Step 3: Modify applyDiffDecorations to Add Gutter

**Replace the entire `applyDiffDecorations` method** (lines 453-510):

```javascript
async applyDiffDecorations(hunks) {
  console.log('[applyDiffDecorations] Called with hunks:', JSON.stringify(hunks, null, 2));
  
  // Initialize diff compartment on first call
  if (!this.diffCompartment) {
    const { StateEffect, StateField, Compartment } = CM;
    
    this.diffCompartment = new Compartment();
    this.setDiffEffect = StateEffect.define();
    this.clearDiffEffect = StateEffect.define();
    
    const setDiffEffect = this.setDiffEffect;
    const clearDiffEffect = this.clearDiffEffect;
    
    const diffField = StateField.define({
      create() {
        return CM.Decoration.none;
      },
      update(value, tr) {
        if (tr.docChanged && value !== CM.Decoration.none) {
          value = value.map(tr.changes);
        }
        for (const effect of tr.effects) {
          if (effect.is(setDiffEffect)) {
            value = effect.value;
          } else if (effect.is(clearDiffEffect)) {
            value = CM.Decoration.none;
          }
        }
        return value;
      },
      provide: field => CM.EditorView.decorations.from(field)
    });
    
    this.diffField = diffField;
    
    // NEW: Initialize gutter compartment
    this.diffGutterCompartment = new Compartment();
    
    // Store hunks for gutter markers
    this.currentDiffHunks = [];
    
    // Create gutter extension with markers function
    const diffGutterExtension = CM.gutter({
      class: 'cm-diff-gutter',
      markers: view => buildDiffGutterMarkers(view, this.currentDiffHunks),
      initialSpacer: () => new DiffGutterMarker('+'),
    });
    
    this.diffGutterExtension = diffGutterExtension;
    
    // Install both compartments at once
    this.editor.dispatch({
      effects: StateEffect.appendConfig.of([
        this.diffCompartment.of([diffField]),
        this.diffGutterCompartment.of([]) // Start with empty array (gutter off)
      ])
    });
  }
  
  // Store hunks for gutter
  this.currentDiffHunks = hunks || [];
  
  // Build decorations
  const getWordWrap = () => this.lineWrapping || false;
  const decoSet = buildDiffDecorations(this.editor, hunks, CM, getWordWrap);
  
  // Determine if gutter should be on or off
  const gutterActive = hunks && hunks.length > 0;
  
  // Dispatch: update decorations AND gutter state
  this.editor.dispatch({
    effects: [
      this.setDiffEffect.of(decoSet),
      this.diffGutterCompartment.reconfigure(
        gutterActive ? [this.diffGutterExtension] : []
      )
    ]
  });
},
```

**Key changes:**
- Gutter compartment starts empty (`[]`)
- When `hunks.length > 0`: reconfigure to `[diffGutterExtension]` (on)
- When `hunks` empty/null: reconfigure to `[]` (off)
- Store hunks in `this.currentDiffHunks` so markers function can access them
- Same effect dispatch pattern as existing code

---

### Step 4: Remove Padding from Line Decorations

**In `buildDiffDecorations` (line 58-68):**

```javascript
// CHANGE THIS:
const lineAddedDeco = Decoration.line({
  class: 'cm-diff-line cm-diff-line-added',
  attributes: { 'data-diff-marker': '+' },
});

const lineContextDeco = Decoration.line({
  class: 'cm-diff-line cm-diff-line-context',
  attributes: { 'data-diff-marker': '│' },
});

// TO THIS:
const lineAddedDeco = Decoration.line({
  class: 'cm-diff-line-added',
});

const lineContextDeco = Decoration.line({
  class: 'cm-diff-line-context',
});

// DELETE linePlainDeco entirely
```

**In the decoration loop (line ~160), DELETE:**

```javascript
builder.add(lineInfo.from, lineInfo.from, linePlainDeco);
```

---

### Step 5: Update CSS

**Location:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (lines 440-480)

**Replace with:**

```css
<style>
:root {
  --diff-marker-width: 1.65rem;
  --diff-add-bg: rgba(52, 211, 153, 0.22);
  --diff-add-border: rgba(52, 211, 153, 0.75);
  --diff-add-marker: rgba(52, 211, 153, 0.9);
  --diff-context-border: rgba(148, 163, 184, 0.35);
  --diff-context-marker: rgba(148, 163, 184, 0.55);
  --diff-del-bg: rgba(248, 113, 113, 0.18);
  --diff-del-border: rgba(248, 113, 113, 0.7);
  --diff-del-fg: rgba(248, 113, 113, 0.95);
  --diff-del-marker: rgba(248, 113, 113, 0.85);
}

.cm-diff-gutter {
  width: var(--diff-marker-width);
  min-width: var(--diff-marker-width);
}

.cm-diff-gutter-marker {
  display: block;
  text-align: center;
  font-weight: 600;
  line-height: inherit;
  user-select: none;
  padding: 0 0.25rem;
}

.cm-diff-marker-add { color: var(--diff-add-marker); }
.cm-diff-marker-del { color: var(--diff-del-marker); }
.cm-diff-marker-context { color: var(--diff-context-marker); }

.cm-diff-line-added {
  background: var(--diff-add-bg) !important;
  border-left: 3px solid var(--diff-add-border) !important;
}

.cm-diff-line-context {
  border-left: 3px solid var(--diff-context-border);
}

.cm-diff-line-removed {
  position: relative;
  padding: 0 10px 0 calc(var(--diff-marker-width) + 6px);
  border-left: 3px solid var(--diff-del-border);
  background: var(--diff-del-bg);
  color: var(--diff-del-fg);
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
  width: var(--diff-marker-width);
  text-align: center;
  font-weight: 600;
  color: var(--diff-del-marker);
  user-select: none;
}

.cm-diff-removed-text { display: block; white-space: pre; }
.cm-diff-line-removed.cm-diff-wrap { white-space: pre-wrap; word-break: break-word; }
.cm-diff-line-removed.cm-diff-wrap .cm-diff-removed-text { white-space: pre-wrap; word-break: break-word; }
</style>
```

**DELETE all old CSS:**
- `.cm-line.cm-diff-line` padding rules
- `.cm-line.cm-diff-line::before` marker rules
- `.cm-indent-markers::before` offset hacks
- `--cm-inline-diff-offset` variable

**Also update `template.html` (lines 360-420) identically.**

---

## Testing

1. Toggle **View → Show Inline Diffs** on → Gutter appears
2. Toggle off → Gutter disappears
3. Toggle **Editor → Indentation Guides** on (with diffs on) → Guides spread horizontally correctly
4. Verify all marker types: `+`, `−`, `│`
5. Test with word wrap, zebra stripes

---

## Summary

- ✅ Uses EXACT pattern from existing `applyDiffDecorations`
- ✅ Gutter toggles via `compartment.reconfigure([ext])` vs `reconfigure([])`
- ✅ Same on/off rule as diffs: empty hunks = off, hunks present = on
- ✅ Stores hunks in `this.currentDiffHunks` for markers function
- ✅ All inline in `codemirror.js` using `CM` namespace
- ✅ No invented patterns - traced actual code

**Status:** Ready for implementation

---

### Status Update – 2025-11-18T15:20:00-06:00 – Dex 2 (Dex)
- Followed the guide above: updated `app/static/vendor/nicegui/elements/codemirror/codemirror.js` with `DiffGutterMarker`, a `buildDiffGutterMarkers()` helper, and an enhanced `applyDiffDecorations()` that stores `currentDiffHunks` and toggles a dedicated gutter `Compartment` on/off while keeping the existing decoration field.
- Simplified `buildDiffDecorations()` so additions/context lines no longer rely on pseudo-element markers; deletion widgets still expose `data-diff-marker` for the `−` symbol.
- Mirrored CSS changes in both `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` and `app/apps/file_editor_cm6/template.html` to style `.cm-diff-gutter` / `.cm-diff-gutter-marker` and remove the old padding-based `.cm-line.cm-diff-line` rules.
- Manual test still pending: reload the editor, toggle inline diffs + indentation guides, and confirm the gutter appears only when diffs are active and indentation guides remain aligned.
