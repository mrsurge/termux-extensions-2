# Source Control Graph Tracker

## Planning

- [x] Fetch main/release tags and create `feature/source-control-graph` from `632354d0`.
- [x] Confirm summary-only Explorer tab and second-window historical file diff.
- [x] Inspect actual upstream graph, row renderers, lazy children and open path.
- [x] Pin local code-server VS Code source revision and verify selected SCM files clean.
- [x] Identify exact full-file copy inventory, license and upstream graph tests.
- [x] Trace mobile/Electron path-only secondary contracts and unconditional editing boot.
- [x] Document framework DTO gaps, content ownership and optional future UI VSIX boundary.
- [x] User approval to begin implementation.

## Phase 1: Literal Upstream Vendoring

- [x] Copy complete graph, history types, view pane, CSS, tests and license.
- [x] Record hashes/revision and produce reproducible graph/type/test adaptations
  and patch series; full pane and CSS remain preserved but not integrated.
- [x] Resolve standalone pane import closure with the real base tree and typed
  native adapters, without fake workbench services or a replacement graph.
- [x] Approved bounded base-tree dependency transplant: 164 exact pinned runtime
  inputs plus upstream license, third-party notices and compiler configuration.
  Independent in-memory build verifies every hash and the exact dependency closure.
- [x] Exercise actual upstream CompressibleAsyncDataTree lazy expansion, collapse,
  selection and settled disposal in a DOM test without workbench services.
- [x] Tree checkpoint validation: 15 graph/tree tests, full frontend TypeScript,
  frontend build and tracked whitespace checks pass. No mounted UI or bundle
  payload change yet; dependency checkpoint committed as `1a40d647`.
- [x] Resolve immediate teardown while upstream active-node debounce is pending:
  reproducible source patch uses RunOnceScheduler rather than an unobserved
  Delayer promise. Immediate disposal now passes without a grace timer.
- [x] First pane adaptation patch: file-row renderer retains literal upstream
  lane geometry with typed native filename/count rendering and explicit unknown
  count states. Test row reuse, escaping, disposal and exact geometry retention.
- [x] Adapt commit/ref and load-more rows, data source and outer pane lifecycle.
  The typed constructor boundary is exercised against the actual upstream tree.
- [x] Scope history and generated base-tree CSS; preserve literal upstream originals.
- [x] Test mouse/touch/keyboard routing, cached expansion across stats updates,
  failure/retry and in-flight disposal. Return upstream's refresh cleanup promise
  so native cancellation does not orphan a rejection.
- [x] Standalone pane validation: all 23 graph/tree/pane tests, full frontend
  TypeScript, frontend build and whitespace checks pass. Device acceptance awaits
  the production History-tab integration; no live surface is mounted yet.
- [x] Run retained upstream cases; add SVG and pagination/expanded-row lane tests.
- [x] First graph checkpoint: 11 unchanged upstream test bodies plus SVG
  expanded-row, append-only merge pagination, and hash/patch reproduction tests
  pass (14 total). Browser TypeScript and frontend build pass; no mounted UI yet.

## Phase 2: Framework Reads

- [x] Inspect current Git pipe dispatch, scheduler and Python adapters. Existing
  `git.history` remains the bounded HEAD-menu contract. New reads must use
  `pipe_runtime.call_async`, not the legacy synchronous adapter.
- [x] Implement metadata-only graph generation and pagination first; test pinned
  refs/parent order and traversal cancellation before adding statistics.
- [x] Internal native GraphReader: pinned ref/HEAD metadata, retained revwalk,
  bounded pages, exact parent order, and failure/cancellation invalidation.
  Native topology preparation latency remains to be measured.
- [x] Five native reader tests pass: merge/page equivalence, pinned refs,
  detached/empty history, annotated/non-commit tags and disconnected roots,
  cancellation, input bounds and failed partial-page invalidation.
- [ ] Keep background history/statistics admission separate from interactive
  Git baseline reads; verify cancellation while queued as well as while running.
- [x] Metadata session admission is separate and rejects at four workers rather
  than queueing. Open/next/close Git pipe operations bind owner/root/generation,
  fence offsets, cancel dropped waits and expire abandoned idle workers.
- [x] Strict asynchronous Python session adapter and context-owned cleanup.
  Ten filtered Rust tests (including legacy history), four Python tests and
  Basedpyright pass with zero errors/warnings. Statistics, Explorer event wiring
  and primary-open latency measurements remain pending.
