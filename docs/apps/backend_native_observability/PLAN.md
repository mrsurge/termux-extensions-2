# Backend And Native Observability

Branch: `feature/backend-native-observability`.
Baseline: `ee0c0f1a`, main after the 0.2.349 release publication.

## Purpose And Scope

Carry forward the deferred work from `docs/apps/source_control_graph/TRACKER.md`
without reopening its completed feature work. Build reusable backend/native
inspection first, use evidence to address remaining performance and lifecycle
issues, and retain extension-provided themes as a separately gated later phase.

This document authorizes planning, not every implementation described below.
Each phase starts with source inspection and a concrete edit/validation scope.
Native changes, builds/installations, publication/version changes and shared
runtime restarts require explicit approval for that slice.

## Carried-Forward Evidence

- Backend scheduling/blocking and retained Python projection memory need direct
  measurement. Previous lag fixes do not prove all workloads are now healthy.
- `project_sidecar.py` still contains LSP configuration APIs. Their presence is
  verified; whether individual fields/methods are obsolete requires caller and
  persisted-schema inspection. WBA remains intelligence authority.
- Gecko's intermittent missed-input incident disappeared after a device restart.
  The user reported that cache clearing and force-quitting Gboard/the app did not
  clear it before that restart. Suggestions flashed/disappeared near lost input.
- Earlier browser probes recorded missing characters absent from DOM input/key
  events; changing textarea geometry and bypassing the Ctrl helper did not fix
  that incident. This does not identify Gboard, Gecko, TE2 or Android as the cause.
- Spacebar-slide selection synchronization and the command/symbol inspector work
  are completed and live accepted. They are not this unresolved typing issue.
- The existing native console worker accepts structured commands. It is an
  integration point, not an already-general Kotlin evaluation facility.
- Theme loaders/converters exist. Complete extension-theme compatibility has
  not been established; webview theme behavior is a separate contract.

## Invariants

- Rust owns framework lifecycle, Git/filesystem/search and process orchestration.
  Python owns Code TE2 app state/orchestration; WBA owns intelligence. Debugging
  must observe these boundaries, not create duplicate providers or authorities.
- Extend existing pipe/control-plane and native console/ADB transports. Do not
  start a second debug listener or route ordinary app traffic through debugging.
- Diagnostic capture is opt-in and bounded by explicit count/byte limits. Record
  dropped/truncated entries; avoid polling and per-keystroke socket/log floods.
- Observation must not reset input, rewrite text, clear drafts or erase the bad
  runtime state. Explicit state-changing debug experiments remain available,
  separately invoked and clearly reported; this is not a read-only-only design.
- Debug evaluation is trusted code execution, not a sandbox. Define enablement,
  caller/target identity, availability and teardown before exposing it. A request
  timeout does not establish that arbitrary evaluation stopped or rolled back.
- Preserve Android's guarded textarea, composition/Ctrl/229 behavior and native
  asset authority. Do not diagnose a cache or renderer problem without evidence.
- No multiprocessing migration, language rewrite or broad legacy deletion as a
  substitute for locating the blocking operation and proving a targeted fix.
- Keep durable verified contracts in CODE_TE2.md and condensed repo memory;
  tasks, hypotheses, traces and acceptance records belong here/in TRACKER.md.

## Phase 1: Runtime Map And Diagnostic Contract

Map current runtime ownership and available command surfaces before designing
extensions. Inspect Python worker dispatch, framework pipe/MCP routing, native
console command parsing and thread dispatch. Inventory existing memory/debug
helpers, including `docs/apps/framework_memory_profiling/README.md`, rather than
assuming earlier profiling proposals were implemented.

Define typed request/result envelopes, exact worker/client targeting, startup
opt-in and runtime flags, bounds, cancellation/disconnect behavior and structured
errors. Specify which operations run on Python's event loop or Android's UI
thread, which bounded work may run elsewhere, and how dangerous experiments are
explicitly invoked. Preserve ordinary request ordering and state ownership.

Exit: source-backed interface proposal and approved first implementation slice.

### Selected Control Path (2026-09-15)

Use one execution path for CLI and MCP:

```text
te2 framework eval / te2-mcp framework-eval tool
  -> existing Rust framework listener/control plane
  -> exact running app-worker stdio pipe
  -> selected Python app's live event loop
  -> correlated result through the same route
```

