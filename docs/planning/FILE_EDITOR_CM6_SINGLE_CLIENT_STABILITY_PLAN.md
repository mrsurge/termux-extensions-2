# File Editor CM6 Single-Client Stability Plan

## Status

Active planning reference for the immediate stability track.

This document is intentionally narrower than the broader refactor plans. It does not change product scope. It is the state-refactor plan for stabilizing the existing product model:

- one logical client
- one active project
- one active file, or an explicit no-file state

Multi-file, multi-project, and multi-client work remain future work, as before. This document is only about making the current state model stable.

## Goal

Stabilize the current `file_editor_cm6` state model without changing the current product shape.

This is not a new scope decision. It is a refactor guardrail around the existing single-client, single-project, single-file product model.

For this track, "stable" means:

- the main page, editor, explorer, WBA, terminal, and file-sync surfaces converge on the same active project after boot, reconnect, and project switch
- the editor converges on the same active file, or visibly converges on no file
- project switch no longer needs a full page reload to hide state drift
- reconnect and resync behavior come from one backend-owned state contract instead of partial refreshes and frontend guesswork

## Non-Goals

This track does not include:

- tabs or multi-file editor state
- multiple simultaneously open projects
- multi-client coherence across several live windows
- performance-first hot project switching
- opportunistic UI feature work mixed into the stabilization path

If a change is only useful for tabs, multi-file caching, or multi-project retention, it belongs after this plan.

## Existing Product Model For This Refactor

The current app model already behaves as:

- one logical `main_page` client
- one active project root
- one active file, or none

That means:

- no surface should behave as if several files are active at once
- no surface should retain a previous project's live state after the backend has switched projects
- no surface should invent its own project or file truth from stale local state

## Current Problem

The current system still relies on a full page reload at the end of project switch. That reload is acting as a crude state barrier, not as a real solution.

Today the project-switch path:

- clears some host-local state in `main_page/frontend/ui/project-switch.ts`
- calls `syncEditorState(true)`
- then calls `reloadEditorSurface()`
- which is wired in `main.ts` to `window.location.reload()`

This hides several missing synchronization steps:

- UI IPC reconnect only replays a shallow subset of state
- the full boot snapshot exists, but reconnect and project switch do not reuse it
- empty editor SSOT state does not hard-clear editor-owned state
- Explorer reconnect is partial
- project-switch WBA behavior is inconsistent across backend paths

The result is that the app works by resetting the whole page instead of proving that one client can resynchronize correctly.

## Working Rule Until The Fix Exists

Do not remove the full page reload until the replacement transaction exists and passes the acceptance criteria in this document.

`window.location.reload()` is not the goal, but it is currently hiding real drift. Removing it early would turn a masked correctness problem into a user-visible correctness problem.

## Ownership Model For This Track

The stabilization work should preserve the current intended ownership boundaries:

- backend/worker owns active project, session state, SSOT, and cross-domain orchestration
- host page is an initiator and renderer
- editor is a file-scoped renderer and interaction surface
- Explorer is a project-scoped renderer and interaction surface
- WBA is the language-intelligence producer
- terminal and file-sync transports are peripherals attached to the active project/client state

The immediate fix is not "let more frontends talk directly to each other." The immediate fix is "make backend-owned state replay coherent for one client."

## Required Invariants

These are refactor guardrails for the existing product model, not new product decisions.

### 1. Single Logical Client

This plan targets one live `main_page` client. Extra windows or several simultaneous clients are out of scope for now.

### 2. Single Active Project

After boot, reconnect, or project switch, every surface must agree on exactly one active project path.

### 3. Single Active File Or Explicit No-File State

The system must converge on:

- one active file path
- or an explicit empty editor state

No surface may silently preserve a previous file when backend state says there is none.

### 4. Snapshot-First Recovery

Boot, reconnect, and project switch should all hydrate from one backend snapshot contract.

The system should not keep mixing:

- full boot snapshot
- partial `/state` refresh
- local host resets
- partial Explorer refresh
- ad hoc editor-local assumptions

### 5. Hard Clear On Empty File State

If the backend snapshot says there is no active file, editor-owned local state must be cleared, not merely ignored.

That includes:

- visible model binding
- diagnostics projection
- draft diff state
- cache markers
- git baselines
- open-barrier / pending-open state

