# Plan: Align CM6 Indentation Guides With Inline Diff Gutter

## Context & Goal
- Roadmap item **Next Steps → Editor → #8** calls for keeping CodeMirror indentation markers aligned with the code column even when inline diffs inject their “+/−” gutter. (See `notes/2025-11-16_Short_Term_File_Editor_TODO.md`.)
- The existing indentation-guide implementation (`notes/2025-11-17_INDENTATION_GUIDES_IMPLEMENTATION.md`) relies on the vendored `@replit/codemirror-indentation-markers` extension (wired via `applyIndentGuides` in `app/static/vendor/nicegui/elements/codemirror/codemirror.js:363-410`). That extension hard-codes its pseudo-element offset to **2px** (`dist/index-*.js:32604-32634`).
- Inline diff styling (both in the iframe via `app/apps/file_editor_cm6/nicegui_editor/editor_app.py:430-458` and in the host shell `app/apps/file_editor_cm6/template.html:360-402`) adds `padding-left: calc(var(--diff-marker-width) + 0.35rem)` to `.cm-line.cm-diff-line`. When guides are enabled, the markers still start at 2px, so they overlap the diff gutter instead of lining up with the actual text column.
- Per `docs/core/nicegui_iframe_feature_adding_guideline.md` (stateless iframe section around lines 957-1002), fixes should stay inside the NiceGUI iframe boundary and share one source of truth for assets, so we avoid poking the legacy CM6 host JS.

## Desired Outcome
When both **Show Inline Diffs** and **Indentation Guides** are enabled (menu wiring lives in `app/apps/file_editor_cm6/main.js:1730-1812` and backend toggles in `nicegui_editor/editor_app.py:748-784`), every guide column should start exactly where the code now begins (after the diff marker gutter) without affecting scenarios where diffs are off.

## Implementation Steps

1. **Baseline & Instrumentation**
   - Reproduce the issue by opening any file with nested blocks, toggling **View → Show Inline Diffs** and **Editor → Indentation Guides**. Capture DOM state inside the iframe to confirm that (a) every line receives `.cm-diff-line` while diffs are enabled (see `diff_decorations.js:300-360`) and (b) `.cm-indent-markers::before` still reads the old `left: 2px` rule from the bundle.
   - Verify that the dynamic indent-unit code (`LANGUAGE_INDENT_MAP` plus `indentUnitCompartment` inside `codemirror.js:1-330`) already produces correct column widths, so the only offset we need to correct is the extra gutter width.

2. **Single Source of Truth for the Diff Gutter Offset**
   - Inside the iframe style block (`editor_app.py:430-458`), introduce a CSS custom property such as `--cm-inline-diff-offset`, defaulting to `0px`. Assign `--cm-inline-diff-offset: calc(var(--diff-marker-width) + 0.35rem)` on `.cm-line.cm-diff-line` (and reuse it for `.cm-diff-line-removed`). Replace the raw `padding-left` expressions with the variable so the gutter width is defined once.
   - Mirror the same variable definition inside the host `template.html:360-402` so both documents stay in sync (this file duplicates the diff styles for when the iframe is eventually removed).
   - Document the new variable in the note or inline comment so future styling tweaks grab this variable instead of hard-coding the math again.

3. **Offset the Indentation Marker Pseudo-Element**
   - Because the bundle’s base theme pins `.cm-indent-markers::before { left: 2px; }`, add an overriding rule in the iframe head style (after the variable definition) so it becomes `left: calc(2px + var(--cm-inline-diff-offset, 0px));`. This keeps the guide start anchored to the actual text column whenever the diff class injects an offset, but preserves the old 2px baseline when diffs are off.
   - Apply the same override in `template.html` for parity, even though the iframe currently hosts the editor (future refactors can drop one copy without losing the fix).
   - No bundle rebuild is required: we’re overriding the generated CSS per the NiceGUI guideline (docs/core… lines 957-1002). If we later need finer control (e.g., per-language offsets), we can move this logic into a small helper inside `codemirror.js`, but CSS keeps this release scoped.

4. **Runtime Sync & Toggle Safety**
   - Confirm that enabling/disabling inline diffs via `/editor/set_view_settings` already calls `editor.set_diff_decorations([])` when off (see `editor_app.py:748-784`), which removes the `.cm-diff-line` class entirely. Because our CSS variable only overrides when that class is present, no extra JS is needed; still, we should smoke-test toggling diffs after the CSS change to ensure the guides snap back instantly.
   - Double-check that deletion widgets (`.cm-diff-line-removed`, inserted in `diff_decorations.js:120-180`) also define the variable so their padding matches and guides inside surrounding lines stay aligned.

5. **QA / Regression Matrix**
   - Manual smoke test checklist:
     - Python file (4-space indent) and TypeScript file (2-space indent) with both inline diffs & guides on/off; confirm guides hug the code column.
     - Toggle inline diffs repeatedly to ensure the variable resets (no lingering offset once diffs are disabled).
     - Verify scroll performance and zebra stripes (`applyZebraStripes`) because both features use absolute-positioned overlays.
     - Confirm word-wrap mode (View → Word Wrap) doesn’t break the offset, since the diff gutter and indent guides both use `position:absolute`.
     - Spot-check deletion widgets (diffs that introduce “removed” blocks) so the gutter width stays consistent there as well.
   - Regression risk is limited to CSS, but capture before/after screenshots to hand back to design as proof for the roadmap item.

## Deliverables
- Updated iframe + host CSS with the shared `--cm-inline-diff-offset` variable and overriding `.cm-indent-markers::before` rule.
- Short changelog entry referencing `Next Steps #8` so the roadmap note can be marked “✅”.
