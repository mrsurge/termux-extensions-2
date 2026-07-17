# Ace-To-Monaco Android Input Port Tracker

Status values:

- `done`: source-backed work is complete.
- `active`: work is currently underway.
- `pending`: expected work has not started.
- `blocked`: work requires a decision or unavailable evidence.

This tracker is independent from the earlier Gboard tracker. It follows the
new direction documented in `ACE_ANDROID_INPUT_ARCHITECTURE.md`: replace
Android's composition-dependent correctness path with a detached,
frame-coalesced input transaction.

## Reference Analysis

| Status | Item | Current outcome |
| --- | --- | --- |
| done | Trace application entry flow | `assets/index.html` loads the application, the application dynamically imports Ace, and `assets/service.worker.js` only controls fetch/cache behavior. |
| done | Isolate the minified input module | The named `ace/keyboard/textinput` AMD module was extracted and formatted through `prettier` on stdin without creating derived files. |
| done | Identify the active Android branch | Android selects the dedicated non-iOS branch in the patched Ace 1.4.6 bundle. |
| done | Verify composition suppression | The active branch registers no `compositionstart`, `compositionupdate`, or `compositionend` listeners. |
| done | Recover textarea projection | The branch uses a leading `⇝` sentinel, logical-line content, and two trailing newlines with shifted selection offsets. |
| done | Recover scheduling contract | Native `input` is coalesced through `requestAnimationFrame`; `syncText` then `resetSelection` run in deterministic order. |
| done | Recover visual suppression | Application CSS physically moves the focused textarea away from editor content instead of relying on transparent composition paint. |
| done | Compare current Monaco path | Monaco still creates a visible composition textarea, gates ordinary input on `_currentComposition`, and prevents settle while composition remains active. |

## Contract Design

| Status | Item | Intended outcome |
| --- | --- | --- |
| done | Define Android strategy boundary | Android uses the detached transaction path while desktop and iOS retain existing behavior. |
| done | Define projection DTO/state | `TextAreaState.createAndroidImeLine(...)` owns the sentinel-backed logical-line projection and model-line metadata. Adjacent-line projection remains deferred. |
| done | Define UTF-16 offset mapping | Textarea selection offsets are normalized after the sentinel and remain Monaco UTF-16 model offsets; surrogate-pair coverage is present. |
| done | Define frame scheduler | One cancellable animation-frame item consumes the latest textarea value and selection for all pending Android input events. |
| done | Define commit/reseed ordering | A generation-guarded zero-delay reseed can run only after the synchronous model edit callback returns. |
| done | Define cursor ownership | The accepted native selection is projected with the cumulative edit; selection-only native movement does not move Monaco. |
| done | Define composition event policy | Android composition start/update/end events are ignored by correctness and presentation paths. |
| active | Define special input types | Line break and backward delete use the cumulative transaction. Clipboard, history undo, and history redo still need browser/device traces. |
| pending | Define accessibility exception | Determine whether screen-reader-optimized Android sessions require a separate visible/accessibility projection. |

## Monaco Implementation

| Status | Item | Intended outcome |
| --- | --- | --- |
| done | Add detached Android projection state | The textarea corpus is `\u21dd` + logical line + `\n\n`, with model-relative metadata and shifted selections. |
| done | Add cumulative projection diff | One normalized previous/current corpus comparison produces one explicit model edit. |
| done | Add frame-coalesced input intake | Rapid native events collapse into one latest-value read per animation frame. |
| done | Add ordered transaction scheduler | Model mutation runs before a generation-matched canonical reseed. |
| done | Remove Android composition data gate | `_currentComposition` is never created by Android composition events and cannot block Android `input`. |
| done | Suppress Android visible textarea | Android composition events do not reach the context presentation emitters, so `_visibleTextArea` is not created. |
| done | Physically detach Android textarea | `android-ime-input` is held at negative coordinates with a negative transform while retaining focus. |
| done | Disable native EditContext on Android | Chromium Android is forced through the patched textarea transaction path while desktop Chromium retains native `EditContext`. |
| done | Replace correctness timers | The 35 ms rapid classifier, 140 ms settle timer, pending cursor, and long-lived textarea ownership state are removed. |
| done | Handle line break and backward delete | Sentinel-normalized deltas preserve newline insertion and backward deletion through the same transaction. |
| active | Preserve clipboard and command behavior | Existing explicit cut/copy/paste handlers are unchanged; Android input-type behavior for paste and history operations still needs device validation. |
| done | Preserve tap relocation | A synthetic tap flushes accepted browser-owned text before pointer relocation; the destination selection then reseeds normally. |

## Automated Validation

