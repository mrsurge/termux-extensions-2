# File Editor CM6 main page decomposition plan

## Goal

Keep the host frontend entry (`app/apps/file_editor_cm6/main.ts`) as the finished-enough composition root, and make `app/apps/file_editor_cm6/main.py` plus `app/apps/file_editor_cm6/template.html` the next breakup targets without changing product behavior first.

The intended direction is:

- keep a small root entrypoint for framework/app-loader compatibility
- move main-page-owned backend route/service code into the same package family, grouped by domain
- keep the main-page frontend strict TypeScript lane stable instead of chasing more root-entry line-count reduction
- split durable UI contract and behavior policy out of `template.html` where practical
- keep framework-owned service proxy shims under `app/apps/file_editor_cm6/services/`

## Progress Tracker

This document is the canonical progress tracker for `file_editor_cm6` main-page and template decomposition work.

Use the broader `FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md` for target architecture and sequencing. Use this file for concrete slice status, completed extraction notes, and next main-page/template cleanup candidates.

Transport-collapse execution details live in `FILE_EDITOR_CM6_TRANSPORT_COLLAPSE_PLAN.md`. The app-local Python Socket.IO collapse is complete; main-page/template cleanup should still not race ahead of the later framework `sio_service.json` relay phase when physical transport ownership is involved.

### Completed Slices

