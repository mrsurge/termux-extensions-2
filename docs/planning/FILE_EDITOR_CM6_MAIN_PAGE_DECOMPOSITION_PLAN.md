# File Editor CM6 main page decomposition plan

## Goal

Make `app/apps/file_editor_cm6/main.js` and `app/apps/file_editor_cm6/main.py` the next decomposition targets without changing product behavior first.

The intended direction is:

- keep a small root entrypoint for framework/app-loader compatibility
- move main-page-owned frontend code into a new `app/apps/file_editor_cm6/main_page/` area
- move main-page-owned backend route/service code into the same package family, grouped by domain
- bring the main-page frontend under strict TypeScript incrementally
- keep framework-owned service proxy shims under `app/apps/file_editor_cm6/services/`

## Progress Tracker

This document is the canonical progress tracker for `file_editor_cm6` main-page and template decomposition work.

Use the broader `FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md` for target architecture and sequencing. Use this file for concrete slice status, completed extraction notes, and next main-page/template cleanup candidates.

### Completed Slices

- Host chrome extraction: `main_page/frontend/host-chrome-runtime.ts` owns toolbar filename/title clamp, mobile filename drag, issues-button dispatch, and diagnostics export wiring that used to live inline in `main.js`.
- Host state extraction: `main_page/frontend/host-state-runtime.ts` owns adapter readiness state, readiness spinner resolution, `cm6:adapter-state`, and `cm6:active-file-changed` handling.
- Host editor-event boundary extraction: `main_page/frontend/host-editor-events-runtime.ts` owns host-side editor readiness/open waiters, cache-state handling, scroll-state persistence, diagnostics badge projection, and editor notify toasts from `/ui_ipc`-bridged editor notifications.
- Sidebar/drawer prune and extraction: `main_page/frontend/host-sidebar-runtime.ts` owns local drawer open/close/toggle behavior and consumes sidebar IPC/RPC events bridged as `cm6:sidebar-event`.
- Dead in-app agent harness removal: the old `/agent/*` FastAPI router, `/ws/agent` WebSocket mount, transcript/session backend, direct Codex appserver socket, open-request poller, transcript/composer/session markup, and legacy sidebar iframe/drawer controllers were removed from the live path.
- Main-page console bridge refresh: `static/js/console_bridge.js` now matches the cached current bridge, and `src/host/connections/ui-ipc.ts` starts the bridge only after Socket.IO is available with `workerLabel: "main_page"` plus `uniquePerWindow: true`.
- Terminal-drawer mobile root-width hardening: `template.html` now keeps Monaco's body-level offscreen char-width probe on the negative scroll axis and constrains the terminal drawer/xterm stack so opening the drawer cannot poison GeckoView root scroll metrics.
- Explorer RPC runtime extraction and topology freeze: `main_page/frontend/explorer-rpc-runtime.ts` now owns Explorer RPC connection lifecycle, notification fanout, reconnect handling, and `window.__explorerRpc` bridge installation. `src/rpc/socketio-topology.ts` records the current frontend Socket.IO namespace/path vocabulary as a precursor to physical gateway consolidation.

### Current Sidebar Boundary

The live sidebar surface is:

- `extensions/sidebar_extension/static/js/sidebar_shortcuts.js` for persisted shortcut preferences, header shortcut rendering, modal behavior, iframe-stack activation, and framework-app shortcut startup.
- `/sidebar_ipc` on `/ui_ipc_ws/socket.io` for cwd sync, active shortcut state, refresh/mention relay, and sidebar-originated editor-open routing through backend host hooks.
- `main_page/frontend/host-sidebar-runtime.ts` for main-page drawer shell open/close/toggle state.

Historical `agent*` DOM ids and UI preference keys remain compatibility names for the sidebar shortcut UI. They are not evidence that the removed in-app agent harness still exists.

### Immediate Next Candidates

- Continue re-reviewing `template.html` after the sidebar prune and remove remaining avoidable behavior policy from markup/CSS while preserving shortcut DOM compatibility.
- Continue shrinking `main.js` by choosing the next grouped host runtime that does not pull all of `src/host/` into strict checking at once.
- Use the frozen Socket.IO topology constants when touching frontend socket clients, but do not begin physical gateway consolidation until a dedicated backend gateway slice is approved.
- Start the backend decomposition only after choosing a small route/helper family that does not move framework-owned `services/` shims or worker subapp mounts.
- When debugging live frontend behavior through TE2 console, target the exact generated worker id under the `main_page` label rather than assuming a fixed worker id.

