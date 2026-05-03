# File Editor CM6 Refactor North Star

## Status

Active planning reference.

Use this document as the current source of truth for the remaining `file_editor_cm6` refactor track. It supersedes the older narrower transport-only framing when choosing sequence or target architecture.

Detailed main-page/template progress is tracked in `FILE_EDITOR_CM6_MAIN_PAGE_DECOMPOSITION_PLAN.md`. Keep this North Star document focused on target architecture, sequencing, and cross-plan constraints instead of duplicating per-slice status.

## Purpose

The remaining work is not "just" transport cleanup and it is not "just" a TypeScript pass.

The actual end state is:
- strict, intentional contracts across the app-owned socket surfaces
- one physical app-scoped Socket.IO gateway/server path with the existing logical namespaces preserved where they are still meaningful
- worker, host, editor, explorer, and WBA ownership boundaries that stay explicit instead of getting muddied by transport consolidation
- each page component talking only to its own lane, with backend mediation between domains instead of new direct cross-domain frontend lanes
- `main.js` and `template.html` reduced from monolith/orchestration blobs into thinner assembly surfaces

This plan exists so the remaining work is driven by one architecture target instead of by isolated cleanup batches.

## What Is Already True

Current facts in the live tree:
- The editor language-intelligence hot path is direct `/wba` Socket.IO JSON-RPC from the inline editor runtime to the workbench adapter.
- The active TextMate lane now uses the workbench-derived vendored runtime, not the old UMD bootstrap path.
- The worker still owns SSOT, file open/save/mirror/cache state, host relay behavior, and backend project state.
- Explorer already has a typed JSON-RPC namespace at `/rpc/explorer` on the worker-owned explorer socket server.
- Editor has partial typed `/rpc/editor` scaffolding, but the broader editor surface is still split between typed RPC and legacy `/editor` event-name transport.
- Host-side non-editor initiation is already backend-owned through `/ui_ipc` hook surfaces and should continue moving in that direction rather than binding host directly onto editor RPC lanes.
- `src/explorer` and the Monaco editor lane are already on the strict app TypeScript lane.
- The WBA typed TypeScript lane is already strict and substantially decomposed.
- Main-page decomposition has started under `main_page/frontend/`: host chrome, host state, host editor-event handling, and drawer shell behavior now live in grouped strict TypeScript runtimes.
- The old in-app agent harness is no longer a live contract. The sidebar surface is the shortcut lane plus `/sidebar_ipc`; historical `agent*` DOM ids and preference keys are compatibility names for that UI.
- The host lane is not done: `main.js` remains the bundle entrypoint/orchestration shell, `src/host/` is still excluded from the app strict-TS lane, and `template.html` still carries too much host/UI contract.
- The app still exposes multiple transport/service surfaces and multiple worker-owned Socket.IO servers, plus the separate adapter-owned `/wba` path.
- `services/vscode_rpc_transport.py` is still registered even though it is not the current editor intelligence hot path.

## Core Constraints

These constraints do not change during the refactor:
- TE2 remains SSOT owner for draft/save/open/versioning behavior.
- The WBA remains the VS Code protocol boundary and intelligence producer.
- Transport consolidation must stay proxy-only. Do not move backend state ownership just to achieve one socket server.
- Host UI is an initiator and renderer, not the owner of project or document intelligence state.
- Host `main.js` should talk to its host/backend lane (`/ui_ipc`, moving to RPC), not directly to editor domain RPC as a new long-term coupling.
- Explorer is project-scoped consumption/rendering, not a second backend.
- Editor is file-scoped rendering/interaction, not project-state authority.
- HTML preview is queued behind this refactor track, not mixed into it.

Cross references:
- `docs/apps/code_cm6/CODE_TE2.md`
- `docs/planning/FILE_EDITOR_CM6_OWNERSHIP_BOUNDARY_CONTRACT.md`
- `docs/planning/FILE_EDITOR_CM6_HTML_PREVIEW_ENGINE_PLAN.md`
- `docs/planning/FILE_EDITOR_CM6_SOCKETIO_CONSOLIDATION_PLAN.md`

