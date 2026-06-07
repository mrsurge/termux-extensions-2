# TE2 Sidebar Stateful App Windows North Star

## Status

Active implementation tracker for the first stateful sidebar app/window POC.

Current status: partial working model. Framework-level app/backend readiness, `file_explorer` backend-to-backend state publication, ledger-backed app dock slots, non-stateful launcher slots, numeric dock debug mode, ledger-backed URL slot cleanup, persisted dock/icon ordering, and backend `sidebar.window.focused` notifications for stateful app slots are in place in the working tree. The current launcher/app drawer UI is acceptable for now until the user chooses a later UX direction. The next planned stateful app slice is Terminal shell-state mapping, where a sidebar Terminal slot can restore/focus a specific `shell_id` and reset itself to the base Terminal URL when that shell is dead. URL slot behavior, focused-window notifications, and dock reorder behavior still need live validation after the current frontend bundle is rebuilt and loaded.

This document is the progress tracker. Update this section whenever a slice lands or a gap is found.

## Progress Tracker

### Done In Current Working Tree

- [x] Add `/api/apps/{app_id}/readiness` endpoint with required `status`, accepted statuses, app-lifecycle storage, catalog/running readiness exposure, and no sidebar/window coupling.
- [x] Inject reliable `TE_FRAMEWORK_URL` into app-worker environments.
- [x] Preserve `sidebar_state` capability blocks through manifest registry/catalog paths.
- [x] Add `file_explorer` `sidebar_state` manifest capability with path-state metadata, token params, and console-worker-id param.
- [x] Add a framework static console bridge asset at `/static/js/te2_console_bridge.js` and wire `file_explorer` to use it with `workerLabel: "file_explorer"` plus stateful inherited `workerId` when `te2_console_worker_id` is present.
- [x] Add backend sidebar window ledger module storing slots in `sidebarWindowState`, keyed by `host_id`, with app lane metadata, token/console ids, opaque URL string, readiness, order, and active host id.
- [x] Add typed `/sidebar_ipc` methods for `sidebar.launcher.catalog.get`, `sidebar.windows.list`, `sidebar.window.create`, `sidebar.window.openUrl`, `sidebar.window.state.update`, `sidebar.window.activate`, `sidebar.window.close`, and `sidebar.window.readiness.update`.
- [x] Add UI IPC request methods for host/sidebar frontend control: `ui.sidebar.window.create`, `ui.sidebar.window.activate`, `ui.sidebar.window.close`, `ui.sidebar.window.order.update`, and `ui.sidebar.activeShortcut.set`.
- [x] Add UI IPC notifications for sidebar frontend apply/readiness: `ui.sidebar.windows.changed`, `ui.sidebar.window.activated`, and `ui.sidebar.window.readiness.changed`.
- [x] Add `file_explorer` backend endpoint `POST /api/app/file_explorer/sidebar/window/state` with `/sidebar/window/open_url` compatibility alias; it accepts app-owned `path`/query-state data from the frontend, validates the path, marks `state_kind: "path"`, and calls `sidebar.window.state.update` over `/sidebar_ipc`.
- [x] Make `file_explorer` stateful mode read `te2_host_id`, `te2_token_id`, and `te2_console_worker_id`; when `te2_host_id` is present, saved app-shell path is not the sidebar restoration authority.
- [x] Post the minimum readiness requirement to the agent log.
- [x] Rebuild affected `file_editor_cm6` frontend bundle after the current sidebar runtime edits.
- [x] Expand backend launcher/window creation so non-stateful launcher apps create/focus ledger-backed app dock slots that load manifest/catalog base URL without token/console URL-state fields.
- [x] Refactor sidebar frontend behavior to render launcher, ledger-backed app dock entries, and plain URL entries separately while preserving temporary compatibility names.
- [x] Make launcher-opened stateful apps and non-stateful apps share dock focus/activate/close behavior; stateful entries still carry token/console/readiness semantics.
- [x] Add numeric dock debug flag `te2_sidebar_dock_numbers` for replacing dock icons with slot numbers.
- [x] Buffer one-shot sidebar window ledger notifications until the sidebar runtime has bound its frontend event listener, then replay them so reload restore does not lose the backend ledger during boot ordering.
- [x] Make `sidebar.window.openUrl` non-activating by default and preserve existing slot readiness unless an app backend explicitly sends a readiness update.
- [x] Make `file_explorer` state publishes update the stored restore URL/query-state and title without resetting readiness to `starting`; normal path changes should go straight to the page and not show the app-readiness placeholder.
- [x] Document that multiple sidebar windows of the same app are required: `app_id` is only the app lane, `host_id` is the durable window identity, and state/query tracking is per `host_id`.
- [x] Mint fresh `host_id` / concrete console-worker identity for new stateful same-app slots so the dock can track multiple states of the same app simultaneously.
- [x] Preserve existing concrete console worker identity when a state update targets an existing `host_id` but omits `console_worker_id`.
- [x] Bump served `file_editor_cm6` version surfaces to `0.2.257` so the rebuilt host bundle is fetched.
- [x] Add app-author usage guide at `docs/apps/code_cm6/STATEFUL_SIDEBAR_APPS.md`.
- [x] Bump served `file_editor_cm6` version surfaces to `0.2.260` for the commit-ready slice.
- [x] Document that `sidebar_state` makes an app stateful-capable only; normal `/app/<app_id>` access, including normal deep-link query params, does not enter sidebar-stateful behavior unless TE2 slot identity such as `te2_host_id` is present.
- [x] Move backend-readiness waiting to the framework `/app/{app_id}` shell; Code TE2 sidebar no longer blocks iframe display on stateful slot readiness.
- [x] Make app worker startup/register lifecycle `starting` without blocking on shellspec readiness probe timeouts; app backends transition to `ready` through app-level readiness POST.
- [x] Accept the current header-menu launcher/app drawer UI for now. It works as the temporary launcher surface until the user chooses a later UX direction.
- [x] Replace the legacy shortcut modal behind the `URL` item with a real JavaScript URL dialog. The visible launcher/dropdown label is `URL`; the dialog creates/updates a `kind: "url"` slot in `sidebarWindowState`, stores URL state on that slot, and the active URL slot menu exposes close/change-URL actions.
- [x] Bump served `file_editor_cm6` version surfaces to `0.2.262` for the ledger-backed URL slot fix.
- [x] Add backend `sidebar.window.focused` notifications for stateful slots. Persistent app backends can register on `/sidebar_ipc` with `app`, `app_id`, or `appId` and receive the focused slot's `host_id`, restore URL, query state, token id, and console worker id through the app-specific room.
- [x] Bump served `file_editor_cm6` version surfaces to `0.2.263` for the focused-window notification slice.
- [x] Persist dock/icon-bar drag ordering through the existing `sidebarWindowState.order` ledger using UI IPC method `ui.sidebar.window.order.update`; the previous drag code only tried to reorder legacy shortcut preferences.
- [x] Bump served `file_editor_cm6` version surfaces to `0.2.264` for the persisted dock order slice.

