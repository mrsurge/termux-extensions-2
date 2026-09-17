# Backend And Native Observability Tracker

Branch: `feature/backend-native-observability`.
Baseline: `ee0c0f1a` (main after 0.2.349 publication).
Design/scope: `docs/apps/backend_native_observability/PLAN.md`.

## Intake

- [x] Import all three deferred categories from the source-control-graph tracker.
- [x] Preserve Gecko incident evidence without assigning an unproven root cause.
- [x] Separate completed spacebar-slide/input work from unresolved missed typing.
- [x] Identify existing Python/native/theme source starting points.
- [x] Add handoff pointers to the completed branch documents.
- [x] Approve Phase 1 read-only investigation and record selected routing/flag
  decisions. Runtime implementation and native build/install scope remain separate.

The runtime-debug startup flag, worker propagation and Python live-loop diagnostic
dispatch foundation are implemented. The pipe-only runtime.debug.status probe is
available, with internal Rust exact-bridge routing and response correlation.
Credential-protected public discovery/status/evaluation and CLI/MCP adapters are
implemented; live acceptance, dedicated state snapshots, profiling and native
tooling remain pending.

## Phase 1: Runtime Map And Contract

- [x] Trace initial Python worker/pipe/MCP dispatch and native console routing.
  Rust ignores worker response frames; Python's synchronous reader dispatch and
  separate asyncio.run loop cannot be reused unchanged for live-loop evaluation.
- [x] Inventory initial flags/tools: --debug is build selection; --memory-profile
  already enables controlled allocation capture. Native console accepts structured
  commands, not general Kotlin source evaluation.
- [x] Select CLI `te2 framework eval` and MCP sharing Rust-to-worker pipe routing.
- [x] Select --runtime-debug / TE2_RUNTIME_DEBUG, enforced at framework and worker.
- [x] Define initial eval identity/envelopes/opt-in/credential and teardown.
- [x] Define initial eval result bounds, live-loop ownership, errors/disconnects.
  Dedicated capture/export and memory traversal remain later work.
- [x] Separate observation from explicit state-changing eval/reflection actions.
- [x] Document timeout limitations and trusted-code execution, not a sandbox.
- [x] Approve startup-gate and Python transport foundation slices. Later public
  evaluation, Rust correlation and native edits require their concrete scope.

## Phase 2: Python Diagnostics

- [x] Add --runtime-debug/--no-runtime-debug and normalize TE2_RUNTIME_DEBUG;
  override app manifest values from the framework-owned launch environment.
- [x] Implement trusted opt-in evaluation and lazy inspect via existing control plane.
- [x] Add shared CLI/MCP discovery and eval requests with exact instance identity.
- [x] Implement internal Rust status routing, one pending request per bridge,
  exact app/shell/instance resolution and disconnect/caller-cancellation cleanup.
- [x] Expose credential-authenticated discovery/status/eval through CLI/MCP.
- [x] Add bounded diagnostic dispatch on the live app loop without blocking stdin
  replies; serialize writes and reject disabled/unbound/closed diagnostic contexts.
- [x] Connect evaluation with source/result limits, credential authorization and
  exact process identity contract.
- [x] Lazy-load stdlib inspect on demand; test ImportError as capability failure,
  preserving startup and evaluation that does not depend on inspection.
- [ ] Expose bounded search/projection/session and task/queue inspection.
- [ ] Label counts, payload bytes, allocation measurements and RSS separately.
- [ ] Bound cyclic/shared-object traversal and repr/results; report truncation.
- [ ] Add snapshot/export/clear, flag state and lifecycle cleanup.
- [ ] Test disabled paths, identity, errors, limits and explicit debug actions.
- [ ] Live acceptance: inspect worker state without disrupting normal requests.
- [ ] Record baseline and cleanup measurements, including instrumentation cost.

## Phase 3: Scheduling And Sidecar Audit

### Startup Investigation Aside

- [x] Inspect host boot and code-server readiness ownership without starting shells.
- [x] Install bounded removable live timing wrappers via exact-worker eval.
- [x] Add runtime-debug-only worker import/lifespan/serving timing on stderr.
- [x] Capture user-triggered page refresh with code-server initially stopped.
- [x] Capture a separately approved fresh worker boot for Python startup timing.
- [ ] Propose evidence-backed launch-order changes, preserving WBA ownership and
  draft/open-model synchronization; obtain approval before implementation.

