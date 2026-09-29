# Client Runtime Polish Tracker

Plan: [PLAN.md](PLAN.md). Baseline: published TE2 0.2.351.
Working branch: `feature/desktop-deb-packaging`; no new branch needed for planning.

## Planning

- [x] Record the three requested workstreams and initial source entry points.
- [x] Separate verified source observations from unconfirmed bug explanations.
- [x] Capture the original persistence proposal; superseded below after the
  reconciliation fix passed live acceptance.

## Color picker

- [ ] Trace normal-hover versus color-discovery/presentation flow end to end.
- [x] Investigate the document selector argument and existing provider waits.
- [ ] Capture cold/warm local/remote timings with bounded instrumentation.
- [x] Implement the evidenced generic fix; user reports live acceptance on all clients.

### First correction — provider selection

The frontend aggregated color provider sends no explicit provider handle for
presentations. WBA passed a language string to the document-aware registry,
which rejects it for missing languageId/path, then exhausted its five-second
discovery wait. Normal hover and document-color discovery already pass the full
document descriptor. Presentations now do likewise, preserving scheme/path
matching and all eligible providers without a language-specific workaround.

Rebuilt WBA output; five focused tests passed, including real-registry color
presentation dispatch for file and vscode-remote schemes with nonmatching
providers excluded and no discovery wait. Code TE2 typecheck and build passed.
The separate full WBA tsc invocation remains red on module resolution and other
errors outside this change; do not report it as passing.

User live acceptance: all clients passed. The initially reported consecutive-hover
delay was affected by a connection issue in the test environment, not a confirmed
failure of this correction. No numerical timing claims are made. Further timing
analysis and investigation of discovery's extra full-text didChange acknowledgement
are deferred unless fresh evidence warrants them. This correction changes only
the server-side WBA payload; no native asset publication is needed for the fix.

## Sidebar identity and preferences

### First correction — live membership is not durable preference authority

Source investigation found concurrent primary-view activation publishing each
individual view's snapshot as complete. Python could remove not-yet-created views,
then frontend reconciliation discarded their hidden/order settings. Persistent
contributed-view IDs are already deterministic; console IDs additionally contain
a separate window identity, so their length alone does not establish identity churn.

Implemented `membershipComplete` on WBA snapshots: activation progress upserts
immediately without pruning; completion permits live-membership removal. Session
reset remains non-authoritative. Frontend reconciliation retains order/mode for
absent persistent contributed views, but projects only live slots and clears stale
foreground/mention targets. Disposable panel/run-target removal is unchanged.
Storage migration, shortened IDs and expiry were subsequently cancelled by the
user; retain the existing client-local stores.

Validation: 26 focused JS tests and 12 Python tests passed; Code TE2 typecheck and
frontend/WBA build passed. User reports the correction working and live-accepted.
The agent did not restart the shared runtime, perform native OTA, edit Android,
bump versions or publish a release during implementation.

- [x] Trace and correct the source-backed preference-loss path.
- [x] Retain regression tests and record user live acceptance.
- [x] Close this workstream with existing client-local persistence retained.

Cancelled, not implemented: backend config migration, new boot projection,
compact-ID redesign, last-access tracking and 14-day expiry. Preserve asynchronous
Sidebar loading; no additional startup redesign without new evidence.

## Cefrium zoom

- [ ] Classify the live zoom gesture and affected browser surfaces/devices.
- [ ] Inspect pinned API and suppression lifecycle/recreation paths.
- [ ] Implement only the confirmed correction, if required.
- [ ] Build/bundle and live-test Motorola and Pixel with verified client assets.

## Cefrium CDP worker recovery and debugging documentation

- [x] Isolate missing diff computation to a paused worker using page-console probes.
- [x] Discover native CDP port, forward through ADB, and inspect the exact worker.
- [x] Confirm causality: targeted debugger resume restores the existing diff.
- [x] Correct inspector child-session routing separately from native monitors.
- [x] Pass three routing unit tests; build minified staging with current assets.
- [x] Install on Motorola; classic/module probes start and two diff hunks compute
  with DevTools connected. User reports live success.