### Partially Done / Must Be Finished

- [ ] Add Terminal shell-state support as the second stateful app type: map `shell_id` query state to a Terminal backend shell, and reset the sidebar slot to the base Terminal URL when the requested shell is dead or missing.
- [x] Stop letting the old shortcut-first model define sidebar behavior. Existing `agent*` DOM ids and preference keys may remain only as compatibility names.
- [x] Tighten the dock-control RPC boundary so frontend host create/activate/close/active-selection controls use UI IPC only; `/sidebar_ipc` remains the backend app API lane for app backends declaring app data and requested URLs.
- [x] Preserve the existing `/sidebar_ipc` systems that share sidebar UI space, including ALS-RS/chat edit/agent file-open semantics; do not retire or repurpose them for the new dock view-control semantics.
- [x] Add standard framework-app backend readiness publication at the app worker serving point, while preserving custom backend hooks for apps that need special readiness.
- [x] Equip non-stateful framework apps with minimum app/backend readiness support without making them stateful. Proxy/shim apps still publish readiness from the backend/upstream point that actually serves their frontend/content.
- [ ] Investigate and decide app lifecycle retention semantics only if source/runtime behavior shows a real cleanup conflict. The open question is whether an existing sidebar iframe slot should prevent app lifecycle cleanup for that app. This is not a current implementation requirement and should not be treated as settled behavior without source-backed evidence.

### Validated In Live TE2

- [x] `file_explorer` full-page load returns 200 for `/app/file_explorer`.
- [x] `/app/file_explorer?embed=1&path=/tmp` returns 200 in ordinary embedded mode.
- [x] `/app/file_explorer?embed=1&te2_host_id=...&te2_token_id=file_explorer&path=/tmp` returns 200 in sidebar-stateful query mode.
- [x] Normal File Explorer access and normal path deep links do not publish sidebar restore checkpoints because `file_explorer` stateful publication is gated by `te2_host_id`.
- [x] Reloading the host/sidebar restores app dock slots from the sidebar ledger, not guest localStorage or app-shell state.
- [x] Non-capable apps opened from the launcher create/focus dock ledger slots and load the manifest/catalog base URL. Before the planned Terminal shell-state slice, `terminal` was validated as `slot:terminal:base` with no token/console URL-state fields.
- [x] `file_explorer` backend state publication updates stored restore URL/query-state/title over the sidebar ledger while preserving the current active dock slot.
- [x] `file_explorer` state publication preserves existing ready readiness and does not reset the slot to `starting`.
- [x] Backend RPC validation created two simultaneous `file_explorer` slots with the same `app_id` and distinct `host_id` values.
- [x] Backend RPC validation showed `sidebar.window.state.update` can update one slot's stored restore URL/query-state while preserving that slot's live iframe URL.
- [x] Frontend live DOM validation showed the dock consuming ledger slots as separate icon entries and iframes; validation slots were cleaned up after the check.
- [x] Numeric dock debug mode can replace icons with slot numbers for order/identity inspection.
- [x] `/api/apps/catalog` and `/api/apps` expose `file_explorer.sidebar_state`; apps without stateful capability do not expose a stateful capability block. Terminal is planned to gain its own `shell_id` capability in the next slice.
- [x] Approved live TE2 validation was run by restarting only affected app workers, not unrelated builtins.

### Not Yet Validated

- [ ] Plain URL slots need live second-client validation after the ledger-backed URL fix: create, second-client restore/load, change URL, and close must all flow through `sidebarWindowState`.
- [ ] `sidebar.window.focused` needs live validation with a persistent stateful app backend connection. Expected behavior: focusing an existing stateful dock slot emits one app-room notification with that slot's current `host_id`, `query_state`, `restore_url`, token id, and console worker id; non-stateful app slots and URL slots do not emit this notification.
- [ ] Dock/icon-bar reordering needs live validation after bundle reload: dragging app dock slots or URL slots should update `sidebarWindowState.order`, survive reload, and appear in the same order in a second client.

## Purpose

The sidebar should stop treating every embedded surface as a stateless shortcut.

The target system is:

- a launcher/app drawer entry that is always present in the sidebar icon bar
- durable sidebar app dock slots keyed by `host_id`
- app lanes defined by manifest app id plus manifest base URL
- multiple active or retained windows for the same app id, each with its own `host_id`, dock identity, console worker id, readiness, and stored state
- launcher-opened non-stateful apps tracked as dock/ledger slots that load the manifest/catalog base URL
- stateful launch identity carried by a token query parameter whose value is the manifest-defined console worker prefix for that app lane
- app-owned stateful query/state stored by the sidebar ledger, not inferred by scraping iframe URLs
- backend-to-backend sidebar state updates: guest/app backends send app lane data plus per-`host_id` query/state; UI IPC updates sidebar chrome/metadata without reloading live iframes for ordinary state changes
- app-declared capability for stateful sidebar behavior
- plain URL slots kept as intentional user-configured URL entries, separate from launcher-created non-stateful app slots
- a standard app readiness POST that app backends call when they are semantically ready, not merely when their TCP port opens

`app/apps/file_explorer` is the first reference app for this system.

## Initial POC Facts

These were the facts before the first implementation attempt. Treat them as planning inputs, not guaranteed current source state.

`file_explorer` is a good POC because it has path-based state and originally lacked every new integration surface:

- It does not install the TE2 console bridge or expose a durable console identity.
- It does not have a typed `/sidebar_ipc` backend client.
- It does not have any Socket.IO backend client today.
- It does not call a backend readiness API today.
- It already accepts path state through the `path` query parameter in `app/apps/file_explorer/main.js`.
- It also falls back to app-shell state through `host.loadState(...)` / `host.saveState(...)`, which is useful for full-page app-shell behavior but should not be the sidebar state authority for stateful sidebar app windows.

Relevant current files:

- `app/apps/file_explorer/manifest.json`
- `app/apps/file_explorer/main.js`
- `app/apps/file_explorer/file_explorer.py`
- `app/apps/file_explorer/shellspec/app_worker.yaml`
- `app/apps/file_editor_cm6/main_page/frontend/sidebar-shortcuts/runtime.ts`
- `app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py`
- `app/apps/file_editor_cm6/src/sidebar_ipc/rpc_contract.ts`
- `app/apps/file_editor_cm6/ui_ipc/sidebar_rpc_contract.py`
- `app/extensions/apps/main.py`
- `app/extensions/apps/registry.py`
- `app/extensions/apps/runtime.py`
- `app/templates/app_shell.html`

## Vocabulary

`launcher`

The fixed sidebar icon-bar entry that opens the app drawer. It is not a user app slot. The current header-menu launcher UI is acceptable for now. URL entry creation is a separate intentional control and is not part of the app drawer's core app-launch contract.

`app dock slot`

A durable sidebar slot for one launched app instance. It has a sidebar-owned `host_id`, app lane data, an active/focused state, readiness state when available, and a URL to load. Non-stateful slots load the manifest/catalog base URL. Stateful slots are app dock slots with additional URL-state semantics.

`app dock slot` identity is always `host_id`, not `app_id`. Multiple slots may have the same `app_id` and different state. For example, two File Explorer slots can both be `app_id: "file_explorer"` while one stores `path=/tmp` and another stores `path=/data/data/com.termux/files/home`.

`URL slot`

An intentional user-created sidebar slot whose state is a URL string. It is first-class URL behavior, separate from launcher-created app dock slots and separate from stateful app windows.

The old shortcut modal is legacy implementation detail. The target is a JavaScript URL dialog, not a native browser prompt/modal. The dialog lets the user type a URL, creates or updates a `kind: "url"` slot in `sidebarWindowState`, and stores that URL as the slot's state. Each URL slot should expose a custom dropdown for close and change-URL actions.

`stateful app window`

A specialized app dock slot for one stateful app instance. It has a sidebar-owned `host_id`, manifest lane data, a `token_id`, and a last known opaque state URL declared by the app backend.

`app lane`

The manifest-defined app identity that the sidebar backend validates before accepting stateful app commands. The minimum lane is `app_id` plus the manifest/catalog `base_url`. The lane may also include the stateful console worker prefix used as the launch token.

The app lane is not a sidebar window identity. It answers "which app is this?", not "which window/slot is this?" Every mutable state update must still name a `host_id`.

`token_id`

The app instance token carried in the stateful app URL query string. For this system the token value is the console worker prefix declared by the app manifest/catalog for the app lane. Opening the app base URL with this token puts the app into sidebar-stateful mode and causes the TE2 console bridge/`file_editor_cm6` host to track that app instance under the token/console lane.

`console_worker_id`

The exact TE2 console worker id for one stateful frontend instance. Normal app frontends generate their own console identity with the console bridge's per-window behavior. Stateful sidebar launches are different: the `file_editor_cm6` sidebar host creates a concrete id from the manifest-defined console worker prefix, passes it in the launch URL, and the guest frontend inherits it as its exact console bridge `workerId`.

`host_id`

The sidebar-owned slot id passed into app URLs as a query parameter. It is the durable key for the sidebar slot and iframe. It is not the app lane and it is not the app's internal route token.

`host_id` is the only durable identity for one sidebar app window. It must be unique per opened window, including when multiple windows belong to the same `app_id`.

`state URL`

An opaque same-origin URL the sidebar host should load into the iframe for a slot. For the `file_explorer` POC this URL carries a file path query parameter. The sidebar stores the URL string and does not parse file path semantics beyond basic same-origin and app-id validation.

Target direction: normal live app navigation should not require the host to reload the iframe. A running app should publish the app-owned query/state that represents the state it just entered, and TE2 should store that state for the `host_id`. TE2 reconstructs the full iframe URL from manifest base URL plus TE2 identity params plus stored query/state on cold load, restore, or explicit host navigation.

`backend-to-backend open URL`

The app frontend may decide which query/state represents its current state, but it does not mutate the sidebar ledger or host iframe directly. The app frontend sends its state to its own backend. The app backend then calls the sidebar RPC backend with the app lane, host slot identity, and the app-owned query/state to persist. The sidebar RPC backend stores that state for restore. It should not reload the live iframe for ordinary in-app state changes.

`semantic readiness`

The app backend has reached the point where its state URL can be used. This is different from shellspec TCP readiness.

## RPC Boundary Invariants

These invariants apply to the `file_editor_cm6` sidebar host and to every stateful sidebar app.

### UI IPC RPC

UI IPC RPC owns sidebar frontend updates.

Responsibilities:

- send sidebar UI update commands to the `file_editor_cm6` frontend
- apply validated ledger changes to the sidebar frontend, including create/restore URL application when an iframe must be loaded
- reflect sidebar backend ledger changes into visible sidebar chrome, icons, placeholders, active iframe state, and readiness display
- persist host/sidebar chrome state such as dock/icon order through the backend ledger when the user reorders slots

Rules:

- UI IPC RPC is not the app API lane.
- UI IPC RPC does not accept stateful app navigation requests directly from app frontends.
- UI IPC RPC applies already-validated sidebar state from the `file_editor_cm6` backend/sidebar host to the sidebar frontend.
- UI IPC RPC may update sidebar host chrome state such as `sidebarWindowState.order`; this is not app-owned route state.

### Sidebar IPC RPC

Sidebar IPC RPC is the backend-only app API lane for stateful sidebar apps.

Responsibilities:

- accept API commands sent by sidebar app backends
- validate the manifest-defined app lane: `app_id`, `base_url`, and stateful token/console prefix
- accept the backend-declared URL that the sidebar host should persist and open
- update the durable sidebar ledger for the target `host_id`
- publish the resulting ledger/UI command so UI IPC can update the sidebar frontend

Rules:

- Sidebar IPC RPC is backend-only for this system.
- The app frontend must not call `/sidebar_ipc` directly for the first POC.
- The app frontend may construct the state URL from the user action, current route, and token/console identity.
- The app frontend must POST/PUT that state to its own app backend.
- The app backend must send the app lane, `host_id`, `token_id`, optional concrete `console_worker_id`, and exact URL to the sidebar RPC backend.
- Sidebar IPC RPC must not parse app route semantics. For `file_explorer`, it may validate that the URL belongs to the `file_explorer` base URL, but it must not own the meaning of `path`.
- UI IPC RPC, not Sidebar IPC RPC, is the layer that controls the sidebar frontend.