Keep `te2 console` for its existing browser/native console role. Do not register
Python app workers as JavaScript console workers or evaluate in the FastAPI
console relay process. CLI and MCP share target resolution, transport, errors
and bounds. Add worker discovery/capability reporting alongside eval; accept code
from an argument or stdin in the CLI. Target a live app/shell instance, not just
a reusable PID or ambiguous label; reject stale identities after restart.

The initial source audit found these concrete prerequisites:

- `app/cli/run_rust_framework.py` already dispatches `te2 console` before bootstrap;
  add the framework subcommand beside it, not as another server startup mode.
- `framework/bootstrap/bootstrap.py` reserves `--debug` / `TE2_SERVER_DEBUG` for
  the unoptimized build. Use `--runtime-debug` / `TE2_RUNTIME_DEBUG` for runtime
  inspection, independent of release/debug binaries. Propagate explicitly through
  bootstrap, framework launch environment and participating Python workers.
  Enforce opt-in at both framework dispatch and worker execution, not just the UI.
- `app_worker_pipe_bridge.rs` currently ignores non-request stdout frames. Add
  bounded pending-request correlation, response routing and lifecycle rejection
  using its existing pipe writer; do not introduce another stdout reader.
- `app/libs/app_worker.py` currently dispatches incoming requests synchronously
  on the stdin thread. `pipe_runtime.dispatch_request` runs awaitables through
  `asyncio.run`, which is not the app's live loop. Schedule debug work onto the
  captured app loop without blocking the pipe reader. Reuse one serialized output
  writer so eval replies and app-origin service requests cannot interleave.
- `--memory-profile` and `app/memory_profile.py` already provide controlled
  Heaptrack/tracemalloc/SIGUSR2 capture. Reuse applicable primitives; runtime eval
  must not implicitly enable heavy memory profiling or require Heaptrack.

Support explicit state-changing evaluation as well as inspection. Timeout is a
waiting bound, not proof that execution stopped: never retry automatically or
claim rollback. Keep arbitrary code execution trusted and explicitly enabled.
Finalize concrete payload limits, admission limits, authorization and result
serialization during implementation design; no unbounded retained object handles.

### Public Evaluation Contract

The approved initial facade uses the existing Rust listener at
`/api/runtime-debug/workers`, `/status` and `/eval`. Runtime-debug must be enabled
on framework and worker. A fresh per-start bearer credential is atomically stored
in the private runtime directory as `runtime-debug-<port>.json` (0600). It rotates
on startup; a stopped instance's retained file is inert. The local CLI reads it
only for its exact loopback framework URL. Remote CLI use supplies
`TE2_RUNTIME_DEBUG_TOKEN`; MCP tools require an explicit `credential` argument,
never silently borrowing the local token. Do not send credentials over untrusted
plain HTTP or paste them into logs; use a trusted tunnel for remote access.

Targets contain appId, shellId and random bridge instanceId. Evaluation accepts
at most 32 KiB UTF-8 source, waits 1-30 seconds, and uses a fresh request scope
with `backend` (the live module), `asyncio` and lazy `inspect_runtime()`. Expressions
return their value; statements assign `result`; top-level await is supported.
Actual object mutations persist, but scratch variable bindings do not. This is
trusted Python with builtins, not a sandbox. Synchronous code can block the worker.

Projection is limited to JSON primitives and exact built-in dict/list/tuple
containers: at most 2048 traversal units, depth 12, strings clipped to 4096
characters and a 64 KiB encoded result ceiling. Cycles/unknown objects/limits are
explicitly marked as truncated rather than invoking arbitrary repr/property code.
stdout is not captured and remains worker logging. No retained object handles,
automatic retries, or promise of cancellation/rollback on timeout.

## Phase 2: Python Evaluation And Memory Inspection

Add opt-in runtime evaluation/reflection using the existing control plane. Make
it usable from existing developer tooling/MCP where appropriate; do not mistake
frontend console evaluation for access to live Python worker objects.

Import Python `inspect` lazily inside the requested inspection capability.
It is standard-library, not a pip dependency; nevertheless, handle ImportError
as a structured capability-unavailable result rather than crashing worker startup.
Do not add a global mandatory inspection import as part of this feature. Keep
unrelated existing imports alone. Evaluation that does not need inspection must
remain usable, and tests must cover both successful and unavailable lazy loading.

Provide bounded inspection of retained search sessions, projection membership,
task/queue state and relevant ownership/lifecycle metadata. Establish memory
measurement semantics explicitly:

