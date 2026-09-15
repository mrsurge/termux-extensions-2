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
- [ ] Approve the concrete Phase 1 investigation/first implementation scope.

Planning only so far. No runtime, Python, Rust, Kotlin or frontend implementation
has changed on this branch. Existing source pointers are not compatibility proof.

## Phase 1: Runtime Map And Contract

- [ ] Trace current Python worker/pipe/MCP dispatch and native console routing.
- [ ] Inventory existing evaluation, memory diagnostics and runtime/debug flags.
- [ ] Define exact target identity, typed envelopes, opt-in and teardown.
- [ ] Define bounded capture/export, thread ownership, errors and disconnects.
- [ ] Separate observation from explicit state-changing eval/reflection actions.
- [ ] Document timeout limitations and trusted-code execution, not a sandbox.
- [ ] Present source-backed edit scope and obtain implementation approval.

## Phase 2: Python Diagnostics

- [ ] Implement approved opt-in evaluation/reflection via existing control plane.
- [ ] Expose bounded search/projection/session and task/queue inspection.
- [ ] Label counts, payload bytes, allocation measurements and RSS separately.
- [ ] Bound cyclic/shared-object traversal and repr/results; report truncation.
- [ ] Add snapshot/export/clear, flag state and lifecycle cleanup.
- [ ] Test disabled paths, identity, errors, limits and explicit debug actions.
- [ ] Live acceptance: inspect worker state without disrupting normal requests.
- [ ] Record baseline and cleanup measurements, including instrumentation cost.

## Phase 3: Scheduling And Sidecar Audit

- [ ] Attribute queue/execution/service/projection latency with correlated traces.
- [ ] Reproduce relevant mobile-host workload; record before/after conditions.
- [ ] Audit sidecar LSP APIs/fields, callers and persisted consumers.
- [ ] Classify each suspect path: live, obsolete, compatibility-only or unresolved.
- [ ] Approve and implement only evidence-backed cleanup/performance changes.
- [ ] Test ordering, cancellation, project changes, reconnect and retained state.
- [ ] Live acceptance of targeted fixes; document no-change findings honestly.

## Phase 4: Gecko Native IME Diagnostics

- [ ] Approve debug APK source, thread-dispatch and build/install scope.
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
