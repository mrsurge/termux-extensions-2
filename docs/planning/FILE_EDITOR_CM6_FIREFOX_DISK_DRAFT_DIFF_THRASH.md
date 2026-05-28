# File Editor CM6 Firefox Disk/Draft Diff Thrash

## Status

Pinned investigation note. No fix is approved by this document.

This issue is currently deferred unless/until we choose to patch the Monaco / VS Code fork. Do not restore the old TE2 pinned-baseline freeze-projection architecture as a workaround.

## Symptom

Desktop Firefox can paint transient, wrong diff state while the editor is in disk-vs-draft diff mode and the user types into the modified/live draft side.

Observed behavior:

- typing can briefly flash a large insertion region below the typed line;
- deleting can briefly flash large stock deletion widgets and insertion styling;
- a temporary source-level experiment that cleared diff state during recompute avoided the original color flash but caused deletion widgets to pop in and out, producing line-bounce thrash.

The issue has not reproduced in Chromium or in the Android GeckoView wrapper during the same workflow.

## Scope

The known bad mode is disk-vs-draft diff mode:

- Monaco diff original model: disk content model;
- Monaco diff modified model: live draft file model;
- autosave is off / Draft Mode is active;
- the disk model remains stable while the modified model changes on each keystroke.

Git commit diff mode does not expose the same issue in the common clean-file case because there may be no meaningful original-vs-live delta. When there is no real Git diff, the current baseline code falls back to using the live model content for the HEAD/original side, so it does not stress the same stable-original-vs-hot-modified path.

## Evidence From Live Firefox Inspection

Live inspection against desktop Firefox worker `main_page:b7f88c85` showed the disk/original model was not being rewritten per character.

During typing:

- original/disk model stayed at version `2`, alternative version `2`, same length;
- modified/live draft model advanced from version `129` to `131`;
- a bad transient diff mapping still appeared: original `10..1315`, modified `10..1316`;
- the next settled diff mapping returned to the expected one-line mapping: original `10..10`, modified `10..10`.

This points away from repeated disk-model writes or repeated `diffEditor.setModel(...)` calls as the root cause. The problem is more likely the Monaco diff view-model publishing or rendering a transient stale mapping while recomputing against a hot modified model.

## Current Code Shape

`editor_git_baseline_runtime.ts` already avoids rewriting stable baseline models unnecessarily:

- `updateOrCreateModel(...)` only calls `model.setValue(content)` when the model value differs;
- `applyGitBaselines(...)` only calls `diffEditor.setModel(...)` when the current diff model object identities do not already match the selected original and live modified models.

For disk-vs-draft mode, the selected original model is the disk model and the selected modified model is the live draft model. That is the correct ownership shape for the current architecture.

## Relevant Monaco Fork History

The old `worktrees/vscode-te2-diff` history contains related commits:

- `168403bec0e pinned draft diffs`
- `36cd4ae3665 diff-view-fixes`
- `524d931c3b2 Checkpoint current TE2 Monaco source state`
- `1a6ef840846 Remove pinned diff projection overrides`

Those historical patches were in the same problem family:

- incremental projection of diff mappings through live modified-model edits;
- soft-bail behavior when range mapping projection fails;
- filtering invalid mappings before unchanged-region computation;
- freeze-projection behavior for the old pinned-baseline mode.

The useful category is Monaco-side range/projection hardening. The old freeze-projection architecture itself should not be restored.

## Likely Fix Category

If we come back to this, the fix should probably be in the VS Code / Monaco fork, not as an app-level monkey patch.

Potential directions:

- implement or restore a narrow, stock-shaped `applyModifiedEdits(...)` projection path so hot modified edits preserve stable previous diff layout until a full recompute lands;
- add a guard before committing/rendering transient invalid or clearly stale mappings from an async diff result;
- keep the previous stable diff state when projection fails, rather than clearing all diff state and causing deletion widgets to disappear/reappear;
- preserve the soft-bail range-mapping behavior where invariant failures return to full recompute without surfacing broken mapping state.

Do not use the rejected clear-diff-state approach as the final fix. It removes the original bad mapping flash but creates line-bounce thrash by forcing Monaco deletion widgets/view zones to be removed and recreated.

## Non-Goals

- Do not restore `originalBaseline`, `modifiedBaseline`, `te2FreezeProjection`, or `te2AutosaveMode` as the solution.
- Do not make disk-vs-draft push disk content into the original model on every keystroke.
- Do not replace the stable disk model with a fresh model on every edit.
- Do not hide the problem with CSS that masks stock diff classes after the bad DOM has already painted.
- Do not change Android/GeckoView behavior unless it starts reproducing there too.

## Reproduction Notes

When investigating again, use desktop Firefox and disk-vs-draft diff mode. A useful monitor records:

- original model version / alternative version / length;
- modified model version / alternative version / length;
- `diffEditor.getLineChanges()` on `onDidUpdateDiff`;
- stock `.line-insert`, `.line-delete`, and `.inline-deleted-margin-view-zone` DOM counts during animation frames.

The important distinguishing signal is a transient broad mapping followed by a correct settled mapping while the original/disk model version remains unchanged.
