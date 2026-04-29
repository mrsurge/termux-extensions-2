# File Editor CM6 Editor Diagnostics Sideband And WBA WS Plan

## Scope

This note defines the next diagnostics architecture step for `file_editor_cm6`.

The requirement is editor-specific:

- The editor diagnostics lane should mirror VS Code logic as closely as practical.
- The editor diagnostics lane should preserve the raw VS Code-shaped diagnostics DTO through Python.
- Explorer and problems UI do not need to match VS Code DTO shape.
- Explorer and problems can remain on a normalized TE2-owned diagnostics contract.

This note also outlines the follow-on WBA websocket namespace work after the editor diagnostics lane is validated.

## Non-Goals

- Do not force Explorer or problems-panel diagnostics onto raw VS Code DTOs.
- Do not require a full explorer/panel transport rewrite as part of the editor diagnostics change.
- Do not move all workspace intelligence lanes to a new WBA websocket in the first step.

## User Constraint

The editor is the only diagnostics consumer that must be:

1. vendored
2. mirrored to VS Code logic
3. preserved through Python without normalization

Explorer and problems are allowed to remain TE2-shaped.

## Current State

### WBA side

The WBA currently emits the raw diagnostics event from ext-host dispatch and also synthesizes a normalized event:

- Raw event source:
  - `workbench_protocol_proxy/node_workbench_adapter/src/protocol/ext-host-dispatch.ts`
  - emits `diagnostics/changeMany` directly from ext-host `$changeMany`
- Normalized fanout:
  - `workbench_protocol_proxy/node_workbench_adapter/src/server/event-bridge.ts`
  - converts `diagnostics/changeMany` into `diagnostics/update`

This means the raw editor lane and normalized explorer/problems lane currently share one upstream event stream and one server event bridge.

### Python side

`diagnostics_bridge.py` already treats the editor and explorer differently, but not with a hard sideband boundary:

- Editor path:
  - `_raw_diagnostics_for_editor(...)`
  - `_emit_or_buffer_editor_diagnostics(...)`
  - emits `editor:diagnostics` with raw `diagnostics/changeMany`-shaped payloads
- Explorer/problems path:
  - `_process_diagnostics_update(...)`
  - `_emit_diagnostics_to_explorer_and_ui(...)`
  - emits normalized/project-scoped diagnostics through `workspace_events.publish_diagnostics_detail(...)`

The editor path is already closer to the desired state, but it still lives inside one mixed bridge that also owns explorer/problems fanout.

### Editor side

The editor already has a local vendored diagnostics apply shim:

- `monaco_editor/vscode_document_intelligence_vendor/mainThreadDiagnostics.ts`
- consumed by `monaco_editor/editor_workbench_runtime.ts`

That shim preserves the `owner/resource/markers` shape from `$changeMany` and applies it to the active model with `setModelMarkers(...)`.

This is the right direction. The missing piece is transport ownership and a stronger vendored diagnostics intelligence boundary, not marker application itself.

### Explorer / problems side

Explorer and problems are explicitly TE2-owned:

- `workspace_events.publish_diagnostics_detail(...)`
- `explorer.diagnostics.detail`

That normalized path should remain separate from the editor diagnostics sideband.

## Problem Statement

The current design still has a mixed ownership model:

1. ext-host diagnostics enter once
2. WBA emits raw and normalized forms from the same intake
3. Python bridge owns both editor and explorer/problems diagnostics in one module
4. editor is more VS Code-shaped at the end, but not isolated through the whole path

This prevents a clean statement that the editor diagnostics lane is the vendored, mirrored VS Code diagnostics path.

## Required End State

### Editor lane

The editor diagnostics lane must satisfy all of these:

1. raw VS Code-shaped diagnostics DTO survives from WBA through Python to the editor runtime
2. Python does not normalize or reshape editor diagnostics payloads
3. editor diagnostics logic is vendored and mirrored around the VS Code diagnostics intelligence seam
4. editor diagnostics transport is isolated from explorer/problems fanout
5. editor-only gating/replay rules are allowed, but DTO mutation is not

### Explorer / problems lane

The explorer/problems lane should satisfy these:

1. remain normalized and TE2-owned
2. receive project-scoped detail payloads suitable for tree badges and problems UI
3. remain independent from the editor diagnostics sideband

## Phase 1: Editor Diagnostics Sideband

### Goal

Create an explicit editor diagnostics sideband that carries the raw VS Code diagnostics DTO through Python and into vendored editor diagnostics intelligence, while leaving explorer/problems on the normalized TE2 lane.

### Step 1: Split transport ownership in Python

Refactor the current mixed `diagnostics_bridge.py` responsibilities into two explicit paths:

- editor diagnostics sideband
- explorer/problems normalized diagnostics path

Possible structure:

- `diagnostics_bridge.py`
  - becomes orchestration shell only
- `monaco_editor/editor_backend_services/diagnostics_sideband.py`
  - editor-only raw diagnostics relay, gating, replay
- `workspace_events.py` plus existing explorer services
  - continue owning normalized explorer/problems publication

The editor sideband should own:

- consumer pending/ready baton
- active-file raw payload buffering
- editor replay on connect/open
- editor-only diagnostics emission

The explorer/problems path should own:

- normalized cache
- project-scoped detail publication
- debounce/aggregation rules for non-editor consumers

### Step 2: Remove editor dependence on normalized diagnostics

The editor must not consume `diagnostics/update`.

The editor should only consume the raw sideband payload:

- owner
- original resource
- original marker arrays
- cache ids / metadata when present

The normalized `diagnostics/update` lane remains a non-editor concern.

### Step 3: Vendor the diagnostics intelligence source more explicitly

