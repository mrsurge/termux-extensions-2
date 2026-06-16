# File Editor CM6 Typed Runtime Control Plane Plan

Date: 2026-06-15

Status: Active planning/tracker document. The historical filename is preserved
for continuity, but the plan is now about a backend-owned typed runtime control
plane for `file_editor_cm6`, not a git implementation migration.

## Goal

Make project switching, watcher intake, git refresh, diagnostics projection,
open-state replay, draft/review refresh, preferences, and sidebar/window state
backend-authoritative through one app-worker runtime coordination spine.

The end state is a portable corpus of backend logic that can move to an initial
Rust/Axum/socketioxide runtime while Python modules remain reachable through
PyO3 adapters during migration.

## End State

1. `file_editor_cm6` has one app-worker runtime coordinator.
2. Project switch is the lifecycle boundary for project-scoped facts.
3. Every project-scoped fact carries `project_root` and `project_generation`.
4. Stale project work is dropped before projection to Explorer, editor, host, or
   sidebar lanes.
5. WBA session lifecycle is represented as backend facts:
   `adapter/sessionReset`, `workspace/switched`, and adapter-ready state.
6. Explorer is a renderer of backend-projected state, not a correctness
   authority for project, git, watcher, or diagnostics refresh.
7. Stores and services mutate authoritative state first; typed facts are
   published afterward; lane-local projectors notify the frontend surfaces.
8. Transport handlers parse and dispatch commands only. They do not own durable
   orchestration.
9. The event schema maps cleanly to Rust `serde` structs/enums and Tokio
   channels.
10. Blocking or expensive helpers run behind service interfaces now and can move
    from Python/PyO3 adapters to native Rust services later.

## Non-Goals

- Do not route editor keystrokes or Monaco model sync through the runtime bus.
- Do not route Monaco/WBA language-feature requests through the runtime bus.
- Do not route terminal stream data through the runtime bus.
- Do not make Socket.IO connect/disconnect hot paths wait on global
  coordination, except for bounded initial state snapshots.
- Do not move frontend surfaces onto another surface's RPC lane.
- Do not put heavy filesystem, git, extension, or indexing work directly in bus
  handlers.
- Do not make TE2-specific development harness behavior a product runtime
  dependency.

## Current Source Anchors

- `worker_services/runtime.py` registers the app-worker loop, compatibility
  Explorer loop seam, workspace event handlers, and the WBA event bridge at app
  startup.
- `worker_services/event_bus.py` provides the current queue-backed event
  dispatcher, thread-safe ingress, project-generation tracking, and initial
  typed event envelope.
- `workspace_events.py` owns the initial compatibility projectors for watcher
  batches, git refresh scheduling, diagnostics snapshots, and editor git
  baseline refresh side effects.
- `explorer/services/project_switch.py` is the canonical backend project-switch
  path. It mints project generations, publishes switch start/finish events, uses
  WBA `adapter.reconnect`, resets diagnostics, replays sidecar open state, and
  broadcasts generation-tagged git state.
- `wba_event_bridge.py` owns backend WBA `/ws` event-stream intake. It forwards
  WBA watcher changes into backend `WorkspaceFilesChanged`, forwards diagnostics
  updates to diagnostics projection, and treats `workspace/switched` as a
  backend project-scoped diagnostics boundary.
- `diagnostics_bridge.py` keeps diagnostics projection scoped to the active
  backend project root/generation and rejects/prunes out-of-project diagnostics.
- WBA emits `adapter/sessionReset`, `workspace/switched`, and `adapter/ready`
  from the reconnect path while keeping the Node adapter process alive.

## Current Event Types

Implemented in `worker_services/event_bus.py`:

