# Sticky Scroll Architecture – Current State (Dec 4, 2025)

File: `app/static/vendor/nicegui/elements/codemirror/codemirror.js`  
Primary block: **sticky scroll plugin & theme** starting around line ~1265 through the end of `applyStickyScroll`.

## Theme (CSS)
- `.cm-stickyHeader`: absolute, full-width overlay, inherits editor font/size/lineHeight, box-shadow `0 6px 8px rgba(0,0,0,0.35)`.
- `.cm-sticky-layer`: each scope gets its own absolutely positioned layer (per-scope stacking).
- `.cm-sticky-line`: flex row for gutter + content; no extra indent padding.
- `.cm-sticky-gutter`: flex container matching real gutter widths; numeric, tabular; right-aligned; border-right.
- `.cm-sticky-gutter-segment`: one per real gutter (line numbers, folds, etc.), fixed segment width.
- `.cm-sticky-content`: flex 1, preserves whitespace; ellipsis overflow.

## Data fields on the ViewPlugin
- `currentScopes`, `prevActiveScopes`
- `lastOverlayHeight`, `lastOverlaySampleHeight` (smoothed height for sampling)
- `lastTopOffset` (hysteresis for push-up)
- `lastActiveSignature`, `lastRenderKey`
- `lastScrollTop`
- `rafPending`

## Detection (updateStickyHeader)
- Anchoring:
  - `samplingOverlayHeight = lastOverlaySampleHeight || currentOverlayHeight`
  - Direction-aware sampling:
    - Compute `scrollFrac` (0–1 over doc height).
    - Wrap **on**: drift correction for depth 0: `earlyLines = base 1 + scrollFrac` (down), `= scrollFrac` (up); drift subtracted for deeper scopes in activation.
    - Wrap **off**: `earlyLines = 1` (down), `0` (up); drift = 0.
  - `effectiveTop = scrollTop + samplingOverlayHeight + earlyLines * lineHeight`
  - `refPos = lineBlockAtHeight(effectiveTop)` (fallback `view.viewport.from`), `refLine = doc.lineAt(refPos).number`.

- Scope chain:
  - `ancestorNodes` from `tree.resolveInner(refPos)` → reversed.
  - Scope filter uses `isScopeNode(node, scopeTypes)`.
  - `offset = -(depth + 2)` → `triggerLine`, `endTriggerLine = max(startLine, endLine + offset)`.
  - Sibling handoff: if next scope at same depth starts after current, clamp `endTriggerLine` to `siblingStart - 1`.

- Activation:
  - MAX 5 scopes.
  - `scopedRef = refLine` (depth 0); if wrap on and depth>0: `scopedRef -= driftCorrectionLines`.
  - Hysteresis: +/-0.5 lines depending on prior active state.
  - Innermost gets extra upper margin to stay while push-up runs.
  - Near-end linger check via `endLineBlock.bottom` vs prospective header height.

- State tracking:
  - `currentScopes`, `prevActiveScopes`
  - `lastOverlayHeight = activeScopes.length * lineHeight` (if any)
  - `lastOverlaySampleHeight` grows instantly; decays at most one line per update.
  - `lastScrollTop` updated each pass.
  - Debug signature logging (DEBUG_STICKY = true currently).

## Rendering
- Early exit clears DOM when no scopes; maintains/decays sample height.
- Per-scope layer:
  - One `.cm-sticky-layer` per scope; z-index stacked (outer above inner).
  - Innermost translated by `topOffset`; its height is `lineHeight + topOffset` (can shrink). Others keep full lineHeight.
  - Synthetic gutter:
    - Width = real `.cm-gutters` width.
    - Segments = each real gutter child’s width; first segment shows line number.
    - Font size copied from real line-number gutter (slightly bumped +0.2px).
  - Content: uses `getStyledLineHTML(scope.startLine)` to clone `.cm-line` HTML when available; fallback to `scope.text`.
  - Render deduped via `renderKey = signature|topOffset|effectiveHeight`.

## Push-up / End handling
- `topOffset` computed from innermost scope’s end line bottom vs stack bottom; early margin = 3 * lineHeight; only moves up (negative translate).
- If a scope just dropped, reuse its geometry once to slide stack instead of snapping.
- Hysteresis on `topOffset` (epsilon = 0.25 * lineHeight).
- Effective overlay height = sum of lineHeights with innermost possibly shrunk; stored in `lastOverlaySampleHeight` for stable sampling.

## Known behaviors (current)
- Wrap OFF: classic n+1 behavior with stable sampling and per-scope layers.
- Wrap ON: drift correction aligns top-level across the doc; deeper scopes compensated to avoid overcorrection; push-up reduces end jitter; lingering near end minimizes flicker.
- Synthetic gutter mirrors real gutter widths; shadow under stack; styling matches editor content.