- [x] Record the investigation sequence, cleanup and evidence limits in PLAN.md.
- [ ] Publish the reusable runbook in CODE_TE2.md and link it from repo memory.
- [ ] Locate/update canonical developer instructions (devins) with that workflow.
- [ ] Validate the published runbook from fresh endpoint discovery through cleanup.
- [ ] Diagnose the separate unexpected renderer/page reload. Current incident:
  page navigation reports reload at device time 2026-09-26 22:27:36; toast records
  surround it, but no retained current termination status or crash cause is proven.

## Release artifact reuse

- [x] Preliminary source inspection of Linux wheel injection, runtime provenance,
  native build info, bootstrap fingerprints and Termux version coupling.
- [x] Record proposed separate package/native identities and fail-closed reuse.
- [x] Define wheel/install-script-first publication and independent optional APK
  releases, with separately tracked native, bundled and OTA asset identities.
- [ ] Audit complete native inputs, protocol compatibility and version consumers.
- [x] Select release-family numbering: native `0.2.352`, reuse releases
  `0.2.352.1`, `.2`, then a new native family such as `0.2.353`.
- [ ] Audit version consumers and define provenance migration for that scheme.
- [ ] Define native/asset compatibility and APK resolution for wheel-only releases;
  audit latest/download links and existing Electron upgrade/materialization.
- [ ] Publish portable native artifact manifests and add verified reuse selection.
- [ ] Prove frontend-only packaging needs no Cargo; cover invalid reuse tests.
- [ ] Validate reused binaries through Debian/Termux fresh install and upgrade.
- [ ] Validate old-APK OTA, incompatible/failed OTA handling and fresh APK discovery
  when the newest release publishes only updated Python/frontend artifacts.

## mypyc / Pixel performance

- [x] Capture exploratory desktop JIT on/off and warmed Pixel startup timings;
  verify JIT state inside each live worker, not just its launch environment.
- [x] Record source/interpreter differences and the limits of those comparisons.
- [x] Synchronize Pixel editable source to `3e7debd3` and mirror the plan/tracker;
  preserve `apply_patch.py` and leave the running worker untouched.
- [x] Identify and approve an isolated guarded import profiling entrypoint.
- [x] Collect three source-matched isolated import samples on Pixel; record
  instrumentation, empty-state and bytecode-cache caveats separately from live startup.
- [x] Audit and select runner_profiles as the single-module workflow pilot.
- [x] Obtain approval and build the isolated native pilot using existing Pixel tools;
  no dependency install or replacement of the live editable installation.
- [x] Compare 12 imports per variant/condition with valid interpreted bytecode;
  focused behavior checks pass, no meaningful import-speed improvement found.
- [x] Select/audit the five-module Git/history/pipe group and obtain build approval.
- [x] Build the group in Pixel scratch; record exception/async-generator adapters
  and the runtime msgspec annotation failure. Correctness gate failed; no group
  timing claim or live deployment.
- [x] Approve/test a revised boundary keeping runtime-inspected schemas interpreted;
  four compiled modules pass focused Git/history/pipe checks.
- [x] Measure the revised group with 12 imports per variant/condition: about 6 ms
  median reduction, overlapping ranges; no whole-worker speedup claim.
- [ ] Run broader integration parity and whole-import/startup measurements for that group.
- [ ] Decide whether measured benefit warrants expansion and wheel integration.
- [ ] Investigate search benchmark lockup separately; no unrestricted rerun.

## Portable persistence boundary

- [x] Record shared byte storage, replaceable codec/schema and DTO contracts;
  domain stores retain migrations and state authority. Planning only.
- [ ] Inventory JSON file consumers and existing format, corruption, concurrency
  and hash-sensitive serialization contracts.
- [x] Audit registry/preferences read/write/recovery contracts and their separate
  intelligence-state dependency; broader consumer inventory remains pending.
