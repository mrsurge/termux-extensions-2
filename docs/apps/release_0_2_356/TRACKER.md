# 0.2.356 maintenance tracker

## App-agnostic framework / manifest refresh

- [x] User clarifies Refresh means reread manifests and remap app entrypoints/
  routes, especially second-root apps—not indiscriminate worker restarts.
- [x] Read-only audit confirms existing framework/Electron/Android/Termux buttons
  reach POST /api/apps/reload; registry reload is live, but SioRouteIndex and
  physical Engine.IO mounts remain startup-owned. No refresh was invoked.
- [x] Explain worker selection: common native manifest/fingerprint/cache selector
  is reusable; bootstrap discovery is built-in-only and Code TE2 domain/package
  policy is bespoke. Frozen bootstrap environment is not live binary resolution.
- [x] User requires app-agnostic production framework behavior and approves a
  broader audit/staged plan. Inventory real production identity/import/path
  coupling separately from inline test fixtures in FRAMEWORK_AGNOSTIC_AUDIT.md.
- [x] Record Stage A generic native declaration/no-build selection, Stage B atomic
  catalog/routes/launch-context refresh, Stage C app-owned policy migration and
  Stage D source guardrails/isolated acceptance. No runtime source edits/builds,
  worker/framework restart, APK publication, version bump or commit in this audit.
- [x] Resolve/approve the concrete cross-language generic selection contract;
  reuse existing fingerprint/receipt logic rather than duplicate it in Rust.
- [x] Implement individually approved slices with neutral second-root/native
  fixtures, failure rollback, active-owner survival and permission parity.
- [x] User reports live acceptance of pipe actions, intents and Embedded App
  Presentation State after source work. This records user-run validation, not an
  agent-observed deployment/profiling claim or permission for another restart.

This design gate precedes the deferred network RPC slice. Existing uncommitted
PyO3 work and user's shellspec/report/untracked files remain preserved.

### Approved bootstrap slice — 2026-10-22

- [x] User separately approves configured-root discovery, generic typed no-build
  selection and app-owned runtime preparation. No Rust refresh wiring, native/
  full mypyc build, restart, Android change, version bump or commit.
- [x] Discovery follows configured TE2_SERVER_APP_ROOTS in registry order,
  including second roots and manifest ID/directory-name differences. First app
  wins, including when it has no native declaration; shadowed providers are not
  loaded. Distinct apps cannot overwrite one environment export key.
- [x] select_native_build exposes executable/receipt/fingerprint/compatibility/
  usability through the existing shared selection policy, without publication.
- [x] Code TE2 declares runtimeProvider in its own native manifest. App-owned
  native_runtime.py retains editable selector/force overrides, packaged private
  Python/ABI validation and no Cargo fallback. Bootstrap contains no Code TE2
  identity/import/environment literals. Failed preparation leaves caller env
  unchanged (already completed explicit builds are not rolled back).
- [x] Focused bootstrap/private-runtime/identity/discovery suites: 92 tests pass,
  including two independent packaged providers and no-build receipt/force parity.
  Strongest strict/extra/all-Any Code TE2 audit passes 248 source files; the new
  provider and shared contract independently pass the same policy. A supplemental
  bootstrap-only strict check reports six pre-existing issues in CLI shutdown/
  subprocess handling and a redundant manifest cast, not a clean-bootstrap claim.
- [x] Select and implement the Rust-facing read-only owner/receipt exchange (A2).
- [x] Implement separately approved B atomic registry/routes/future-launch-context
  refresh in source. Runtime adoption remains separately gated; A1/A2/B source
  changes do not update the currently running framework.

Existing setuptools wheel deprecation warning remains visible. Native builds,
activation, live refresh and client publication were not performed.

### Stage A2 — private selector contract

- [x] User approves private read-only selection owner plus typed Rust client and
  tests; subsequently approves focused Cargo unit-test compilation, not a
  production binary build/publication or runtime restart.
- [x] Bootstrap issues bounded 64 KiB source/profile/runtime preparation context;
  app-owned provider setup remains explicit preparation only. Read-only selector
  rechecks current declarations/fingerprint/ABI receipts and packaged executable
  digest, returning ready/build_required/preparation_required without building.
- [x] Existing runtime sidecar mounts capability-protected, no-store private
  endpoint with typed 4 KiB request/1 MiB response bounds. No caller-supplied
  roots/env/profile, no arbitrary provider execution, no full environment echo.
  Single-flight admission survives requester cancellation; manifest SystemExit
  cannot terminate its event loop. Missing old-peer context fails explicitly.
- [x] Rust client requires supplied key/numeric-loopback HTTP and disables
  environment proxies, redirects and retries. Strict response schema/IDs/keys,
  profile/status and bounded streaming reads; no lifecycle or reload caller yet.
- [x] Python grouped owner/discovery/bootstrap/private-runtime/identity/sidecar
  tests: 102 pass. Includes declaration mutation during preparation refusing
  a misleading fresh receipt; caller environment remains untouched. New shared
  contract/owner pass strongest strict/extra/all-Any.
- [x] Focused Rust tests: 3 pass under --no-default-features, including isolated
  HTTP capability/request shape and redirect refusal (one request, no follow).
  Full Code TE2 strongest audit: 248 source files pass. Existing no-feature Rust
  dead-code/unused warnings remain visible; no production artifact was published.

Stage B below implements atomic registry/routes/launch selection publication and
isolated concurrency/owner-survival tests. The A2 generation remains a selection
projection digest, not a filesystem transaction or catalog commit.

### Checkpoint and Stage B — 2026-10-22

- [x] User requests checkpoint: 6eb74ed6 commits completed ingress and A1/A2
  source/docs/tests. No version bump or push. User shellspec overrides and
  untracked reports remain excluded/preserved. B changes are subsequent work.
- [x] User emphasizes that app initialization and intent policy belong to the
  replaceable manifest configuration, not framework app-name branches; approves
  concrete Stage B implementation and isolated tests, not runtime activation.
- [x] AppCatalog groups registry/entrypoints/raw intent policy, referenced socket
  JSON and shellspec YAML, native declaration proofs and native selection under
  one immutable Arc generation. Configuration reads are bounded (1 MiB/file,
  4,096 files/16 MiB inventory); genuine I/O failures reject refresh.
- [x] Existing HTTP and native MCP reload now share candidate construction,
  declaration/proof rechecks and one catalog publication. Concurrent refresh is
  rejected; a launch read permit stays inside its blocking task even if the
  caller cancels. Startup retains broken-app catalog visibility but cannot
  install unsafe socket mounts through a lenient fallback.
- [x] Dynamic HTTP/upgrade dispatch uses the captured route rather than fixed
  startup Axum mounts. Canonical/declared-alias app prefixes and legacy *_ws
  aliases are guarded; protected framework/proxy surfaces, encoded/dot paths,
  collisions and cross-owner overlaps reject the candidate.