- [x] Typed paged graph/ref snapshots with parent IDs and deterministic topology.
- [x] Progressive statistics, lazy file summaries and bounded historical blob pairs.
- [x] Generation-local statistics producer: one 40-file native page in flight,
  cumulative publication before the next read, bounded/deduplicated retained
  work set, explicit incomplete/error states and late-result fencing.
  Five producer tests plus six transport tests pass; strict Basedpyright clean.
- [x] Connect the producer to an Explorer-owned History session, exact-client
  notifications, native-ref refresh, disconnect and project-switch teardown.
  Open/refresh acknowledge before native reads; more/files/close fence generation.
- [x] Replace the interim HEAD/workspace-fact path with native History metadata
  watches, including linked-worktree/common Git dirs and non-IPC watcher modes.
  Watches precede snapshots; exact-session notifications coalesce bursts and
  handle HEAD/branch/ref changes without comparing stale HEAD state.
- [x] Bound metadata-directory watches and notifications; ignore access/index/
  object/log/lock/worktree noise. Errors/overflow are explicit, not polling.
- [x] Native watcher validation on Termux: 20 filtered Rust tests pass, including
  linked-worktree shared refs, atomic replacement, new directories, early
  invalidation, error/overflow classification and teardown. Seventeen Python
  tests pass; strict Basedpyright reports zero errors/warnings. No live restart.
- [x] Lazy file-page counts and bounded historical blob pairs through the existing
  History session: first-parent/root comparison, shared rename pairing, explicit
  absent/binary/oversized/encoding states and typed Python decoding. Commit-wide
  stats scheduling is wired; frontend mounting remains pending.
- [x] File/blob checkpoint validation: 14 filtered native tests, six Python tests,
  strict Basedpyright (zero errors/warnings) and whitespace checks pass. Includes
  session detail dispatch and a worktree-content mismatch proving Git blob output.
- [x] First-parent/root/rename/binary semantics and limits, explicitly represented.
- [ ] Cancellation, stale-generation rejection, bounded caches and event refresh.
- [ ] Rust/Python contract tests and strict typing; measure primary-open interference.
- [x] Add opt-in read-only native scheduling benchmark and strengthen the
  full-History-capacity baseline-isolation regression. Twenty native tests pass;
  the ignored benchmark was separately run three times. Results and limitations
  are recorded in PERFORMANCE.md; end-to-end primary-open acceptance remains.

## Phase 3: Second-Window Content Lifecycle

- [x] Internal typed backend content-state foundation with bounded exact-client
  slots, immutable historical pairs, latest-request tokens, project-generation
  fencing and close/recreate protection. Eight state-machine tests pass.
- [x] Backend historical commit hook clears only the secondary foreground;
  boot snapshots and foreground facts carry personal content projection. Explicit
  close/project switch clear it, while older queued facts cannot erase it.
  Six integration tests plus eleven existing recents tests pass; strict typing
  is clean. Existing atomic edit persistence is reused, without a save/flush step.
  The History openFile handoff now calls this hook. End-to-end WBA facade
  disposal acceptance remains pending.
- [x] Standalone historical diff renderer and strict content decoder. Immutable
  non-file model URIs, read-only controls, unavailable-file states and abort/dispose
  cleanup have ten focused tests; six existing graph-pane tests also pass.
  Full frontend typecheck/build pass. The component is not mounted: isolated
  realm boot, lexical provider wiring and live content switching remain pending.
- [x] Separate content kind from native/drawer presentation mode.
- [x] Exact-client backend descriptor ownership and own-lane notifications.
- [x] Generalize mobile pending-open acknowledgements and Electron validated IPC.
  History openFile resolves a native row and creates a bounded one-use ticket;
  exact-primary notification/native command leads to secondary-owned redemption.
  Reload waits for presentation command completion. Working paths and historical
  content remain distinct; no WBA readiness gate for immutable views. Python
  suite: 36 passing tests; Electron typecheck/compile and 100 tests pass. Frontend
  typecheck/build and 30 focused tests pass. Native live acceptance remains.
- [x] Preserve drafts/shared membership while replacing secondary working content
  (mobile live acceptance passed; desktop verification remains below).
