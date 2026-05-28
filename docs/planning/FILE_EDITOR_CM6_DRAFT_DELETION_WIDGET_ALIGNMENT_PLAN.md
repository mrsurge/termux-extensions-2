# File Editor CM6 Draft Deletion Widget Alignment Plan

## Goal

Fix combined-diff draft deletion alignment without restoring pinned diff projection logic or adding a second layout authority.

The intended behavior is simple: when a draft deletion is already represented by Monaco's stock combined-diff deletion widget, Code TE2 should not add another deletion-height widget for the same deleted lines. The draft UI may mark or style the existing deletion presentation, but it must not create additional vertical space that shifts later lines.

## Current Problem

The draft deletion overlay can add its own changed-side deletion view zone. After the diff editor restoration, Monaco can also render the stock combined-diff deletion widget for the same deleted original lines. In combined view, those two widgets can stack on the changed/modified side, making each draft deletion appear to consume an extra line of height.

The result is line drift after deletion hunks: the deleted text is already accounted for by the original-side diff model, but the draft overlay adds another changed-side layout contribution.

## Direction

Use the stock Monaco deletion widget as the layout owner for draft deletions in combined diff mode.

Implementation should:

- Remove or bypass the custom draft deletion view-zone path when inline/combined diff mode is active.
- Keep draft deletion indicators non-layout-changing unless they are attached to Monaco's existing deletion presentation.
- Avoid broad CSS that styles unrelated Git diff deletion widgets outside the active draft-diff context.
- Keep the solution app-owned where practical; do not reintroduce pinned diff model APIs, EOF absorption projection fixes, or special baseline fields in Monaco's diff engine.

## Expected UX

- Draft deletions line up with the stock combined diff deletion layout.
- No additional blank/deleted line appears after each draft deletion.
- Normal editor mode still shows the draft deletion widget because there is no stock combined-diff deletion widget to reuse.
- Normal commit-diff deletion widgets should not be restyled as draft deletions unless they are part of the active draft diff presentation.
- Draft additions keep their blue draft insertion styling whenever autosave is off, even if the full disk-vs-draft diff view is disabled.
- Turning disk-vs-draft diff off clears draft deletion widgets/stock deletion tags but leaves draft insertion styling active while autosave is off.

## Validation

Use local validation first:

- Typecheck the app frontend.
- Rebuild served frontend bundles.
- Run syntax checks on generated bundles.
- Run whitespace diff checks.

Runtime validation, when approved, should inspect a file with one and then multiple draft deletion hunks in combined diff mode and confirm that later lines remain aligned.

## Notes

This plan intentionally has no fallback path. If the stock deletion widget cannot be targeted cleanly, stop and reassess rather than adding mirrored spacer zones or another projection workaround.

## Implementation Status

Implemented in the current cleanup slice:

- Normal editor mode still creates `te2-draft-del-zone` view zones for draft deletions.
- Combined diff mode bypasses those custom zones and tags only matching Monaco stock deletion widgets for draft styling.
- The old `te2-draft-del-marker` margin marker was removed.
- Served frontend version surfaces were synced for this correction.
- Local typecheck/build/syntax/whitespace validation passed after this correction.
- Live runtime validation is still pending before any follow-up commit.

Follow-up implementation:

- The former `Show Git Diffs` menu item is now labeled `Show Commit Diff`.
- The former `Show Draft Diffs` menu item is now labeled `Show Disk vs Draft Diff`.
- When `Show Disk vs Draft Diff` is enabled without `Show Commit Diff`, the diff editor compares disk content as the original model against the live draft model.
- Draft insertion styling is now requested whenever autosave is off, independent of the full disk-vs-draft diff toggle.
- The unsaved-edit page-exit guard was removed from the main-page boot path.

Additional mode-canonization follow-up:

- `Auto Save` moved from the View menu to the Editor menu and now operates as the explicit save-mode toggle: while autosave is on, the menu action is labeled `Draft Mode`; while Draft Mode is active, the menu action is labeled `Auto Save`.
- Enabling autosave still requires the autosave warning and saves the current draft before switching modes. There is no page-exit draft warning.
- Commit diff and disk-vs-draft diff are mutually exclusive diff modes. Enabling one disables the other, and disk-vs-draft diff also forces Draft Mode because it is invalid while autosave is on.
- Draft insertion and draft deletion styling remain autosave-off invariants, including while commit diff is the active diff mode. Commit diff mode uses the same stock Monaco deletion-widget draft styling override as disk-vs-draft mode.
- Served frontend version surfaces were synced for the completed follow-up.
