# Sticky Scroll Implementation - Progress & Status

**Created:** 2025-12-03T17:05:55Z  
**Author:** vectorArc - TE2 Team  

---

## What's Working ✅

### 1. Core Feature
- Sticky scroll header appears at top of editor
- Shows enclosing function/class scope signatures
- Click-to-jump navigates to the scope definition
- Toggle via View → Sticky Scroll menu
- Preference persists across sessions

### 2. Positioning
- Overlay positioned with `position: absolute` inside `view.dom`
- Sits to the right of the gutter (left offset = gutter width)
- Spans from gutter edge to right side of editor

### 3. Scroll Detection
- Uses direct scroll listener on `view.scrollDOM` for immediate response
- Uses `view.posAtCoords()` for accurate viewport position detection
- No longer relies on CM6's batched `viewportChanged` updates

### 4. Syntax Tree Integration
- Language-aware scope node types (JS, TS, Python, fallback)
- Uses Lezer `tree.resolveInner(pos)` to walk up parent chain
- Finds all enclosing scopes, reverses to show outermost first

### 5. Indentation
- Preserves original line indentation (removed `.trim()`)
- Nested scopes display with their natural whitespace

---

## Files Modified

| File | Changes |
|------|---------|
| `preferences_store.py` | Added `"stickyScroll": False` default |
| `codemirror.py` | Added `set_sticky_scroll(enabled)` method |
| `codemirror.js` | Added `applyStickyScroll()` with ViewPlugin |
| `editor_app.py` | Added preference handling, page/file load hooks |
| `template.html` | Added "Sticky Scroll" menu item |
| `main.js` | Added toggle binding + menu state |

---

## Current Architecture

### ViewPlugin Structure (codemirror.js)
```
applyStickyScroll(enabled) {
  - Creates ViewPlugin with:
    - this.dom (div.cm-stickyHeader) appended to view.dom
    - this.currentScopes[] - array of {node, lineText}
    - Direct scroll listener on view.scrollDOM
    
  - updateStickyHeader():
    1. Get gutter width, set this.dom.style.left
    2. Get position via posAtCoords at editor top
    3. Get syntax tree, walk up to find scope nodes
    4. Filter scopes whose defBlock.bottom <= scrollTop + triggerOffset
    5. Render filtered scopes to this.dom.innerHTML
}
```

### CSS (baseTheme)
```css
.cm-stickyHeader {
  position: absolute;
  top: 0;
  left: [gutterWidth]px;
  right: 0;
  z-index: 10;
  background: var(--cm-editor-bg);
}
.cm-sticky-line {
  padding: 1px 8px 1px 4px;
  white-space: pre;
  cursor: pointer;
}
```

---

## Current Issue ❌

### Problem: Subsequent Scope Trigger Timing

**What should happen:**
- Scope 1 (outermost): triggers when its line is 1 line from top
- Scope 2 (nested): triggers when its line is 2 lines from top (accounting for scope 1 in overlay)
- Scope 3 (deeper): triggers when its line is 3 lines from top
- etc.

**What actually happens:**
- Scope 1: triggers correctly at +1 line offset ✅
- Scope 2+: still triggers at +1 line offset (should be +2, +3, etc.) ❌

**Intended behavior:**
The overlay grows as you scroll deeper into nested scopes. Each additional scope in the overlay takes up visual space, so the trigger point for the *next* scope should move down proportionally. Otherwise, the next scope's definition line disappears behind the overlay before it gets added to the header.

### What We've Tried
1. `(filteredScopes.length + 1) * lineHeight` - didn't work for subsequent scopes
2. `this.dom.offsetHeight + lineHeight + (index * lineHeight)` - same issue  
3. `Math.min(i, displayedCount) + 1` based on previous render count - same issue

### The Core Question
How do we make scope N trigger when its definition line is N lines from the viewport top, accounting for the fact that scopes 1 through N-1 are already displayed in the overlay?

---

## Committed State
Branch created and pushed with current working (but imperfect) implementation.