- [x] Launch uses the captured shellspec and current native selection; prepared
  native values remain defaults, preserving explicit shellspec/app overrides and
  existing framework-forced launch identity. No global environment mutation,
  source build or old-executable fallback on missing preparation.
- [x] Refresh no longer replaces running-app ownership from a discovery scan.
  Return/event summary adds generation, added/changed/removed, restart_required
  and native_status while retaining count. No workers are stopped/restarted.
- [x] Real isolated HTTP + upgraded WebSocket test covers add/change/remove,
  removed alias reachability, old connection/owner survival and invalid-candidate
  rollback. Further tests cover source/reference mutation, second roots, intent
  policy changes/errors, source bundled-app compatibility, protected routes,
  launch environment precedence and actual overlapping refresh admission.
- [x] Final full Rust suites: default features 248 pass / 5 opt-in ignored;
  no-default-features 204 pass / 5 ignored. Python owner/bootstrap/private-runtime/
  identity/sidecar group remains 102 passing tests. No new Any/type suppressions.
  Candidate scan and final recheck own their admission guards across blocking
  work, so HTTP cancellation cannot permit overlapping unfinished scans/spawns.
Activation contract: A1/A2 bootstrap/bridge and B server are adopted together;
B alone needs no Android/OTA/client source change or new mypyc rebuild. The
later user-reported App IPC acceptance is recorded below, not a new validation
phase. No agent-triggered shared-runtime transition occurred during source edits.

Test nuance: placing TMPDIR inside this Git checkout makes three existing
non-repository fixtures discover the parent TE2 .git. User explicitly approves
/home/mrsurge/knowhere/.te2-catalog-tests for isolated full-suite TMPDIR; no Git
production behavior or unrelated test source was changed to hide those failures.
Existing opt-in test skips stay visible. B alone did not remove app-specific
policy; the separately approved Stage C source migration is recorded below.

### Stage C — 2026-10-22

- [x] User approves framework/app policy changes and isolated tests; explicitly
  chooses to defer shared-runtime validation until after this source work.
- [x] Add bounded fail-closed AppPolicy and manifest declarations for intent
  callers, unique shortcut provider, exact CORS, explicit alias-state migration
  and exact-parent workbench diagnostics. Catalog validates before publication.
- [x] Replace generated Python WBA relay code with a structured authenticated
  exact-target pipe operation and app-owned handler. Public MCP interface stays
  compatible; no arbitrary app Python import remains in framework source.
- [x] Reuse bundle-manifest version owner from the Rust service-worker handler,
  without modifying frontend assets or generating/publicizing new bundles.
- [x] Production app-ID audit: remaining built-in names outside frontend assets
  are test fixtures; filesystem pipe origin_name was also confirmed test-only.
- [x] Final Rust suites: 252 pass default features; 207 pass without default
  features; five existing opt-in tests ignored in each. Existing no-feature
  unused/dead-code warnings remain visible. Python group: 126 pass (existing
  setuptools bdist_wheel deprecation warning). Stronger strict/extra/all-Any
  Code TE2 check: 248 source files pass. Targeted rustfmt and diff checks pass.
  New tests cover receiver permission rejection, provider absence/ambiguity,
  invalid declarations/foreign migration aliases, exact CORS path/origin matching,
  data-only WBA relay, disabled diagnostics and off-loop correlated replies.
- [x] Stage D neutral-fixture/source-policy guardrails implemented with explicit
  user approval, including retired editor alias removal from framework fixtures.
  Launcher now owns a neutral fixture, not a real app shellspec dependency.
  Manifest-derived Rust-source guard passes (two Python tests); no runtime module
  or test block excluded. User-specified identity grep returns zero hits.
- [x] Stage D full Rust suites after neutral fixture replacement: default 252
  passed; no-default 207 passed; five opt-in ignored in each. Nine focused Python
  source-guard/structured-debug tests pass. Existing no-default warnings remain.
  Removed the newly unused test-only shellspec reader; real app bootstrap and
  shellspec contract coverage remains outside framework crates in Python tests.
- [x] User reports all pipe actions, intents and app presentation-state behavior
  working and considers validation complete. No extra validation phase is queued.
  The agent did not perform a runtime transition during source/docs edits.
  Deployment contract remains matched framework/bridge preparation plus Code TE2
  domain/mypyc adoption when selected; acceptance is not automatic publication.

### Reference consolidation — 2026-10-22

- [x] User approves documentation-only CODE_TE2.md update: declarative app IPC/
  catalog refresh/native selection, Embedded App Presentation State terminology,
  original-byte ingress and structured WBA diagnostics. Correct related obsolete
  central-native-registry, mandatory-scratch-domain, FastAPI fallback and dependency
  descriptions; retain stable numbered sections and app-owned compatibility data.
- [x] Finish targeted source-path/reference, stable section-number and diff checks.
  Documentation-only: no build, runtime transition, publication or version change.

## Mypyc live target progress

- [x] User-approved observation-only progress on the existing build command:
  generated C target inventory, flushed completed/total stdout lines after
  successful compiler returns, and explicitly labeled up-to-date extensions.
- [x] Preserve detailed build.log, existing concurrency/cache policy, failed-target
  semantics and verified-snapshot reuse. Restore compiler callback on failure.
- [x] Focused workflow suite: 31 passed, one opt-in compiler benchmark skipped;
  covers serial/parallel callbacks, duplicate source names across extensions,
  redirected compiler output, cache skips and compiler failure.
- No full compilation, artifact activation, native build, runtime restart or
  client publication performed for this slice.

### Cache labels and reported post-compile validation failure

- [x] User approves per-target ccache labels for future builds. Isolated stats
  logs and official JSON statistics distinguish hit/miss/uncached/unknown without
  global counter resets, cache deletion, timing guesses or environment races.
  Setuptools call/spawn compatibility and failure-safe callback restoration stay
  covered; up-to-date extension skips remain separate from cache hits.
- [x] Inspect latest cache `0cb157597c9ecb8a2d5436cb/build.log`: compiler/linker
  reached completion; original validator stderr was inherited, not retained
  there. Re-import retained compiled outputs in disposable roots to reproduce:
  `TypeError: @runtime_checkable can be only applied to protocol classes`,
  at native_socketio.NativeEventHandler. No rebuild/activation for diagnosis.
- [x] User separately approves correction: extract NativeEventHandler and
  QueueSizeReader to interpreted native_runtime_contracts.py; keep Socket.IO
  and diagnostics-metrics implementation modules compiled. No weakened typing.
- [x] Focused grouped regressions: 70 passed, one opt-in compiler benchmark
  skipped. Includes real isolated ccache miss→hit and actual build_ext labeling,
  malformed/missing/failed observations and interleaved context isolation.
