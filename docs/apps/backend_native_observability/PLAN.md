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

### External Rust CPU Profiling

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

## Phase 4: Gecko Native IME Diagnostics

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

Use strict Python types/Basedpyright and focused tests for changed Python paths;
Rust formatting/check/tests for changed framework contracts; Code TE2 frontend
tests, typecheck and build for browser changes. Android validation follows the
approved module/build scope, with disk/memory prerequisites checked first.

Record exact build/revision, measurement conditions and live acceptance per
renderer. No automatic shared runtime restart, APK installation, asset-version
bump or release is part of this plan creation. Checkpoint completed slices when
requested, and keep unresolved reproductions distinct from completed tooling.
