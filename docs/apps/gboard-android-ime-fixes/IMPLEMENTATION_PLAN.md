# Gboard Android IME Implementation Plan

Status: initial implementation and publication complete; regression and device
validation remain.

## Problem Boundary

The target is an Android web-IME edge case in which Gboard continues rapid
background recomposition after repeated voice input. Monaco's current Android
textarea integration can misinterpret that activity when the hidden textarea
cursor has moved independently of Monaco's visible cursor.

This plan does not attempt to control Gboard's private IME state. It changes
Monaco so the editor remains correct while Gboard owns and rewrites the hidden
textarea.

## Source-Backed Failure Path

The pre-fix Monaco path established this sequence:

1. `TextAreaEditContext.getScreenReaderContent()` exposes only the current
   Android word and anchors that word to Monaco's selection.
2. `TextAreaState.deduceAndroidCompositionInput()` and `deduceInput()` constrain
   text differences with cached selection offsets.
3. `TextAreaInput` converts value and selection changes into relative
   `ITypeData` operations.
4. `CursorsController.compositionType()` applies those operations relative to
   Monaco's current selection and can also turn selection-only deltas into
   model-cursor movement.
5. `TextAreaEditContext.onCursorStateChanged()` immediately requests a native
   textarea rewrite after Monaco's cursor changes.
6. `_setAndWriteTextAreaState()` writes both the textarea value and selection,
   then records the requested state as the cached state.

When Gboard's native cursor and Monaco's visible cursor diverge, the
selection-constrained difference can replay unchanged text as new input. The
resulting Monaco cursor change then writes a competing state back to Gboard and
can sustain the recomposition loop.

## Design Rules

### Full-Line Input Corpus

The Android textarea should contain the complete current logical line. The
textarea selection is the Monaco column converted to a line-relative UTF-16
offset.

The first implementation must account for Monaco's view/model coordinate
conversion, wrapped lines, injected text, and end-of-line columns. It must not
assume that a view column is always a direct model-string index.

### Value-Driven Edits

For a text mutation, compare the complete previous and current textarea line
values. Use their unconstrained common prefix and suffix to identify one
line-relative replacement:

```text
previous line = stable prefix + removed text  + stable suffix
current line  = stable prefix + inserted text + stable suffix
```

Apply that replacement at its explicit model range. Do not first move Monaco's
visible cursor and then invoke normal typing. The edit location comes from the
line values, not from either cursor's history.

### Selection-Only Movement

If the textarea value is unchanged, native selection movement does not
immediately move Monaco's visible cursor. Gboard may be navigating, choosing a
recomposition point, or preparing a rewrite. Monaco records no cursor history
for those intermediate movements.

### Cursor Projection

When a text mutation occurs, the textarea's resulting selection represents the
desired visible cursor after that mutation.

- At normal input rates, Monaco may project that cursor immediately.
- During high-rate replacement or recomposition, Monaco records only the latest
  desired cursor and restarts a trailing debounce.
- Text edits are never dropped or delayed merely because cursor projection is
  deferred.

The initial slice uses the existing Gboard paste patch's timing scale: a second
mutation within 35 ms enters rapid mode, and 140 ms of trailing quiet settles
the final cursor. The classifiers and state remain independent.

### Native Ownership And Feedback

During active Android input ownership, Monaco must not replace the textarea
value or selection in response to render or cursor events. Blocking must happen
before `_setAndWriteTextAreaState()` updates the cached state; the cache must
continue to describe the textarea state that actually exists.

The ownership interval is event-driven and uses a trailing quiet period.
`compositionend` alone is not proof that Gboard has stopped recomposing.

### Settling

After the quiet period:

1. apply the latest desired Monaco cursor once;
2. regenerate the canonical full-line textarea state from the model;
3. write the textarea value and selection once;
4. cache the state that was actually written; and
5. release Android IME ownership.

If settling itself produces expected DOM selection events, those events must
not re-enter the ownership cycle.

## Relationship To The Paste Workaround

The existing paste patch demonstrates a useful control pattern:

- accept all fast input;
- identify a short burst;
- suppress only the secondary behavior that makes the burst unsafe; and
- release suppression after trailing quiet.

