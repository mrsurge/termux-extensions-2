# n+1 Architecture for Sticky Scroll

## Overview

The "n+1" architecture governs **when scopes become sticky** (appear in the header overlay) relative to the scroll position. It ensures scopes activate **before** the user visually enters them, compensating for the vertical space the sticky header itself occupies.

## The Core Problem

Without early activation:
1. User scrolls down toward a function definition
2. The function's first line reaches the top of the viewport
3. The sticky header appears, but now **obscures** the first few lines of the function
4. User sees the header but misses the context it's supposed to preserve

## The Solution: Early Trigger Offset

Each scope activates based on a `triggerLine` calculated **before** its actual start:

```javascript
// depth 0 => offset -2, depth 1 => -3, etc.
const offset = -(depth + 2);
const triggerLine = startLine + offset;
```

### Example

For a function starting at **line 100**:

| Depth | Offset | Trigger Line | Meaning |
|-------|--------|--------------|---------|
| 0 (top-level) | -2 | 98 | Activates 2 lines before function starts |
| 1 (nested) | -3 | 97 | Activates 3 lines before nested function |
| 2 (double-nested) | -4 | 96 | Activates 4 lines before |

### Why "+1" Per Depth?

Each nesting level adds one more line of anticipation because:
- Each active scope adds one line to the sticky header height
- The header grows as you enter deeper nesting
- Deeper scopes need more lead time to appear before being obscured

## Visual Timeline

```
Scroll Position    Header State           Why
─────────────────────────────────────────────────
Line 96            [empty]                Not yet in any scope's trigger zone
Line 97            [empty]                Still above trigger
Line 98            [FunctionA:100]        Triggered! 2 lines early for depth 0
Line 99            [FunctionA:100]        Header showing, approaching function
Line 100           [FunctionA:100]        Now AT the function; header already visible
Line 101           [FunctionA:100]        Inside function body; context preserved
```

## Additional Early Capture: `earlyLines`

On top of the base n+1 offset, the `earlyLines` variable adds scroll-direction-aware adjustment:

- **Scrolling down**: Extra anticipation (`earlyLines = 1` or more)
- **Scrolling up**: Reduced anticipation (`earlyLines = 0` or less)
- **Word wrap enabled**: Drift correction based on scroll fraction

This prevents jitter at scope boundaries when scroll direction changes.

## Why This Matters

The n+1 architecture is **critical** to the sticky scroll UX:

1. **Prevents "flash" on entry** - Header appears smoothly before you need it
2. **Compensates for header height** - You don't lose visible lines to the overlay
3. **Scales with nesting** - Deeper code gets proportionally more lead time
4. **Enables push-up effect** - Early activation gives room for smooth exit animations

## Implementation Location

File: `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

- **Offset calculation**: Lines 1594-1596
- **Early capture adjustment**: Lines 1544-1554
- **Activation logic**: Lines 1619-1676

---

*atlas - t2 contributor*
*2025-12-05*
