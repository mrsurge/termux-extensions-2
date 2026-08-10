# File Editor CM6 Refactor North Star

## Status

Active planning reference.

Use this document as the current source of truth for the remaining `file_editor_cm6` refactor track. It supersedes the older narrower transport-only framing when choosing sequence or target architecture.

Detailed main-page/template progress is tracked in `FILE_EDITOR_CM6_MAIN_PAGE_DECOMPOSITION_PLAN.md`. Keep this North Star document focused on target architecture, sequencing, and cross-plan constraints instead of duplicating per-slice status.

Detailed transport-collapse execution is tracked in `FILE_EDITOR_CM6_TRANSPORT_COLLAPSE_PLAN.md`. The collapse is split into an app-local Python Socket.IO layer phase and a framework-level manifest-declared raw route proxy phase.

## Purpose

The remaining work is not "just" transport cleanup and it is not "just" a TypeScript pass.

The actual end state is:
- strict, intentional contracts across the app-owned socket surfaces
- one physical app-scoped Socket.IO gateway/server path with the existing logical namespaces preserved where they are still meaningful
- worker, host, editor, explorer, and WBA ownership boundaries that stay explicit instead of getting muddied by transport consolidation
- each page component talking only to its own lane, with backend mediation between domains instead of new direct cross-domain frontend lanes
- `main.py` and `template.html` reduced from monolith/orchestration blobs into thinner assembly surfaces

This plan exists so the remaining work is driven by one architecture target instead of by isolated cleanup batches.

## Immediate Ordered Queue

The next work should proceed in this order:

1. Completed: deprecate `/editor` as a public ad hoc event bus and complete the editor runtime/backend conversion to `/rpc/editor`.
   - The editor Socket.IO server now registers `/rpc/editor` only; the legacy `/editor` namespace class/registration is gone.
   - Editor open, jump, issues, draft-diff, git-baseline, cache/draft/scroll state, notify, ready, save snapshot, diagnostics-count, model-ready, breadcrumb navigation, mirror, and save traffic now flow through typed `/rpc/editor` methods/notifications or backend-owned host hooks that fan out over `/rpc/editor`.
   - Backend ownership stays unchanged: `/rpc/editor` is the editor-runtime/backend lane, not a host shortcut around `/ui_ipc`.
   - The worker mount path `/editor_ws/socket.io` remains as the physical Socket.IO endpoint for the `/rpc/editor` namespace until the later gateway consolidation.
2. Completed: move Android-native editor/UI integration from legacy `ui_event` compatibility onto the UI IPC JSON-RPC notification lane.
   - Android `UiIpcClient` consumes `rpc.notify` envelopes on `/ui_ipc` for editor focus/blur and no longer listens for the legacy `ui_event` bridge.
   - The worker no longer tracks `_LEGACY_UI_EVENT_SIDS` or emits Android compatibility `ui_event` fanout from UI IPC RPC notifications.
   - Android console drawer registration/hydration stays on the TE2 console drawer registration path, and console eval defaults to the current `main_page` runtime target instead of the historical editor iframe id.
3. Completed: create a dedicated sidebar IPC/RPC contract surface for external sidebar actions and clean up sidebar boundaries.
   - Frontend and backend contract modules now define `/sidebar_ipc` instead of treating it as a collection of event-name conventions.
   - Definition/schema docs now cover external sidebar actions such as mentions, file opens, active shortcut state, refresh requests, and cwd sync.
   - Source ownership remains explicit: Explorer-originated actions use Explorer RPC or backend relays, editor-originated actions use editor RPC/backend relays, and external/sidebar-frame actions use the sidebar contract.