- [x] Add bounded isolated persistence probe; compare actual Pixel fixture JSON/
  msgspec stages and current store loads across three fresh processes.
- [x] Verify fixture decoder parity and encode round trips; ten local probe/guard
  tests pass. Registry decoding was not faster; no live files changed or restart.
- [ ] Count repeated persistence loads during full startup and measure aggregate
  initialization/migration costs; single-file timings do not explain the delay.
- [x] Count guarded backend-import reads: preferences/intelligence once each,
  registry zero; JSON decoding under 1 ms. Later client/lifecycle phases excluded.
- [x] Trace duplicate preference reads in one boot snapshot and independent
  registry reads in TextMate/theme paths; runtime frequencies remain unmeasured.
- [x] Attribute compilation: 88 stale repo pyc files cause 415–431 ms explicit
  source compilation in the guarded probe; scratch-seeded caches remove it.
  Generated attrs/annotation compilation remains (~35–39 ms). No live-cache edits.
- [ ] Use cache-normalized profiles for subsequent dependency/module attribution;
  verify live bytecode policy separately before claiming a production issue.
- [ ] Measure read/decode/validation-migration/construction stages and total startup
  on representative scratch data; distinguish import overhead from file parsing.
- [ ] Approve an extension-registry plus preference-store pilot comparing the
  existing JSON path with msgspec, without changing on-disk contracts.
- [ ] Validate DTO/codec independence, round trips, migrations, error behavior,
  atomic writes and concurrency before performance acceptance.
- [ ] Review evidence before broader rollout or Rust/PyO3 replacement.

## First-document readiness

- [x] Establish `feature/code-te2-native-services`; committed snapshot `3e7debd3`
  is on main. Uncommitted investigation work was preserved, not published.
- [x] Prioritize document/theme/syntax readiness separately from listener and WBA
  readiness; record terminal/run-profile deferral as a distinct workstream.
- [ ] Map the critical import/lifecycle graph and capture first-highlighted-paint
  plus intelligence timings with valid caches and installed-wheel baselines.
- [ ] Audit terminal-stack lazy loading, including Pyte, FWS and restored sessions;
  preserve no-PTY behavior for non-terminal drawer use.
- [x] Audit gateway -> terminal backend -> Pyte import and existing lazy shellspec
  launch. Retain FWS process ownership; WBA/watcher eager imports remain.
- [x] Implement approved parser-only deferral with off-loop initial construction,
  single publication, propagated failure and retry; no frontend/runtime restart.
- [x] Validate 48 terminal/projection/transport/lifecycle and profiling-guard tests,
  including isolated gateway import, concurrent first use and cancelled first use.
  Both changed production modules pass basedpyright; diff whitespace check passes.
- [ ] Live-validate deferred terminal first use and restoration; measure startup
  and first-use cost before claiming a speedup.
- [ ] Audit run-profile lazy loading while retaining required active-profile/proxy
  reconciliation before restored surfaces navigate.
- [x] Inspect run-profile launch/import and startup snapshot ownership: manager/
  orchestrator and HTTP readiness imports already lazy; shared FWS snapshot must
  retain active-route and terminal restoration. No blanket deferral implemented.
- [ ] Approve a concrete deferral slice with single-flight/error/shutdown semantics.
- [ ] Validate first paint, deferred first use, primary/secondary clients, remote
  reconnect and active terminal/profile restoration without polling.

## Native transport / editor services

- [x] Record Socketioxide/PyO3 and worker-local Axum shell as optional objectives
  after mypyc; superseded by the intended staged native-worker direction below.
- [x] Record the intended disk DTO -> pipe inventory -> native worker shell ->
  dependency removal sequence. Documentation approval is not blanket code approval.
- [ ] Specify and implement the approved disk DTO boundary before broad I/O migration.
- [x] Extract shared persistence byte I/O and JSON conversion for preferences,
  registry and intelligence state; retain store-owned schema/DTO policy, locks,
  migration and recovery. Remaining filesystem consumers are not migrated.