- Object/session counts describe cardinality, not memory.
- Serialized bytes describe payload size, not heap usage.
- Shallow/deep object-size estimates must account for shared references/cycles
  and report traversal limits; do not double-count them as exact retained bytes.
- Allocation tracing and process RSS are different measurements with different
  costs. Label scope, timestamp and units; capture baselines and post-disposal data.

Expose snapshot/export/clear and flag state without unbounded repr/text output.
Heavy sampling must not block routine dispatch. Test disabled behavior, opt-in,
errors, identity, truncation, cleanup and explicit state-changing actions.

Exit: a tested diagnostic surface able to answer what is retained and where work
is waiting, without changing production semantics merely by being installed.

## Phase 3: Scheduling Evidence And Sidecar Cleanup

### Approved Startup Optimization Slice

Checkpoint the current diagnostic implementation before changing startup behavior.
Measured warm-worker preparation was 16.01 s (5.36 s code-server ensure followed
by 10.65 s adapter ensure); a separate fresh Python worker reached lifespan-ready
1.86 s after main entry. These are not browser-paint measurements.

1. Supply a private absolute `NODE_COMPILE_CACHE` directory through the managed
   code-server shell environment on Termux and standalone Linux. Verify the actual
   runtime's support and cache production/reuse; enable it for Node-backed WBA
   without requiring or misidentifying Bun as Node. Do not use the string `1` as
   a boolean or create cache directories in the user's project. Cache failure
   must not become an installation prerequisite. Preserve managed launchers and
   version-separated Node cache behavior; do not promise first-launch speedups.
2. Remove intelligence readiness from the browser document-display critical path.
   Preserve installation consent and web-worker mode, launch errors/status,
   draft materialization, exact-client state, and existing WBA reconnect/open
   replay. Mount/render Monaco while runtime preparation proceeds independently;
   do not replace backend authority with browser-owned open membership.
3. Advance runtime preparation to the earliest safe existing worker lifecycle
   boundary and start WBA without requiring a browser readiness baton. Inspect
   prerequisites before moving work: settings/registry preparation must precede
   launch, and concurrent callers must join one launch. Keep shell ownership in
   Python orchestration/FWS; do not add a second launcher inside WBA. If launch
   before Python import would require a new framework contract, document that
   boundary and obtain separate approval rather than bypassing it.

Use focused Python and frontend lifecycle/order tests, strict typing, and a frontend
build. Record cache capability evidence separately from performance measurements.
No shared framework restart, shell termination, Android bundling, version bump,
or cold-cache cleanup is authorized by this slice. User-triggered restarts and
live acceptance will measure the resulting display/intelligence separation.

Reference: Node module compile-cache documentation and code-server v4.130.0
`ci/build/code-server.sh` (standalone launcher execs bundled Node with inherited
environment). Cached compilation does not replace extension activation or WBA
connection work; inspect those independently if they remain slow.

### Next Investigation: Parallel Intelligence Startup

Investigate this before the larger lifecycle/networking experiment. The current
`main._prime_code_server_runtime` awaits code-server before calling WBA ensure;
WBA ensure combines spawn, stdio ping and `adapter.connect`. The adapter's own
listener and `te2.ping` are independent of workbench connection, so process boot
can potentially overlap code-server boot. This is a source-backed opportunity,
not yet a measured improvement or authorization to change runtime behavior.

Proposed stages:
1. Resolve/validate the managed installation, generated extension/RPC settings
   and canonical UDS target before spawning. Preserve consent and worker mode.
2. Launch code-server and prepare the WBA process concurrently, retaining each
   service's single-flight ownership. WBA preparation ends at a responsive pipe;
   it must not publish intelligence-ready or dispose an already valid session.
3. Await code-server readiness asynchronously, then connect the prepared adapter
   once. Prefer the existing output subscription as the normal trigger.
4. Investigate an adapter-owned UDS readiness check for missed startup output or
   adoption. A path existing is not enough: verify a successful service-level
   exchange. Any bounded startup-only retry requires an explicit decision; no
   perpetual polling, busy waiting, or blocking the worker/adapter event loop.
5. Publish connected readiness only after the real workbench handshake succeeds.