4. Completed: phase one transport collapse collapsed the worker-owned Python Socket.IO layer inside `file_editor_cm6` and added `msgspec`-validated JSON-RPC envelope handling.
   - `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, and `/terminal` remain logical namespaces.
   - The existing namespace handler classes now register under one worker-side Python `socketio.AsyncServer` in `socketio_gateway.py`.
   - Existing physical paths remain mounted to the shared worker ASGI app for compatibility.
   - SSOT, terminal, host, Explorer, and editor behavior did not move into the gateway. The gateway is transport assembly and envelope validation, not domain ownership.
   - `/wba` remains adapter-owned and separate in this phase.
5. Completed: phase two transport collapse added a framework-owned manifest-declared raw Socket.IO route proxy using an app-local `sio_service.json`.
   - The app manifest points to the route definition instead of requiring one-off Python transport scripts under `services/`.
   - The framework proxy owns physical Engine.IO route registration, raw websocket forwarding, and target discovery.
   - Logical namespaces remain owned by the upstream Socket.IO servers and are not enumerated in the manifest route config.
   - WBA and app-worker domain behavior did not move into the framework proxy.
6. Make project/open-file state sidecar-event-driven before continuing reload-removal or project-switch cleanup.
   - The last opened project is the open project.
   - The project sidecar `last_file` is the open file.
   - History store owns open-project identity only; opened-file identity belongs in the project sidecar only.
   - Frontend `currentPath`, host/editor session state, Explorer active markers, and WBA active document state are projections of the sidecar-backed event, not authorities.
   - Any backend path that writes sidecar opened-file state must publish the same open-state event to all connected clients, and reconnect must replay that same event from sidecar disk state.
   - This is a hard authority cutover, not a compatibility shim. Change or remove any path that lets history/session/frontend state repair, override, or preserve open-file identity outside the sidecar event model.
   - File-backed project state is intentional architecture for portability and future runtime ports. The sidecar data shape plus the sidecar-derived event stream should be the state-machine contract.
   - Preserve the current validation contract: file opens require an active project sidecar and must reject files outside the open project.
   - Add the explicit combined transaction for "open project with file target": set the open project and the target project's sidecar `last_file` together, then publish the same sidecar open-state event.
   - Track concrete execution in `FILE_EDITOR_CM6_SIDECAR_OPEN_STATE_PLAN.md`.
7. Prune Kotlin LSP no-op surfaces instead of validating them.
   - Treat JetBrains `kotlin-lsp` support as dead/no-op.
   - Do not spend validation time proving Kotlin LSP behavior; classify remaining Kotlin LSP settings, docs, launch code, and vendor instructions for removal.
   - Keep unrelated Kotlin language identification, syntax highlighting, Android/Kotlin source parsing, and historical notes only when they are not claiming live Kotlin LSP support.
8. Fix extension settings rendering so VSIX/object-valued settings do not display as `[object Object]`.
   - Treat this as a typed normalization/rendering bug in the extension settings surface, likely in `main.py` or a supporting settings/extension module.
9. Decompose and strictly type `main.py`, and find/deprecate unused top-level modules.
   - Start with small backend route/helper families and avoid moving framework-owned service shims out of `services/`.
   - Track deleted top-level modules explicitly so stale imports and app-loader contracts do not silently survive.
10. Continue `template.html` decomposition after the backend transport/contract cleanup is coherent.
   - Move avoidable durable UI contract and behavior policy out of markup/CSS while preserving shortcut DOM compatibility.
   - Do not treat this as feature work; this is breakup and ownership cleanup.
11. Debug why WBA does not work with the same `rust-analyzer` VSIX that works with the same code-server instance powering the WBA.
   - Treat this as a WBA extension-host/provider bootstrap issue until proven otherwise.
   - Compare extension discovery, activation, workspace trust/configuration, binary/server executable resolution, and language/provider registration between the visible code-server path and WBA.

### Current `/editor` Deprecation Status

The legacy editor namespace has been removed from the active Socket.IO server:

- `/rpc/editor` is the only editor namespace registered by `monaco_editor/editor_socketio.py`.
- `m_editor_app.ts` connects only to `/rpc/editor` for editor/backend traffic and `/wba` for workbench-adapter intelligence traffic.
- The old request families use typed methods: `editor.jumpToLine`, `editor.gitBaselines.get`, and `editor.draftDiff.get`.
- The remaining former `/editor` event families now use typed methods/notifications such as `editor.cacheState.publish`, `editor.draftState.publish`, `editor.notify.publish`, `editor.openComplete.publish`, `editor.diagnosticsCounts.publish`, `editor.scrollState.publish`, `editor.modelReady`, `editor.save.snapshot.response`, `editor.issues.dump.response`, `editor.breadcrumb.navigate`, and `editor.save.snapshot.request`.
- `editor_runtime_emit_room_event(...)` is now a logical backend fanout helper that emits `/rpc/editor` notifications and UI IPC mirrors; it no longer emits to a legacy `/editor` namespace.
- The physical `/editor_ws/socket.io` mount remains for `/rpc/editor` until the later app-scoped Socket.IO gateway consolidation.

## What Is Already True

Current facts in the live tree:
- The editor language-intelligence hot path is direct `/wba` Socket.IO JSON-RPC from the inline editor runtime to the workbench adapter.
- The active TextMate lane now uses the workbench-derived vendored runtime, not the old UMD bootstrap path.
- The worker still owns SSOT, file open/save/mirror/cache state, host relay behavior, and backend project state.
- Explorer already has a typed JSON-RPC namespace at `/rpc/explorer` on the worker-owned explorer socket server.
- Editor runtime/backend traffic now uses `/rpc/editor`; legacy event-name strings may still exist as internal logical fanout names, but they no longer imply a public `/editor` namespace.
- Host-side non-editor initiation is already backend-owned through `/ui_ipc` hook surfaces and should continue moving in that direction rather than binding host directly onto editor RPC lanes.
- `src/explorer` and the Monaco editor lane are already on the strict app TypeScript lane.
- The WBA typed TypeScript lane is already strict and substantially decomposed.
- Main-page decomposition has started under `main_page/frontend/`: host chrome, host state, host editor-event handling, and drawer shell behavior now live in grouped strict TypeScript runtimes.
- The old in-app agent harness is no longer a live contract. The sidebar surface is the shortcut lane plus `/sidebar_ipc`; historical `agent*` DOM ids and preference keys are compatibility names for that UI.
- The host frontend entry is broken up enough for now: `main.ts` is the strict bundle source entry and should not be treated as the next decomposition target unless a concrete ownership bug requires it.
- The remaining monolith breakup targets are `main.py` and `template.html`.
- The app still exposes legacy physical Socket.IO paths for compatibility, but those paths are now explicit aliases in `sio_service.json` behind one framework-owned raw route proxy. The worker-owned Python Socket.IO layer uses one shared app-local server for `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, and `/terminal`; `/wba` remains a separate adapter-owned upstream with its own Engine.IO route semantics.
- The dead `vscode_rpc` side-channel has been removed; editor intelligence is WBA-owned.