- [x] Validate 94 focused persistence/intelligence/registry/TextMate/path/terminal
  and profiling-guard tests. Typecheck: new boundary clean; existing contextmanager Iterator
  deprecation error and three preferences warnings remain. No runtime restart.
- [x] Pixel live acceptance confirmed after checkout of `061f7890`, covering the
  persistence and outbound transport slices. Earlier acceptance statements were
  clarified by the user: the Pixel had not yet received those changes then.
- [x] Inventory framework pipe and WBA control FD/framing/ownership separately;
  see PIPE_BOUNDARY_INVENTORY.md for current contracts and uncovered bound/deadline
  differences. Investigation only, not transport implementation.
- [ ] Inspect Ferrous Rust reuse and remaining Python framework-shells callers;
  distinguish process-control contracts from WBA application DTOs.
- [x] Verify native byte-write/subscription/shellspec APIs and enumerate Python
  FWS callers. Cross-process live-handle ownership remains a design gate.
- [x] Clarify startup/import reduction as the objective; Axum complements
  Socketioxide, not a presumed Uvicorn/networking bottleneck.
- [x] Record optional pipe/file codec ownership in Rust and direct PyO3 value
  handoff; external MessagePack remains, and dependency removal needs a full audit.
- [ ] Measure removable Socket.IO import costs and inventory all remaining uses;
  keep transport hot-path measurements as a separate regression baseline.
- [ ] Specify transport-neutral service, lifecycle and bounded async bridge contracts.
- [x] Draft native handoff contract and proof sequence in NATIVE_WORKER_HANDOFF.md:
  preserve serial legacy dispatch, separate reply resolution, Python loop ownership,
  proposed count/byte budgets and teardown. Implementation/ABI parity still pending.
- [ ] Separate structural pipe DTO imports from codecs; preserve public names,
  wire validation and errors before introducing a native harness.
- [x] Extract outbound EnvelopeTransport/stdio adapter without changing public
  calls, request correlation, notification or dispatch ownership. Inbound worker
  decode/debug admission remains separate; no Rust or WBA migration performed.
- [x] Validate 36 pipe/WBA/worker bootstrap tests, including cancellation, late/
  duplicate replies, close, write failure, identity and serialized frames.
  Both changed production modules typecheck clean; Pixel live acceptance now
  confirmed at `061f7890`.
- [x] Extract decoded-envelope router with injected response/notification,
  ordinary-dispatch/reply and existing debug-admission callbacks. Reader retains
  framing/schema validation and EOF/error shutdown; no new queue or retry.
- [x] Validate 57 pipe/worker/debug tests; update two older debug test fixtures
  that patched the removed private writer field. New router typechecks clean;
  app_worker retains one pre-existing asynccontextmanager annotation warning.
- [x] Pixel live acceptance for the inbound slice confirmed by user after pulling
  the publication through `c499e2aa` (includes `0b557949`).
- [x] Separate structural pipe DTOs and response builders into `pipe_dto.py`;
  `pipe_protocol` retains public aliases/lazy codec entrypoints. msgspec remains;
  structural imports no longer load messagepack_stream/msgpack.
- [x] Validate 75 codec/pipe/worker/debug tests, including import isolation, public
  class identity, byte parity and invalid-envelope error parity. All three
  DTO/protocol/codec modules typecheck clean. User elected to batch subsequent
  acceptance around the native vertical slice, not manually test each extraction.
- [x] Implement independent `framework/native_editor_worker` crate: embedded
  Python fixture service, bounded native MessagePack I/O, direct value conversion,
  independent nested-call reply path, overload/error/EOF/deadline handling.
- [x] Linux debug/release builds; 4 Rust unit tests and 91 Python tests (16 native
  subprocess + 75 existing boundary/worker tests) pass. Rust fmt passes; clippy
  unavailable. Production manifest/build/launch untouched; no runtime restart.
- [x] Commit/push the vertical slice and run the initial Pixel system-Python
  build/test attempt; full parity and editor startup benefit remain unproven.