Handle timeout/process exit, stale sockets, project changes, cancellation, live
shell adoption and simultaneous browser/worker callers. Current code-server
output-readiness timeout continues with a warning; do not treat this as proof of
readiness in the staged design. Adoption failure while merely waiting must not
cause kill/relaunch churn. Instrument process-ready, dependency-ready and
workbench-connected separately. Compare cold/warm startup, text latency, total
intelligence latency and peak memory on mobile; simultaneous boot may contend.

### Gated Experiment: Application Lifecycle Outside Networking

Keep this after the intelligence-startup investigation. Separate application
ownership from FastAPI before deciding whether to remove Python networking.
The application worker owns state, service initialization, task supervision,
subscriptions, DTO production and shutdown. A thin networking adapter owns
connections/authentication, encoding and delivery. Transport-ready, app-ready
and intelligence-ready remain distinct; early connections cannot imply usable
application state. Run-profile shells remain owned by Code TE2's lifecycle.

First audit FastAPI lifespan hooks, dependencies, request/socket objects and
loop-bound state. Define explicit startup/stop and typed request/event/client
lifecycle contracts using ordinary asyncio. Evaluate an independently launched
FastAPI process, booting in parallel with the application worker, against the
existing Rust networking/pipe facilities. A second loop/thread alone does not
remove import cost or guarantee parallel initialization; aiorun is an optional
lifecycle convenience, not a performance requirement.

First implemented boundary: networked `app_worker` runs paired optional async
`te2_app_start` / `te2_app_stop` hooks around Uvicorn transport service, inside
its signal-capture scope. Code TE2 moves project/session initialization into
startup, owns the independent eager intelligence task, and stops FWS observation
before a bounded fact-bus drain. Cleanup also covers partial startup failures.
The configured Uvicorn loop factory, readiness publication, socket routes and
Monaco/WBA readiness gate remain unchanged. Keep a subprocess regression test
for the Uvicorn `_serve` integration because signal re-raising must happen only
after app cleanup. This slice does not remove FastAPI imports, move networking
to another loop/process, migrate pipe-only workers, or establish latency gains.

Use existing supervised shell/pipe ownership rather than an unmanaged child
process or new eval port. A multiprocessing prototype is a decision-gated
alternative, not a committed transport. Never fork live loops/connections.
Bound queue depth/bytes and concurrent dispatch; correlate requests independently
of notifications. Only explicitly replaceable, revisioned state DTOs may coalesce
in an asynchronous accumulator. Preserve command/edit ordering and completion;
never silently merge/drop editing operations or replay uncertain mutations.
Specify disconnect, cancellation, slow-client backpressure, adapter failure and
shutdown behavior. Keep credentials and runtime-debug opt-in at the boundary.

Use runtime eval plus retained timing records to investigate failures. Measure
cold readiness, import cost, event-loop responsiveness, IPC cost, peak memory and
first-use latency. Prototype one lane without changing its frontend contract;
do not migrate all lanes or remove FastAPI until evidence and separate approval.

### DTO Boundary Follow-Up (Resumed)

The lifecycle checkpoint is live accepted. Keep the present networking process:
no multiprocessing cutover is needed for current performance. Explorer already
uses application-owned facts, generation guards and projectors; reuse these,
not a second event bus. The remaining extraction is completed DTO plus logical
recipient -> injected delivery -> connection lookup and wire encoding. Preserve
the single-backend/single-project shared working set and existing all-client
fallback; foreground focus remains client-specific. The first slice removes the
Explorer JSON text round trip: registered `ExplorerConnection` implementations
accept completed message mappings through `send_message`, and the Socket.IO
adapter alone encodes notifications. Pending replies retain their acknowledgement
path. The existing manager supplies project/client/personal recipient lookup;
no parallel event bus or queue is introduced. Routing tests inject recording
connections without requiring live sockets.

The next bounded slice extracts editor connect/result orchestration into
`monaco_editor/editor_session_service.py`. Bootstrap snapshot, adapter-state and
open-state publication retain their order and existing mandatory/best-effort
semantics. Result-derived notifications use logical connection/client recipients
and precede the reply. The adapter still owns authentication, room membership,
identity registration, wire encoding, request dispatch wiring and error envelopes;
this is not full editor transport removal. Snapshot readers and delivery functions
are injected, and the service imports neither FastAPI nor Socket.IO.

