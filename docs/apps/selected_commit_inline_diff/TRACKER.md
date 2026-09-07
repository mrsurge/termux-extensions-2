# Selected Commit Inline Diff Tracker

## Status

- [x] Fetch upstream and create branch from latest main.
- [x] Fix mobile touch-handle alignment across inline diff transitions.
- [x] Fix Explorer Git commit selector (user live acceptance confirmed).
- [ ] Correct Drafts overlay links to summon draft-versus-disk inline diff.
- [ ] Investigate and implement selected-Explorer-commit inline comparisons.
- [ ] Complete combined acceptance and prepare branch for merge.

## Completed: Mobile Touch Geometry

Date: 2026-09-06.

- [x] Inspect the broken Cefrium main-page editor without refreshing.
- [x] Capture fresh-load and plain/diff/plain geometry in a temporary probe.
- [x] Identify initialization-time gutter subtraction as the horizontal error.
- [x] Fix the editable touch-extension source and rebuild its UMD.
- [x] Publish the generated UMD into the parent repository.
- [x] Update the technical reference and concise repo memory.
- [x] Receive user live acceptance after asset update.
- [x] Remove the temporary geometry probe.
- [x] Commit and push touch source: `mrsurge/monaco-touch-selection`,
  `master`, commit `5887b7f`.

Evidence: the fresh editor reported and rendered the same handle coordinates.
After diff-to-plain recreation, Monaco reported x=200 while the handle used
x=144, a 56-pixel error matching the cached gutter width. Monaco already includes
the gutter in `getScrolledVisiblePosition`; subtracting it again made alignment
depend on whether the gutter had been measurable during initialization.

The fix removes that subtraction, initializes the overlay's negative scroll
translation during selection sync, and resyncs on layout/content-size changes.
Vertical coordinates matched in the captured reproduction.

Validation: the fork's `npm run build` passed TypeScript checking and Vite output
generation. The copied UMD and fork output have identical SHA-256:
`8155695674a48b867bffd6f745628754ce7b0b83f053aba6d30aedab87cc790e`.
The user confirmed the fix works live. No APK build or version bump was needed.

## Completed: Explorer Commit Selector

External commits updated Explorer status but left the baseline label stale.
Opening By changes resolved the baseline again and repaired the label. The
GitSnapshotChanged projector carried status/decorations but no baseline metadata;
the dropdown also presented both HEAD and its commit as separate checked rows.

- [x] Project resolved baseline metadata with the existing Git snapshot fact.
- [x] Resolve HEAD against the snapshot's exact hash, caching immutable metadata.
- [x] Preserve explicit historical comparison selections after a new commit.
- [x] Present the latest commit once, with HEAD-following selection semantics.
- [x] Guard initialization replies against newer projections and reject status
  notifications belonging to another project.
- [x] Pass two backend tests, two frontend tests, typecheck, and host build.
- [x] Receive user confirmation that the selector fix works live.

Historical selection retention is covered by the focused tests. The user's
acceptance confirms the live fix overall; a separate live historical-selection
matrix was not reported.

The legacy payload mode named `detached` denotes an explicit comparison ref;
this work adds no detached-HEAD checkout workflow.

## Pending: Draft Links And Selected Commit Diff

### Cold-Start Diff Regression Investigation

- [x] Confirm enabled commit-diff preferences with a plain editor in Cefrium.
- [x] Confirm a manual baseline request creates the missing diff editor.
- [x] Add bounded `[InlineDiffInit]` startup stages and catch asynchronous
  snapshot initialization failures. No retry or startup-order changes yet.
- [x] Retain the latest 64 stages in `window.__te2InlineDiffInitTrace` because
  volatile console delivery dropped most of the first cold-launch trace.
- [x] Capture a cold launch with the instrumented frontend and identify the
  failed stage before implementing the correction.
- [x] Fix native timer receiver loss in the baseline debounce dependencies;
  report scheduling failures instead of swallowing them.
- [x] Pass a receiver-sensitive regression test covering cold scheduling,
  superseding requests, and immediate requests.
- [x] Receive cold-launch live acceptance of the timer fix.

The retained trace reaches baseline scheduling but not its timer callback.
Calling a raw Window timer as an options-object method throws `Illegal
invocation`, reproduced in both clients. The debounce helper swallowed that
exception; immediate preference toggles bypass scheduling and therefore worked.
The dependencies now call `window.setTimeout`/`window.clearTimeout` through
wrappers. This establishes the cold-start defect, not why the older Electron
build avoided the path.

The user reports working diffs after a framework restart and manual setting
reload. Keep the remaining cold-start restoration failure separate from the
earlier DevTools/worker startup investigation. The older Electron frontend is
the working same-server control; the branch-specific trigger remains unproven.

Clarify the existing draft-versus-disk and model-versus-disk distinctions in
source, then correct the Drafts overlay action. For selected-commit comparisons,
define how commit changes, file changes, unavailable baselines, and reconnects
affect the inline view before implementation. Do not infer those policies from
the old experiment alone.

## Backlog: DevTools Through TE2 MCP

- [ ] Investigate existing native DevTools transports and expose exact-target
  debugging through TE2 MCP independently of volatile console logging.
- [ ] Define renderer capabilities, nested worker/session routing, cold-start
  capture, evaluation/actions, bounded events, and connection cleanup.
- [ ] Obtain approval for the implementation scope before native/MCP changes.

Requested during cold-start diff debugging; does not supersede that fix.