Source findings: host `runBootSequence` awaits `ensureWorkbenchAdapterReady`
before `mountInlineEditorHost`. Its wait can last 60 seconds; a ready baton skips
it. Boot-snapshot preparation already primes the runtime asynchronously.
Python already subscribes to code-server output for `HTTP server listening`;
moving shell ownership into WBA is not yet justified. Installation validation
precedes the cached-shell fast path, and spawn-time extension registry rebuilding
runs synchronously; timings must establish whether either is material.
The existing readiness event/cached shell ID can remain set after external stop;
they alone do not prove the process is alive. No launch semantics changed here.

The temporary probe is stored as `backend._te2_startup_probe`: `events` retains
at most 256 entries and `uninstall()` restores only wrappers it still owns.
It survives page refresh, not worker replacement. Read events before uninstalling.
Source startup measurements require a fresh worker launch, not a page refresh.

2026-09-16 warm-worker capture, user-confirmed refresh: exact worker
`frs_1789575592769_495_5_5`, instance `e3075cbf443b783d3f2fc237aabdb9bb`.
Backend runtime preparation took 16008.491 ms: code-server ensure 5358.104 ms,
then adapter ensure 10645.599 ms. Nested code-server measurements: installation
validation 5.635 ms, two cached-shell lookups 435.741/367.043 ms, synchronous
extension registry rebuilding 366.217 ms, output readiness wait 2785.632 ms.
These nested timings must not be added to the parent totals. Adapter ensure
includes configuration, shell discovery/start, ping, connect and ready publication;
this capture does not separately attribute them or measure browser paint.
Recommend investigating editor-first mounting with independently attached WBA
intelligence before changing shell ownership. Cold Python boot is recorded below.
Diagnostic-only source validation: 12 startup/pipe/isolated-worker tests passed;
focused Basedpyright reports zero errors/warnings. No shared restart performed.
All eight temporary wrappers were restored after capture; no live probe remains.

2026-09-16 user-triggered cold Python worker restart: shell
`frs_1789576540517_495_6_6`, instance `d36a91f47903aaf4e8aefa0a4b39e55f`,
PID 7312. Structured stderr timings: backend import 1632.907 ms; assembled at
1736.718 ms; lifespan-ready at 1862.191 ms; serving hook 86.340 ms, completed
at 2143.952 ms after worker main entry. This excludes interpreter/common imports
before main, and is not a browser paint or complete intelligence-ready duration.
Code TE2 posts its own readiness inside the serving hook and returns None, so
absence of the generic worker's framework.readiness_posted marker is expected.
No readiness-post failure appeared in the inspected log. Code-server readiness
and successful adapter bootstrap were also logged, but without duration records
for this run; do not combine their times with the earlier warm-worker capture.
No new Python startup stall was established. The source-confirmed frontend
WBA-before-Monaco dependency remains the primary optimization candidate.

### Approved Startup Implementation

- [x] Commit/push observability checkpoint and approved startup plan (`8e7e606f`).
- [x] Configure private compile-cache paths for managed code-server and Node WBA.
- [x] Verify cache support/output with the resolved runtime; report Linux limits.
- [x] Mount Monaco independently of WBA readiness; preserve reconnect/consent.
- [x] Advance worker-owned runtime preparation with serialized launch ownership.
- [x] Validate focused tests, types and generated frontend publication.
- [ ] User live acceptance: early file display, eventual intelligence, both modes.

Implementation: both host adapter-ready and editor language-catalog waits are
nonblocking for document rendering/readiness. Installation consent is unchanged;
WBA baton/open replay still owns intelligence activation. Worker startup now primes
code-server and WBA together instead of deferring the adapter to browser boot.
Both shell managers serialize ensure/adopt/spawn paths. Registry/settings writes
move off the event loop. No pre-import launcher or ownership migration was added.

Compile caches are private absolute service directories under TE2 cache home;
failure disables this optional optimization rather than preventing launch. Both
shellspecs pass NODE_COMPILE_CACHE as environment, not a CLI argument. Bun is
not claimed to implement Node's cache. The actual Termux managed launcher resolves
Node v24.18.0; two isolated --version runs successfully created/reopened a directory
containing 283 cache files. This verifies acceptance/persistence, not a measured
speedup or individual cache-hit count. Desktop standalone launcher inheritance was
source-verified, but no Linux runtime was available for live cache verification.

