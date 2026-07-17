# Gboard Android IME Tracker

Status values:

- `done`: source-backed work is complete.
- `active`: currently being implemented or investigated.
- `pending`: expected work has not started.
- `blocked`: work requires an explicit decision or unavailable evidence.

## Baseline And Research

| Status | Item | Current outcome |
| --- | --- | --- |
| done | Establish the defect boundary | The target is persistent Gboard web-IME recomposition exposed after repeated voice input, not ordinary Gboard typing or a general textarea defect. |
| done | Audit the pinned Monaco input path | The Android word buffer, selection-constrained diff, relative composition edit, selection-only cursor movement, and synchronous textarea rewrite path are identified in current source. |
| done | Define cursor ownership | Do not track intermediate invisible-cursor movement. Use full-line text changes for edits and the latest native selection only for eventual visible-cursor projection. |
| done | Audit the existing Gboard paste patch | Commit `3d5f56cbf83` preserves incoming text while suppressing unsafe secondary behavior during a trailing burst lease. |
| done | Establish documentation set | `README.md`, `IMPLEMENTATION_PLAN.md`, and this tracker describe the current source-backed direction. |
| pending | Capture focused event traces | Record ordinary typing, native navigation, post-voice recomposition, serialized paste, and settling without unbounded payload logging. |

## Monaco Implementation

| Status | Item | Intended outcome |
| --- | --- | --- |
| done | Build full-line Android textarea state | Android receives the complete underlying model line, with model selection columns converted to line-relative UTF-16 offsets. |
| active | Add tested textarea/model offset mapping | Direct model-line mapping is implemented; broader wrapped-line, injected-text, and edge-position regression cases remain. |
| done | Derive unconstrained full-line text deltas | A capped common-prefix/common-suffix delta produces one explicit line-relative replacement independent of cached cursor offsets. |
| done | Apply explicit line-range replacements | Divergent and replacement mutations use an Android-specific explicit-range editor command instead of first moving Monaco's cursor. |
| done | Ignore selection-only native movement | Value-stable native movement updates only the pending native cursor and emits no Monaco edit or immediate cursor command. |
| done | Project cursor after ordinary text input | Non-rapid input projects the native result immediately; aligned insertion retains Monaco's normal typing path. |
| done | Debounce rapid cursor projection | A second mutation within 35 ms defers intermediate cursor projection while every edit still applies. |
| done | Gate Monaco-to-textarea feedback | Render- and cursor-driven writes return before changing cached state while Android owns the textarea. |
| done | Preserve actual cached textarea state | The cached state is updated from actual native reads during ownership, never from blocked writes. |
| done | Settle once after quiet | After 140 ms of quiet, the latest native cursor is projected and canonical textarea state is written once. |
| done | Reset stale composition on pointer-event taps | Android pointer-event taps now dispatch the same synthetic textarea tap as the legacy touch path before moving Monaco's cursor. The reset writes a true empty textarea state before the destination line is reseeded. |
| active | Preserve paste workaround behavior | The normal aligned-insertion path still uses Monaco typing and the paste classifier remains separate; device and browser regression validation remain. |

## Automated Validation

| Status | Item | Intended evidence |
| --- | --- | --- |
| pending | Full-line state tests | Line corpus and selection offsets are correct at start, middle, end, punctuation, and empty-line positions. |
| active | Value-delta tests | Insert, repeated-character delete, and cursor-divergent deltas are covered; broader replacement and suggestion fixtures remain. |
| done | Selection-only tests | The pure line-delta contract verifies that value-stable native cursor movement produces no edit. |
| active | Rapid replacement tests | A focused Android recomposition test is authored and typechecks; Playwright cannot execute on the Android Node platform used by this checkout. |
| done | Synthetic-tap teardown test | A focused Firefox/Android fixture verifies that synthetic tap ends stale composition and writes an empty textarea even when the normal Android host state still contains the old line. |
| pending | Write-gate tests | Blocked writes preserve the actual DOM baseline and settling writes exactly once. |
| pending | Paste regression tests | Existing multi-character and serialized single-character burst behavior remains intact. |
| pending | Undo/redo tests | IME replacement operations create coherent undo boundaries without replaying intermediate text. |

## Device Validation

| Status | Item | Intended evidence |
| --- | --- | --- |
| pending | Exact divergent-cursor reproduction | Insertion occurs at Gboard's line-relative cursor without duplicating text between native and visual cursors. |
| pending | Space and punctuation traversal | Gboard can move through the complete logical line without Monaco rebuilding a word buffer. |
| pending | Repeated voice-input trigger | Later recomposition does not produce suffix replay, recursive echo, or cursor oscillation. |
| pending | Voice typing side effect | Voice text can be accepted without corruption; this remains secondary to fixing latent recomposition. |
| pending | Normal typing responsiveness | Ordinary text input moves the visible cursor without waiting for the rapid-input debounce. |
| pending | Mobile Chrome validation | Verify the corrected Monaco web path without TE2's native Android input filter. |
| pending | Gecko validation | Verify browser-specific composition and selection event ordering. |
| pending | GeckoView/WebView wrapper audit | Determine whether the native input filter masks or conflicts with the corrected web path before proposing Android changes. |
| pending | Other keyboard and physical keyboard regression | Android input that does not produce the Gboard edge case remains unchanged. |

## Build And Publication

| Status | Item | Intended outcome |
| --- | --- | --- |
| blocked | Run targeted Monaco browser tests | Test source and its import graph pass focused `tsgo`; Playwright rejects `process.platform === "android"`, so execution requires a supported runner. |
| done | Build Monaco editor distribution | `editor-distro` completed with zero compilation errors and produced the updated ESM graph. |
| done | Import deployed Monaco assets | The five changed editor runtime modules and maps are published into `app/static/vendor/monaco-editor-core/esm`; unrelated localization/header drift was excluded. |
| done | Rebuild Code TE2 host when required | The Monaco bootstrap and `static/dist/host.js` were regenerated; Code TE2 typecheck and build both pass. |
| done | Verify clean source/publication state | Monaco source and tracker diffs pass `git diff --check`; generated bundle whitespace is compiler output and is not hand-edited. |

## Open Decisions

| Status | Decision | Evidence needed |
| --- | --- | --- |
| active | Rapid-mutation threshold | The initial threshold is 35 ms between mutations; device traces must confirm it distinguishes ordinary input from recomposition without dropping text. |
| active | Trailing quiet duration | The initial settle delay is 140 ms; device testing must confirm a stable release without making ordinary cursor movement feel delayed. |
| active | Ownership triggers | Input/composition value activity acquires ownership and value-stable selection movement extends pending cursor state; device event ordering still needs validation. |
| pending | Undo grouping boundary | Confirm whether one recomposition lease or browser composition boundaries provide the least surprising undo behavior. |
| pending | Shared burst utility | Consider only after paste and recomposition classifiers have independent tests. |
| pending | Native Android filter policy | Decide separately after the corrected browser path is validated; Android is outside the current implementation scope. |
