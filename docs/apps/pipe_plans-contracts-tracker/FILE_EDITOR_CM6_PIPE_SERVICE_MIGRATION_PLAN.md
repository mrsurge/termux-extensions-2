# File Editor CM6 Pipe Service Migration Plan

## Purpose

Move `file_editor_cm6` filesystem, git, and OS work behind typed JSON-RPC service shells while preserving the current app routing shape during migration.

The migration is contract-first:

1. Define the DTOs, envelope, routing ids, and codec.
2. Make current in-process producers emit the future DTOs.
3. Make current consumers accept the future DTOs.
4. Cut the origin over from in-process calls to stdio pipe services.
5. Keep stdout protocol-only and move all shell/log output to stderr.

This avoids transport-first churn and lets the Python framework and Rust spike consume the same service contract.

## Merged Context From The Retired Runtime-Control-Plane Plan

The moved pygit2/event-bridge plan is superseded by this pipe-service direction.
Only the parts that still support the new boundary are carried forward here:

- the control plane is not the work plane
- project-scoped results must carry project root and project generation
- stale project work must be dropped before Explorer/editor/host/sidebar projection
- frontend surfaces keep their own lanes; DTO producers do not emit frontend-specific notification names
- stores mutate authoritative state before projections are emitted
- WBA language-feature, document-sync, and provider traffic stays on the direct WBA/editor lane
- blocking filesystem, git, extension, indexing, and OS work must move behind service interfaces
- Python and Rust should share the same envelope/DTO contract rather than copying helper sprawl

The old event-bus tracker phases remain historical context. They are not the
active architecture headline for this work.

## Non-Goals

- Do not move Monaco/WBA language intelligence traffic onto this pipe.
- Do not replace WBA's own remote-workbench document/watch protocol in this phase.
- Do not move local app sidecar/preference/history JSON persistence unless a later phase explicitly includes persistence services.
- Do not introduce polling where event/ack routing already exists.
- Do not create a second app-wide bus as a substitute for the pipe service boundary.
- Do not keep old stdout metrics/logging behavior in any process where stdout is reserved for protocol frames.
- Do not preserve GitPython/pygit2 as the architecture headline; those are implementation candidates behind the service boundary.

## Target Runtime Shape

The framework supervises service shells. App workers and app surfaces become clients of framework-routed service calls.

```text
Explorer / Editor / Main host
        |
        | typed request DTOs over current in-process route first
        v
file_editor_cm6 backend projection layer
        |
        | same envelope/DTOs after cutover
        v
Framework pipe router
        |
        | stdin/stdout JSON-RPC, stderr logs
        v
fs/git/os service shell
```

The same service shell contract must be usable by:

- the current Python framework
- the Rust spike framework
- app workers launched by framework-shells
- future standalone service shells that own blocking Python or native work

## Consumers And Needs

### Explorer

Needs:

- directory listings with stable entry metadata
- tree mutation results for create/delete/copy/move/rename
- search results and progress
- git status/decorations for file tree rendering
- file-change and git-change invalidation signals
- project-root scoped request generation so stale switch results are ignored

Migration requirement:

- Explorer should consume `FsDirectoryListing`, `FsMutationResult`, `SearchResultBatch`, `GitSnapshot`, and `FileChangeBatch` DTOs before the pipe cutover.
- For git, the in-process producer must generate the final `GitSnapshot` shape first; the later pipe cutover changes the producer origin to `service.git` without changing Explorer projections.

### Editor

Needs:

- open/read file content
- atomic write/save
- stat/hash metadata
- disk-vs-buffer and git-head baselines
- git head blob reads
- document-scoped file-change invalidation
- project-generation guardrails

Migration requirement:

- Editor should consume `FsReadResult`, `FsWriteResult`, `FsStatResult`, `GitHeadBlobResult`, and `EditorBaselineSnapshot` DTOs before the pipe cutover.

### Main Host

Needs:

- active project branch/remote data
- branch checkout/create actions
- app-level git status summaries
- project-open/create side effects that currently depend on filesystem checks
- user-visible progress/error projection

Migration requirement:

- Host/UI IPC should consume `GitBranchList`, `GitRemoteList`, `GitMutationResult`, and `ProjectFsValidationResult` DTOs through its existing backend lane.

### Framework Python

Needs:

- service process lifecycle
- route requests by target NID and request id
- supervise stderr logs independently from stdout protocol
- cancellation and timeout ownership
- backpressure and queue visibility
- app/project generation awareness without app-specific coupling