- [x] Dedicated syntax-only read-only diff boot; no WBA/editing participation.
- [x] Add standalone fresh-realm syntax bootstrap: basic/Monarch language
  contributions only, editor-worker allowlist, Gecko worker transport reuse,
  stylesheet readiness/retry and language detection. Four focused stubbed boot
  tests pass (14 with renderer tests). Generated bootstrap rebuilt from source.
  Host mounting and actual browser/network acceptance are still pending.
- [x] Resolve working/history realm-switch strategy: approved secondary-only
  page reload on content-kind changes; historical revisions reuse the realm.
- [x] Connect secondary host boot/foreground snapshots to the historical renderer.
  Abortable lifecycle, duplicate snapshot reuse, stale snapshot fencing, cold-boot
  fact reconciliation and working-action gates are implemented. Six lifecycle
  tests pass (20 with renderer/bootstrap tests). Native presentation metadata,
  read-only mobile controls and user-triggered activation remain pending.
- [x] Capability-gate menus/mobile controls; retain copy/find/selection/navigation.
- [x] Add separate validated mobile content-population metadata, without fake
  working paths. Read-only menus expose Find/Copy; special keys support cursor,
  Shift-selection, Find/Copy/Select All and document bounds through an explicit
  allowlist. Diff-side focus survives menu focus. Electron content IPC, touch
  handles, and actual History activation remain pending.
  Thirty focused tests and the full frontend typecheck/build pass. Browser/native
  acceptance remains pending; Android assets and source were not changed.
- [x] Mobile reconnect, project switch, collapse, fullscreen and disposal acceptance.
- [ ] Desktop reconnect, project switch, dock/detach and disposal acceptance.
- [ ] Record future UI extension integration seam without implementing it.

## Phase 4: Explorer History Tab

- [x] Integrate upstream-derived graph view beside existing advanced-search tabs.
- [x] Expand commit headers to file +/- summaries with continuous graph lanes.
- [x] Stream metadata/stats without waiting for full-history enumeration.
- [x] Route file clicks to pinned historical diff in second window only.
- [x] No document bodies or Git mutation controls in the graph tab.
- [x] Generation-fenced controller handles early notifications, reconnect,
  replacement and disposal during open. Production builds the verified upstream
  tree into host.js/host.css. Twenty focused tests, full typecheck and build pass.
  Current bounds: 500 commits, 500 files per expansion, 2,000 indexed summaries.
  Source integration is complete; device/live acceptance remains Phase 5.

## Phase 5: Acceptance

User live acceptance is complete for GeckoView and Cefrium, including historical
editor continuity. Desktop has not yet been tested. Earlier implementation
checkpoint notes saying mobile acceptance was pending are superseded by this
acceptance record; they are not outstanding mobile blockers.

- [x] Resolve upstream/base reference roles natively using VS Code precedence:
  configured remote base, bounded creation-reflog evidence, then remote symbolic
  HEAD. Pin roles to captured refs and include them in snapshot identity; no Git
  configuration writes or ancestry changes. Typed Python/frontends validate and
  project current/upstream/base colors into the existing upstream graph.
  Repository config/worktree config and exact role reflogs invalidate snapshots;
  external/global included config changes require explicit Refresh.
  Validation: 32 native History tests passed (opt-in benchmark skipped), 22
  Python tests and 39 frontend tests passed. TypeScript, strict Basedpyright,
  frontend build and formatting pass. Framework restart/live acceptance pending.

- [x] Compact commit headers now show named local heads and grouped remote/tag
  badges with upstream lane colors; active local refs force the active lane color.
  Commit totals move to a mobile-UA expansion child with horizontally scrollable
  full ref names, or a desktop dynamic hover/focus panel. File counts are unchanged.
  Live totals rerender without new file reads; desktop hover does not expand.
  Source comments and reproducible upstream patch 0007 record the adaptation.
  Thirty-nine focused tests, frontend typecheck/build and patch reproduction pass.
  Native/device live acceptance remains pending.

- [x] Follow up multi-ref ordering: seed captured tips by committer date rather
  than OID order, retaining pure topological traversal. Full branches/remotes/tags
  500-commit comparison matches Git; add stale-branch/current-feature regression.
  All seven native graph tests pass. Live framework restart/acceptance pending.

- [x] Tighten count columns using the actual 10px pill font and exact box spacing.
  Idle expiry now refreshes once when visible, deferring to visibility events
  while backgrounded/offscreen and leaving failed refreshes explicit.
