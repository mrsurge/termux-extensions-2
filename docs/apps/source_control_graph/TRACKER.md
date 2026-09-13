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

- [x] Start files collapsed, showing file headers and added/deleted line counts;
  expand a header to reveal its diff lines.
- [x] Preserve the tail of long file paths rather than the beginning.
- [x] Use filename-aware vendored file icons (the same Seti resolver as History,
  with a Codicon fallback).
- [x] Investigate stage/commit controls, retaining existing HEAD-only mutation
  guardrails and keeping the History tab read-only.
  Existing `git/footer-utils.ts` owns Stage All/Unstage All/Commit intent and
  historical disablement.
- [x] Add per-file `+` Stage and shared Commit staged changes in By Changes,
  reusing Explorer commands and the shared commit prompt. No hunk staging.
  Historical views disable stage/commit and label Restore explicitly; HEAD
  uses `×`. Existing Restore confirmations remain intact. Commit rejects
  project/comparison changes while its prompt is open.
- [x] Compact By Changes file headers and remove inter-file spacing.
- [x] Align hunk Restore beside its line header; green Stage/Commit and red
  Restore controls. Place By Changes immediately before History (last tab).
- [x] Add left-aligned Expand All beside Commit for the displayed result page;
  open files, hunks and blinds without requesting more results. Highlight active
  literal filter matches in paths/diff text with By Contents `fe-search-hit`
  styling while retaining syntax and intraline diff spans.
- [x] Live acceptance of staging/commit controls and compact headers.
- [x] Preserve real untracked line statistics while suppressing full bodies;
  make bodyless preview headers open the file directly. Stable tracked-first
  ordering is shared by streaming and continuation pages. Modified is `M`;
  untracked is green `A`. Rust and frontend regression coverage added.
- [x] Live acceptance after framework restart of untracked counts/order/navigation.
- [x] Live acceptance of collapsed headers, narrow-screen path tails and file icons.
  Focused renderer tests cover toggle/navigation isolation, counts, icon lookup,
  streaming retention and existing Restore/hunk blinds behavior.

### File Icons

- [x] Fix `.mjs` detection in the shared Seti wrapper so it uses the JavaScript
  SVG and color instead of generic File, including compound and uppercase suffixes.

### Command Palette

Next implementation slice, followed by the spacebar-slide investigation below.

- [x] Provide Ctrl+Shift+P access to Monaco's Command Palette and Ctrl+Shift+O
  access to its existing document-symbol picker. Retain F1 as an existing alias.
- [x] Provide second-row Shift (one-shot), Cmd and Esc mobile controls;
  retain sticky Sel independently and preserve primary/secondary key routing.
  Enter stays on the virtual keyboard; do not duplicate it in the dock.

#### Shift And Palette Input Investigation

- [x] Initial source inspection: `Sel` already toggles sticky Shift in
  `monaco_editor/editor_mobile_special_keys_utils.ts`; the shared synthetic-key
  bridge carries `shiftKey`. The fork's standalone commands action is
  `editor.action.quickCommand`, currently bound to F1 rather than Ctrl+Shift+P.
- [x] Identify the focus conflict: `dispatchMobileEditorKey()` resolves the
  editor textarea and explicitly focuses it before dispatch. Reusing that path
  unchanged would steal focus from the palette's own input.
- [x] Investigate physical/Gboard input plus sticky Ctrl/Shift, including stuck
  composition and 229 events. Distinguish modifier flags used for commands from
  shifted printable text: synthetic key events must not be assumed to perform
  native text insertion, keyboard-layout transformation or IME composition.
- [x] Design Ctrl+Shift+P and the mobile palette button to invoke the existing
  action in the focused editor realm (primary/secondary), not a duplicate palette.
- [x] Route extra-key navigation, selection, Enter/Escape and repeat to the
  active palette when visible; preserve its focus/visible selection and Gboard
  input. Restore normal editor/terminal routing on dismissal. Check whether
  palette commands need its keybinding service or explicit action dispatch.
- [x] Automated coverage for one-shot Shift with Ctrl-byte replay, P/O actions,
  palette focus/caret navigation, committed capitalization, composition bypass,
  and the existing mobile Ctrl/229, sticky Sel, repeat and secondary-routing suite.
- [ ] Live acceptance: ordinary/Gboard typing, one-shot Shift, Ctrl+Shift+P/O,
  palette navigation/Enter/Esc, both working editor realms and terminal focus.
  Historical read-only command restrictions remain unchanged.

Implementation preserves the vendored composition guard. The Ctrl-byte adapter
captures extra-key Shift/Alt before replay; it does not equate sticky Sel with
text/chord Shift. Plain Shift transforms only safely cancellable `insertText`
input via Unicode uppercase, not guessed punctuation mappings or active IME
composition. Revisit broader keyboard-layout behavior only with focused evidence.

