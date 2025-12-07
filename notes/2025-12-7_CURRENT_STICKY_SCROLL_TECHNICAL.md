# Sticky Scroll Technical Documentation
**Date:** 2025-12-07
**Status:** Production-Ready (with known architectural constraints)
**Component:** `@app/static/vendor/nicegui/elements/codemirror/codemirror.js`

## Overview
The Sticky Scroll feature provides a "Monaco-style" context overlay that pins scope headers (functions, classes, markdown headings) to the top of the editor viewport. It is designed to work within the CodeMirror 6 ecosystem but implements its own independent rendering and scroll tracking logic to achieve "n+1" lookahead precision and multi-line wrapping support.

## Core Architecture

### 1. Independent Rendering Layer
Unlike native CodeMirror extensions that might use the editor's own line rendering pipeline, this implementation manages its own DOM overlay (`.cm-stickyHeader`).
*   **Positioning:** `fixed` positioning within the `view.scrollDOM`.
*   **Stacking Context:** Sits at `z-index: 300`, placing it above the standard gutter (`z-index: ~200`) but below the Minimap (`z-index: 5000`).
*   **Font Sync:** Explicitly inherits the editor's font stack (`"EditorMono", "JetBrains Mono", monospace`) to ensure visual consistency.

### 2. The "n+1" Lookahead Heuristic
The defining feature of this implementation is its predictive activation logic.
*   **Concept:** A scope header is not just "sticky" when it hits the top; it is *pre-fetched* and rendered before the scrolling content physically slides under the header stack.
*   **Math:** `offset = -(cumulativeHeight + 2)`
    *   `cumulativeHeight`: The total height (in lines) of all active ancestor headers.
    *   `+ 2`: A constant lookahead buffer.
*   **Result:** As a line `n` scrolls up, the sticky header for scope `n` slides down or fades in exactly as line `n+1` approaches the stack bottom, preventing the "Y-axis pileup" common in naive implementations.

### 3. Dual-Mode Operation (Wrapping vs. Non-Wrapping)
The system dynamically switches logic based on the editor's `lineWrapping` preference.

#### Mode A: Non-Wrapped (Optimized)
*   **Assumption:** Every header is exactly 1 line tall.
*   **Logic:** Uses static offsets (e.g., `offset = -2`).
*   **CSS:** `white-space: pre`, `overflow: hidden`.
*   **Performance:** Extremely fast; no DOM measurement required.

#### Mode B: Wrapped (Dynamic)
*   **Assumption:** Headers may wrap to 2+ lines.
*   **Logic:**
    1.  **Render:** Draw the overlay with `white-space: pre-wrap` and `overflow-wrap: anywhere`.
    2.  **Measure:** Immediately measure the `offsetHeight` of every rendered layer.
    3.  **Cache:** Store line counts in `this.scopeHeights`.
    4.  **Re-Calculate:** If heights change, trigger a `requestAnimationFrame` retry to update the "n+1" offsets using the new cumulative heights.
*   **Visuals:**
    *   Gutter numbers align to the **top** (`align-items: flex-start`).
    *   Gutter background stretches to fill the row (`align-items: stretch`).

### 4. Slot-Based Scope Management
To prevent flickering and ensure clean handoffs between sibling scopes (e.g., one function ending and another beginning):
*   **Slots:** The `StickySlots` class enforces a strict "one scope per depth" invariant.
*   **Hysteresis:** Activation windows have a `0.5` line hysteresis buffer to prevent jitter at boundary conditions.
*   **Transitions:** Markdown headings support smooth cross-fading transitions between siblings. Code scopes use immediate swapping for snappiness.

## Technical Deep Dive: The Render Loop

The `updateStickyHeader` method is the heart of the system, running on every scroll event.

1.  **Sampling & Geometry:**
    *   Calculates `scrollTop` and scroll direction.
    *   Determines the `refLine` (the line currently at the "visual top" of the content, below the overlay).

2.  **Scope Candidate Generation:**
    *   **Code:** Traverses the syntax tree (`tree.resolveInner`) upwards from `refPos` to find ancestor nodes (Classes, Functions).
    *   **Markdown:** Uses a custom heading collection and path resolution algorithm.
    *   **Offset Calculation:** Applies the "n+1" offset logic here, adjusting `triggerLine` and `endTriggerLine` based on the mode (Wrapped vs. Non-Wrapped).

3.  **Slot Reconciliation:**
    *   Clears slots that have scrolled out of view.
    *   Registers new candidates if they fall within their calculated activation window.
    *   Handles "Push-Up" logic: If the end of a scope is approaching the stack bottom, the entire stack translates upward to visually "push" the header out of view.

4.  **DOM Construction:**
    *   Builds `.cm-sticky-layer` elements for each active scope.
    *   Applies `z-index` layering (outer scopes on top).
    *   Injects a synthetic gutter (`.cm-sticky-gutter`) with the correct line number.
    *   Injects content (`.cm-sticky-content`) using `getStyledLineHTML` to clone the editor's actual syntax highlighting.

## Known Constraints & Future Work

1.  **DOM Measurement Cost:** In wrapped mode, the double-render pass (render -> measure -> re-render) has a non-zero performance cost, though it is mitigated by caching.
2.  **Syntax Highlighting:** `getStyledLineHTML` relies on the line being currently rendered in the viewport. If a sticky header represents a line far above the viewport (virtualized out), it may lose syntax highlighting until the user scrolls back up.
3.  **Architectural Head:** The implementation is pushing the boundaries of what a "plugin" should do. A deeper integration (forking CodeMirror) would allow:
    *   Native access to the line rendering pipeline (solving the syntax highlighting issue).
    *   Better layout synchronization without manual DOM measurement.

## CSS Reference

```css
.cm-stickyHeader {
  position: fixed;
  z-index: 300; /* Above gutter (200), below Minimap (5000) */
  /* ... */
}

.cm-sticky-layer {
  display: flex;
  align-items: stretch; /* Fills height for wrapped lines */
}

.cm-sticky-gutter {
  align-items: flex-start; /* Numbers stay at top */
  justify-content: flex-end; /* Numbers align right */
}

.cm-sticky-content {
  padding: 0 0 0 6px; /* Matches CodeMirror internal padding */
  white-space: pre-wrap; /* Dynamic mode */
  word-break: normal;
  overflow-wrap: anywhere;
}
```