- Host chrome extraction: `main_page/frontend/host-chrome-runtime.ts` owns toolbar filename/title clamp, mobile filename drag, issues-button dispatch, and diagnostics export wiring that used to live inline in `main.js`.
- Host state extraction: `main_page/frontend/host-state-runtime.ts` owns adapter readiness state, readiness spinner resolution, `cm6:adapter-state`, and `cm6:active-file-changed` handling.
- Host editor-event boundary extraction: `main_page/frontend/host-editor-events-runtime.ts` owns host-side editor readiness/open waiters, cache-state handling, scroll-state persistence, diagnostics badge projection, and editor notify toasts from `/ui_ipc`-bridged editor notifications.
- Sidebar/drawer prune and extraction: `main_page/frontend/host-sidebar-runtime.ts` owns local drawer open/close/toggle behavior and consumes sidebar IPC/RPC events bridged as `cm6:sidebar-event`.
- Dead in-app agent harness removal: the old `/agent/*` FastAPI router, `/ws/agent` WebSocket mount, transcript/session backend, direct Codex appserver socket, open-request poller, transcript/composer/session markup, and legacy sidebar iframe/drawer controllers were removed from the live path.
- Main-page console bridge refresh/source cleanup: `main_page/frontend/console_bridge.js` now matches the cached current bridge, remains JS intentionally, and `main_page/frontend/connections/ui-ipc.ts` starts the bridge only after Socket.IO is available with `workerLabel: "main_page"` plus `uniquePerWindow: true`.
- Terminal-drawer mobile root-width hardening: `template.html` now keeps Monaco's body-level offscreen char-width probe on the negative scroll axis and constrains the terminal drawer/xterm stack so opening the drawer cannot poison GeckoView root scroll metrics.
- Explorer RPC runtime ownership cleanup and topology freeze: `src/explorer/rpc/runtime.ts` owns Explorer RPC connection lifecycle, notification fanout, reconnect handling, and initial git-status refresh. `src/explorer/rpc/connection.ts` owns the Socket.IO transport wrapper, the host entry imports Explorer bootstrap directly from `src/explorer/app/bootstrap.ts`, and the old `static/js/explorer.ts` plus host-side Explorer connection shim were removed.
- Cross-domain bridge cleanup: the `window.__explorerRpc`, `window.__explorerHandleNotification`, `window.__cm6ExplorerOnReconnect`, `window.__cm6RefreshExplorer`, and `window.__explorerScrollToActiveFile` bridge globals were removed from the live source path. Explorer client access is now a module-local registry in `src/explorer/rpc/client.ts`, and Explorer notification/reconnect/refresh helpers are exported from Explorer-owned source.
- Editor and host mention boundary cleanup: editor touch-selection mention now sends `editor.mention.request` over `/rpc/editor` to editor-owned backend handling; the editor frontend no longer connects to `/ui_ipc` for save/focus/blur/mention or adapter-state consumption; host diagnostics/problems mention now routes through the `/ui_ipc` backend hook `ui.host.diagnostics.mention`.
- Explorer new-project modal ownership cleanup: the Explorer-only new-project modal moved from legacy `static/js/new_project_modal.js` into strict Explorer source at `src/explorer/chrome/new-project-modal.ts`, and Explorer bootstrap imports it from the owning source tree.
- Host legacy-static trio cleanup: host-only legacy static modules `static/js/resize_manager.js`, `static/js/git_menu.js`, and `static/js/console.js` moved into strict main-page source as `main_page/frontend/host-resize-manager.ts`, `main_page/frontend/host-git-branch-menu.ts`, and `main_page/frontend/host-console-drawer.ts`.
- Diagnostics/shared connection cleanup: the shared Problems panel moved from `static/js/problems.js` into strict diagnostics source at `src/diagnostics/problems-panel.ts`, and the generic host reconnecting WebSocket helper moved from `static/js/reconnecting_websocket.js` into `main_page/frontend/connections/reconnecting-websocket.ts`.
- Terminal drawer source cleanup: the host terminal drawer moved from `static/js/terminal.js` into strict main-page source at `main_page/frontend/host-terminal-drawer.ts`, with local xterm, FitAddon, Socket.IO, shell-list, and mobile-helper boundary types.
- Explorer stylesheet source cleanup: the editable Explorer drawer stylesheet moved from `static/js/explorer.css` into `main_page/frontend/explorer.css`; `build.mjs` copies it to generated `static/dist/explorer.css`, and `template.html` loads that static generated asset.
- Host connection family cleanup: host-owned frontend connection helpers moved from `src/host/connections/` into strict main-page source at `main_page/frontend/connections/`; the move covers UI IPC/sidebar IPC connection setup, file WebSocket setup, file sync handling, Socket.IO/vendor loaders, and the reconnecting WebSocket helper.
- Host IO family cleanup: host-owned picker and jump-line controllers moved from `src/host/io/` into strict main-page source at `main_page/frontend/io/`, with explicit picker result/save-target and editor jump request contracts.
- Host file-ops family cleanup: host-owned open/save/run file operation controllers moved from `src/host/file-ops/` into strict main-page source at `main_page/frontend/file-ops/`, with explicit open options, save response, save target, and run-file response contracts.
- Host boot family cleanup: host-owned boot/session/path-state controllers moved from `src/host/boot/` into strict main-page source at `main_page/frontend/boot/`, with explicit editor-state, global-open-hook, before-exit, session telemetry, and restored-path contracts.
- Host core utility cleanup: host-owned API client, app context factory, and path/language/menu utility helpers moved from `src/host/api/client.ts`, `src/host/app-context.ts`, and `src/host/utils.ts` into strict main-page source under `main_page/frontend/core/`.
- Host UI family cleanup: the remaining host UI controllers moved from `src/host/ui/` into strict main-page source at `main_page/frontend/ui/`, and the host ambient declarations moved from `src/host/global.d.ts` to `main_page/frontend/global.d.ts`. The host entry imports toolbar/menubar/settings/recents/drawer/autosave/watcher UI controllers from `main_page/frontend/ui/`.
- Host element capture cleanup: `main_page/frontend/host-elements.ts` now owns the required DOM element capture contract for the host shell, including toolbar, menu, drawer, settings, and status elements. The host entry imports `captureHostElements(...)` and keeps only runtime assembly over the returned element bag.
- Host UI preference runtime cleanup: `main_page/frontend/host-ui-prefs-runtime.ts` owns UI preference snapshot normalization, initial preference waiters, boot-snapshot seeding, sidebar shortcut preference application, the `window.__cm6HandleUiPrefs` hook, and pending preference replay.
- Host boot runtime cleanup: `main_page/frontend/host-boot-runtime.ts` owns host boot dependency assembly, inline editor host mounting, post-boot sidebar init/hydration, no-project/restored-path boot state handling, and host exit-guard installation. The host entry delegates this end-of-file boot block through `createHostBootRuntime(...).start()`.
- Console drawer log rendering fix: `main_page/frontend/host-console-drawer.ts` renders incoming TE2 console `console:log` events through vConsole's `model.addLog(...)` API with `noOrig: true`. The `noOrig` flag is mandatory because upstream vConsole calls its saved original console after `addLog(...)` unless suppressed, and in TE2 that saved console is the framework console bridge.
- Main-page entry state localization: remaining mutable host state and the UI IPC connection setup now live inside `initFileEditor(...)` instead of at module scope. This left the root entry with imports, `_isMobileLayout()`, and the exported entry function, making the TypeScript conversion mechanical.
- Host entry TypeScript conversion: `main.js` was renamed to `main.ts`, `build.mjs` now uses `main.ts` as the host bundle source entry, `tsconfig.json` includes the entry directly, and the served asset remains `static/dist/host.js`.
- Host entry finish pass: `main.ts` remains a procedural composition root, but the final cleanup removed write-only local state, dead wrapper functions, and stale comments left over from the conversion. This host frontend entry is broken up enough for now; do not keep listing it as a next decomposition target unless a concrete ownership bug requires another extraction.
- Editor RPC namespace cleanup: the legacy `/editor` Socket.IO namespace is retired from the active editor server, and `/rpc/editor` is now the editor runtime/backend lane. Jump-to-line, git-baseline, draft-diff, mirror/save, save-snapshot, cache/draft/scroll state, ready/open-complete/notify, diagnostics-count, model-ready, issues, find, and breadcrumb navigation traffic now uses typed `/rpc/editor` methods/notifications or backend-owned host hooks that fan out through `/rpc/editor`.
- Android UI IPC RPC cleanup: Android native code now consumes UI IPC `rpc.notify` envelopes for editor focus/blur, no longer listens for the legacy `ui_event` bridge, and the worker no longer maintains Android compatibility `ui_event` subscribers/fanout.
- Sidebar shortcut source cleanup: persisted shortcut preferences, header shortcut rendering, modal behavior, iframe-stack activation, and framework-app shortcut startup now live under `main_page/frontend/sidebar-shortcuts/` with `runtime.ts` as the source entry and `main_page/frontend/ui/sidebar-shortcuts-bootstrap.ts` as the host bootstrap seam.
- App-local Socket.IO collapse: `socketio_gateway.py` now owns one worker-side Python Socket.IO server for `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, and `/terminal`, with current physical paths preserved through `main.py` and `msgspec` envelope validation centralized in `socketio_jsonrpc.py`.

### Current Sidebar Boundary

The live sidebar surface is:

- `main_page/frontend/sidebar-shortcuts/runtime.ts` plus the adjacent `main_page/frontend/sidebar-shortcuts/` modules for persisted shortcut preferences, header shortcut rendering, modal behavior, iframe-stack activation, and framework-app shortcut startup.
- `main_page/frontend/ui/sidebar-shortcuts-bootstrap.ts` for host bootstrap into the sidebar shortcut runtime.
- `/sidebar_ipc` on `/ui_ipc_ws/socket.io` for cwd sync, active shortcut state, refresh/mention relay, and sidebar-originated editor-open routing through backend host hooks.
- `main_page/frontend/host-sidebar-runtime.ts` for main-page drawer shell open/close/toggle state.

Historical `agent*` DOM ids and UI preference keys remain compatibility names for the sidebar shortcut UI. They are not evidence that the removed in-app agent harness still exists.

### Completed P0 Boundary Cleanup

This cleanup was ranked ahead of older host-entry shrinkage ideas, template cleanup, and physical Socket.IO gateway consolidation.

1. Editor-originated mention now uses editor-owned transport and source ownership.
   - `monaco_editor/editor_touch_menu_utils.ts` no longer emits `ui.editor.mention.request`.
   - `monaco_editor/m_editor_app.ts` now sends `editor.mention.request` over `/rpc/editor`.
   - `monaco_editor/editor_mention_backend.py` owns the backend relay to sidebar IPC with `source: "editor"`.
2. Explorer-originated mention remains Explorer-owned.
   - Explorer tree/context-menu mention belongs in `src/explorer/` and should continue to use Explorer RPC.
   - Explorer diagnostics/project-panel mention belongs with Explorer if the producing surface is the Explorer UI.
3. Host/general UI actions use UI IPC/backend host hooks.
   - `fe-menubar`, toolbar, host drawer chrome, and other main-page host actions should go through `/ui_ipc` and backend host hooks when they command editor behavior.
   - Do not treat host UI IPC as a shortcut for editor runtime code to reach unrelated app surfaces.
4. Diagnostics mention must be classified by producing surface before edits.
   - Explorer diagnostics panel remains Explorer RPC-owned.
   - Host diagnostics/problems drawer now uses `/ui_ipc` method `ui.host.diagnostics.mention` and backend host handling before sidebar relay.
   - Diagnostics mention is no longer a backdoor that routes host/editor actions through Explorer by convenience.
5. Editor frontend `/ui_ipc` usage was removed.
   - Save-key, focus, blur, mention, and adapter-state handling now use `/rpc/editor`.
   - Backend relays editor-originated host-facing events to `/ui_ipc` for host consumers, but the editor frontend itself does not connect to UI IPC.
6. Source ownership remains mandatory.
   - Editor UI/runtime source belongs under `monaco_editor/`.
   - Explorer UI/runtime source belongs under `src/explorer/`.
   - Main-page host chrome/orchestration belongs under `main_page/frontend/` or host-owned modules.
   - Shared modules must be real contracts/utilities only. Do not scatter domain feature code through unrelated repo directories.
7. Source files that install behavior into a UI surface must live with that UI surface.
   - If a file installs Explorer RPC globals, Explorer notification handlers, Explorer reconnect behavior, Explorer tree behavior, Explorer diagnostics rendering, or Explorer menu actions, it belongs under `src/explorer/` and must be imported by Explorer-owned source.
   - If a file installs Monaco/editor commands, touch-menu behavior, save/focus/blur handlers, editor diagnostics/projections, editor settings behavior, or editor RPC handlers, it belongs under `monaco_editor/` and must be imported by editor-owned source.
   - If a file installs host chrome, toolbar, menubar, drawer shell, status indicators, boot orchestration, or host/backend request hooks, it belongs under `main_page/frontend/` or an explicitly host-owned `src/host/` package.
   - Do not put a domain installer under `main_page/frontend/` merely because the host entry assembles boot order. That recreates the dump point with a new path.
8. No compatibility-shim or fallback escape hatches for this cleanup.
   - Do not add a parallel old path while claiming the new path is fixed.
   - Do not keep a fallback transport for editor-owned actions after moving them to editor RPC.
   - Do not leave the host entry, `main_page/frontend/`, or `window.__*` globals as hidden backdoors for cross-domain behavior unless the cleanup explicitly removes that dependency in the same series.
   - If a removed bridge breaks runtime behavior, debug and repair the real owning source/transport instead of restoring the bridge.
9. Versioning and validation gate for this cleanup.
   - The cleanup batch should be version-synced only after the source-ownership and transport-ownership work is complete.
   - Do not treat partial runtime smoke results as acceptance. Complete the cleanup first, then rebuild, sync version surfaces once, reload, validate, and debug failures from the new ownership model.

### Immediate Next Candidates

1. Defer the framework-level `sio_service.json` relay to transport-collapse phase two; do not recreate hidden fallback transport routing while it is being designed.
2. Live-validate the cleaned ownership model only after explicit approval, using the exact generated `main_page` TE2 console worker and the relevant app-worker/WBA framework-shell logs.
3. Use the frozen Socket.IO topology constants when touching frontend socket clients, but avoid frontend/Android physical path changes until the framework relay phase explicitly accounts for clients.
4. Start `main.py` decomposition only after choosing a small route/helper family that does not move framework-owned service or worker subapp ownership prematurely.
5. Continue re-reviewing `template.html` after the sidebar prune and remove remaining avoidable behavior policy from markup/CSS while preserving shortcut DOM compatibility.
6. Convert remaining host actions that still import Explorer RPC for project/settings/watcher flows into explicit backend-owned hook surfaces only after classifying whether the producing surface is host or Explorer.
7. When debugging live frontend behavior through TE2 console, target the exact generated worker id under the `main_page` label rather than assuming a fixed worker id.

## Current code review

### `main.ts`

Baseline at plan creation: roughly 3,700 lines as `main.js`. After the current source-tree cleanup, TypeScript conversion, and finish pass, `main.ts` is roughly 1,153 lines. Re-check the live line count before using size as progress evidence.

It is no longer an active breakup target. The root file is the strict host bundle composition entrypoint, and further extraction should be driven only by a concrete ownership or behavior bug, not by line count.

Important typing state:

- `main.ts` is now the strict TypeScript source entry for the host bundle.
- `tsconfig.json` is strict for the active main-page source under `main_page/frontend/**/*.ts` and includes `main.ts` directly.
- The former `src/host` frontend families have moved into the strict main-page lane, leaving `src/host` without live frontend files.
- The remaining host typing backlog is now future helper/runtime cleanup around currently loose helper modules, not exclusion of the root entry.

### `main.py`

Baseline at plan creation: roughly 2,600 lines. Re-check the live line count before using size as progress evidence.

It is a true backend monolith. It owns:

- APIRouter creation and route registration
- workbench adapter discover/start/attach/status/cmd routes
- workbench extension enablement routes
- editor/sidebar/terminal route inclusion
- worker-owned Socket.IO subapp mounts
- project session boot and eager code-server startup
- combined state payload construction
- legacy file read/write/session-cache endpoints
- project open/create/current endpoints
- git branch/status/diff/stage/commit/push/pull/reset/remote routes
- debug project/history/sidecar routes
- old Explorer REST endpoints that overlap the Explorer JSON-RPC backend
- review/search REST endpoints that overlap extracted Explorer handlers
- edit-tracker and debug-console websocket endpoints

Important backend state:

- The app worker entry module is still `main.py` via `manifest.json`.
- `SUBAPPS` is consumed by the app worker mounting layer and should remain easy to find.
- `services/*.py` files are framework-loaded main-process service shims. They are not main-page feature modules and must not be moved into the feature package.

## Ownership boundaries

### Do not move framework-owned service shims

Files under `app/apps/file_editor_cm6/services/` are loaded by the framework app-service loader from `manifest.json`.

They include main-process transport proxies such as:

- `services/editor_transport.py`
- `services/explorer_transport.py`
- `services/terminal_transport.py`
- `services/ui_ipc_transport.py`

These must stay in `services/` unless the manifest/service loader is intentionally changed in the same approved task.

The prior Explorer proxy break came from moving one of these shims as if it were ordinary app-worker code. The main-page decomposition must treat these as framework integration surfaces, not domain logic.

### Keep root entrypoints stable during migration

Recommended compatibility shape:

- keep `main.py` as the app worker entrypoint in `manifest.json`
- keep the built output `static/dist/host.js` unchanged as the served frontend asset
- use `main.ts` as the esbuild host source entrypoint
- keep future root-entry shrinkage focused on grouped host runtime extraction, not another broad source bucket

## Proposed package layout

Use a new app-local package:

```text
app/apps/file_editor_cm6/main_page/
  __init__.py
  backend/
    __init__.py
    router.py
    state_routes.py
    project_routes.py
    git_routes.py
    history_routes.py
    debug_routes.py
    workbench_routes.py
    file_routes.py
    websocket_routes.py
    startup.py
    state_payload.py
  frontend/
    entry.ts
    runtime.ts
    dom.ts
    host-chrome-runtime.ts
    host-state-runtime.ts
    host-editor-events-runtime.ts
    host-sidebar-runtime.ts
    sidebar-shortcut-runtime.ts
    toolbar-runtime.ts
    diagnostics-export-runtime.ts
    adapter-readiness-runtime.ts
    host-state-runtime.ts
```

Notes:

- The `frontend/` names are a planning target. If the repo prefers keeping browser TS under `src/host/`, extract there first and add thin re-export modules under `main_page/frontend/` later.
- The backend module names should remain grouped by behavior, not by route count.
- Avoid a generic `utils.py` / `utils.ts` dumping ground; if a helper has a clear domain, put it with that domain.

## Frontend migration plan

### Phase 1: create typed seams without changing the bundle entry

1. Historical: `build.mjs` initially kept `main.js` as the host source entrypoint.
2. Add `main_page/frontend/` modules for one isolated cluster at a time.
3. Import those modules from `main.js`.
4. Keep intentional public runtime hooks stable, but do not add new cross-domain `window.__*` bridges:
   - `window.__cm6HandleUiPrefs`
   - `window.__cm6HandleLspStatusUpdate`
   - `window.__feAppContext`
   - existing `window.appOpenFile` and related public hooks owned by imported host modules
5. Add local typed contracts for each extracted cluster instead of passing the whole closure.

Best first extraction targets:

1. `toolbar-runtime.ts`
   - `formatFileNameDisplay`
   - toolbar title clamp scheduling
   - mobile filename drag
   - `setToolbarFileName`
   - reason: mostly DOM-local and low transport risk
2. `diagnostics-export-runtime.ts`
   - default export filename builder
   - diagnostics markdown formatter
   - export modal
   - `.code_cm6/diagnostics` directory creation flow
   - reason: large self-contained chunk with clear API dependencies
3. Sidebar runtime
   - completed: `host-sidebar-runtime.ts` owns main-page drawer shell open/close/toggle behavior
   - completed: shortcut collection, active selection, iframe-stack sync, shortcut modal glue, and framework-app shortcut startup now live under `main_page/frontend/sidebar-shortcuts/`
   - removed: Codex appserver socket tracking belonged to the dead in-app agent harness and should not be recreated in the main-page runtime
4. `host-editor-events-runtime.ts`
   - completed: host-side editor ready/open waiters, cache/scroll event handling, diagnostics count projection, and notify toasts consume `/ui_ipc`-bridged editor notifications
   - do not recreate a direct host editor Socket.IO connection for these host-facing state events
5. Explorer RPC runtime
   - completed under Explorer-owned source at `src/explorer/rpc/runtime.ts` and `src/explorer/rpc/connection.ts`
   - do not place Explorer installers under `main_page/frontend/` merely because the host entry assembles boot order

### Phase 2: strict TypeScript coverage

1. Add `main_page/frontend/**/*.ts` to `tsconfig.json`.
2. If extracted modules import untyped `src/host` modules and pull them into the strict graph, either:
   - type the directly imported `src/host` modules in the same slice, or
   - keep the extraction in `src/host` and expand strict coverage by a controlled subdirectory.
3. Avoid enabling all of `src/host` in one pass unless the task is explicitly a broad host strict-typing cleanup.
4. Keep `types: []` for browser TS so Node globals do not leak into frontend typing.

### Phase 3: convert the root host entry

Completed after the extracted main-page entry was strict-clean:

1. Rename `main.js` to `main.ts`.
2. Update `build.mjs` host entrypoint to `main.ts`.
3. Keep output as `static/dist/host.js`.
4. Rebuild and sync the normal `file_editor_cm6` version surfaces for frontend changes.

## Backend migration plan

### Phase 1: move pure helpers and route groups behind routers

Keep `main.py` as the manifest entrypoint, but shrink it to composition:

```python
from .main_page.backend.router import main_page_router

