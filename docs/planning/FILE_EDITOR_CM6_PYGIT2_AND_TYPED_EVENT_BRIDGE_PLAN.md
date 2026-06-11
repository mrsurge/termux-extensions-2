# File Editor CM6 pygit2 Service and Typed Event Bus Plan

Date: 2026-06-10

Status: Phase 1 implementation started.

## Implementation Tracker

Phase status:

- Phase 1 - Event bus foundation and project-switch normalization: In progress
- Phase 2 - App-wide git service for status and read paths: In progress
- Phase 3 - Remote operations and progress migration: Not started
- Phase 4 - Remaining caller cleanup and store-driven events: Not started
- Phase 5 - Optional portability seam: Not started

Phase 1 checklist:

- [x] Choose worker-local module path that avoids legacy
      `app/apps/file_editor_cm6/services/` semantics.
- [x] Add worker-local event-bus package scaffold.
- [x] Register the app-worker loop with the event bus.
- [x] Add a queue-backed event dispatcher foundation.
- [x] Add thread-safe event ingress for watcher/thread callbacks.
- [x] Mint project generation in canonical project-switch flow.
- [x] Publish generation-tagged project-switch start/end events.
- [x] Route local watcher-thread file changes through the event bus when the bus
      is available.
- [x] Preserve legacy fallback for watcher file changes before bus startup.
- [x] Stop hidden synchronous git cache priming in `set_project_root()`.
- [x] Migrate WBA diagnostics bridge watcher events to publish bus events
      directly.
- [x] Migrate watchexec watcher events to publish bus events directly.
- [x] Add initial `GitSnapshotRequested` and `WatcherErrorRaised` event types.
- [x] Route runtime git-status watcher refresh scheduling through
      `GitSnapshotRequested`.
- [x] Preserve debounce behavior for watcher-triggered git snapshot refreshes
      with an asyncio task instead of `threading.Timer`.
- [x] Decide whether direct git-status publication is migrated in Phase 1 or
      kept as Phase 2 git-service work.
- [x] Update Explorer dispatcher project-root authority before emitting
      `explorer.project.opened`, so immediate frontend git-status requests use
      the new project CWD.
- [x] Run focused verification for touched modules.

Phase 2 checklist:

- [x] Add worker-local `git_service.py` seam.
- [x] Keep Phase 2A service backend delegated to existing CLI helpers/status
      behavior; no `pygit2` dependency change yet.
- [x] Route `file_ops` git snapshot reads and refreshes through the service seam.
- [x] Route runtime git-status broadcast through the service seam.
- [ ] Replace the service backend with `pygit2` for status/read paths.
- [ ] Migrate editor `HEAD` baseline reads through the service.
- [ ] Migrate HTTP git route status/read helpers through the service.
- [ ] Remove legacy Explorer-local `_GIT_STATUS_CACHE` once no compatibility
      fallback needs it.

Open decisions status:

- Module placement: Chosen for Phase 1 as
  `app/apps/file_editor_cm6/worker_services/`.
- `pygit2` version pin: Not decided; Phase 2A does not add the dependency.
- Remote-operation progress parity: Not decided.
- Filesystem executor policy: Not decided.
- Initial tree-paint behavior: Not decided.
- Snapshot API fate: Not decided.

Verification log:

- `python -m py_compile` passed for touched Python modules.
- Import smoke passed for event bus, workspace events, and project switch wiring.
- Focused Pyright passed for new/core modules:
  `worker_services/event_bus.py`, `workspace_events.py`,
  `explorer/services/project_switch.py`, and `explorer_runtime.py`.
- Follow-up focused Pyright also passed after routing runtime git snapshot
  scheduling through `GitSnapshotRequested`.
- Broader focused Pyright still reports pre-existing legacy issues in
  `diagnostics_bridge.py` and `watchexec_shell_manager.py`; these were not
  introduced by this slice.
- Direct git-status publication remains Phase 2 git-service work.
- Phase 2A service-seam slice verified with `py_compile`, import smoke, and
  focused Pyright for `worker_services/git_service.py`, `file_ops.py`, and
  `runtime_notifications.py`.
