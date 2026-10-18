# 0.2.354 consolidated release tracker

Updated 2026-10-17; recent-work consolidation at TE2 `38b6fb26` / ALS `fcc716b`.
This is the single current pre-release status/acceptance tracker. See PLAN.md
for the cut line. Workstream plans/contracts retain technical detail; their
trackers retain historical evidence, not independent current release gates.
Old unchecked boxes are evidence to reconcile, not automatic release tasks.

## Recent work — 2026-10-15 through 2026-10-17

Only recent work is consolidated here; older backlog is not reclassified or
silently accepted. User notes below are preserved verbatim, not inferred approvals
to implement every item. No version change, commit or push accompanies this
documentation consolidation.

### Project-scoped autosave and safe switching — source validation

- [x] User approved project-scoped mode ownership, explicit Save All / Discard
  All / Cancel, guarded resolution, stale-context rejection and safe actual
  project switches. Additional approval covers backend-owned per-file scheduling
  with existing mirrors retained only as recoverable pending-write buffers.
- [x] Sidecar mode/revision defaults to Draft Mode without inheriting legacy
  global true; normal projections expose project identity and mode revision.
  Interrupted pending buffers recover in Draft Mode on first worker adoption.
- [x] Confirmation uses bounded expiring one-use receipts and supporting-editor
  pause acknowledgements. Exact draft eviction, conditional mirrors, CRLF/Unicode,
  file permissions, stale consent, disk conflicts and partial failure are covered.
- [x] Backend autosave follows each file across tab changes without an active-tab
  snapshot round trip. Newer typing is retained/rebased; delayed own-write mirrors
  require exact disk proof. Failure preserves buffers, publishes Draft Mode and
  prevents automatic uncertain-write replay.
- [x] Old-project autosave flush precedes project root mutation and holds the
  pause through handoff. Shared save/switch/transition admission fences prevent
  stale requests from writing into another project. Late preference projections
  are fenced by project and monotonic mode revision.
- [x] Final validation: 106 focused Python tests plus 3 subtests pass (including
  23 autosave tests); 18 focused frontend tests pass. Strict mypy for both new
  owners, focused ty, Code TE2 TypeScript check and frontend build pass. Diff
  whitespace check passes with generated bundles excluded from diagnostic output.
  Existing Node module-type warning remains visible. Native/mypyc compilation
  was not run; only about 2 GiB free remains, and no caches/artifacts were deleted.
- [x] User reports the updated slice tested live and accepted. Explicitly verified
  project switching with autosave enabled does not save drafts in the destination
  project, and Save All / Discard All / Cancel guards work. Activation is evidenced
  by the user's live run, not independently audited artifact provenance.
- [x] Live follow-up found acknowledgement defects: temporary read-only pause
  invoked the normal configuration-preference publisher; the resulting regular
  send could make the immediately following volatile snapshot reply drop on a
  busy socket. Pause/release now suppress preference persistence, and snapshot
  replies use the existing reliable/disconnect-fenced request publisher (no
  reconnect replay). Composition regression covers the real configuration
  listener, snapshot handler and congested transport, not only a fake pause setter.
  RPC dispatch errors retain request IDs; snapshot errors name the client and
  distinguish timeouts, and pre-mutation failures state that no files changed.
  Python follow-up suite: 108 pass plus 3 subtests; matching frontend update/reload
  is still required to accept the functional acknowledgement fix. Python error
  diagnostics require a matching domain build; the frontend delivery fix does not.
  Frontend typecheck/build and all five focused autosave tests pass. The broader
  transport/autosave run passes 44/48; four TextMate tests fail on missing mocked
  `location.search`, outside the changed acknowledgement path. Do not report that
  broader suite as passing or treat these fixture failures as live acceptance.
- [x] Autosave cursor follow-up: source inspection found autosave/Save All omitted
  manual Save's own-write SHA registration; the watcher could treat saved text as
  external and emit `editor:open`. All three now use one off-loop atomic-write
  wrapper with the existing in-flight restore fence, publishing SHA before release.
  Duplicate matching notifications no longer consume the receipt; a different
  observed disk SHA still invalidates it and refreshes the exact foreground client.
  No cursor restoration workaround or frontend/model-edit change was added.
  Actual-watcher regressions cover old/new disk notifications during the write,
  three delayed duplicates, genuine external edits and failed-write fence cleanup.
  The full focused Python suite passes 112 tests plus 3 subtests; strict mypy passes
  for both autosave owners and save_service. Existing newer-typing regression passes.
- [x] User live acceptance after the watcher fix: reports everything tested live
  and authorizes commit/push. No agent-performed runtime restart or publication.
- [x] Full backend model projection is deferred to the next version as a possible
  simplification; no projection redesign is included in this accepted slice.
- [x] Checkpoint commit/push authorized; no version change in this slice.

### Accepted implementations and publication

- [x] Desktop editable startup/progress/cancel, theme restoration/watch exclusions,
  trusted hover links, diagnostic Quick Fix and draft projection/context/checkbox/
  selective Save: implemented and user accepted. Preserve bounded evidence in
  their historical trackers; Monaco GPU/graph reduction remains deferred.
- [x] Keyboard relative gutters/jumps, preview guard, cursor restoration and
  Cefrium Ctrl-input correction: implemented and user accepted. R3 below retains
  exact scope, evidence and test limits.
- [x] ALS exact-caller file-open/reconnect routing: implemented, tested, live
  accepted and pushed (TE2 ca5a5805; ALS fb2112b). Shared Sidebar state remains
  distinct from per-client presentation/focus.
- [x] ALS explicit --stdio pipe-only readiness: implemented, tested, live accepted
  and pushed (TE2 38b6fb26; ALS 91bc1a8). No HTTP readiness callback or wrapper
  health-poll prerequisite; stdout protocol-only, diagnostics stderr.
- [x] ALS composer canonical newline/caret projection and armed Escape; Project
  dialog outside-CWD direct open and switch/external/cancel choice: implemented
  in local ALS checkpoint fcc716b without version bump or push. Focused composer/
  navigation/modal/routing suite: 63 passed; typecheck/build pass.
