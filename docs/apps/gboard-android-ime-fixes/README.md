# Android Gboard IME Fixes

Status: initial Monaco implementation and publication complete; device validation pending.

## Purpose

This directory tracks a narrow but real Android web-IME defect in Monaco.

After voice input has been used repeatedly, Gboard can remain in a background
recomposition state after voice input appears to have ended. That state can
persist until Gboard itself exits. Normal text areas tolerate it, and ordinary
Monaco input usually does not expose it, but Monaco's Android hidden-textarea
strategy can turn later Gboard rewrites into duplicated or misplaced editor
text.

The web input surface cannot currently reach all of the native IME controls
that an Android application can use to clear or constrain this state. The fix
therefore belongs at Monaco's textarea/model boundary: Monaco must accept the
text Gboard actually produces without feeding intermediate cursor and textarea
state back into the recomposition loop.

Making Gboard voice typing work correctly in Monaco is a useful side effect.
It is not the primary objective. The primary objective is preventing latent
voice recomposition from corrupting later text input.

## Current Source Authority

The implementation source is the pinned Monaco fork at:

`worktrees/vscode-te2-diff`

Relevant source areas are:

- `src/vs/editor/browser/controller/editContext/textArea/textAreaEditContext.ts`
  builds the Android textarea content and forwards textarea events.
- `src/vs/editor/browser/controller/editContext/textArea/textAreaEditContextInput.ts`
  owns the live textarea value, selection, composition state, and native writes.
- `src/vs/editor/browser/controller/editContext/textArea/textAreaEditContextState.ts`
  derives input operations from previous and current textarea states.
- `src/vs/editor/browser/view/viewController.ts` routes textarea operations into
  the editor command layer.
- `src/vs/editor/common/cursor/cursor.ts` and
  `src/vs/editor/common/cursor/cursorTypeEditOperations.ts` apply edits and
  cursor state to the model.

Before this slice, the Android path exposed only the word around Monaco's
visible cursor. Its diff logic was constrained by cached textarea selections,
selection-only movement could become a Monaco cursor command, and Monaco cursor
changes could synchronously rewrite the textarea. Those behaviors formed the
feedback path corrected by the implemented ownership and line-delta model.

The existing Gboard paste workaround is commit `3d5f56cbf83` in the Monaco
fork. It preserves all incoming text while temporarily suppressing harmful
typing interceptors and secondary `didType` behavior during fast input. The IME
work uses the same general principle, but it must not merge paste and
recomposition into one classifier without evidence that doing so is safe.

## Target Model

1. Give the hidden Android textarea the complete current logical line.
2. Locate edits from the previous and current line values, not from a history
   of inferred invisible-cursor positions.
3. Ignore native selection movement when the textarea value did not change.
4. Coalesce native input to one latest-value read per animation frame.
5. Route aligned ordinary insertion through Monaco's normal typing path.
6. Treat a native `insertLineBreak` or `insertParagraph` newline as Enter so
   Monaco's language-aware indentation runs.
7. Keep replacement, multiline paste, and recomposition deltas on the explicit
   Android range-edit path, then reseed the textarea from canonical model state.

The invisible cursor is not a second cursor Monaco should continuously track.
It is temporary IME state. The full-line text delta determines what changed,
and the latest native selection determines the eventual visible cursor.

## Implemented Slice

The pinned Monaco fork now:

- exposes the complete underlying model line to Android rather than a
  cursor-centered word;
- derives one explicit line-relative replacement from the previous and current
  textarea values;
- keeps value-stable native selection movement out of Monaco's visible cursor;
- coalesces native mutations to one latest-value read per animation frame;
- carries the coalesced `InputEvent.inputType` into the model transaction so a
  real native line break can be distinguished from pasted multiline text;
- routes aligned ordinary insertion and native Enter through Monaco typing,
  preserving language indentation and other typing interceptors;
- keeps replacement, multiline paste, and recomposition deltas on one explicit
  line-relative range edit;
- gives pointer-event touch taps the same stale-composition reset as Monaco's
  legacy touch path, with an explicit empty textarea teardown before reseeding
  the destination line; and
- rewrites canonical textarea state after the accepted frame transaction.

The older rapid raw-key classifier remains separate from the Android textarea
transaction and still protects ordinary serialized paste text. Newlines are a
hard command boundary for that classifier and always retain Monaco's Enter
interceptor. The removed 35 ms/140 ms textarea correctness timers must not be
restored.

## Documents

- `IMPLEMENTATION_PLAN.md` describes the source-backed implementation direction
  and staged work.
- `TRACKER.md` records current progress, validation, and unresolved decisions.
- `monaco-gboard-ime-handoff.md` at the repository root is background research,
  not implementation authority. Current Monaco source and verified device
  behavior take precedence over it.

## Source And Publication Boundary

Monaco changes must be authored in `worktrees/vscode-te2-diff`. Generated ESM
output is then published through the existing Monaco build/import flow into
`app/static/vendor/monaco-editor-core/esm`.

Generated Monaco output and the Code TE2 host bundle are validation and
publication artifacts, not the source of this fix. Android native input-filter
changes are also outside this plan unless a later, explicitly approved phase
shows that the wrapper filter conflicts with the corrected web input path.