- [x] Match VS Code's Git `--topo-order` convention by dropping libgit2 TIME
  sorting. Read-only 500-commit HEAD comparison matches Git; native paged
  interleaved-date regression added. New live acceptance remains pending.
  Six native graph tests, nine controller tests and ten pane tests pass;
  frontend typecheck/build and native formatting pass. No runtime restart.

- [x] Compact count pills to 16px inside unchanged 22px rows, with matching
  green/red text-color borders; Refresh History uses the selected-row dark gray.

- [x] Second live refinement: 12px History type, dark selection fill with a 2px
  inset blue border, filename-aware vendored icons with recycled-row fencing,
  and partial numeric totals rather than commit-wide Unavailable. Native count
  budget is independently bounded at 16 MiB per side; previews retain 375 KiB.
  Six native file tests and 33 frontend tests pass; TypeScript passes. Live
  device acceptance remains pending after framework/frontend refresh.

- [x] First live refinement: remove twisty/workbench offsets, align graph origins,
  add native added-file status, Codicons, aligned numeric pills and local selection
  styling. Prefetch history three rows before the bottom through upstream scroll
  events with single-flight/advancement fences. New device acceptance pending.
- [x] Fix restored-project generation for historical file handoff. Publish native
  idle expiry and stop stale statistics/rows instead of leaving dead file actions.
  Six native session tests and 18 Python tests pass; strict Basedpyright is clean.
  Twenty-three frontend tests, TypeScript, frontend build and upstream patch
  reproduction pass. Native formatting is clean; no runtime restart was performed.
  Comments document the affected ownership/lifecycle/layout systems.

- [ ] Regression/type/contract tests and bounded performance/memory evidence.
- [x] Gecko and Cefrium mobile touch/keys/drawer/fullscreen acceptance.
- [ ] Electron local/remote dock/detach and read-only acceptance.
- [x] Mobile: unsaved drafts survive replacement and primary editor is untouched.
- [ ] Desktop: unsaved drafts survive replacement and primary editor is untouched.
- [x] Update technical manual and durable memory with implemented contracts.
- [x] User mobile live acceptance; approved for checkpoint commit/push.
- [ ] User desktop live acceptance.

## Historical Editor Continuity

- [x] Inherit font size/family, theme, line numbers and wrapping from host preferences.
- [x] Apply live preference facts and fence stale theme loads/snapshot replies.
- [x] Add source-level `historicalReadOnly` touch mode with Copy, Select Word,
  Select All, Find and Close; no editing tools or custom editing islands.
- [x] Attach mobile-UA helpers to both diff controls with control-owned disposal;
  preserve working menus, syntax-only isolation and existing special keys.
- [x] Rebuild/publish touch UMD and production frontend bundle; 29 focused tests
  and frontend typecheck pass. No VS Code/Monaco compilation was needed.
- [x] GeckoView/Cefrium live acceptance: initial/live fonts and themes, selection
  handles, Copy/Find, historical replacement/disposal and unchanged working-editor
  behavior.
- [ ] Desktop appearance, Copy/Find and historical replacement/disposal acceptance.

Historical editor continuity and graph presentation are mobile live-accepted and
approved for checkpoint publication. Desktop acceptance and remaining performance
evidence stay open. Native timing evidence is recorded in PERFORMANCE.md.
History is not a WBA feature.
No restarts, APK asset publication or version changes.

## Follow-Up Refinements

User-requested candidates for this branch. Investigate and scope each slice before
implementation; this list does not mark the features as implemented or require
every candidate to ship together.

### By Changes Presentation And Actions

- [ ] Start files collapsed, showing file headers and added/deleted line counts;
  expand a header to reveal its diff lines.
- [ ] Preserve the tail of long file paths rather than the beginning.
- [ ] Use filename-aware vendored Codicons.
- [ ] Investigate stage/commit controls, retaining existing HEAD-only mutation
  guardrails and keeping the History tab read-only.

### File Icons

- [ ] Fix `.mjs` detection so it uses the JavaScript icon instead of generic File.

### Command Palette

- [ ] Provide keyboard-shortcut access.
- [ ] Provide an extra-key control for mobile access.

### Themes

- [ ] Investigate WBA/extension-provided themes and their editor integration.

### Mobile Input

- [ ] Investigate Android keyboard spacebar-slide cursor navigation.
- [ ] Install a focused probe for GeckoView-specific typing jank: missed keys
  and erratic cursor placement. Cefrium is not exhibiting the reported behavior;
  preserve its working input path while identifying the Gecko-specific cause.