Validation: 37 Python tests passed (startup cache/serialization, adapter adoption,
runtime resolution, language backend and bootstrap); 8 frontend boot/historical
boot tests passed. Frontend typecheck and `node build.mjs` passed. Focused strict
Python checks for the new helper, code-server manager and new tests are clean.
Broader main.py/adapter checking reports 3 pre-existing cast-overlap errors in
main.py at lines 338/349/378 and 50 warnings; no new error originates in this slice.
No shared runtime or app worker was restarted, no Android assets were bundled,
and no version was bumped. Live acceptance and before/after timing remain pending.

### Startup Boundary Instrumentation Follow-Up

- [x] Add runtime-debug-only early Python import spans, actual listener readiness,
  Rust launch/spawn/readiness spans and browser readiness/asset/init milestones.
- [ ] Capture a fresh framework/worker boot after the user restarts; distinguish
  FastAPI imports from backend imports and readiness publication before attributing
  the remaining roughly five seconds to any one dependency.

The earlier main-entry measurements above excluded common imports. New Python
measurements start at module entry and include wall-clock timestamps. Browser
markers require updated app-shell assets (Android still uses OTA/APK assets).
Readiness behavior is unchanged; no runtime restart is performed by this slice.
Validation: four startup trace tests passed; strict Python checks for the worker,
trace helper and tests passed. Cargo check and formatting passed; all three
inline app-shell scripts passed syntax validation.

### Approved Import And Projection Cleanup

- [x] Keep host/editor/service package initializers lightweight; register routes
  explicitly from their owning module during app assembly.
- [x] Defer run-profile HTTPX readiness imports and terminal launch imports.
  WBA still imports Framework-Shells; this does not eliminate that dependency.
- [x] Construct run profiles once per configuration load; read projection config
  off-loop and reuse it for candidate matching and each broadcast's client fan-out.
- [x] Preserve FWS lifecycle subscriptions and run-profile parent ownership.
- [x] Validate 80 focused tests, including import isolation and stale fan-out.
  Focused Basedpyright: zero errors, six existing warnings.
- [x] User live acceptance of the import/projection cleanup; checkpoint
  `34c630cf` committed as mrsurge and pushed. Controlled timing remains separate.

Fresh live baseline (PID 23846): FastAPI import 1129 ms, backend import 2139 ms,
listener-ready 4376 ms from module entry, serving hook complete 4538 ms.
An isolated post-change import measured app_worker 835 ms and backend 873 ms,
versus the earlier isolated backend 2481 ms. These are not controlled paired
benchmarks: warm caches/CPU load changed, so no equivalent live speedup is claimed.
HTTPX is absent from the post-change boot import trace. No runtime was restarted.

### Parallel Code-Server / WBA Startup (Next)

- [x] Inspect process-start versus connection boundaries: WBA listener/ping does
  not require a connected workbench; Python currently serializes both shells.
- [x] Define prepare/connect split, canonical target prerequisites and single-flight
  adoption semantics; approve concrete implementation before changing runtime.
- [x] Evaluate readiness-output trigger versus adapter-owned UDS service check.
  Existing output timeout continues; neither timeout nor UDS existence proves ready.
- [ ] Test failed/late startup, stale UDS, reconnect/adoption, concurrent callers,
  project changes and cancellation without duplicate connection or respawn churn.
- [ ] Compare mobile cold/warm text/intelligence timing and peak memory.

Implementation now overlaps WBA process preparation with code-server's post-spawn
readiness wait, after code-server installation/registry/settings prerequisites.
The shared adapter launch lock spans preparation, dependency wait and connection.
The new internal prepare/connect boundary retains a prepared shell on cancellation;
ordinary callers continue through the existing ensure API. Output readiness
timeouts/missing pipes now fail instead of silently continuing. Existing adopted
shell paths still rely on the actual workbench handshake for usable intelligence.
Runtime-debug records dependency wait and workbench connection separately.
No new UDS polling loop, native build, frontend change or runtime restart.
Live acceptance of this new overlap slice is pending.
Validation: 73 focused tests pass. New tests cover overlap ordering, dependency
failure, cancellation preservation, callback-once, launch locking and readiness
publication; existing adoption and code-server resolution tests also pass.

