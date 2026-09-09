# Selected Commit Inline Diff Tracker

## Status

- [x] Fetch upstream and create branch from latest main.
- [x] Fix mobile touch-handle alignment across inline diff transitions.
- [x] Fix Explorer Git commit selector (user live acceptance confirmed).
- [x] Correct Drafts overlay links to summon draft-versus-disk inline diff.
- [x] Investigate and implement selected-Explorer-commit inline comparisons.
- [x] Complete combined acceptance of the original branch goals.
- [x] Commit/push the accepted historical enumeration correction: `ba51875d`.
- [x] Record the historical-worktree follow-up direction and four phases.

Original branch goals and Phases 1–4 are live-accepted. Phase 5 below is now
required and blocks merge of this branch; earlier acceptance does not waive it.
The latest accepted progressive-discovery snapshot is `d9bf1bcb`.

## Phase 5: Shared Text Edits, Hunk Restore, And Find/Replace

**Next required phase; merge blocker.** This is no longer optional later work.

- [ ] Investigate existing Rust edit/filesystem services, Python draft
  materialization, and editor/WBA mutation/projection contracts.
- [ ] Agree on concrete edit DTOs, stale-state checks, mutation ownership,
  draft-versus-disk behavior, and multi-file failure semantics before coding.
- [x] User corrected and approved direct-to-disk behavior for both features:
  disk search/diffs, draft-presence warning with explicit discard/cancel before
  mutation, no replacement drafts, no autosave or index changes. The earlier
  draft-aware-search proposal is superseded.
- [ ] Implement a shared guarded framework text-edit operation using exact edits,
  preserving encoding/line endings and rejecting stale source revisions.
- [x] Implement the non-writing `fs.textEdits.compute` foundation: SHA-256 source
  identity, original UTF-8 byte ranges, expected range text, deterministic ordering,
  overlap/boundary rejection, literal replacements, and bounded output.
- [x] Pass 10 primitive/pipe tests, including exhaustive boundary-range checks
  on a Unicode/CRLF fixture and proof that repeated computation never writes disk.
- [x] Add Rust-owned `fs.textEdits.apply`: bounded strict UTF-8 reads, exact
  snapshot checks, same-root serialization, permission-preserving atomic writes,
  and unchanged Git index. External writers retain a check-to-rename race.
- [x] Pass 17 focused primitive/pipe/disk tests; Android skips the separate
  hard-link fixture because its sandbox prohibits creating hard links.
- [x] Add internal Python draft transaction coordination: bounded expiring,
  single-use client/project/path/revision confirmations, explicit discard consent,
  newer-draft preservation, and disconnect-owned execution. Whole-file Restore
  and exact edits share path ownership and the existing result projection.
- [x] Wire hunk preparation and Explorer hunkPrepare/hunkApply through guarded consent.
- [ ] Wire Find/Replace producers and controls through the same transaction.
- [x] Pass 35 Python adapter/transaction/whole-file Restore tests and focused
  Basedpyright checks, including cancellation, project changes, stale consent,
  write failure, no-op, and concurrent drafts.
- [x] Add strict Python `worker_services/text_edit_service.py` pipe adapter;
  validate response DTO/version/path/hash/types and never retry uncertain writes.
  Five adapter tests pass; adapter and tests pass Basedpyright without warnings.
  Explorer hunk actions enter via guarded consent rather than direct transport.
- [x] Implement per-hunk Restore against the selected baseline, preserving every
  unrelated edit rather than invoking whole-file discard-and-restore.
- [x] Add pure Rust reverse-hunk generation from exact buffers with libgit2
  boundaries, preserving line endings/EOF/Unicode and unrelated hunks. This is
  exposed internally as `fs.textEdits.reverseHunk`, used by disk-bound preparation.
- [x] Validate three reverse-hunk tests plus 17 existing text-edit/pipe/disk
  tests (one Android hard-link fixture remains skipped). Pipe coverage verifies
  exact CRLF payloads and no write during reverse-hunk generation.
- [x] Bind actionable hunk identities to pinned baseline and disk hashes, source
  buffers through framework reads, and connect Explorer confirmation controls.
- [x] Validate 4 hunk-generation/preparation tests, 5 progressive-change tests,
  37 Python transport/consent/Restore tests, and 5 frontend regression tests.
  TypeScript and focused Basedpyright checks pass; host bundle rebuilt.
- [x] User live acceptance passed for Restore hunk after framework restart and client asset refresh.
  Find/Replace remains the next implementation slice, not completed by this work.