- [x] Separate two-module real mypyc fixture passes compilation/import and
  runtime Protocol checks (12.14 seconds). Full strict/extra/all-Any Code TE2
  audit passes all 247 source files. Full editor snapshot rebuild/activation
  remains unperformed; no worker/framework restart, OTA or native build.
- Existing cache statistics show 769 hits/4,891 misses across historical builds,
  0.4/1.0 GiB used. These cumulative counters cannot identify the last build's
  hits; the new per-target reports provide that evidence on future builds.

## Compiled cutover live probe and DTO correction — 2026-10-21

- [x] User's shellspec workaround is preserved as user work. Confirm replacement
  Code TE2 worker `frs_1792595806125_3267904_7_7` reports 146 overlay modules,
  has nonempty CODE_TE2_MYPYC_DIR and maps the snapshot's shared mypyc/native_worker
  libraries. Earlier force=0 alone still had an empty selector and no mappings.
- [x] Exact ALS log at 16:15:56 shows `file.open` with line=59/column=1 and full
  qualified presentation proof. Pipe returns `appIntent.failed: ValidationError:
  Expected type, got int - at $.column`; delivery itself did not silently drop.
- [x] Disposable imports of the active snapshot reproduce erased msgspec fields:
  nullable coordinates/identity strings become runtime `type`. User approves
  moving three DTO definitions to already-interpreted sidebar_rpc_contract.py,
  keeping the host dispatcher compiled and strict unknown-field/type admission.
- [x] Actual compiled first-call dispatch exposes an additional package-import
  reference that remains None unless cwd.get initialized it. User separately
  approves direct lazy module import, preserving the owner and load timing.
- [x] Real three-module mypyc fixture passes (26.47 seconds): correct runtime DTO
  identity, integer/default/null coordinates, qualified strings, rejection of
  malformed fields and file.open→existing owner without a prior CWD request.
- [x] Focused source/workflow suites: 97 pass, one opt-in compiler benchmark
  skipped. Full strict/extra/all-Any check passes all 247 Code TE2 files.
- [ ] New mypyc snapshot build/activation and Code TE2 worker refresh/live diff
  link acceptance. No full build, snapshot activation, restart or publication
  performed by agent. No ALS rebuild/frontend/OTA needed for this receiver fix.
- [ ] Separate ALS frontend Markdown link parsing issue: `/absolute/path#L198`
  was treated as a same-origin HTTP URL. User explicitly distinguishes this
  from the intent failure; no frontend fix or ALS edits performed in this slice.

## Current work order

1. Startup/HTTP initialization: user live accepted 2026-10-20, complete.
2. Framework-pipe intents and Embedded App Presentation State (O1): user reports
   working; Any cleanup and app-agnostic refresh follow-up are source-complete.
3. O2 current: network RPC original-byte handoff is source-implemented after the
   framework/WBA inbound slices. Finish isolated qualification, then separately
   prepare matching worker/domain adoption. Targeted native-type review follows;
   queue/concurrency changes are not silently included.
4. Native debug/internal console-bridge retirement: deferred behind both.
5. Remaining O3–O8 investigations: later ordering by evidence/user choice.

Validation belongs within each work phase, never a replacement for actual work.

## O2 — conversion/allocation overhead: next active investigation

- [x] User prioritizes this after the Sidebar/typing checkpoint; approves plan/
  tracker edits and read-only source investigation before runtime changes.
- [x] Map framework pipe, socket submit/ACK, FWS and WBA seams in native_worker.py,
  pipe_codec.py and native worker code_te2.rs/values.rs. Current typed schemas
  do not make the recursive Python/Rust value conversion disappear.
- [x] Identify a bounded first candidate: every WBA push is re-encoded solely
  for payload_bytes telemetry, even when diagnostics metrics are disabled.
  Trace all uses: accounting is metrics-only, not a queue-size admission guard.
- [x] Obtain concrete approval, then gate counting serialization at intake on
  the existing metrics policy. Keep enabled-mode accounting, event ordering,
  coalescing and wire/validation contracts unchanged. O9 stays deferred.
- [x] Test disabled mode never invokes counting encode; enabled mode preserves
  byte counts; replies/startup and push delivery retain existing behavior.
  Run focused WBA/Python tests and strict typing; no native/full mypyc build or
  activation/restart without separate approval.
- [x] Focused WBA codec, diagnostics telemetry/coalescing, shell-adoption and
  intelligence-startup regressions: 24 tests/two subtests pass. Full strongest
  strict/extra/all-Any check passes all 247 Code TE2 source files. No native/full
  mypyc build, activation, restart, publication or commit performed.
- [ ] Matching interpreted worker refresh or new compiled mypyc build/activation
  and worker refresh, followed by live WBA/diagnostics acceptance. No Rust worker,
  frontend or OTA change is required by this Python-only gate.
- [x] Separately approve/build/run isolated graph/buffer boundary probe using
  existing native converters/guards and real Python envelope projection. Five
  valid fixtures pass in interpreted and existing compiled modes; ten invalid
  inputs reject. Strict helper typing and locked/offline release example build
  pass. Exact modes/results/commands: BOUNDARY_PROBE.md.
- [x] Record mixed result rather than cut over: inbound control/nested improves,
  binary regresses; outbound gains largely disappear with compiled projection.
  Plain msgspec accepts sets the current converter rejects; datetime rejection
  stage/messages differ. No complete semantic parity or end-to-end/RSS gain.
- [x] User approves inbound-only framework-pipe implementation/tests; generated
  search/Git responses are the stated target. Capture original bounded bytes
  under the existing native decoder, direct typed decode to the existing router;
  preserve error replies and synchronous dispatch order. Outbound/WBA unchanged.
- [x] Real Rust→Python dispatch passes interpreted and newly compiled two-module
  modes: 181 schema/value/error-message cases, 20 matching dispatch events,
  corruption/handler failure stops and no replay. 19 focused Python tests/two
  subtests pass; strongest no-Any check passes all 247 Code TE2 source files.
  Explicit strongest typing also passes pipe_codec and native_worker; strict
  probe/test helper checks pass. Native check/decoder/full-worker tests recorded
  in BOUNDARY_PROBE.md. No full domain mypyc build or live transition.
- [x] Measure original-frame acquisition: compiled search/Git fixture conversion
  ~24% lower, binary ~20% slower, wide roughly unchanged/slightly slower.
  BOUNDARY_PROBE.md records exact table/modes and uncontrolled system-load caveat.
- [x] User reports rebuilding matching native/domain artifacts and successful
  runtime adoption for the framework-pipe slice. User further reports searches
  through roughly 6,000 files without prior stutters/hangs. This is qualitative
  live acceptance, not independently verified artifact provenance or measured
  speedup/backpressure. No agent-initiated restart/publication performed.
- [x] Defer search benchmark repair at user request; do not rebuild an old-tag
  baseline solely to quantify the already accepted qualitative improvement.
  MessagePack as the benchmark's cause remains a user hypothesis, not diagnosis.