- `DraftStateChanged`
- `DiagnosticsDetailChanged`
- `ExplorerRenderStateChanged`
- `GitDiffBaseChanged`
- `GitPathRestored`
- `GitSnapshotChanged`
- `GitSnapshotRequested`
- `OpenStateChanged`
- `PreferencesChanged`
- `ProjectSwitchStarted`
- `ProjectSwitchFinished`
- `ReviewStateChanged`
- `WatcherConfigChanged`
- `WatcherErrorRaised`
- `WorkspaceFilesChanged`

Near-term additions:

- `AdapterSessionReset`
- `AdapterWorkspaceReady`
- `SidebarWindowStateChanged`

## Runtime Rules

The runtime is a control plane, not a work plane.

- Event enqueue should be O(1).
- Bus handlers should be short and non-blocking.
- Heavy handlers should schedule bounded tasks and return.
- Noisy event families should coalesce before doing expensive work.
- Projectors emit only on their own surface lanes.
- Generation checks happen before expensive work and again before projection.
- A watcher storm must not delay project-switch/open-state notifications.
- Runtime tasks should have explicit cancellation and shutdown ownership.

## Portability Rules

- Python `asyncio.Queue` maps to Rust `tokio::sync::mpsc`.
- Python event envelopes map to Rust `serde` structs/enums.
- Python projectors map to Rust socketioxide emitters.
- Python blocking helpers map to `asyncio.to_thread` now and
  `tokio::task::spawn_blocking` later.
- Python services/stores become PyO3 adapters first, then native Rust services.
- Keep PyO3 bridge boundaries at service interfaces, not buried inside Socket.IO
  handlers or FastAPI routes.
- Prefer same-runtime actors/domain queues over multiple independent Python
  backend loops.

## Tracker

### Phase 1 - Runtime Foundation

Status: Complete.

- [x] Add worker-local runtime package under
      `app/apps/file_editor_cm6/worker_services/`.
- [x] Add queue-backed typed event bus.
- [x] Register app-worker loop from app startup.
- [x] Add thread-safe ingress for watcher/thread callbacks.
- [x] Add project-generation tracking.
- [x] Keep compatibility Explorer loop registration only as a temporary bridge.

Acceptance:

- Runtime bootstrap does not depend on Explorer frontend connection timing.
- Event publication has one app-worker-owned queue and one thread-safe ingress
  boundary.

### Phase 2 - Project Switch And Git Refresh Spine

Status: Complete for current scope.

- [x] Mint project generations in canonical project switch.
- [x] Publish `ProjectSwitchStarted` and `ProjectSwitchFinished`.
- [x] Move git snapshot refresh scheduling behind backend workspace events.
- [x] Debounce git refresh on the app-worker loop instead of scattered timers.
- [x] Route direct Explorer git projection through backend publication.
- [x] Keep frontend Explorer RPC contracts stable.
- [x] Route editor git baseline reads through the worker git service seam.

Implementation note: git backend choice is now an implementation detail behind
the service seam; `pygit2` is only one candidate/replacement direction, not the
architecture headline.

Acceptance:

- Project switch and watcher-driven git refresh are generation-aware.
- Explorer frontend state is not required for git refresh correctness.
- Git projection remains on the Explorer lane.

### Phase 3 - WBA And Diagnostics Project Boundaries

Status: Complete for current scope.

- [x] Split WBA event-stream intake from diagnostics projection.
- [x] Start WBA event bridge at app-worker bootstrap.
- [x] Ensure project switch keeps WBA event bridge alive.
- [x] Forward WBA `watcher/fileChanges` to backend `WorkspaceFilesChanged`.
- [x] Treat WBA `watcher/enospc` as a backend watcher error fact.
- [x] Scope diagnostics projection to active backend project root/generation.
- [x] Reject and prune out-of-project WBA diagnostics.
- [x] Replace the lightweight WBA project switch path with `adapter.reconnect`.
- [x] Clear frontend dynamic WBA provider caches on `adapter/sessionReset`.
- [x] Treat `workspace/switched` and `readyForDocumentOpen` as adapter readiness
      facts, not app-worker generation tokens.