### Application Lifecycle / Networking Separation (Planned Experiment)

- [x] Record the proposal and tradeoffs in PLAN.md; implementation remains gated.
- [x] Approved first slice: networked worker-owned async start/stop hooks;
  project/session initialization no longer runs at route import time.
- [x] Own and observe eager intelligence startup, stop FWS observation, and drain
  accepted facts with a bounded shutdown wait. Preserve existing socket contracts.
- [x] Validate partial startup failure, cancellation, repeat startup/stop, fact
  draining, and real subprocess startup-before-serving / SIGTERM cleanup.
  28 focused tests pass; lifecycle modules and new tests have zero type diagnostics.
  Follow-up: corrected read-only shell/connection metadata and sidecar return
  contracts; removed workbench dependency casts. The route contract, shell,
  startup and lifecycle suite passes 32 tests. Type checking reports zero errors
  across main, workbench routes, shell manager and new contract tests; 31 unrelated
  existing `main.py` warnings remain.
- [x] Live acceptance of the lifecycle boundary after worker restart; user
  reports the fastest startup observed so far.
- [ ] Inventory FastAPI-owned lifecycle, dependencies and loop-bound state.
- [ ] Define worker-owned startup/shutdown, typed DTOs and client lifecycle.
- [ ] Compare parallel FastAPI bridge process with existing Rust/pipe networking;
  specify bounded queues, selective state coalescing and ordered edits/commands.
- [ ] Approve and prototype one lane; measure startup, responsiveness, memory,
  backpressure and reconnect/shutdown before considering broader migration.

First-slice scope: still one process and event loop, with unchanged FastAPI import
cost. Mounted ASGI transport lifespans stay transport-owned. Pipe-only worker
mode is unchanged; this is not yet a full service/task ownership migration.
Remaining inventory includes projector tasks, request/client dependencies and
typed cross-process DTOs. No multiprocessing or transport migration is approved
by completion of this boundary alone.

### MessagePack Pipe Cutover

- [x] Audit: framework/app pipes are JSONL; WBA uses JSONL/prefixes; Terminal
  Node pipe already uses uint32-BE framed MessagePack. Terminal app worker is proc.
- [x] Record DTO-boundary findings and defer networking/process separation.
- [x] Pin both FWS handoff commits and update Cargo lockfile. Python FWS is now
  installed non-editably in site-packages at the exact pinned commit; verified
  package provenance. The running framework was not restarted.
- [x] Migrate framework/Python worker pipes and debug fixtures to bounded
  concatenated MessagePack, keeping application envelopes and ordering.
- [ ] Migrate WBA stdio and Python reader/writer, startup/reply/push records.
- [x] Declare log codecs on Code TE2 and File Explorer app-worker pipe shells.
- [ ] Declare WBA codec and Terminal framing metadata after those migrations.
- [ ] Add explicit length-prefixed framing observation in both FWS repositories;
  fix large-frame indexing/preview budget separation and pin follow-up commits.
- [ ] Run cross-language, malformed/fragmented/large-frame, startup/debug and
  inspection tests; Rust check/tests and WBA typecheck/build.
- [ ] Live acceptance after coordinated framework/worker/WBA restart.

No wire-format migration has live acceptance yet. No browser protocol, native
VS Code wire protocol, PTY text stream or Android publication changes planned.

First-slice validation: 27 focused Python tests and 30 Rust pipe/writer/debug
tests pass; Rust check passes; changed Python codec/worker/test files type-check
with zero diagnostics. A shared hex fixture is decoded by Python and Rust, and
the pinned Python FWS source decoded it for inspection. Python package installation
was subsequently approved and verified. No live restart, WBA migration or
nested-repository edits yet.
Framework and Python pipe peers must be restarted together, not independently.

### Remaining Observability Audit Items

- [x] Select external Rust CPU sampling, not a reflection/interpreter runtime:
  Samply on Linux, Simpleperf feasibility on Termux, flamegraph SVG alternative.
- [ ] Verify actual host/device tools, perf-event permissions and stack unwinding;
  do not automatically weaken kernel policy or assume desktop/Android parity.
