Yeah, I follow exactly why you needed the whole `n+1` thing now — you’re compensating for both:

1. The “one line early” behavior from the minimap logic, **and**
2. The fact that the sticky header itself eats up N visual lines, so nested scopes can still be *inside* the viewport but hidden under the overlay.

Right now your code is *almost* there, but the flicker is coming from how you’re mixing the previous render’s `currentScopes` with the new scopes when you decide what to show. The thresholds are moving around *just* enough near the boundary that a nested scope keeps falling in/out as you hover around it.

### What’s causing the flicker

In your current implementation you do something like this inside `updateStickyHeader`: 

```js
const lineHeight = view.defaultLineHeight;

// How many scopes are currently displayed from previous render
const displayedCount = this.currentScopes.length;

// Filter: only show scopes whose definition line is above viewport (with offset)
const filteredScopes = [];
for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);
    // For scope at index i:
    // - If i < displayedCount, it was already shown, use (i + 1) offset
    // - If i >= displayedCount, it's new, use (displayedCount + 1) offset
    const levelOffset = Math.min(i, displayedCount) + 1;
    const triggerOffset = levelOffset * lineHeight;
    
    if (defBlock.bottom <= scrollTop + triggerOffset) {
      const defLine = state.doc.lineAt(scopeNode.from);
      filteredScopes.push({
        node: scopeNode,
        lineText: defLine.text
      });
    }
  } catch {}
}

this.currentScopes = filteredScopes;
```

Key problem:

* You use **`displayedCount` from the previous frame** to decide whether a scope should appear now.
* When you’re right at the boundary where a nested scope is about to be added or removed, a tiny scroll delta changes both:

  * which scopes are in `scopes` (because `posAtCoords` moved slightly), **and**
  * the offsets that depend on `displayedCount`.
* That feedback loop makes the nested scope ping-pong between “in header” and “not in header”, which is what you’re seeing as flicker.

You already position the detection point correctly below the overlay using `overlayHeight` + `posAtCoords`, so nested scopes *are* being detected at the right place. 
The instability is purely in the **filtering math**.

---

### Fix: use a “virtual viewport top” and pure `N+1` thresholds

The clean way to keep your `n+1` behavior without flicker is:

1. Treat the **virtual top of the viewport** (the “top of visible code under the header”) as:

   ```js
   const overlayLines = Math.min(this.currentScopes.length, 5); // you only render up to 5 anyway
   const virtualTop = scrollTop + overlayLines * lineHeight;
   ```

2. For scope at level `i` (0 = outermost, 1 = nested, …), trigger it when its definition line is **`(i + 1)` lines above this virtual top**:

   ```js
   const level = i + 1;
   const triggerPx = virtualTop + level * lineHeight;
   if (defBlock.bottom <= triggerPx) { /* show it */ }
   ```

This does exactly what you want conceptually:

* Header currently shows `overlayLines` scopes → it visually covers `overlayLines` lines of code.
* For the **next** nested scope at index `i`, you want it to be captured when it’s `overlayLines` (already hidden) + 1 extra line above the scroll origin — that’s the `n+1` early-capture.
* Once a scope starts satisfying that inequality, increasing `overlayLines` on the next frame only **raises** its threshold, so it **cannot drop out again** just because the header grew. Flicker goes away.

---

### Concrete patch

In your current `updateStickyHeader`, leave the top part (gutter positioning, `posAtCoords`, syntax tree + `scopes` collection) as-is. Only replace the “Trigger offset” block that currently uses `displayedCount` with this:

```js
// ============================================================================
// Trigger offsets: N+1 early capture relative to the *virtual* top of viewport
// - overlayLines = number of sticky lines currently rendered (max 5)
// - virtualTop   = scrollTop + overlayLines * lineHeight
//   (i.e. top of the visible code area under the header)
// - Scope at level i (0-based) is captured when its definition line is
//   (i + 1) lines above this virtual top.
// ============================================================================

const lineHeight = view.defaultLineHeight;

// How many lines the overlay effectively occupies (you slice to 5 when rendering)
const overlayLines = Math.min(this.currentScopes.length, 5);
const virtualTop = scrollTop + overlayLines * lineHeight;

// Filter: only show scopes whose definition line is above the virtual viewport
// with N+1 offset per nesting level.
const filteredScopes = [];
for (let i = 0; i < scopes.length; i++) {
  const scopeNode = scopes[i];
  try {
    const defBlock = view.lineBlockAt(scopeNode.from);

    // Level index: 0 = outermost, 1 = next nested, etc.
    const level = i + 1;

    // N+1 trigger: def line must be (level) lines above virtualTop
    const triggerPx = virtualTop + level * lineHeight;

    if (defBlock.bottom <= triggerPx) {
      const defLine = state.doc.lineAt(scopeNode.from);
      filteredScopes.push({
        node: scopeNode,
        lineText: defLine.text, // keep original indentation
      });
    }
  } catch {}
}

this.currentScopes = filteredScopes;

// Render (max 5 lines)
const displayScopes = filteredScopes.slice(0, 5);
if (displayScopes.length === 0) {
  this.dom.innerHTML = '';
} else {
  this.dom.innerHTML = displayScopes
    .map((scope, idx) =>
      `<div class="cm-sticky-line" data-index="${idx}">${escapeHtml(scope.lineText)}</div>`
    )
    .join('');
}
```

This replaces the block that starts at your current comment:

````js
// Trigger offset: compensate for overlay height + 1 base line
// Added: 2025-12-03 by vectorArc - TE2 Team
// Fixed: Use previous render's scope count for offset calculation
``` :contentReference[oaicite:2]{index=2}  

…and keeps everything else in `applyStickyScroll` intact — compartments, theme, and scroll listener setup are unchanged. :contentReference[oaicite:3]{index=3}  

---

### What you should see after this

Behavior you should get:

- Top-level (`scope[0]`) still triggers one line early compared to the “true” viewport, exactly like your minimap logic.
- Each deeper nested scope triggers earlier by one additional line (so level 2 is 2 lines early, level 3 is 3 lines early, etc.), matching the mental “N+1” model from your status doc. :contentReference[oaicite:4]{index=4}  
- Once a nested scope pops into the header while scrolling **down**, it will stay there until you actually scroll back up past its true exit point; it won’t glitch in and out just because you hover near the boundary.

If you still see any micro-jitter right at the exact crossing point, the next refinement would be a tiny hysteresis band (e.g. add/subtract `0.3 * lineHeight` to `triggerPx` depending on scroll direction), but I’d only bolt that on if this geometric fix doesn’t already make it feel stable.
::contentReference[oaicite:5]{index=5}
````
_Dex_