### 6. One Project-Switch WBA Policy

The current system should not use two different project-switch stories at once.

There must be one chosen policy for this product path, applied consistently across:

- explicit host/sidebar project switch
- Explorer-driven project switch
- reconnect/bootstrap behavior

### 7. Peripheral Rebind After State Resolution

Terminal and file-sync sockets should rebind only after the new project state is resolved, not before.

## Audit Summary

### Full Reload Is In The Active Project-Switch Path

- `main_page/frontend/ui/project-switch.ts` resets host-local state, calls `syncEditorState(true)`, then calls `reloadEditorSurface()`
- `main.ts` wires that reload callback to `window.location.reload()`

### UI IPC Reconnect Is Too Shallow

- `main_page/frontend/connections/ui-ipc.ts` reconnect handling is mostly transport-level
- `ui_ipc/ui_ipc_ws.py` connect fanout emits adapter state and active file state, but not a full current-client snapshot

### Full Boot Snapshot Already Exists But Is Not The Shared Recovery Contract

- `boot_snapshot_backend.py` already builds a rich snapshot containing `host_state`, `session_state`, `editor_ssot`, `ui_prefs`, and `explorer_bootstrap`
- `main_page/frontend/boot/boot-sequence.ts` consumes that on initial boot
- `main_page/frontend/boot/editor-state.ts` still uses `/state` for later `syncEditorState(true)` refreshes

### Empty Editor SSOT Does Not Fully Clear Editor-Owned State

- `monaco_editor/editor_socket_connection_runtime.ts` currently treats empty SSOT as a weak case instead of a hard reset case
- that leaves room for stale models, diagnostics, draft-diff state, or git baseline state to survive a project switch with no active file

### Explorer Reconnect Is Partial

- `src/explorer/app/refresh-controller.ts` has a stronger `refreshRootAndOpenDirectories()` path
- reconnect currently uses the weaker refresh path instead of fully restoring open directories and related state

### WBA Project-Switch Policy Is Split

- `explorer/services/project_switch.py` can use workspace hot-switch behavior
- `main_page/backend/project_service.py` currently terminates adapter state as part of project switch cleanup

For this track, that split is complexity without upside.

## Decision For This Track

Optimize for correctness and determinism, not clever warm switching.

The recommended baseline for the single-client stability track is:

- backend-owned project switch
- explicit teardown of project-bound state
- explicit snapshot rebuild
- explicit client resync
- explicit rebind of project-bound transports

That means the simpler default is:

- terminate and re-establish WBA/project-bound runtime on explicit project switch

Hot `switchWorkspace` behavior can be revisited later as an optimization, after the one-client path is stable and proven.

## Required Replacement: One Resync Transaction

The full reload should be replaced by one explicit resync transaction.

Suggested shape:

- backend phase: switch project and rebuild authoritative current-client snapshot
- host phase: apply snapshot and drive downstream rebinds in order
- editor phase: hard-clear local file state, then apply active file or explicit empty state
- Explorer phase: apply backend bootstrap instead of partial refresh
- peripheral phase: reopen or rebind terminal/file-sync transports only after the project and file state are settled

This can be implemented under any exact method/function names, but it needs to exist as one coherent transaction, not as scattered event repairs.

## Implementation Phases

### Phase 1. Freeze The Scope

- keep this track explicitly limited to single-client, single-file, single-project stability
- keep the current reload in place while the replacement path is incomplete
- do not mix multi-file or tab behavior into this sequence

### Phase 2. Promote One Backend Snapshot Contract

Turn the existing boot snapshot into the shared current-client snapshot contract for:

- initial boot
- UI IPC reconnect
- project switch completion

Practical direction:

- reuse or extend `boot_snapshot_backend.py`
- stop treating `/state` as a separate partial truth source
- either retire `/state` from this path or make it a thin wrapper over the same underlying snapshot builder

### Phase 3. Make Host Resync Snapshot-Driven

Replace project-switch dependency on `syncEditorState(true)` as the main recovery step.

The host project-switch path should:

- request or receive the full current-client snapshot
- update host/project/session UI from that snapshot
- defer transport rebinds until snapshot application is complete

This keeps project-open behavior backend-owned instead of growing more host-only repair logic.

### Phase 4. Implement Hard Editor Empty-State Reset

When the snapshot resolves to no active file, the editor runtime must actively clear file-owned state.