| Status | Item | Intended evidence |
| --- | --- | --- |
| done | Projection corpus tests | Pure-state tests and a compiled-ESM runtime probe verify sentinel stripping, cumulative edits, newlines, deletion, and UTF-16 offsets. |
| active | Cumulative burst tests | A browser test coalesces two native input mutations into one final model delta; source typechecks, but this pinned checkout does not contain its browser test runner. |
| active | Missing composition-end test | The burst test intentionally omits `compositionend`; source typechecks, but browser execution remains pending. |
| active | Composition-noise test | A browser test proves start/update/end noise produces no editor events or projection clearing; browser execution remains pending. |
| pending | Reseed ordering test | No editor-to-textarea write occurs before the corresponding model edit is accepted. |
| done | Ghost-surface structural test | Android composition events return before presentation emitters and the Android textarea has a persistent detached class. |
| active | Cursor mapping tests | Middle replacement, newline, deletion, and surrogate-pair offsets are covered; broader selection and combining-input cases remain. |
| active | Special input tests | Line break and backward delete are covered; paste, undo, and redo remain. |
| pending | Platform regression tests | Desktop, iOS, and screen-reader paths retain their existing event and rendering contracts. |

## Build And Publication

| Status | Item | Intended outcome |
| --- | --- | --- |
| done | Run focused TypeScript validation | Changed tests pass an isolated `tsgo` config. Full source checks remain blocked by unrelated pinned-tree errors in `explorerService.ts` and `browserSocketFactory.ts`. |
| done | Build Monaco editor distribution | `editor-distro` completed with zero compilation errors. |
| done | Import scoped ESM output | The four changed ESM modules, source maps, and textarea CSS were copied into the TE2 vendor tree. |
| done | Regenerate Monaco bootstrap | Bootstrap JavaScript, CSS, and maps contain the detached textarea and frame transaction. |
| done | Rebuild Code TE2 | `npm run typecheck` and `node build.mjs` passed; `static/dist/host.js` contains the new strategy. |
| done | Synchronize OTA release | Framework, app manifests, asset URL versions, Rust package version, and editor version are synchronized at `0.2.320`. |
| done | Verify OTA inventory | The rebuilt `host.js` and explicit Monaco bootstrap CSS are declared OTA payloads; the host contains the bundled Monaco implementation. |
| done | Preserve Android source boundary | No Android native source was changed. |

## Device Validation

| Status | Item | Intended evidence |
| --- | --- | --- |
| done | Gecko browser reproduction | Persistent Gboard recomposition produces no ghost text, stale line, or displaced edit. |
| done | GeckoView wrapper reproduction | The packaged browser path matches standalone Gecko behavior after OTA. |
| done | Chrome browser reproduction | Android Chromium now selects the patched textarea path and the reproduced Gboard defect is resolved. |
| pending | WebView wrapper reproduction | The native wrapper does not mask or reintroduce the web-input defect. |
| pending | Extended recomposition session | Responsiveness does not degrade during a long-lived broken Gboard session. |
| pending | Tap between lines | The detached projection follows the newly selected line without carrying old composition presentation. |
| pending | Ordinary typing | Normal Android typing remains immediate and accurate. |
| pending | Rapid replacement | Gboard suggestion and recomposition bursts apply one correct cumulative result. |
| pending | Voice input | Repeated voice input does not leave later typing in a corrupt recomposition state. |
| pending | Editing operations | Newline, delete, paste, undo, redo, and selections remain correct. |
| pending | Non-Gboard keyboards | Other software keyboards and physical keyboards remain unaffected. |

## Open Decisions

| Status | Decision | Evidence needed |
| --- | --- | --- |
| done | Sentinel shape | The deployed transaction uses exact Ace parity: `⇝` plus the complete logical line and two trailing newlines. |
| pending | Adjacent-line projection | Determine whether cross-line selections require one neighboring line or a separate fallback strategy. |
| pending | Undo grouping | Determine how to preserve coherent undo transactions without trusting native composition boundaries. |
| done | Cursor projection frame | The frame-coalesced transaction applies the accepted native selection with the cumulative model edit. |
| done | Defensive cleanup | Correctness uses generation-guarded canonical reseeding and does not depend on a watchdog timer. |
| pending | Accessibility path | Confirm detached Android input remains compatible with TalkBack and screen-reader-optimized Monaco. |

## Completion Criteria

The port is complete only when:

- Android input correctness does not depend on `compositionend`;
- the native textarea never paints over Monaco content;
- cumulative input bursts preserve all accepted text;
- cursor projection remains accurate without intermediate cursor tracking;
- extended broken-Gboard sessions do not degrade;
- focused automated tests pass;
- Monaco and Code TE2 builds pass;
- OTA publication contains the changed assets;
- Gecko, GeckoView, Chrome, and WebView device checks are recorded;
- desktop, iOS, clipboard, accessibility, and physical-keyboard behavior do
  not regress.