- [x] Audit WBA/network ingress: WBA backend control pipe and generic network
  Backend.call convert native graphs; direct WBA browser sockets bypass Python.
  Source paths and distinct follow-up boundaries: INGRESS_AUDIT.md.
- [x] User approves WBA-first: shared native framer returns exact validated frames
  to Python msgspec decoder before unchanged reply/push handling. Preserve native
  bounds, EOF/replacement/batch-error behavior; no outbound/direct-socket changes.
- [x] WBA focused regressions: 22 tests/two subtests pass, including small actual
  mypyc adapter build. Strongest no-Any checking passes all 247 Code TE2 files.
  Native full-worker tests: 44 pass. Real PyO3 stream→adapter→stdout-consumer
  probe passes source and compiled adapter paths. Subsequent codegen coverage
  also checks the compiled stdout consumer; full-domain rebuild stays separate.
- [x] Real-stream local probe records ~23%/~37% lower compiled diagnostics/reply
  conversion; binary-heavy fixture ~8% slower. Preserve all scope/copy/guard/load
  caveats and exact reproduction in INGRESS_AUDIT.md; no live WBA speedup claimed.
- [ ] Prepare/adopt matching native worker and full domain/mypyc for this **new**
  WBA slice, with explicit lifecycle approval and live diagnostics/backend-RPC
  validation. Prior framework-pipe acceptance does not accept this later change.
  No frontend/OTA/Node/WBA source publication needed; no activation performed.
- [x] Develop/approve the distinct network MessagePack RPC handoff using original
  validated payload bytes plus native socket context; retain current handlers,
  admission, ACK/error/cancel and direct-proxy behavior. Source now implemented;
  detailed scope and parity boundaries are in INGRESS_AUDIT.md.
- [x] Preserve native parse/framing guards, original bytes, separate SocketRef
  identity and prior wrapper conversion budget. Reuse existing Future/admission
  code, with no uncertain replay or frontend/wire/outbound migration.
- [x] Real source and three-module mypyc submit/Future/namespace parity passes;
  real-PyO3 probe passes 24 cases in each mode and reports actual .py/.so modules.
  This is isolated synthetic dispatch, not live socket/profiling acceptance.
- [x] Final native full-worker tests: 49 pass, including wrapper depth/node
  budget parity and original-frame/codec guard regressions. Source/three-module
  mypyc parity tests: 2 pass; existing editor/UI RPC and inbound-router group:
  18 pass. Strongest strict/extra/all-Any Code TE2 check: 249 source files pass.
  Probe/test helpers pass strict mypy; targeted formatting/diff checks pass.
- [x] User reports everything working after testing the new network slice and
  requests commit/push. Record user-run live acceptance, not independently
  measured throughput or agent-observed artifact provenance. No frontend/OTA/
  framework build is required by this slice; the agent performed no transition.
- [x] Record user-requested mypyc-native-type pass immediately after PyO3
  optimization: hot reusable records, numeric loops and repeated dictionary
  accesses with clear benefits, not eliminating all PyObjects.
- [x] After boundary measurements, identify/approve bounded native-type candidates
  and verify compiled/interpreted behavior plus actual cost reduction. Keep
  runtime-inspected DTO/Protocol contracts compatible; no blanket rewrite.

### Async bridge feasibility — 2026-10-23

- [x] User requests pyo3-asyncio/uvloop usefulness investigation, then chooses
  Record findings only. Runtime and dependencies remain unchanged.
- [x] Upstream docs/0.28 manifest support uvloop and explicit loop/context binding;
  pyo3-async-runtimes 0.28 is the candidate matching the worker's PyO3 0.28.3.
  This is upstream evidence, not TE2/private-runtime/Android qualification.
- [x] Identify actual candidate: replace the parked spawn_blocking Future.result
  wait with awaitable completion while retaining existing domain-loop ownership,
  typed byte boundaries and accepted-work admission. Concurrent Future adaptation
  needs qualification; no proven speedup or shared-loop/GIL-removal claim.
- [x] Separately approve an isolated existing-path versus async-bridge probe on
  asyncio and uvloop, including cancellation/timeout/shutdown/context/codegen and
  bounded-concurrency costs, before choosing production dependency/runtime edits.
  Full design/evidence is in PLAN.md, Async bridge feasibility. Native-type audit
  remains scheduled; no automatic reprioritization by this research entry.

### Native-record and async-completion probes — 2026-10-23

- [x] User chooses Probe both; isolated crate/fixtures and documentation only.
  No production edits/dependency changes, runtime restart or activation.
- [x] Inspect actual generated C: PendingPush counters still use dictionary/
  generic integer operations; NativeSocketServer already has native fields.
- [x] Extract real queue AST, change only its private record representation;
  compare full outputs/coalescing barriers and cancellation/clear/reuse in source
  and real mypyc. Final compiled reductions 8.5–12.1% for queue-only fixtures;
  traced allocation peak ~64 KiB lower, not a process-memory/speedup claim.
- [x] Async source/mypyc × asyncio/uvloop: owning loop/context, result/error,
  deadlines, caller-drop permit retention and overload pass; bridge pending
  shutdown/stale-loop rejection passes. Occupancy during wait falls 1/16/64→0;
  latency mixed and short-call overhead remains, not a demonstrated global win.
- [x] Strict mypy for three probe Python files; isolated Rust release builds and
  formatting; production source/dependencies and user files preserved.
- [x] User subsequently approves N1 native queue record plus isolated RPC probes;
  see expanded stages below. Async bridge production adoption remains separate.
  Full domain/Android/private-runtime adoption and real lifecycle/transport
  parity are still gates.
  See DOMAIN_OPTIMIZATION_PROBE.md for exact methodology, evidence and limits.

## Expanded native-type stages — 2026-10-23

- [x] User requests cross-surface audit; clarifies traffic priority and UI-cache
  inclusion. Record N1–N5 inventory/order in NATIVE_TYPES_AUDIT.md.
- [x] Concrete approval: implement measured private WBA record; isolated editor/
  Explorer/host RPC metadata and direct-delivery comparisons; update docs only
  beyond N1. No runtime transition/full build/other production cutover.
- [x] N1 source native fields, missing-URI/counter regression; diagnostics/WBA/
  bootstrap tests 17 passed plus 2 subtests; stronger all-Any audit 249 files.
  Actual current queue-class/function AST passes source and real mypyc parity.
- [x] RPC metadata: 51 cases per source/compiled mode; direct delivery: 16 per
  mode. Small-message metadata gains modest/mixed; eliminating the temporary
  context map has the stronger local signal, but wide-decode cases are mixed.
  No whole-network/application performance claim. Probe Python strict checks pass.
- [x] N2a approved/implemented direct typed delivery through existing registered
  namespace trigger, retaining guard/decode and general lifecycle delivery.
  No Rust/queue/Future/wire/outbound/client changes. Thirteen tests pass including
  actual three-module mypyc submit/Future/adapter and error/cancellation parity;
  stronger audit passes 249 files. Updated production-AST microprobe passes 16
  cases per source/compiled mode, not a live network benchmark.
