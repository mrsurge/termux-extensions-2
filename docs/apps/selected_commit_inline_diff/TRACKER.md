# Selected Commit Inline Diff Tracker

## Status

- [x] Fetch upstream and create branch from latest main.
- [x] Fix mobile touch-handle alignment across inline diff transitions.
- [ ] Fix Explorer Git commit selector (details pending).
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

## Next: Explorer Commit Selector

Await the detailed reproduction. Trace the selected-commit state and consumers
before deciding whether the fault is presentation, persistence, or baseline
selection. Record the concrete fix and acceptance here.

## Pending: Draft Links And Selected Commit Diff

Clarify the existing draft-versus-disk and model-versus-disk distinctions in
source, then correct the Drafts overlay action. For selected-commit comparisons,
define how commit changes, file changes, unavailable baselines, and reconnects
affect the inline view before implementation. Do not infer those policies from
the old experiment alone.
