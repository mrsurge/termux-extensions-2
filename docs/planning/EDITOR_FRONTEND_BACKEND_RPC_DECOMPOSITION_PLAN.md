# Editor Frontend/Backend RPC Decomposition Plan

## Intent

This plan is for the editor-side equivalent of the Explorer RPC/TypeScript cleanup.

The goals are:

1. decompose `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js` into real, strictly typed TS modules
2. clean up and strictly type the editor backend instead of letting `editor_ws.py` remain an ad hoc backend blob
3. move editor signaling onto a well-defined JSON-RPC contract
4. reduce `any` / untyped payload flow across both frontend and backend transport edges
5. keep SSOT ownership exactly where it already belongs:
   - `_history_store`
   - project sidecar
   - backend fanout
   - frontend reflection

This is not a plan to “improve” behavior by adding more local frontend state or more transport shortcuts.

## The Core Invariant

For editor behavior, the invariant is:

1. frontend signal
2. frontend backend transport
3. Python hook
4. SSOT update first
5. backend fanout from SSOT
6. frontend reflection only

More explicitly:

- open/save/current-file/draft state is backend-owned
- `_history_store` / project sidecar is the SSOT
- the editor frontend is not an authority on current file identity
- `main.js` is not an authority on current file identity
- frontend surfaces reflect backend-owned state through typed notifications

If a migration step violates that invariant, it is wrong even if it “works”.

## Why This Plan Exists

The current editor stack has two different kinds of debt:

1. **Structure debt**
   - `m_editor_app.js` is still too large and too stateful
   - `editor_ws.py` has accumulated transport work, SSOT work, orchestration work, and editor-open business logic in one file
   - `main.js` still carries editor-adjacent integration logic that should become thinner over time

2. **Contract debt**
   - editor transport is still event-name RPC, not a coherent typed JSON-RPC contract
   - payload names drift across call sites
   - some frontend paths still pass raw objects across transport boundaries
   - backend handlers still accept and coerce raw dict payloads inline

The recent open-path regressions came from violating ownership boundaries while trying to fix line-number behavior.

This plan exists to stop that pattern.

## Non-Goals

- rewriting the entire editor in one pass
- removing every Socket.IO namespace immediately
- changing SSOT semantics to fit the transport migration
- moving core editor behavior into `main.js`
- treating the frontend as the owner of open/current-file behavior
- big-bang replacement of all editor signals at once

## Current State Snapshot

### Frontend

The editor runtime is centered on:

- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.js`

But the file already depends on many utility modules under `monaco_editor/`, including:

- open/model helpers
- mirror helpers
- diagnostics helpers
- breadcrumb helpers
- workbench helpers
- UI IPC helpers
- console bridge helpers
- theme/TextMate helpers

That means the editor is already partially decomposed, but the top-level runtime still owns too much orchestration.

### Backend

The main backend/editor files are:

- `app/apps/file_editor_cm6/monaco_editor/editor_ws.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_socketio.py`
- `app/apps/file_editor_cm6/monaco_editor/editor_backend.py`
- `app/apps/file_editor_cm6/monaco_editor/m_editor_app.py`

Current problem:

- `editor_ws.py` is still the effective editor backend control plane
- it owns transport, SSOT updates, save/open orchestration, workbench bridge handlers, and notification fanout in one file

### Host integration

Relevant host files:

- `app/apps/file_editor_cm6/main.js`
- `app/apps/file_editor_cm6/src/host/boot/editor-state.ts`
- `app/apps/file_editor_cm6/src/host/connections/ui-ipc.ts`
- `app/apps/file_editor_cm6/src/host/file-ops/open-flow.ts`

The host has already been decomposed significantly, but editor integration is still a major source of coupling.

## Architectural Rules For The Migration

1. **SSOT stays backend-owned**
   - current file
   - MRU line / scroll restore
   - draft state
   - save semantics

2. **Frontend renderers do not calculate backend semantics**
   - Explorer renderer should not decide same-file vs different-file behavior
   - editor renderer should not become the source of truth for current file identity
   - host should not invent current-file state that the backend did not emit

3. **Transport parsing happens once**
   - wire payload arrives as `unknown`
   - parsed into explicit typed params
   - downstream code receives typed params, not raw payload bags

4. **New code is TypeScript or strict Python**
   - frontend modules: `.ts`
   - backend contract/parser modules: strict Python where realistic
   - avoid adding new `any`
   - use `unknown` at wire boundaries, then parse

5. **Cut over behavior surface-by-surface**
   - open/current-file
   - mirror/draft
   - diagnostics/workbench
   - UI IPC/editor UI actions
   - save flow

## Target Frontend Shape

The editor runtime should stop being “one big file that imports helpers”.

Target shape:

```text
app/apps/file_editor_cm6/monaco_editor/
  app/
    bootstrap.ts
    editor-runtime.ts
    dependencies.ts
    public-api.ts
  state/
    editor-state.ts
    open-transaction-state.ts
    diagnostics-state.ts
    mirror-state.ts
    theme-state.ts
  rpc/
    contract.ts
    methods.ts
    notifications.ts
    requests.ts
    responses.ts
    parsers.ts
    client.ts
  socket/
    editor-rpc-client.ts
    notification-router.ts
    request-router.ts
  open/
    open-flow.ts
    same-file-resolution.ts
    jump-resolution.ts
    mru-restore.ts
    model-switch.ts
  workbench/
    client.ts
    requests.ts
    notifications.ts
    barrier.ts
    generation.ts
  diagnostics/
    apply-update.ts
    aggregation.ts
    navigation.ts
  mirror/
    apply.ts
    emit.ts
    filters.ts
  breadcrumbs/
    controller.ts
    symbols.ts
    icons.ts
  ui_ipc/
    client.ts
    save-relay.ts
    focus-relay.ts
  console/
    bridge.ts
    emit.ts
    eval.ts
  theme/
    loader.ts
    registry.ts
    textmate.ts
