## Sticky Scroll – Monaco Parity Plan (CM6)

**Context (2025-12-03):**
- Current CM6 sticky scroll works for the first scope but nested scopes either trigger too late/early or flicker.
- Implementation is tightly coupled: detection uses `posAtCoords` against the live overlay height, and trigger math guesses overlay height from `lineHeight`.
- VS Code’s implementation splits responsibilities: a controller computes a pure state (`startLineNumbers`, etc.) from model + scroll, and a widget renders that state, reporting its actual pixel height back to the controller.

Goal: align our CodeMirror 6 implementation with the VS Code pattern enough to make nested scopes stable and predictable, while keeping changes minimal and compatible with NiceGUI.

---

## 1. Map VS Code Concepts to Our CM6 World

### 1.1 VS Code Pieces (What They Do)

- **StickyScrollController** (`vscode/src/vs/editor/contrib/stickyScroll/browser/stickyScrollController.ts`)
  - Keeps `_widgetState: StickyScrollWidgetState` = pure data (startLineNumbers, endLineNumbers, lastLineRelativePosition).
  - Computes state in `findScrollWidgetState()` using:
    - `scrollTop` (editor scroll position)
    - `getVisibleRanges()` (viewport lines)
    - `StickyLineCandidateProvider.getCandidateStickyLinesIntersecting()` (function/class ranges + geometry).
  - Applies clamping: `_maxStickyLines` is derived from editor height and `stickyScroll.maxLineCount`.
  - Calls `_stickyScrollWidget.setState(widgetState, foldingModel)` – controller does **not** look at the widget DOM.
  - Listens to `StickyScrollWidget.onDidChangeStickyScrollHeight` so the controller always knows the overlay height in pixels.

- **StickyScrollWidget** (`vscode/src/vs/editor/contrib/stickyScroll/browser/stickyScrollWidget.ts`)
  - A real overlay widget (`IOverlayWidget`) with its own root node.
  - Renders each sticky line using the same rendering path as editor content.
  - Tracks its own `_height` and exposes `get height()`; `_setHeight()` updates CSS heights and fires `onDidChangeStickyScrollHeight({ height })`.
  - Does **no** scope detection; it just renders `StickyScrollWidgetState`.

### 1.2 Our Pieces (Where We Are)

- **Detection + rendering combined** in `applyStickyScroll()` ViewPlugin (`app/static/vendor/nicegui/elements/codemirror/codemirror.js`):
  - `updateStickyHeader()` both:
    - Samples a document position via `posAtCoords` near the top of the editor.
    - Walks the Lezer tree upward to build a `scopes[]` list.
    - Decides which scopes should be sticky, and renders them directly into `this.dom`.
  - Overlay height is read from `this.dom` while we’re still deciding what to render → feedback loop.
  - Trigger math approximates overlay height via `lineHeight` and local counters; sticky line height and editor line height can drift.

**Mismatch:** VS Code has a clean separation (controller ↔ widget) and uses the widget’s measured height as input, while we try to interpolate everything inside one pass.

---

## 2. Target Architecture for CM6 Sticky Scroll

We won’t copy VS Code 1:1 (no full candidate provider / folding integration yet), but we want the same structure:

1. **State computation step** – from `scrollTop` + syntax tree → ordered list of scopes to display.
2. **Widget step** – from state → DOM overlay, reporting its exact pixel height.
3. **Trigger logic** – n+1 capture using:
   - current `scrollTop`
   - measured overlay height from the *previous* frame
   - a local accumulator for “planned” height as more scopes are added.

Concretely, we’ll keep one CM6 ViewPlugin but internally split it into these phases.

---

## 3. Concrete Changes – Step by Step

### 3.1 Stabilize Detection (Viewport → Document Position)

**Today:**
- Detection uses `posAtCoords(editorRect.left + gutterWidth + 10, editorRect.top + 5)`.
- Previously, it used `overlayHeight + 5`, causing the sampling point to move every time the header height changed.

**Plan:**
- Keep detection **independent** of overlay height.
- Use one of:
  1. `posAtCoords` with a fixed top offset (what we currently reverted to).
  2. `lineBlockAtHeight(scrollTop)` for a pure CM6-viewport-top position.

**Action:**
- In `updateStickyHeader`, ensure `pos` is computed from a constant reference (e.g., `lineBlockAtHeight(scrollTop)` or stable `posAtCoords`), and **never** from `this.dom.offsetHeight`.
- Treat that `pos` as “viewport entry point” for scope resolution, same for all nesting levels.

### 3.2 Introduce an Explicit Widget-Height Model

**Goal:** mirror VS Code’s `StickyScrollWidget.height` and `onDidChangeStickyScrollHeight` semantics.

**Plan:**
- Treat `this.dom` as the CM6 sticky widget and maintain:
  - `this.widgetHeightPx` – the overlay height we used on the previous render.
  - `this.stickyLineHeightPx` – measured from the first child (`getBoundingClientRect().height`) when present, else fall back to `view.defaultLineHeight`.
- Update `this.widgetHeightPx` **after** we render the new header.