Acceptance:

- Watcher/git refresh does not depend on editor/frontend reconnect lifecycle.
- Old-project diagnostics cannot repopulate the new project's Explorer or
  Problems projections after a switch.
- WBA project switch approximates a fresh code-server folder open without
  restarting the WBA Node process.

### Phase 4 - Backend Explorer Render State

Status: Complete for current Explorer control-plane scope.

- [x] Define backend `ExplorerRenderStateChanged` facts.
- [x] Make root tree state, open dirs, active project metadata, git projection,
      watcher batches, and diagnostics detail replay from backend state.
- [x] Replace frontend "request again to prove correctness" behavior with
      backend-projected render-state changes.
- [x] Keep Explorer as a dumb renderer of backend-projected state.
- [x] Preserve existing Explorer RPC method and notification names unless a
      separate frontend contract migration is explicitly approved.

Implementation note: file-tree mutations, manual refresh, watcher errors,
watcher config/mode changes, diagnostics detail, git status/decorations, git
diff-base/restored signals, open state, draft decorations, review entries, and
Explorer UI preferences now publish typed backend facts and project through the
Explorer render-state lane. Bootstrap snapshots and request/reply UI payloads
such as search results, extension configuration, and job-start acks stay direct.

Acceptance:

- After project switch, Explorer render state is determined by backend project
  generation and backend snapshots.
- Explorer local path/URI state cannot make old-project state appear current.
- Reconnect/bootstrap uses the same backend state machine as live updates.

### Phase 5 - Open State And Store-Backed Facts

Status: Complete for open state, Explorer-facing draft/review, and preferences.

- [x] Convert open-state writes into typed facts plus editor/Explorer/UI IPC
      projectors while keeping `open_state_backend.py` and `ProjectSidecar` as
      authority.
- [x] Convert draft/review decoration refreshes into typed facts plus projectors.
- [x] Convert preferences changes into typed facts plus lane-local projectors.
- [ ] Convert sidebar-window state changes into typed facts plus lane-local
      projectors.
- [ ] Preserve store authority: preferences store, history store, project
      sidecars, and open-state backend remain sources of truth.

Acceptance:

- Store mutations are backend-authoritative.
- Every surface projection can be replayed from backend state.
- No frontend surface becomes the durable authority because it rendered first.

### Phase 6 - Runtime Observability And Performance Guards

Status: Planned.

- [ ] Add queue depth metrics.
- [ ] Add enqueue-to-handler latency metrics.
- [ ] Add handler duration metrics.
- [ ] Add coalesce/drop counters.
- [ ] Add stale-generation drop counters.
- [ ] Log slow handlers and slow queue latency only above useful thresholds.
- [ ] Add event correlation ids for project switch and reconnect flows.

Initial thresholds:

- Warn on handler duration greater than 25ms.
- Warn on queue latency greater than 50ms.
- Count all stale project-generation drops.

Acceptance:

- We can prove the control plane is not slowing editor/app hot paths.
- Watcher storms and diagnostics bursts have visible coalesce/drop behavior.
- Project switch latency can be inspected as one correlated lifecycle.

### Phase 7 - Portability Extraction

Status: Later.

- [ ] Freeze event envelope shape as a transport-neutral schema.
- [ ] Define service traits/interfaces for project, git, watcher, diagnostics,
      open state, draft/review, preferences, and sidebar-window state.
- [ ] Keep Python implementations callable through PyO3 adapters.
- [ ] Move one service at a time to native Rust while preserving event and
      projector contracts.
- [ ] Recreate app-worker coordination as Tokio actors/tasks on one runtime.

Acceptance:

- Axum/socketioxide handlers dispatch typed commands into the runtime instead of
  owning orchestration.
- Python adapters can be removed incrementally without changing frontend surface
  contracts.
- Event/projector tests can run against both Python-backed and native Rust-backed
  service implementations.

