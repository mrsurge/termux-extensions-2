# Fix Proposal: Geometric "Consumed-By-Overlay" Sticky Scroll

**Date:** 2025-12-03
**Author:** jimmy - te2 team
**Status:** Corrected Proposal (Matching Monaco/VS Code behavior)

## Problem Analysis
The previous "Stateless" proposal failed because it only checked `startLine < topLine`. This causes **underscroll**: scopes disappear behind the overlay *before* becoming sticky, because the overlay itself consumes vertical space.
As identified in `tmp22.md`, we must account for the "virtual slot" each scope occupies. Depth 0 needs to stick at 0px offset, Depth 1 at 20px (assuming 20px line height), etc.

## The Monaco Solution (Verified)
Monaco's `stickyScrollController.ts` uses a pixel-geometric check:
```typescript
const topOfElement = range.top; // Virtual slot (e.g., 0, 20, 40...)
const topOfBeginningLine = this._editor.getTopForLineNumber(start) - scrollTop; // Physical position relative to viewport

if (topOfElement > topOfBeginningLine && topOfElement <= bottomOfEndLine) {
    // Make sticky
}
```
This condition `topOfElement > topOfBeginningLine` is the key. It means: "Is the slot where this header *should* be (e.g., 20px) currently *below* where the header actually is?"
- If the header is at 30px (physically), and belongs at 20px (virtually), `20 > 30` is False.
- If the header scrolls up to 19px, `20 > 19` is True. **It sticks.**
- This automatically handles the "N+1" (or "consumed by overlay") effect geometrically.

## Implementation Plan for CodeMirror 6

We will replace the `updateStickyHeader` method in `codemirror.js` with this logic.

### 1. Helper: Calculate Scope Depth
We need a helper to calculate the "Scope Depth" (number of scope-like ancestors) for any node, to assign its `virtualTop`.

```javascript
function getScopeDepth(node, scopeTypes) {
  let depth = 0;
  let curr = node.parent;
  while (curr) {
    if (scopeTypes.has(curr.name)) {
      depth++;
    }
    curr = curr.parent;
  }
  return depth;
}
```

### 2. The Algorithm

```javascript
updateStickyHeader() {
  const view = this.view;
  const state = view.state;
  const scrollTop = view.scrollDOM.scrollTop;
  const lineHeight = view.defaultLineHeight;
  
  // 1. Define Search Window
  // We must look ahead by the max potential overlay height to catch scopes 
  // that are "consumed" (hidden behind the overlay) even if they start below 0.
  const MAX_STICKY_LINES = 5;
  const maxOverlayHeight = MAX_STICKY_LINES * lineHeight;
  
  // Find the document position corresponding to the bottom of the potential overlay
  // We use lineBlockAtHeight to convert pixel Y -> document pos
  let searchEndPos;
  try {
     // scrollTop + maxOverlayHeight gives the absolute Y of the search limit
     const block = view.lineBlockAtHeight(scrollTop + maxOverlayHeight);
     searchEndPos = block.to;
  } catch {
     searchEndPos = view.viewport.to;
  }

  const tree = CM.syntaxTree(state);
  if (!tree) return;

  const scopeTypes = getScopeTypes();
  const candidates = [];

  // 2. Iterate Tree in Search Window
  // We look for ANY scope node that overlaps [scrollTop, scrollTop + maxOverlayHeight]
  // actually, we iterate from viewport.from to searchEndPos to be safe/efficient
  tree.iterate({
    from: view.viewport.from,
    to: searchEndPos,
    enter: (node) => {
      if (scopeTypes.has(node.name)) {
        candidates.push(node);
      }
    }
  });

  // 3. Filter & Activate
  const activeScopes = [];
  
  for (const node of candidates) {
    // Calculate Depth -> Virtual Top
    const depth = getScopeDepth(node, scopeTypes);
    const virtualTop = depth * lineHeight;
    
    // Calculate Physical Position
    // lineBlockAt(node.from).top is the absolute Y of the line top
    const block = view.lineBlockAt(node.from);
    const physicalTop = block.top - scrollTop;
    
    // Bottom check (for exit)
    // We can approximate bottom using line count or just use the node end
    // Use the block at the END of the node to find physical bottom
    const endBlock = view.lineBlockAt(node.to);
    const physicalBottom = endBlock.bottom - scrollTop;

    // CORE MONACO LOGIC:
    // 1. Is the header physically "above" (or colliding with) its virtual slot? (Capture)
    // 2. Is the bottom of the scope still below the virtual slot? (Exit/Push-up)
    if (virtualTop > physicalTop && virtualTop < physicalBottom) {
       activeScopes.push({
         node,
         depth,
         text: state.doc.lineAt(node.from).text,
         virtualTop,
         physicalBottom
       });
    }
  }

  // 4. Sort & Prune
  // Sort by depth (0 -> N)
  activeScopes.sort((a, b) => a.depth - b.depth);
  
  // Keep only up to MAX
  if (activeScopes.length > MAX_STICKY_LINES) {
    activeScopes.length = MAX_STICKY_LINES;
  }
  
  this.currentScopes = activeScopes;

  // 5. Render
  if (activeScopes.length === 0) {
    if (this.dom.innerHTML !== '') this.dom.innerHTML = '';
    this.dom.style.top = '0px';
    this.lastOverlayHeight = 0;
    return;
  }

  // ... (HTML generation same as before) ...

  // 6. Push-Up Logic
  // Check the innermost scope (last in list)
  const innermost = activeScopes[activeScopes.length - 1];
  const stackBottom = (activeScopes.length) * lineHeight; // Virtual bottom of stack
  
  let topOffset = 0;
  // If the physical bottom of the innermost scope is pushing up the stack
  if (innermost.physicalBottom < stackBottom) {
     topOffset = innermost.physicalBottom - stackBottom;
  }
  
  this.dom.style.top = `${topOffset}px`;
  
  // Align
  const gutterEl = view.dom.querySelector('.cm-gutters');
  const gutterWidth = gutterEl ? gutterEl.offsetWidth : 0;
  this.dom.style.left = gutterWidth + 'px';
  this.dom.style.right = '0';
  
  this.lastOverlayHeight = activeScopes.length * lineHeight;
}
```

## Why This Works
- **Correct Capture:** Depth 1 (20px slot) captures when the line reaches 19px (physically). This happens *before* it hits 0px, exactly effectively "consuming" the line into the overlay stack.
- **Correct Exit:** The `virtualTop < physicalBottom` check ensures we don't stick to scopes that have completely scrolled off (top).
- **Correct Push-Up:** `physicalBottom - stackBottom` exactly replicates the smooth exit animation.

jimmy - te2 team