# Sticky Scroll Implementation - Full Progress Report

**Created:** 2025-12-03T19:54:43Z  
**Author:** vectorArc - TE2 Team  
**Status:** Feature branch - functional but needs polish

---

## Executive Summary

Successfully implemented a Monaco-style "Sticky Scroll" feature for CodeMirror 6. The feature displays the enclosing function/class/scope signatures at the top of the editor as you scroll through nested code. Click-to-jump navigation is functional. The implementation is working but has minor flicker issues at scope boundaries that need further refinement.

---

## What Was Built

### Core Feature
- **Sticky scroll header** overlays the top of the editor content area
- **Shows enclosing scopes** (functions, classes, methods, arrow functions, etc.)
- **Language-aware** scope detection (JavaScript, TypeScript, Python, with fallback)
- **Click-to-jump** - clicking a sticky line navigates to that scope's definition
- **Toggle via menu** - View → Sticky Scroll
- **Preference persistence** - setting saved across sessions
- **Max 5 lines** displayed to prevent excessive screen usage

### Technical Implementation

#### Files Modified

| File | Purpose |
|------|---------|
| `app/apps/file_editor_cm6/preferences_store.py` | Added `"stickyScroll": False` default preference |
| `app/apps/file_editor_cm6/codemirror.py` | Added `set_sticky_scroll(enabled)` Python method |
| `app/static/vendor/nicegui/elements/codemirror/codemirror.js` | Main implementation - `applyStickyScroll()` method with ViewPlugin |
| `app/apps/file_editor_cm6/editor_app.py` | Preference handling, hooks for page/file load |
| `app/apps/file_editor_cm6/templates/template.html` | Added "Sticky Scroll" menu item in View menu |
| `app/apps/file_editor_cm6/static/main.js` | Toggle binding and menu checkbox state management |

#### Architecture

```
applyStickyScroll(enabled) method in codemirror.js:
├── getScopeTypes() - Returns language-specific AST node types
├── escapeHtml() - XSS protection for displayed text  
├── stickyScrollTheme - CM6 baseTheme with CSS styles
├── stickyScrollPlugin - ViewPlugin class
│   ├── constructor() - Creates DOM, attaches scroll listener
│   ├── updateStickyHeader() - Main logic
│   │   ├── Position overlay (absolute, beside gutter)
│   │   ├── Detect position via lineBlockAtHeight(scrollTop)
│   │   ├── Walk syntax tree to find enclosing scopes
│   │   ├── Filter scopes using (i+1)*lineHeight offset
│   │   └── Render to DOM
│   ├── update() - Re-render on doc changes
│   └── destroy() - Cleanup
└── Compartment management for toggle on/off
```

#### Key Technical Decisions

1. **ViewPlugin instead of showPanel** - Allows overlay positioning without affecting editor layout

2. **Absolute positioning inside `view.dom`** - Works reliably in iframe context

3. **Gutter-aware positioning** - `left: gutterWidth + 'px'` aligns with code content

4. **Direct scroll listener** - `view.scrollDOM.addEventListener('scroll', ...)` for immediate response instead of relying on CM6's batched updates

5. **`lineBlockAtHeight(scrollTop)`** - Stable position detection that works during CM6 update cycles (replaced `posAtCoords` which threw errors)

6. **`(i + 1) * lineHeight` trigger offset** - Each nested scope level triggers one line earlier to account for overlay growth

---

## What Works ✅

1. **Single scope detection** - Top-level function/class appears correctly when scrolled out of view
2. **Nested scope detection** - Multiple levels of nesting are detected and displayed
3. **Indentation preserved** - Original whitespace/indentation shown in sticky header
4. **Click-to-jump** - Clicking navigates to the scope definition
5. **Toggle on/off** - Menu item works, preference persists
6. **No CM6 update errors** - `lineBlockAtHeight` fix eliminated "layout read during update" errors
7. **Trigger timing** - Scopes appear at approximately the right scroll position

---

## Known Issues ❌

### 1. Flicker at Scope Boundaries
When scrolling near the point where a nested scope should appear/disappear, there's visible flicker. The scope rapidly toggles in/out of the header.

**Root cause:** Feedback loop between:
- Detection point calculation
- Overlay height changes
- Trigger threshold calculations

