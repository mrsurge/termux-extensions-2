# Sticky Scroll Markdown Issue Summary

**Date:** 2025-12-06
**Context:** Current main branch after commit `Mark Downs partially sticky scrolled`.

## What Works
- Sticky scroll logic stable for code languages (Python/JS) with n+1 activation and slot-per-depth.
- Markdown headings are detected (ATX only), nested correctly, and markers now render in the overlay (raw text fallback retains `#` markers).
- Push-up animation disabled for Markdown to avoid clipping deep stacks.

## The Remaining Markdown Bug
- Headings still trigger one line early when scrolling. Example: in `docs/apps/code_cm6/README.md`, the H1/H2/H3 appear a line before their heading line reaches the viewport top.

## Current Markdown Implementation (as of this file)
1. **Heading detection:** ATX only (`#` up to 3 leading spaces). Builds sections to next heading of same/higher level or doc end.
2. **Path:** `markdownPathAtSimple` stacks headings up to `refLine` and requiring `refLine <= endLine`.
3. **Activation offsets (n+1):** `offset = -3` → `triggerLine = line - 3`, `endTriggerLine = endLine - 3`.
4. **Sampling:** Uses global sampling overlay height and `earlyLines = (direction >= 0 ? 1 : 0)`.
5. **Rendering:** Raw text fallback for headings so markers stay visible; push-up disabled for Markdown.

## Current Issue (Markdown)
- Headings trigger one line before the heading reaches the visible viewport top. This causes the next header to appear in the next slot prematurely, briefly duplicating it until the user scrolls further.

## Note on Noise
- Prior console logging produced repeated entries because the scope list is rebuilt every scroll. Debug logging has been removed; future debugging should be gated by a flag.
