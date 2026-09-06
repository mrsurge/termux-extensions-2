# Selected Commit Inline Diff Plan

Branch: `feature/selected-commit-inline-diff`

## Goal

Restore inline commit comparisons against the commit selected in the Explorer,
while fixing related mobile touch, commit selection, and draft navigation bugs.
The branch started from upstream main at `a95cb8e6` (TE2 0.2.346).

## Scope And Sequence

1. **Mobile touch handles during inline diff transitions.** Fix handle geometry
   when switching between plain and inline diff editors, including switching
   back without a page refresh.
2. **Explorer Git commit selector.** External commits must update a HEAD-following
   selector through Git facts, without first opening By changes. Show HEAD and
   the latest commit as one choice; preserve explicitly selected older baselines.
3. **Draft overlay links.** Make links in the Drafts overlay activate the intended
   draft-versus-disk inline comparison instead of the current model-versus-disk
   behavior. Trace the existing baseline and navigation contracts before editing.
4. **Selected-commit inline comparison.** Experiment with making the inline commit
   diff use the currently selected Explorer commit. Establish the selection's
   authority, baseline loading, and update behavior from current source and the
   user's detailed requirements before choosing an implementation.

## Constraints

- Preserve the existing Gboard input, touch dragging, and editor focus behavior.
- Reuse existing state projection, Git baseline services, and surface RPC lanes.
- Keep frontend file opening responsive; baseline loading must not introduce
  unnecessary blocking into the editor open path.
- Publish the touch extension from its editable fork. Do not hand-edit its UMD.
- Treat the parent repository and touch-extension fork as separate commit scopes.
- Android builds, APK seed updates, and release version changes are separate
  publication steps, not implicit requirements for each frontend fix.
- Later items remain pending investigation and detailed user requirements.
- The Explorer selector chooses the comparison baseline for By changes and,
  in the upcoming editor work, inline commit diffs. It is not a checkout command.
  Detached-HEAD workflows and checkout/history navigation are outside this branch.

## Validation

- Touch changes: build/typecheck the touch-extension fork, verify the published
  UMD matches its build output, and obtain live mobile acceptance across diff
  toggles. Inspect wrapped lines, scrolling, and changing gutter geometry when
  relevant to subsequent changes.
- Host/editor changes: run Code TE2 typecheck and frontend build, with focused
  behavioral checks for the affected baseline or navigation contract.
- Selected-commit comparisons: verify the displayed baseline matches the chosen
  commit and current file, including rapid file/commit changes and missing paths.
  Final behavior for exceptional cases is to be determined during investigation.

## Source References

- Touch fork: `worktrees/monaco-touch-selection/src/index.ts`.
- Touch deployment: `app/apps/code_te2/static/vendor/monaco-touch-selection/`.
- Editor transitions: `app/apps/code_te2/monaco_editor/editor_editor_lifecycle.ts`.
- Touch initialization: `app/apps/code_te2/monaco_editor/editor_touch_menu_utils.ts`.
- Technical reference: `docs/apps/code_te2/CODE_TE2.md`, section 32.

See `TRACKER.md` for completed work, evidence, and pending decisions.
