# Explorer Frontend TypeScript Decomposition Plan

## Intent

This plan is for the part of the Explorer ask that the user keeps emphasizing:

1. stop treating `static/js/explorer.ts` as the Explorer app
2. move the real Explorer implementation into `src/explorer/`
3. chop the frontend into small TypeScript modules with explicit types
4. leave only a thin entry bridge behind at the served Explorer entrypoint once the cutover is complete

This is **not** a plan to keep wrapping the same large JS file in more helpers. The target is a real frontend module tree.

## Current State Snapshot

Today the Explorer frontend is still dominated by:

- `app/apps/file_editor_cm6/static/js/explorer.ts`
- `app/apps/file_editor_cm6/main.js`
- `app/apps/file_editor_cm6/extensions/sidebar_extension/static/js/sidebar_shortcuts.js`
- a large remaining implementation surface still living in the old JS entrypoint

The first real inward decomposition slice has already happened:

- the old `static/js/explorer_modules/` helper set has been replaced by TS source modules under `app/apps/file_editor_cm6/src/explorer/`
- those former helper boundaries now live under Explorer-owned source folders such as:
  - `src/explorer/chrome/`
  - `src/explorer/git/`
  - `src/explorer/search/`
  - `src/explorer/tree/`
  - `src/explorer/utils/`
- the old JS helper copies are expected to stay deleted once the TS source modules are wired in

The latest inward slice completed the overlay/controller cut and converted the Explorer entrypoint itself to TS:

- file/content/changes/review open behavior now routes through the Explorer-owned `src/explorer/host/file-open-bridge.ts`
- the changes/results and review/results rendering bodies now live in:
  - `src/explorer/search/changes-results-renderer.ts`
  - `src/explorer/search/review-results-renderer.ts`
- `src/explorer/search/results-renderer.ts` now uses that shared Explorer open bridge instead of calling `window.appOpenFileRel(...)` directly
- `src/explorer/search/overlay-controller.ts` now owns the search/review/changes/diagnostics overlay DOM/state orchestration, the typed search controller wiring, and the search/review notification update path
- the served Explorer entrypoint is now `app/apps/file_editor_cm6/static/js/explorer.ts`, not `static/js/explorer.js`
- the stale cross-mode overlay bug is now guarded at the overlay controller boundary: `searchResultsUpdated` payloads no longer force the active mode to flip when they arrive after the user already switched modes
- this slice intentionally pairs decomposition with behavior fixes for the broken search/review open paths instead of treating fixes as a separate non-decomposition track

The next inward slice continued the tree/actions cut:

- `src/explorer/tree/renderer.ts` now owns root/entry rendering and select-mode checkbox wiring
- `src/explorer/tree/menu-controller.ts` now owns the Explorer card menu, mention action, and batch copy/move/stage/unstage/delete flows
- `src/explorer/tree/click-handler.ts` now owns sticky-scope collapse clicks, directory expand/collapse clicks, menu-button clicks, and file-open dispatch
- ordinary Explorer tree file clicks now route through the Explorer-owned file-open bridge instead of direct `window.appOpenFileRel(...)`
- this keeps mention behavior Explorer-owned even though the transport still goes over the backend websocket

The next inward slice completed the notification/state cut:

- `src/explorer/state/runtime-state.ts` now owns the Explorer project/git/rendered-project/reconnect runtime flags that were previously ad hoc top-level state in the served entrypoint
- `src/explorer/tree/decorations.ts` now owns draft/git/diagnostic tree patching plus diagnostics detail/summary derivation
- `src/explorer/rpc/notifications.ts` now owns the Explorer notification-routing switch, including watcher/list/tree/project/git/search/review/pulse handling
- `src/explorer/app/refresh-controller.ts` now owns reconnect recovery and manual refresh button behavior
- `static/js/explorer.ts` now assembles those modules instead of owning the notification/decorations/reconnect cluster inline

The next inward slice completed the bootstrap/git/chrome cut:

- `src/explorer/git/diff-base-controller.ts` now owns diff-base state, editor/backend hydration, the git/search diff-base dropdowns, and diff-base change dispatch
- `src/explorer/chrome/explorer-chrome-controller.ts` now owns project label rendering, drawer/menu wiring, sticky-scope preference application, and open/create project button flows
- `src/explorer/app/public-api.ts` now owns registration of the window-facing Explorer public hooks consumed by `main.js`
- `static/js/explorer.ts` now assembles those modules instead of owning the diff-base/menu/drawer/project/public-hook clusters inline

The final inward slice completed the bootstrap-shell/sticky-scopes cut:

- the remaining Explorer runtime assembly moved into `src/explorer/app/bootstrap.ts`
- `static/js/explorer.ts` is now only a thin `initExplorerUI` re-export shim into the source-tree bootstrap module
- sticky scopes moved from `static/js/explorer_extensions/sticky_scopes.js` into typed `src/explorer/chrome/sticky-scopes.ts`
- this completes the current Explorer frontend decomposition target; future work should be internal cleanup or backend decomposition, not more source-tree extraction

The former helper split that was moved inward covered concerns like:

- `explorer_active_file_utils.js`
- `explorer_diagnostics_renderer.js`
- `explorer_directory_state_utils.js`
- `explorer_git_footer_utils.js`
- `explorer_path_watcher_utils.js`
- `explorer_search_controller.js`
- `explorer_search_overlay_body_renderer.js`
- `explorer_search_results_renderer.js`
- `explorer_search_utils.js`
- `explorer_ui_helpers.js`

The repo already has the first clean destination folder:

- `app/apps/file_editor_cm6/src/explorer/`

Right now that folder contains real Explorer-owned TS code across `chrome/`, `git/`, `host/`, `search/`, `tree/`, and `utils/`, but the typed entrypoint still carries too much direct implementation.

## Non-Goals

- rewriting the entire host shell in one pass
- converting the Monaco iframe in this document
- namespace consolidation across all Socket.IO servers
- pretending that `allowJs: true` means the existing JS surface is already type-safe

## Frontend Rules For This Work

1. All new Explorer feature modules live under `src/explorer/`.
2. All new Explorer app code is TypeScript.
3. No new `any` in transport-facing or state-facing Explorer code.
4. `unknown` is allowed only at the outer wire/DOM boundary and must be parsed immediately.
5. `static/js/explorer.ts` is a temporary bootstrap shell only, not the long-term implementation home.
6. Globals such as `window.__explorerRpc` remain at the host integration edge only.
7. Search, review, diagnostics, tree rendering, git chrome, and drawer state each get their own module families.

## Hard Boundary: Decompose Explorer Inward

This work means moving Explorer behavior:

- **from** `static/js/explorer.ts`
- **from** the old `static/js/explorer_modules/*.js`
- **into** `src/explorer/*.ts`

It does **not** mean satisfying the decomposition goal by relocating Explorer behavior into:

- `main.js`
- `src/host/ui/*`
- `extensions/sidebar_extension/*`
- other non-Explorer host/sidebar modules

Those files may keep bridge glue when necessary, but the feature logic being decomposed must move into Explorer-owned TS modules, not outward into unrelated parts of the app shell.

## Target Frontend Folder Shape

The target is to move Explorer into a real TS app tree:

```text
app/apps/file_editor_cm6/src/explorer/
  app/
    bootstrap.ts
    explorer-app.ts
    dependencies.ts
    public-api.ts
  rpc/
    contract.ts
    client.ts
    methods.ts
    notifications.ts
    parsers.ts
  types/
    entries.ts
    git.ts
    review.ts
    search.ts
    diagnostics.ts
    prefs.ts
    watcher.ts
    projects.ts
  state/
    store.ts
    ui-state.ts
    tree-state.ts
    search-state.ts
    selectors.ts
  tree/
    tree-renderer.ts
    entry-renderer.ts
    directory-controller.ts
    selection-controller.ts
    active-file-controller.ts
    decorations.ts
    watcher-paths.ts
  search/
    overlay-controller.ts
    overlay-body-renderer.ts
    name-results-renderer.ts
    content-results-renderer.ts
    changes-results-renderer.ts
    review-results-renderer.ts
    diagnostics-panel.ts
    search-actions.ts
  git/
    footer-controller.ts
    diff-base-controller.ts
    summary-renderer.ts
  chrome/
    drawer-controller.ts
    menu-controller.ts
    sticky-scopes-controller.ts
    project-label.ts
    toast.ts
  host/
    file-open-bridge.ts
    settings-bridge.ts
    sidebar-bridge.ts
```

