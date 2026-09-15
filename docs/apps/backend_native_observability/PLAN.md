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

## Phase 2: Python Evaluation And Memory Inspection

Add opt-in runtime evaluation/reflection using the existing control plane. Make
it usable from existing developer tooling/MCP where appropriate; do not mistake
frontend console evaluation for access to live Python worker objects.

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
