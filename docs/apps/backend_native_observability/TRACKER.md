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

Planning and initial source audit only so far. No runtime, Python, Rust, Kotlin
or frontend implementation has changed on this branch.

## Phase 1: Runtime Map And Contract

- [x] Trace initial Python worker/pipe/MCP dispatch and native console routing.
  Rust ignores worker response frames; Python's synchronous reader dispatch and
  separate asyncio.run loop cannot be reused unchanged for live-loop evaluation.
- [x] Inventory initial flags/tools: --debug is build selection; --memory-profile
  already enables controlled allocation capture. Native console accepts structured
  commands, not general Kotlin source evaluation.
- [x] Select CLI `te2 framework eval` and MCP sharing Rust-to-worker pipe routing.
- [x] Select --runtime-debug / TE2_RUNTIME_DEBUG, enforced at framework and worker.
- [ ] Define exact target identity, typed envelopes, opt-in and teardown.
- [ ] Define bounded capture/export, thread ownership, errors and disconnects.
- [x] Separate observation from explicit state-changing eval/reflection actions.
- [x] Document timeout limitations and trusted-code execution, not a sandbox.
- [ ] Present source-backed edit scope and obtain implementation approval.

## Phase 2: Python Diagnostics

- [ ] Implement approved opt-in evaluation/reflection via existing control plane.
- [ ] Add shared CLI/MCP discovery and eval requests with exact instance identity.
- [ ] Implement bounded Rust response correlation and worker-disconnect cleanup.
- [ ] Schedule evaluation on the live app loop without blocking stdin replies;
  serialize all protocol writes and reject workers without supported live context.
- [ ] Lazy-load stdlib inspect on demand; test ImportError as capability failure,
  preserving startup and evaluation that does not depend on inspection.
- [ ] Expose bounded search/projection/session and task/queue inspection.
- [ ] Label counts, payload bytes, allocation measurements and RSS separately.
- [ ] Bound cyclic/shared-object traversal and repr/results; report truncation.
- [ ] Add snapshot/export/clear, flag state and lifecycle cleanup.
- [ ] Test disabled paths, identity, errors, limits and explicit debug actions.
- [ ] Live acceptance: inspect worker state without disrupting normal requests.
- [ ] Record baseline and cleanup measurements, including instrumentation cost.

## Phase 3: Scheduling And Sidecar Audit

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

## Phase 4: Gecko Native IME Diagnostics

- [ ] Approve debug APK source, thread-dispatch and build/install scope.
- [x] Select live-object inspection/invocation through Java reflection plus
  kotlin-reflect for Kotlin metadata; exclude Keval and arbitrary Kotlin compilation.
- [ ] Define object targeting, typed argument/overload handling, bounded results,
  explicit mutations, access failures and stale activity/view cleanup.
- [ ] Align kotlin-reflect to the app Kotlin version; verify debug availability
  and absence of new dependencies/seams from release variants.
- [ ] Extend native console/ADB inspection, reflection and controlled actions.
- [ ] Add opt-in bounded local tracing, export/clear and optional logcat output.
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