Migration requirement:

- Python framework owns the first pipe router implementation and provides a compatibility client for `file_editor_cm6`.

### Rust Spike

Needs:

- same pipe protocol without Python app-worker internals
- event-loop-owned process supervision
- byte/object/string payload codec compatibility
- deterministic error and progress envelopes
- enough DTO stability to avoid porting every Python helper into Rust immediately

Migration requirement:

- Contract files must stay language-neutral and not depend on Python class names or TypeScript-only shapes.

### WBA Watcher Bridge

Needs:

- normalized file-change DTOs from WBA watcher notifications
- project-generation aware invalidation
- no takeover of WBA language/document intelligence

Migration requirement:

- WBA watcher output should normalize into `FileChangeBatch`, then feed the same service invalidation/projection path as other file-change producers.

## Project Switch Ordering Boundary

Project switch remains the ordering boundary for project-scoped fs/git/os
results. The old runtime plan's ordering model is retained, but future blocking
work should be executed through service DTOs and pipe calls instead of direct
helpers.

Required ordering:

1. validate and assign backend project root
2. mint `projectGeneration`
3. publish/project switch-start lifecycle state
4. reset/rebind project session state and Explorer connections
5. reset project-scoped diagnostics
6. reconnect WBA when requested
7. observe adapter session reset/workspace-ready facts
8. ensure WBA watcher bridge is running
9. start watcher fallback if needed
10. replay sidecar open state
11. request generation-tagged git/fs snapshots through the service boundary
12. project switched surface notifications on their own lanes
13. publish/project switch-finished lifecycle state

Any async fs/git/os result from an older generation must be dropped before it
mutates projected frontend state.

## Bootstrap And Replay Requirements

Reconnect/bootstrap should replay from backend state, not frontend retries.
Service DTOs must preserve enough data to support this replay order:

1. active project metadata
2. adapter/project readiness
3. open-state / active-file projection
4. root tree / open directories
5. last-known git projection or pending-refresh marker
6. watcher status/error projection
7. diagnostics detail/counts projection
8. draft/review projection
9. preferences/sidebar-window projection where relevant

The unresolved old-plan question remains live: `workspace_events.py` should
either become a real backend snapshot facade or be split/retired after equivalent
replay state exists elsewhere.

## Store Authority

The first pipe-service cutover does not move store authority.

These remain authoritative until a later persistence-service phase explicitly
changes them:

- preferences store
- history store
- project sidecars
- open-state backend
- sidebar window ledger
- draft/review stores

The pipe services provide filesystem/git/os operation results. Store mutation
and surface projection stay in the app/framework layer unless a later plan moves
that boundary.

## Migration Phases

### Phase 1: Contract And DTO Registry

- Define envelope fields.
- Define NID registry and assignment rules.
- Define request/response/error/progress/cancel shapes.
- Define correlation id rules for project switch, WBA reconnect, search, git jobs, and multi-step file operations.
- Define DTO names and versioning rules.
- Define stdout/stderr discipline.
- Define byte/object/string payload codec.
- Define where stdout metrics/logging move when a worker is running in protocol mode.

Exit criteria:

- Contract draft exists and is accepted as the source of truth for new fs/git/os service work.

### Phase 2: Producer DTO Generation In Current Code

Existing producers keep their current execution location but start generating future DTOs.

Initial producer targets:

- Explorer file listings and file mutations
- Worker git status/decorations/head blob service
- Legacy git helper mutation results
- Diff helper results
- Explorer search result batches
- Explorer search replace preview/apply results
- Editor open/read/save/baseline operations
- WBA watcher file-change normalization
- Existing `workspace_events.py` side effects made explicit as DTO producers, invalidators, or projectors

Exit criteria:

- Current in-process producers can emit the same DTOs the pipe services will emit later.

### Phase 3: Consumer DTO Acceptance

Existing consumers keep their current lanes but accept DTOs as input.

Initial consumer targets:

- Explorer list/status/decorations projectors
- Editor open/save/baseline consumers
- Main host git branch/remote/status consumers
- Workspace/file-change/git-change invalidation consumers

Exit criteria:

- Current UI behavior can be driven from future DTO shapes without the pipe transport enabled.

### Phase 4: Codec And Protocol Runtime

- Implement the stream codec.
- Implement request id routing.
- Implement app-boundary routing plus target identity routing: the normal app
  route selects the app boundary, `targetName` / `targetNid` select the
  app-internal service or consumer, and request `id` routes only the terminal
  response.