- [x] Prototype published as `af040ed9`; user built on Pixel with system Python
  `/data/data/com.termux/files/usr/bin/python`. 15/16 tests passed; truncated EOF
  sometimes returned success because sender-drop preceded reader failure status.
- [x] Fix reader terminal ordering: borrow sender during decode, retain ownership
  through error/EOF publication and pending cleanup, then disconnect queue.
  Local system-Python `.jitenv` validation: 5 Rust tests + 17 subprocess tests,
  including deterministic blocked-cleanup ordering and 30 repeated EOF failures.
- [x] Checkpoint EOF correction as `638f62b8`; user waived Pixel rerun, not an
  observed device pass.
- [x] User approved actual branch-default shellspec cutover instead of another
  one-lane fixture: Hyper/Socketioxide owns HTTP/sockets, PyO3 hosts the real
  Python domain loop, Rust owns framework pipe bytes. No shared runtime restart.
- [x] Audit remaining imports: namespace bases and FWS AsyncClient retain Python
  Socket.IO; domain/frontend codecs and persistence I/O remain. No full removal claim.
- [x] Real isolated native-worker tests cover HTTP resources/containment, health,
  polling and WebSocket binary host RPC, preference updates, editor/Explorer
  connect/error delivery, missing-codec refusal and legacy mount upgrades.
  Engineioxide 0.17.3 waiting-poll binary batching bug requires locked 0.17.7.
- [x] Final Linux checkpoint validation: 89 Python/integration tests, 8 Rust unit
  tests, release build, Cargo fmt and two-module basedpyright pass. Real-worker
  coverage includes CORS preflight and fatal truncated pipe input. Tests use the
  current release binaries; no live shared runtime restart or speedup claim.
- [x] User confirmed Pixel live acceptance of the actual worker at `8e46ae91`.
  Source-only Cargo build instructions remain in framework/native_editor_worker/README.md.
- [x] Approved next slice: move frontend RPC payload codecs for editor, Explorer
  and host into Rust; Python receives/returns DTOs and retains JSON-RPC validation.
  No changes to Sidebar, terminal, direct WBA or WBA control-pipe codecs.
- [x] Codec cutover validation: 162 Python/integration tests (plus 3 subtests),
  11 Rust unit tests, release build and Cargo fmt pass. Actual native workers
  cover all three RPC lanes over polling/WebSocket, invalid payload recovery
  and unchanged Sidebar structured replies. No shared runtime restart.
  Metrics-enabled native integration rerun: 14 passed. Expanded Python typecheck
  reports the existing adapter_lifecycle_events → ui_ipc_ws →
  workbench_adapter_shell_manager import cycle (all three edges exist at HEAD),
  plus 7 warnings; no clean full-typecheck claim.
- [x] Pixel live acceptance of frontend RPC codec checkpoint `72e0b13b`: user
  reports it builds and runs with no observed live errors.
- [x] Establish coherent goal and sequencing in PLAN.md §6: native I/O perimeter,
  external-import reduction, cohesive mypyc domain compilation, then msgspec exit.
- [ ] Complete remaining native I/O boundaries and inventory retained external
  Python imports; preserve domain authority and existing framework services.
- [x] Implement approved persistence byte seam in Rust/PyO3 before domain startup;
  preserve store JSON/locks/policy, atomic replacement, cleanup and permissions.
  Interpreted reference remains; native failures never trigger Python retries.
- [x] Persistence automated validation: 172 Python/integration tests plus 3
  subtests, 15 Rust tests, release build and three-module Python typecheck pass.
  Rust tests cover replacement cleanup, private/existing permissions and Python
  exception/errno mapping; real-worker RPC tests verify preference bytes on disk.
- [x] Pixel live acceptance of native persistence byte slice and History repair
  at `0018e3ce`: user reports everything looks good and live acceptance passes.
