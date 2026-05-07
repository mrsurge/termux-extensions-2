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

## Immediate Ordered Queue

The next work should proceed in this order:

1. Deprecate `/editor` as a public ad hoc event bus and complete the editor runtime/backend conversion to `/rpc/editor`.
   - Inventory every remaining `/editor` event and classify it as request, notification, or obsolete compatibility traffic.
   - Add typed JSON-RPC request/notification names for the remaining live behaviors before moving callers.
   - Move editor open, jump, issues, draft-diff, git-baseline, cache/draft/scroll state, notify, ready, save snapshot, and diagnostics-count traffic behind the typed editor RPC contract where still applicable.
   - Keep backend ownership unchanged: `/rpc/editor` is the editor-runtime/backend lane, not a host shortcut around `/ui_ipc`.
   - Add temporary instrumentation only when it proves old `/editor` traffic is gone; then remove the old namespace registration and handlers.
2. Move Android-native editor/UI integration from legacy `ui_event` compatibility onto the UI IPC JSON-RPC notification lane.
   - Android `UiIpcClient` should consume `rpc.notify` envelopes on `/ui_ipc` for editor focus/blur and other host-facing notifications instead of depending on the legacy `ui_event` bridge.
   - Keep legacy Android compatibility only until the Android clients have been validated on the RPC lane, then remove `_LEGACY_UI_EVENT_SIDS` and related `ui_event` fanout from the worker.
   - Make Android console drawer registration/hydration deterministic on first open.
3. Create a dedicated sidebar IPC/RPC contract surface for external sidebar actions and clean up sidebar boundaries.
   - Add frontend and backend contract modules for `/sidebar_ipc` instead of treating it as a collection of event-name conventions.
   - Add a corresponding definition document for external sidebar actions such as mentions, file opens, active shortcut state, refresh requests, and cwd sync.
   - Keep source ownership explicit: Explorer-originated actions use Explorer RPC or backend relays, editor-originated actions use editor RPC/backend relays, and external/sidebar-frame actions use the sidebar contract.
4. After items 1-3 are coherent, consolidate the physical app transports behind one app-scoped Socket.IO gateway path while preserving logical namespaces.
   - Preserve `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, `/terminal`, and `/wba` as logical namespaces unless a concrete contract cleanup removes one.
   - Do not move SSOT, WBA, terminal, host, or Explorer behavior into the gateway. The gateway is transport routing, not domain ownership.
5. Fix Android tools/settings console hydration on first open.
   - Opening the Android tools/settings console overlay should register as a drawer and replay the TE2 console tail immediately without requiring close/reopen.
6. Fix extension settings rendering so VSIX/object-valued settings do not display as `[object Object]`.
   - Treat this as a typed normalization/rendering bug in the extension settings surface, likely in `main.py` or a supporting settings/extension module.
7. Decompose and strictly type `main.py`, and find/deprecate unused top-level modules.
   - Start with small backend route/helper families and avoid moving framework-owned service shims out of `services/`.
   - Track deleted top-level modules explicitly so stale imports and app-loader contracts do not silently survive.
8. Debug why WBA does not work with the same `rust-analyzer` VSIX that works with the same code-server instance powering the WBA.
   - Treat this as a WBA extension-host/provider bootstrap issue until proven otherwise.
   - Compare extension discovery, activation, workspace trust/configuration, binary/server executable resolution, and language/provider registration between the visible code-server path and WBA.

### Current `/editor` Deprecation Inventory

The first `/editor` cleanup slice should start from this live inventory:

- connect snapshots: `editor:ssot` should become `/rpc/editor` connect-state only.
- backend-to-editor notifications already mirrored to RPC and ready for caller cleanup: `editor:open`, `editor:jump_to_line`, `editor:git_baselines`, `editor:mirror`, `editor:cache_state`, `editor:draft_state`, `editor:prefs_changed`, `editor:notify`, `editor:open_complete`, `editor:ready`, `editor:issues_dump_request`, `editor:issues_cmd`, and `editor:find_cmd`.
- editor-to-backend requests still requiring RPC dispatch coverage or caller migration: `editor_open_request`, `editor_jump_to_line_request`, `editor_git_baselines_request`, `editor_draft_diff_request`, `editor_mirror`, `editor_save_request`, `editor_save_snapshot_response`, `editor_issues_dump_request`, `editor_issues_dump_response`, `editor_model_ready`, `editor_breadcrumb_navigate`, `editor_cache_state`, `editor_scroll_state`, `editor_draft_state`, `editor_notify`, `editor_open_complete`, `editor_ready`, `editor_diagnostics_counts`, `editor_prefs_changed`, `editor_issues_cmd`, and `editor_find_cmd`.
- known editor frontend legacy emitters include draft-diff request, git-baseline request, breadcrumb navigation, and host emit helpers that still target the `/editor` socket.
- removal criterion: after `/rpc/editor` callers and server notifications cover those families, `/editor` namespace registration should be removed instead of left as a fallback.

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
- `docs/apps/code_cm6/SIDEBAR_IPC_RPC_CONTRACT.md`
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
