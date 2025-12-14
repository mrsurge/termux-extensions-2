# Plan: Fix CM6 LSP Sticky-Scroll “Double Entries” + Restore “Jump to Line”
**Date:** 2025-12-14  
**Scope:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js` (sticky scroll plugin; see around `applyStickyScroll`, ~L1746+ / ~L2057+)  
**Reference notes:** `notes/2025-12-11_STICKY-S-LSP_WORKING_MVP.md`

---

## Goals

### 1) Bug: “Double Entries”
- Symptom: the *same* scope sometimes appears twice, back-to-back, occupying two consecutive sticky slots.
- It looks random, but likely deterministic based on symbol ranges / update timing.
- Acceptable fix: a *heuristic squash* (dedupe) even if we never fully isolate the root cause, **as long as we leave a clear comment block explaining the heuristic and why it exists**.

### 2) Incremental feature: “Jump to Line”
- Clicking a sticky slot should jump to the *definition line* for that slot.
- Prefer a jump that places the target line at the same Y-position as the clicked sticky row (so the jump feels “anchored” to the slot).
- This used to exist but was removed when scroll mechanics were being stabilized.

---

## Plan (two passes)

### Pass A — Squash “Double Entries” safely
1. **Reproduce / observe**
   - Temporarily enable existing debug flags in `codemirror.js` (`DEBUG_LSP_STICKY`, any slot-debug flags) to capture:
     - `ancestorPath` vs `filteredPath`
     - the final per-depth list used to render slots (`currentScopes` / `slots.getActive()` / similar)
   - Confirm the duplication signature (likely identical `{name,startLine,endLine}` or identical `from`/`to` for Lezer scopes).

2. **Implement a guardrail dedupe heuristic (frontend-only, render-time)**
   - **Where:** immediately before slot registration / rendering (after `filteredPath` is produced for LSP, and after Lezer path is computed for non-LSP).
   - **What:** remove *adjacent duplicates* in the final “render path” by comparing a stable scope signature, e.g.:
     - For LSP scopes: `${name}|${startLine}|${endLine}|${kind}`
     - For Lezer scopes: `${node.type.name}|${startLine}|${endLine}`
   - **Rule:** if `sig[i] === sig[i-1]`, drop `i` (or keep last; whichever produces best UX).
   - **Comment block:** explain that this is a deterministic-but-hard-to-repro glitch caused by LSP+geometry timing, and we’re intentionally squashing duplicates to preserve UX.

3. **Sanity**
   - Ensure dedupe does **not** break:
     - push-up / pull-down transitions
     - slot depth ordering
   - If dedupe reduces slot count, ensure the overlay height calculation respects the new count.

**Done when:** no consecutive duplicate rows appear in the sticky header during heavy scroll + symbol refresh.

---

### Pass B — Restore “Jump to Line” on sticky slot click (LSP + Lezer)
1. **Add click handling that works for *both* LSP and Lezer scopes**
   - Current click handler only jumps when `scope.node` exists (Lezer).
   - Extend to support LSP-backed scopes using `startLine` -> document position:
     - `pos = state.doc.line(scope.startLine).from`

2. **Anchor the jump to the clicked sticky row’s Y-position**
   - Compute `slotY` relative to `view.scrollDOM`:
     - `slotY = stickyRowRect.top - scrollDomRect.top`
   - Compute target scrollTop:
     - `targetTop = view.lineBlockAt(pos).top - slotY`
     - clamp to `[0, maxScroll]`
   - Set `view.scrollDOM.scrollTop = targetTop`
   - Then set selection to `pos` (or line start) and `view.focus()`.

3. **Post-jump refresh**
   - Call the plugin’s `updateStickyHeader()` (or `initializeAtCurrentPosition()` if that’s the safer path) after the scroll to prevent stale overlay frames.

**Done when:** tapping any sticky header line jumps to that scope and the definition line appears “under” the clicked row (same Y alignment), without jitter.

---

## Files expected to change
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - Add dedupe heuristic for consecutive identical scopes (commented).
  - Update sticky header click handler to jump by `startLine` (LSP) or `node.from` (Lezer), aligned to clicked row geometry.

---

## Notes / Constraints
- No localStorage/cookies (never in this project).
- No frontend-owned persistent state; only transient UI/runtime state that is strictly required to render.
- Keep changes minimal and localized to sticky-scroll code paths.
- If the “double entry” root cause becomes obvious while instrumenting, we can fix it directly; otherwise, the heuristic is acceptable per your instruction.

## Extra request (Lezer fallback): CSS support
- Ensure CSS files get sticky headers via the Lezer/syntax-tree path (no LSP required).
- This likely means expanding the CSS `SCOPE_NODE_TYPES` to match the actual Lezer CSS node names (e.g. `RuleSet`, `AtRule`, etc.).