`static/js/explorer.ts` should eventually shrink to something like:

```ts
import { mountExplorerApp } from '../../src/explorer/app/bootstrap.ts';

window.initExplorerUI = (deps) => mountExplorerApp(deps);
```

That is the intended end state for the served Explorer entrypoint.

That end state is now implemented: the served `static/js/explorer.ts` file is a thin shim that re-exports `initExplorerUI` from `src/explorer/app/bootstrap.ts`.

## Exact Migration Map

### `static/js/explorer.ts`

Split this file by responsibility, not by arbitrary line count.

| Current concern | Target TS module(s) |
| --- | --- |
| bootstrap / `initExplorerUI` / globals | `app/bootstrap.ts`, `app/public-api.ts` |
| top-level mutable UI state | `state/runtime-state.ts`, later `state/store.ts`, `state/ui-state.ts`, `state/tree-state.ts`, `state/search-state.ts` |
| `handleExplorerNotification(...)` | `rpc/notifications.ts`, later `app/explorer-app.ts` |
| tree rendering | `tree/renderer.ts`, `tree/entry-renderer.ts` |
| active file / draft markers | `tree/active-file-controller.ts`, `tree/decorations.ts` |
| open directory persistence | `tree/directory-controller.ts` |
| batch select mode / card-menu actions / tree click handling | `tree/menu-controller.ts`, `tree/click-handler.ts`, `tree/selection-controller.ts` |
| watcher rel normalization helpers | `tree/watcher-paths.ts` |
| git summary / diff base | `git/summary-renderer.ts`, `git/diff-base-controller.ts`, `git/footer-controller.ts` |
| sticky scopes and explorer menu | `chrome/sticky-scopes.ts`, `chrome/menu-controller.ts`, `chrome/explorer-chrome-controller.ts` |
| toast / mobile drawer behavior | `chrome/toast.ts`, `chrome/drawer-controller.ts`, `chrome/explorer-chrome-controller.ts` |
| search overlay and search mode state | `search/overlay-controller.ts`, `search/search-actions.ts` |
| changes / review / diagnostics panes | `search/changes-results-renderer.ts`, `search/review-results-renderer.ts`, `search/diagnostics-panel.ts` |
| reconnect / manual refresh glue | `app/refresh-controller.ts`, later `app/public-api.ts` |

### Existing helper modules under `static/js/explorer_modules/`

These should not stay as long-lived JS islands. They should either move into `src/explorer/` or disappear into new TS modules:

| Existing file | Target |
| --- | --- |
| `explorer_active_file_utils.js` | `tree/active-file-controller.ts` |
| `explorer_diagnostics_renderer.js` | `search/diagnostics-panel.ts` |
| `explorer_directory_state_utils.js` | `tree/directory-controller.ts` |
| `explorer_git_footer_utils.js` | `git/footer-controller.ts` |
| `explorer_path_watcher_utils.js` | `tree/watcher-paths.ts` |
| `explorer_search_controller.js` | `search/search-actions.ts` |
| `explorer_search_overlay_body_renderer.js` | `search/overlay-body-renderer.ts` |
| `explorer_search_results_renderer.js` | `search/name-results-renderer.ts`, `search/content-results-renderer.ts` |
| `explorer_search_utils.js` | `search/utils.ts` or `git/diff-utils.ts` |
| `explorer_ui_helpers.js` | `chrome/menu-controller.ts` |

## Phased Frontend Execution Plan

### Phase 1 — Create the real Explorer TS app shell

Create:

- `src/explorer/app/bootstrap.ts`
- `src/explorer/app/explorer-app.ts`
- `src/explorer/app/dependencies.ts`
- `src/explorer/app/public-api.ts`
- `src/explorer/state/*`

Deliverable:

- one typed `mountExplorerApp(deps)` entry
- one typed dependency contract for host wiring
- one internal store instead of top-level mutable globals spread across the file

### Phase 2 — Move the transport edge fully into TS

Build:

- `src/explorer/rpc/client.ts`
- `src/explorer/rpc/methods.ts`
- `src/explorer/rpc/notifications.ts`
- `src/explorer/rpc/parsers.ts`