## The Real Problem

The remaining complexity is a combination of four issues, not one:
- transport sprawl: too many physical socket servers/proxy surfaces
- contract drift: legacy event-name RPC and free-form payloads still exist beside typed JSON-RPC lanes
- typing asymmetry: editor/explorer/WBA are ahead of host/template and some backend edges
- monolith residue: `main.js` and `template.html` still carry too much orchestration and UI contract density

If we solve only one of those, the others keep the system hard to reason about.

## Target Architecture

### 1. One App-Scoped Socket.IO Gateway

Target one physical app-scoped Socket.IO gateway/server path for `file_editor_cm6`.

That gateway should:
- preserve the logical namespaces that clients use by concern
- route by namespace to the correct execution owner
- stay transport-only in the main-process layer
- stop the current proliferation of separate socket-server/proxy definitions as the primary public shape

Recommended namespace set:
- `/rpc/editor`
- `/rpc/explorer`
- `/ui_ipc`
- `/sidebar_ipc`
- `/terminal`
- `/wba`

Notes:
- `/editor` should not remain a long-term public ad hoc event bus. Its behavior should converge into typed `/rpc/editor` methods and notifications for the editor-runtime/backend contract.
- `main.js` should not become a first-class caller of `/rpc/editor` as a substitute for backend mediation. Host-facing actions should stay on the host/backend lane and let Python fan out to editor/backend services.
- `/wba` is still logically separate in execution ownership even if the physical gateway is consolidated. Do not collapse WBA behavior into the worker just to satisfy the one-server goal.

### 2. JSON-RPC 2.0 Everywhere It Matters

All request/notify surfaces that are part of the app-owned contract should converge on explicit JSON-RPC 2.0 envelopes.

That means:
- one parse/validation step at the transport edge
- typed method families by namespace
- structured error envelopes instead of ad hoc ack failure shapes
- explicit server notifications instead of implicit event-name conventions

The rule is not "rename everything to rpc". The rule is "make the contract intentional and typed".

### 3. Ownership Does Not Move

Physical transport consolidation must not blur execution ownership.

Target ownership split:
- worker/backend owns SSOT, host hooks, project state, editor open/save/mirror flows, and backend projections
- WBA owns extension-host protocol, provider/intelligence production, grammar loading, and editor-facing language notifications
- host owns initiation/rendering of host chrome only, and talks through its backend-mediated host lane
- editor owns file-scoped rendering and interaction only
- explorer owns project-scoped rendering only

### 4. Host Lane Must Catch Up

The refactor is not complete until the host lane catches up to editor/explorer/WBA discipline.

That means:
- `main.js` becomes a smaller assembly/orchestration shell
- host transport and UI modules move toward strict TS with explicit boundary types
- `template.html` stops being the dumping ground for durable UI contract and wiring policy

## Non-Goals

This refactor does not mean:
- rewriting the entire app in one batch
- moving TE2 runtime-owned services into the app worker
- making WBA the owner of frontend policy or host state
- changing SSOT semantics just to fit transport cleanup
- bundling HTML preview implementation into the same execution batch
- touching Android as part of this planning track

## Recommended Sequence

### Phase 0. Documentation And Contract Freeze

- Keep `CODE_TE2.md` current as the live wiring reference.
- Keep this North Star doc as the target-state reference.
- Mark narrower stale plans as superseded instead of letting them compete silently.
- Stop introducing new ad hoc event shapes while this plan is active.

### Phase 1. Freeze The Public Namespace Vocabulary

- Decide the long-term logical namespace set.
- Treat that namespace set as a contract, not an implementation detail.
- Avoid renaming namespaces casually once the consolidated gateway work begins.

Expected direction:
- keep `/rpc/explorer`
- promote `/rpc/editor` as the canonical editor-runtime/backend contract surface
- keep `/ui_ipc` as the canonical host/backend contract surface while making it JSON-RPC compliant
- keep `/sidebar_ipc`, `/terminal`, and `/wba` as concern-specific namespaces unless a concrete simplification proves better