Next, extract remaining editor delivery/envelope coupling and Sidebar transport coupling.
Audit actual HTTP consumers before replacing or removing FastAPI routes. Keep
Uvicorn/Socket.IO in the same process during extraction; a thin ASGI transport
replacement is a separately approved phase, not a prerequisite for this slice.
Validate untrusted input at the boundary even when internal DTOs are statically
typed. FastAPI removal from Code TE2 does not remove the Terminal/MCP Pydantic
dependencies. Only after the service boundary is stable, evaluate selective
mypyc compilation with measured hot paths; compilation and multiprocessing are
not part of this change. The pipe codec change below is a separate workstream.

### MessagePack Process-Pipe Cutover (Approved)

Pin Python Framework-Shells 0.0.64 from tagged commit `7e86f1c` and Rust
Ferrous Framework 0.2.14 from tagged commit `4cdf5db`. These presentation
follow-ups add bounded sliding log windows, live-tail pinning and
collapsible/resizable log panes. Integration consumes the published FWS wheel
and Ferrous release tag rather than either former feature-branch revision.

1. Framework/app-worker pipes use concatenated MessagePack maps instead of
   JSON lines. Preserve the JSON-RPC-shaped envelope, correlation, cancellation,
   debug dispatch, bounded writes and request ordering. Decode arbitrary chunks,
   bound frames, reject malformed/truncated data without guessing resync points.
2. WBA stdio uses structured MessagePack records for replies, pushes and startup
   beacons, replacing text prefixes. Human diagnostics remain on stderr.
   Use FWS live binary stdin under the existing writer lock, as Terminal does;
   its text-only `write_to_pipe()` cannot carry these frames. Bundle the stream
   decoder separately from the codec served to extension webview browsers.
3. Declare `log_codecs: {stdout: messagepack, stderr: text}` only for protocol
   stdout. Do not relabel ordinary PTY/text shells or change browser sockets.
4. Preserve Terminal's existing uint32-BE length-prefixed MessagePack Node pipe.
   Extend both FWS observation implementations with explicit framing support;
   the new default MessagePack log reader expects concatenated objects. Keep
   large-frame boundary indexing independent of the 1 MiB preview parse budget,
   preserving Terminal's 32 MiB transport limit. Follow-up dependency commits
   need independent validation and exact downstream pins before publication.
5. Validate cross-language fixtures, fragmented/coalesced frames, EOF, malformed
   inputs, byte limits, ordering, startup/debug lanes and inspection projections.

The standalone Terminal app worker is currently a proc shell, not a framework
pipe worker; its Node terminal-stream child is the binary pipe. Text PTY streams,
native VS Code protocols, HTTP/Socket.IO formats, Android assets and version
numbers remain unchanged. No shared runtime restart or dependency installation
is authorized implicitly by source/build validation. Old/new pipe endpoints
must be deployed together, including already-running WBA shells.

### External Rust CPU Profiling Details

Use optional external sampling tools rather than adding a Rust reflection or
interpreter runtime. Prefer Samply on desktop Linux for interactive call trees,
thread timelines and source views; retain perf/cargo-flamegraph as a simple SVG
workflow. Investigate Simpleperf first for native Rust capture on Android/Termux.
Desktop support does not establish Android compatibility: verify executable
availability, kernel perf-event access, SELinux/process permissions and usable
stack unwinding on the actual device before committing to a capture backend.

Profile optimized binaries with matching retained debug symbols, recording build
identity and symbol provenance. Reuse an appropriate existing optimized profiling
build where possible; do not silently select the unoptimized --debug build or
enable allocation profiling alongside CPU sampling.

Expose bounded capture, status and artifact retrieval through shared CLI/MCP
control-plane methods, gated by --runtime-debug / TE2_RUNTIME_DEBUG. Define exact
process-instance targeting, explicit duration/rate/output limits, cancellation,
concurrency limits and profiler-child cleanup without terminating the target.
Profiler dependencies remain optional; unavailable tools/permissions produce clear
capability errors. No automatic kernel security changes or profile uploads.
Do not add another public debug listener; any local viewer is separately invoked.

Keep raw captures and derived reports local with bounded retention and metadata.
Validate each selected tool's export/import and symbolization workflow before
promising interchangeable JSON artifacts. CLI/MCP should return artifact metadata
and bounded retrieval, not unbounded profile JSON in routine responses.

CPU sampling identifies executing hot paths, not all sources of latency. Samply's
documented Linux capture is on-CPU only; retain correlated queue/service/wait
timings and distinguish those from CPU cost. Measure capture overhead with a
repeatable workload and keep sampling inactive by default.