## Capability Declaration

Apps that support stateful sidebar windows must declare it in `manifest.json`.

Proposed manifest shape:

```json
{
  "id": "file_explorer",
  "sidebar_state": {
    "enabled": true,
    "reference": true,
    "kind": "path",
    "launcher": true,
    "base_url": "/app/file_explorer",
    "token_source": "console_worker_id",
    "console_worker_prefix": "file_explorer",
    "host_id_param": "te2_host_id",
    "token_id_param": "te2_token_id",
    "console_worker_id_param": "te2_console_worker_id",
    "url_state": {
      "param": "path",
      "opaque": true,
      "default_path": "~"
    },
    "load": {
      "default": "eager"
    }
  }
}
```

Rules:

- The app registry must preserve and expose this block through `/api/apps` and `/api/apps/catalog`.
- The catalog entry for a stateful app must expose the app lane: `app_id`/`id`, `base_url`, token query parameter, and console worker prefix.
- Non-capable apps do not get stateful URL-state behavior.
- Non-capable apps opened from the launcher still become app dock slots, but those slots load only the manifest/catalog base URL and have no token/console lane.
- Plain URL slots remain intentional user-configured URL entries, not the normal launcher-created app slot model.
- The `file_explorer` POC should set `reference: true` so future app authors can inspect it as the canonical example.

## Sidebar Ledger

The sidebar ledger should be durable and framework/app-owned, not a volatile frontend map.

The first implementation may store it in the same durable framework state family used for app/sidebar preferences, but it must be exposed through typed sidebar RPC rather than through generic app-shell `teState` keys.

Proposed shape:

```json
{
  "active_host_id": "slot:file_explorer:file_explorer_a1b2",
  "order": [
    "launcher",
    "slot:file_explorer:file_explorer_a1b2",
    "slot:file_explorer:file_explorer_c9d0",
    "slot:terminal:base_c3d4",
    "url:local-docs"
  ],
  "slots": {
    "slot:file_explorer:file_explorer_a1b2": {
      "kind": "app",
      "app_id": "file_explorer",
      "base_url": "/app/file_explorer",
      "token_id": "file_explorer",
      "console_worker_prefix": "file_explorer",
      "console_worker_id": "file_explorer:a1b2",
      "host_id": "slot:file_explorer:file_explorer_a1b2",
      "title": "File Explorer",
      "url": "/app/file_explorer?embed=1&te2_host_id=slot%3Afile_explorer%3Afile_explorer_a1b2&te2_token_id=file_explorer&path=%2Fdata%2Fdata%2Fcom.termux%2Ffiles%2Fhome",
      "load": "eager",
      "readiness": {
        "status": "starting",
        "phase": "app_worker",
        "message": "",
        "updated_at": 1770000000000
      },
      "updated_at": 1770000000000
    },
    "slot:file_explorer:file_explorer_c9d0": {
      "kind": "app",
      "app_id": "file_explorer",
      "base_url": "/app/file_explorer",
      "token_id": "file_explorer",
      "console_worker_prefix": "file_explorer",
      "console_worker_id": "file_explorer:c9d0",
      "host_id": "slot:file_explorer:file_explorer_c9d0",
      "title": "/tmp",
      "query_state": {
        "path": "/tmp"
      },
      "url": "/app/file_explorer?embed=1&te2_host_id=slot%3Afile_explorer%3Afile_explorer_c9d0&te2_token_id=file_explorer&path=%2Ftmp",
      "load": "eager",
      "readiness": {
        "status": "ready",
        "phase": "window_state_ready",
        "updated_at": 1770000000000
      },
      "updated_at": 1770000000000
    },
    "slot:terminal:base_c3d4": {
      "kind": "app",
      "app_id": "terminal",
      "base_url": "/app/terminal",
      "host_id": "slot:terminal:base_c3d4",
      "title": "Terminal",
      "url": "/app/terminal",
      "load": "lazy",
      "updated_at": 1770000000000
    }
  }
}
```

Rules:

- The launcher entry is not a slot and has no app id.
- App dock entries stay `kind: "app"` and must be keyed by `host_id`.
- `app_id` must never be used as the dock/window key. It is valid and required for multiple slots to share one `app_id`.
- Any create/open/focus behavior that wants a new stateful app window must mint a fresh `host_id` and concrete `console_worker_id`; otherwise it is focusing or updating an existing window.
- Any state update from an app backend must target exactly one `host_id`. If it only names `app_id`, it is ambiguous and must be rejected or treated as a request to create a new window, depending on the method.
- Non-stateful app dock slots carry `app_id`, manifest/catalog `base_url`, the base URL to load, and no `token_id` or `console_worker_id`.
- Plain URL entries stay `kind: "url"` in `sidebarWindowState` and do not require app id, token id, console worker id, or readiness. They are separate from launcher-created app dock slots and must not depend on `agentShortcuts` or per-client active-shortcut state for cross-client restore.
- Stateful app slots are app dock slots with tracked query/state.
- Dock/icon order is the `order` array in `sidebarWindowState`. User reordering must write that array through UI IPC with `launcher` fixed first, existing slot ids preserved, and any omitted live slots appended by the backend.
- `app_id` plus manifest/catalog `base_url` defines the app lane.
- `token_id` is the stateful app token carried in the app URL query string; for this system it starts from the manifest-defined console worker prefix.
- `console_worker_id` is separate from `token_id`. It is the concrete console bridge worker id that the host assigns for a stateful slot and passes to the guest through the manifest-defined console worker id query parameter.
- The app-owned query/state is opaque to the sidebar state store. The store validates that it belongs to the declared app lane, then persists that state for the target `host_id`.
- The sidebar host is the durable restore authority. It remembers the last query/state for each `host_id` and reconstructs iframe URLs from manifest base URL plus TE2 identity params plus stored app query/state on restore.
- The sidebar host must not parse or own guest-specific query-string semantics such as `path`, `conversation_id`, `view`, or future app-specific tokens.
- App backends must declare the state the app window entered. For ordinary in-app navigation, the sidebar backend validates the app lane and host slot, stores the query/state, and publishes chrome/readiness metadata without reloading the live iframe.
- Full URL/open application is only for create, cold load, restore, or explicit host-driven navigation. It is not the normal path for every state change.
- The sidebar must eagerly create/load iframe entries for app dock slots whose `load` is `eager`.
- Existing shortcut preferences should not be silently treated as app dock slots. If migration is needed, migrate them into explicit URL slots. Launcher-created app dock slots remain a distinct model.