Source references: `src/mobile-input/terminal-special-key-bridge.ts`,
`src/mobile-input/editor-special-key-bridge.ts` and
`monaco_editor/editor_mobile_special_keys_utils.ts` under `app/apps/code_te2`;
`worktrees/vscode-te2-diff/src/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.ts`.

### Symbol Index In Code Inspector

This remains in this branch, after Command Palette access and the spacebar-slide
investigation, before wrap-up. It is not deferred.

- [ ] Add a symbol index to the Code Inspector tab/drawer. Start by evaluating
  the existing WBA `vscode.documentSymbols` / `documentSymbols` provider path;
  confirm document-versus-workspace scope before extending the contract.
- [ ] Present symbol names/kinds/hierarchy with navigation to the correct
  document/range. Follow current document/client identity, reject stale responses
  after file/project changes, and reuse existing inspector/navigation lanes.
- [ ] Add an entry to the maintained Monaco touch-extension inspection menu
  that opens the index. Choose a suitable vendored symbol codicon or styled SVG
  during implementation; do not use file-type icons as an assumed symbol catalog.
- [ ] Cover provider-unavailable, empty results, refreshed symbols and mobile
  menu/drawer navigation; live acceptance before closing the branch.

### Themes

Deferred to **WBA And Extension-Provided Themes** under **Deferred Work For A
Follow-Up Branch**. This is not a remaining blocker for this branch.

### Mobile Input

- [ ] After Command Palette access, investigate Android keyboard spacebar-slide
  cursor navigation. Establish what cursor/selection events reach the hidden
  textarea before choosing any source or native changes; preserve composition
  and Ctrl/229 guards. Follow this with the Symbol Index slice, then wrap-up.
- [x] Capture GeckoView textarea/input events and compare with Cefrium. Missing
  intended characters were absent from captured DOM key/input events; no 229 or
  composition events appeared in the explicit 229 capture. The simple typing
  trace retained textarea focus without replacement or programmatic cursor writes.
- [x] Test temporary nonzero/on-screen textarea geometry and bypass the vendored
  Ctrl helper, including focus-time rebindings. Neither resolved the drops;
  overrides were restored. Cefrium registered the comparison input correctly.
Gecko native IME instrumentation is deferred under **Deferred Work For A
Follow-Up Branch**. No root cause or production fix is established; preserve
both renderers' current input paths. It is separate from spacebar-slide navigation.

### Live Search Projection And Scroll Expansion

- [x] Retain a bounded, session-owned By Changes object projection in Python,
  including results not yet revealed by scrolling. Existing file facts update
  affected objects; do not enumerate the whole repository for each file event.
- [x] Apply updates to rendered rows without replacing unrelated DOM, selection,
  expansion or scroll state. Unrendered results are revealed from the latest
  projection, not from stale page snapshots.
- [x] Use one-way append-only scroll expansion ("live Egyptian scroll, out only")
  in both By Changes and By Contents. Trigger before the bottom, serialize load
  requests, retain manual controls for recovery, and stop at retained limits.
  This is not a virtualized two-way window or transcript treadmill.
- [x] Keep full invalidation for comparison/project changes, HEAD movement and
  recovery. Fence late reads by session/project identity and coalesce file facts
  without losing updates received during an in-flight read. No polling.
- [x] Cover unseen-file updates, insertion/removal, repeated events, late results,
  scroll loading and lifecycle cleanup with typed backend/frontend tests.
- [ ] Live acceptance: modify/save/restore a rendered file and an unrevealed
  file, scroll both views, switch comparison/project during work, and verify
  unrelated rows retain expansion and position. Directory-only watcher batches
  and retained-limit overflow require explicit recovery, not guessed deltas.
- Retention is capped at 700 file objects with the existing 256 KiB per-preview
  serialization limit; this is not a measured Python heap/RSS budget. Memory
  introspection remains part of the deferred diagnostics branch.

### Git Action Controls

- [x] Retain real Git +/- statistics for suppressed tracked text previews,
  including oversized lines and whole-file deletions; keep preview/editor limits.
- [x] Live acceptance of large-file counts after framework rebuild/restart.
- [x] Use native file summaries for tracked and untracked pills even when the
  preview body is absent; preview warnings do not invalidate known statistics.
- [x] Right-align tracked +/- totals beside the shown-file count, independently
  of rendered rows. Label untracked additions separately, and incomplete,
  truncated, stale or unavailable projections as partial.
- [x] Match History's dark/blue MRU styling on file headers only. Clicks replace
  the highlighted set; each live delta replaces it with its updated file group,
  retaining selection for rows that are not yet rendered.
- [x] Live acceptance of totals and click/live-batch MRU replacement.

- [x] By Changes offers Stage and commit all when the index is empty, otherwise
  Commit selected (the staged index, not row selection). Sequence the operation
  in the backend; retain HEAD-only and project/comparison guards.
