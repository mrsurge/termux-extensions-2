# Sticky Scroll Logic Analysis (Dec 5, 2025)

File: `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

## Potential Issues Identified

### 1. Redundant `effectiveTop` Calculation (Lines 1556-1558)
```javascript
const effectiveTop = direction >= 0
  ? baseTop + earlyLines * lineHeight   // scroll down or unchanged
  : baseTop + earlyLines * lineHeight;  // scroll up: correction only
```
Both branches are **identical**. This ternary serves no purpose. Either simplify to `const effectiveTop = baseTop + earlyLines * lineHeight;`, or the scroll-up branch was intended to have different logic.

---

### 2. Sibling Handoff Logic May Never Execute (Lines 1601-1610)
```javascript
for (let i = 0; i < scopes.length - 1; i++) {
  const curr = scopes[i];
  const next = scopes[i + 1];
  if (next.depth === curr.depth) { ... }
}
```
`scopes` is built from `ancestorNodes`, which is a **parent chain** (each entry has increasing depth). Two entries at the same depth in an ancestor chain shouldn't occur. This block appears to be vestigial code that never executes, or it's intended for a different data structure (actual siblings, not ancestors).

---

### 3. `nearEnd` Only Applies to `depth > 0` (Lines 1661-1671)
```javascript
if (scope.depth > 0) {
  // nearEnd calculation
}
```
Top-level scopes (depth 0) never receive the `nearEnd` linger benefit. If a file has a single top-level function ending, it won't get the same smooth push-up grace period as nested scopes. This may be intentional, but worth noting.

---

### 4. Missing `direction === 0` Consideration in Wrap OFF Mode
```javascript
earlyLines = direction >= 0 ? 1 : 0;
```
When `direction === 0` (no scroll change—e.g., doc edit or window resize), this uses `earlyLines = 1`, same as scrolling down. This could cause unexpected activation shifts on non-scroll updates.

---

### 5. `lastScrollTop` Not Updated on Early Returns
`this.lastScrollTop = scrollTop;` occurs at line 1871, after all rendering. If the function returns early (no syntax tree at lines 1573-1577, or no active scopes at lines 1715-1724), `lastScrollTop` is **never updated**. This causes stale direction detection on subsequent calls, potentially causing incorrect `earlyLines` values.

**Affected early-exit points:**
- Line 1575: `if (!tree || !tree.topNode) { ... return; }`
- Line 1723: `if (activeScopes.length === 0) { ... return; }`

---

### 6. Variable Naming Confusion: `prevActiveScopes` vs `prevActiveKeys`
- `prevActiveKeys` is derived from `this.currentScopes` (correct previous state)
- `prevActiveScopes` comes from `this.prevActiveScopes`
- Both track "previous" state but from different sources

The logic works, but the naming is confusing and could lead to maintenance errors. Consider consolidating or renaming for clarity.

---

## Summary

| Issue | Severity | Type |
|-------|----------|------|
| #1 - Redundant ternary | Low | Dead code |
| #2 - Sibling handoff never executes | Medium | Vestigial logic |
| #3 - `nearEnd` excludes depth 0 | Low | Possible oversight |
| #4 - `direction === 0` uses down behavior | Low | Edge case |
| #5 - `lastScrollTop` stale on early return | Medium | Bug |
| #6 - Naming confusion | Low | Maintainability |

Issues #1 and #5 are the most actionable. Issue #2 may indicate incomplete or abandoned logic.

---

## Root Cause Analysis: Python "Piling Up" Bug

**The sibling handoff logic (lines 1601-1610) is in the wrong place and operates on the wrong data.**

### The Problem:

1. `ancestorNodes` is built by walking **up the parent chain** from `refPos` (line 1581-1586). This means it only contains **ancestors of the current position** - nodes that *contain* `refPos`.

2. Two sibling functions like `_status_meta_from_code` (268) and `_search_by_changes` (281) are **never both in the ancestor chain at the same time**. When your cursor is inside `_status_meta_from_code`, only that function is in `ancestorNodes`. When inside `_search_by_changes`, only that one is.

3. **The sibling handoff logic can never execute** because `scopes` (derived from `ancestorNodes`) will never have two entries at the same depth - by definition, ancestors have strictly increasing nesting depth.

### Why "Piling Up" Happens:

When the syntax tree is **incomplete or not yet parsed** (common on initial load), `tree.resolveInner(refPos)` may return a node whose parent chain is malformed or missing. The Lezer parser incrementally parses, so:

- On first load, the tree may be partial
- After scrolling around, the parser catches up and the tree becomes complete
- Once complete, the ancestor chain is correct and only one top-level function appears

### Why It "Fixes Itself":

Scrolling forces viewport updates, which triggers the parser to complete more of the document. Switching files and coming back may also trigger a full re-parse.

### The Missing Logic:

To properly handle sibling handoff, you'd need to:
1. Find the **actual next sibling** at the same depth in the syntax tree (not in the ancestor chain)
2. Use that sibling's start position to clamp the current scope's `endTriggerLine`

This would require something like:
```javascript
// For each scope, find its next sibling in the tree (not in ancestors)
const nextSibling = scope.node.nextSibling;
if (nextSibling && isScopeNode(nextSibling, scopeTypes)) {
  // Clamp endTriggerLine to hand off before sibling starts
}
```

### The `lastOverlaySampleHeight` Factor:

The "piling up" could also be exacerbated by stale `lastOverlaySampleHeight`. If two scopes incorrectly appear as nested, the overlay height grows. On the next pass, `samplingOverlayHeight` uses the inflated height, potentially causing `refLine` to sample deeper into the document, which could perpetuate the incorrect state.

---

### Summary of Python Bug:

| Observation | Explanation |
|-------------|-------------|
| Sibling functions "pile up" as nested | Incomplete syntax tree returns malformed parent chain |
| Fixes itself after scrolling | Parser completes incrementally; tree becomes correct |
| JavaScript works better | JS parser may be faster/more complete on initial load |
| Sibling handoff code is dead | It operates on ancestors (nested), not actual siblings |

---

*atlas - t2 contributor*
*2025-12-05*

---

## "Frame Rate" Issue Analysis

The rendering is driven by **scroll events + a single rAF follow-up** (lines 1419-1430):

```javascript
this.scrollHandler = () => {
  this.updateStickyHeader();
  if (!this.rafPending) {
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.updateStickyHeader();
    });
  }
};
```

**Problems:**

1. **Only one rAF queued at a time** - If scroll events fire faster than frames render, you get at most 2 updates per scroll burst (immediate + one rAF). Smooth 60fps scrolling would need continuous rAF chaining.

2. **No CSS transitions on the overlay** - The `topOffset` (push-up) is applied via `transform: translateY()` but there's no `transition` property. Every pixel change is a hard snap, not a smooth animation.

3. **Full DOM rebuild on every render** - The `renderKey` check (line 1808) tries to skip redundant rebuilds, but it includes `topOffset.toFixed(3)` - so even tiny push-up changes trigger full `innerHTML = ''` + rebuild. This is expensive.

---

## "Halfway Stuck" Issue Analysis

The push-up animation getting "stuck" between states is likely caused by:

1. **Hysteresis conflict with animation** - The `epsilon` hysteresis (line 1776-1778) keeps `topOffset` at its previous value if the change is small:
   ```javascript
   if (Math.abs(topOffset - this.lastTopOffset) < epsilon) {
     topOffset = this.lastTopOffset;
   }
   ```
   This is meant to prevent flicker, but during smooth scrolling it can cause the overlay to "stick" at an intermediate position until the delta exceeds `0.25 * lineHeight`.

2. **`lastOverlaySampleHeight` decay lag** - When scopes change, the sample height decays by at most one `lineHeight` per update (line 1867-1870). If the rAF rate is low, this decay is slow, keeping the overlay at a stale height.

3. **No interpolation** - There's no lerp/easing between states. The overlay jumps to discrete positions based on thresholds, and the hysteresis prevents small corrections, creating a "stuck in between" appearance.

---

## Potential Fix Direction

To address both issues:

1. **Add CSS transition** to `.cm-sticky-layer`:
   ```css
   transition: transform 0.1s ease-out, height 0.1s ease-out;
   ```

2. **Remove `topOffset` from `renderKey`** - Let CSS handle the animation; only rebuild DOM when scopes actually change (signature changes).

3. **Continuous rAF loop while scrolling** - Instead of one-shot rAF, maintain a loop that runs while scroll velocity is non-zero, with debounced stop.

4. **Separate DOM structure from transform updates** - Update `transform` and `height` styles directly without rebuilding DOM when only push-up changes.

---

*atlas - t2 contributor*
*2025-12-05*

---

**dex:**  
- #1 redundant ternary: agreed—simplify to `effectiveTop = baseTop + earlyLines * lineHeight`.  
- #2 sibling handoff: agreed—ancestor chain never has same-depth siblings; either remove or replace with real `node.nextSibling` clamp.  
- #3 nearEnd depth>0 only: probably OK, but we can optionally give depth 0 the linger if we see EOF snap.  
- #4 direction==0: minor; could use last direction or neutral bias, but not blocking.  
- #5 lastScrollTop not updated on early returns: real bug; update `lastScrollTop` (and maybe sample height) before early exits.  
- #6 naming confusion: low severity; a rename would help.  
Priority fixes: #5 (stale direction) and either remove or rework sibling handoff (#2).