- Implement progress/cancel routing.
- Implement stderr log capture.
- Implement stdout corruption detection for services that accidentally print logs/metrics.
- Implement correlation id propagation across project switch, WBA reconnect, and long-running service operations.
- Add protocol conformance tests using fake service shells.

Exit criteria:

- The framework can run a fake fs/git/os shell and route requests/responses correctly over stdin/stdout.

### Phase 5: Pipe Cutover By Service Family

Cut over one service family at a time.

Suggested order:

1. read-only fs stat/list/read operations
2. git status/decorations/head blob reads
3. editor baseline reads
4. search
5. search replace preview/apply
6. fs write/mutation operations
7. git mutations/history/remotes
8. OS/subprocess helpers

Exit criteria:

- Each family can switch origin from in-process implementation to pipe service without changing frontend DTO consumers.

### Phase 6: Cleanup And Hardening

- Remove obsolete direct subprocess/git/fs helper paths after the replacement path is proven.
- Keep compatibility shims only where older callers still exist.
- Add strict stdout guards to service shell launchers.
- Add structured stderr log tagging.
- Add backpressure metrics.
- Move or disable old stdout event metrics for protocol-mode app workers/services.

Exit criteria:

- fs/git/os operations no longer block app hot paths directly.

## Files Expected To Be Touched Later

This is not an edit approval list. It is the expected migration surface from the current audit.

Explorer:

- `app/apps/file_editor_cm6/explorer/services/file_ops.py`
- `app/apps/file_editor_cm6/explorer/services/render_state.py`
- `app/apps/file_editor_cm6/explorer/search.py`
- `app/apps/file_editor_cm6/explorer/services/search_sessions.py`
- `app/apps/file_editor_cm6/explorer/handlers/file_tree.py`
- `app/apps/file_editor_cm6/explorer/handlers/git.py`
- `app/apps/file_editor_cm6/explorer/handlers/search.py`
- `app/apps/file_editor_cm6/explorer/transport/rpc_contract.py`
- `app/apps/file_editor_cm6/src/explorer/rpc/contract.ts`
- `app/apps/file_editor_cm6/src/explorer/search/`

Editor:

- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/open_service.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/save_service.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_view_state_backend.py`
- `app/apps/file_editor_cm6/core_read.py`
- `app/apps/file_editor_cm6/core_write.py`

Git and diff:

- `app/apps/file_editor_cm6/git_helper.py`
- `app/apps/file_editor_cm6/diff_helper.py`
- `app/apps/file_editor_cm6/worker_services/git_service.py`
- `app/apps/file_editor_cm6/main_page/backend/git_routes.py`
- `app/apps/file_editor_cm6/host/git_backend.py`

Watcher and invalidation:

- `app/apps/file_editor_cm6/wba_event_bridge.py`
- `app/apps/file_editor_cm6/workspace_events.py`
- `app/apps/file_editor_cm6/watchexec_shell_manager.py`

Control-plane compatibility:

- `app/apps/file_editor_cm6/worker_services/event_bus.py`
- `app/apps/file_editor_cm6/worker_services/runtime.py`
- `app/apps/file_editor_cm6/adapter_lifecycle_events.py`
- `app/apps/file_editor_cm6/project_switch_events.py`
- `app/apps/file_editor_cm6/open_state_events.py`
- `app/apps/file_editor_cm6/shellspec/app_worker.yaml`

Framework and Rust spike:

- Python framework service launcher/router paths to be selected during framework-side design.
- Rust spike pipe router paths to be selected during Rust implementation planning.

## Old Plan Consolidation Status

The old plan was moved into this directory and skimmed after this new direction
was drafted.

Superseded file:

- `docs/apps/pipe_plans-contracts-tracker/FILE_EDITOR_CM6_PYGIT2_AND_TYPED_EVENT_BRIDGE_PLAN.md`

Merged forward:

- project-generation stale-drop requirements
- surface projection lane rules
- bootstrap/replay ordering
- store authority preservation
- WBA/direct-language-intelligence boundary
- git direct-subprocess cleanup target
- Rust portability-through-service-interfaces direction
- correlation id loose thread
- stdout metrics conflict
- `workspace_events.py` side-effect audit

Deprecated or redirected:

- old event-bus tracker phases are historical, not active pipe work
- pygit2/GitPython-specific direction is redirected behind the `service.git` boundary
- stdout event metrics are invalid for protocol-mode workers/services unless moved off stdout
- low-level git execution should not become an event-bus command executor; it belongs behind the pipe service