- [x] Implement Find/Replace through By contents using the shared operation;
  define selected-match/file and bulk replacement scope explicitly.
- [x] Add Rust read-only `fs.textEdits.prepareReplace`: pinned disk hash,
  existing search matchers, selected occurrence verification, bounded capture
  expansion and exact edits; six producer/pipe tests pass.
- [x] Add per-file Explorer `search.replace` prepare/apply RPC using retained
  hit indexes/query options, post-read session fencing, and existing guarded
  draft-discard consent/apply. Forty Python transport/guard tests pass;
  focused production/test Basedpyright is clean.
- [x] Wire replacement UI and multi-file outcome orchestration. Respect the
  existing 64 pending-confirmation bound; do not preallocate 700 per-file tokens.
  The replacement input documents the supported producer grammar; complete
  Monaco replacement case-transform parity is not claimed by this checkpoint.
- [x] Fix single-line occurrence enumeration in the shared serial/progressive
  ContentSink using matcher.find_iter, including caps within a matching line.
  Seven content-search tests pass (four benchmarks intentionally skipped) and a
  DOM regression verifies distinct same-line results and occurrence counts.
- [x] Add optional exact disk snapshot/absolute byte-offset identity for supported
  replacement hits; preserve multiline, case/word/regex and cancellation semantics.
  Rust searches one bounded UTF-8 snapshot; per-hit editTarget contains its
  SHA-256 and byte range. Python cache/projection and frontend normalization retain
  identity. Lossy/unsupported and single-line BOM results remain display-only.
  Eight Rust content tests pass (four benchmarks skipped), two frontend tests
  pass, and two Python contract tests pass via direct invocation (the active
  Python lacks pytest). TypeScript/Basedpyright pass; host bundle rebuilt.
- [x] Record agreed occurrence semantics: each match is a separate logical hit,
  even on the same line (three occurrences means three independently displayed
  results with distinct exact ranges and a disk snapshot identity).
- [x] Make counters/caps count occurrences and prevent line-based deduplication.
  Single-hit replacement must address only the selected occurrence; bulk must
  include every occurrence within its explicitly selected scope.
- [x] Test repeated same-line matches, independent replacement of a later hit,
  accurate counters, and complete inclusion of in-scope hits in bulk replacement.
- [x] Approve bounded Replace All over retained results (current cap 700), not
  rendered-only hits or matches beyond the cap; dismissed files are excluded.
- [x] Add replacement-mode twisty/inset, valid empty replacements, and persistent
  touch-accessible per-hit/per-file/global replacement controls (not hover-only).
- [x] Add top Show All, Select All (also reveals all), and Replace Selected;
  file headers get Show All in File and `×` dismissal. No Replace Visible.
- [x] Add desktop-UA-only translucent hit/file checkboxes, mobile-UA gesture-only selection
  with hint and long-press entry on hits and file headers. Header taps clear a
  fully selected group or reveal/select all when any retained hit is unselected.
- [x] Omit checkbox DOM and spacing entirely on mobile UAs at every width;
  inset highlights retain selection feedback. Sixteen frontend tests pass,
  including wide mobile and narrow desktop UA cases.
- [x] User live acceptance passed for Find/Replace, including gesture-only
  mobile selection, file-header long press, and full/partial group toggling.
- [x] Warn about hidden retained hits before Replace All unless shown first;
  always retain the separate draft-discard confirmation and truncation disclosure.
- [x] Test bounded scopes, file dismissal, hidden-hit warnings, mobile selection,
  empty replacements, stale result identity, and per-file partial outcomes.
- [x] Validate 12 frontend regression tests, including 700 rendered hits, 70-file
  sequential prepare/apply, selected-hit identity, hidden warnings, draft
  cancellation, failure stop, and mobile long-press/scroll separation.
  Successful-file results are dismissed as stale; Refresh results reruns search.
- [ ] Preserve autosave preferences, newer drafts, and staged/index safety.
  Both actions explicitly save to disk; no silent draft discard, staging, or commit.
- [ ] Project accepted edits through existing backend facts to all affected
  editors/WBA models, draft indicators, Git decorations, and search results.
- [ ] Validate stale results, concurrent clients/edits, unsaved drafts, staged
  files, Unicode/line endings, no-op edits, partial failures, and cancellation.
- [ ] Complete type checks and focused automated tests; verify mutation work
  does not block unrelated editor opens or progressive search delivery.