- Explorer project-open root timing fix verified with `py_compile` and import
  smoke for `explorer/context.py`, `explorer_runtime.py`, and
  `explorer/handlers/project.py`.

## Purpose

This plan replaces the earlier stale draft with a source-aligned plan for the
following end state:

1. **Project switch is the primary lifecycle driver.** Git refresh, open-state
   replay, watcher publication, and cross-surface notifications hang off the
   canonical project-switch flow instead of scattered timers and helper calls.
2. **`file_editor_cm6` gets an app-local typed event bus.** Explorer is the
   first consumer via a bridge/projector onto the existing Explorer RPC lane.
   Editor, host, and sidebar follow on their own lanes without violating the
   current ownership contract.
3. **`pygit2` becomes the app-wide git backend for `file_editor_cm6`.** This
   includes Explorer, HTTP git routes, state payload helpers, and editor-side
   git consumers. GitPython and direct CLI helpers are migration scaffolding
   only and are removed from steady-state runtime once parity lands.
4. **Surface RPC contracts remain stable during the migration.** The internal
   architecture changes; frontend lane contracts should not.

## Source-Of-Truth Boundaries

The event bus is a publication seam, not a replacement for backend authority.

- `_preferences_store` remains authoritative for user preferences.
- `_history_store` remains authoritative for recents, diff-base selection, and
  session telemetry.
- `ProjectSidecar` remains authoritative for durable per-project state.
- `open_state_backend.py` remains the open-file write/read seam; durable
  active-file authority is `ProjectSidecar.last_file` plus
  `open_state_revision`, not a frontend projection.
- The bus publishes after an authoritative backend mutation. It must not become
  a second source of truth for preferences, history, sidecar, or open-file
  state.

Citations:
`app/apps/file_editor_cm6/open_state_backend.py:62-163`,
`app/apps/file_editor_cm6/project_sidecar.py:344-355,360-415,489-592`,
`app/apps/file_editor_cm6/main_page/backend/state_payload.py:39-162`.

## Current State Aligned To Source

### Project switch already is the canonical lifecycle seam

`app/apps/file_editor_cm6/explorer/services/project_switch.py`

- `switch_project_connection(...)` is the canonical backend path.
- Current order is:
  - `set_project_root(project_path)`
  - `editor_runtime_emit_project_switching(...)`
  - watcher initialization / session reset / connection reassignment
  - `adapter.switchWorkspace`
  - sidecar open-state replay
  - git state replay
  - `editor_runtime_emit_project_switched(...)`
- The git replay currently happens before the final project-switched emit.

Important mismatch with the earlier draft: `readyForDocumentOpen` is an adapter
readiness ack, not an app-worker project-generation token.

Citations:
`app/apps/file_editor_cm6/explorer/services/project_switch.py:34-118,210-250`,
`app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/workspace/lifecycle.ts:507-584`.

### `set_project_root()` still performs synchronous git work

`app/apps/file_editor_cm6/explorer/services/file_ops.py`

- `set_project_root(path)` validates and assigns `_PROJECT_ROOT`, then calls
  `_prime_git_cache(p)`.
- `_prime_git_cache()` calls `_refresh_git_status(root)`.
- `_refresh_git_status()` shells out through `_collect_git_status()`.

This means project-root sync is not a cheap setter today. It still pulls git
status synchronously on hot paths.

That setter is reused outside Explorer project switch too:

- Explorer bootstrap
- state payload building
- active-project route helpers

Citations:
`app/apps/file_editor_cm6/explorer/services/file_ops.py:73-82,199-272`,
`app/apps/file_editor_cm6/explorer/services/session_bootstrap.py:36-40`,
`app/apps/file_editor_cm6/main_page/backend/state_payload.py:96-109`,
`app/apps/file_editor_cm6/main.py:490-505,565-573`.

### Git behavior is split across three implementations

#### 1. CLI git helper

`app/apps/file_editor_cm6/git_helper.py`

- `git_helper.py` is still the main synchronous git implementation for:
  - repo detection
  - status
  - worktree changes
  - commit info
  - branches
  - stage/unstage/restore/reset/init
  - remotes and origin lookup
