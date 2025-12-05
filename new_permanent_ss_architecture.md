# Permanent Sticky Scroll Architecture

**Date:** 2025-12-05  
**Status:** Working Implementation

## Overview

This document describes the slot-based sticky scroll system for CodeMirror 6. The architecture ensures **one scope per depth level** (no Y-axis pileup) using a registration system that manages scope capture and release.

## Core Components

### 1. StickySlots Class

A slot manager that enforces the invariant: **maximum one scope per depth level**.

```javascript
class StickySlots {
  constructor(maxSlots = 5)
  register(scope)      // Register scope into its depth slot
  clear(depth)         // Clear slot and all deeper slots
  clearAll()           // Clear all slots
  get(depth)           // Get scope at depth (or null)
  getActive()          // Get all non-null slots in order
  getMaxDepth()        // Get deepest occupied slot index
}
```

**Key behavior:**
- `register()` returns `false` if slot is occupied by a **different** scope
- `register()` updates the slot if same scope (by `startLine`)
- `clear(depth)` cascades - clears the specified depth AND all deeper slots

### 2. Scope Object Structure

Each scope contains:
```javascript
{
  node,           // Lezer syntax tree node
  depth,          // 0 = outermost, increases inward
  startLine,      // Actual line number where scope starts
  endLine,        // Actual line number where scope ends
  text,           // Text content of the start line
  triggerLine,    // Early capture point: startLine - (depth + 2)
  endTriggerLine  // End trigger: max(startLine, endLine - (depth + 2))
}
```

### 3. n+1 Offset System

The **triggerLine** calculation provides early capture:
```
triggerLine = startLine - (depth + 2)
```

- Depth 0: offset -2 (captures 2 lines early)
- Depth 1: offset -3 (captures 3 lines early)
- Depth 2: offset -4 (captures 4 lines early)

This creates the "n+1" effect where scopes appear in the sticky header **before** their actual start line scrolls to the top.

## Two-Pass Update Algorithm

### Pass 1: Clear Invalid Slots

For each occupied slot, check if it should be cleared:

```javascript
const scrolledAbove = scopedRef <= existing.startLine;
const scrolledBelow = scopedRef > existing.endTriggerLine + earlyMarginLines;
const shouldClear = scrolledAbove || scrolledBelow;
```

**Release triggers:**
- `scrolledAbove`: When `refLine <= startLine` (scrolled up past the scope)
- `scrolledBelow`: When `refLine > endTriggerLine + 1.5` (scrolled down past end)

### Pass 2: Register Candidate Scopes

For each scope in the ancestor chain at `refPos`:

```javascript
const lower = wasActive 
  ? scope.triggerLine - hysteresisLines 
  : scope.triggerLine + hysteresisLines;
const upper = wasActive 
  ? scope.endTriggerLine + hysteresisLines 
  : scope.endTriggerLine - hysteresisLines;

let shouldActivate = scopedRef > lower && scopedRef <= upper;
```

**Capture triggers:**
- `refLine > triggerLine` (with hysteresis adjustment)
- `refLine <= endTriggerLine` (with hysteresis adjustment)

**Hysteresis:** 0.5 lines added/subtracted based on whether scope `wasActive` to prevent edge flicker.

## Reference Line Calculation

```javascript
const scrollTop = view.scrollDOM.scrollTop;
const samplingOverlayHeight = this.lastOverlaySampleHeight || currentOverlayHeight;
const baseTop = scrollTop + samplingOverlayHeight;
const effectiveTop = baseTop + earlyLines * lineHeight;
const refPos = view.lineBlockAtHeight(effectiveTop).from;
const refLine = state.doc.lineAt(refPos).number;
```

**Key insight:** The reference line is sampled **below** the current overlay height to avoid feedback loops where the overlay changing size affects which scopes are detected.

## Word Wrap Correction

When line wrapping is enabled, a drift correction is applied:

```javascript
const scrollFrac = scrollTop / (scrollHeight - clientHeight);
const driftCorrectionLines = scrollFrac * extraEarlyLinesAtBottom;
```

This compensates for the document appearing "longer" due to wrapped lines, keeping scope alignment consistent from top to bottom.

## Render Key Optimization

To avoid redundant DOM rebuilds:

```javascript
const signature = activeScopes.map(s => `${s.depth}:${s.startLine}-${s.endLine}`).join('|');
const renderKey = `${signature}|${topOffset.toFixed(3)}|${effectiveHeight.toFixed(3)}`;
if (renderKey === this.lastRenderKey) return;
this.lastRenderKey = renderKey;
```

**Critical fix:** When `activeScopes.length === 0`, reset `lastRenderKey = ''` to ensure the next non-empty render isn't skipped.

## Push-Up Effect

When the innermost scope's end approaches the sticky header bottom:

```javascript
const endBottomViewport = endLineBlock.bottom - scrollTop;
const stackBottomViewport = headerHeight;
const delta = endBottomViewport - stackBottomViewport;
if (delta < earlyMargin) {
  topOffset = Math.max(-earlyMargin, delta - earlyMargin);
}
```

This slides the entire overlay up so it appears "attached" to the scope's end rather than overlapping content.

## Event Flow

1. **Scroll event** → `updateStickyHeader()`
2. **Direction detection** → Track `lastScrollTop` for scroll direction
3. **Pass 1** → Clear slots for scopes we've scrolled past
4. **Pass 2** → Register candidate scopes from syntax tree
5. **Get active** → `slots.getActive()` returns scopes in depth order
6. **Render check** → Skip if `renderKey` unchanged
7. **DOM rebuild** → Create layer elements for each active scope

## Debug Logging

When `DEBUG_SLOTS = true`:

- `[Slots] heartbeat` - Every 50th call with scrollTop
- `[Slots] check` - First pass slot validation
- `[Slots] CLEARING` - When a slot is cleared
- `[Slots] candidate` - Second pass scope evaluation
- `[Slots] REGISTER` - When a scope is registered
- `[Slots] activeScopes` - Final active scope count

Logs forward from iframe to parent via `window.parent.console.log()`, then to WebSocket at `/ws/app/file_editor_cm6/debug_console`, writing to `browser_console.log`.

## Constants

```javascript
const hysteresisLines = 0.5;      // Edge flicker prevention
const earlyMarginLines = 1.5;     // Push-up and end detection margin
const earlyMargin = 3 * lineHeight; // Push-up animation distance
const MAX_SLOTS = 5;              // Maximum nesting depth
```

## Files

- **Main implementation:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- **Debug WebSocket:** `app/apps/file_editor_cm6/main.py` (`/ws/debug_console`)
- **Console forwarding:** `app/apps/file_editor_cm6/main.js`
- **Log output:** `app/apps/file_editor_cm6/browser_console.log`
