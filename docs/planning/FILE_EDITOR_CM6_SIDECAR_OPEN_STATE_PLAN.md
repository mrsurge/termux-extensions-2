# File Editor CM6 Sidecar-Event Open State Plan

## Status

Active planning reference for the immediate `file_editor_cm6` project/open-file stability track.

This document replaces the older framing that treated the problem as mostly a reload-removal or snapshot-resync issue. The correct direction is narrower and stricter:

- the last opened project is **the open project**
- the project sidecar `last_file` is **the open file**
- history store owns the open project only
- project sidecar owns opened-file information only
- every connected client is a renderer of sidecar-backed open state
- sidecar writes must behave like an event source: write once, notify everyone, and replay on reconnect
- old lazy/session/history/MRU paths must be removed or converted, not preserved as alternate open-file behavior

The existing file-open restrictions remain part of the contract. A file open command must require an active project sidecar and must reject files outside the currently opened project. This plan does not add those semantics as a new feature; it makes the already-intended sidecar-backed behavior event-driven instead of lazy-loaded.

This is not a cautious compatibility shim track. The implementation should change whatever open-state paths need to change so open-file state is fully derived from the event-driven sidecar backend. Workarounds, fallback authorities, and hidden older behavior paths are out of scope.

## Goal

Make project/open-file state event-driven and sidecar-authoritative so clients cannot disagree about the opened file.

The current app is intentionally one active project and one open file. Until that single-file model is correct, tabs, several open files, per-client open files, and multi-project retention remain out of scope.

For this track, stable means:

- every surface agrees on the same open project
- every surface agrees on the same open file, or the same explicit no-file state
- switching projects cannot leave the editor showing a file from the previous project
- `Scroll to opened file` always reflects the same sidecar-backed open file in every client
- reconnect forces the same sidecar-backed state as a live sidecar event
- no frontend-local `currentPath`, stale session state, or MRU fallback can become a competing open-file authority

## Portability Rationale

File-backed project state is intentional architecture, not incidental persistence.

The sidecar should become the clean portability boundary for a future language/runtime port:

- the durable data shape defines the state contract
- named backend write operations define the mutation contract
- sidecar-derived events define the runtime convergence contract
- clients and in-memory services are projections that can be discarded and rebuilt

That only works if the sidecar is authoritative enough to port cleanly. A JSON sidecar that is sometimes written and sometimes bypassed is just a cache. The target here is stronger: file-backed state plus explicit event ordering, revisioning, replay, and no competing runtime authority.

## Non-Goals

This track does not include:

- tabs
- multiple simultaneously open files
- per-client open-file divergence
- multiple simultaneously open projects
- hot project switching as a performance optimization
- UI feature work unrelated to open-project/open-file authority

## Source Of Truth

### Open Project

The open project is the last opened project recorded by the backend history/project state.

History store may still expose compatibility helpers for recent projects and legacy data migration, but it must not own opened-file identity.

### Open File

The open file is the project sidecar `last_file` for the open project.

Opened-file information belongs only in the project sidecar. Other values are projections:

- frontend `currentPath` is a rendered projection
- host/editor session state is a rendered projection
- Explorer `activeFileRel` is a rendered projection
- WBA active document state is a rendered projection
- history recent-file entries may exist only as MRU data or one-time migration input, not as open-file state

If any projection disagrees with the sidecar, the projection is wrong.

No implementation path should read a projection, session field, or history MRU entry to repair open-file disagreement at runtime. Runtime repair must come from reloading the project sidecar and emitting the sidecar open-state event.

### No-File State

No open file is also a real sidecar-backed state. If the sidecar has no `last_file`, every client must clear editor/file projections instead of preserving an old file.

## Required Event Model

The sidecar must behave like a local event source for open-file state.

The practical model is UDS-like:

1. A backend operation writes the authoritative project sidecar state.
2. The same backend operation publishes an open-state event after the write succeeds.
3. Every connected client listens for that event and applies it.
4. Reconnect reads the sidecar and replays the same event shape.
5. Project switch reads the selected project's sidecar and emits the same event shape.

This means boot snapshots can still exist for hydration, but they are not the contract that makes open-file state correct. The contract is the sidecar-backed open-state event.

Snapshots must not become an alternate open-file lane. If a snapshot carries open-file data, that data is a copy of the latest sidecar event or a boot-time replay of sidecar state. It is not an independent authority.