```

The existing `editor_*_utils.js` files are a useful extraction base, but they should be grouped under clearer TS ownership rather than multiplied indefinitely.

## Target Backend Shape

The editor backend should stop centering everything in `editor_ws.py`.

Target shape:

```text
app/apps/file_editor_cm6/monaco_editor/
  backend/
    __init__.py
    contracts/
      requests.py
      results.py
      notifications.py
      errors.py
      payloads.py
    dispatch/
      router.py
      registry.py
      context.py
    handlers/
      open.py
      save.py
      mirror.py
      diagnostics.py
      workbench.py
      prefs.py
      git_baselines.py
      ui_ipc.py
    services/
      ssot_open.py
      ssot_save.py
      active_file_fanout.py
      draft_fanout.py
      diagnostics_fanout.py
    socketio/
      namespace.py
      server.py
```

Where the current files land:

- `editor_ws.py`
  - should become a thin namespace adapter and compatibility layer
- `editor_socketio.py`
  - should stay transport/server setup only
- `m_editor_app.py`
  - should stay route/asset/entrypoint ownership, not transport orchestration
- `editor_backend.py`
  - should either be folded into `backend/services/` or reduced to a narrower backend helper module

## JSON-RPC Contract Direction

The editor needs the same kind of typed contract work that Explorer got.

Target namespace:

- `/rpc/editor`

Keep `/editor` mounted during migration as the compatibility lane.

Wire format:

- Socket.IO request event: `rpc`
- Socket.IO server notification event: `rpc.notify`
- JSON-RPC 2.0 envelopes on the wire

### Initial method families

These are the first method families that should be typed and migrated:

#### Open / current file

- `editor.open`
- `editor.jump`
- `editor.current.get`

#### Save / draft / mirror

- `editor.save`
- `editor.saveAs`
- `editor.mirror.push`
- `editor.draft.diff.get`
- `editor.cache.get`

#### Workbench

- `editor.workbench.openFile`
- `editor.workbench.hover`
- `editor.workbench.symbols`
- `editor.workbench.didChange`
- `editor.workbench.completions`
- `editor.workbench.semanticTokens`
- `editor.workbench.foldingRanges`

#### Diagnostics / navigation

- `editor.diagnostics.dump`
- `editor.diagnostics.navigate`
- `editor.find.run`

### Initial notification families

- `editor.activeFile.changed`
- `editor.cacheState.changed`
- `editor.draftState.changed`
- `editor.scrollState.changed`
- `editor.diagnostics.changed`
- `editor.gitBaselines.changed`
- `editor.open.completed`
- `editor.error`

## Critical Behavioral Rule: Open/Jump Ownership

The editor/backend must own all of this behavior:

- canonicalize payload path/URI
- compare against SSOT current file
- compare against active editor model URI
- decide same-file vs different-file
- decide payload line vs MRU restore
- fan out current-file state after SSOT update

Frontend renderers must not own these decisions.

That means:

- Explorer does not decide same-file open behavior
- `main.js` does not decide same-file open behavior
- `m_editor_app.js` applies the editor-side result, but the backend/contract defines what kind of open was requested

## Main.js Scope In This Plan

`main.js` still matters, but it is not the primary target.

Its role in this plan is:

1. keep shrinking into orchestration + assembly
2. consume typed host-side notifications
3. stop carrying editor-specific transport quirks
4. stop being the place where editor-open semantics are invented

So the plan is not “rewrite `main.js` first”.

The plan is:

- make `m_editor_app.js` and the editor backend typed and modular first
- then reduce `main.js` to typed bridges and host UI reflection

## Phased Execution Plan

### Phase 0 — Freeze ownership and inventory active routes

Deliverables:

- exact inventory of current editor signal families
- exact inventory of current `editor_ws.py` handlers
- exact inventory of current `m_editor_app.js` responsibilities
- explicit note of which routes are compatibility-only

Output:

- planning inventory section or appendix
- no behavior changes yet

### Phase 1 — Frontend decomposition of `m_editor_app.js`

Primary target.

Steps:

1. inventory top-level state buckets in `m_editor_app.js`
2. split the current orchestrator into:
   - state
   - open
   - socket
   - workbench
   - diagnostics
   - UI IPC
3. convert each new extraction to TS
4. keep `m_editor_app.js` as temporary assembly/bridge only

Exit condition:

- `m_editor_app.js` is mostly boot + module assembly
- behavior stays unchanged
- no new `any`

### Phase 2 — Backend decomposition of `editor_ws.py`

Steps:

1. extract contract parsing/helpers
2. extract handler families
3. extract SSOT/open/save services
4. leave `editor_ws.py` as transport adapter + compatibility shim

Exit condition:

- open/save/mirror/diagnostics/workbench handling are split by domain
- typed params/results replace most raw dict flow

### Phase 3 — Define the editor JSON-RPC contract

Steps:

1. add `src/editor/rpc/` TS contract/client files
2. add backend `contracts/` Python files
3. freeze method/notification vocabulary
4. add one parser/builder seam per side

Exit condition:

- one source-of-truth contract family exists on both sides
- no more ad hoc method naming for newly migrated flows

### Phase 4 — Migrate open/current-file behavior first

This is the first real behavior cutover because it is the most sensitive.

Steps:

1. move `editor.open` onto `/rpc/editor`
2. make current-file fanout typed and backend-owned
3. route host/explorer/sidebar current-file opens through the same backend contract
4. keep `/editor` compatibility shims until all callers are cut over

Exit condition:

- one open contract
- one SSOT-first open path
- one typed active-file notification family

### Phase 5 — Migrate save/mirror/draft

Steps:

1. move save request/response onto typed RPC
2. move mirror payloads to typed request/notification contracts
3. migrate draft/cache notifications

Exit condition:

- save and mirror no longer rely on free-form event payloads

### Phase 6 — Migrate workbench request/response slice

Steps:

1. move current `editor_workbench_*` event-name RPC into typed JSON-RPC method families
2. keep generation/barrier semantics intact
3. type request/result payloads end-to-end

Exit condition:

- workbench transport becomes one coherent typed method family

### Phase 7 — Remove compatibility lanes

Only after all migrated surfaces are live and verified.

Steps:

1. remove obsolete `/editor` compatibility request events
2. remove duplicated host/editor transport shims
3. delete dead JS utility wrappers

Exit condition:

- editor transport is typed, explicit, and coherent

## Type Discipline Rules

### Frontend

- all new editor runtime modules are `.ts`
- no new `any`
- `unknown` at wire boundaries only
- JSDoc-only compatibility is acceptable temporarily for bridge modules, but new core editor modules should be true TS

### Backend

- use `TypedDict`, `Literal`, `Protocol`, dataclasses
- one parser boundary
- typed handler params/results after parse
- avoid passing raw `dict[str, Any]` through business logic

## Recommended First Concrete Work Items

These are the first brisk-pace tasks:

1. write a route inventory for `m_editor_app.js`
2. split `m_editor_app.js` into:
   - `app/bootstrap.ts`
   - `state/editor-state.ts`
   - `open/open-flow.ts`
   - `socket/editor-rpc-client.ts`
3. split `editor_ws.py` into:
   - `backend/handlers/open.py`
   - `backend/handlers/save.py`
   - `backend/handlers/workbench.py`
4. add:
   - `src/editor/rpc/contract.ts`
   - `monaco_editor/backend/contracts/requests.py`
   - `monaco_editor/backend/contracts/notifications.py`
5. migrate only `editor.open` first

That sequence moves the process along quickly without requiring a dangerous full rewrite.

## Risks

- over-decomposing without freezing ownership first
- converting transport without preserving SSOT-first semantics
- moving too much into `main.js`
- keeping compatibility forever and never deleting dead lanes
- introducing “typed” wrappers that still just pass `any` around

## Definition of Done

- `m_editor_app.js` is no longer the primary implementation blob
- editor backend logic is no longer centered in `editor_ws.py`
- editor transport has a typed JSON-RPC contract
- open/current-file behavior is backend-owned and SSOT-first
- save/mirror/workbench slices are typed and explicit
- `main.js` is thinner and does not invent editor semantics
- new editor code avoids `any`
- compatibility shims are removed after cutover, not left to rot