## Core Constraints

These constraints do not change during the refactor:
- TE2 remains SSOT owner for draft/save/open/versioning behavior.
- Open-project identity belongs to backend project/history state; opened-file identity belongs to the active project's `ProjectSidecar.last_file`.
- Treat sidecar opened-file writes as event-source writes: every successful write publishes one open-state event to every connected client, and reconnect replays the same event from disk.
- Do not let `currentPath`, host/editor session state, Explorer active markers, WBA active document state, or history MRU data become competing opened-file authorities.
- No file open command may bypass the active-project sidecar or open a file outside the open project.
- The WBA remains the VS Code protocol boundary and intelligence producer.
- Transport consolidation must stay proxy-only. Do not move backend state ownership just to achieve one socket server.
- Host UI is an initiator and renderer, not the owner of project or document intelligence state.
- Host frontend code should talk to its host/backend lane (`/ui_ipc` RPC), not directly to editor domain RPC as a new long-term coupling.
- Explorer is project-scoped consumption/rendering, not a second backend.
- Editor is file-scoped rendering/interaction, not project-state authority.
- HTML preview is queued behind this refactor track, not mixed into it.

Cross references:
- `docs/apps/code_te2/CODE_TE2.md`
- `docs/apps/code_te2/SIDEBAR_IPC_RPC_CONTRACT.md`
- `docs/planning/FILE_EDITOR_CM6_OWNERSHIP_BOUNDARY_CONTRACT.md`
- `docs/planning/FILE_EDITOR_CM6_HTML_PREVIEW_ENGINE_PLAN.md`
- `docs/planning/FILE_EDITOR_CM6_SOCKETIO_CONSOLIDATION_PLAN.md`

