# Sticky Scroll – Current Behavior & Observations (No Fixes Yet)

**Date:** 2025‑12‑03  
**Context:** Code CM6 sticky scroll feature (CodeMirror 6 + NiceGUI)  
**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js` – `applyStickyScroll()` / `stickyScrollPlugin`

> This document is purely descriptive: what the implementation looks like *right now*, what we observe in the UI, and what likely explains that behavior. **No new solutions or changes are being proposed here.**

---

## 1. Implementation State (High‑Level)

Sticky scroll is implemented as a CodeMirror 6 `ViewPlugin` inside `codemirror.js`. The plugin:

- Renders an absolutely‑positioned overlay `div.cm-stickyHeader` appended directly under `view.dom` (inside the editor iframe DOM).
- Tracks a list of currently active scopes in `this.currentScopes` for click‑to‑jump behavior.
- Samples scroll position using `view.scrollDOM.scrollTop` plus a computed offset to determine a reference position in the document (`refPos`), then walks the Lezer syntax tree upward from there to find nested scopes (functions, classes, etc.).
- Uses a line‑based “depth + offset” model to decide which scopes should be sticky and in what order.
- Renders one `<div class="cm-sticky-line">` per active scope, with the outermost at top and deeper scopes below it.

The plugin is wired into a compartment (`stickyScrollCompartment`) so it can be toggled via the UI and preferences.

---

## 2. Current Detection & Sampling Logic

### 2.1 Scroll Handling

- The plugin attaches a direct scroll listener:
  - `view.scrollDOM.addEventListener('scroll', this.scrollHandler, { passive: true })`.
  - `this.scrollHandler = () => this.updateStickyHeader();`

- To reduce visual jitter, `updateStickyHeader` uses a **time‑based backoff**:

  ```js
  const now = performance.now() or Date.now();
  if (now - this.lastRenderTime < 100) return;
  this.lastRenderTime = now;
  ```

  This ensures sticky header computations happen at most once every ~100 ms, even if many scroll events fire.

### 2.2 Reference Position (`refPos` / `refLine`)

- We compute:

  ```js
  const scrollTop = view.scrollDOM.scrollTop;
  const lineHeight = view.defaultLineHeight;
  const currentOverlayHeight = this.dom.offsetHeight || 0;
  const samplingOverlayHeight = this.lastOverlayHeight || currentOverlayHeight;
  const effectiveTop = scrollTop + samplingOverlayHeight + lineHeight;
  ```

- `samplingOverlayHeight` uses **the previous frame’s** overlay height when available (`this.lastOverlayHeight`). The goal is to keep the sampling line stable across the exact frame where the header grows or shrinks.

- We then ask CodeMirror’s layout for the line block at that pixel:

  ```js
  const block = view.lineBlockAtHeight(effectiveTop);
  refPos = block.from;
  // Fallback: refPos = view.viewport.from;
  const refLine = state.doc.lineAt(refPos).number;
  ```

- Intuitively: `refLine` is “the first code line *just below* the sticky header,” but it is derived from pixel height plus CM6’s internal block positioning, not from our own notion of “line 1 under the header.”

### 2.3 Scope Hierarchy Extraction

- We obtain the syntax tree once via `CM.syntaxTree(state)` (Lezer).
- From `refPos`, we walk the ancestor chain upward:

  ```js
  const scopeTypes = getScopeTypes();  // language‑aware set of node names
  const ancestorNodes = [];
  let node = tree.resolveInner(refPos);
  for (; node; node = node.parent) {
    if (scopeTypes.has(node.name)) {
      ancestorNodes.push(node);
    }
  }
  ancestorNodes.reverse(); // depth 0 = outermost, then deeper
  ```

- Each `node` in `ancestorNodes` is then mapped to a structured scope record:

  ```js
  const scopes = ancestorNodes.map((n, depth) => {
    const startLine = state.doc.lineAt(n.from).number;
    const endLine   = state.doc.lineAt(n.to).number;
    const text      = state.doc.lineAt(n.from).text;
    const offset    = -(depth + 2);        // depth 0 => -2, depth 1 => -3, etc.
    const triggerLine    = startLine + offset;
    const endTriggerLine = Math.max(startLine, endLine + offset);
    return { node: n, depth, startLine, endLine, text, triggerLine, endTriggerLine };
  });
  ```

- This “depth + offset” model encodes:
  - **Global early capture:** we pull everything one extra line earlier (the `+2` rather than `+1`).
  - **Per‑depth n+1:** deeper scopes are expected to be captured earlier in line space (top level `start−2`, next `start−3`, etc.).
  - **Early release:** `endTriggerLine` is also shifted by the same offset, shortening the sticky window at the end so that scopes “hand off” to the next deeper scope more gracefully.

---

## 3. Current Activation Logic (When a Scope “Sticks”)

Given `refLine` and the `scopes` array:

```js
const MAX_STICKY_LINES = 5;
const activeScopes = [];
for (const scope of scopes) {
  if (activeScopes.length >= MAX_STICKY_LINES) break;

  // Don’t consider deeper scopes until we’ve passed this scope’s trigger
  if (refLine <= scope.triggerLine) {
    break;
  }

  const active = refLine > scope.triggerLine && refLine <= scope.endTriggerLine;
  if (active) {
    activeScopes.push(scope);
  }
}
this.currentScopes = activeScopes;
```

---

## 4. Runtime Behavior We Actually See

This section captures what the feature is doing in practice in the editor, based on manual use and the console logs added around the sticky logic.

### 4.1 Overall “Shape” of the Feature

- The sticky header appears at the top of the editor when scrolling down into a file with nested scopes.
- The **outermost scope** (e.g. a top‑level class or function) shows up in the first sticky line at roughly the expected moment: slightly before its definition scrolls out of view.
- **Nested scopes** appear in the second and third sticky lines in the expected depth order (class → method → inner function, etc.).
- The early‑capture effect is clearly visible:
  - Deeper scopes tend to get pulled in before their header lines would be fully covered by the sticky region, matching the intended “n+1” behavior.
- Click‑to‑jump from the sticky header into the source works as intended (using `scope.node.from`).

### 4.2 End‑of‑Scope “Double Drop” (Previous State)

Before switching to the current `samplingOverlayHeight` approach, logs showed a recurrent pattern at the **end** of a scope:

- As `refLine` approached a scope’s `endTriggerLine`, the depth‑N scope would:
  1. Drop out (its `active` flag became false when `refLine > endTriggerLine`).
  2. Immediately reappear for one more frame.
  3. Then drop out for good on a subsequent frame.

Typical log sequence (simplified):

```text
refLine = 660, triggerLine = 651, endTriggerLine = 660 → active = true
refLine = 661, triggerLine = 651, endTriggerLine = 660 → active = false
... overlay shrinks ...
refLine = 659, triggerLine = 651, endTriggerLine = 660 → active = true
refLine = 661, triggerLine = 651, endTriggerLine = 660 → active = false
```

Key observations from those logs:

- The **overlay height** changed between samples (e.g. from three sticky lines to two), and the sampling position `effectiveTop` was based on the *current* overlay height.
- When the header shrank, the sampling line jumped upward, causing `refLine` to move back into the scope’s `[triggerLine + 1, endTriggerLine]` window once, and then out again on the next tick.

This is what produced the visually detectable “double flash” when a scope stopped being sticky.

### 4.3 Current Behavior (After Using `samplingOverlayHeight`)

With `samplingOverlayHeight = this.lastOverlayHeight || currentOverlayHeight`, the most obvious double‑flash at scope ends is gone. The behavior now is:

- Sticky scopes generally **enter** and **leave** the header only once as you scroll past their start/end ranges.
- The header feels stable while scrolling steadily down; the earlier “drop → reappear → drop” pattern is much less common.
- There is still a subtle perception that the **outermost scope** is captured slightly early and released slightly early, while deeper scopes may feel slightly better aligned.

### 4.4 Depth‑Wise Misalignment Pattern

Manual observation (and your notes) show a consistent qualitative pattern:

- Depth 0 (top‑level scope):
  - Appears **about one logical line early** relative to where the eye expects it.
  - Feels a bit “ahead” of the ideal capture point.
- Depth 1:
  - Appears **roughly half a line early** (less obviously early than depth 0).
- Depth 2 (and deeper):
  - Often feels **roughly “on time”** or at least not noticeably earlier than expected.

In other words, the same sampling and offset logic produces different perceived alignment at different depths: the deeper the scope, the closer it feels to the intuitive “right” capture line.

### 4.5 Interaction with the 100ms Backoff

The 100ms backoff has clear effects:

- It **removes high‑frequency jitter** that was previously visible when hovering near the trigger boundary.
- It also means sticky state updates occur in discrete steps, which:
  - Can make a single off‑by‑one crossing at a boundary more noticeable.
  - Prevents some borderline re‑entries from being visible (they happen between throttled updates).

The backoff is therefore acting like a coarse “debounce” on visual state, masking some noise while exposing other slow‑moving shifts more clearly.

---

## 5. Likely Contributing Factors (Descriptive, Not Prescriptive)

This section summarizes factors that appear to contribute to the current behavior and misalignments. These are **not** solution proposals, just causal hypotheses based on the implementation and logs.

### 5.1 Sampling Position vs. Visual Expectation

- `refLine` is derived from:

  ```js
  effectiveTop = scrollTop + samplingOverlayHeight + lineHeight;
  const block = view.lineBlockAtHeight(effectiveTop);
  refPos = block.from;
  refLine = doc.lineAt(refPos).number;
  ```

- The **human expectation** of “the line just under the sticky header” may not match the line at this pixel, because:
  - The top visible code line may be partially covered or partially off‑screen.
  - `lineBlockAtHeight` chooses the block whose vertical span covers `effectiveTop`, which may be a half‑line into the next block or the preceding one depending on scroll alignment and CM6’s internal padding.

This mismatch can systematically bias `refLine` by roughly half a line or one line compared to what “looks” like the top of the visible code region.

### 5.2 Depth‑Dependent Offsets

- The model uses:

  ```js
  offset = -(depth + 2);      // depth 0 => -2, depth 1 => -3, ...
  triggerLine    = startLine + offset;
  endTriggerLine = max(startLine, endLine + offset);
  ```

- A **single** sampling bias in `refLine` applies to every depth, but the offsets differ per depth. As a result:
  - The same `refLine` shift can present as “one line early” for depth 0,
  - “half a line early” for depth 1,
  - and “roughly aligned” for depth 2, depending on how the offsets and start/end ranges line up.

In effect, a small systematic error in `refLine` can manifest differently at each depth because the capture window for each scope is shifted by a different amount.

### 5.3 Line Height vs. Actual Sticky Row Height

- `lineHeight` comes from `view.defaultLineHeight`.
- The sticky header rows (`.cm-sticky-line`) may not match `lineHeight` exactly due to:
  - CSS padding,
  - border widths,
  - font metrics differences vs. main content.

If a sticky row is even a few pixels taller/shorter than the editor line height:

- The physical height of the overlay (in pixels) may not correspond exactly to an integer number of `lineHeight`s.
- This can subtly shift what “one line below the overlay” means in visual terms.

### 5.4 Quantization from Backoff + Block Sampling

- The 100ms backoff means we only evaluate sticky state on a coarse time grid; the scroll position may move across several pixels (or fractions of lines) between evaluations.
- `lineBlockAtHeight` returns the block covering a **range** of vertical pixels; small changes in `effectiveTop` can jump `refLine` from one block to the next in a single update.
- Together, these effects can make trigger crossings appear as abrupt, single‑frame events rather than smooth transitions, especially at boundaries where:
  - `refLine` is near `triggerLine` or `endTriggerLine`, and
  - the overlay has just grown or shrunk.

### 5.5 Overlay Height Memory (`lastOverlayHeight`)

- Using `samplingOverlayHeight = lastOverlayHeight` instead of the current height has reduced the obvious “drop → re‑enter → drop” pattern, because:
  - The sampling line doesn’t react immediately to header size changes.
  - It instead uses the previous frame’s height, then updates `lastOverlayHeight` *after* rendering.

However, this also means:

- There is always a **one‑frame lag** between the true header height and the sampling geometry used for the next decision.
- At certain scroll speeds and positions, this lag can push `refLine` into or out of a scope’s `[triggerLine, endTriggerLine]` window slightly before or after the visual threshold the user expects, contributing to the “one line early” / “half line early” perception by depth.

---

**Summary:**  
The current sticky scroll implementation reliably identifies scopes and renders them in the correct depth order. The capture and release points are intentionally shifted earlier in line space (global early capture plus per‑depth n+1 offsets), but the combination of pixel‑based sampling (`lineBlockAtHeight`), per‑depth offsets, sticky row vs. editor line height differences, and the 100ms backoff leads to small, depth‑dependent misalignments between when a scope *feels* like it should stick/unstick and when the code decides it should. These observations are consistent with the logs and on‑screen behavior; this document does not propose specific fixes, only describes the current state and plausible contributing factors. 