Minimum expectation:

- dispose or detach the active visible file model state
- clear diagnostics projection for the visible file
- clear draft diff display/runtime state
- clear git baseline state tied to the old file
- clear any pending open barrier or stale active-file assumption

No-file is a real state, not a "do nothing" branch.

### Phase 5. Make Explorer Reconnect And Project Switch Bootstrap-Driven

Explorer should stop treating reconnect as:

- root refresh
- git status refresh

and nothing more.

For this track it should restore, from backend-owned data:

- root listing
- open directories
- watcher config
- active file projection
- git decorations/status

If `explorer_bootstrap` already exists in the boot snapshot contract, this plan should reuse that instead of inventing another partial recovery path.

### Phase 6. Unify WBA Project Policy

Choose one project-switch policy for the stabilized path and apply it everywhere.

Recommended default for now:

- explicit termination and clean reconnect on project switch

That means:

- no competing hot-switch logic for the same user path
- no split mental model where one caller "switches workspace" and another caller "tears everything down"

If same-project reconnect still needs `te2.resync` or similar control hooks, keep that separate from explicit project-switch semantics.

### Phase 7. Rebind Project-Bound Transports In Order

After the new snapshot is applied:

- file-sync websocket rebind should target the resolved active project/file state
- terminal websocket rebind should target the resolved active project state
- any host/editor reconnect affordances should fire after the authoritative project context is known

The current terminal force-rebind behavior is a useful foundation here, but it needs to sit inside the larger ordered transaction.

### Phase 8. Remove The Full Reload

Only after the earlier phases are implemented and verified:

- remove `window.location.reload()` from the project-switch path
- make `reloadEditorSurface()` either disappear or become a bounded surface reset that does not reload the page

## Acceptance Criteria

The single-client stability track is not complete until all of the following are true:

### Project Switch

- switching to another project lands on the correct active project without a full page reload
- switching to a project with an active file lands on the correct file state across host, editor, Explorer, and WBA
- switching to a project with no active file leaves the editor visibly empty and clean

### Reconnect

- reconnect in the same project restores host UI, Explorer open directories, watcher state, and editor file state from one snapshot path
- reconnect does not require ad hoc per-surface refresh calls to look correct

### No Stale Cross-Project State

- old diagnostics do not survive into the next project
- old draft diff state does not survive into the next project
- old git baselines do not survive into the next project
- old active-file toolbar/path state does not survive into the next project

### Peripheral Correctness

- terminal drawer reconnects to the correct project after switch
- file-sync reconnects to the correct project/file after switch
- WBA readiness reflects the chosen project-switch policy and does not silently preserve the old workspace state

### Scope Discipline

- no part of this path depends on tabs, multi-file state, or multi-project retention

## Still Future Work After This Plan

These remain future capabilities after the current state-refactor track:

- multi-file editor state
- tabs
- several open documents in one live client
- multi-project retention inside one live client
- hot workspace switching as an optimization
- multi-client coherence

## Relevant Code Map

- `app/apps/file_editor_cm6/main_page/frontend/ui/project-switch.ts`
- `app/apps/file_editor_cm6/main.ts`
- `app/apps/file_editor_cm6/main_page/frontend/connections/ui-ipc.ts`
- `app/apps/file_editor_cm6/ui_ipc/ui_ipc_ws.py`
- `app/apps/file_editor_cm6/boot_snapshot_backend.py`
- `app/apps/file_editor_cm6/main_page/frontend/boot/boot-sequence.ts`
- `app/apps/file_editor_cm6/main_page/frontend/boot/editor-state.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_socket_connection_runtime.ts`
- `app/apps/file_editor_cm6/src/explorer/app/refresh-controller.ts`
- `app/apps/file_editor_cm6/src/explorer/rpc/runtime.ts`
- `app/apps/file_editor_cm6/explorer/services/project_switch.py`
- `app/apps/file_editor_cm6/main_page/backend/project_service.py`
- `app/apps/file_editor_cm6/terminal_backend.py`
- `docs/planning/FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`
- `docs/planning/FILE_EDITOR_CM6_MAIN_PAGE_DECOMPOSITION_PLAN.md`
- `docs/planning/FILE_EDITOR_CM6_OWNERSHIP_BOUNDARY_CONTRACT.md`
