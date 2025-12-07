I've analyzed your implementation.  You're dealing with a classic "chicken and egg" timing problem with the overlay-based sticky scroll.  Let me break down what I see:

## The Core Problem

Your `n+1` formula is trying to solve two related but distinct issues:

1. **Base trigger offset (+1):** The minimap's scroll detection fires when a line is *completely* outside the viewport, but you want the sticky header to appear *just as* the line scrolls out—hence triggering one line early.

2. **Overlay occlusion offset (+n):** Once you have `n` scopes displayed in the overlay, those scopes physically cover the top `n × lineHeight` pixels of the viewport.  New scopes scrolling under that overlay are technically "in viewport" but visually hidden.

## The Bug in Your Current Implementation

```javascript
// How many scopes are currently displayed from previous render
const displayedCount = this.currentScopes.length;

// ... 

for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  // ...
  const levelOffset = Math.min(i, displayedCount) + 1;
  const triggerOffset = levelOffset * lineHeight;
  
  if (defBlock.bottom <= scrollTop + triggerOffset) {
    // ... 
  }
}
```

**The issue:** You're using `displayedCount` from the *previous* render, but you're iterating through `scopes` (the *current* potential scopes).  The `Math.min(i, displayedCount)` creates inconsistent behavior:

- When `i < displayedCount`: offset = `(i + 1) * lineHeight` ✓
- When `i >= displayedCount`: offset = `(displayedCount + 1) * lineHeight` for ALL remaining scopes

This means if you had 2 scopes displayed and now there are 4 potential scopes, scopes at index 2 and 3 both get the same offset `(2 + 1) * lineHeight = 3 lines`—which is wrong.

## The Correct Formula

Each scope at level `i` should trigger when its definition line scrolls above `(i + 1) * lineHeight` from the top.  The `+1` accounts for the base "trigger early" behavior you need.

```javascript
// Simpler and correct:
for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);
    // Each level needs its own offset:
    // Level 0 (outermost): triggers when defBlock.bottom <= scrollTop + (1 * lineHeight)
    // Level 1: triggers when defBlock.bottom <= scrollTop + (2 * lineHeight)
    // etc. 
    const triggerOffset = (i + 1) * lineHeight;
    
    if (defBlock.bottom <= scrollTop + triggerOffset) {
      const defLine = state.doc.lineAt(scopeNode.from);
      filteredScopes.push({
        node: scopeNode,
        lineText: defLine.text
      });
    }
  } catch {}
}
```

## Why Your Previous Approach Was Overcomplicated

You were trying to use `displayedCount` to handle the "overlay is already covering space" case, but that's already handled by the progressive `(i + 1)` offset:

- When you have 0 scopes displayed, scope 0 triggers at `1 * lineHeight` offset
- When you have 1 scope displayed (taking 1 line of space), scope 1 triggers at `2 * lineHeight` offset—which accounts for both the base trigger AND the space already occupied

The `displayedCount` from the previous frame is only needed if you want to prevent *flicker* during rapid scrolling (hysteresis), not for the offset calculation itself.

## Additional Edge Case: Variable Line Heights

If your sticky lines have different heights than editor lines (padding, borders), you should measure the actual overlay height:

```javascript
updateStickyHeader(forceUpdate = false) {
  // ... existing code...
  
  // Get actual overlay height for accurate offset
  const overlayHeight = this.dom.offsetHeight || 0;
  
  for (let i = 0; i < scopes.length; i++) {
    const scopeNode = scopes[i];
    try {
      const defBlock = view.lineBlockAt(scopeNode.from);
      // Base offset (trigger 1 line early) + existing overlay height
      // For scope i, we need: previous scopes' height + 1 line
      // Approximation: (i * avgStickyLineHeight) + lineHeight
      // Or simpler: just use (i + 1) * lineHeight if heights match
      const triggerOffset = (i + 1) * lineHeight;
      
      if (defBlock.bottom <= scrollTop + triggerOffset) {
        // ...
      }
    } catch {}
  }
}
```

## Summary

| Issue | Your Code | Fix |
|-------|-----------|-----|
| Base trigger | `+1` in formula | ✓ Correct |
| Per-level offset | `Math.min(i, displayedCount)` | Change to just `i` |
| Stale state dependency | Uses `this.currentScopes. length` | Remove—not needed for offset |

The corrected loop:

```javascript
const lineHeight = view.defaultLineHeight;
const filteredScopes = [];

for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);
    const triggerOffset = (i + 1) * lineHeight;
    
    if (defBlock.bottom <= scrollTop + triggerOffset) {
      const defLine = state.doc.lineAt(scopeNode.from);
      filteredScopes. push({
        node: scopeNode,
        lineText: defLine.text
      });
    }
  } catch {}
}

this.currentScopes = filteredScopes;
```

This should give you correct progressive triggering where each nested scope appears exactly when it would otherwise be hidden by the overlay. 

*ATLAS TE - 2 Team*