## Event Payload Contract

The open-state event should be explicit and sidecar-derived.

Suggested logical shape:

```json
{
  "projectPath": "/abs/project",
  "sidecarPath": "/abs/sidecar.json",
  "openFile": "/abs/project/file.py",
  "openFileRel": "file.py",
  "openFileExists": true,
  "revision": 123,
  "reason": "file_open | project_open | project_open_with_file | reconnect | sidecar_replay | no_file",
  "ts": 1770000000000
}
```

For no-file state, `openFile` and `openFileRel` should be `null`, and `reason` should make the clear explicit.

The exact field names can change during implementation, but all clients must consume one event family rather than separate host/editor/Explorer assumptions.

The event must carry enough ordering information for clients to reject stale state after reconnect, project switch, or concurrent writes. A sidecar revision/version is therefore part of the contract, not a diagnostic nice-to-have.

## Required Write Paths

Every operation that changes the opened file must write through one backend-owned sidecar helper/service.

Required paths:

- normal editor file open
- Explorer file open
- sidebar/backend file open
- project switch to a project with an existing `last_file`
- project switch to a project with no `last_file`
- open project with a specific file target
- reconnect replay
- sidecar reset/clear-open-file operations

A file-open command that does not have a project sidecar must be rejected. A file outside the currently opened project must be rejected. Those restrictions are part of the current intended setup and must be preserved.

There should be no second permissive path for "best effort" opens. If a call cannot resolve the active project sidecar and prove the target belongs to that project, it fails instead of updating local UI state.

## Open Project With File Target

A special project-open transaction is required for callers that open a project with a specific file in mind.

This must be one backend transaction:

1. validate or create/load the target project sidecar
2. validate that the requested file is inside the target project
3. set the target project as the open project
4. write the requested file into that project's sidecar as `last_file`
5. emit the same sidecar-backed open-state event used by normal file open

This path must not switch project first and then rely on a later lazy file-open repair. The sidecar and open-project state must move together.

## Client Responsibilities

Clients render events. They do not decide the open file.

### Host/Main Page

- update toolbar/path/status from the sidecar event
- update local `currentPath` projection only after receiving the sidecar event
- rebind file-sync only after the sidecar event identifies the open file
- clear host file state on explicit no-file event

### Editor

- open the event's file when `openFile` is present
- hard-clear visible file state when `openFile` is null
- discard stale pending opens from a previous project when project/revision changes
- treat editor-local state as projection only

### Explorer

- set active-file marker from the event's project-relative path
- make `Scroll to opened file` use the current sidecar event projection
- clear active-file marker on no-file events
- on reconnect, wait for sidecar replay rather than guessing from local tree state

### WBA

- treat the event's file as the active document projection
- clear or reconnect active document state on no-file or project-change events
- never preserve a previous-project active document after sidecar replay says otherwise

### Terminal/File-Sync

- terminal run-active-file uses the sidecar event projection, not stale frontend state
- file-sync websocket binds only after project and open-file event resolution

## Reconnect Behavior

Reconnect must force convergence by replaying sidecar state.

On reconnect:

1. backend resolves the open project from history/project state
2. backend loads that project's sidecar from disk
3. backend emits the same open-state event used by live writes
4. clients apply it exactly like a live write

Reconnect must not rely on a client-side lazy MRU read or stale frontend `currentPath` value.

## Project Switch Behavior

Project switch is not a frontend reset problem. It is an open-project plus sidecar replay problem.

On project switch:

1. backend sets the open project
2. backend loads the selected project's sidecar
3. if `last_file` exists and is valid, backend emits open-state event for that file
4. if no valid `last_file` exists, backend emits explicit no-file event
5. every client applies that event

This prevents the editor from retaining the previous project's file and prevents Explorer clients from disagreeing about whether there is an opened file to reveal.

Project switch must not rely on page reload, boot snapshot timing, frontend clear-first logic, or delayed MRU repair as a correctness barrier. The sidecar replay event is the barrier.

All project switch initiators must hook the same backend switch operation. The Explorer project modal, Explorer new-project flow, sidebar IPC project open/create, and any retained HTTP project route should converge through the shared Explorer project-switch service rather than reimplementing `set_project_root`, history writes, adapter cleanup, or frontend resync as separate switch methods.

