# Selected Commit Inline Diff Tracker

## Status

- [x] Fetch upstream and create branch from latest main.
- [x] Fix mobile touch-handle alignment across inline diff transitions.
- [x] Fix Explorer Git commit selector (user live acceptance confirmed).
- [x] Correct Drafts overlay links to summon draft-versus-disk inline diff.
- [x] Investigate and implement selected-Explorer-commit inline comparisons.
- [x] Complete combined acceptance and prepare branch for merge.
- [x] Commit/push the accepted historical enumeration correction: `ba51875d`.
- [x] Record the historical-worktree follow-up direction and four phases.

Original branch goals and Phase 1 are live-accepted; later phases remain
planned. The accepted snapshot above remains
the rollback point.

## Phase 1: Progressive By Changes

- [x] Trace timeout ownership: eight-second frontend request waits for the old
  complete enumeration-plus-hunks Python operation. Live timings remain pending.
- [x] Define the job, streamed summaries/hunks, bounded retention/continuation,
  immutable comparison identity, cancellation, and reconnect contract.
- [x] Implement through existing Rust pipe and app socket surfaces, no polling.
- [x] Test bounded pages/large bodies, cancellation, stale continuation, native
  pipe ordering, early-event and delayed-ack races, historical content, and DOM
  preservation. Python does not retain hunk bodies.
- [ ] Live slow-client/large-history timings and active-editor responsiveness.
- [x] Obtain live acceptance: user confirmed progressive By Changes works.

Validation: four native progressive-change tests; three Python session tests and
one historical routing test; five comparison-baseline and two selector tests;
ten frontend comparison/baseline/selector tests. TypeScript checking and the
frontend bundle build pass. That phase's limited BasedPyright check had no errors
and three warnings; it was not a branch-wide audit. The complete audit below
supersedes that typing result. No Android/version changes or shared-framework restart performed.
The additional pytest-based name-search hydration test was not run because
pytest is not installed in the active Python environment.
Deployment requires the updated Rust framework plus Code TE2 worker/frontend;
older Rust binaries do not expose `search.changes.start`. User live acceptance
confirmed the updated deployment works; dedicated large-history/slow-client
timing measurements remain a follow-up, not a claimed measurement.

## Phase 2: Historical Styling And Actual-State Warnings

- [x] Separate selected-comparison decorations from actual HEAD/index status.
- [x] Project historical card/ancestor styling and modified-file diff navigation.
- [x] Add structural warning badges; never insert them into path/name values.
- [x] Display active-document actual modified/staged state in the status bar,
  keeping drafts distinct and all document projections event-driven.
- [x] Test mixed states, ref supersession, structural labels/sticky scopes,
  backend guards, and tree-only diff navigation; preserve boot warning state.
- [ ] Live external Git actions, reconnect, and mobile layout acceptance.
- [ ] Obtain live acceptance.

Approved safety adjustment: stage/commit/reset are disabled in historical view
and backend-rejected; historical Restore is disabled until Phase 3. Handlers
check selection again inside the off-loop mutation closure. This does not lock
out external Git processes or provide Phase 3 transactional restore guarantees.

User refinement: all actual-state warning labels are historical-only. Returning
the shared selector to HEAD hides Explorer/sticky and status-bar warnings while
preserving the underlying Git metadata. Regression tests cover both directions.

Validation: seven new backend tests, five comparison-baseline tests, two
selector tests, and 21 frontend tests pass. Typecheck and frontend build pass.
No Android/version changes or shared-framework restart. Live acceptance pending.
The attempted `test_file_tabs_projection.py` discovery matched no tests; it is
not counted as validation.

## Planned Phase 3: Guarded Historical Restore

- [ ] Gate stage/commit in historical view in both UI and backend, including bulk
  and overlay routes.
- [ ] Define source-pinned restore, draft reconciliation, and stale-state checks.
- [ ] Implement staged-file warning plus explicit path-scoped unstage offer.
- [ ] Make deletion-from-an-absent-historical-path an explicit confirmation.
- [ ] Reuse existing restore ownership without checkout, staging, or committing.
- [ ] Test cancellation, external races, staged-only content, draft safety,
  backend guard bypass attempts, and cross-client projection.
- [ ] Obtain live acceptance.

## Planned Phase 4: Overlay Restore And Collapsing

- [ ] Reuse guarded restore in each By changes file header.
- [ ] Choose/document the changed-line threshold for initially collapsed diffs.
- [ ] Integrate progressive summaries/hunks and preserve compatible expansion.
- [ ] Test touch/desktop action separation, accessibility, and large-tree cost.
- [ ] Obtain live acceptance.

See `PLAN.md` for the action matrix, boundaries, and unresolved policy details.

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

## Completed: Cold-Start Diff Restoration

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

## Completed: Unified Comparison Workflow

