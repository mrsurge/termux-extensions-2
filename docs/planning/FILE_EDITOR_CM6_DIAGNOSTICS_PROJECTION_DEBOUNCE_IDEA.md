# File Editor CM6 Diagnostics Projection Debounce Idea

## Status

Idea only. Do not treat this note as an approved implementation plan.

The current direct WBA socket and code-server UDS transport should sit for a while before more behavior is layered onto it. The goal is to keep observing the new WBA shape while continuing smaller editor typing and JS-to-TS cleanup work.

## Context

The diagnostics lane now has much lower latency than it did before the direct WBA socket and UDS work. That changes the tradeoff for diagnostics thrash. A frontend-only debounce at the editor boundary may now be enough to smooth intermittent marker churn without adding another backend cache, coalescer, or diagnostics ownership layer.

The motivating symptom is BasedPyright-style marker churn while typing:

1. diagnostics with markers arrive
2. a transient zero-marker update arrives
3. corrected diagnostics arrive shortly after

If Monaco applies every projection immediately, the visible editor can flicker between error/no-error/error. But the zero-marker update is still semantically important because it may also be the real final state after all issues are fixed.

## Proposed Shape

Keep raw diagnostics ingestion immediate and authoritative:

```text
raw WBA diagnostics -> owner/resource marker store update -> debounced active-model projection
```

Only debounce the final projection into the active Monaco model.

Do not debounce or drop the raw WBA diagnostics event itself.
Do not debounce the vendored owner/resource marker-store update.
Do not add Python-side diagnostics coalescing for the editor lane.

## Intended Behavior

If the backend sends nonzero -> zero -> nonzero within a short window, Monaco should only render the final nonzero state.

If the backend sends nonzero -> zero and then goes quiet, Monaco should render the zero-marker state after the debounce delay and clear the editor markers correctly.

This means the debounce must be trailing and last-projection-wins, not a rule that suppresses zero-marker updates.

## Likely Boundary

The likely boundary is the active-editor diagnostics projection path in the Monaco editor runtime, around the vendored diagnostics store and active-model marker application.

The owner/resource store remains the source of truth. The debounce only controls when the active model gets reprojected through Monaco marker APIs.

## Initial Parameters To Consider

Start conservatively:

- trailing debounce only
- per active model/resource
- roughly 40-80 ms initial delay
- cancel/reschedule on new raw diagnostics batch for the same active resource
- cancel/reschedule on active model switch or open-generation change

Do not add max-wait, cross-file coalescing, or workspace-wide batching unless live behavior proves it is needed.

## Non-Goals

- Do not create a third diagnostics cache.
- Do not alter the raw WBA diagnostics DTO shape.
- Do not move editor diagnostics back through Python normalization.
- Do not coalesce explorer/problems diagnostics as part of this idea.
- Do not treat transient zero-marker batches as invalid; they are valid inputs whose visual projection may be delayed.

## Why Not Implement Immediately

The WBA transport just changed substantially:

- editor intelligence is now direct over `/wba`
- code-server is now reached over UDS
- the WBA client/server path is typed and generated
- the old Python relay/fallback for editor intelligence was removed

That should be allowed to stabilize under live use before introducing new diagnostics policy. The safer near-term work is continued editor typing cleanup, especially converting remaining loose JS files to strict TS, while collecting evidence about where diagnostics still flicker.

## Current WBA Connection Observations

This is a code snapshot, not a final migration plan.

### Editor iframe

The editor iframe is the only frontend currently using direct WBA RPC for language intelligence. It connects to Socket.IO namespace `/wba` on path `/wba_ws/socket.io`, then maps editor workbench methods to WBA JSON-RPC methods.

Relevant files:

- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_wba_rpc_transport.ts`
- `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`

### Host page

The host page does not appear to call the WBA directly for language intelligence. It asks the backend for a boot snapshot over `/ui_ipc`, listens for `adapter_state` events over `/ui_ipc`, and mounts/coordinates the editor surface.

Relevant files:

- `app/apps/file_editor_cm6/src/host/connections/ui-ipc.ts`
- `app/apps/file_editor_cm6/src/host/boot/boot-snapshot.ts`
- `app/apps/file_editor_cm6/main.js`
- `app/apps/file_editor_cm6/boot_snapshot_backend.py`

The boot snapshot backend primes the code-server/WBA runtime, but after the UDS fix it should use `code_server_connection_target(...)` and pass `code_server_socket_path` into `ensure_workbench_adapter_shell(...)`.

### Explorer backend

Some Explorer backend control paths still use the old WBA stdio control pipe through `workbench_adapter_shell_manager.adapter_rpc(...)`.

Observed current uses:

- project switch calls `adapter.switchWorkspace`
- watcher mode/config changes call `adapter.resubscribeWatcher`

Relevant files:

- `app/apps/file_editor_cm6/explorer/services/project_switch.py`
- `app/apps/file_editor_cm6/explorer/handlers/watcher.py`

These are control-plane operations, not the hot editor language-intelligence path. They may still be acceptable as framework-shell-owned lifecycle/control operations, but they should be audited separately if the long-term goal is to remove all non-editor WBA stdio calls.

### Editor backend residue

`editor_ws.py` still has a model-ready resync hook that calls `adapter_rpc("te2.resync")`. That is not the main editor intelligence path, but it is still a WBA stdio control-plane call from the editor backend.

Relevant file:

- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`

## Follow-Up Questions

- Should Explorer project-switch and watcher-resubscribe remain WBA stdio control-plane calls, or should they move to a typed backend service/API boundary?
- Should the editor backend `te2.resync` hook remain, move to `/wba`, or be removed if direct WBA socket resync is sufficient?
- Should the host page remain WBA-blind, with adapter readiness observed only through backend-owned `adapter_state` events?
- Which remaining editor JS helper files are the best next TS conversion batch before revisiting diagnostics projection behavior?
