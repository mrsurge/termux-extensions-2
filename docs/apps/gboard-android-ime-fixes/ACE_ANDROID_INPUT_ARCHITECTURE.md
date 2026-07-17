# Ace Android Input Architecture And Monaco Port Direction

Status: detached Monaco input transaction deployed in TE2 0.2.320. The
reproduced Gboard defect passes Gecko, GeckoView, and Android Chromium device
validation; the broader regression matrix remains open.

## Purpose

This document records the Android text-input architecture recovered from the
minified Ace application under `assets/` and compares it with the current
Monaco Gboard work. It is intentionally separate from the earlier Gboard plans
and trackers. Those documents remain historical reference for the approach
that keeps Monaco's composition lifecycle active.

The supplied Ace application has been device-tested against the persistent
Gboard recomposition defect and does not exhibit the ghost text, stale cursor,
or delayed degradation seen in the current Monaco path. Although Ace and
Monaco have different editor internals, they solve the same browser boundary:
project editor state into a native textarea, consume native mutations, map
them back into the model, and suppress browser behavior that conflicts with
the editor renderer.

## Analyzed Entry Flow

The application starts from:

- `assets/index.html`
- `assets/service.worker.js`

`index.html` loads the vendor and application bundles. The application bundle
dynamically imports the patched Ace bundle and initializes the editor.

`service.worker.js` owns fetch and cache behavior. It contains no composition,
IME, textarea, or cursor-mapping logic. Its significance is confirming which
application assets are delivered, not implementing the input fix.

The relevant implementation is distributed across:

- `assets/assets/bundle/ace.bundle.js`
- `assets/assets/bundle/app.bundle.js`
- `assets/assets/bundle/app.css`

The bundle reports Ace `1.4.6`, but its text-input implementation is not stock
Ace 1.4.6. It contains a dedicated non-iOS branch with behavior absent from the
upstream implementation. Android selects that branch.

## Recovered Ace Contract

### Detached Native Surface

The hidden `ace_text-input` remains focused and editable, but the application
moves it physically away from the rendered editor:

```css
#mainEditor > .ace_editor > .ace_text-input {
  transform: translate(-150px, -150px) !important;
  position: absolute;
  top: -150px;
  left: -150px;
}
```

This is stronger than transparent text. The browser-native composition surface
is not positioned over editor content, so native glyphs, underlines, selection
paint, and other IME presentation cannot become visible ghost text.

### Stable Textarea Corpus

The non-iOS branch projects editor state into this shape:

```text
⇝<logical line>\n\n
```

The leading sentinel creates a stable buffer boundary and shifts model columns
to textarea offsets by one. The trailing newlines prevent the active selection
from living at a fragile end-of-text boundary.

For a selection that crosses into an adjacent line, the projection includes
the immediately relevant neighboring line. Very long projected lines are
bounded at 10,000 characters.

### Input-Only Android Authority

The Android-selected branch does not register listeners for:

- `compositionstart`
- `compositionupdate`
- `compositionend`

It registers ordinary `input` and clipboard/key listeners. Composition helper
functions remain in the minified module, but the Android-selected branch does
not connect native composition events to them.

The application also initializes Ace with `useTextareaForIME: false`. The
combined behavior makes native composition lifecycle state non-authoritative.
Text entering the textarea is authoritative; the browser's declaration that a
composition has started or ended is not.

### Frame-Coalesced Mutation Intake

The `input` listener is wrapped with `requestAnimationFrame`. Multiple native
events before the next frame collapse into one handler invocation. The handler
then reads the textarea's latest complete value rather than depending on every
intermediate event payload.

This does not discard text. Intermediate native mutations have already
accumulated in the DOM value, and the latest value is diffed against the last
known projection.

### Ordered Commit And Reseed

After the frame boundary, the branch schedules named operations in a fixed
order:

```text
syncText
resetSelection
```

`syncText` reads and diffs the browser-owned textarea value, then applies the
result to the editor. `resetSelection` runs afterward and reconstructs the
textarea from authoritative editor state.

This forms one directional transaction:

```text
native textarea mutation
  -> next animation frame
  -> read latest complete value
  -> derive cumulative delta
  -> apply editor mutation
  -> reseed textarea from editor state
```

The editor does not rewrite the textarea in the middle of consuming the same
native mutation burst.

### Special Native Operations

`insertLineBreak` and `deleteContentBackward` explicitly schedule the same
`syncText` then `resetSelection` sequence. Undo and redo input types are routed
to editor commands. The branch also contains an Android-specific correction
for the `". "` replacement emitted by some keyboard behavior.

## Replaced Monaco Mismatch

The previous Monaco implementation already had useful pieces:

- complete current-line projection on Android;
- previous/current value delta derivation;
- explicit model-range edits;
- suppression of selection-only visible-cursor movement;
- synthetic tap teardown for stale composition;
- temporary ownership that blocks Monaco-to-textarea writes;
- delayed cursor projection during rapid mutation.

The remaining architecture still depended on native composition lifecycle:

1. `compositionstart` creates `_currentComposition`.
2. Monaco creates `_visibleTextArea` and positions it over the model line.
3. The textarea receives the `ime-input` class and becomes the browser's
   visible composition surface.
4. Ordinary `input` processing returns while `_currentComposition` exists.
5. Android changes are consumed immediately through composition updates.
6. The Android settle scheduler refuses to settle while composition remains
   active.
7. The visible textarea is dismantled only when composition ends or an
   explicit recovery path fires.

Persistent Gboard recomposition violates that contract. If Gboard does not
emit a trustworthy final `compositionend`, Monaco can retain all of the
following indefinitely:

- stale `_currentComposition` state;
- a visible textarea anchored to an old model line;
- blocked ordinary input processing;
- a settle scheduler that cannot release pending cursor state;
- browser-native composition presentation over editor content.

The current transparency rule changes CSS paint but does not remove the native
surface from the editor location. Browser or IME composition presentation is
not guaranteed to honor ordinary text color and decoration rules.

## Target Android Architecture

The Monaco port should be an Android-specific input strategy, not another
timing adjustment layered onto the existing composition strategy.

### Required Properties

1. Native `input` value is the Android text authority.
2. Composition lifecycle events do not gate Android data intake.
3. Android composition does not create Monaco's visible textarea projection.
4. The focused native textarea remains physically detached from editor paint.
5. The textarea holds a sentinel-backed logical-line corpus.
6. Input events coalesce to one read of the latest DOM value per frame.
7. One cumulative delta is applied before the textarea is reseeded.
8. Reseed order is deterministic and cannot run before the editor mutation.
9. Cursor projection comes from the accepted native selection after the
   mutation transaction, not every intermediate composition event.
10. Desktop, iOS, screen-reader, clipboard, and paste behavior remain on their
    existing strategies unless explicitly proven to require changes.

### Proposed Transaction

```text
Android native input
  -> retain browser-owned textarea value
  -> coalesce until requestAnimationFrame
  -> read value and selection once
  -> strip/validate projection sentinels
  -> derive cumulative line edit
  -> apply model edit
  -> project accepted native cursor
  -> queue canonical textarea reseed
```

Fixed rapid-input and quiet-period timers should not be the correctness
boundary for this strategy. Frame coalescing limits work, and the cumulative
DOM value preserves the result. A timer may remain only as defensive cleanup,
not as the mechanism required to release a composition lock.

## Implementation Boundaries

The port belongs in the pinned Monaco fork under:

- `worktrees/vscode-te2-diff/src/vs/editor/browser/controller/editContext/textArea/`

Expected source areas include:

- `textAreaEditContextInput.ts`
- `textAreaEditContextState.ts`
- `textAreaEditContext.ts`
- `textAreaEditContext.css`
- focused Monaco input tests

Generated Monaco ESM, bootstrap assets, and Code TE2 bundles remain publication
artifacts. Android native source is outside this web-input change unless later
device evidence identifies a separate wrapper defect.

## Non-Goals

- Do not transplant minified Ace code into Monaco.
- Do not make desktop or iOS use the Android strategy.
- Do not use polling to discover IME completion.
- Do not depend on a trustworthy `compositionend` for correctness.
- Do not solve ghost text only with opacity, text color, or decoration CSS.
- Do not move accepted text rendering out of Monaco.

## Risks And Open Decisions

- Determine whether Android composition presentation events can be suppressed
  completely or must still be projected internally for undo grouping.
- Define sentinel stripping and offset mapping for UTF-16 selections.
- Define behavior for model lines containing extreme lengths.
- Preserve newline, backward-delete, paste, undo, and redo semantics.
- Preserve screen-reader behavior by restricting physical detachment to the
  Android non-screen-reader strategy if necessary.
- Decide whether adjacent-line projection is needed for Monaco selections that
  cross a line boundary.
- Verify that Gecko, GeckoView, Chrome, and WebView expose equivalent cumulative
  textarea values even when their composition event streams differ.

## Acceptance Boundary

Build and unit validation are necessary but not sufficient. Success requires
device behavior with the persistent Gboard recomposition defect active.

The completed strategy must demonstrate:

- no visible native ghost text or composition underline;
- no stale native line after tapping elsewhere;
- no gradual slowdown during extended recomposition dragging or typing;
- no missed, duplicated, or displaced text;
- correct cursor placement after ordinary and rapid input;
- correct line break and backward-delete behavior;
- correct paste, undo, and redo behavior;
- unchanged desktop and iOS input behavior.