The no-reload switch path has a separate WBA readiness race: the adapter/workbench side can still be unavailable when the sidecar replay asks the editor to open the restored file. That should be solved with an explicit WBA/readiness gate or queued replay in the shared switch/open-state flow, not by reintroducing a full page reload or a second project-switch implementation.

## Current Failure Class

The failure this plan targets is:

- one client says there is no opened file to reveal
- another client scrolls to MRU/opened file
- the editor can remain on a file from the previous project after switch

That failure means sidecar-backed open-file state is not being published and replayed as an event. It is not solved by another frontend-local refresh or by relying on page reload as a barrier.

It is also not solved by adding fallback reads from history/session state. Those reads recreate the disagreement by allowing clients to converge on different authorities.

## Implementation Phases

### Phase 1. Define The Sidecar Open-State Event

- define one backend event family for sidecar-backed open-project/open-file state
- include project path, open file or null, sidecar revision/version, reason, and timestamp
- document which logical namespaces receive the event
- define stale-event rejection rules based on project and revision

### Phase 2. Centralize Sidecar Open-File Writes

- create or identify one backend helper/service for setting sidecar `last_file`
- route all open-file writers through it
- preserve existing validation: sidecar required, file must be inside current project
- emit the sidecar event only after the write succeeds
- remove direct projection writes that claim to set the open file without the sidecar helper

### Phase 3. Reconnect Replay

- on client reconnect, load sidecar from disk and emit the same event shape
- ensure ProjectSidecar in-memory cache is reloaded or invalidated before replay so disk writes win
- remove any client-side MRU guessing from reconnect correctness

### Phase 4. Project Switch Replay

- after setting the open project, load that project's sidecar
- emit open-file or no-file event from sidecar state
- make project switch consumers apply that event before rebinding peripherals

### Phase 5. Open Project With File Target

- add a backend transaction that sets open project and sidecar `last_file` together
- emit the same sidecar event after the combined write
- reject target files outside the project

### Phase 6. Remove Competing Open-File Authority

- demote history/session/frontend `currentPath` to projections only
- stop reading history `last_file` as an authority except for one-time legacy migration into sidecar
- make `Scroll to opened file`, toolbar file name, editor visible file, WBA active document, and terminal run-active-file consume the same sidecar event projection
- delete fallback branches that preserve older behavior after the sidecar event path exists
- treat any remaining fallback branch as a bug unless it is explicitly a one-time migration from old disk data into the sidecar

### Phase 7. Validate Without Reload

Acceptance must prove event convergence, not just local state refresh.

Required scenarios:

- switch project with valid sidecar `last_file`
- switch project with no sidecar `last_file`
- switch project with invalid/deleted sidecar `last_file`
- open project with specific file target
- open a file in one client and watch another client converge
- reconnect a client and confirm it receives the sidecar replay
- `Scroll to opened file` agrees across clients after each scenario

## Acceptance Criteria

This track is complete only when:

- history store is authoritative only for the open project
- project sidecar is authoritative only for the open file
- file-open writes emit sidecar-backed events
- project switch emits sidecar-backed open-file or no-file events
- reconnect emits sidecar-backed replay events
- every connected client applies the same event projection
- no client can keep showing a previous project's file after project switch
- `Scroll to opened file` never disagrees between clients
- no open-file command bypasses sidecar validation
- no runtime fallback to history/session/currentPath can change or repair the open file
- stale or missing sidecar state produces one explicit no-file event instead of preserving an old file

## Relevant Code Map

- `app/apps/file_editor_cm6/project_sidecar.py`
- `app/apps/file_editor_cm6/history_store.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/open_service.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_rpc_socketio.py`
- `app/apps/file_editor_cm6/host/file_ops_backend.py`
- `app/apps/file_editor_cm6/main_page/backend/project_service.py`
- `app/apps/file_editor_cm6/main_page/frontend/ui/project-switch.ts`
- `app/apps/file_editor_cm6/main_page/frontend/connections/ui-ipc.ts`
- `app/apps/file_editor_cm6/src/explorer/tree/active-file-utils.ts`
- `app/apps/file_editor_cm6/src/explorer/rpc/notifications.ts`
- `app/apps/file_editor_cm6/src/explorer/app/bootstrap.ts`
- `app/apps/file_editor_cm6/boot_snapshot_backend.py`
- `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`
- `docs/planning/FILE_EDITOR_CM6_MAIN_PAGE_DECOMPOSITION_PLAN.md`