- All public helpers shell out via `subprocess.run(...)`.

Citations:
`app/apps/file_editor_cm6/git_helper.py:52-103,133-218,221-501`.

#### 2. GitPython job service for remote operations

`app/libs/git_service.py`

- This file already exists and is live.
- It uses GitPython for push/pull/clone progress handling.
- It registers job handlers for `git_push`, `git_pull`, and `git_clone`.
- It is imported at Explorer runtime startup so handlers register in the worker.

This is not a blank/new seam; it is legacy remote-job infrastructure.

Citations:
`app/libs/git_service.py:1-8,24-76,78-270,278-477`,
`app/apps/file_editor_cm6/explorer_runtime.py:18-19`.

#### 3. Editor-side direct git reads

`app/apps/file_editor_cm6/monaco_editor/editor_ws.py`

- The editor still reads `HEAD` blob content directly via
  `git show HEAD:<path>` for git baselines.
- This path bypasses GitPython and the Explorer git cache entirely.

Citations:
`app/apps/file_editor_cm6/monaco_editor/editor_ws.py:1025-1067`.

### Git status publication is still split across multiple seams

#### Watcher-originated path

`runtime_notifications.py` -> `workspace_events.py`

- `notify_explorer_of_change(...)` fans watcher changes into:
  - watcher file batch debounce
  - git status debounce
- `_schedule_git_status_broadcast(...)` uses `Timer(0.5, ...)` and
  `asyncio.run_coroutine_threadsafe(...)`.
- `broadcast_git_status_update(...)` reads git state and then calls
  `workspace_events.publish_git_status_update(...)`.

Citations:
`app/apps/file_editor_cm6/explorer/services/runtime_notifications.py:34-48,114-183`,
`app/apps/file_editor_cm6/workspace_events.py:151-181`.

#### Direct Explorer dispatcher path

`app/apps/file_editor_cm6/explorer_runtime.py`

- `ExplorerDispatcher.broadcast_git_status()` directly emits
  `explorer.git.status.updated`.
- `ExplorerDispatcher.broadcast_git_decorations()` directly emits
  `explorer.git.decorations.updated`.
- Bootstrap, manual refresh, git handlers, and file-tree handlers still call
  these methods directly.

Citations:
`app/apps/file_editor_cm6/explorer_runtime.py:157-192`,
`app/apps/file_editor_cm6/explorer/services/session_bootstrap.py:59-64`,
`app/apps/file_editor_cm6/explorer/handlers/session.py:37-48`,
`app/apps/file_editor_cm6/explorer/handlers/git.py:49-113,167-230`,
`app/apps/file_editor_cm6/explorer/handlers/file_tree.py:84-114`.

### Watcher publication is not a single-funnel system yet

There are at least three current watcher entry points that ultimately publish
into Explorer/editor behavior:

1. WBA diagnostics bridge file changes
2. local watcher threads in `core_read.py`
3. watchexec shell forwarding

Citations:
`app/apps/file_editor_cm6/diagnostics_bridge.py:247-328`,
`app/apps/file_editor_cm6/core_read.py:110-150`,
`app/apps/file_editor_cm6/watchexec_shell_manager.py:115-127`.

### `workspace_events.py` has hidden side effects that must be preserved

`app/apps/file_editor_cm6/workspace_events.py`

- `publish_file_change_batch(...)` does more than Explorer fanout.
- It also calls `monaco_editor.editor_ws.handle_external_file_change(...)` for
  created/changed files.
- `publish_git_status_update(...)` does more than emit Explorer notifications.
- It also triggers `broadcast_git_baselines_for_active_file()` in the editor.

These side effects are easy to drop accidentally during a bridge migration.

Citations:
`app/apps/file_editor_cm6/workspace_events.py:91-121,151-181`,
`app/apps/file_editor_cm6/monaco_editor/editor_ws.py:883-1022`.

### Explorer bootstrap and reconnect still rely on direct behavior

`app/apps/file_editor_cm6/explorer/services/session_bootstrap.py`

- Bootstrap currently does:
  - project active update
  - UI prefs update
  - direct `broadcast_git_status()`
  - direct root `list_dir()`
  - review state replay
  - open dirs replay
  - open-state replay
  - watcher config replay