## Ordering Model

Project switch establishes the ordering boundary.

1. Validate and assign backend project root.
2. Mint `project_generation`.
3. Publish `ProjectSwitchStarted`.
4. Reset/rebind project session state and Explorer connections.
5. Reset project-scoped diagnostics.
6. Reconnect WBA through `adapter.reconnect` when requested.
7. Observe adapter session reset/workspace-ready facts.
8. Ensure WBA event bridge is running.
9. Start project watcher fallback if needed.
10. Replay sidecar open state.
11. Broadcast generation-tagged git state.
12. Broadcast project-switched surface notifications.
13. Publish `ProjectSwitchFinished`.

Any async result from an older generation must be dropped before it mutates
projected frontend state.

## Surface Projection Rules

- Explorer projector emits Explorer RPC notifications only.
- Editor projector emits editor RPC notifications only.
- Host projector emits UI IPC notifications only.
- Sidebar projector uses sidebar IPC/backend app state paths only.
- WBA projector/event bridge consumes WBA events and republishes backend facts;
  it does not move WBA language-feature traffic onto the runtime bus.
- Terminal projectors must not proxy terminal stream data through the runtime
  bus.

## Bootstrap And Replay Model

Reconnect/bootstrap should replay from backend state, not frontend retries.

Replay order:

1. active project metadata
2. adapter/project readiness
3. open-state / active-file projection
4. root tree / open directories
5. last-known git projection or pending-refresh marker
6. watcher status/error projection
7. diagnostics detail/counts projection
8. draft/review projection
9. preferences/sidebar-window projection where relevant

`workspace_events.get_workspace_event_snapshot(...)` should either become a real
backend snapshot facade used by bootstrap or be retired after equivalent replay
state exists elsewhere.

## Open Decisions

1. **Domain queue shape.** Decide whether the current single queue remains enough
   with coalescing, or whether noisy domains need explicit same-loop queues:
   control, file events, git, diagnostics, drafts/review, and sidebar/window
   state.
2. **Explorer render state schema.** Define the minimal backend render-state fact
   that lets Explorer update without treating local state as authority.
3. **First tree paint policy.** Decide whether root paint can show a pending git
   marker or should await a bounded first git snapshot.
4. **Snapshot facade fate.** Decide whether `workspace_events` remains a
   compatibility snapshot/projector module or is split into dedicated projectors.
5. **Filesystem executor policy.** Decide where blocking filesystem traversal and
   mutation should run before Rust migration.
6. **Git remote job boundary.** Decide how push/pull/clone progress maps from the
   current job model into typed runtime facts.

## Risks

- **Queue starvation.** A noisy watcher/diagnostics burst could delay important
  control facts if coalescing/domain queues are not added where needed.
- **Hidden side effects.** `workspace_events.py` still owns editor external file
  reload and git baseline refresh side effects that must be preserved or made
  explicit.
- **Stale generation leaks.** Missing one stale-drop guard can recreate old
  project state under a cleaner architecture.
- **Frontend masking.** Leaving frontend "request again" behavior in place can
  hide backend ordering bugs during migration.
- **Transport coupling.** Putting orchestration in Socket.IO handlers or route
  functions will make the Rust port harder.
- **Over-broad migration.** Moving hot editor paths onto the runtime bus would
  hurt the app and violate the control-plane design.

## Verification Discipline

Use focused checks for each slice:

- `python -m py_compile` for touched Python modules.
- `basedpyright --project app/apps/file_editor_cm6/pyrightconfig.json`.
- `./node_modules/.bin/tsc --noEmit` for touched TypeScript surfaces.
- `cd app/apps/file_editor_cm6 && node build.mjs` after frontend source edits.
- `node --check` for rebuilt JS entrypoints when useful.
- `git diff --check`.

Do not restart the shared framework server for verification unless the user
explicitly approves that exact action.