- [ ] Inspect optimized build/symbol retention and define capture provenance.
- [ ] Define bounded runtime-debug CLI/MCP capture/status/artifact contracts,
  exact process identity, cancellation, concurrency and profiler-child cleanup.
- [ ] Approve concrete integration scope, then implement optional capture tools
  with explicit unavailable/permission errors and local bounded artifact retention.
- [ ] Verify raw/export/viewer symbolization workflows, disabled behavior,
  process-exit handling and no target termination or automatic profile upload.
- [ ] Measure CPU-capture overhead and collect a representative hot-path profile;
  distinguish on-CPU samples from queue/service waits and allocation measurements.
- [ ] Attribute queue/execution/service/projection latency with correlated traces.
- [ ] Reproduce relevant mobile-host workload; record before/after conditions.
- [ ] Audit sidecar LSP APIs/fields, callers and persisted consumers.
- [ ] Classify each suspect path: live, obsolete, compatibility-only or unresolved.
- [ ] Approve and implement only evidence-backed cleanup/performance changes.
- [ ] Test ordering, cancellation, project changes, reconnect and retained state.
- [ ] Live acceptance of targeted fixes; document no-change findings honestly.

## Phase 4: Android Debug Runtime And Deferred IME Diagnostics

- [x] Approve shared debug source/ADB/console dispatcher and compilation/tests
  for Gecko and Cefrium. No APK installation, asset publication or version bumps.
- [x] Select live-object inspection/invocation through Java reflection plus
  kotlin-reflect for Kotlin metadata; exclude Keval and arbitrary Kotlin compilation.
- [x] Define object targeting, typed argument/overload handling, bounded results,
  explicit mutations, access failures and stale activity/view cleanup.
- [x] Align kotlin-reflect to the app Kotlin version; verify debug availability
  and absence of new dependencies/seams from release variants.
- [x] Extend native console/ADB inspection, reflection and controlled actions.
- [x] Disable Gecko debug minification to preserve inspection member names;
  Cefrium debug already disables it. Release/staging settings are unchanged.
- [x] Add opt-in bounded dispatcher/root-lifecycle tracing, export/clear and
  optional logcat output; no raw text capture or continuous socket stream.

Remaining IME-specific diagnostics (deferred separately):

- [ ] Trace connection lifecycle, focus/restartInput, selection, batch edits,
  composition/commit, deletion and key events with arguments/outcomes.
- [ ] Keep raw-text capture separately flagged; prevent console/socket flooding.
- [ ] Correlate native/DOM events by connection/sequence and aligned timestamps.
- [ ] Ensure observation does not reset focus/composition or hide the incident.
- [ ] Validate explicit action state reporting/restoration and release exclusion.
- [ ] Test bounds, disabled overhead, activity recreation and normal input guards.
- [ ] Live acceptance of diagnostic controls on GeckoView.
- [ ] On recurrence, capture the missed-input incident before restarting.
- [ ] Compare Cefrium if warranted; decide fix scope from evidence.

General debug foundation: both debug Kotlin compilations passed, five focused
reflection tests passed for each renderer, and the repeatable
`android/verify-native-debug.init.gradle` checks verified debug dependency/source
isolation. Fresh Gecko/Cefrium release and staging main manifests omit the ADB
receiver; debug manifests include it with the DUMP permission. Final pagination
checks are included in the same focused test class. APKs have not been assembled
or installed for this slice; ADB/console live acceptance remains pending.

Trace recording currently covers command execution and registered-root lifecycle
only, with raw text excluded.

Tooling acceptance and incident resolution are separate. A non-reproducible
incident can remain open without blocking an accepted instrumentation release.

## Phase 5: Extension Themes

- [ ] Audit installed catalog/resource delivery and existing preference/loader flow.
- [ ] Inspect pinned upstream JSONC/include/inheritance/token/semantic semantics.
- [ ] Define main, working-secondary and historical-secondary propagation.
- [ ] Cover uninstall/missing themes, stale loads, reconnect and local asset rules.
- [ ] Make an explicit separate decision about fixed-palette WBA webviews.
- [ ] Present compatibility fixtures, lifecycle tests and estimated scope.
- [ ] Decide implement here or transfer to a named follow-up; record rationale.
- [ ] If implemented: validate Monaco/TextMate and desktop/Gecko/Cefrium behavior.