**Action:**
- At the top of `updateStickyHeader`:
  - Read `const prevWidgetHeight = this.widgetHeightPx || 0;` (persisted across calls).
  - Do **not** use `this.dom.offsetHeight` anywhere else in the pipeline.
- At the end of `updateStickyHeader`:
  - After updating `this.dom.innerHTML`, compute the new overlay height (`this.dom.offsetHeight`) and store it into `this.widgetHeightPx`.

This gives us the “current overlay height” value VS Code has, but we keep it as a simple number on the plugin.

### 3.3 Implement Proper n+1 Capture Using Widget Height

We want:
- When no sticky lines → first scope is captured ~1 line early.
- When there are N sticky lines → next scope is captured “just before” it would disappear under an overlay of height N × (sticky line height).

**Model:**

- Let:
  - `scrollTop` = CM6 scroll DOM top.
  - `prevWidgetHeightPx` = overlay height **before** this render (from 3.2).
  - `stickyLineHeightPx` = height of one sticky row.
  - `plannedHeightPx` = `prevWidgetHeightPx` + (number of scopes we decide to show in this frame) × `stickyLineHeightPx`.

- For each scope (outer → inner):
  - Compute its bottom in viewport coordinates: `defBottomPx = view.lineBlockAt(scopeNode.from).bottom`.
  - Compute a trigger threshold:
    - `thresholdPx = scrollTop + plannedHeightPx + stickyLineHeightPx`.
  - If `defBottomPx <= thresholdPx`, capture it (push into `filteredScopes`) and increment `plannedHeightPx += stickyLineHeightPx`.
  - Else `break` – no deeper scopes without parents.

**Action:**
- Replace the current `(visibleCount + 1) * lineHeight` logic with this widget-height–based threshold, seeded from `this.widgetHeightPx`.
- Cap at `MAX_STICKY_LINES` (5 for now) to avoid runaway headers.

### 3.4 Keep Detection and Capture in One Place, Rendering at the End

**Today:** detection, capture, and rendering all interleave, which makes debugging hard.

**Plan:** re-structure `updateStickyHeader`’s happy path into clear phases:

1. **Detect position:** compute `scrollTop`, `pos`.
2. **Resolve scopes:** build `scopes[]` from syntax tree.
3. **Decide state:** run the widget-height–aware n+1 loop → `filteredScopes[]`.
4. **Render:** diff old `currentScopes` vs `filteredScopes` (optional optimization) and update `this.dom.innerHTML`.
5. **Measure new height:** set `this.widgetHeightPx` from `this.dom.offsetHeight`.

This makes it trivial to log each phase and verify that the problem is in the trigger math, not in detection.

### 3.5 Sanity Checks / Diagnostics

Before more tweaks, we should confirm the numbers line up:

- For a simple 2-level example (class → method):
  - Log for every scroll step:
    - `scrollTop`, `prevWidgetHeightPx`, `plannedHeightPx`, `stickyLineHeightPx`.
    - For each scope: `defBlock.top`, `defBlock.bottom`, `thresholdPx`, and whether it was captured.
- Verify:
  - First scope joins the header ~1 line before it scrolls off.
  - Second scope joins when the previous overlay height (1 line) + 1 more sticky line matches its approach to the top.

If logs show thresholds correct but UI still jitters, we can:
- Add a small hysteresis band (e.g. subtract 0.3 * `stickyLineHeightPx` on capture, add on release).
- Or smooth with CSS transitions once correctness is established.

---

## 4. Longer-Term Enhancements (After Core Fix)

Once the n+1 behavior is solid:

1. **Better scope candidates:**
   - Introduce a lightweight “candidate provider” similar to VS Code’s, but using Lezer + indentation for now.
   - Later, add language-specific heuristics (interfaces, type aliases, etc.).

2. **Max-height clamping:**
   - Mirror VS Code’s “no more than 25% of editor height” rule.
   - Compute in JS from `view.dom.clientHeight` and sticky line height.

3. **Visual polish / VS Code parity:**
   - Behaviors: hover styles, focus ring, keyboard navigation between sticky lines.
   - Optional animation when lines enter/leave the overlay.

4. **Refactor into a small internal “controller” object:**
   - Keep plugin but move the state computation into a separate helper to make further tweaks safer.

---

## 5. Implementation Order

1. **Phase 1 – Stabilize baseline**
   - Ensure detection (`pos` / `scrollTop`) is independent of overlay height.
   - Introduce `this.widgetHeightPx` and seed it at the start of `updateStickyHeader`.
   - Replace trigger math with the widget-height–based n+1 logic.

2. **Phase 2 – Verify and instrument**
   - Add targeted logging for `scrollTop`, `widgetHeightPx`, `plannedHeightPx`, and thresholds.
   - Test on a few nested examples (JS/TS/Python).

3. **Phase 3 – Clean up and polish**
   - Remove or gate debug logs behind a flag.
   - Add basic max-height clamping.
   - Consider hysteresis if minor jitter remains.

This plan keeps us close to VS Code’s conceptual model (controller + widget + explicit widget height) while staying within the constraints of a single CM6 ViewPlugin.