Upstream references for implementation qualification:
- https://github.com/mstange/samply
- https://github.com/flamegraph-rs/flamegraph
- https://android.googlesource.com/platform/system/extras/+/refs/heads/main/simpleperf/doc/README.md

### Scheduling And Cleanup

Use the new inspection surface to separate ingress delay, queue wait, synchronous
execution, external-service wait, projection publication and frontend delivery.
Correlate requests with monotonic timestamps/identities; do not subtract clocks
across devices without alignment. Reproduce on the mobile host when possible.

Inventory sidecar LSP fields/no-op paths with callers, serialized consumers and
migration requirements. Remove only proven obsolete behavior, preserving unknown
user data and remaining live settings. Do not resurrect a Python LSP provider.

Apply small evidence-backed fixes with before/after latency and retention data.
Test ordering, supersession, close/project-switch/disconnect cleanup and latest
projection delivery. Distinguish intentionally retained working sets from leaks.

Exit: documented findings and targeted corrections, or an explicit evidence-based
decision that a suspected path needs no change. No invented performance claim.

## Follow-Up: Android Second Editor Regression

User report and follow-up (2026-09-19): the second editor window does not open in
either the GeckoView or Cefrium APK. This supersedes the original GeckoView-only
observation. Investigation is deferred at user request. A change on or after the
last release is suspected, but neither the regression commit nor its cause is
established. Shared frontend/Python source may be responsible, so do not assume
a native-only defect. Compare opening intent, backend routing/state projection,
and secondary-editor presentation with a working client before choosing a fix.
This records an investigation item, not an approved Android edit/build scope,
and is independent of the live-accepted Explorer DTO delivery slice.

## Phase 4: Android Native Debug Runtime And Deferred IME Diagnostics

First ship the general-purpose debug-only dispatcher for both GeckoView and
Cefrium: console JSON and permission-protected ADB ordered broadcasts use the
same main-thread inspection/mutation path. No new network listener. Debug builds
disable minification; release/staging retain only inert registration/dispatch
seams. Java reflection provides exact-signature invocation, Kotlin reflection
provides optional metadata, and bounded weak handles avoid retaining activities.
General command/root lifecycle tracing is included; low-level Gecko IME tracing
below is subsequent work, not a prerequisite for this foundational slice.

Extend the debug-variant native command path to inspect the live activity/view,
input connection and filter. Evaluation/reflection and controlled actions should
be usable for experiments, not arbitrarily limited to formatted read-only dumps.
Choose concrete native APIs and thread boundaries during the approved design.

Use Java reflection for live-object field inspection and method invocation, with
`org.jetbrains.kotlin:kotlin-reflect` where Kotlin-specific property/function
metadata is useful. Native evaluation here means operating on existing runtime
objects through structured commands, not compiling or interpreting arbitrary
Kotlin source. Keval is excluded; no math-expression parser is needed.

Define exact object targeting, argument conversion, overload resolution, bounded
result serialization and explicit mutation/invocation actions. Report inaccessible
members and invocation exceptions accurately. Reflection does not bypass Android
platform access restrictions; use explicit app-owned diagnostic hooks where needed.
Do not retain obsolete activities/views through unbounded debug object handles.

Keep new inspection seams and kotlin-reflect in debug source sets/dependency
configurations. Release variants must not depend on the new library or expose
these commands. Reuse existing native console endpoints and marshal view/input
operations to the UI thread. Existing release console commands remain unchanged.
Align kotlin-reflect with the app's Kotlin version; validate Android compatibility,
dependency resolution, debug functionality and release exclusion.

Provide enable/disable, snapshot/export/clear and optional logcat output. Record
connection creation/replacement/closure, focus, restartInput, selection/cursor
notifications, batch edits, commit/composition, deletion and sendKeyEvent calls,
including outcomes and sequence/connection identity. Raw text is separately opt-in.

Retain bounded records locally and export on request rather than streaming every
keystroke. Correlate with hidden-textarea events and selection offsets, accounting
for clock differences. Controlled filter/IME experiments report prior/current
state and restore it where possible; document irreversible actions explicitly.

Validate normal typing, stuck-composition/229 safeguards, disabled-path overhead,
activity recreation and debug-only exposure. On recurrence, capture before any
restart. Compare Cefrium using the same observation semantics as needed; require
additional scope approval if its native source must change.