## Sidebar IPC RPC Contract

Extend `/sidebar_ipc` with backend-only methods stateful apps use to declare per-window app state.

`/sidebar_ipc` is a backend-only control lane for stateful app windows. It takes app data and requested query/state from an app backend. It is not a frontend shortcut API and it is not the guest app's internal router.

Launcher-created non-stateful app dock slots are not `/sidebar_ipc` URL-state commands. They are host/sidebar UI operations that create or focus an app dock slot and load the manifest/catalog base URL.

The flow is:

```text
guest frontend enters a new app state
guest frontend derives the query/state that can reproduce that state
guest frontend sends state to its own app backend
app backend calls sidebar RPC backend with app_id/base_url, host_id, token_id/console_worker_id, and query/state
sidebar RPC backend validates and persists that state for the target host_id
UI IPC/sidebar host updates dock chrome/metadata without reloading the live iframe
later cold restore constructs the iframe URL from manifest base URL + TE2 params + stored query/state
```

The app backend has to declare the app-owned state the window just entered. The sidebar host stores that state for restore; it does not interpret app-specific query parameters.

Proposed request methods:

```text
sidebar.windows.list
sidebar.window.create
sidebar.window.activate
sidebar.window.close
sidebar.window.openUrl
sidebar.window.state.update
sidebar.window.readiness.update
sidebar.launcher.catalog.get
```

`sidebar.window.state.update` is the normal backend-to-backend state checkpoint primitive for in-app state changes. `sidebar.window.openUrl` remains as a compatibility alias and must keep the same non-activating, readiness-preserving, no-live-iframe-reload behavior unless the caller explicitly asks for host navigation.

Proposed server notifications:

```text
sidebar.windows.changed
sidebar.window.activated
sidebar.window.readiness.changed
```

Minimum request payloads:

`sidebar.window.create`

```json
{
  "app_id": "file_explorer",
  "base_url": "/app/file_explorer",
  "host_id": "slot:file_explorer:file_explorer_a1b2",
  "token_id": "file_explorer",
  "url": "/app/file_explorer?embed=1&te2_host_id=slot%3Afile_explorer%3Afile_explorer_a1b2&te2_token_id=file_explorer",
  "title": "File Explorer",
  "load": "eager",
  "source": "launcher"
}
```

`sidebar.window.create` creates a host slot and initial iframe URL from the manifest-defined app lane. It must not invent app route state. For `file_explorer`, directory state is only added later when the `file_explorer` frontend handles a directory link and posts that URL to its own backend.

`sidebar.window.state.update`

```json
{
  "lane": {
    "app_id": "file_explorer",
    "base_url": "/app/file_explorer"
  },
  "host_id": "slot:file_explorer:file_explorer_a1b2",
  "token_id": "file_explorer",
  "console_worker_id": "file_explorer:a1b2",
  "query_state": {
    "path": "/tmp"
  },
  "state_kind": "path",
  "title": "/tmp",
  "source": "file_explorer_backend"
}
```

`sidebar.window.state.update` is the target backend-to-backend primitive for the `file_explorer` POC. The payload means: for this app lane and host slot, persist this app-owned query/state as the restore state. The sidebar backend may validate that the query/state is allowed for the declared app lane, but it must not own the app meaning of `path` or any other app query string. It must not reload the live iframe as part of this ordinary state update.

Compatibility note: `sidebar.window.openUrl` may remain as an alias for older callers, but normal app-state publication should use `sidebar.window.state.update` semantics: non-activating, readiness-preserving, and no live iframe reload unless the caller explicitly asks for host navigation.

`sidebar.window.readiness.update`

```json
{
  "app_id": "file_explorer",
  "host_id": "slot:file_explorer:file_explorer_a1b2",
  "token_id": "file_explorer",
  "console_worker_id": "file_explorer:a1b2",
  "status": "ready",
  "phase": "window_state_ready",
  "url": "/app/file_explorer?embed=1&te2_host_id=slot%3Afile_explorer%3Afile_explorer_a1b2&te2_token_id=file_explorer&path=%2Ftmp",
  "message": "",
  "source": "file_explorer_backend"
}
```

Rules:

- Guest apps should not use `postMessage` for state/query updates.
- Guest frontend code should send state changes to its own backend when backend mediation is available.
- The app backend should call `/sidebar_ipc` with the app-owned query/state it wants stored for the target `host_id`; TE2 should update the ledger and sidebar chrome from that backend-owned signal without reloading the live iframe.
- UI IPC controls the sidebar frontend. `/sidebar_ipc` remains the backend RPC boundary that accepts app data and requested query/state.
- Direct frontend calls to `/sidebar_ipc` are out of scope for this system. The invariant for stateful sidebar apps is backend-only Sidebar IPC RPC.

## Standard App Readiness POST

The framework owns app/backend readiness at the app extension level. This is
not a Code TE2 sidebar concept and it is not a stateful-window checkpoint.

App worker launch/register puts app lifecycle readiness into `starting`.
The launcher must not fail or time out just because a shellspec readiness probe
has not passed yet; compile-heavy apps can take minutes. The framework
`/app/{app_id}` shell owns the backend-readiness placeholder and waits on app
lifecycle readiness without a fixed timeout.

The app backend publishes readiness when it is actually ready for the app
contract:

- Normal framework apps are ready when the backend module is imported, routes
  are mounted, lifespans are active, and the backend can accept app API
  requests. The standard `app.libs.app_worker` path posts readiness at that
  backend-serving point unless the app provides its own backend-serving hook.
- Proxy/shim apps are ready only when the proxied/upstream backend that owns
  the frontend is actually serving that frontend/content. They should post or
  put readiness from that backend/upstream readiness point, not from the
  framework shell timeout.

Endpoint:

```http
POST /api/apps/{app_id}/readiness
Content-Type: application/json
```

`PUT /api/apps/{app_id}/readiness` has the same semantics.

Minimum payload for any app:

```json
{
  "status": "ready"
}
```

Do not include `host_id`, `token_id`, `console_worker_id`, `url`, `path`, or
conversation state in this POST. Those are window/app state concerns.

Allowed statuses:

```text
starting
ready
error
stopped
```

Rules:

- `status` is required.
- The app id in the readiness endpoint URL path segment is authoritative. A body-level app id may be accepted for diagnostics only but must not override the endpoint path segment.
- The endpoint updates app lifecycle readiness state and publishes app registry notifications.
- A running backend with no posted readiness is treated as `starting`, not `stopped`.
- App lifecycle registration must not overwrite an already-posted `ready` state back to `starting`.
- Shellspec TCP readiness is only a process/probe detail. It must not be the semantic app readiness gate.
- App workers should receive a reliable `TE_FRAMEWORK_URL` environment value so they can call this endpoint from their backend process.
- App-level readiness stays ready for the lifetime of the running app worker/process.
- This endpoint must not import `file_editor_cm6` or mirror into the sidebar window ledger.

Why this matters for stateful sidebar apps:

- The iframe/frontend is not the authority for restorable state. The app backend
  validates and normalizes state and sends the canonical
  `sidebar.window.state.update` request to the sidebar ledger.
- If a stateful app slot appears before backend readiness, the dock can show an
  active window whose restore/checkpoint lane cannot actually accept requests.
  That creates missed checkpoints, failed restore updates, and unnecessary
  iframe/page thrash while the backend is still compiling or starting.
- App readiness gates the backend contract; per-window state and optional
  slot-local readiness remain separate sidebar-window data.

Readback endpoint:

```http
GET /api/apps/{app_id}/readiness
```

Slot/window state and optional slot-local readiness stay separate:

- `sidebar.window.state.update` stores per-`host_id` app-owned restore state.
- `sidebar.window.readiness.update` is optional slot-local status metadata.
- Neither one is required to clear the framework app/backend readiness placeholder.

Agent-log handoff text before later test execution:

```text
[TE2] Minimum app readiness requirement: app backends POST or PUT to /api/apps/{app_id}/readiness when the app backend is ready for its contract. Normal framework apps are ready when their backend module/routes/lifespan are serving API requests. Proxy/shim apps are ready when the upstream/backend that owns their frontend is serving that frontend/content. Minimum body is {"status":"ready"}. This is app lifecycle state keyed by app id and must not require host_id, token_id, url, conversation id, or sidebar restore state. Stateful sidebar window state is separate and is published by app backends through sidebar.window.state.update over /sidebar_ipc.
```

Do not post this to the agent log until all planned implementation changes are in and before runtime testing begins.

## File Explorer POC

The POC should make `file_explorer` the reference app for path-based stateful sidebar operation.

The only `file_explorer` behavior becoming stateful in this first slice is opening directory links. Each opened sidebar app window tracks the last directory query/path state for that specific `host_id`. File operations, editor opens, downloads, archive operations, selection state, and general app-shell state are not part of the stateful sidebar-window scope for this slice.

Required changes:

- Add `sidebar_state` capability to `app/apps/file_explorer/manifest.json`.
- Install a TE2 console bridge in `app/apps/file_explorer/main.js` using a framework-level bridge asset, not by importing from `file_editor_cm6` source paths.
- Use `workerLabel: "file_explorer"` plus `uniquePerWindow: true` for ordinary, non-stateful `file_explorer` launches.
- Read `te2_host_id`, `te2_token_id`, and `te2_console_worker_id` from the query string.
- Treat the presence of `te2_host_id` as stateful sidebar mode for `file_explorer`.
- Use `te2_token_id=file_explorer` as the manifest-defined console worker prefix/token for this app lane unless the manifest/catalog declares a different prefix.
- When `te2_console_worker_id` is present in stateful mode, pass it as the exact console bridge `workerId` instead of generating a per-window id.
- Keep `path` as the app-specific state parameter.
- On successful `loadDirectory(...)` from a directory-open navigation, send the current path/query state to the `file_explorer` backend with `te2_host_id`, `te2_token_id`, and `te2_console_worker_id`.
- The `file_explorer` frontend must include its concrete console worker id when available so the backend can bind the state update to the token/console lane.
- The `file_explorer` backend must call the sidebar RPC backend with manifest app lane data (`app_id` and `base_url`), `host_id`, `token_id`, optional concrete `console_worker_id`, and the app-owned query/state to persist.
- The sidebar RPC backend persists the slot query/state for restore and publishes chrome/metadata updates. It must not reload the live iframe for ordinary directory navigation. The `file_explorer` frontend must not directly update the sidebar ledger or host iframe.
- Stop using saved app-shell `host.loadState(...).path` as the sidebar state authority when `te2_host_id` is present.
- Keep app-shell saved state for full-page non-sidebar loads.
- Remove or bypass any localStorage/base-url last-path redirect if it exists in the live file or app shell path during implementation. The sidebar ledger becomes the restoration authority for stateful sidebar launches.
- Add backend support in `app/apps/file_explorer/file_explorer.py` for the frontend to publish its current path URL.
- Keep `file_explorer.py` app/backend readiness limited to its backend-serving hook, which posts minimum app lifecycle readiness.
- Do not post app readiness from ordinary directory navigation or state publication.

Suggested POC app backend endpoint:

```http
POST /api/app/file_explorer/sidebar/window/state
```

Suggested body:

```json
{
  "host_id": "slot:file_explorer:file_explorer_a1b2",
  "token_id": "file_explorer",
  "console_worker_id": "file_explorer:a1b2",
  "path": "/tmp",
  "query_state": {
    "path": "/tmp"
  }
}
```

This is a `file_explorer` app-backend endpoint, not the Sidebar IPC RPC schema. It may accept `path` because `path` is `file_explorer` app data. The backend should normalize and validate the path, then call the sidebar RPC backend with app lane data and the query/state to store for that `host_id`. That RPC call is backend-to-backend and declares the restore state for the sidebar window. UI IPC/sidebar host then updates dock chrome/metadata without forcing a live iframe reload. The frontend should not directly mutate the sidebar ledger.

## Terminal Shell-State Slice

Terminal should become the second stateful sidebar app type after File Explorer.
Its state is not a path or conversation id. Its primary app-owned state is the
framework-shell terminal stream id: `shell_id`. It also carries optional `cwd`
query state so a stateful Terminal slot can spawn new shells in the current Code
TE2 project cwd without affecting already-open shells.

Target stateful Terminal URL:

```text
/app/terminal?embed=1&te2_host_id=<host_id>&te2_token_id=terminal&te2_console_worker_id=<worker_id>&shell_id=<shell_id>&cwd=<project-cwd>
```

Manifest direction:

- Add `sidebar_state.enabled: true` to `app/apps/terminal/manifest.json`.
- Use `kind: "shell"`.
- Use `base_url: "/app/terminal"`.
- Use the standard stateful query parameter names:
  `te2_host_id`, `te2_token_id`, and `te2_console_worker_id`.
- Use `console_worker_prefix: "terminal"`.
- Use `url_state.param: "shell_id"` with opaque state.

Frontend direction:

- Normal `/app/terminal` access remains normal Terminal behavior and starts in
  the existing list/splash mode.
- Sidebar-stateful behavior starts only when `te2_host_id` is present.
- On startup, read `shell_id` from the query string after loading the shell
  list.
- If `shell_id` exists and is live, select/open that shell.
- If `shell_id` is missing, dead, or no longer present, stay in the existing
  Terminal list/splash mode.
- When the user selects a different shell in a stateful Terminal slot, publish
  that shell selection to the Terminal backend so the sidebar ledger tracks the
  new `shell_id`.
- When the user creates a new shell from a stateful Terminal slot, the Terminal
  frontend asks its own backend for the current Code TE2 project cwd. The
  Terminal backend gets that cwd through `/sidebar_ipc` `sidebar.cwd.get`, then
  the new PTY is spawned in that cwd. Already-open shells are not moved.

Backend direction:

- Add a Terminal app-backend endpoint such as:

```http
POST /api/app/terminal/sidebar/window/state
```

- The frontend sends Terminal-owned state to that endpoint:

```json
{
  "host_id": "slot:terminal:terminal:a1b2",
  "token_id": "terminal",
  "console_worker_id": "terminal:a1b2",
  "shell_id": "fs_123",
  "cwd": "/data/data/com.termux/files/home/mrselect6",
  "query_state": {
    "shell_id": "fs_123",
    "cwd": "/data/data/com.termux/files/home/mrselect6"
  }
}
```

- The Terminal backend validates `host_id` and checks the requested `shell_id`
  against the framework-shell manager.
- If the shell exists and is running, the backend calls `/sidebar_ipc`
  `sidebar.window.state.update` with:
  - `app_id: "terminal"`
  - `base_url: "/app/terminal"`
  - the target `host_id`
  - `token_id` / concrete `console_worker_id` when available
  - `state_kind: "shell"`
  - `query_state: { "shell_id": "<shell_id>", "cwd": "<project-cwd>" }`
  - a restore URL containing `shell_id` and optional `cwd`
- If the shell is dead or missing, the backend still calls
  `sidebar.window.state.update`, but resets the slot to the base Terminal URL:
  - `url: "/app/terminal"`
  - explicit empty `query_state` so stale `shell_id`/`cwd` are cleared
  - `state_kind: "shell"` may remain as metadata
  - label/title should indicate normal Terminal, not the dead shell

This reset behavior matters because a dead shell id is stale app state, not a
new app failure. The Terminal app should show its existing list/splash page and
declare the corrected restore state back to the sidebar ledger so future
restores do not keep targeting the dead shell.

Do not treat Terminal's `shell_id` as global app readiness. Terminal app/backend
readiness remains the app lifecycle gate. Shell selection is per-window
stateful sidebar state.

Do not treat Terminal `cwd` as global Terminal state. `cwd` only seeds newly
created shells from that stateful slot. Existing shells keep their own cwd.

## Other Apps

Other apps should not receive the full stateful sidebar-window implementation in the first POC.

They should receive the minimum readiness support needed to conform later:

- app-worker environment has a reliable framework URL
- shared backend helper exists for posting readiness
- `/api/apps/{app_id}/readiness` accepts a minimal `{"status":"ready"}` payload
- app catalog and app runtime can expose readiness status

Proxy/shim apps can then call the same readiness endpoint when their proxied target is actually ready.

## Launcher And Icon

The sidebar icon bar needs a dedicated launcher icon.

Requirements:

- Material gray/blue visual language.
- Four dots.
- SVG source asset, not an emoji-only placeholder.
- The launcher icon is always present and opens the app drawer. The `URL` item is a separate URL-slot creation/edit path.
- App dock icons appear after the launcher and reflect app id, readiness state, active/focused state, and close/focus behavior.
- App dock icon order is user-configurable and persisted in `sidebarWindowState.order`; the current automatic order is only the default before user reordering.
- Stateful app dock icons also reflect token/console lane and tracked URL-state readiness.
- Non-stateful app dock icons load the manifest/catalog base URL and still participate in the dock/ledger.
- A debug flag should be able to replace icons with slot numbers during dock-order and slot-identity debugging.
- Plain URL entries can still appear as user-configured URL slots.

The icon asset should be added during implementation, not as part of this planning-only slice.

## UI Model

The current `sidebar-shortcuts` module can be evolved, but the model should become explicit:

```text
launcher entry
app dock entries
  stateful app slots with tracked query/state
  non-stateful app slots with manifest/catalog base URL
plain URL entries
```

Rules:

- The iframe stack can be reused.
- The eager/lazy loading mechanics can be reused.
- Framework app start-before-load can be reused.
- The active entry state should move from volatile `_client_active_shortcuts` to the durable window ledger for app dock entries.
- Non-stateful launcher-created app entries are still app dock entries; they just load base URL instead of app-declared query/state.
- Existing `agent*` DOM ids and pref names may remain temporarily as compatibility names, but code comments and docs should stop describing the feature as only "shortcuts."

## parts that I fucked up

### file_explorer app

- I treated the `file_explorer` work as if the hard part was just adding a frontend URL publisher plus readiness calls. The actual boundary is backend-to-backend: `app/apps/file_explorer/main.js` can derive the current app state, but `app/apps/file_explorer/file_explorer.py` must be the component that asks `/sidebar_ipc` to persist that state for the sidebar host slot.
- I blurred state publication, URL opening, and readiness. Normal directory navigation should publish query/state for the target `host_id`; it should not reload the live iframe and should not post app readiness. `/api/apps/{app_id}/readiness` is only the app/backend lifecycle readiness gate keyed by app id.
- I let the backend rebuild/apply the sidebar URL from `path` as if the host owned `file_explorer` navigation semantics. The corrected target contract is that the app backend declares app-owned query/state, while the sidebar backend only validates the app lane and host slot. The sidebar backend must not understand `path` beyond identity/safety validation.
- I treated `path` as if it belonged to one global app instance. It does not. For `file_explorer`, `path` is per-window app query/state keyed by `host_id`; multiple File Explorer slots can store different `path` values at the same time.
- I allowed `token_id` behavior to blur with `host_id`. The corrected model is that `host_id` identifies the sidebar slot, while `token_id` is the manifest-defined console worker prefix carried in the stateful launch URL. The concrete `console_worker_id` from the app frontend can then bind runtime observations to that token/app lane.
- I did not keep the app-shell state boundary sharp enough. `host.loadState(...)` / `host.saveState(...)` can stay for full-page `file_explorer`, but when `te2_host_id` is present the sidebar ledger query/state is the restoration authority.

