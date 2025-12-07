# Scroll Position Detection Fix - Code CM6

**Created:** 2025-12-03T15:58:48Z  
**Author:** vectorArc - TE2 Team  
**Status:** In Progress  
**Previous:** tmp4_plan.md (Sprint 1 complete - sticky scroll MVP)

---

## Problem Statement

Both sticky scroll and the "resume on line N" scroll tracking report line positions that are "off" - typically triggering late or selling the line number short, especially at document bottom.

### Root Cause Analysis

**Current implementations use flawed approaches:**

1. **Sticky Scroll** (`applyStickyScroll`):
   ```javascript
   const scrollTop = view.scrollDOM.scrollTop;
   const firstBlock = view.lineBlockAtHeight(scrollTop);
   pos = firstBlock.from;
   ```
   **Problem:** `lineBlockAtHeight(scrollTop)` doesn't account for panels (like the sticky header itself!) which shift the coordinate system.

2. **Scroll Tracking** (`reportScrollPosition`):
   ```javascript
   const ranges = view.visibleRanges;
   const from = ranges[0].from;
   const lineInfo = state.doc.lineAt(from);
   ```
   **Problem:** `visibleRanges[0].from` returns the first *rendered* content position, but CM6 renders a buffer zone above/below the viewport for smooth scrolling. This is several lines BEFORE what's actually visible.

### Why Minimap Works

Minimap uses **scroll ratios** instead of CM6's document-position APIs:
```javascript
const { clientHeight, scrollHeight, scrollTop } = this.view.scrollDOM;
const scrollRatio = scrollTop / (scrollHeight - clientHeight);
```

### The Correct Approach

CM6 provides `posAtCoords()` which asks "what document position is at this screen coordinate?" - this accounts for all panels, decorations, and transformations.

```javascript
// Get editor's visual bounding box
const editorRect = view.dom.getBoundingClientRect();

// Ask: "what position is at the top-left of the visible editor?"
const pos = view.posAtCoords({ 
  x: editorRect.left + 10,  // Small offset to avoid gutter
  y: editorRect.top + 1     // Just inside the top edge
});

if (pos !== null) {
  const line = view.state.doc.lineAt(pos);
  // line.number is the ACTUAL visible line at top
}
```

---

## Implementation Plan

### Task 1: Fix Sticky Scroll Position Detection ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Location:** `applyStickyScroll()` method, inside `update(update)` function

**Change:** Replace `lineBlockAtHeight` approach with `posAtCoords`

**Before:**
```javascript
const scrollTop = view.scrollDOM.scrollTop;

// Use lineBlockAtHeight for precise position with line wrapping
let pos;
try {
  const firstBlock = view.lineBlockAtHeight(scrollTop);
  pos = firstBlock.from;
} catch {
  pos = view.viewport.from;
}
```

**After:**
```javascript
// Use posAtCoords for accurate position accounting for panels
let pos;
try {
  const editorRect = view.dom.getBoundingClientRect();
  const coords = { 
    x: editorRect.left + 50,  // Offset past gutter
    y: editorRect.top + 5     // Just inside top edge
  };
  const result = view.posAtCoords(coords);
  pos = result !== null ? result : view.viewport.from;
} catch {
  pos = view.viewport.from;
}

const scrollTop = view.scrollDOM.scrollTop;
```

### Task 2: Fix Scroll Tracking Position Detection ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Location:** `reportScrollPosition()` method

**Change:** Replace `visibleRanges[0].from` with `posAtCoords`

**Before:**
```javascript
const ranges = view.visibleRanges;
if (!ranges || !ranges.length) return;
const from = ranges[0].from;
const lineInfo = state.doc.lineAt(from);
const line = lineInfo.number;
```

**After:**
```javascript
// Use posAtCoords for accurate top-of-viewport line
const editorRect = view.dom.getBoundingClientRect();
const coords = { 
  x: editorRect.left + 50,  // Offset past gutter
  y: editorRect.top + 5     // Just inside top edge
};
const pos = view.posAtCoords(coords);
if (pos === null) return;

const lineInfo = state.doc.lineAt(pos);
const line = lineInfo.number;
```

### Task 3: Add Bottom-of-Document Detection ✅

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Location:** `reportScrollPosition()` method

**Change:** Add special handling for document bottom

```javascript
// Detect if at bottom of document
const { scrollTop, scrollHeight, clientHeight } = view.scrollDOM;
const atBottom = Math.abs(scrollTop + clientHeight - scrollHeight) < 2;

if (atBottom) {
  // Report last line when at bottom
  const lastLine = state.doc.lines;
  this.notifyParent('cm6-scroll-state', {
    line: lastLine,
    column: 0,
    top: state.doc.length,
    atBottom: true,
    timestamp: Date.now(),
  });
  return;
}
```

---

## Testing Checklist

- [ ] Sticky scroll triggers at correct position (not late)
- [ ] Sticky scroll works with panels enabled
- [ ] Scroll tracking reports correct line at top
- [ ] Scroll tracking detects bottom of document
- [ ] Works with word wrap enabled
- [ ] Works with line numbers on/off
- [ ] No console errors
- [ ] Performance acceptable during rapid scroll

---

## Files Modified

| File | Changes | Status |
|------|---------|--------|
| `codemirror.js` | Fix `applyStickyScroll()` position detection | ✅ |
| `codemirror.js` | Fix `reportScrollPosition()` detection | ✅ |
| `codemirror.js` | Add bottom-of-document handling | ✅ |

---

## Completion Log

- [x] Task 1: Fix sticky scroll - DONE
- [x] Task 2: Fix scroll tracking - DONE  
- [x] Task 3: Add bottom detection - DONE