## Closeout

- [ ] Update CODE_TE2.md and condensed repo memory with verified contracts only.
- [ ] Record focused test/typecheck/build evidence for every implemented slice.
- [ ] Obtain live acceptance and checkpoint commits at agreed boundaries.
- [ ] Remove temporary probes/print spam; preserve intentional opt-in tooling.
- [ ] Name unresolved incidents/deferred theme work and their next owner/location.
- [ ] Confirm clean root/nested scopes and release-ready state before merge.

## Evidence Log

Use entries with revision, exact worker/device, flags, workload, measurement scope,
results and limitations. Distinguish user observations from captured evidence.
No new runtime measurements have been collected for this branch yet.

2026-09-15 source audit: confirmed bootstrap build-flag semantics, existing memory
profiling, pipe dispatch direction/threading, and structured native console entry.
User approved the routing/flag choices and lazy inspect. The native plan was
corrected to Java reflection plus debug-only kotlin-reflect, excluding Keval.
No dependencies installed or runtime changed.

Runtime-debug startup slice: added positive/negative CLI flags, normalized child
environment and framework-authoritative manifest overrides. Validation:
`python -m unittest framework.tests.test_bootstrap -q` passed 36 tests;
`cargo test -p te2-server launcher::tests --locked -j 2` passed 5 tests.
Basedpyright on bootstrap/tests reported zero errors and 295 warnings, including
existing dynamic-module typing warnings and private-helper access in new tests.
New tests use a typed module import rather than propagating dynamic-module Any.
Rust formatting and git diff checks passed. Pytest is absent in this environment;
the unittest runner was used directly. No framework restart or eval exposure.

2026-09-16 Python transport foundation: 8 unittest tests passed across
test_runtime_debug_pipe and test_pipe_backed_app_worker. Covered live-loop status,
disabled/unbound/closed paths, target/method errors, single-flight admission,
cooperative shutdown, nested framework replies, duplicate replies and serialized
writes. The integration test launches an isolated worker; the shared framework
was not restarted. Basedpyright on app_worker.py, pipe_runtime.py,
runtime_debug_pipe.py and the new focused test reports zero errors/warnings.
Ordinary dispatch and JSONL framing remain unchanged. User also reported the
previous startup-flag slice compiles/runs normally in live use.

2026-09-16 Rust routing slice: internal status discovery/routing captures exact
app/shell/random bridge identity. Existing stdout dispatch now resolves matching
response/error frames; registration and writer closure reject pending calls.
Tests cover identity mismatches, late/duplicate responses, worker errors, busy
admission, timeout/caller abort, enqueue failure and replacement-safe cleanup.
`cargo test -p te2-server pipe --locked -j 2` passed 29 tests, including 4 new
routing tests. Combined bootstrap/Python pipe regression passed 44 tests.
Rust formatting and git diff checks passed. No shared runtime restart, public
API exposure or live end-to-end CLI/MCP claim; those remain the next slice.

2026-09-16 public evaluation slice: added credential-gated discovery/status/eval
on the existing Rust listener, shared CLI/MCP access and bounded live-worker
evaluation with top-level await and lazy inspect. The isolated worker test
exercises the live backend module. A reply/admission race was fixed by releasing
the worker slot under the serialized writer lock before the reply becomes visible;
sequential requests require neither sleeps nor retries.
Combined bootstrap, evaluator, pipe, isolated worker and discovery regressions:
55 unittest tests passed. `cargo test -p te2-server runtime_debug --locked -j 2`
passed 8 tests. Focused Basedpyright on the changed evaluator/transport/client/CLI
modules and new unit tests reported zero errors/warnings. MCP tool construction
and required credential/target schemas were checked. The broader MCP server
still reports 19 existing bare-dict annotation errors and 49 warnings; the three
new typed tools have only decorated-function unused warnings. Rust formatting
and git diff checks passed. No shared framework restart or live end-to-end
acceptance has been performed; CLI/MCP runtime acceptance remains pending.

### Parallel Startup Live Timing Follow-Up

PID 32584: worker listener at 3253 ms; first intelligence orchestration completed
in 8836 ms. WBA dependency wait was 0.103 ms, while adapter.connect took 4993 ms.
This confirms overlap occurred but does not establish first usable provider timing.
Two orchestration callers were visible; that alone is not evidence of two spawns.

