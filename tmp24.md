# Sticky Scroll State – Post Word-Wrap Fixes & Synthetic Gutter

**Date:** 2025-12-04  
**Context:** CodeMirror 6 sticky scroll (NiceGUI) after wrap-aware drift correction, per-depth compensation, single-line overlays, and synthetic gutter alignment.

## What’s working now
- **n+1 depth logic intact:** `offset = -(depth+2)` with early capture/release windows per scope.
- **Jitter greatly reduced:** Sampling uses previous overlay height; push-up effect on innermost scope; per-depth active window only (no persistence hacks).
- **Word-wrap compensation:** Scroll-fraction drift correction is applied **only when wrapping is on**, and only fully to depth 0. Deeper scopes subtract that correction to avoid over-trigger.
- **Direction-aware sampling:** Scroll-down uses overlay+early lines; scroll-up uses a shallower bias to avoid lag.
- **Styled sticky rows:** Each sticky line clones the actual `.cm-line` HTML when available, so theme/highlight/indentation match the buffer.
- **Single-line rows:** Overlay is built as one absolutely-positioned row per scope.
- **Synthetic gutter:** Overlay now spans full width. Gutter is reconstructed with per-segment widths matching real gutters (line numbers, folds, etc.), and gutter font size is synced to the real line-number gutter. Line numbers show in the first segment.
- **Shadow:** Soft box-shadow under the sticky stack.

## Remaining quirks to watch
- Deep nesting under heavy wrap: verify second/third levels near scope ends; push-up + depth compensation should handle most jitter, but edge cases may remain.
- Performance: cloning `.cm-line` HTML is contingent on the line being in the viewport; when not available, we fall back to plain text (could add a small highlight-only helper later).

## Key parameters (current)
- Early capture: base 1 line; +1 line drift correction at bottom when wrap is ON (top-level only).
- Max sticky lines: 5.
- Push-up: slides overlay up when innermost scope end crosses stack bottom.
- Box shadow: `0 6px 8px rgba(0,0,0,0.35)`.

## Files touched
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js` – sticky scroll plugin/theme.