For serialized Gboard paste, the suppressed behavior is typing interception and
secondary `didType` handling. For recomposition, the suppressed behavior is
cursor and textarea feedback.

The initial implementation should keep their state and classification
independent. A shared timing utility can be considered only after both event
shapes are covered by tests.

## Implementation Phases

### Phase 1: Focused Event Evidence

- Add bounded, opt-in tracing around Android textarea value, selection,
  composition, input, native-write, and cursor-projection decisions.
- Capture ordinary typing, spacebar cursor navigation, the target post-voice
  recomposition failure, and serialized Gboard paste.
- Keep tracing out of production hot paths when disabled.

### Phase 2: Full-Line Textarea State

- Replace the Android word extraction with a logical-line state builder.
- Define and test line-relative textarea/model offset conversion.
- Keep selection-only native movement inside the line without rebuilding the
  textarea around another word.

### Phase 3: Explicit Line-Delta Edits

- Add an Android-specific value-delta result that carries an explicit model
  replacement range and final native selection.
- Route that operation through the narrowest editor command seam that preserves
  undo grouping and composition semantics.
- Stop using selection-clamped relative composition edits for this path.

### Phase 4: Cursor Policy

- Make unchanged-value selection movement inert with respect to Monaco's
  visible cursor.
- Project cursor movement only as a consequence of accepted text input.
- Detect high-rate mutation and defer only cursor projection.

### Phase 5: Native Ownership Gate

- Gate complete Monaco-to-textarea state writes during active Android input.
- Preserve the actual native textarea state as the diff baseline.
- Extend ownership on relevant mutation activity and settle after trailing
  quiet rather than immediately at `compositionend`.

### Phase 6: Reconcile And Regression Harden

- Reconcile the final cursor and canonical full-line textarea state once.
- Verify serialized Gboard paste still uses its established safe behavior.
- Verify ordinary typing, suggestions, deletion, undo/redo, and physical
  keyboard input do not regress.

### Phase 7: Build And Publish

- Run the Monaco fork's targeted tests and editor build.
- Import generated ESM output through the existing Code TE2 Monaco publication
  flow.
- Rebuild Code TE2 only when its deployed Monaco assets have changed.
- Validate browser-hosted Code TE2 before evaluating native-wrapper-specific
  behavior.

## Initial Slice Outcome

Phases 2 through 5 and the source portion of phase 6 are implemented in the
pinned Monaco fork. The implementation uses the underlying model line directly,
computes explicit line-relative replacement ranges, adds an Android-specific
editor command seam, suppresses intermediate cursor projection during rapid
mutation, and gates Monaco-to-textarea writes until settling.

The Monaco ESM distribution, Code TE2 Monaco bootstrap, and Code TE2 host bundle
have been rebuilt. Focused TypeScript validation and compiled line-delta probes
pass. The authored browser timing test could not be executed on this Termux
device because Playwright does not support the Android Node platform; it remains
available for a supported browser-test runner. Manual mobile Chrome, Gecko, and
wrapper validation remains phase 6 work.

## Test Surfaces

Automated coverage should begin in the existing Monaco suites:

- `src/vs/editor/test/browser/controller/textAreaState.test.ts`
- `src/vs/editor/test/browser/controller/textAreaInput.test.ts`
- `src/vs/editor/test/browser/controller/cursor.test.ts`

The current `textAreaState` suite has Android composition-diff tests, but the
`textAreaInput` fixtures do not currently exercise an `isAndroid: true`
environment. The latter will need focused Android sequences rather than only
generic desktop IME recordings.

Manual validation should distinguish:

- mobile Chrome, which exercises the web path without the native TE2 input
  filter;
- Gecko and GeckoView behavior;
- the TE2 Android wrapper, whose native input filter may alter composition
  events; and
- ordinary physical-keyboard and non-Gboard input.

## Non-Goals For The Initial Slice

- controlling or resetting Gboard through unavailable native IME APIs;
- treating voice typing as a required Code TE2 feature;
- globally monkey-patching textarea selection methods;
- replacing Monaco's input architecture for non-Android platforms;
- changing Android native input filtering before the corrected web path is
  understood and separately approved; or
- choosing permanent timing constants before event evidence exists.