## The Real Problem

The remaining complexity is a combination of four issues, not one:
- transport sprawl: too many physical socket servers/proxy surfaces
- contract drift: some internal logical event-name helpers and free-form payloads still exist beside typed JSON-RPC lanes
- typing asymmetry: editor/explorer/WBA and the host frontend are ahead of some backend edges
- monolith residue: `main.py` and `template.html` still carry too much orchestration and UI contract density

If we solve only one of those, the others keep the system hard to reason about.

## Target Architecture

### 1. Two-Phase Socket.IO Collapse

Target a two-phase collapse instead of one giant transport rewrite.

Phase one is app-local and now implemented:
- collapse the worker-owned Python Socket.IO layer inside `file_editor_cm6`
- keep current logical namespaces
- preserve current physical paths for the first code slice unless a later approved substep changes clients
- add `msgspec`-validated JSON-RPC envelope handling at the Python Socket.IO edge
- keep `/wba` adapter-owned and separate

Recommended namespace set:
- `/rpc/editor`
- `/rpc/explorer`
- `/ui_ipc`
- `/sidebar_ipc`
- `/terminal`
- `/wba`

Phase two is framework-owned and now implemented:
- introduce a manifest-declared `sio_service.json`
- let the framework raw proxy own physical Engine.IO route registration, websocket forwarding, and target discovery
- retire bespoke app `services/*_transport.py` Socket.IO proxy scripts when the proxy can express their routes
- keep compatibility aliases explicit in `sio_service.json`, not hidden in Python fallback code

Notes:
- `/editor` should not remain a long-term public ad hoc event bus. Its behavior should converge into typed `/rpc/editor` methods and notifications for the editor-runtime/backend contract.
- Host frontend code should not become a first-class caller of `/rpc/editor` as a substitute for backend mediation. Host-facing actions should stay on the host/backend lane and let Python fan out to editor/backend services.
- `/wba` is still logically separate in execution ownership even when the phase-two physical proxy routes it. Do not collapse WBA behavior into the worker or framework proxy just to satisfy topology aesthetics.

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

### 4. Backend And Template Lanes Must Catch Up

The refactor is not complete until the remaining backend and template lanes catch up to editor/explorer/WBA/host-frontend discipline.

That means:
- `main.py` becomes a smaller backend composition surface
- backend route/helper families move toward typed, focused modules with explicit boundary contracts
- `template.html` stops being the dumping ground for durable UI contract and wiring policy

## Non-Goals

This refactor does not mean:
- rewriting the entire app in one batch
- moving TE2 runtime-owned services into the app worker
- making WBA the owner of frontend policy or host state
- changing SSOT semantics just to fit transport cleanup
- bundling HTML preview implementation into the same execution batch
- touching Android casually outside explicit Android-facing cleanup tasks

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

- Keep the former `/editor` behaviors on typed `/rpc/editor` methods and notifications.
- Keep open/save/mirror/cache-state/prefs/current-file/state publication under one coherent editor RPC contract.
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

### Phase 3. Collapse The App-Local Python Socket.IO Layer