- [x] Add Push/Pull/Fetch controls using styled SVGs inside fe-btn buttons, with
  accessible names and existing confirmation/error handling. Do not use emoji.
- [x] History has separate Refresh and Fetch controls at opposite ends of its
  action row. Fetch updates refs; Refresh only rebuilds the graph projection.
- [ ] Live acceptance of empty-index/staged-index commit labels, stage failures,
  remote controls and History refresh/fetch. No remote mutation was run against
  the user's repository during automated validation.

## Deferred Work For A Follow-Up Branch

### WBA And Extension-Provided Themes

Status: deferred at user request. Existing theme-loading/conversion machinery
is a starting point, not proof of complete VS Code theme compatibility. This
is non-trivial integration work, not a quick additional picker option.

- [ ] Audit the installed-extension theme catalog and resource delivery path.
  Reuse existing WBA/extension metadata and editor preferences rather than adding
  a parallel catalog or treating a theme extension as executable theme code.
- [ ] Inspect the pinned Code Server/VS Code theme services for theme JSON/JSONC,
  relative includes, inheritance, token colors and semantic-token rules. Identify
  which semantics the current TE2 loader/converter already supports and which
  require explicit adaptation; do not assume raw JSON is a resolved theme.
- [ ] Define consistent application to Monaco, TextMate and both working and
  historical secondary editors, including theme changes, missing/uninstalled
  themes and stale asynchronous loads. Keep native OTA/APK asset rules intact.
- [ ] Decide separately whether extension webviews should follow editor themes.
  Their current WBA contract uses a fixed GitHub Dark palette; changing editor
  selection must not silently change that contract or imply whole-shell theming.
- [ ] Add fixture-based compatibility/lifecycle tests before implementation is
  declared complete. No theme implementation or runtime behavior change is
  authorized by this deferred entry.

Starting references: CODE_TE2.md sections 26 (Themes, TextMate palette, and
retokenization) and 44 (UI VSIX); monaco_editor/editor_theme_loader_runtime_utils.ts,
editor_theme_apply_runtime_utils.ts, editor_theme_convert_utils.ts and
editor_textmate_runtime.ts under app/apps/code_te2. Recheck source on resumption.

### Backend And Native Diagnostics

- [ ] Audit project_sidecar.py and related Python modules for legacy LSP symbols
  and no-op paths. Verify callers before removal; do not recreate WBA ownership.
- [ ] Investigate remaining backend scheduling/blocking pain points using bounded
  runtime evidence before changing process or language architecture.
- [ ] Design opt-in Python evaluation/reflection through the existing framework
  control plane, including retained search-session counts and memory diagnostics.
  Distinguish serialized payload size, Python object allocation and process RSS;
  do not report dictionary lengths as memory usage.
- [ ] Consolidate Android reflection and flagged native logging with the deferred
  Gecko IME diagnostics below. Reuse existing console/ADB transport, bound trace
  retention, and keep capture off by default.

These investigations belong to the next branch; no new debug endpoint, Android
implementation, runtime restart or language rewrite is authorized here.


### Deferred Gecko Native IME Diagnostics

Status: deferred at user request. A device restart cleared the problem. The user
reports that cache clearing and force-quitting Gboard or the app did not clear it
while the device remained running. Gboard suggestions flashed/disappeared near
missed input. These observations justify inspecting the Android/Gecko IME boundary,
but do not isolate the fault to Gboard, Gecko, our app, or the system IME service.

- [ ] Design debug-variant console/ADB evaluation or reflection access to the
  live Gecko activity, view, input connection and existing IME filter state.
  Reuse the Android native console worker rather than adding a network listener.
- [ ] Add runtime flags for enabling/disabling bounded trace capture and optional
  print/logcat output; expose snapshot, export and clear operations. Diagnostics
  must remain off by default and avoid per-keystroke console/socket flooding.
- [ ] Trace input-connection creation/replacement/closure, focus transitions,
  restartInput, selection/cursor notifications, batch edits, commit/composition,
  deletion and sendKeyEvent calls, including arguments and returned outcomes.
- [ ] Correlate native records with the textarea probe using connection identity,
  sequence and timestamps. Capture text only through an explicit diagnostic flag.
- [ ] Provide explicit debug actions/flags for controlled IME/filter experiments,
  with reported prior/current state and restoration. Observation alone must not
  restart input, clear composition or otherwise erase the reproducing state.
- [ ] Validate disabled-path overhead, bounded retention, cleanup and debug-only
  exposure. Confirm normal typing and Ctrl/229 handling are unchanged.
- [ ] On recurrence, capture native and DOM evidence before restarting anything;
  compare Cefrium as needed before deciding whether a fix should be Gecko-gated.

Implementation, APK build/install and further live experiments require a separate
approved slice. No native changes are authorized by this deferred plan alone.