- [x] Matching ALS snapshot (149 resources), OTA ZIP and Android seed refreshed.
  All 445 OTA/seed entries byte-identical; source/projection/provenance verified;
  12 asset mapping tests pass. ALS remains 0.2.138; TE2 assets remain 0.2.353.
  No new APK/install/restart performed. Inspection ZIP/hash evidence is retained
  in sidebar_app_intents/TRACKER.md, not a second active checklist.
- [x] User reports the refreshed current slice seems to be working. This is live
  smoke acceptance for composer/navigation/assets, not a separately enumerated
  mobile reconnect, multi-client or every-client artifact matrix.

### ALS View-card range ribbons — source complete, activation pending

- [x] Preserve known same-file command ranges in the existing generic
  `view_range` DTO for semantic Codex reads; live and transcript fields match.
- [x] Always include known ranges in View title ribbons, independently of custom
  titles, collapsed state or body gutters. Real structured line bounds are a
  fallback; requested ranges survive display truncation without duplicate labels.
- [x] Router/protocol/resume/compaction regressions: 49 tests and 50 subtests
  passed; four actual-renderer regressions passed. ALS ty, frontend typecheck
  and build pass. Technical contracts: ALS TRANSCRIPT_CARD_CONTRACTS.md and
  CODEX_COMMAND_ACTIONS.md.
- [ ] Separately approve matching ALS runtime/client asset activation and obtain
  live acceptance. ALS local checkpoint 7b5e551 contains this correction; no
  restart, OTA/seed publication, version change or push performed.

### Deferred — ALS composer dot ligatures on Chromium

- [x] User reports manually typed `...` renders incorrectly in Chromium/Cefrium,
  but not GeckoView. Live DOM inspection confirms ordinary U+002E periods, not
  replacement characters or text corruption.
- [x] Temporarily disabling composer ligatures corrects the dots, but also
  disables other wanted ligatures. Bundled JetBrains Mono identifies as 2.211;
  its dot ligature/components are present. A temporary full upstream 2.305 font
  with ligatures enabled reproduces the same issue (user verified).
- [ ] Possible follow-up: disable composer ligatures only for Chromium clients
  if no narrower shaping workaround is found. Preserve Gecko behavior and
  composer text/caret/IME; do not insert invisible text or change stored drafts.
  Exact Chromium cause remains unproven. User explicitly deferred this issue;
  no permanent font, user-agent policy or source workaround implemented.

### Multi-client console identity and Sidebar routing — source slice

- [x] Confirm console source defect: ID set has no SID ownership, duplicate labels
  share an eval room and a disconnect can remove a still-live identity.
- [x] Add per-SID registry and collision-checked four-character alphanumeric
  console handles with parent-client suffixes. Preserve durable client/slot/
  presentation identities; ambiguous legacy evals reject rather than broadcast.
  Pin results/cancellation/disconnect/unregister to exact registration ownership.
- [x] Update TE2 main/shared and ALS bridges to adopt handles and retain original
  registration context on reconnect. Bind mention entry lanes to their own
  registered caller; retain exact URL-bound ALS file opens and client-local MRU.
- [x] Focused Python regressions: 74 console/Sidebar/native-owner tests plus
  8 editor RPC boundary tests passed, under disposable cache roots. TE2 console
  bridge: 10 passed; ALS bridge/file-open routing: 3 passed (plus 4 retained View
  ribbon tests passed). Both frontend typechecks/builds and changed Python `ty`
  checks pass. Existing Node module-type warning remains; no failure.
- [x] User live acceptance of current multi-client routing: mentions reach the
  correct ALS frontend and file opens reach the correct client. Exact build/
  installation steps and both disconnect orders were not independently audited;
  do not turn that unrun matrix into a demonstrated defect. Technical plan:
  sidebar_app_intents/PLAN.md.

### Qualified Sidebar windows — corrected requirement, source slice

- [x] Retain console ownership fixes, but correct the scope: the actual Sidebar
  presentation/query identity is state.main-page, not a random console handle.
- [x] Add backend-persisted collision-checked short references for shared states
  and client+window main pages, with live SID/incarnation registration. Pair
  `main_page:f0f0` with `als:a1b2.f0f0`; another parent gets `als:a1b2.c3d4`.
- [x] Carry the qualified identity through launch/restore/detached/native URL
  preparation, console registration and ALS frontend/Rust file-open DTOs;
  validate exact owner/slot/incarnation on incoming opens and mentions. Keep
  shared membership and restore state free of client-specific suffixes.
- [x] Focused ALS Rust gateway tests: 3 passed; existing unexpected-cfg warning
  for embedded-python-adapter remains visible, unrelated to this change.
- [x] Focused Python regressions: 86 tests and 5 subtests passed. Changed Python
  modules pass ty. Code TE2 typecheck/build pass; qualified identity, presentation
  and bridge tests: 30 passed; focused Sidebar transport tests: 3 passed. ALS
  typecheck/build and bridge/file-open tests: 5 passed.
  A broader transport/devtools run passed 44 but failed 4 existing TextMate
  fixtures (`usesHttpGrammarResources` reads undefined location.search); these
  unrelated fixture failures are not claimed fixed or counted as a full pass.
- [x] User confirms ongoing live testing: mentions target the correct ALS
  frontend and file opens target the correct client. Current Electron/Cefrium
  console inspection also confirms short main-page names and matching shared
  Sidebar-state/parent suffixes. Accept the normal multi-client behavior; no
  additional general foreground-routing implementation is outstanding.
  User explicitly classifies deliberately launched duplicate app instances
  sharing one persistent client ID as unsupported. They are mirror projections,
  not independent routing clients; client-scoped notifications are not an open
  routing defect or release blocker. Supported detached/secondary windows retain
  their existing identity/presentation contracts. The user report
  does not establish every reconnect/disconnect order or final packaged artifact.
  Technical contract: sidebar_app_intents/PLAN.md.