The first transport-collapse code phase stays inside `file_editor_cm6`:
- create one worker-owned Python Socket.IO server for `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, and `/terminal`
- register the existing namespace handler classes on that server
- add `msgspec` as the JSON-RPC envelope validation/conversion layer at the Python Socket.IO edge
- preserve current physical paths for initial callers unless a later approved substep changes frontend/Android paths
- keep `/wba` adapter-owned and separate

Success criteria:
- one worker-side Python `socketio.AsyncServer` for the app-owned Python namespaces
- same logical namespace vocabulary
- no SSOT logic moved into the app-local gateway
- no WBA logic moved into the worker merely for topology aesthetics
- no hidden compatibility fallback beyond explicitly retained current physical paths

### Phase 4. Add The Framework `sio_service.json` Raw Route Proxy

The second transport-collapse phase is framework-owned:
- add a manifest-declared `sio_service.json` raw route definition
- let the main framework load that definition and register physical Engine.IO websocket proxy routes
- route by physical path to app-worker or adapter-owned targets
- retire bespoke app `services/*_transport.py` Socket.IO proxy modules when their routes are represented declaratively

Success criteria:
- one public app-scoped Socket.IO route shape is manifest-declared
- compatibility aliases are explicit in the JSON definition
- no app behavior, SSOT behavior, terminal behavior, Explorer behavior, or WBA behavior moves into the framework proxy
- the raw proxy is reusable by other TE2 apps rather than hardcoded for `file_editor_cm6`

### Phase 5. Finish Backend And Template Decomposition

Once the transport/contracts are stable:
- shrink `main.py` toward backend composition by extracting small route/helper families
- keep the already-split host frontend entry as a composition root unless a concrete ownership bug justifies more extraction
- split durable UI contract out of `template.html` where practical
- keep `template.html` focused on structure, not app behavior policy
- record detailed completed-slice status in `FILE_EDITOR_CM6_MAIN_PAGE_DECOMPOSITION_PLAN.md`

### Phase 6. Remove Residue

- remove stale transport wrappers and compatibility shims once callers are gone
- remove dead docs that were only valid during migration
- remove legacy event-name RPC assumptions from comments, docs, and helper naming

### Phase 7. Resume Queued Feature Work

Only after the refactor track is coherent again:
- resume the HTML live preview plan
- keep preview implementation on the backend-hook/project-sidecar/framework-shell path already planned

## Practical Rule Of Thumb For New Work

When touching a feature during this refactor:
- if it adds or changes a socket contract, make it typed and JSON-RPC-shaped
- if it adds host behavior, do not dump more durable policy into `main.py` or `template.html` if a focused module can own it
- if it starts in host chrome, prefer the host/backend lane and backend fanout over new direct host-to-editor RPC coupling
- if it needs transport consolidation, follow `FILE_EDITOR_CM6_TRANSPORT_COLLAPSE_PLAN.md` and do it without moving domain ownership
- if it belongs to preview, defer it unless it directly unblocks this refactor track

## Completion Criteria

This refactor track is "done enough" when all of the following are true:
- the app-local Python Socket.IO layer is one worker-side server before the framework proxy phase begins
- the app has a manifest-declared raw Socket.IO route proxy after the framework proxy phase, with separate physical Engine.IO routes only where upstream connection semantics differ
- logical namespaces are stable and intentional
- public socket contracts are JSON-RPC and typed end-to-end
- `/editor` no longer survives as a legacy ad hoc public event bus
- `main.py` is mostly backend composition rather than feature ownership
- `template.html` is no longer carrying avoidable app-behavior contract density
- stale docs and transport residue are removed or explicitly historical

## Why This Order

This order keeps the difficult parts aligned:
- contracts stabilize before transport surgery
- transport surgery happens before final host/template cleanup
- ownership boundaries stay fixed during both
- feature work such as HTML preview does not land on top of half-finished architecture drift