- [ ] Obtain user live acceptance of per-hunk Restore and Find/Replace with
  draft/modified-state handling before marking the branch merge-ready.

Python debug evaluation and native DevTools/MCP remain separate work; neither
replaces or precedes this required phase by default.

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
- [x] Live external Git actions, reconnect, and mobile layout acceptance.
- [x] Obtain live acceptance (user confirmed both Phase 2 checks).

Phase 2 safety adjustment: stage/commit/reset were disabled in historical view
and backend-rejected; historical Restore stayed disabled until Phase 3. Handlers
check selection again inside the off-loop mutation closure. This does not lock
out external Git processes or provide Phase 3 transactional restore guarantees.

User refinement: all actual-state warning labels are historical-only. Returning
the shared selector to HEAD hides Explorer/sticky and status-bar warnings while
preserving the underlying Git metadata. Regression tests cover both directions.

Validation: seven new backend tests, five comparison-baseline tests, two
selector tests, and 21 frontend tests pass. Typecheck and frontend build pass.
No Android/version changes or shared-framework restart. User live acceptance complete.
The attempted `test_file_tabs_projection.py` discovery matched no tests; it is
not counted as validation.

## Phase 3: Guarded Historical Restore

- [x] Gate stage/commit in historical view in both UI and backend, including bulk
  and overlay routes.
- [x] Define source-pinned restore, draft reconciliation, and stale-state checks.
- [x] Implement staged-file warning plus explicit path-scoped unstage offer.
- [x] Make deletion-from-an-absent-historical-path an explicit confirmation.
- [x] Reuse existing restore ownership without changing checkout, staging, or committing.
- [x] Test cancellation, external races, staged-only content, draft safety,
  backend guard bypass attempts, and cross-client projection.
- [x] Obtain live acceptance after the user restarted the updated Rust framework.

User-approved draft policy: offer explicit discard-draft-and-restore, not a
mandatory separate discard. The dialog identifies the source commit; staged
files receive a separate unstage confirmation and then a fresh restore token.
Tokens are exact-client/project/path scoped, single-use, capped at 64, and expire
after five minutes. No expiration polling is introduced.

Implementation: existing `explorer.git.restore` now supports prepare/unstage/apply
phases with captured `projectPath`. Python retains confirmation metadata and
draft revisions; Rust `git.restore.preview` fingerprints source/HEAD/index/disk
and guarded `git.restore` preserves the index. A backend-owned operation survives
caller cancellation. New drafts arriving during the write are retained with an
explicit result warning; restored files use existing backend editor and WBA
projection, not a generic frontend active-file reload. Deletions close canonical
membership only when no newer draft needs preservation. Directory relists now
carry explicit project/generation fences.

Initial safe scope: regular files, repository-root projects, and source/worktree
files up to 32 MiB. Conflicts, symlinks, directories, and submodules are rejected.
Renames are treated as individual paths, not an implicit two-path transaction.
Checks detect stale confirmation; they cannot lock arbitrary external Git or
filesystem processes out of the final check/write interval.

Validation: six native guarded-restore tests, seventeen new backend tests, and six
new UI confirmation tests pass. Existing historical, comparison, progressive,
UI IPC, and Explorer menu regressions also pass. Full branch Python audit and
frontend typecheck/build results are recorded below. No Android/version changes
or shared-runtime restart. Live testing needs the updated Rust framework, Code
TE2 worker, and rebuilt frontend; old clients must reload before using Restore.

Final static validation: all 45 branch-changed Python files (including tests)
pass BasedPyright with zero errors/warnings. Code TE2 `npm run typecheck` and
`node build.mjs` pass; the generated host bundle is updated. Targeted regression
coverage totals 41 Python tests, 11 frontend tests, and 6 native restore tests.
No suppression directives were added. The user confirmed runtime acceptance
after restarting the updated Rust framework.

## Phase 4: Overlay Restore And Hunk Blinds

- [x] Reuse guarded restore in each By changes file header.
- [x] Use the approved 50 displayed lines per hunk, with a dark fade/reveal blind.
- [x] Add independently collapsible hunk headers with ephemeral DOM state.
- [x] Preserve existing rendered controls during progressive result append.
- [x] Complete focused tests and frontend typecheck/build.
- [ ] Live-check touch/desktop targets, visual fade, and large-result behavior.
- [x] Obtain live acceptance (user confirmed the live test looks good).

