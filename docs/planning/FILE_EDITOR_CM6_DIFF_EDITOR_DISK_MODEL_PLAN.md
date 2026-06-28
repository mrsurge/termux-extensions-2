# File Editor CM6 Diff Editor Disk Model Plan

## Status

Planned architecture note for the `worktrees/vscode-te2-diff` fork and the
`file_editor_cm6` git/draft diff integration.

This document is intentionally about architecture and sequencing only. It does
not approve a source-code rollback or implementation by itself.

## Purpose

The diff editor must stop depending on the current TE2 "pinned" diff model
behavior. The intended architecture is:

- The right/modified/changed diff editor model is always the disk model.
- The diff engine always computes against disk content for the modified side.
- Draft text is never supplied as `IDiffEditorModel.modified`.
- Draft UI state must be represented outside the core diff model, such as by
  overlays, decorations, zones, or another TE2-owned display layer.

The reason for this split is that the current pinned behavior lets the live
draft model remain the diff editor's modified model while a separate baseline
model is substituted into the diff calculation. That creates ambiguous model
ownership and special cases in the diff editor view model. The upstream-shaped
fix should make the modified model correct before it reaches the diff widget.

## Current Pinned Behavior To Remove

The rollback target is the TE2-specific model-pinning behavior in the VS Code
fork. The main files are:

- `worktrees/vscode-te2-diff/src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts`
- `worktrees/vscode-te2-diff/src/vs/editor/common/editorCommon.ts`

Current pinned fields added to `IDiffEditorModel` are expected to go away:

- `originalBaseline`
- `modifiedBaseline`
- `te2FreezeProjection`
- `te2AutosaveMode`

The corresponding `diffEditorViewModel.ts` behavior to remove includes:

- choosing baseline models instead of `model.original` and `model.modified`
  for diff computation
- freezing or short-circuiting modified/original content-change handling when
  `te2FreezeProjection` is active
- special-casing move computation for pinned baselines
- projection/update branches that exist only to reconcile draft text with the
  pinned baseline model

After the rollback, the diff view model should behave like the upstream widget:
it receives an `IDiffEditorModel`, listens to the actual `original` and
`modified` models, and computes the diff between those two models.

## History Check

A targeted fork-history check on the five named files showed that the pinned
diff commits only touched the rollback pair above:

- `168403bec0e pinned draft diffs`
- `36cd4ae3665 diff-view-fixes`
- `524d931c3b2 Checkpoint current TE2 Monaco source state`

Among these targets, those commits changed:

- `src/vs/editor/browser/widget/diffEditor/diffEditorViewModel.ts`
- `src/vs/editor/common/editorCommon.ts`

They did not change the three workbench model-pair files listed below. That
supports treating the rollback pair and the upstream model-construction chain
as separate implementation concerns.

Before making code changes, re-check the exact diff against the current fork
base and avoid reverting unrelated Monaco changes such as theming or other
non-diff-model behavior.

## Upstream Model Pair Target

The architectural target is the VS Code workbench chain that builds the
`IDiffEditorModel` pair before the widget sees it.

Primary target:

- `worktrees/vscode-te2-diff/src/vs/workbench/common/editor/diffEditorInput.ts`

Important chain:

```ts
DiffEditorInput.createModel()
  -> this.original.resolve()
  -> this.modified.resolve()
  -> new TextDiffEditorModel(originalEditorModel, modifiedEditorModel)
```

For TE2 git/draft diff, this is the first place to make sure the resolved
modified editor model is the disk snapshot model, not the live draft model.

Supporting targets:

- `worktrees/vscode-te2-diff/src/vs/workbench/common/editor/textDiffEditorModel.ts`
- `worktrees/vscode-te2-diff/src/vs/workbench/browser/parts/editor/textDiffEditor.ts`

`TextDiffEditorModel.updateTextDiffEditorModel()` currently copies:

```ts
{
  original: originalModel.textEditorModel,
  modified: modifiedModel.textEditorModel,
}
```

This should remain boring if `DiffEditorInput.createModel()` already resolves
the correct disk-backed modified model. Add TE2-specific logic here only if the
disk-model contract cannot be expressed cleanly at the input-construction
layer.

`TextDiffEditor.setInput()` should not become the owner of TE2 draft/disk
selection. It should continue resolving the input, creating the view model, and
setting the model on the control.

## TE2 Integration Cleanup

Once the upstream model pair is correct, remove the TE2 app-side pinned model
plumbing that currently feeds the fork-specific fields.

Known cleanup targets include:

- `app/apps/file_editor_cm6/monaco_editor/editor_git_baseline_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_open_transaction_runner_main.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_socket_connection_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_cache_state_resnapshot_utils.ts`

These paths currently create, refresh, or preserve `modifiedBaseline` and
`te2FreezeProjection` state. Under the new architecture they should instead
bind the diff editor to the real disk model on the modified side and keep draft
presentation outside `IDiffEditorModel.modified`.

Feature flags or environment values that only toggle the pinned behavior should
be removed or collapsed after the pinned path no longer exists.

## Implementation Order

1. Re-check the current fork history and upstream comparison for the rollback
   pair. Confirm which local changes are pinned-model behavior and which, if
   any, are unrelated fixes that should survive.
2. Remove the pinned model fields from `IDiffEditorModel` in
   `editorCommon.ts`.
3. Restore `diffEditorViewModel.ts` to compute only from `model.original` and
   `model.modified`.
4. Implement the disk-model selection in the workbench model-pair chain,
   starting with `diffEditorInput.ts`.
5. Keep `textDiffEditorModel.ts` and `textDiffEditor.ts` as pass-through
   participants unless inspection proves they need a narrow contract hook.
6. Remove TE2 frontend pinned-baseline producers and refresh helpers.
7. Rebuild the custom Monaco/editor-core assets and then rebuild
   `file_editor_cm6` if the served app consumes the changed output.
8. Validate the runtime behavior with draft text, disk updates, save, autosave,
   and diff reopen flows.

## Validation Targets

Minimum validation should prove:

- Opening a git/draft diff gives the right/modified editor a disk-backed model.
- Typing draft text does not mutate the diff editor's modified model.
- The diff calculation remains stable while draft text changes.
- Saving updates the disk model and causes the diff to recalculate from disk.
- Reopening or switching files does not resurrect `modifiedBaseline` or
  `te2FreezeProjection`.
- Autosave and non-autosave modes share the same modified-is-disk invariant.
- Draft UI presentation still appears through the intended TE2-owned layer.

Build validation should be selected from the actual changed scope. Expected
commands include the custom Monaco build path for `worktrees/vscode-te2-diff`
and, after generated assets are refreshed, the normal Code TE2 frontend build:

```bash
node build.mjs
```

run from `app/apps/file_editor_cm6`.

## Non-Goals

- Do not rewrite the line diff algorithm.
- Do not make the diff editor widget understand TE2 draft ownership.
- Do not move WBA behavior as part of this diff-model change.
- Do not change unrelated Monaco theming behavior while rolling back pinned
  diff code.
- Do not publish Android bundled assets unless a later approved implementation
  changes Android-consumed frontend assets.

## Open Questions

- What is the cleanest source for the disk-backed modified model in the
  workbench input path: an existing resolved text model, a TE2-specific editor
  input wrapper, or a service-owned disk snapshot model?
- Should the modified/right editor be read-only in TE2 draft diff mode because
  it represents disk rather than draft text?
- Which TE2 layer should own draft presentation once draft text is no longer
  the modified diff model?
- How should disk refreshes preserve model identity, view state, and diff
  stability after save or external file changes?