## Current code review

### `main.js`

Baseline at plan creation: roughly 3,700 lines. Re-check the live line count before using size as progress evidence.

It is already partially decomposed. The root file imports many focused modules from `src/host/`, `src/explorer/`, `static/js/`, and `monaco_editor/`, but it still owns several large responsibilities inline:

- host-page boot and runtime assembly
- DOM element capture for the whole app shell
- Explorer RPC connection setup and host-side notification fanout
- editor Socket.IO connection setup, waiters, and host-side event handling
- remaining sidebar shortcut orchestration around the persisted shortcut UI and iframe stack
- toolbar title sizing and mobile filename drag behavior
- diagnostics export UI and write path
- adapter readiness spinner/dropdown glue
- session telemetry wrappers and host active-file state glue
- file websocket setup and open/save/run controller assembly

Important typing state:

- `main.js` is `// @ts-check`, but it is still JavaScript.
- `tsconfig.json` is strict, but it currently excludes `src/host`.
- The existing host modules are therefore build-covered by esbuild, but not fully strict-checked by `npm run typecheck`.
- The next strict work must not simply include all of `src/host` at once unless the task is explicitly scoped to handle that backlog.

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
- initially keep `main.js` as the esbuild host entrypoint, but make it import and delegate to `main_page/` modules
- only switch `build.mjs` from `main.js` to a TypeScript entry after the extracted main-page entry is strict-clean and the runtime has been validated

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
    explorer-rpc-runtime.ts
    editor-socket-runtime.ts
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

1. Keep `build.mjs` host entrypoint as `main.js`.
2. Add `main_page/frontend/` modules for one isolated cluster at a time.
3. Import those modules from `main.js`.
4. Keep the public runtime globals stable:
   - `window.__explorerRpc`
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
   - remaining candidate: extract persisted shortcut collection, active selection, iframe-stack sync, shortcut modal glue, and framework-app shortcut startup from `sidebar_shortcuts.js` only if that work preserves the `/sidebar_ipc` event model
   - removed: Codex appserver socket tracking belonged to the dead in-app agent harness and should not be recreated in the main-page runtime
4. `editor-socket-runtime.ts`
   - editor Socket.IO connection
   - open waiters
   - issues dump waiters
   - editor cache/scroll event handlers
   - reason: important but higher risk because it touches open/save/session state
5. `explorer-rpc-runtime.ts`
   - Explorer RPC connection
   - host-side notification fanout
   - mention request bridge
   - reason: should follow the Explorer transport stabilization, not lead it

### Phase 2: strict TypeScript coverage

1. Add `main_page/frontend/**/*.ts` to `tsconfig.json`.
2. If extracted modules import untyped `src/host` modules and pull them into the strict graph, either:
   - type the directly imported `src/host` modules in the same slice, or
   - keep the extraction in `src/host` and expand strict coverage by a controlled subdirectory.
3. Avoid enabling all of `src/host` in one pass unless the task is explicitly a broad host strict-typing cleanup.
4. Keep `types: []` for browser TS so Node globals do not leak into frontend typing.

### Phase 3: convert the root host entry

Only after the extracted main-page entry is strict-clean:

1. Convert `main.js` to a thin shim or replace it with `main_page/frontend/entry.ts`.
2. Update `build.mjs` host entrypoint.
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

The first frontend slices have already proved the `main_page/frontend/` strict TypeScript pattern. Continue with a small frontend-only slice:

1. Create `main_page/frontend/explorer-rpc-runtime.ts`.
2. Move Explorer RPC connection setup and host-side notification fanout out of `main.js`.
3. Keep `main_page/frontend/**/*.ts` in the strict TypeScript lane without pulling the entire excluded `src/host` backlog into strict checking.
4. Keep `main.js` as the host entrypoint.
5. Rebuild and sync the normal served frontend version surfaces.

Then do a backend-only slice:

1. Create `main_page/backend/state_payload.py`.
2. Move runtime metadata, state payload building, diff-base payload if needed, and path validation helpers.
3. Keep route behavior unchanged.
4. Validate with `py_compile` and targeted `basedpyright`.

This order proves both frontend and backend extraction patterns without touching high-risk transports, app-service shims, or worker subapp mounts.