- [x] User-approved local ALS checkpoint `570deb5` pins identity source/tests/docs
  without a version bump or push. Refreshed TE2's vendored ALS frontend from that
  revision: all 149 static resources and source/served/license inventories pass
  vendor checks; 3 asset-mapping tests and 5 ALS bridge/file-open tests pass.
  This updates the source snapshot only: OTA ZIP/APK seed publication, native
  installation and runtime/client activation remain pending.

### Mobile shortcut binding after file switches — source fix

- [x] Read-only current Cefrium main-page inspection and source trace: the Ctrl
  adapter retained a textarea binding while Monaco setModel disposes/replaces
  the view. Its widget-focus-only lifecycle did not cover every model switch.
  Live inspection identifies the client; it does not prove private adapter state
  or reproduce every gesture. Regression tests reproduce the missing lifecycle.
- [x] Bind on model replacement/text focus, clear on pre-model change/blur and
  disposal, deduplicate unchanged-input focus, and protect replacement owners
  from old-editor cleanup. No background autofocus or change to IME transactions.
- [x] 19 focused lifecycle/mobile special-key/palette regressions passed.
- [x] Approved follow-up replaces editor PgUp/PgDn with Jmp using the existing
  Go to Line (`:`) action, including secondary-editor forwarding without typing
  a character. Terminal keys unchanged; primary/secondary regressions included
  in the same 19-test suite. Matching client assets still require publication.
- [x] Correct the navigation grid from eight columns to seven after Jmp replaced
  two page keys; add a source regression alongside the seven-button DOM check.
- [x] User live acceptance: mobile file-switch shortcut correction, Jmp control
  and corrected seven-column layout work wonderfully. Final focused suite:
  20 tests passed; frontend typecheck/build passed. This does not imply blanket
  acceptance of the separate qualified Sidebar routing work.
- [x] Final frontend typecheck/build and source whitespace checks passed.
- [x] Mobile file-switch/shortcut/Jmp/layout live acceptance reported by user;
  source slice is in local checkpoint 75228e0c. No agent publication or restart
  was performed. Final release artifact publication remains a separate gate.

### Pending — multiline search recovery and desktop query input

See the separate current ALS slice below; its implementation does not close the
multiline-search or other user-note work.

- [x] Record user regression report and preliminary read-only trace; Rust's
  multiline matcher still exists, but the failing layer is not yet established.
- [x] Live query captured at 999 scanned/zero matches; exact ripgrep query finds
  review_projection.py lines 104–105. User's framework log confirms repeated
  app-worker pipe writer queue-full failures for search-content-2. Source shows
  per-file multiline progress pressure cancelling required delivery. Concrete
  implementation/test scope approved through the input tool.
- [x] Preserve byte/frame/queue limits and all matches. Coalesce optional outbound
  progress and make saturated progress nonfatal; required result/done/error
  frames wait on the existing blocking emitter, observing close. Real invalid
  frame/closed-transport rejection still cancels. No mutation/search replay.
- [x] Add source-owned multiline end-line extent through Rust/Python/TypeScript
  projection and nonshrinking source-range labels, independent of clipped text.
  Add guarded Shift+Enter via the actual flexible InputBox change/layout API.
- [x] Focused frontend result/input/replacement/sticky/TextMate regressions:
  30 passed. Python cache/replacement/hydration: 5 tests and 7 subtests passed;
  changed Python ty checks pass (two pre-existing literal narrowing sites in
  the touched contract module now use casts after existing validation).
- [x] Rust targeted search suite: 42 passed, 4 rate benchmarks intentionally
  ignored. Separate 1,101-file multiline pressure integration test passed;
  covers required result/done and exact source/edit identity. Existing huge-line,
  UTF-8 clipping, batching, replacement and rejection tests remain green.
- [x] Final Rust validation: 151 framework-service tests passed (5 intentionally
  ignored), plus 4 native writer tests passed. Includes a saturated one-frame
  queue, 4,096 dropped progress frames, ordered required result/done delivery,
  close while blocked and immediate invalid-frame rejection. Frontend typecheck/
  build and authored source whitespace checks pass; existing Node module-type
  warning remains. Disk retained ~2.5 GiB free; no caches/artifacts were removed.
- [x] User reports the updated slice tested and working well, accepting search
  completion, multiline line labels and Shift+Enter. No additional timing study
  requested; perceived speed improvement is plausible reduced progress overhead,
  not a measured matcher speedup. User authorizes commit/push; no agent runtime
  restart, domain activation, OTA/seed publication or version bump performed.

The bounded-search OOM correction remains accepted, and the multiline
queue-pressure follow-up now has separate user live acceptance.
Technical correction and activation gates are detailed in search_memory/PLAN.md.

### Current ALS three-issue pre-release slice

- [x] Read user research_handoff.md, verify local commandActions schema and
  upstream Codex TUI use, and obtain concrete source/test/build approval.
- [x] Composer pairing/deletion window 800 -> 1,100 ms (+37.5%); regression
  covers slow deletion, exact expiry and post-delete single-entry suppression.
- [x] Codex read/search/list DTOs drive single-action View/Search cards. Unknown,
  malformed/empty or mixed/multiple actions stay Run; no fabricated per-file
  output, shell writes or line ranges. Peers without metadata retain compatibility.
  Actual router tests cover live/transcript parity, deltas, sparse/completion-only
  delivery and failures; explicit FileChange behavior remains unchanged.
- [x] Document-open-only admission accepts exact registered presentations despite
  lagging/missing active-window state. Keep live client, presentation incarnation,
  shared slot and app ownership; other intents retain active-window admission.
- [x] 47 ALS command/shell/fileChange/protocol/resume/compaction tests and 48
  subtests pass; 52 TE2 Sidebar/routing regressions pass, including real
  document-open composition and unchanged other-intent admission.
- [x] 44 composer tests, ALS frontend typecheck/build, focused ALS/TE2 Python
  type checks and authored source diff checks pass. ALS ty requires its checkout
  explicitly first in --extra-search-path to avoid the harness's TE2 import roots.
- [ ] Matching Code TE2 mypyc activation/worker refresh and fresh ALS extension
  adapter loading; source tests do not activate either runtime.