- [x] Combine Drafts navigation and selected-commit comparisons into one phase.
- [x] Record shared Explorer/status selector and matching yellow non-HEAD state.
- [x] Trace selector authority, baseline loading, preference mutations, status
  contributions, and overlay refresh facts; approve concrete implementation.
- [x] Add far-left filename/comparison status control and custom drop-up that
  mirrors and updates the existing Explorer commit selector.
- [x] Apply matching historical-ref highlighting to Explorer selectors.
- [x] Project selected commit baselines to the editor with stale-result fences.
- [x] Make disk comparison avoid Git baseline reads and turn autosave off.
- [x] Make Drafts clicks select draft-versus-disk before opening the target.
- [x] Refresh By changes from Git and comparison-selection events, no polling.
- [x] Pass focused validation and receive user live acceptance of the combined
  workflow. The user reported acceptance complete; individual live scenarios
  were not separately enumerated.

Implementation validation: receiver-sensitive cold-start coverage retained;
focused tests cover exact-commit reads, disk mode making zero Git reads,
selection changes during materialization, unborn repositories, atomic preference
updates, shared-status menu commands, obsolete mode/ref/revision rejection, and
out-of-order By changes replies. Typecheck, frontend build, and 19 focused tests
passed. The user confirmed complete live acceptance. No shared framework
restart, APK build, or release-version change was required by this implementation.

Initial source findings:

- `explorer/handlers/git.py` persists the selector through the existing history
  store and publishes `GitDiffBaseChanged`. Reuse that authority for host intent.
- `monaco_editor/editor_view_state_backend.py` and the active-file broadcaster
  in `editor_ws.py` hard-code HEAD and read Git even for a disk comparison.
  Both request and push paths need the same mode-aware baseline builder.
- `src/explorer/search/review-results-renderer.ts` currently enables both draft
  and commit diff helpers sequentially; replace that with one coherent mode
  action before navigation.
- `main_page/frontend/ui/extension-activity.ts` owns the current status bar.
  Keep the new comparison control outside extension-owned content containers.
- `GitDiffBaseChanged` already reaches Explorer render-state projection, and
  the selector controller refreshes By changes for selection changes. Audit
  ordinary Git snapshot refresh separately so unchanged refs still refresh
  changed working-tree results without polling.

## Historical Changes Enumeration Follow-Up

- [x] Identify Rust `git.worktreeChanges.get` echoing the selected base while
  enumerating only HEAD dirty status.
- [x] Enumerate non-HEAD comparisons directly from selected tree to worktree,
  preserving the established HEAD status path and existing result limits.
- [x] Cover committed additions/modifications/deletions in a clean checkout,
  files dirty against HEAD but equal to the historical base, untracked files,
  and truncation. Verify the Python overlay passes the same ref to enumeration
  and hunk retrieval.
- [x] Receive live acceptance after the user restarts the Rust framework.

The index-combining diff retained net-zero historical changes in the regression
test, so enumeration deliberately uses the direct tree-to-worktree comparison.
No frontend or Android change is required for this follow-up.

## Backlog: DevTools Through TE2 MCP

- [ ] Investigate existing native DevTools transports and expose exact-target
  debugging through TE2 MCP independently of volatile console logging.
- [ ] Define renderer capabilities, nested worker/session routing, cold-start
  capture, evaluation/actions, bounded events, and connection cleanup.
- [ ] Obtain approval for the implementation scope before native/MCP changes.

Requested during cold-start diff debugging; remains separate from the planned
historical-worktree phases.

## Branch-Wide Type Checking And Correction

- [x] Preserve the implementation snapshot in local commit `0b44fa46` before cleanup.
- [x] Audit every branch-changed Python file, including tests: initial 31-file
  audit reported 23 errors and 165 warnings.
- [x] Replace incomplete/dynamic test fixtures with typed DTOs and validated
  object mappings; supply required handler parameters and typed callbacks.
- [x] Separate host comparison commands from baseline reads and outbound UI IPC
  notifications from namespace dispatch, breaking the reported import cycles.
  Preserve notification encoding, exact-client rooms, and public emitter imports.
- [x] Remove the unused HEAD-reader callback from selected-baseline plumbing.
- [x] Recheck all branch Python files plus cleanup dependencies/new tests:
  39 files, zero errors, zero warnings, no diagnostic suppressions added.
- [x] Pass Code TE2 `npm run typecheck` and Rust
  `cargo check -p te2-server --tests`.
- [x] Pass 24 targeted Python regressions: historical changes/decorations (8),
  comparison baselines (5), progressive sessions (3), selector (2), UI IPC
  contract (3), and extracted notification/host-command contract (3).

This pass changes no frontend assets, Android files, or versions and performs
no shared-runtime restart. The user validated the runtime after cleanup and
approved committing and pushing the completed pass.
