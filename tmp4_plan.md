# Sticky Scroll Implementation Plan - Code CM6

**Created:** 2025-12-03  
**Updated:** 2025-12-03  
**Author:** vectorArc - TE2 Team  
**Status:** Sprint 1 COMPLETE ✅  
**Estimated Time:** 4-6 hours total (Sprint 1-4)

---

## Overview

Implement Monaco-style "sticky scroll" for CodeMirror 6 that pins function/class signatures to the top of the viewport while scrolling through code blocks.

---

## Sprint 1: MVP (1-2 hours) ✅ COMPLETE

### 1.1 Add Preference Store Entry ✅

**File:** `app/apps/file_editor_cm6/preferences_store.py`

Added `"stickyScroll": False` to `DEFAULT_EDITOR_PREFS`.

### 1.2 Add Vendored Python Wrapper ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`

Added `set_sticky_scroll(enabled: bool)` method.

### 1.3 Add Vendored JavaScript Implementation ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

Added:
- `stickyScrollCompartment` in data section
- `applyStickyScroll(enabled)` method with:
  - Language-aware scope node types (JS, TS, Python, fallback)
  - Lezer syntax tree traversal via `tree.resolveInner(pos)`
  - Position caching for performance
  - Click-to-jump functionality
  - Multi-line scope stack display (max 5 lines)
  - CSS theming via `EditorView.baseTheme()`

### 1.4 Add Backend Integration ✅

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

Added:
- `stickyScroll` to `_get_view_state_dict()`
- Case in `update_preference()` for `stickyScroll`
- `editor.set_sticky_scroll()` at page load
- `editor.set_sticky_scroll()` at file load

### 1.5 Add Menu Item ✅

**File:** `app/apps/file_editor_cm6/template.html`

Added menu item `mi-toggle-sticky-scroll` in View menu.

**File:** `app/apps/file_editor_cm6/main.js`

Added:
- `miToggleStickyScroll` element reference
- `bindMenuToggle()` handler
- `setMenuChecked()` in `applyMenuState()`

---

## Sprint 2: Robustness (1-2 hours)

### 2.1 Add syntaxTreeAvailable Import

Verify `CM.syntaxTreeAvailable` is exported. If not, add to bundle exports:

**File:** `app/static/vendor/nicegui/elements/codemirror/src/index.mjs`
```javascript
export { syntaxTreeAvailable } from "@codemirror/language";
```

Then rebuild: `npm run build`

### 2.2 Add MaxLines Configuration

Allow limiting the number of sticky lines (like Monaco's `maxLineCount`):

```javascript
// In applyStickyScroll, add maxLines parameter
applyStickyScroll(enabled, maxLines = 5) {
  // ... in the render section:
  const displayScopes = filteredScopes.slice(-maxLines); // Show last N (innermost)
  // or slice(0, maxLines) for outermost N
}
```

### 2.3 Handle Edge Cases

- Empty files
- Files without functions/classes
- Very long function signatures (truncate with ellipsis via CSS)
- Binary files (no syntax tree)

---

## Sprint 3: Monaco Parity (1-2 hours)

### 3.1 Add Line Numbers to Sticky Lines

Show line numbers for context:

```javascript
dom.innerHTML = filteredScopes.map((scope, idx) => {
  const lineNum = state.doc.lineAt(scope.node.from).number;
  return `<div class="cm-sticky-line" data-index="${idx}">
    <span class="cm-sticky-linenum">${lineNum}</span>
    ${escapeHtml(scope.lineText)}
  </div>`;
}).join('');
```

### 3.2 Add Gutter Alignment

Match the sticky header gutter width to the main editor gutter:

```css
".cm-stickyHeader": {
  paddingLeft: "var(--cm-gutter-width, 40px)",
}
```

### 3.3 Keyboard Shortcut

Add Ctrl+Shift+S or similar to toggle sticky scroll.

---

## Sprint 4: Polish (1 hour)

### 4.1 Mobile Testing

- Ensure panel doesn't interfere with touch scrolling
- Consider hiding on very small screens

### 4.2 Theme Integration

- Ensure colors match current theme
- Test with all bundled themes (Monokai, Dracula, etc.)

### 4.3 Documentation

- Update TECHNICAL.md with new section
- Update README.md feature list
- Add to AGENTS.log

---

## File Checklist

| File | Changes | Sprint |
|------|---------|--------|
| `preferences_store.py` | Add `stickyScroll` default | 1 |
| `codemirror.py` | Add `set_sticky_scroll()` method | 1 |
| `codemirror.js` | Add `applyStickyScroll()` + compartment | 1 |
| `editor_app.py` | Add preference handling | 1 |
| `template.html` | Add menu item | 1 |
| `main.js` | Add menu binding | 1 |
| `src/index.mjs` | Export `syntaxTreeAvailable` (if needed) | 2 |

---

## Testing Checklist

- [ ] Toggle ON shows sticky header
- [ ] Toggle OFF hides sticky header  
- [ ] Persists across page refresh
- [ ] Works with JavaScript files
- [ ] Works with Python files
- [ ] Works with TypeScript files
- [ ] Click-to-jump navigates correctly
- [ ] Nested scopes show correctly (class → method)
- [ ] No performance issues during rapid scroll
- [ ] Works with line wrapping enabled
- [ ] No console errors
- [ ] Menu checkmark updates correctly
- [ ] Mobile layout unaffected

---

## Ready to Begin

**Start with:** Sprint 1, Step 1.1 - Add preference store entry