- [ ] N2b common/lane parsed metadata allocation reduction/schema-module split
  requires separate qualification and concrete production approval.
- [ ] N3 shared pipe-derived event/diagnostic records, then N4 retained caches;
  N5 search compile coverage/terminal follow-up only when justified.
- [x] N1/N2a user-built full-domain activation and live acceptance. User reports
  hot reload working, then confirms normal behavior and requests commit/push.
  Read-only verification: live worker PID 3590304 maps the compiled group plus
  native_worker/WBA modules from domain-35fb05ee0e41585e84d9ab34d34babbd7c7faa99bd128c29521447b90a1e7d18;
  selector integrity/source fingerprint reports current, FORCE_INTERPRETED=0.
  Reflection is disabled; no eval, additional build or runtime restart performed.
  This proves compiled activation, not a measured end-to-end performance gain.

## After the cutover — Code TE2 Any audit

- [x] Record user-provided root mypy_typecheck_errors.txt as the seed for the
  large strict/extra/all-Any-disallow typing pass. Preserve the report unchanged;
  it is currently untracked user work, not a generated file to remove.
- [x] Reconstruct the requested strict/extra/all-Any invocation against the new
  source with mypy 2.3.0/CPython 3.14.4; the original command/version are absent
  from the preserved report and cannot be claimed exactly reproduced. Initial
  baseline: 323 diagnostics/75 files, 297 outside tests and 26 in tests.
- [x] Investigate and obtain staged cleanup approval; prioritize typed callback,
  event/DTO, service and worker boundaries without Any/cast/suppression escapes.
- [x] First source slice: native FWS callbacks, namespace/editor/terminal transport,
  task lifecycle and lazy project/Git hooks. Eleven production modules pass
  stronger flags. Full check now reports 215 diagnostics/65 files: 189 outside
  tests, 26 in tests. Detailed command/scope: TYPING_AUDIT.md.
- [x] Grouped Python regressions: 163 tests and 15 subtests pass. Two stale
  prior-cutover project assertions now include the existing before_switch=None
  argument; production guards are unchanged. git diff --check and native-file
  rustfmt --check pass. No runtime/compilation/asset publication performed.
- [x] User separately approves fixing the discovered single-vs-list `skipSid`
  native delivery gap, with regression source but no rebuild/restart. Python
  adapters and native filter align; native test execution/activation remain open.
- [x] User approves first-slice checkpoint and continuation: local 039e38bf,
  no push/version bump. Preserve the three unrelated untracked user files.
- [x] Continue remaining DTO/event/state, build-helper and test-fixture groups;
  distinguish library-stub/unused-expression inference from actual dynamic DTOs.
- [x] Full strict/extra/all-Any command: zero issues in all 246 Code TE2 source
  files, including Python tests/build helpers. New root typed-ingress regressions
  independently pass the same flags. No Any/cast/ignore escapes or weaker policy.
- [x] Final combined owner regressions: 337 tests, 20 subtests pass. Validate
  valid/invalid legacy overlay ingress without importing native code, existing
  build command resolution, ASGI resources, state/diagnostic/History projections,
  draft/autosave/routing guards and terminal/marketplace fixtures. See TYPING_AUDIT.md.
- [ ] Separately approved native test compilation and mypyc build validation,
  activation and user live checks. The previously added Rust exclusion-list
  test remains source-only; stronger mypy success is not mypyc build success.

User reports interpreted modules running well. No compiled activation, frontend
publication or original-report edits; typing work does not authorize build-policy
changes, commits or restarts. Native/mypyc compilation is intentionally deferred.

## Startup recovery

- [x] Read-only investigation and concrete frontend scope approved.
- [x] Keep existing wire method/DTO and backend installation authority.
- [x] Startup-specific 60-second deadline; explicit waiting/retry/stop recovery.
- [x] Remove initial-failure fallthrough into a duplicate prerequisite request.
- [x] Strict TS and host build pass; 12 boot tests and five targeted real
  transport/host tests pass. Fake-clock test keeps the actual snapshot request
  alive past eight seconds, accepts unchanged old-server MessagePack, then
  verifies expiry at 60 seconds. Small hostState-only reads retain eight seconds.
- [ ] Broader transport suite: four unrelated TextMate fixtures fail because
  their mock window lacks location.search (unchanged production TextMate path).
  Two initial boot fixture omissions of required spinnerSetStep were corrected;
  no production dependency was made optional to accommodate tests.
- [x] User reports live startup validation is complete and passes (2026-10-20).
  No further publication/reload or repeated acceptance is an outstanding gate for
  this accepted slice; exact activated-artifact provenance was not separately audited.

## Pre-IPC Electron DevTools affordance

- [x] User approves button beside Home, detached DevTools, persisted visibility
  default off, tests/build/docs. No WBA change or Electron restart requested.
- [x] Implement main-process action with alive-target and enabled guards;
  app view first, launcher fallback. Button between Home and Reload.
- [x] Persist Show DevTools button in existing desktop settings; reflect saves
  in the title bar immediately. Shared native Android settings hide/omit option.
- [x] Strict Electron TypeScript, compile and 18 focused settings/DevTools tests pass.
- [x] Full Electron unit suite: 126 passed, zero failures/skips.
- [x] User live acceptance: “looking good”; requests checkpoint commit/push.

No version bump, editor/backend change, runtime restart or asset publication in
this affordance slice; native Electron relaunch is required, not editor OTA.

## Early language HTTP projection

- [x] User approves native route + backend projection + frontend early prefetch,
  with explicit 404 fallback to existing RPC. Release focus: drop-in optimizations.
- [x] Small no-store backend-owned status; no full snapshot/runtime start.
- [x] Begin HTTP before Explorer namespace; prepare intelligence before full
  snapshot, never seed partial UI preferences. Existing RPC remains supported.
- [x] Four HTTP tests cover unchanged projection, 404 caching per page, network/
  503/401/JSON/oversize errors and abort deadline with no implicit fallback.
- [x] 13 boot tests pass including real HTTP-before-Explorer/WBA-before-full-state
  ordering and 404 equivalent RPC fallback; no double WBA readiness on same mode.
- [x] Nine backend language tests pass including small projection isolation and
  unavailable error propagation. Strict mypy passes both changed Python files.
- [x] Three native HTTP/resource tests pass, including no-store success and
  503-not-404 backend failure. Cargo formatting passes. Validation compiled only
  test artifacts in the existing environment-selected Cargo cache; no activation.
- [x] Final strict TS and host build pass; 17 combined boot/HTTP tests and five
  targeted MessagePack/host transport checks pass. Existing module-type build
  warning remains visible. Authored-source whitespace check passes.
- [x] User reports the new initialization work passes live validation. This closes
  the live gate, not a claim of agent-collected timing or deployment hashes.