- [x] Investigate Pixel History regression: native outbound conversion rejected
  tuple fields retained by History dataclass projections. Pixel logs confirm
  unsupported-service-value failures; this desktop was still running the Python
  site-package worker, explaining its unaffected behavior. Restore generic tuple
  array conversion, not a History-only workaround. Real History snapshot/page
  tests reproduce the pre-fix failure over both polling and WebSocket.
  After repair: 33 native-worker integration tests, 17 Rust tests, release build,
  Cargo formatting and diff checks pass; coverage includes History file replies.
- [x] Pixel live acceptance of History tuple-conversion repair (see above).
- [x] Approved next slice: replace Python Socket.IO server namespace inheritance
  across all five lanes with typed local native-server adapters; keep domain
  handlers/auth/rooms and the outbound FWS client unchanged.
- [x] Namespace-adapter automated validation: 177 Python/integration tests plus
  3 subtests; additional terminal/namespace selection passes 29 tests. Five-module
  adapter/lane/gateway typecheck is clean; including terminal_backend has zero
  errors and 34 warnings in that module. Native binary is unchanged. No live
  runtime restart or full Socket.IO dependency-removal claim.
- [ ] Pixel live acceptance of namespace-adapter slice.
- [ ] Compile the remaining connected local domain graph with mypyc and verify
  interpreted/compiled parity, Pixel behavior and total startup/runtime costs.
- [ ] After those stages, replace remaining msgspec codec/Struct/validation uses
  explicitly; prove production import removal without weakening input checks.
- [ ] Integrate native worker into packaged/build bootstrap only after parity.
- [ ] Verify Python Socket.IO imports are actually eliminated before claiming
  startup savings; include native initialization costs in the comparison.
- [ ] Review native-worker milestones against parity/startup evidence before
  expanding; retain Python authority and separate-worker crash isolation.

## Completion

### Worker-local Ferrous intelligence slice

- [x] Keep `code-te2-worker` independent; install its worker-local native shell
  adapter before Python domain initialization. Migrate WBA/code-server only.
- [x] Reuse shellspecs, target matching/adoption and domain readiness. Native
  binary writes retain Python MessagePack framing/correlation without reparsing.
- [x] Single-flight cancelable stdout readers and Rust code-server log draining
  after readiness; persisted records do not grant live pipe ownership. Exact
  child PID-tree shutdown avoids group termination; shared runtime untouched.
- [x] Automated checks: 16 Rust worker tests (including five real-child Ferrous
  tests), 39 targeted Python tests, 18 isolated real-worker socket/startup tests;
  optimized build and formatting pass. Four-module typecheck clean; including
  WBA has zero errors and its 14 existing warnings.
- [x] User live acceptance of intelligence slice `51ebe765`.
- [x] Next approved slice implemented: run-profile/page-preview/watchexec use
  the same worker-local manager. Readiness consumes bounded pipe output instead
  of whole-log polling; logs drain natively afterward. Watcher JSON event policy
  stays Python-owned with bounded newline framing and serialized replacement.
- [x] Auxiliary slice automated validation: 19 Rust worker tests, 95 Python tests
  plus 7 subtests, 18 isolated worker integration tests; optimized build, Cargo
  formatting, five-module typecheck and diff whitespace checks pass.
- [x] User live acceptance of auxiliary slice `1ffdbb94`: run-profile launch/reuse/restart/stop,
  page preview readiness/proxy/logs, and watchexec events/project replacement.
- [x] Outbound FWS observer transport moved to Rust; domain facts and effects
  stay Python-owned. Generations, bounded queues/pending calls, reconnect snapshot
  ordering and shutdown fencing cover the native-to-domain handoff.
- [x] Fresh main-module import blocks socketio/engineio/aiohttp/framework_shells.
  This is import-path evidence, not whole-feature dependency elimination or a
  measured startup improvement. msgspec and remaining disk/HTTP work stay pending.
- [ ] Pixel live acceptance of native FWS observation: run-profile lifecycle,
  drawer output/list/close, reconnect and worker shutdown.