### sidebar frontend

- I treated the visible frontend gap as a shortcut-management problem. The sidebar frontend model must be `launcher entry`, `app dock entries`, and `plain URL entries`. App dock entries include both stateful app slots with tracked query/state and non-stateful launcher-created app slots with manifest/catalog base URL. The old shortcut modal is legacy UI that must be pruned into the new URL slot model.
- I focused on the launcher icon/dropdown before making the app drawer and pre-readiness state real. The launcher must open the app drawer, not just expose old shortcut controls behind a new icon. The `URL` item should open a real JavaScript URL dialog, not the old shortcut modal.
- I put backend-readiness waiting in the Code TE2 sidebar instead of the framework app shell. The corrected contract is that `/app/{app_id}` owns the app/backend readiness placeholder; the sidebar iframes that shell and does not block display on stateful slot readiness.
- I did not make UI IPC ownership explicit enough. `/sidebar_ipc` accepts backend app data and requested query/state; UI IPC/sidebar host owns frontend chrome/metadata updates and iframe URL application only for create, cold load, restore, or explicit host navigation.
- I treated `_client_active_shortcuts`-style volatile state as acceptable for app windows. App dock active selection and restoration have to come from the durable sidebar window ledger keyed by `host_id`; URL slots should store their own URL state instead of depending on volatile shortcut state.
- I missed that the dock has to represent non-stateful apps too. If a non-stateful app is opened from the launcher, it still gets a dock/ledger slot and reloads the manifest/catalog base URL.
- I did not add a numeric-icon debug mode. While the launcher/dock model is being brought up, a flag should render slot numbers instead of icons so identity/order bugs are visible.
- I allowed old `agent*` names and shortcut UI to keep defining the behavior. They may remain as temporary DOM/pref compatibility names, but the user-facing behavior and code comments must stop describing the stateful app-window system as only shortcuts.

## Validation Gate

Do not test the runtime until all planned code changes for the first implementation slice are in.

Before testing:

- post the minimum readiness shape to the agent log with the `[TE2]` prefix
- rebuild any affected frontend assets
- reload app registry only if manifest/catalog changes need it and the user approves that action
- avoid restarting TE2 builtins without explicit approval

Minimum validation after implementation:

- `file_explorer` full-page load still works with ordinary `host.loadState(...)`.
- `/app/file_explorer?embed=1&path=/tmp` still opens `/tmp` in ordinary app mode.
- `/app/file_explorer?embed=1&te2_host_id=...&te2_token_id=file_explorer&path=/tmp` runs in sidebar-stateful mode and publishes directory-link query/state through the `file_explorer` backend.
- `/app/terminal?embed=1&te2_host_id=...&te2_token_id=terminal&shell_id=<live-shell>` runs in sidebar-stateful mode and selects/publishes that shell through the Terminal backend.
- `/app/terminal?embed=1&te2_host_id=...&te2_token_id=terminal&shell_id=<dead-shell>` stays on the Terminal list/splash mode and publishes corrected base-URL restore state through the Terminal backend.
- Reloading the host/sidebar restores the slot from the sidebar ledger, not from guest localStorage.
- A backend-required app launched before semantic readiness shows the framework `/app/{app_id}` backend-readiness placeholder and later loads when the app-level readiness POST arrives, with no fixed timeout.
- Non-capable apps opened from the launcher create/focus a dock ledger slot and load the manifest/catalog base URL.
- Plain URL entries still launch separately from launcher-created app dock slots.
- Numeric dock debug mode can replace icons with slot numbers for order/identity inspection.
- `/api/apps/catalog` exposes `sidebar_state` capability for capable apps and omits it or marks it disabled for non-capable apps.

## Execution Order

1. [x] Land this planning doc.
2. [x] Add framework app/backend readiness endpoint, runtime/catalog readiness state, and app-shell readiness placeholder.
3. [x] Add manifest capability exposure through registry/catalog.
4. [x] Add sidebar window ledger backend and typed `/sidebar_ipc` methods.
5. [x] Refactor sidebar frontend behavior to include launcher, app dock entries for both stateful and non-stateful apps, and plain URL entries.
6. [x] Accept the current header-menu launcher/app drawer UI for now. Launcher SVG, app dock behavior, and numeric-icon debug flag are in the working tree.
7. [x] Add generic framework-app backend readiness publication in `app.libs.app_worker`; existing repeated per-app hooks remain compatible but are no longer required for ordinary framework apps.
8. [x] Implement `file_explorer` console identity, backend sidebar client, directory-link state publication, and backend-serving app readiness POST.
9. [x] Equip ordinary framework apps with minimum readiness publication through the standard app worker; proxy/shim apps still need their actual serving backend/upstream to publish readiness.
10. [x] Replace the old shortcut modal behind the `URL` item with a focused URL dialog, ledger-backed URL slot persistence, and URL slot close/change actions.
11. [ ] Implement Terminal shell-state mapping: manifest capability, query-to-shell frontend handling, Terminal backend state publisher, and dead-shell base-URL reset.
12. [x] Post the readiness requirement to the agent log.
13. [x] Run local validation and approved live TE2 validation for the current working model.
14. [ ] Validate framework app-shell readiness waiting and plain URL entries.

## Non-Goals For The First POC

- Do not retrofit ALS-RS in the first implementation slice.
- Do not force every framework app to become stateful.
- Do not scrape iframe URLs to infer app state.
- Do not use `postMessage` as the reference contract.
- Do not make stateful slots depend on `file_editor_cm6` source modules.
- Do not move app-specific URL semantics into the sidebar host.
- Do not use the generic app-shell `teState` key as the authoritative sidebar window ledger.

## Open Decisions

- App lifecycle retention semantics are not an implementation requirement yet. If source/runtime behavior shows that app lifecycle cleanup can stop an app while a sidebar iframe slot still needs it, investigate that exact path and decide whether the existing slot should keep that app alive. Do not implement lifecycle retention from this document without source-backed evidence.