Branch: maintenance/0.2.356-startup-recovery. Existing .355 release-receipt edits
and unrelated untracked research_handoff.md/ty.toml preserved. No version bump,
runtime restart, mypyc/APK build, commit or publication requested. Native Cargo
test compilation is validation only and does not activate a production worker.

## Phases 2 and 3 — actual implementation workstreams

- [ ] Phase 2 / O1: source-backed framework-pipe/Sidebar IPC intent design,
  especially ALS <-> Code TE2; bounded implementation approval then delivery.
- [ ] Phase 3 / O2: source-backed concurrency, queue and DTO/PyO3-boundary design,
  bounded implementation approval then delivery.

Their testing/acceptance belongs within these phases; neither is implemented or
approved for blanket changes merely because the order is now recorded.

### O1 first slice — generic relay and backend app facts

- [x] User approves framework broker foundation and CWD/restore-state migration
  for Terminal/File Explorer/File Editor; ALS/mentions documented for next slice.
- [x] Extend the existing owned route/correlation registry with app.rpc.call and
  manifest service/version/caller/method policy. Framework derives source identity;
  target semantics remain app-owned, with no replay/socket fallback.
- [x] Code TE2 dispatches app.rpc.deliver on its existing bounded domain-loop
  adapter. Reuse CWD snapshot and Sidebar ledger/global projection owners.
  State publication requires an existing owned slot/token/URL and cannot activate
  clients, create slots or manufacture Sidebar registrations.
- [x] Replace the transient Python Sidebar socket helpers. Terminal/File Editor
  opt into existing HTTP-plus-pipe worker mode with outbound-only dispatch hooks;
  HTTP readiness, frontend sockets and terminal brokers remain unchanged.
- [x] Rust broker tests: 11 pass, including version/caller/method policy, opaque
  relay/correlation/error, pending limits, disconnect, timeout and late replies.
  Cargo formatting passes; target cache retained. This is test compilation only.
- [x] Final Python regression set: 195 pass across broker, app actions/ASGI,
  tabs, lifecycle, ordinary-worker and pipe tests. Isolated HTTP-plus-stdio worker
  proof passes: real HTTP action emits app.rpc.call, then consumes the correlated
  pipe reply. No live framework/ordinary app workers were restarted.
- [x] Strict mypy passes five broker/service/CWD files. Broader check additionally
  reports two unchanged baseline issues: terminal/backend.py dict.pop(None) type
  and File Editor's FileEditorError implicit re-export. Not new broker failures;
  no unrelated typing cleanup was included. Existing inactive-presentation test
  expectation now follows accepted document-open admission, with no behavior change.
- [x] Source-backed contract/limits and following ALS/mention acceptance semantics
  recorded in ../sidebar_app_intents/APP_RPC.md and CODE_TE2.md; repo memory synced.
- [x] User reports interpreted Code TE2 source and updated framework are working
  (2026-10-21), and requests checkpoint then ALS cutover. This records reported
  acceptance, not an agent audit of artifact provenance or compiled activation.
- [ ] New ordinary
  app workers, followed by CWD/new-tab, navigation/restore, cross-client state and
  closed-slot live acceptance. No host rebuild, OTA/APK, ALS cutover or shared
  framework restart authorized/performed in this slice.
- [ ] Next separately scoped ALS slice: readiness pipe dispatch/correlation,
  exact presentation/conversation proof and owner acceptance receipts; retain
  existing mention content policy and no uncertain insertion replay.

### ALS cutover investigation / plan recording — 2026-10-21

- [x] User chooses investigation before runtime activation, then approves recording
  the complete plan, explicitly retaining standalone socket integration with no
  socket fallback in framework pipe mode. No ALS implementation/restart approved.
- [x] Read sibling ALS AGENTS.md in full; source survey covers framework_pipe,
  lib/state/http startup, sidebar_ipc, ui_rpc, authenticated MCP IPC and UI client.
  Preserve sibling untracked dist/ and TE2 research_handoff.md/ty.toml.
- [x] Record full operation/event inventory, including project actions, CWD/focus,
  state publication, agent-review and three MCP draft methods—not only file opens
  and mentions. Existing frontend sockets and semantic owners remain in charge.
- [x] Record source-backed seams: readiness-only pipe needs async dispatch and
  request correlation; project open/create lack file-open's caller proof; socket
  peer checks cannot be replaced with fake registrations; control byte/deadline
  defaults need qualification for full draft/review and consent-bound operations.
- [x] User requires no new any/Any types: concrete DTOs, validated unknown/object
  ingress, no assertions/suppressions masking untyped boundaries. Existing broader
  typing laundry list remains separate unless a touched boundary requires repair.
- [x] Implementation stages, tests, mixed-version/standalone policy and activation
  gates documented in ../sidebar_app_intents/APP_RPC.md. No new test/build claims
  or acceptance inferred from this read-only investigation/planning pass.
- [x] Concrete Stage A edit/validation approval, then ALS bounded pipe foundation.
- [x] Qualify bulk/control limits and consent deadlines; approve Stage B semantic
  cutover with parity tests and any necessary caller-proof frontend changes.
- [ ] Joint ALS activation/publication and grouped live validation when connected
  model is ready. TE2 interpreted/new-framework acceptance is recorded above;
  ALS semantic pipe routing is implemented at source, not installed/live accepted.

### ALS Stage A — bidirectional pipe foundation

- [x] User approves typed envelopes/errors, bounded intake/dispatch/writer,
  request correlation, AppState startup wiring and isolated tests/docs. No new
  dependencies/any types, semantic exports, installation/restart, commit or push.
- [x] ALS framework_pipe is split into controller, protocol DTOs and runtime.
  Existing --stdio client is installed before build_router starts its CWD task;
  CWD and other Sidebar operations intentionally retain their existing lane.
- [x] Reader matches reply ID/correlation/opId while admitted async handlers may
  await reverse calls. Typed delivery/source validation, one-time handler binding,
  ten-second control-handler deadline and retained opId/project metadata.
- [x] Bound 16 pending outbound / 16 queued-running inbound calls; 64 KiB control
  params checked before queueing; incoming work reserves a 2 MiB encoded budget.
  Writer is 32 queued frames plus one write, sharing a 2 MiB budget. Output frames
  and serialized received control replies are capped at 1 MiB. These are not bulk
  draft/consent-operation budgets for Stage B.
- [x] Dedicated stdout writer acknowledges readiness after write/flush. EOF/error/
  close releases pending calls/admission and clears handler capture cycles; late
  replies are ignored. Required output failure closes; oversized result can emit
  a small error without reexecuting its handler. Completed tasks are drained.
- [x] ALS full Rust library suite: 172 pass, including 17 framework-pipe tests.
  No any/Any/dyn Any or new suppressions in changed Rust source; generic payload
  Value remains transport-only. Compiler warnings remain visible: existing
  embedded-python-adapter cfg plus dormant Stage A API/metadata dead-code warnings
  until semantic binding, not a claim of a warning-free production build.