### Phase 2. Finish Contract Normalization By Surface

#### Explorer

- Keep `/rpc/explorer` as canonical.
- Remove stale legacy explorer naming/docs/assumptions.
- Ensure request/notify/result/error shapes are the only supported public contract.

#### Editor

- Move the remaining `/editor` behaviors onto typed `/rpc/editor` methods and notifications.
- Bring open/save/mirror/cache-state/prefs/current-file/state publication under one coherent editor RPC contract.
- Keep the worker as the owner of those behaviors.
- Treat `/rpc/editor` as the editor-runtime/backend lane, not as a replacement host lane.

#### UI IPC / Sidebar / Terminal

- Convert host request/reply behavior to explicit typed envelopes where it is still implicit.
- Keep host initiation backend-mediated: host talks to `/ui_ipc`, backend talks to editor/backend services, and resulting state projections fan back out from backend-owned surfaces.
- Normalize server notifications and error handling.
- Avoid using these namespaces as backend-to-backend shortcuts.

#### WBA

- Keep `/wba` as direct editor-facing JSON-RPC.
- Treat the WBA stdio control plane as internal backend control, not the public editor contract.
- Continue reducing residual Python relay/control hooks where they are only historical leftovers.

### Phase 3. Consolidate The Physical Socket Server/Gateway

After the namespace contracts are stable:
- replace the multiple app-specific physical socket-server/proxy surfaces with one app-scoped Socket.IO gateway/server path
- preserve the logical namespaces above that path
- route by namespace to worker-owned handlers or WBA-owned handlers as appropriate

Success criteria:
- one public app-scoped Socket.IO gateway path
- same logical namespace vocabulary
- no SSOT logic moved into the transport gateway
- no WBA logic moved into the worker merely for topology aesthetics

### Phase 4. Finish Host And Template Decomposition

Once the transport/contracts are stable:
- shrink `main.js` further toward assembly-only behavior
- bring `src/host/` into the strict TS plan deliberately instead of leaving it as a permanent exclusion
- split durable UI contract out of `template.html` where practical
- keep `template.html` focused on structure, not app behavior policy
- record detailed completed-slice status in `FILE_EDITOR_CM6_MAIN_PAGE_DECOMPOSITION_PLAN.md`

### Phase 5. Remove Residue

- remove stale transport wrappers and compatibility shims once callers are gone
- remove dead docs that were only valid during migration
- remove legacy event-name RPC assumptions from comments, docs, and helper naming
- revisit whether `vscode_rpc_transport` still belongs in the manifest once the surrounding residue is gone

### Phase 6. Resume Queued Feature Work

Only after the refactor track is coherent again:
- resume the HTML live preview plan
- keep preview implementation on the backend-hook/project-sidecar/framework-shell path already planned

## Practical Rule Of Thumb For New Work

When touching a feature during this refactor:
- if it adds or changes a socket contract, make it typed and JSON-RPC-shaped
- if it adds host behavior, do not dump more durable policy into `main.js` or `template.html` if a focused module can own it
- if it starts in host chrome, prefer the host/backend lane and backend fanout over new direct host-to-editor RPC coupling
- if it needs transport consolidation, do it without moving domain ownership
- if it belongs to preview, defer it unless it directly unblocks this refactor track

## Completion Criteria

This refactor track is "done enough" when all of the following are true:
- the app has one physical app-scoped Socket.IO gateway/server path
- logical namespaces are stable and intentional
- public socket contracts are JSON-RPC and typed end-to-end
- `/editor` no longer survives as a legacy ad hoc public event bus
- `main.js` is mostly assembly/orchestration rather than feature ownership
- `template.html` is no longer carrying avoidable app-behavior contract density
- stale docs and transport residue are removed or explicitly historical

## Why This Order

This order keeps the difficult parts aligned:
- contracts stabilize before transport surgery
- transport surgery happens before final host/template cleanup
- ownership boundaries stay fixed during both
- feature work such as HTML preview does not land on top of half-finished architecture drift