Whole-file Restore shares `tree/restore-action.ts` with the Explorer menu;
confirmation and backend mutation contracts are unchanged. Blinds hide rows,
not diff data, so initial diff construction cost is not reduced. Controls stop
click propagation, expose expanded state, and Restore is disabled while pending.
Per-hunk Restore/shared text edits/Find-and-Replace remain a later investigation.

Validation: 12 focused frontend tests pass, including blind boundary/retraction,
header collapse, pending Restore protection, navigation separation, progressive
DOM retention, and existing guarded confirmation regressions. `npm run typecheck`
and `node build.mjs` pass; host JS and Explorer CSS publication are updated.
No Python/Rust/Android changes, version bump, or runtime restart was needed.
User live acceptance passed; the full touch/desktop and large-result matrix
was not separately reported.

See `PLAN.md` for the action matrix, boundaries, and unresolved policy details.

## Follow-Up: Duplicate Changes Enumeration

### Follow-Up: Progressive Historical Discovery

- [x] Locate the remaining delay inside Rust enumeration, not Python scheduling.
- [x] Replace whole-tree content comparison with index-backed candidate discovery
  and literal-path disk verification shared by decorations and search.
- [x] Stream the first page's confirmed diffs before later candidates are checked;
  publish final totals/token afterward, retaining guarded continuation pages.
- [x] Add ordering, net-zero/staged/literal-path, pipe, and Python metadata tests.
- [x] Remove temporary Python/Rust timing instrumentation; add ownership comments.
- [x] Pass 69 Rust framework-service tests (4 benchmark tests ignored), 12 Python
  regressions, and BasedPyright with zero errors/warnings.
- [x] Obtain user live acceptance: user confirmed the progressive discovery fix works.

The fast candidate metadata pass still precedes file validation. HEAD retains
its existing index-backed status discovery; no claim of a streamed libgit2
directory walk is made. No Android/frontend asset changes or automatic restart.

- [x] Trace selector notification, snapshot application, and status notification
  independently forcing the same By changes enumeration.
- [x] Remove implicit search side effects from snapshot application. The initial
  status-only refresh design is superseded by independent projection below.
- [x] Pass seven focused selector/notification/progressive regression tests.
- [x] Complete frontend typecheck/build; publish updated host bundle.
- [x] Obtain initial historical-selection acceptance; HEAD follow-up recorded below.

The initial frontend correction passed historical selection but live testing
still showed duplicate enumeration on return to HEAD. A temporary bounded probe
confirmed two actual search requests, each driven by a Git snapshot, roughly
one second apart. The probe was stopped after capture.

- [x] Remove the Python selector handler's redundant direct status broadcast and
  cache invalidation; its comparison fact projector remains the sole owner.
- [x] Pass nine Python tests, including HEAD/historical fact-only selection and
  invalid-ref rejection without persistence or publication.
- [x] Pass BasedPyright on the changed Python handler/test with zero errors/warnings.
- [x] Include the HEAD correction in the final live-accepted scheduling snapshot.

No Rust, Android, polling, or transport changes. Normal overlay open and
explicit continuation remain unchanged. Backend fix requires reloading the
Code TE2 worker, not restarting the shared framework.

### Independent Comparison Projections

Live follow-up exposed head-of-line blocking: comparison and snapshot subscribers
awaited complete editor-baseline reads, and the status-only search trigger waited
for historical decorations. Both waits were unnecessary dependencies.

- [x] Add a bounded LatestProjection runner: one active read and one latest pending
  callback, with superseded-output fences rather than cancelling native threads.
- [x] Make baseline subscribers schedule and return; selection completion does
  not schedule the same baseline again.
- [x] Start By changes from the selection notification immediately. Echo its
  selectionRevision into selectionOnly completion snapshots for exact deduplication.
- [x] Unify watcher Git scheduling; retain pending worktree invalidations even
  when newer selection work replaces a pending projection.
- [x] Preserve save/restore mutation ordering; do not parallelize the fact bus.
- [x] Pass 43 Python and 14 frontend regressions, including deliberately stalled
  work, unrelated fact delivery, rapid replacement, and project-generation fencing.
- [x] Complete branch-wide BasedPyright audit: 50 changed Python files,
  zero errors and zero warnings, including tests.
- [x] Pass frontend typecheck and rebuild the host bundle.
- [x] User confirmed improved live behavior and approved this snapshot for commit.

The exhaustive rapid-selector/HEAD matrix and quantitative latency measurements
were not separately reported during live acceptance.

This is Python/frontend projection scheduling, not multiprocessing or a framework
transport rewrite. There is no Rust/Android build or shared-framework restart.

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