Added bounded runtime-debug-only WBA connect spans (100 maximum): management,
server-root discovery, environment/extension scan, file watcher, extension-host
connection/handshake and primary-view activation. Begin/end records use stderr,
PID/span identity, timestamp/duration/outcome; no document or credential payloads.
Explicit shellspec propagation enables them on the next WBA launch. Adapter build
and three focused instrumentation tests passed. Standalone TypeScript checking
is blocked by missing .mjs declarations in this adapter tree. No restart performed.

### Sidebar Activation Off The Connection Critical Path

Fresh PID 3707 timings: management 2056 ms (root discovery 900 ms, extension scan
555 ms), extension-host connection 2781 ms, sidebar activation 1174 ms. Python
worker listener ready at 2597 ms; aggregate adapter connect 6397 ms.

- [x] Return connection readiness without awaiting primary sidebar views.
- [x] Fence late activation by session/workspace and cancel provider waits on clear.
- [x] Add bounded one-shot debug milestones for document open, language activation,
  provider registration and diagnostic arrival; no document/credential payloads.
- [x] Adapter rebuilt; 12 focused startup/webview tests passed, including teardown
  during activation/provider waits and readiness before sidebar completion.
- [ ] Live cold-start timing and sidebar/intelligence acceptance after WBA restart.

No shared runtime restart performed. Provider/diagnostic milestones are not proof
of first useful language result; interpret them separately from connection readiness.

### Direct WBA Transport / TextMate Timing

The mjs reproduction had WBA ready at unixMs 1789609128713, JavaScript activation
complete at 1789609132166, but browser namespace connection at 1789609142446.
TextMate installed source.js at 1789609143692. Catalog/grammar requests timed out
waiting for the socket during this gap. This does not establish TextMate as a
blocker; the delayed connection remains unexplained.

- [x] Add temporary browser transport timing, capped at 80 records per realm:
  attach/connect/error, manager open/reconnect attempts, and catalog/grammar
  wait/send/reply/timeout. No RPC payloads and no altered retry policy.
- [x] Add runtime-debug WBA listener-ready and bounded Engine.IO arrival/error
  markers to distinguish backend listening from actual transport arrival.
- [x] Transport suite: 23 tests pass, including trace bounds and payload exclusion.
- [ ] Reproduce after frontend asset update and worker/WBA restart; correlate
  browser transport records with backend listener and namespace timestamps.

### Shared-Client Startup Race Investigation

User reproduced equivalent latency in GeckoView, Cefrium and Chromium clients;
Gecko-specific connection admission/backoff is not established as the shared cause.
The observed browser attempt timed out at 20 seconds; its retry connected in about
60 ms. A running-service browser probe connected in 25 ms and propagated a rejected
handshake in 403 ms. Neither reproduces the startup-only failure.

- [x] Isolated Rust test: a proxy upgraded against a closed upstream port closes
  its downstream promptly (2-second assertion bound; initial test took 20 ms).
- [x] Add runtime-debug bounded shared-proxy markers: WBA route arrival, downstream
  upgrade, upstream connect begin/failure/success and bridge closure. No query data.
- [ ] Capture the same cold-start race with the instrumented shared framework.

No Android source changes or shared framework restart were performed. Do not infer
that TextMate parsing blocks networking: the observed grammar calls waited for a
socket and completed quickly after the successful retry.

### Editor WBA Readiness Gate

The latest browser capture connected early at 23:31:41.549, received backend
adapter-ready at 23:31:44.990, timed out at 23:32:01.552, and connected on retry
at 23:32:03.000. User comparison with the older mount-gated frontend supports
retaining the readiness gate for intelligence only, not delaying Monaco again.

- [x] Disable initial WBA auto-connect and use the existing editor-lane ready
  snapshot/event; preserve immediate Monaco mounting and document RPC.
- [x] Cover ready notification handling, repeated/reconnect snapshots, initial
  socket options, and independent editor mounting in focused regression tests.
- [x] Live cold-start acceptance after updating frontend assets: no initial
  WBA handshake timeout; document text still loads independently.

User confirmed the updated startup is fast. Frontend typecheck, 28 focused
transport/boot tests and bundle publication passed before live acceptance.

No Android changes, timeout reduction, polling, or new readiness transport.