- [x] Observer validation: 25 Rust tests; 127 selected Python tests plus 7 subtests; 20 real
  worker tests; five changed/new Python files typecheck without warnings.
  Native transport tests cover actual Socket.IO snapshots/ACKs/events/reconnect,
  stale generations, queue/byte overflow, pending-call rejection and shutdown.
  Optimized worker build and Cargo formatting pass. No shared runtime restart.
- [x] WBA control-pipe MessagePack records now have a per-subscription Rust
  decoder and native encoder. Python retains JSON-RPC correlation, serialized
  writes, push dispatch and domain validation; direct WBA sockets are unchanged.
  Interpreted tests/tools retain the old codec as a reference, not a native
  failure fallback. Focused Rust/PyO3 and Python seam tests plus release build
  pass; live Pixel acceptance and measured import/startup effects remain open.
- [ ] Pixel live acceptance of native WBA control-pipe codec: extension host
  startup/handshake, provider RPC, diagnostics push and restart/reconnect.

### Drawer native I/O prerequisites

- [x] Audit actual drawer shellspec: interactive PTY, not dtach. The shell command
  is launched by the worker's manager; Pyte runs in Code TE2 and stays there.
- [x] Implement and validate Ferrous PTY session isolation/controlling terminal
  and owned exited-shell removal with a lifecycle notification. User approved
  changes in the separate `../ferrous-framework` repository; no publication or
  shared runtime restart is included.
- [x] Native-manager validation: 46 passed, 2 performance tests intentionally
  ignored. Coverage includes kernel resize notification, small-output raw-log
  visibility, running/foreign removal rejection, and no late record resurrection.
  Correct the pre-existing raw-termios test's partial-output assumption by waiting
  for an explicit completion marker. Final Ferrous library tests: 7 passed.
- [x] User approved dependency checkpoint publication: Ferrous `f7ce068` pushed
  on `feature/native-drawer-pty`, with main/tag/release untouched. Pin that exact
  published revision in the independent worker; no local Cargo path dependency.
- [x] Move drawer shell launch/control and bounded raw-log reads to Rust,
  retaining Pyte, screen generation/offset semantics, checkpoint/delta DTOs and
  lazy terminal creation. Outbound FWS observer remains a subsequent slice.
- [x] Automated validation: 20 Rust worker tests, 121 selected Python tests plus
  7 subtests, including split-UTF8/replacement-reset projection coverage.
  Five changed Python modules typecheck clean. Optimized native build passes.
- [x] Real-worker suite: 20 passed, including PTY launch/input/resize/raw-log
  checkpoint/close over polling and WebSocket. Its isolated controller fixture
  deliberately lacks FWS, so notification-driven live output is not certified by
  this test; existing FWS observation remains unchanged.
- [x] User live acceptance of native drawer slice `0aed2445`; reported Termux
  editor startup around 3.5 seconds and first terminal under one second
  (observations, not controlled benchmarks).
- [x] Follow-up: hide exited/missing drawer entries, use project sequence labels,
  and forget stale membership without purging foreign Ferrous history.
- [x] User live acceptance of drawer list/label follow-up `b2653b20` on mobile.
- [x] Remove experimental `.python-version` pin; supported native builds select
  matching system Python explicitly. Three user-requested benchmark deletions
  are included in the next checkpoint's scope.

### Readiness checkpoint

- [x] Code TE2 declares `readiness_support: "pipe"` and publishes serving readiness
  over its existing MessagePack worker pipe after domain startup/listener bind.
  HTTP updates are forbidden for this mode; shell probes cannot substitute.
  Current worker identity gates publication. Boolean callback apps/ALS unchanged.
- [x] Native worker integration suite: 18 passed with pipe readiness required.
- [x] Framework readiness tests: 5 passed (strict mode, exact owner and
  non-fallback probe behavior); native release build and framework check passed.
- [x] User confirmed desktop and Pixel live acceptance of paired framework +
  worker pipe-readiness checkpoint `388a3ea9`.

- [ ] Update architectural documentation/memory for verified contract changes.
- [ ] Record automated checks and user live acceptance separately.
- [ ] Commit/push/merge or release only under the corresponding user instruction.