- [x] Existing bootstrap regressions: 14 pass. TE2 wrapper pipe-readiness contract:
  one passes. Source packaging/fingerprinting already recurses into new .rs modules;
  no new package/build path was introduced. Scoped rustfmt/diff checks pass.
- [x] Final fresh debug native binary stdio regression after all source edits:
  six tests/two subtests pass using the exact Cargo output selected through
  ALS_TEST_SERVER_BIN. Readiness/HTTP serving, EOF, malformed input, unsupported
  request, occupied listener, SIGTERM and standalone behavior pass. With bootstrap
  and TE2 wrapper checks, 21 Python tests pass. No installed/active runtime changed.
- [x] User approves Stage B across TE2/ALS: existing operation owners, exact
  client/conversation routing, project caller proof, bounded bulk/deadline policies
  and regression builds. Installation, runtime restarts, pushes and new dependencies
  are excluded. Checkpoint: TE2 99ca2547; ALS 976a7a4, local only.
- [x] Stage B semantic owner wiring implemented at source; joint activation and
  live acceptance remain separate. Approved source work is not live traffic proof.

### ALS Stage B — receiver-policy prerequisite

- [x] Add generic receiver-declared, per-method request/reply/deadline limits;
  defaults stay 64 KiB/1 MiB/15 seconds. Validated ceilings are 8 MiB and 180
  seconds; unknown/undeclared policy keys and caller overrides reject.
- [x] Bound aggregate admitted serialized request/reply allowances to 32 MiB
  on each source and target route, retaining 16 outstanding calls and existing
  writer/frame limits. No waiting byte queue or mutation retry is introduced.
- [x] Final Rust broker suite: 15 tests pass, including unchanged defaults,
  method-scoped policy/caller-override denial, invalid bounds, shared byte
  saturation/release, self-calls, target-rejection rollback and complete UTF-8
  envelope sizing without content truncation. Scoped rustfmt/diff checks pass.
- [x] Qualify default versus full-model shapes: draft state carries content,
  diff and optional disk text; review can contain several source models. Selected
  8 MiB request/reply profiles and 60-second broker waits replace inadequate
  control budgets. UTF-8 fixtures above 1 MiB remain intact; oversized whole
  operations reject before delivery where known. This is synthetic qualification,
  not proof every possible project fits. Physical 32 MiB pipe framing is unchanged.
- [x] Bind actual TE2/ALS semantic owners and replace framework-mode socket
  traffic. Preserve standalone Socket.IO and no fallback/replay in pipe mode.

### ALS Stage B — semantic cutover source and validation

- [x] ALS chooses its backend transport from explicit --stdio, including CWD,
  state, file/edit/project, review and the existing three MCP draft operations.
  Closed pipes never construct a Sidebar socket. Startup CWD hydration follows
  the actual readiness write/flush, and failed listener binds emit no app calls.
- [x] Bind inbound mention/CWD/project/focus/review to existing AppState and UI
  owners. Require framework-derived Code TE2 source and explicit conversation
  for mentions; receipts expose owner operation/queued state, not render ACKs.
  Shutdown closes admission/reverse waiters before adapter/domain shutdown.
- [x] TE2 dispatches actual owners without fabricated SIDs; project caller proof
  is rechecked after switch-lock waits. ALS UI/backend preserve that same proof.
  Project UI/native/broker waits align at 190/185/180 seconds. Unknown outcomes
  never trigger retries. Minimal project facts omit unrelated boot snapshots.
- [x] Managed route inspection distinguishes absent apps from starting/stale
  routes. Reverse review excludes its originating app. Pipe mentions use exact
  client/slot/incarnation/conversation and never fall through to socket emission
  on timeout. Projection failures remain best-effort, not mutation retries.
- [x] Preserve full mention paths and reject excessive identity lengths instead
  of truncating IDs. Frontend sockets, terminal streams and native mappings remain.
- [x] Final focused Python suite: 157 pass, including the minimal-project-notice
  regression. Strict mypy passes seven
  production modules without new Any/cast/suppression escapes.
- [x] ALS full Rust library suite: 178 pass, including explicit-pipe CWD/status,
  closed-pipe no-socket behavior, actual bound composer/draft ownership, source
  denial, UTF-8 bulk receipts and pre-enqueue request/limit rejection.
- [x] ALS npm typecheck (including lint) and frontend build pass; 21 frontend
  file/project routing and project-control tests pass. No native-client reload.
- [x] Fresh isolated ALS debug binary: 20 native-stdio/bootstrap Python tests
  and two subtests pass, including readiness-first CWD, no framework HTTP/socket
  calls in stdio mode, EOF/corruption, listener failure, SIGTERM and standalone.
  Final post-shutdown-fence rebuild/recheck also passes the same 20 tests/two
  subtests. No installed runtime was used or replaced.
- [x] User approves local checkpoints and provenance-pinned ALS frontend snapshot
  refresh, without push/install/restart/OTA/version bump.
- [x] ALS checkpoint 3cc5e9f, then refresh the provenance-pinned frontend snapshot:
  149 resources verified with source/served hashes and --check. No dirty-source
  bypass, source maps in the snapshot, runtime publication or asset URL change.
  Ten ALS/native asset-mapping tests pass after updating their stale expected
  snapshot metadata from the previously vendored .138 to current ALS .139;
  no package version was bumped by this work.
- [ ] Approve matching framework/domain/ALS installation and exact worker refresh,
  plus native-client asset publication/reload. No active runtime changed so far.
- [ ] Grouped user live acceptance: multiple clients/conversations, in/out-of-root
  file opens, project switches/consent, mentions, review/MCP drafts and standalone.

2026-10-21: user reports Code TE2 running interpreted and working well; prioritize
the typing audit before another build. Agent performs no runtime transition.

Current changes are source-only. No version bump, installation, shared restart,
OTA/APK publication or push was performed. Existing compiler cfg/dead-code
warnings remain visible, without suppression. Preserve unrelated reports/dist.

## Phase 4 — native debug / internal bridge retirement (documentation only)

- [x] User approves read-only investigation; confirms implementation is NOT now.
  Initial placement immediately after startup was superseded: user requires two
  actual work phases first (intents, then concurrency/queuing).
- [x] Confirm both TE2 bridge copies serialize all hooked log levels; central
  console appends/broadcasts them. Find backend runtime_debug bootstrap metadata
  and existing console:registered reply as potential policy channel.
- [x] User supersedes filtering-only direction: first-party framework apps leave
  console bridge; native on-device debugging/logging serves internal tools.
  Bridge remains available for developer/user apps. User requests PLAN ONLY now.
- [x] Record Cefrium CDP and user-identified Gecko CHI interface; actual protocol/
  bindings/parity remain unverified until the deferred investigation.