- `workspace_events.get_workspace_event_snapshot(...)` exists, but it is not the
  active reconnect/bootstrap path today.

Citations:
`app/apps/file_editor_cm6/explorer/services/session_bootstrap.py:26-109`,
`app/apps/file_editor_cm6/workspace_events.py:184-194`.

### Frontend contract expectations must stay stable

`app/apps/file_editor_cm6/src/explorer/rpc/contract.ts`

- The Explorer RPC contract already defines typed request/notification names for
  git status, decorations, branches, commit, restore, push/pull, and diff-base.
- The frontend re-issues `gitStatusGet` in several notification handlers.
- The plan must preserve current notification shapes while backend internals are
  migrated.

Citations:
`app/apps/file_editor_cm6/src/explorer/rpc/contract.ts:31-90`,
`app/apps/file_editor_cm6/src/explorer/rpc/notifications.ts:133,179,416,480,536`,
`app/apps/file_editor_cm6/src/explorer/app/bootstrap.ts:990-993`.

### Dependency reality

- `aiofiles` is already present.
- `git-python` is already present.
- `pygit2` is not currently installed in this environment.
- `pyproject.toml` uses dynamic dependencies from `requirements.txt`.

Citations:
`requirements.txt:19-21`,
`pyproject.toml:10-11,37-38`.

## Problems This Plan Must Actually Solve

1. **Project switch still does blocking git work too early.** The current root
   setter primes git synchronously.
2. **Git publication is fragmented.** Watcher-driven updates, manual refresh,
   bootstrap, git handlers, and file-tree handlers do not go through one
   internal seam.
3. **There is no app-worker project-generation guard for git/watcher/project
   lifecycle publication.** WBA document-open generations do not solve this.
4. **Git implementation is split across CLI, GitPython, and editor-local
   subprocesses.** There is no app-wide git service.
5. **Bootstrap/reconnect ordering is implicit.** The system relies on direct
   calls plus frontend `gitStatusGet` retries rather than an explicit internal
   state pipeline.
6. **`list_dir()` depends on synchronous git snapshot logic.** Removing the old
   cache requires an explicit replacement strategy.
7. **Remote-operation progress is coupled to the existing GitPython job
   module.** Replacing GitPython requires a progress-capable `pygit2` job path.

## Target Architecture

### App-local typed event bus

Recommended new app-worker-local modules:

- `app/apps/file_editor_cm6/worker_services/event_bus.py`
- `app/apps/file_editor_cm6/worker_services/git_service.py`

Notes:

- These should be app-local, not shared `app/libs/` modules.
- These should not live under `app/apps/file_editor_cm6/services/` by default.
  That directory has a legacy manifest-loader/main-process meaning for modules
  that run in the framework process, not in the app worker.
- Reusing `app/libs/git_service.py` for a second meaning would be confusing;
  that file already means "GitPython job handlers" today and is loaded by the
  framework's generic `app/libs` service scan.
- `app/libs/git_service.py` can remain as a legacy compatibility module during
  migration, but it should not be the long-term home of the app-wide git
  service.

If the implementation later chooses to use
`app/apps/file_editor_cm6/services/` anyway, that directory's README must be
updated first to explicitly distinguish worker-local modules from legacy
main-process service modules. The preferred plan is to avoid that ambiguity by
using `worker_services/`.

Framework validation note:

- Outside `app/apps/**` and `app/extensions/**`, the framework-wide generic
  service scan loads `app/libs/*.py`, not app-local `services/` directories.
- App-local `services/` semantics are currently owned by the apps extension
  loader / manifest service contract described in
  `app/apps/file_editor_cm6/services/README.md`.
- Therefore `worker_services/` is safer for new app-worker-owned internals.

### Bus ownership and execution model

- One bus instance per `file_editor_cm6` app worker.
- One dispatcher task owning an `asyncio.Queue` on the app worker loop.
- Cross-thread publishers use one centralized thread-safe ingress helper via
  `loop.call_soon_threadsafe(...)`.
- Long-running work must not block the queue. A handler may start a service task
  and later republish a completion/result event.
