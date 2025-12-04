# Fix Proposal: Stateless Geometric Sticky Scroll

**Date:** 2025-12-03
**Author:** jimmy - te2 team
**Status:** Proposal

## Problem Analysis
The current sticky scroll implementation suffers from two main issues:
1. **Instability ("Double Drop"):** Caused by a feedback loop where `refLine` depends on `overlayHeight`. When the overlay appears, `refLine` shifts, potentially causing the overlay to disappear in the next frame. The `lastOverlayHeight` patch mitigated this but introduced a 1-frame lag.
2. **Misalignment:** The `depth`-based offset logic (`-(depth + 2)`) attempts to predict "future" stickiness but leads to inconsistent capture points (depth 0 feels early, depth 2 feels right).

## Proposed Solution: Stateless Geometric Approach
We should switch to a stateless, top-down approach similar to Monaco/VS Code. The core principle is: **Calculate stickiness based on the document's scroll position (`scrollTop`), independent of the sticky overlay's current state.**

### 1. The Algorithm
1. **Anchor Point:** Use `view.scrollDOM.scrollTop` to find the line at the very top of the viewport (`topLine`).
   - Do *not* add `overlayHeight` to this. We want to know what is physically at the top of the scrollable area.
2. **Candidate Discovery:** Resolve the syntax tree node at `topLine` and walk up the ancestors. These are the potential sticky scopes.
3. **Activation Logic:** A scope is sticky if its `startLine` is strictly less than `topLine`.
   - This means the header has scrolled off the top of the screen.
   - We stack all active scopes.
4. **Push-Up Logic:**
   - Calculate the total height of the sticky stack (`headerHeight`).
   - Check the `endLine` of the *innermost* active scope.
   - If the bottom of that `endLine` is colliding with the bottom of our sticky stack, shift the entire stack upwards.

### 2. Implementation Details

Replace the `updateStickyHeader` method in `codemirror.js` with this logic:

```javascript
updateStickyHeader() {
  const view = this.view;
  const state = view.state;
  const scrollTop = view.scrollDOM.scrollTop;
  
  // 1. Anchor: The line currently at the top of the viewport
  // We use the block at scrollTop. 
  let refPos;
  try {
    const block = view.lineBlockAtHeight(scrollTop);
    refPos = block.from;
  } catch {
    refPos = view.viewport.from;
  }
  const refLine = state.doc.lineAt(refPos).number;

  // 2. Candidates: Walk up from refLine
  const tree = CM.syntaxTree(state);
  if (!tree || !tree.topNode) {
    if (this.dom.innerHTML !== '') this.dom.innerHTML = '';
    this.currentScopes = [];
    return;
  }

  const scopeTypes = getScopeTypes();
  const ancestorNodes = [];
  let node = tree.resolveInner(refPos);
  for (; node; node = node.parent) {
    if (scopeTypes.has(node.name)) {
      ancestorNodes.push(node);
    }
  }
  ancestorNodes.reverse(); // depth 0 = outermost

  // 3. Activation: Filter scopes that have scrolled out
  // We strictly check startLine < refLine. 
  // If startLine == refLine, the header is visible at the very top, so we don't need a sticky copy yet.
  const activeScopes = [];
  for (const n of ancestorNodes) {
    const startLine = state.doc.lineAt(n.from).number;
    const endLine = state.doc.lineAt(n.to).number;
    
    // Core check: Is the start line above our current view?
    // And are we still within the scope (refLine <= endLine)?
    // (The tree traversal guarantees we are within the scope, but the push-up logic handles the exit)
    if (startLine < refLine) {
        activeScopes.push({
            node: n,
            startLine,
            endLine,
            text: state.doc.lineAt(n.from).text
        });
    }
  }
  
  // Limit stack depth
  const MAX_STICKY_LINES = 5;
  if (activeScopes.length > MAX_STICKY_LINES) {
    // Keep the innermost scopes or outermost? VS Code keeps outermost usually.
    // Let's keep outermost (0 to MAX-1)
    activeScopes.length = MAX_STICKY_LINES;
  }

  this.currentScopes = activeScopes;

  // 4. Render
  if (activeScopes.length === 0) {
    if (this.dom.innerHTML !== '') this.dom.innerHTML = '';
    this.dom.style.top = '0px'; // Reset position
    this.lastOverlayHeight = 0;
    return;
  }

  const escapeHtml = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  const newHtml = activeScopes.map((scope, idx) =>
    `<div class="cm-sticky-line" data-index="${idx}">${escapeHtml(scope.text)}</div>`
  ).join('');

  if (this.dom.innerHTML !== newHtml) {
    this.dom.innerHTML = newHtml;
  }

  // 5. Push-Up Calculation
  // We need to check if the *innermost* scope is ending.
  // If its end line is approaching the bottom of our sticky stack, push up.
  const innermost = activeScopes[activeScopes.length - 1];
  const lineHeight = view.defaultLineHeight;
  const headerHeight = activeScopes.length * lineHeight; // Approximation, or measure this.dom.offsetHeight
  
  // Find the bottom pixel of the innermost scope's end line
  // We can use lineBlockAt for the end of the line
  const endLineBlock = view.lineBlockAt(innermost.node.to);
  const endLineBottom = endLineBlock.bottom;
  
  // The bottom of our sticky stack in "document space" would be scrollTop + headerHeight
  const stackBottom = scrollTop + headerHeight;
  
  let topOffset = 0;
  if (endLineBottom < stackBottom) {
    // The scope ends before our stack ends! Push up.
    topOffset = endLineBottom - stackBottom;
  }

  this.dom.style.top = `${topOffset}px`;
  
  // Align left/right
  const gutterEl = view.dom.querySelector('.cm-gutters');
  const gutterWidth = gutterEl ? gutterEl.offsetWidth : 0;
  this.dom.style.left = gutterWidth + 'px';
  this.dom.style.right = '0';
  
  this.lastOverlayHeight = headerHeight;
}
```

## Benefits
1. **Stability:** `refLine` depends *only* on `scrollTop`, which is stable regardless of whether the overlay is shown or hidden. No more flicker.
2. **Accuracy:** Removing the arbitrary `offset` logic means scopes stick exactly when they scroll off-screen, consistent across all depths.
3. **Smooth Exit:** The `topOffset` calculation provides a smooth slide-out animation as scopes end, matching VS Code/Monaco behavior.

jimmy - te2 team