Rules:

- `explorer.js` does not manually switch on notification strings anymore
- `explorer.js` does not perform ad hoc RPC availability checks anymore
- notification parsing and method naming happen in TS, once

### Phase 3 — Move tree rendering into TS

Extract:

- `renderExplorerTree`
- `renderEntriesInto`
- entry action wiring
- active-file marker logic
- directory open/close logic
- selection mode logic

Target modules:

- `tree/tree-renderer.ts`
- `tree/entry-renderer.ts`
- `tree/directory-controller.ts`
- `tree/selection-controller.ts`
- `tree/active-file-controller.ts`
- `tree/decorations.ts`

This is the first real reduction of `explorer.js`.

### Phase 2.5 — Move the existing Explorer helper boundaries into `src/explorer/`

This is the slice that has to happen before the full entrypoint move is comfortable:

- port the old `static/js/explorer_modules/*.js` files into typed `src/explorer/*.ts` modules
- delete the old JS helper copies once the new TS imports are live
- keep the same Explorer-owned boundaries, just in the right source tree and the right language

This phase is explicitly **inward decomposition**, not host/sidebar cleanup.

### Phase 4 — Move search / review / diagnostics into TS

Extract the overlay family as its own domain:

- overlay state
- search scheduling
- results rendering
- review actions
- diagnostics panel wiring

Target modules:

- `search/overlay-controller.ts`
- `search/search-actions.ts`
- `search/name-results-renderer.ts`
- `search/content-results-renderer.ts`
- `search/changes-results-renderer.ts`
- `search/review-results-renderer.ts`
- `search/diagnostics-panel.ts`

### Phase 5 — Move git and chrome UI into TS

Extract:

- diff-base dropdown
- git summary / progress UI
- explorer menu
- sticky scopes
- toast/mobile drawer glue

Target modules:

- `git/*`
- `chrome/*`

### Phase 6 — Replace the old JS entry with a thin bridge

At this point:

- `static/js/explorer.js` becomes a thin compatibility bootstrap
- most existing helper modules are deleted or replaced with TS imports
- the real Explorer implementation lives in `src/explorer/`

### Phase 7 — Tighten frontend typing around the Explorer path

After the TS split is real:

1. remove any remaining Explorer-specific `// @ts-nocheck`
2. add explicit interfaces for host deps and renderer models
3. narrow remaining legacy JS adapters
4. consider whether the Explorer surface can flip from “TS modules consumed by JS” to “TS owns the entrypoint”

## Required Type Surfaces

The frontend split is incomplete unless these types exist explicitly:

- tree entry types
- git summary / git status row types
- review entry types
- search result row types
- diagnostics summary/detail types
- watcher config / watcher file event types
- project list / project open result types
- extension manager list / config schema types
- Explorer host dependency interface
- Explorer public API interface

These types should live in `src/explorer/types/`, not inline across random files.

## Host Integration Boundary

The Explorer app should not directly own arbitrary globals. The host boundary should be narrowed to a typed dependency object supplied from `main.js`.

That dependency object should cover:

- RPC request/notify access
- file-open bridge
- drawer/mobile control
- toast sink
- sidebar integration hooks
- settings refresh hooks only where necessary

`main.js` should become a host adapter, not the place where Explorer behavior is implemented.

## Exit Criteria

This frontend plan is complete only when all of the following are true:

1. the real Explorer app lives under `src/explorer/`
2. `static/js/explorer.js` is a thin bootstrap, not the implementation center
3. search/review/diagnostics/tree/git/menu logic are split into separate TS modules
4. Explorer transport parsing and notification routing happen in TS modules, not ad hoc in the JS entry
5. new Explorer code does not introduce `any`
6. existing helper JS modules are either deleted or replaced by TS equivalents

## Relationship To The Other Two Explorer Docs

- RPC method vocabulary and wire migration live in `EXPLORER_RPC_CONTRACT_AND_CUTOVER_PLAN.md`
- backend package split and Python typing live in `EXPLORER_BACKEND_DECOMPOSITION_AND_TYPING_PLAN.md`

This document is only about turning the Explorer frontend into a real, typed module tree.