- [ ] Inventory existing native debug APIs and socket/MCP pathways; qualify
  authenticated remote-client access and exact target/context lifecycle.
- [ ] Define Electron/generic-browser and older APK/server compatibility before
  removing any first-party bridge registration. No implicit reinjection fallback.
- [ ] Inventory all framework/ALS/native/Node producers and imports; scope ALS
  upstream source/snapshot updates independently, preserve developer wrappers.
- [ ] Approve concrete implementation/cutover when this phase is resumed.
- [ ] Prove native discovery/eval/on-demand logs, disconnect/detach fences and
  bounded transfer, then remove first-party bridge wiring at source.
- [ ] Prove developer bridge discovery/log/eval remains working and internal
  automatic bridge traffic is absent; approve builds/publication/live acceptance.

Earlier warn/error filtering and registration-policy findings remain investigation
history, not the current implementation plan. No console/native code changed.

## Optimization agenda intake (O1–O8; schedule above)

Initially recorded while user tested initialization (now accepted). PLAN.md O1–O8 owns
scope, relationships and gates; unchecked entries below mean investigations are
not done, not failed acceptance or approval to implement all items.

- [x] Preserve the user's complete optimization agenda in this release plan.
- [ ] O1: Framework-pipe intents / Sidebar IPC consolidation, especially
  ALS <-> Code TE2; reconcile earlier deferred work and exact-client ownership.
- [ ] O2: Pipe multiprocessing/multithreading, bounded in-process queuing and
  Code TE2 DTO/PyO3 handoff; identify actual backpressure and ordering needs.
- [ ] O3: Transparent socket routing through pipe DTO envelopes, avoiding
  network proxy hops where measurements justify it.
- [ ] O4: FlatBuffers / Cap'n Proto pipe codec comparison and compatibility proof.
- [ ] O5: Shared Rust source/runtime libraries, binary/build savings and direct
  pre-envelope *ops DTO reuse without duplicating framework authority.
- [ ] O6: Selected critical localhost streams over Node IPC on desktop/mobile,
  with explicit local capability and preserved remote paths; WBA candidate.
- [ ] O7: Frontend Cap'n Proto packed-stream proof over Socket.IO binary frames;
  initialization/CRUD first candidate, WBA/schema suitability still undecided.
- [ ] O8: WBA raw-socket/internal-client-ID experiment, ALS history pattern
  comparison, and separately measured MessagePack/compression trade-offs.
- [x] O9 intake: trace early provider registration/resync traffic, distinct from
  TextMate/Markdown. Full replay broadcasts and full snapshot hydration are both
  present. Source evidence and correctness gates recorded in PLAN.md.
- [ ] O9: approve/implement document-relevant, per-client provider publication
  with lazy hydration and bounded replay/snapshot behavior; preserve full registry.
  User explicitly defers WBA work when moving to Sidebar/intent work; not next.
- [ ] Choose next bounded investigation and obtain implementation approval only
  after source-backed design/evidence; no codec/library/transport cutover yet.

No new builds, dependency changes, cross-repo edits, runtime transitions, commits
or publication performed by this documentation-only intake.

## Additional repair — Aria Downloader (later)

- [x] User reports app is pretty broken; record repair for .356.
- [x] User explicitly selects record for later, not immediate investigation.
  IPC remains next; later placement is not yet chosen.
- [ ] Resume with current-source/runtime triage and a concrete repair plan;
  historical 502/stale-shell issues are leads only.
- [ ] Approve and implement bounded fixes, regression tests and live acceptance.

No Aria source/log investigation, restart or download/shell mutation performed.

## Sidebar/intent intake — after accepted checkpoint

Current source inventory (not a completed migration):

- Terminal backend: sidebar.cwd.get and sidebar.window.state.update; own transient
  Socket.IO client with register/call/disconnect in backend.py.
- File Explorer backend: same operations through app.libs.sidebar_rpc; durable
  tab/path/splash projection remains app-owned.
- File Editor backend: sidebar.window.state.update through app.libs.sidebar_rpc;
  file identity/validation remains app-owned.
- ALS Rust backend: sidebar_ipc.rs includes file open/edit, agent-edit publish/
  clear, project lookup/open/create and CWD/other integration; audit full surface
  before defining cutover scope. Source is sibling repo, no edits there yet.
- Code TE2 owns /sidebar_ipc; its host frontend also uses that namespace for
  registration/presentation/control. Preserve these frontend lanes separately
  from backend-to-backend transport retirement.
- Native Electron uses UI IPC (/ui_ipc), not a native /sidebar_ipc client.

No direct backend Sidebar IPC caller found in current Archive Manager/Aria source
survey. This is built-in source inventory, not a scan of user-installed apps.
Existing production framework app-intent pipe already handles selected document/
app/project/terminal intents; expand existing owners, not a new bus.

User authorizes checkpoint/push of accepted startup/DevTools work and planning/
release receipts. Preserve research_handoff.md and ty.toml unstaged. WBA remains
unchanged/deferred. Next: deepen the Sidebar/pipeline contract audit and propose
bounded implementation; no migration implementation or shared restart yet.

## Deferred — standalone Terminal headless projection

- [x] Record user report: standalone Terminal is comparatively janky; consider
  misconfiguration/restoration before replacing its headless implementation.
- [x] Confirm source ownership: standalone uses xterm-headless/SerializeAddon;
  File Explorer owns a separate Node PTY worker and uses shared neutral Pyte
  checkpoint projection. Browser xterm.js is a separate component and stays.
- [ ] On separate approval, reproduce bounded output/resize/reload/reconnect
  sequences and audit headless configuration, serialized modes/cursor/colors and
  restore ordering. Identify a minimal fix if possible.
- [ ] If unresolved, qualify shared Pyte as the standalone headless projection,
  retaining app-owned shell/session/transport and direct live-output semantics;
  no cross-app backend reuse. Compare fidelity, resource cost and restore parity.
- [ ] Approve the selected bounded repair/replacement and its tests/live checks
  before implementation. Planning only; no runtime/source changes in this slice.

## Deferred — ALS renderer-owned Markdown file actions

- [x] Read-only live investigation: raw APP_RPC.md filesystem href/#L198 is
  correct; line-hash parser recognizes it and routing is bound. Native long-press
  menu shows normal origin-resolved .href, not the RPC destination.
- [x] User confirms ordinary Markdown file-link clicks now open correctly;
  distinguish this from the corrected compiled pipe receiver schema issue.
- [x] User explicitly chooses end-of-plan deferral; no ALS frontend/source,
  build, vendored snapshot, OTA or runtime changes performed for this item.
- [ ] On separate approval, classify file links during rendering and emit
  explicit path/line/column file actions using existing own-backend RPC only on
  activation. Preserve web URLs, streaming/final/replay parity, accessibility and
  exact-client proof; prevent misleading localhost link-menu destinations.
