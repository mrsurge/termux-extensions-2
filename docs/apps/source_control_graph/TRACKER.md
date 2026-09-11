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
- [ ] Implement metadata-only graph generation and pagination first; test pinned
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
- [ ] Typed paged graph/ref snapshots with parent IDs and deterministic topology.
- [ ] Progressive statistics, lazy file summaries and bounded historical blob pairs.
- [x] Generation-local statistics producer: one 40-file native page in flight,
  cumulative publication before the next read, bounded/deduplicated retained
  work set, explicit incomplete/error states and late-result fencing.
  Five producer tests plus six transport tests pass; strict Basedpyright clean.
- [x] Connect the producer to an Explorer-owned History session, exact-client
  notifications, HEAD-fact refresh, disconnect and project-switch teardown.
  Open/refresh acknowledge before native reads; more/files/close fence generation.
- [ ] Complete invalidation for non-HEAD branch/tag tips and HEAD disappearance;
  these currently require explicit refresh rather than polling.
- [x] Lazy file-page counts and bounded historical blob pairs through the existing
  History session: first-parent/root comparison, shared rename pairing, explicit
  absent/binary/oversized/encoding states and typed Python decoding. Commit-wide
  stats scheduling is wired; frontend mounting remains pending.
- [x] File/blob checkpoint validation: 14 filtered native tests, six Python tests,
  strict Basedpyright (zero errors/warnings) and whitespace checks pass. Includes
  session detail dispatch and a worktree-content mismatch proving Git blob output.
- [ ] First-parent/root/rename/binary semantics and limits, explicitly represented.
- [ ] Cancellation, stale-generation rejection, bounded caches and event refresh.
- [ ] Rust/Python contract tests and strict typing; measure primary-open interference.

## Phase 3: Second-Window Content Lifecycle

- [ ] Separate content kind from native/drawer presentation mode.
- [ ] Exact-client backend descriptor ownership and own-lane notifications.
- [ ] Generalize mobile pending-open acknowledgements and Electron validated IPC.
- [ ] Preserve drafts/shared membership while replacing secondary working content.
- [ ] Dedicated syntax-only read-only diff boot; no WBA/editing participation.
- [ ] Capability-gate menus/mobile controls; retain copy/find/selection/navigation.
- [ ] Reconnect, project switch, collapse, fullscreen, detach and disposal tests.
- [ ] Record future UI extension integration seam without implementing it.

## Phase 4: Explorer History Tab

- [ ] Integrate upstream-derived graph view beside existing advanced-search tabs.
- [ ] Expand commit headers to file +/- summaries with continuous graph lanes.
- [ ] Stream metadata/stats without waiting for full-history enumeration.
- [ ] Route file clicks to pinned historical diff in second window only.
- [ ] No document bodies or Git mutation controls in the graph tab.

## Phase 5: Acceptance

- [ ] Regression/type/contract tests and bounded performance/memory evidence.
- [ ] Gecko and Cefrium mobile touch/keys/drawer/fullscreen acceptance.
- [ ] Electron local/remote dock/detach and read-only acceptance.
- [ ] Validate unsaved drafts survive replacement and primary editor is untouched.
- [ ] Update technical manual and durable memory with implemented contracts.
- [ ] User live acceptance; commit/push when requested.

Current checkpoint: standalone upstream-derived view foundation is implemented;
it is not mounted/imported by the application entry point yet. The browser tree
constructor is supplied to the host explicitly; production asset wiring remains
part of Phase 4. Native reads, statistics and Explorer backend projection are
implemented. Fifteen Python tests cover transport, producer and connection
lifecycle. Remaining Phase 2 work includes full ref invalidation and performance
acceptance; secondary historical content and frontend mounting follow, not WBA.
No restarts, APK asset publication or version changes.