- Publication ordering is FIFO at the bus boundary.
- Stale-drop happens at subscriber/projector boundaries using
  `project_generation`.

This means the system moves from "many independent helpers capture the loop and
schedule work differently" to "every non-loop source posts typed events into one
worker-owned queue."

### Event typing

The exact Python representation can be `msgspec.Struct`, dataclasses, or an
equivalent typed model. The important property is a stable explicit schema.

Every event payload should carry:

- `project_root: str | None`
- `project_generation: int | None`
- `emitted_at_ms: int`
- `source: str`
- optional `correlation_id: str`

Suggested envelope shape:

```python
{
    "type": "GitSnapshotChanged",
    "project_root": "/data/data/com.termux/files/home/mrselect6",
    "project_generation": 12,
    "emitted_at_ms": 1718000000000,
    "source": "project_switch",
    "correlation_id": "switch_12",
    "payload": {...},
}
```

### Initial domain events

The final catalog can grow, but the first useful set is:

- `ProjectSwitchStarted`
- `ProjectRootAssigned`
- `AdapterWorkspaceSwitching`
- `AdapterWorkspaceReady`
- `ProjectOpenStateChanged`
- `WorkspaceFilesChanged`
- `WatcherErrorRaised`
- `GitSnapshotRequested`
- `GitSnapshotChanged`
- `GitOperationStarted`
- `GitOperationProgress`
- `GitOperationFinished`
- `DraftStateChanged`
- `DiagnosticsChanged`
- `PreferencesChanged`
- `HistoryChanged`
- `ProjectSidecarChanged`

The implementation does not need all of these on day one. The key point is that
project switch, watcher events, git snapshot publication, and open-state changes
share one typed internal seam.

### Explorer-first bridge / projector model

Explorer is the first consumer of the bus.

- A projector consumes bus events and emits existing Explorer RPC
  notifications.
- Explorer notification names and payload shapes stay unchanged.
- `runtime_notifications.py` becomes a thin adapter or is removed entirely once
  watcher and git publication move onto the bus.
- `workspace_events.py` becomes a thin compatibility projector/snapshot facade,
  or is removed once its side effects are explicitly represented as bus
  subscribers.

This preserves the current frontend contract while replacing the current
internal publication mechanism.

### Cross-surface rules stay the same

The bus does not change ownership boundaries.

- Explorer projector emits Explorer-lane notifications.
- Editor projector emits editor-lane notifications.
- Host projector emits UI IPC notifications.
- Sidebar projector emits `/sidebar_ipc` notifications.
- No frontend surface talks to another surface's lane directly.

The bus is an internal backend seam, not a new frontend transport.

### App-wide git service

The app-wide git service owns:

- repository-open / repo detection
- branch/head status reads
- worktree snapshot collection
- commit lookup / diff-base related reads
- `HEAD` blob reads needed by editor baselines
- stage/unstage/restore/reset/init/commit APIs
- push/pull/clone job execution and progress callbacks
- the last-known git snapshot for a `(project_root, project_generation)` pair
- in-flight request coalescing for status refresh

Target steady-state backend:

- `pygit2` for status/read/mutate operations
- `pygit2` remote callbacks for push/pull/clone progress reporting

Transitional migration rule:

- During migration, a CLI or GitPython path may temporarily sit behind the new
  service for specific unported operations.
- Direct callers should migrate to the service first.
- The final steady-state target is no GitPython dependency and no direct CLI git
  helper dependency in normal `file_editor_cm6` runtime paths.

### Tree-listing and snapshot strategy

The earlier draft hand-waved this point. The revised plan makes it explicit.

`list_dir()` should not shell out to git.

Instead:

- `git_service` owns the current git snapshot in memory.
- `list_dir()` reads the last-known snapshot only.
- On project switch, a new generation starts with no trusted snapshot; the bus
  immediately publishes `GitSnapshotRequested` for the new generation.
- Explorer tree rendering may initially show clean/no git state for that new
  generation until `GitSnapshotChanged` arrives.
- Existing `explorer.git.decorations.updated` and
  `explorer.git.status.updated` notifications then project the fresh git state
  onto already-rendered DOM.