file_editor_cm6_bp.include_router(main_page_router)
```

First backend extraction targets:

1. `state_payload.py`
   - `_get_runtime_metadata`
   - `_build_state_payload`
   - `_expand_and_validate_path`
   - reason: used by many routes and easy to test in isolation
2. `workbench_routes.py`
   - `/workbench_adapter/discover`
   - `/workbench_adapter/start`
   - `/workbench_adapter/attach`
   - `/workbench_adapter/nudge`
   - `/workbench_adapter/status`
   - `/workbench_adapter/cmd`
   - `/workbench/extensions/enabled`
   - reason: coherent WBA-facing route family
3. `project_routes.py`
   - `/project/open`
   - `/project/create`
   - `/project/current`
   - reason: central state transition family; should eventually share a project-switch service with Explorer
4. `git_routes.py`
   - branch/status/diff-base/stage/commit/push/pull/reset/remote endpoints
   - reason: large route family with a clear `git_helper` dependency
5. `history_routes.py` and `debug_routes.py`
   - recent files/history/sidecar/debug project endpoints
   - reason: low product risk and removes a lot of tail routes
6. `file_routes.py`
   - `/read`
   - `/write`
   - `/session_cache`
   - reason: higher risk because save/draft notifications interact with editor/explorer/watchers
7. `websocket_routes.py`
   - `/ws/read`
   - `/ws/edit_tracker`
   - `/ws/debug_console`
   - reason: separate long-lived connection ownership from ordinary HTTP routes

### Phase 2: remove or redirect stale Explorer REST overlap

`main.py` still has old Explorer REST endpoints:

- `/explorer/list`
- `/explorer/search`
- `/explorer/mkdir`
- `/explorer/touch`
- `/explorer/rename`
- `/explorer/delete`
- `/explorer/batch_delete`
- `/explorer/copy`
- `/explorer/move`
- `/explorer/batch_copy`
- `/explorer/batch_move`
- `/explorer/copy_from`
- `/explorer/move_from`

These overlap the extracted Explorer JSON-RPC backend. Do not blindly delete them in the first main-page slice. First classify each endpoint as:

- still used by host-only compatibility code
- dead compatibility route
- should redirect to Explorer backend handler/service
- should move into an explicit legacy compatibility module

### Phase 3: worker boot and subapp composition

Move worker boot concerns into focused backend modules while keeping the symbols discoverable from `main.py`:

- `startup.py`
  - project session initialization
  - sidecar cleanup
  - eager code-server startup
  - workbench settings sync
- `router.py`
  - route group includes
  - static app route includes
- root `main.py`
  - constructs `file_editor_cm6_bp`
  - includes routers
  - registers Monaco/editor/sidebar/terminal routes
  - defines or imports `SUBAPPS`
  - exports `NICEGUI_INIT_HOOK` if needed by the worker loader

## Validation plan

For frontend-bearing slices:

1. `cd app/apps/file_editor_cm6 && npm run --silent typecheck`
2. `cd app/apps/file_editor_cm6 && node build.mjs`
3. `git --no-pager diff --check -- app/apps/file_editor_cm6`
4. sync `pyproject.toml`, `app/apps/file_editor_cm6/manifest.json`, and `app/apps/file_editor_cm6/static/version.txt` for served frontend changes

For backend-only slices:

1. `python -m py_compile` on touched backend files
2. targeted `basedpyright --project app/apps/file_editor_cm6/pyrightconfig.json ...` for new strict modules
3. `git --no-pager diff --check -- app/apps/file_editor_cm6`

Do not restart the shared framework process as part of this plan. If a route registration change needs a live framework reload, stop and ask first.

## Recommended next implementation slice

The first frontend slices have already proved the `main_page/frontend/` strict TypeScript pattern, and the boundary cleanup moved Explorer/editor installers back to their owning source trees.

Next, live-validate the cleaned ownership model first. After that, choose one remaining host action family that still reaches into Explorer RPC from host-owned code, classify whether the producing surface is truly host or Explorer, and route only the host-owned family through an explicit `/ui_ipc` backend hook.

For that slice:

1. Keep `main_page/frontend/**/*.ts` in the strict TypeScript lane without pulling the entire excluded `src/host` backlog into strict checking.
2. Keep `main.ts` as the host source entrypoint and `static/dist/host.js` as the served asset.
3. Do not add compatibility fallback transports or `window.__*` bridge globals.
4. Rebuild and sync the normal served frontend version surfaces if frontend assets change.

Then do a backend-only slice:

1. Create `main_page/backend/state_payload.py`.
2. Move runtime metadata, state payload building, diff-base payload if needed, and path validation helpers.
3. Keep route behavior unchanged.
4. Validate with `py_compile` and targeted `basedpyright`.

This order proves both frontend and backend extraction patterns without touching high-risk transports, app-service shims, or worker subapp mounts.