Exit: useful diagnostic tooling can be accepted even if the intermittent bug is
not reproducible. Never mark that bug fixed solely because capture works.

## Phase 5: Extension-Provided Themes (Decision Gate)

Keep this deferred item visible, but do not let an unbounded theme project hold
the observability work indefinitely. Investigate after the core diagnostics;
decide explicitly whether to implement here or transfer to a named follow-up.

Audit extension theme contributions, installed catalog/resource delivery and
existing preferences. Inspect the pinned Code Server/VS Code services for JSONC,
relative includes/inheritance, token colors and semantic rules. Reuse supported
contracts instead of treating raw extension JSON as a resolved Monaco theme.

Define application to Monaco/TextMate and working/historical secondary editors,
missing/uninstalled themes, reconnect and stale asynchronous loads. Preserve
local asset rules. Separately decide whether WBA webviews should follow editor
themes; their fixed GitHub Dark palette must not change implicitly. Whole-shell
or native theme conversion is not implied.

Exit: scoped compatibility design, fixture/lifecycle test matrix and an explicit
implementation-or-defer decision. If implemented, require desktop and both
Android renderers' acceptance before claiming parity.

## Source Starting Points

Recheck these at each phase; this is an orientation map, not a caller audit.

- `app/apps/code_te2/project_sidecar.py`
- `app/apps/code_te2/worker_services/event_bus.py`
- `app/apps/code_te2/explorer/services/search_sessions.py`
- `app/te2_mcp/`, `app/libs/` and `framework/rust/crates/te2-server/src/`
- `android/app/src/main/java/com/termux/extensions/AndroidNativeConsoleWorker.kt`
- `android/app/src/main/java/com/termux/extensions/EditorInputFilter.kt`
- `android/app/src/main/java/com/termux/extensions/PersistentNetworkService.kt`
- `android/app/src/gecko/java/com/termux/extensions/MainActivity.kt`
- `app/apps/code_te2/monaco_editor/editor_theme_loader_runtime_utils.ts`
- `app/apps/code_te2/monaco_editor/editor_theme_convert_utils.ts`
- `app/apps/code_te2/monaco_editor/editor_theme_apply_runtime_utils.ts`
- `app/apps/code_te2/monaco_editor/editor_textmate_runtime.ts`
- CODE_TE2.md sections 25, 26, 35, 43, 44 and 47.

## Validation And Closeout

### Bounded WBA Runtime I/O Pass

Keep protocol, identity, readiness and RPC dispatch semantics shared across Node
and Bun. Optimize fragmented pipe buffer growth and stdout backpressure for both.
Use explicit runtime detection only for a measured Bun file-read primitive; cache
only the two immutable adapter runtime assets, not workspace files. Report the
selected runtime/I/O path in health/startup records. Validate under both installed
interpreters, including binary Socket.IO and actual subprocess EOF/reply delivery.
The official Bun-native Socket.IO engine requires a separate HTTP/WebSocket
integration slice; do not replace the existing engine in this bounded pass.
Approved follow-up: worker startup performs background, filesystem-only Bun/Node
discovery. WBA launch reads the result without awaiting it, preferring discovered
Bun and otherwise Node; explicit executable overrides remain authoritative. Use
portable shellspec context, with no discovery subprocess on the launch path.
No shared-runtime restart is implied.

Approved startup cleanup: remove Python NID extraction/version subprocesses and
WBA runtime JSON overrides. Ship `src/protocol/pinned-rpc-ids.ts` as an explicit
build entry/import for the managed Code pin. Persist installation availability,
version and package layout in backend-owned PreferencesStore state. Normal runtime
callers derive paths from that record, not filesystem discovery. Missing records
attempt one known managed launch for migration; successful install/launch records
availability, code-server spawn/readiness failure and web-worker selection clear
it. WBA/LSP errors must not clear the installation flag. Preserve installed files
on mode changes; validate/adopt them only through explicit installer consent.

Use strict Python types/Basedpyright and focused tests for changed Python paths;
Rust formatting/check/tests for changed framework contracts; Code TE2 frontend
tests, typecheck and build for browser changes. Android validation follows the
approved module/build scope, with disk/memory prerequisites checked first.

Record exact build/revision, measurement conditions and live acceptance per
renderer. No automatic shared runtime restart, APK installation, asset-version
bump or release is part of this plan creation. Checkpoint completed slices when
requested, and keep unresolved reproductions distinct from completed tooling.