If the first-render UX needs git flags before root list paint, that should be a
separate bounded bootstrap decision. It should not be recreated as a 6s cache
plus timer debounce.

### Ordering and stale-drop rules

The bus must make ordering explicit.

Rules:

1. `project_generation` is minted once per successful call into the canonical
   project-switch flow.
2. `ProjectSwitchStarted(gen=N)` must be observed before
   `GitSnapshotChanged(gen=N)` or `WorkspaceFilesChanged(gen=N)` for the new
   generation.
3. Results from older generations are dropped by subscribers/projectors if the
   worker has already advanced to a newer generation.
4. WBA `readyForDocumentOpen` remains an adapter readiness ack only. It is not
   reused as the app-worker stale-generation mechanism.
5. `GitSnapshotRequested` is coalesced per `(project_root, project_generation)`.
6. Reconnect/bootstrap replay must be tagged with the current generation.

### Bootstrap and reconnect model

The revised plan keeps bootstrap explicit instead of hoping live events and
frontend retries fill the gaps.

Recommended replay order:

1. active project metadata
2. open-state / active-file projection
3. root list / open directories
4. last-known git snapshot or immediate pending-refresh marker
5. review, draft, and diagnostics projections

`workspace_events.get_workspace_event_snapshot(...)` must either become a real
bus-backed snapshot API or be removed. The system should not keep a duplicate
snapshot cache that bootstrap does not use.

### File-I/O guideline

`aiofiles` is a tool, not the architecture.

Guideline:

- Use `aiofiles` for text/JSON sidecar or content reads/writes when the caller
  already lives in async code and the work is truly file-content I/O.
- Keep directory traversal (`os.scandir`, `Path.iterdir`), file mutation
  primitives (`os.rename`, `shutil.*`, `Path.unlink`, `mkdir`), and similar
  blocking filesystem work on an explicit filesystem executor.
- Do not do a broad "replace every ad hoc file read/write with aiofiles" pass
  unless the touched path is part of the migration or a measured hotspot.

The main performance problem this plan solves is project-switch and git status
publication, not generic file-text I/O in the abstract.

## Migration Plan

### Phase 1 - Event bus foundation and project-switch normalization

Scope:

- Add an app-local typed event bus.
- Mint and track `project_generation` in the canonical project-switch flow.
- Route these backend events through the bus first:
  - project switch start/end
  - watcher file changes
  - watcher errors
  - git snapshot requests
  - git snapshot publication
- Explorer is the first projector/consumer. Keep current Explorer RPC contract
  unchanged.
- Replace current thread-captured watcher/git publication helpers with one
  centralized thread-safe ingress into the bus.
- Stop synchronous git priming inside `set_project_root()`.
- Keep existing CLI git status collection only as temporary service-backed
  plumbing if needed during this phase.

Phase 1 files likely touched:

- `app/apps/file_editor_cm6/worker_services/event_bus.py` - new
- `app/apps/file_editor_cm6/explorer/services/project_switch.py`
- `app/apps/file_editor_cm6/explorer/services/file_ops.py`
- `app/apps/file_editor_cm6/explorer/services/runtime_notifications.py`
- `app/apps/file_editor_cm6/workspace_events.py`
- `app/apps/file_editor_cm6/explorer_runtime.py`
- `app/apps/file_editor_cm6/explorer/services/session_bootstrap.py`
- `app/apps/file_editor_cm6/core_read.py`
- `app/apps/file_editor_cm6/diagnostics_bridge.py`
- `app/apps/file_editor_cm6/watchexec_shell_manager.py`

Acceptance:

- `set_project_root()` no longer calls `_prime_git_cache()`.
- watcher and git publication stop using per-feature `Timer` + scattered
  `run_coroutine_threadsafe` patterns.
- there is exactly one centralized thread-safe ingress into the bus.
- project-switch publication is generation-tagged and stale-drop aware.
- Explorer RPC request/notification method names remain unchanged.

### Phase 2 - App-wide git service for status and read paths

Scope:

- Add `app/apps/file_editor_cm6/worker_services/git_service.py`.
- Introduce service-owned git snapshots keyed by
  `(project_root, project_generation)`.