The current `mainThreadDiagnostics.ts` shim is the right seed, but the editor diagnostics path should be framed as a proper vendored diagnostics intelligence lane just like completions.

Target directory:

- `monaco_editor/vscode_document_intelligence_vendor/`

Target files:

- keep `mainThreadDiagnostics.ts` as the anchor
- add any narrow support shim(s) needed for DTO revival, owner/resource handling, and editor-only release/apply behavior

The editor diagnostics runtime should read as:

- vendored diagnostics intelligence source
- TE2 transport wrapper
- Monaco application boundary

not:

- custom TE2 diagnostics logic that happens to resemble VS Code at the end

### Step 4: Preserve DTO through Python

Python should treat the editor diagnostics sideband as a transport problem, not an interpretation problem.

Allowed:

- gating by active file / expected request
- buffering until consumer ready
- replay rules
- transport envelope metadata

Not allowed:

- collapsing raw DTO into normalized marker records
- editor-only loss of owner/resource structure
- TE2-specific mutation of the marker payload before vendored editor logic sees it

### Current implementation note

The initial sideband split is not enough by itself if Python still splits one raw `$changeMany` batch into per-path payloads or if the frontend still filters diagnostics to the active model on arrival.

The editor-mirrored end state for this phase is:

- Python forwards the raw `diagnostics/changeMany` batch envelope unchanged on the editor sideband
- vendored editor diagnostics logic stores diagnostics by `owner` and `resource`, mirroring the VS Code main-thread seam
- the active Monaco model is then projected from that vendored owner/resource store instead of being treated as the authoritative diagnostics store

This keeps the editor lane VS Code-shaped without forcing explorer/problems onto the same contract.

### Step 5: Keep explorer/problems normalized

The normalized project-scoped diagnostics path remains separate and unchanged in principle:

- `workspace_events.publish_diagnostics_detail(...)`
- explorer notification payloads
- problems panel data model

This is not a failure to mirror VS Code. It is an intentional separate consumer contract.

### Step 6: Validation

Validation for Phase 1 should prove:

1. BasedPyright editor markers still match code-server behavior on the active file
2. raw `diagnostics/changeMany` owner/resource/marker shape survives through Python
3. editor no longer depends on the normalized explorer/problems path
4. explorer tree decorations and problems panel remain correct
5. editor reconnect/open baton still prevents stale-marker races

Suggested checks:

- active Python file with BasedPyright
- TS/JS file with built-in diagnostics
- file switch while diagnostics are in flight
- editor reconnect / page reload path
- explorer/problems still receiving normalized detail

## Phase 2: WBA Websocket Namespace

### Goal

After Phase 1 is validated, move preserved workspace intelligence DTO lanes off the Python relay and onto a dedicated WBA websocket namespace.

### Target

Add a new WBA-facing websocket / RPC namespace for preserved DTO streams, referred to here as the `wba` namespace.

The editor should then connect directly to that namespace for the preserved intelligence lanes.

### Sequence

1. Vendor the npm `socket.io` client/module needed by the WBA runtime.
2. Add a dedicated `wba` namespace and connection lifecycle.
3. Move the editor diagnostics sideband onto that namespace first.
4. After diagnostics proves stable, migrate the other preserved DTO families.

Candidate preserved DTO families:

- diagnostics
- completions
- inline completions
- inlay hints
- semantic tokens
- later any other lane where vendored VS Code-shaped editor intelligence is the goal

### Why phase this

Diagnostics is the cleanest proving ground because:

- the editor already has vendored diagnostics application logic
- the explorer/problems consumer is already allowed to remain separate
- the raw DTO shape is already visible in the current system

If diagnostics cannot survive the new WBA websocket path cleanly, the larger migration should stop there and be corrected before more lanes move.

## File Map For Phase 1

Current files that should drive the editor diagnostics sideband refactor:

- `app/apps/file_editor_cm6/diagnostics_bridge.py`
- `app/apps/file_editor_cm6/workspace_events.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_workbench_runtime.ts`
- `app/apps/file_editor_cm6/monaco_editor/vscode_document_intelligence_vendor/mainThreadDiagnostics.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/protocol/ext-host-dispatch.ts`
- `app/apps/file_editor_cm6/workbench_protocol_proxy/node_workbench_adapter/src/server/event-bridge.ts`

Likely new files:

- `app/apps/file_editor_cm6/monaco_editor/editor_backend_services/diagnostics_sideband.py`
- possibly one or more additional vendored diagnostics helper files under
  `app/apps/file_editor_cm6/monaco_editor/vscode_document_intelligence_vendor/`

## Risks

### Mixed ownership regression

If the editor sideband is only renamed and not truly isolated, the same ambiguity will remain:

- raw DTOs may still be indirectly coupled to normalized explorer/problems fanout

### Over-vendoring the wrong layer

The vendored boundary should be diagnostics intelligence, not unrelated editor bootstrap/runtime plumbing.

Keep the vendor logic near:

- DTO revival
- owner/resource/marker semantics
- Monaco diagnostics application

Do not expand vendoring into unrelated editor orchestration.

### Replay/gating drift

The editor consumer baton currently prevents early marker application races.

Any sideband split must preserve:

- pending/ready behavior
- replay on connect/open
- active-file-only application rules

### WBA websocket premature cutover

Do not move all preserved DTO lanes at once.

Diagnostics should be the proving lane for the `wba` namespace before broader migration.

## Approval Boundary For Implementation

Phase 1 implementation should begin only after this plan is approved.

The implementation should stay scoped to:

1. editor diagnostics sideband isolation
2. vendored editor diagnostics intelligence cleanup
3. validation of the editor lane

The `wba` websocket namespace belongs to the follow-up phase after that validation.