- [ ] Checkpoint/publish updated cooldown assets when authorized. Current TE2
  pinned ALS snapshot still points to fcc716b, before this three-issue slice.
- [ ] Live slow-delete/read-card and actual project-switch/intermittent file-open
  verification. Do not mark user note 6 fixed solely from source regressions.

Technical contracts: sibling ALS CODEX_COMMAND_ACTIONS.md / COMPOSER_INPUT_PLAN.md,
and docs/apps/sidebar_app_intents/PLAN.md. No version bump, commit/push, runtime
restart, native/mypyc build, OTA refresh or client deployment in this slice.

### User notes transferred verbatim from search_memory/TRACKER.md

The following 673-character block is preserved unchanged. Its original request
to commit is historical text, not current commit authorization.

User notes (commit this): 

1. blank iframes in sidebar for desktop detached iframes (lets get rid of them)
2. deleted draft line marker
3. draft models loading into opened model list instead of the actual models when opening a project with mru's (change many?)
4. unique cross client main page/client id derived sidebar window id extensions (console id)
5. in document mention bubble (in the problem widget.. I forget what it's called... the inline widget for issues)
6. project switches cause file links to stop working in als.
7. use the same window launch mechanism as als for the terminal. instant window opening in the sidrbar based on state, no transition animation.

### Clarified user-note execution queue — 2026-10-17

This queue precedes remaining R4 cleanup and R5 packaging. Other workstream
plans are retained as references; they do not replace this current checklist.

- [ ] U1 / original note 1 — Detached Sidebar windows leave no blank space.
  Show the last eligible docked iframe instead; the detached icon still raises
  its window on every click. Focusing the displayed docked iframe makes it the
  active Sidebar presentation.
  - [x] Source fix approved and implemented: separate docked rendering history
    from foreground/window activation, prune ineligible entries and use existing
    MRU on cold fallback. Existing repeated detached activation remains intact.
    Docked iframe focus uses the existing client selection/activation owner;
    Electron persistent views report exact surface/presentation focus with
    hidden/detached/replaced-entry fences. No backend/mypyc or Android changes.
  - [x] 30 Sidebar selection/presentation/scroll regressions and all 123 Electron
    tests pass. Both TypeScript checks and host/Electron builds pass. Focus tests
    cover delayed iframe activeElement observation and disposal; native tests
    cover hidden/replaced/detached rejection and repeated window raising.
  - [ ] Live acceptance after matching host assets and rebuilt Electron launch:
    detach/activate repeatedly, focus fallback, close/hide fallback, reattach.
    Builds are not publication or activation; no shared framework restart done.
- [x] U2 / original note 3 — **Draft-first initialization correction; live accepted**
  (user direction 2026-10-17). Project restoration must hydrate WBA with opened
  files' draft models, like ordinary file opening. Earlier description claiming
  draft models should not enter the opened-model list was incorrect; the reported
  concern was project-switch draft hydration, not draft exclusion.
  Original symptom: a draft contained a diagnostic-suppression change, leaving
  disk content untouched, but an error unexpectedly remained after restoration.
  Earlier user retesting could not reproduce it, so it was deferred at that
  time. Subsequent reproduction below supersedes that deferral and the earlier
  conclusion that the existing startup implementation satisfied the requirement.
  - [x] Read-only trace finds existing logical_document_reconciler already builds
    draft-first descriptors/materializes full draft content. WorkbenchClient
    supplies foreground-protection paths to the registry; no missing DTO field
    or absent hydration implementation is established.
  - [x] User-approved regression-only investigation: 20 Python tests plus three
    subtests and 19 real WBA registry tests pass; changed Python test passes ty.
    New tests cover persisted sidecars with distinct disk/draft text (including
    Unicode), first→second→first project sequence, foreground/background recents,
    both readiness/open-state orderings, stale generations, actual extension-host
    document DTO text and foreground overwrite rejection. Python transport is
    stubbed and WBA registry is exercised separately: this is not full live
    project-service/frontend transport reproduction.
  - [x] Revisited after live restoration discrepancy recurred. Earlier worker log
    had client_foreground_document_protected hydration
    warnings; registry tests confirm this guard intentionally rejects background
    writes to foreground-owned documents. Warnings alone do not prove draft loss.
    No runtime code, mypyc, assets, active projects or user drafts changed in this
    investigation; no speculative guard relaxation is approved or implemented.
  - [x] User reproduced a related diagnostic mismatch (2026-10-17); read-only
    capture before reload: Cefrium main_page:ipZo and Electron main_page:mFz6
    both show codec.py draft with `# ty: ignore[unresolved-import]`. Cefrium has
    a ty unresolved-msgspec Monaco marker, Electron has none; both tabs show red
    and both Explorer nodes internally retain diagErrors=1 despite the reported
    lack of visible Explorer marker. This reopens diagnostic-coherence diagnosis,
    not proof that project restoration supplied disk instead of draft content.
  - [x] Follow up proven source gap: VS Code DiagnosticCollection.clear emits
    MainThreadDiagnostics.$clear(owner), while current WBA dispatch handles only
    $changeMany. Owner-wide clear is therefore missing; strongest current stale
    diagnostic candidate, but this occurrence's exact triggering request has not
    been captured. User approved the source correction separately; owner/resource
    isolation and direct-editor versus backend projection lanes are preserved.
  - [x] Source correction implements pinned Diagnostics actor NID 16, `$clear`
    argument decoding/dispatch, retained WBA snapshot eviction and explicit
    diagnostics/clear fanout through actual editor handler/marker service and
    backend cache/full projections. Clear is an ordering barrier in the existing
    coalescer; later updates survive and unrelated owners remain. Main host build
    now emits the pinned RPC-ID module, which its entrypoint list had omitted.
  - [x] 52 focused JS tests and 22 Python tests pass; Python ty, frontend typecheck
    and host/WBA build pass. New wire-level tests cross actual WorkbenchClient
    runtime adapters, argument decoder, dispatcher, snapshot owner, event bridge
    and editor notification handler. Backend tests cover update→clear→update,
    exact-owner eviction and file-tab count projection. Adapter-wide tsc has 105
    existing diagnostics; compiler-API comparison against HEAD reports the same
    105 with zero new diagnostics, not a clean adapter-wide typecheck claim.
  - [x] User reports the owner-clear fix live verified (2026-10-17) and approves
    commit/push. This closes the diagnostic-clear follow-up; the original
    restoration issue remains deferred above. The captured occurrence's precise
    replay sequence remains unproven. No runtime restart, mypyc rebuild, user
    draft mutation or client publication performed by agent.
  - [x] Fresh capture: both main_page:Xvpr (Electron) and main_page:qQOs
    (Cefrium) contain the persisted codec.py suppression but show the ty error.
    WBA startup log at 1792286446975 opens the disk-backed document at version 1;
    client didChange at 1792286450061 replaces it with 6182-character draft text
    at version 2. Later same-file reopen at 1792287362287 replaces v2 with v3
    from disk; ty republishes the unresolved import immediately afterward.
    Source lifecycle.ts confirms unconditional disk reads for same-file reopens.
    This is evidence of content-lifecycle failure, not just stale diagnostics.
  - [x] User separately approved backend-owned draft-first initialization,
    attach-only reopens, lifecycle/invalidation regression coverage and builds.
    No runtime transition, OTA or mypyc activation is included in this approval.
  - [x] Implemented initial document bodies in adapter.connect/reconnect over
    the existing local pipe, using existing sidecar materialization and content
    hashes. All initial bodies validate before registry mutation. Normal backend
    opens prepare missing documents before editor notification. Missing-path
    reconciliation initializes rather than attempting protected replacement.
    Foreground attach and extension document-open wait for initialization;
    attach has no disk fallback. Removed initial/reconnect synthetic didChange
    correction sends, while retaining actual edits and conditional mirrors.
  - [x] Existing live buffers are not replaced by late initialization. Backend
    invalidation may update a backend-initialized unchanged version, or reconcile
    identical current text; newer unpublished client edits retain protection.
    Project/revision/hash checks, reset cancellation and per-client facade
    ownership remain. Backend initialization/logical hydration is pipe-only.
  - [x] 62 focused JS tests; 40 Python tests plus three subtests; changed Python
    ty; frontend typecheck and host/WBA build pass. Coverage includes real
    WorkbenchClient connect/open wrappers with only external connection setup
    stubbed, actual persisted draft→connect request→ready ordering, dispatcher
    forwarding, multi-client reopens, no disk read, reset/failure, Unicode,
    hash rejection, backend/live edit invalidation and actual isolated server
    HTTP rejection of private document initialization/hydration. Adapter-wide compiler
    baseline/current both report 107 existing diagnostics, zero new diagnostics.
  - [x] User tested the resulting fix, reports it working well and approves a
    local commit. This records user live acceptance without claiming each
    individual suggested scenario was separately exercised. No agent runtime
    restart, client reload, user draft edit, publication or mypyc activation
    performed in this slice.
- [ ] U3 / original note 2 — Add VS Code-style small red between-line gutter
  indicators for deleted draft lines; inspect upstream behavior before editing.
  - [x] User approved frontend-only marker; inspected local code-server/VS Code
    QuickDiffDecorator and dirtydiffDecorator.css. Existing draft-deletion blocks
    now add a translucent red triangular line-decoration caret in normal editor
    mode under existing draft-insertion visibility. End-of-logical-line range
    preserves wrapped-line anchoring; BOF/EOF/empty-model anchors are bounded.
    Full/inline diff retains stock widgets with no duplicate markers.
  - [x] User-corrected classification: caret only for deletion-only gaps, not the
    old half of a replacement. VS Code quickDiff.ts classifies Delete by an empty
    modified range; TE2 reuses zero-context draft hunk newLines === 0 (and rejects
    contradictory added rows). Equal/growing/shrinking replacements stay blue
    without a caret. No new diff engine or backend DTO is needed.
  - [x] 15 focused marker/inline-diff tests pass; frontend typecheck and host build
    pass. Tests cover block grouping/count, replacement plus insertion tint,
    replacement suppression (including net shrinking), independent pure deletions,
    wrap-anchor columns, boundaries, empty document, stale-path rejection,
    clean collection replacement, legacy decoration path and CSS contract.
    Build retains the existing Node module-type warning, not a failure.
  - [x] User live accepts deletion-only marker classification: caret appears
    only for deleted lines, not replacements (2026-10-17). No agent-managed
    runtime transition or native build performed; frontend-only activation.
- [x] Original note 4 — Qualified Sidebar/client identities implemented and user
  accepted; preserve the existing source and routing contract.
- [ ] U4 / original note 5 — Mentions from the inline problem widget, reusing
  existing mention ownership and exact-client routing.
- [x] Original note 6 — User confirms ALS file links after project switches are
  fixed by the completed routing work; do not reopen as missing acceptance.
- [ ] U5 / original note 7 — Terminal Sidebar opening uses ALS-style immediate
  state-based window launch with no transition animation.

### Still-open pre-release gates

Finish the non-deferred clarified user-note queue above, then R4/R5 and bounded
acceptance below. U2 remains recorded unresolved, not an active release gate.
No old test failure, dependency/pin issue, missing selected artifact or final
wheel/APK validation is closed merely by moving documentation. No duplicate
mandatory full-device matrix is added for the latest smoke acceptance.

## First after release

- [x] Record user-requested browser-engine reuse proposal at repository root:
  `ELECTROMUX_ENGINE_REUSE_PROPOSAL.md` (2026-10-16).
- [ ] Begin its read-only EdgeJS/host capability audit first after release;
  implementation, browser forks and replacement of embedded Node remain unapproved.

## Current approvals and evidence

- [x] User approved read-only audit and documentation consolidation.
- [x] User explicitly defers ALS pipe/intent migration to next version.
- [x] Draft projection/context/chrome/selective Save live accepted; 2a392d77 pushed.
- [x] Minimal diagnostic Quick Fix live accepted explicitly by user; 2e77c843 pushed.
- [x] Theme cold restoration/watcher and hover-link changes have recorded user
  acceptance in their owning tracker; do not reopen as missing implementations.
- [x] Search OOM correction has explicit user live acceptance in search_memory.
- [x] User confirms startup/build group checked out: Electron cold/cached/cancel,
  fresh editable startup and no-op mypyc fingerprint rebuild, except missing
  selected artifact failure captured below. This is user-reported, not a new
  agent run or an inferred exhaustive device/key matrix.
- [x] Existing Sidebar app workflow/CM6 persistence/mobile sticky/dock acceptance
  matrix already records the completed user walkthrough (sidebar_app_intents).
- [x] Existing release README already documents Gboard 18+; historical checkbox
  does not mean another implementation is needed.
- [x] All built-in app entry scripts/templates already declared in common asset
  manifest; minified app outputs and shared-resource trees are source-confirmed.
- [x] Read existing Gecko APK without rebuilding; GECKO_SIZE_AUDIT.md records size
  categories and libxul ELF evidence. No device/runtime or artifact was changed.

## Remaining release work — execute in this order

- [x] Approved keyboard follow-up: suppress digit-only absolute previews while
  actual relative gutters are active; j/k preview and Enter absolute acceptance
  remain. Guarded Monaco bundle hook leaves vendored sources unchanged.
- [x] Cursor presentation follow-up: existing file-open transaction retains at
  most 100 per-file cursor positions per client/store, clamps on restore, keeps
  scroll restoration separate, and respects explicit line/column navigation.
  Desktop opens and keyboard-triggered Explorer/tab cycling focus/restore;
  mobile touch tree opens keep focus=false. No cross-reload cursor persistence,
  backend protocol change, mypyc rebuild or runtime transition added.
- [x] Follow-up checks: 46 targeted tests, 2 selected transport open/jump tests,
  TypeScript check, Monaco bootstrap and final host build pass. Broad transport suite has
  38 pass/4 TextMate fixture failures (missing location.search), outside this
  edit scope; do not report the whole suite green.
- [x] User live acceptance (2026-10-17): relative preview and desktop/keyboard
  cursor-restoration follow-up working; requests commit/push. No agent runtime
  restart or client publication performed; cross-reload persistence remains out
  of scope.

- [x] R1 source audit: entrypoints, literal static dependency graph, computed
  icon families and pinned ALS inventory checked; two proven gaps fixed with
  approval. See STATIC_ASSET_AUDIT.md for limits, matrix and focused test evidence.
- [ ] R1: confirm executing-client requests and final generated asset freshness;
  source closure tests are not a live network capture or publication.
- [ ] R1: publish matched assets and verify slow-connection multi-app Sidebar
  delivery from native-local bytes; dynamic requests remain intentional.
- [x] R2 planning clarification (2026-10-16): optimize downloadable APK size;
  include useLegacyPackaging=true compressed native-library candidate, accepting
  installation-time extraction as a tradeoff. Documentation change only approved.
- [x] Record follow-up reuse after Gecko proves the pattern: eventual standalone
  and Termux shared-UID forms should share a renderer/packaging policy, with
  variant-specific identity/signing/integration; no renderer migration approved.
- [x] R2: review pinned Gecko loader/manifest and approve/implement staging-only
  native compression switch with two same-source builds; R8/debug/release unchanged.
- [x] R2 compression-only builds and artifact checks: 205,044,149 -> 108,413,133
  bytes, 47.1% smaller. Same entries; every payload except AndroidManifest.xml
  hash-identical. Both v2 signatures and ZIP alignment pass; packaged extraction
  flag confirmed true for compressed APK. See GECKO_SIZE_AUDIT.md.
- [x] User installed the compressed Gecko candidate and reports using it with
  normal operation working fine (2026-10-16). This accepts the tested install/
  launch/use path, not an exhaustive update, device or cold-start timing matrix.
- [x] R2: user approves staging R8/resource-shrinking build trial; existing
  optimized release rules retained, comparison opt-out added; debug/release intact.
- [x] R2 R8 candidate builds in 2m33s: 108,413,133 -> 101,573,686 bytes;
  DEX raw 23,402,844 -> 3,926,452 bytes (3 files -> 1). Signature/alignment pass;
  native payloads and frontend assets unchanged (DEX baseline profiles regenerated).
- [x] R2 compatibility decision: R8 8.9.32 reports Kotlin metadata parsing
  warning with Kotlin 2.2.10; official table lists R8 8.10.21 for Kotlin 2.2.
  User accepts leaving this warning unresolved for now after corrected APK live
  acceptance. Do not suppress it; toolchain alignment is deferred, not a release
  blocker by itself. No startup/RAM improvement is claimed.
- [x] Razr R8 trial rejected: startup crashes at GeckoBundle -> JSONObject.wrap
  (2026-10-16 06:21:02/06:21:04 device logs). Mapping identifies h3.c as bundled
  org.json.JSONObject; runtime dependencyInsight traces old json:20090211 through
  Socket.IO/Engine.IO. That JAR lacks wrap; this is distinct from metadata warning.
- [x] User approves narrow Socket.IO org.json exclusion/rebuild, retaining JVM
  test dependency. Runtime dependencyInsight now reports no org.json:json.
- [x] Rebuilt JSON-excluded APK/mapping verified: no packaged org.json DEX class
  definitions, JSONObject.wrap reference targets platform org.json, signatures/
  alignment pass; runtime JSON absent and JVM-test JSON retained. 101,569,222 bytes.
- [x] User confirms corrected gecko-staging-r8-platform-json.apk works on the
  device (2026-10-16); no agent install/data clearing performed. Separate Kotlin
  metadata warning and unmeasured startup/RAM effects remain.
  Original compression-only APK remains accepted and separately preserved.
- [x] TE2 Termux audit: native .so compression already enabled; old APK confirms
  Deflate libcef/libnode. User approves a separate Termux-staging-only DEX
  compression trial/build, leaving existing R8/CEF data/ordinary Cefrium intact.
- [x] TE2 Termux same-source baseline/candidate: 201,752,643 -> 169,465,787
  bytes (32,286,856 saved, 16.0%). Every extracted ZIP payload hash-identical;
  DEX stored -> Deflate. Signatures/alignment and GitHub-Termux certificate /
  com.termux shared UID verified. Baseline 9m, packaging-only rebuild 36s.
- [x] User closes APK Deflate work as done (2026-10-16), including TE2 Termux
  DEX compression. No agent installation/publication performed; existing CEF
  resource-generation warnings retained.
- [x] Record user direction to reuse the TE2 Termux compression pattern for
  ordinary Cefrium, which shares its base build. This is the selected approach,
  not a claim that Cefrium's currently Termux-guarded DEX switch is already enabled.
- [x] ALS packaging gap confirmed in the compression-test APK: stale October
  APK seed contained wrapper only, not frontend/CSS. Actual served OTA archive
  contains the complete snapshot and hash-matching CSS/fonts.
- [x] User approves shared seed refresh/rebuilt Termux APK plus approval-JS
  inspection. Existing bundler publishes current 444-file seed; rebuilt APK
  verifies all seed hashes and all 148 ALS static files. Signature/alignment and
  12 asset regressions pass. No installation, data clearing or client OTA issued.
- [ ] Live test refreshed-assets APK; same-version local tree requires explicit
  force-update rather than assuming APK update reseeds. New candidate supersedes
  the stale-seed compression test for UI testing; see TERMUX_COMPRESSION_AUDIT.md.
- [x] R2 APK Deflate comparison/implementation closed by user: same-source
  packaging measurements, payload equivalence and signature/alignment evidence
  recorded separately from R8 savings. No exhaustive ABI/page-size or timing
  matrix is implied; final matched release artifact checks remain under R5.
- [x] R3 concrete scope approved/implemented: root palette rn + Enter toggles
  persisted relative line numbers (current state shown), e + Enter opens/focuses
  Explorer; :8:k / :8:j and optional :column provide logical-line relative jumps.
  Explorer arrows/Home/End/Space/Enter reuse click actions, Ctrl+F focuses name
  search, Shift+Tab from first tree row reaches search, first Escape dismisses
  active search and next returns editor focus. Ctrl+Shift+Comma/Period cycles
  displayed file tabs left/right with wrap, missing-file and in-flight guards.
  Sidebar shortcuts beyond existing behavior are not included in this bounded
  user-selected matrix. No Electron/native changes required by source checks.
- [x] R3 source validation: 37 focused frontend tests, 9 backend service tests,
  TypeScript checking, Monaco bootstrap and host builds passed. No native client publication/live acceptance
  implied. Persisted preference needs matching mypyc activation/worker refresh.
- [x] R3 user reports current keyboard slice testing well (2026-10-16) and
  requests commit/push after the inline-diff/input follow-ups. Focused source
  regressions cover the implemented matrix; this is not an exhaustive claim
  across every platform/key layout or final release artifact.
- [x] R3 live follow-up: user observes Go to Line replacing relative gutter
  with absolute numbers. Pinned upstream explicitly does this; approved guarded
  bundle transform removes only that block, preserving preview/accept/cancel
  lifecycle. Root rn/e entries moved after stock entries. Eleven focused tests
  pass, including pinned-source transform guards and root ordering.
- [x] R3 follow-up accepted in current user testing; no additional backend/mypyc
  change is needed for gutter preservation or ordering.
- [x] User-approved inline-diff presentation guard: creation and live preference
  projection convert relative to absolute gutters without mutating saved choice;
  hidden gutters stay hidden and plain recreation reapplies relative choice.
  Seven keyboard tests and TypeScript check pass; host rebuilt, publication separate.
- [x] Cefrium shortcut capture: trusted 229 keydown -> insertText(g) beforeinput/
  input -> 229 keyup -> synthetic Ctrl+G -> editor blur -> quick-input focus.
  User-approved adapter fix claims cancelable armed-Ctrl ASCII insertText before
  textarea mutation, replays existing command in a fenced microtask and consumes
  matching 229 keyup; one-shot Shift yields to this Ctrl transaction. No generic
  letter blacklist, document rollback, terminal changes or Android fork edits.
  Twenty-three focused mobile/keyboard tests pass using actual vendored helper;
  temporary probe disposed and test-only Quick Fix draft cleared with permission.
- [x] User reports early Ctrl-input claim and inline-diff guard testing well and
  approves checkpoint commit/push (2026-10-16). Targeted tests include Ctrl+G,
  Ctrl+Shift+O, ordinary-input bypass and locked Ctrl; exhaustive Gecko/device
  parity remains a final artifact check, not inferred from this live report.
- [x] R4: fix missing automatic editable mypyc artifact selection in bootstrap.
  User error: native Python import FileNotFoundError for domain-a7f57a2.../manifest.json
  after deleting the selected build/pin. Rebuild+activate recovered. Distinguish
  missing auto-selection from explicit selection or corrupted packaged payload.
  A dangling default link now selects interpreted imports without changing it;
  existing broken targets, permission errors and normal explicit selections stay
  strict. User-approved CODE_TE2_FORCE_INTERPRETED=1 deliberately overrides the
  editable domain choice, not the Rust worker; packaged installs reject it.
- [x] R4 source validation: 91 focused native-worker bootstrap, strict packaged
  runtime, bootstrap discovery, local mypyc workflow and binary-identity tests
  pass; bootstrap ty and authored-source whitespace checks pass. Existing
  setuptools wheel FutureWarning remains. Tests cover dangling/malformed/
  explicit/permission cases, force precedence/reset and packaged rejection.
- [x] R4 forced-interpreted startup live accepted by user (2026-10-17).
  Live worker PID 2522732 has CODE_TE2_FORCE_INTERPRETED=1, empty
  CODE_TE2_MYPYC_DIR and no __mypyc library mappings, confirming interpreted
  imports in the same Rust/PyO3 worker. Missing-auto-target behavior is covered
  by regression tests; no live snapshot was deleted to exercise that case.
  User performed the runtime transition; no native/mypyc build or publication
  was needed for this bootstrap change.
- [ ] R4 grouped correctness/test-maintenance slice (user direction 2026-10-17):
  - [ ] Fix terminal profiles Array.isArray narrowing with valid/missing/malformed
    fixtures alongside the other cleanup, not as a standalone slice. Defensive
    extension-manifest bookkeeping only; no VS Code terminal feature work.
  - [ ] Triage stale retired-Python mount and suppressed-preview MRU assertions;
    record known pre-existing failures accurately, without restoring old architecture.
  Combined implementation scope remains subject to investigation/approval;
  grouping alone does not mark any of these fixes implemented.
- [ ] R5: verify cleaned ALS native wheel publication and choose compatible TE2
  pin/locks; preserve already-published FWS 0.2.65 rather than release it twice.
- [ ] R5: fresh target dependency closure, exclusive optional uvloop distributions,
  ordinary CPython/private runtime/native ABI, libarchive.file_reader smoke.
- [ ] R5: matched Linux/Termux wheels (<100,000,000 bytes), assets and staging APKs.
- [ ] R5: Debian and Android fresh-install/version/worker/WBA/console/MCP/app checks.
- [ ] R5: separately approve merge/tag/publication; verify uploaded hashes.

## Acceptance still needing bounded confirmation

These are not blanket unimplemented features. Ask only about cases that remain
relevant after final packaging; do not count unrun stress experiments as bugs.

- [ ] Latest all-client ALS static interception/publication, especially Electron
  and Gecko; Cefrium functional acceptance is already documented.
- [ ] Settings and Archive Manager ordinary-worker/frontend acceptance after
  migration; Archive Create/Add/Test capability gaps are separate deferred work.
- [ ] File Explorer directory-sync zero-input erasure/wake in a fresh terminal.
- [ ] Remaining Code Inspector/major UI/run-profile multi-client/lifecycle checks
  not already covered by explicit owning-document acceptance.
- [ ] Stop _setContext rejection spam and retain console registration after reload;
  source fix exists, but the specific log/lifecycle checks are not separately proven.
- [ ] Final release artifact installation/client matrix; older wheels/APKs cannot
  accept source changes introduced since those artifacts were built.

## Deferred, not part of this release

- ALS framework pipe: mentions editor -> framework -> ALS; file open/project
  changes ALS -> framework -> editor. Exact-client broker ownership and future
  FWS reconnectable UDS compatibility; no editor-presence dependency or fan-out.
- Existing 0.2.355 backend Sidebar IPC retirement beyond the accepted intents.
- Monaco graph reduction/GPU, general refactors/workspace edits, observability
  expansion, native diagnostic tooling and optimization/benchmark experiments.
- Aria 502/stale-shell investigation, socket/event/intent modernization; known
  unresolved behavior is not relabeled accepted/error-free.
- Archive intent/job/context-menu expansion and missing Create/Add/Test handlers.
- Electromux public-host/calculator expansion, exhaustive crash/failure matrices,
  opt-in legacy filesystem cleanup, broader platform/device acceptance.

## Owning plan/tracker index

The listed folders contain PLAN/IMPLEMENTATION_PLAN and TRACKER variants. Keep
technical history there; this checklist determines current release gating.

| Workstream under docs/apps/ | Disposition |
| --- | --- |
| draft_overlay | Accepted; separate pre-existing MRU test triage only |
| monaco_core | Quick Fix/theme/hover accepted; GPU/reduction deferred |
| search_memory | Accepted OOM correction; multiline follow-up tracked above |
| editable_worker_runtime | Startup/build accepted except new missing-artifact case |
| desktop_build_startup | User confirms startup group; implementation complete |
| dependency_trim | Source migration largely complete; compatible pins/clean install remain |
| release_asset_audit | R1/R2 current; old published artifact evidence preserved |
| desktop_deb_packaging | Historical releases; R5 governs new artifacts |
| client_runtime_polish | Historical implementation/acceptance; R5 new package validation |
| editor_loading | Accepted maintenance features; remaining audits/benchmarks deferred |
| sidebar_app_intents | Routing/readiness accepted; ALS composer/navigation smoke accepted; archive/pipe-intent migration deferred |
| terminal_directory_sync | Implemented/committed; specific live erasure case to confirm |
| terminal | Earlier phase acceptance retained; broader multi-client cases verify/defer |
| vsix_explorer_changes | Marketplace accepted in user history; no blanket retry/failure proof |
| major_ui_changes | Source complete; reconcile old live-acceptance markers |
| code_inspector | Source complete; reconcile remaining context-menu/lifecycle cases |
| run_profile_refinements | Source complete; outstanding lifecycle acceptance to confirm |
| multi_model_and_tab_intellegence | Preserve earlier diagnostics acceptance; stress/backlog separate |
| source_control_graph | Implemented history work; broader diagnostics/theme backlog deferred |
| selected_commit_inline_diff | Preserve prior acceptance; extra timing/visual matrices deferred |
| cefrium_mobile_parity | Historical/client work; no broad diagnostics/renderer experiment now |
| gboard-android-ime-fixes | Historical IME ownership; current regression checks in R5 |
| experimental_android_terminal_interface | Experimental backlog, not release gating |
| framework_cleanup_and_ui_vsix | Preserve accepted framework boundary; cleanup/expansion deferred |
| native-js-modal-plan-tracker | Existing controls/history, not a new implementation task |
| backend_native_observability | Future diagnostics/profiling program, not release gating |
| electromux | Accepted TE2 consumer retained; generic-platform backlog deferred |
| pipe_plans-contracts-tracker | Contracts/history; no wholesale new protocol program this release |
| code_te2/OUTSTANDING_ISSUES.md | Startup source fix superseded; terminal-profile fix remains |
| code_te2/*SPRINT_PLAN / VSCODE_API_HARNESS_PLAN / SOME_ISSUES | Historical/user lists; not automatic release blockers |

docs/planning is retained design history, including stateful-window and old CM6
plans. Current app/state authority and the accepted Sidebar matrix supersede old
unchecked design steps. No user tracker is rewritten or cleared by consolidation.

user: for next version tracker:

markdown link syntax ready mentions in te2 and als.  