- Introduce in-flight refresh coalescing for git snapshot requests.
- Migrate status/read callers from direct `git_helper.py` or direct subprocesses
  to the service.
- Replace editor `HEAD` baseline reads with the service.
- Remove `_GIT_STATUS_CACHE` from `file_ops.py`; the service owns snapshot
  state.
- Route direct Explorer git broadcasts through the bus/projector path or make
  them thin wrappers over that path.
- Add `pygit2` to dependencies and pin a version that actually works on the
  target Termux/libgit2 environment.

Primary callers to migrate in this phase:

- `app/apps/file_editor_cm6/explorer/services/file_ops.py`
- `app/apps/file_editor_cm6/explorer_runtime.py`
- `app/apps/file_editor_cm6/explorer/handlers/git.py`
- `app/apps/file_editor_cm6/explorer/search.py`
- `app/apps/file_editor_cm6/main.py`
- `app/apps/file_editor_cm6/main_page/backend/git_routes.py`
- `app/apps/file_editor_cm6/main_page/backend/state_payload.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`

Acceptance:

- no CLI `git status` subprocess remains on the project-switch/status-refresh
  hot path.
- no synchronous git priming remains in project-root sync or state-payload
  building paths.
- `list_dir()` reads service-owned last-known snapshot only.
- git snapshot refreshes are generation-aware, coalesced, and bus-driven.
- editor git baseline reads no longer shell out directly.

### Phase 3 - Remote operations and progress migration

Scope:

- Replace GitPython push/pull/clone job handlers with app-local `pygit2`
  remote-job implementations.
- Map `pygit2` remote callbacks to the existing job registry progress model.
- Preserve Explorer's current progress-bar semantics and notification shapes.
- Migrate HTTP routes and Explorer handlers to the new service methods.
- Retire `app/libs/git_service.py` as the live implementation, or reduce it to
  a compatibility shim during cutover.

Important requirement:

- The plan must explicitly replace current GitPython-based progress handling;
  it cannot treat push/pull/clone as out of scope.

Likely touched files:

- `app/apps/file_editor_cm6/worker_services/git_service.py`
- `app/libs/git_service.py`
- `app/apps/file_editor_cm6/explorer/handlers/git.py`
- `app/apps/file_editor_cm6/main_page/backend/git_routes.py`
- any job-registry integration files needed for callback publication

Acceptance:

- Explorer push/pull/clone progress bars still work.
- existing `git_push`, `git_pull`, and `git_clone` job semantics are preserved.
- no GitPython dependency remains in steady-state `file_editor_cm6` git
  operations.

### Phase 4 - Remaining caller cleanup and store-driven events

Scope:

- Move remaining store-backed publication onto the bus where useful:
  - preferences changes
  - history/diff-base changes
  - project sidecar changes
  - open-state changes
  - draft and diagnostics projections where appropriate
- Retire legacy direct broadcast helpers if they are fully superseded.
- Reduce `git_helper.py` to a compatibility wrapper or remove it.
- Decide whether reconnect snapshot comes entirely from bus-backed snapshot
  state or from authoritative store replay plus bus projection.

Acceptance:

- project lifecycle, git, watcher, and open-state publication all route through
  the bus/projector model.
- no duplicate git publication paths remain.
- Explorer, editor, and host observe the same generation-tagged lifecycle.

### Phase 5 - Optional portability seam

This phase is not required to unlock the app-local migration, but it remains a
valid later goal.

- Treat the typed bus schema as the portability boundary.
- A future Rust or free-threaded-Python runtime can consume the same event
  shapes and reproduce the same projector behavior.
- Do not let this portability goal distort the earlier phases.

## Open Decisions

1. **Final module placement.** Recommended:
   - `app/apps/file_editor_cm6/worker_services/event_bus.py`
   - `app/apps/file_editor_cm6/worker_services/git_service.py`
     Alternative names are acceptable, but avoid
     `app/apps/file_editor_cm6/services/` unless its legacy main-process service
     README is updated first, and do not give `app/libs/git_service.py` two
     different roles.