**Attempted fixes:**
- Hysteresis (different add/remove thresholds) - added lag
- `virtualTop` calculation (Dex's approach) - didn't resolve
- DOM `offsetHeight` vs calculated height - caused feedback loop

### 2. Subsequent Scope Trigger Timing
While the first scope triggers at the correct +1 line offset, subsequent nested scopes don't consistently trigger at +2, +3, etc. They sometimes all trigger at the same +1 offset.

**Status:** The math is correct (verified via console logging), but visual behavior doesn't always match.

---

## Implementation Journey

### Phase 1: Basic Structure
- Added preference, Python binding, menu item
- Created `applyStickyScroll()` with basic ViewPlugin
- Used `showPanel` initially (later changed to ViewPlugin for overlay)

### Phase 2: Positioning
- Started with panel (takes layout space) - caused scroll thrash
- Changed to absolute overlay inside `view.dom`
- Added gutter width calculation for alignment

### Phase 3: Scroll Detection
- Initial: CM6's `viewportChanged` - too slow/batched
- Added direct scroll listener on `scrollDOM` - immediate response
- Used `posAtCoords` for position detection - worked but had issues

### Phase 4: Trigger Offset (n+1 Problem)
- Problem: Scopes triggered too late (after already hidden by overlay)
- Solution: `(i + 1) * lineHeight` offset per nesting level
- Verified via extensive console logging that math is correct

### Phase 5: Flicker Fixes (Ongoing)
- Tried: `overlayHeight` from DOM - feedback loop
- Tried: `expectedOverlayHeight` from scope count - still flickered
- Tried: Hysteresis buffer - added lag without fixing flicker
- Tried: Dex's `virtualTop` approach - didn't resolve

### Phase 6: CM6 Error Fixes
- `posAtCoords` threw "layout read during update" errors
- Switched `reportScrollPosition` to use `lineBlockAtHeight(scrollTop)`
- Stable, no more errors

---

## Code Locations

### Main Implementation
`app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- Lines ~1240-1510: `applyStickyScroll()` method
- Lines ~980-1050: `reportScrollPosition()` (updated to use `lineBlockAtHeight`)

### CSS Theme
Inside `applyStickyScroll()`:
```javascript
const stickyScrollTheme = CM.EditorView.baseTheme({
  ".cm-stickyHeader": { position: "absolute", ... },
  ".cm-sticky-line": { padding, cursor: "pointer", ... },
  ...
});
```

### Scope Types
```javascript
const getScopeTypes = () => {
  // JavaScript/TypeScript
  // Python  
  // Fallback
  return new Set([...]);
};
```

---

## Next Steps for Production Ready

1. **Fix flicker** - Need to find stable threshold calculation that doesn't oscillate

2. **Test edge cases:**
   - Very short files
   - Files with no functions
   - Deeply nested code (>5 levels)
   - Word wrap enabled
   - Various font sizes

3. **Performance audit** - Ensure no jank on large files

4. **Accessibility** - Keyboard navigation for sticky lines?

5. **Visual polish:**
   - Better styling/colors
   - Smooth transitions?
   - Collapse indicator?

---

## Reference Documents

- `tmp.md` - Initial implementation plan
- `tmp2.md` - Revised plan
- `tmp3.md` - Web search analysis
- `tmp4_plan.md` - Corrected implementation plan
- `tmp5.md` - Scroll fix plan
- `tmp6_progress.md` - Progress tracking
- `tmp7_status.md` - Status summary with current issue
- `tmp8_fix-proposal_1.md` - Atlas's fix proposal
- `tmp9_fix-proposal_2.md` - Dex's fix proposal (virtualTop)
- `tmp10.md` - Atlas's flicker fix (fixed offset / lineBlockAtHeight)
- `tmp11.md` - Dex's flicker fix (virtualTop monotonic)

---

## Commits

Branch contains multiple iterations. Key states:
- "at least it's calculating the right height" - working but flickering
- Current HEAD - `lineBlockAtHeight` fix applied, flicker remains

---

*This document represents the state of the sticky scroll feature as of 2025-12-03T19:54:43Z*

*vectorArc - TE2 Team*