2. **`pygit2` version pin for Termux.** `pygit2` is not currently installed in
   this environment. The implementation plan must pin a version proven against
   the target libgit2 packaging.

3. **Remote-operation parity details.** The migration must account for
   credentials, sideband/progress callbacks, push status, and clone depth/branch
   behaviors currently handled through GitPython jobs.

4. **Filesystem executor policy.** Decide whether to introduce a dedicated
   filesystem executor early or only once hot-path migration proves it is
   needed. Do not rely blindly on the default executor for every blocking file
   operation.

5. **Initial tree-paint behavior.** Decide whether Explorer should accept an
   initially clean tree until the first `GitSnapshotChanged`, or whether switch
   bootstrap gets a bounded awaited first snapshot.

6. **Snapshot API fate.** Decide whether `workspace_events.get_workspace_event_snapshot(...)`
   becomes a real bus snapshot API or is deleted.

## Risks

- **`pygit2` packaging on Termux.** The dependency is not present yet and may
  require an exact version pin or environment-specific build path.
- **Generation plumbing mistakes.** Missing one link between project switch,
  git service, and projectors will recreate stale-snapshot bugs in a different
  form.
- **Dropping hidden side effects.** Editor external-file reload and git
  baseline refresh are currently hidden behind `workspace_events.py`.
- **Queue starvation or reordering by implementation accident.** The bus should
  serialize ingress ordering while long-running handlers offload work and
  republish results.
- **Naming collision with the existing GitPython service.** Leaving both an
  app-wide git service and the legacy GitPython job service under the same name
  will create confusion.
- **Legacy service-loader confusion.** `app/apps/file_editor_cm6/services/` is
  documented as a main-process app-service directory. Placing worker-owned bus
  modules there without a README update would be misleading.
- **Legacy job compatibility.** The GitPython-backed job path in `app/libs` may
  still matter as framework compatibility while `file_editor_cm6` migrates away
  from it. Do not remove or repurpose it until callers and loader behavior are
  verified.
- **Frontend duplicate refresh triggers.** Explorer still re-issues
  `gitStatusGet` in several handlers. The backend must coalesce duplicate
  refresh demand rather than assume the frontend becomes quieter.

## Out Of Scope For Early Phases

- Changing frontend RPC method names or Explorer notification payload shapes
- Rewriting Monaco model event behavior into the bus
- Replacing WBA's internal event system
- Terminal stream publication
- Sidebar app restore semantics unrelated to project/git/open-state lifecycle
- Generic "aiofiles everywhere" cleanup not tied to measured hot paths or the
  migration itself

## Files Likely Touched Across The Full Migration

Core bus and git service:

- `app/apps/file_editor_cm6/worker_services/event_bus.py`
- `app/apps/file_editor_cm6/worker_services/git_service.py`
- `app/libs/git_service.py`

Project switch and publication:

- `app/apps/file_editor_cm6/explorer/services/project_switch.py`
- `app/apps/file_editor_cm6/explorer/services/runtime_notifications.py`
- `app/apps/file_editor_cm6/workspace_events.py`
- `app/apps/file_editor_cm6/explorer_runtime.py`
- `app/apps/file_editor_cm6/explorer/services/session_bootstrap.py`
- `app/apps/file_editor_cm6/core_read.py`
- `app/apps/file_editor_cm6/diagnostics_bridge.py`
- `app/apps/file_editor_cm6/watchexec_shell_manager.py`

Git consumers:

- `app/apps/file_editor_cm6/explorer/services/file_ops.py`
- `app/apps/file_editor_cm6/explorer/handlers/git.py`
- `app/apps/file_editor_cm6/explorer/handlers/file_tree.py`
- `app/apps/file_editor_cm6/explorer/search.py`
- `app/apps/file_editor_cm6/main.py`
- `app/apps/file_editor_cm6/main_page/backend/git_routes.py`
- `app/apps/file_editor_cm6/main_page/backend/state_payload.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
- `app/apps/file_editor_cm6/git_helper.py`

No frontend contract changes are required by this plan. Frontend cleanup to
reduce duplicate refresh requests is optional follow-up work, not a prerequisite
for the backend migration.
