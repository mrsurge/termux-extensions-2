# Stateful Sidebar Apps

This guide is for app authors who want their app to run as a stateful app inside
the Code TE2 sidebar.

The theme is simple:

An app already knows its own state. TE2 is not trying to own or reinvent that
state. TE2 only needs enough app-declared state to keep multiple sidebar windows
of the same app alive and restorable at the same time.

## Core Model

The Code TE2 sidebar has an app dock. Each dock icon represents one active or
retained sidebar app slot.

A slot is identified by `host_id`.

An app is identified by `app_id`.

Those are not the same thing.

Multiple dock slots may have the same `app_id`. They must have different
`host_id` values. This is how the sidebar can track multiple states of the same
app simultaneously. For example:

```text
slot:file_explorer:file_explorer:a1b2  -> app_id=file_explorer, path=/tmp
slot:file_explorer:file_explorer:c9d0  -> app_id=file_explorer, path=/home/me
```

The app owns the meaning of `path`. TE2 stores it as opaque app-owned
`query_state` for the slot. TE2 must not reinterpret it as a host-owned file
browser state.

## Ownership Boundaries

`/ui_ipc`

Host/frontend control lane. The Code TE2 host uses this to update sidebar
chrome, activate/close slots, and apply dock state to the visible frontend.

`/sidebar_ipc`

Backend app API lane. Stateful app backends use this to send app data and
requested restore state to Code TE2. It is backend-only for stateful app state.

App frontend

Owns UI interactions and knows what app state the user just entered. It should
send that state to its own app backend.

App backend

Validates app data, converts it to a restore checkpoint, and calls
`/sidebar_ipc` with `sidebar.window.state.update`.

Code TE2 sidebar backend

Stores app dock slots in the sidebar ledger. It validates the app lane and host
slot identity, but it does not own app-specific route semantics.

## What Stateful Means

A stateful sidebar app is an app whose manifest declares enough metadata for
Code TE2 to launch and restore multiple sidebar slots for that app.

Stateful does not mean:

- TE2 owns the app's internal state machine.
- TE2 scrapes iframe URLs.
- TE2 calls guest frontend code to mutate state.
- The app frontend writes directly to the sidebar ledger.
- The app can only run inside TE2.

Stateful means:

- The app has a manifest-declared sidebar lane.
- Each launched sidebar slot has a durable `host_id`.
- The app receives TE2 identity query params on launch.
- The app publishes restore checkpoints through its own backend.
- The app backend sends those checkpoints to `/sidebar_ipc`.
- Code TE2 can restore each slot later from the stored checkpoint.

## Manifest Contract

Add `sidebar_state` to the app manifest.

Example from `app/apps/file_explorer/manifest.json`:

```json
{
  "id": "file_explorer",
  "name": "File Explorer",
  "entrypoints": {
    "backend_blueprint": "file_explorer.py",
    "frontend_template": "template.html",
    "frontend_script": "main.js"
  },
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

Important fields:

`enabled`

Enables stateful sidebar behavior for this app.

`base_url`

The same-origin app URL Code TE2 is allowed to load for this app lane.

`kind`

Human-readable state kind. For File Explorer this is `path`.

`console_worker_prefix`

Manifest-defined token prefix for this app lane. The concrete per-slot console
worker id is derived from this prefix when Code TE2 creates a new slot.

`host_id_param`

Query parameter that carries the durable sidebar slot id into the app frontend.

`token_id_param`

Query parameter that carries the manifest token/prefix into the app frontend.

`console_worker_id_param`

Query parameter that carries the concrete console worker id into the app
frontend.

`url_state`

Describes the app-owned query state. This metadata is descriptive. The sidebar
stores the query state as opaque app data and must not make app-specific
decisions from it.

## Launch Query Parameters

When Code TE2 launches a stateful sidebar slot, it constructs a URL from:

```text
manifest base_url
+ embed=1
+ host_id_param
+ token_id_param
+ console_worker_id_param
+ stored app query_state when restoring
```

Example:

```text
/app/file_explorer?embed=1&te2_host_id=slot%3Afile_explorer%3Afile_explorer%3Aa1b2&te2_token_id=file_explorer&te2_console_worker_id=file_explorer%3Aa1b2&path=%2Ftmp
```

Your frontend should read these params at startup:

```js
const params = new URLSearchParams(window.location.search);
const hostId = params.get("te2_host_id") || "";
const tokenId = params.get("te2_token_id") || "";
const consoleWorkerId = params.get("te2_console_worker_id") || "";
const isSidebarStateful = !!hostId;
```

If `hostId` is absent, run as a normal full-page or embedded app. Do not make
the app require TE2 sidebar mode to function.

## Normal App Access Is Not Stateful

Declaring `sidebar_state` makes an app stateful-capable. It does not make every
load of that app stateful.

The app should enter sidebar-stateful behavior only when Code TE2 launches it
with sidebar slot identity. In the current contract, `te2_host_id` is the gating
identity parameter.

For File Explorer:

```text
/app/file_explorer
```

is normal app access.

```text
/app/file_explorer?path=/tmp
```

is still normal app access with a normal deep-link path.

```text
/app/file_explorer?embed=1&te2_host_id=slot%3Afile_explorer%3Afile_explorer%3Aa1b2&te2_token_id=file_explorer&te2_console_worker_id=file_explorer%3Aa1b2&path=%2Ftmp
```

is sidebar-stateful access for one sidebar slot.

The frontend may still support ordinary app-shell state, saved preferences,
deep links, and per-window console bridge identity in normal app mode. It must
not publish sidebar restore checkpoints or call its stateful backend bridge
unless `te2_host_id` is present.

## Console Bridge

If the app has a frontend surface and uses TE2 console instrumentation, initialize
the console bridge with the inherited worker id when it exists.

Pattern:

```js
import {
  initConsoleBridge,
  getConsoleBridgeStatus,
} from "/static/js/te2_console_bridge.js";

const params = new URLSearchParams(window.location.search);
const inheritedWorkerId = params.get("te2_console_worker_id") || "";

const bridge = await initConsoleBridge({
  appId: "file_explorer",
  workerLabel: "file_explorer",
  workerId: inheritedWorkerId || undefined,
  uniquePerWindow: !inheritedWorkerId,
});
```

Use the concrete worker id when publishing state:

```js
const status = getConsoleBridgeStatus();
const concreteWorkerId =
  status && status.workerId ? String(status.workerId) : "";
```

## Frontend State Publication

When the user enters a state that should be restorable, the app frontend should
send that state to its own backend.

For File Explorer, loading a directory is the stateful action:

```js
async function publishSidebarState(path) {
  if (!hostId) return;

  const status = getConsoleBridgeStatus();
  const concreteWorkerId =
    status && status.workerId ? String(status.workerId) : "";

  await api.post("sidebar/window/state", {
    host_id: hostId,
    hostId,
    token_id: tokenId || "file_explorer",
    tokenId: tokenId || "file_explorer",
    console_worker_id: concreteWorkerId,
    consoleWorkerId: concreteWorkerId,
    path,
    query_state: { path },
    queryState: { path },
    url: buildRestoreUrl(path, concreteWorkerId),
    activate: false,
  });
}
```

The frontend does not call `/sidebar_ipc` directly. It calls its own backend.

## App Backend State Endpoint

The app backend endpoint should:

- require `host_id`
- validate app-specific input
- normalize app state
- build a same-origin restore URL when needed
- call `sidebar.window.state.update` over `/sidebar_ipc`
- leave app/backend readiness alone; state publication is not readiness

Reference shape:

```python
@file_explorer_bp.post('/sidebar/window/state')
async def publish_sidebar_window_state(payload: dict | None = Body(None)):
    body = payload if isinstance(payload, dict) else {}
    host_id = str(body.get('host_id') or body.get('hostId') or '').strip()
    if not host_id:
        raise HTTPException(status_code=400, detail='host_id is required')

    directory = resolve_and_validate_directory(body.get('path'))
    path_value = str(directory)
    token_id = str(body.get('token_id') or body.get('tokenId') or APP_ID).strip()
    console_worker_id = str(
        body.get('console_worker_id') or body.get('consoleWorkerId') or ''
    ).strip()

    restore_url = build_restore_url(
        host_id=host_id,
        token_id=token_id,
        console_worker_id=console_worker_id,
        path_value=path_value,
    )

    result = await call_sidebar_rpc(
        'sidebar.window.state.update',
        {
            'lane': {
                'app_id': APP_ID,
                'base_url': APP_BASE_URL,
            },
            'app_id': APP_ID,
            'base_url': APP_BASE_URL,
            'host_id': host_id,
            'token_id': token_id,
            'console_worker_id': console_worker_id,
            'state_kind': 'path',
            'query_state': {'path': path_value},
            'url': restore_url,
            'label': path_value,
            'activate': False,
            'source': f'{APP_ID}_backend',
        },
    )

    return {'ok': True, 'data': {'sidebar': result}}
```

## Sidebar IPC JSON-RPC

The backend app calls `/sidebar_ipc` with JSON-RPC over Socket.IO.

Current transport shape:

```text
framework URL: http://127.0.0.1:${TE_PORT or 8089}
socket path: /ui_ipc_ws/socket.io
namespace: /sidebar_ipc
event: rpc
```

Request envelope:

```json
{
  "jsonrpc": "2.0",
  "id": "file_explorer:state:123",
  "method": "sidebar.window.state.update",
  "params": {
    "app_id": "file_explorer",
    "base_url": "/app/file_explorer",
    "host_id": "slot:file_explorer:file_explorer:a1b2",
    "token_id": "file_explorer",
    "console_worker_id": "file_explorer:a1b2",
    "state_kind": "path",
    "query_state": {
      "path": "/tmp"
    },
    "url": "/app/file_explorer?embed=1&te2_host_id=slot%3Afile_explorer%3Afile_explorer%3Aa1b2&te2_token_id=file_explorer&te2_console_worker_id=file_explorer%3Aa1b2&path=%2Ftmp",
    "activate": false
  }
}
```

Expected behavior:

- The sidebar backend updates only the target `host_id`.
- The update stores restore URL/query-state.
- The update does not activate the slot unless `activate` is explicitly true.
- The update does not reset readiness unless readiness is explicitly sent.
- The update does not reload an already-loaded iframe.

## Focused Slot Notification

Stateful app backends can keep a persistent `/sidebar_ipc` connection if they
need to know which one of their sidebar slots is currently foregrounded.

Register that backend connection with the manifest app id:

```json
{
  "jsonrpc": "2.0",
  "id": "als-rs:register",
  "method": "sidebar.register",
  "params": {
    "role": "iframe",
    "client_id": "als-rs-backend",
    "app": "als-rs"
  }
}
```

When a stateful slot for that app is activated, Code TE2 sends:

```json
{
  "jsonrpc": "2.0",
  "method": "sidebar.window.focused",
  "params": {
    "app_id": "als-rs",
    "appId": "als-rs",
    "client_id": "main_page",
    "clientId": "main_page",
    "host_id": "slot:als-rs:als_rs:a1b2",
    "hostId": "slot:als-rs:als_rs:a1b2",
    "state_kind": "conversation",
    "stateKind": "conversation",
    "query_state": {
      "conversation_id": "conv_123"
    },
    "queryState": {
      "conversation_id": "conv_123"
    },
    "url": "/app/als-rs?embed=1&te2_host_id=slot%3Aals-rs%3Aals_rs%3Aa1b2&conversation_id=conv_123",
    "restore_url": "/app/als-rs?embed=1&te2_host_id=slot%3Aals-rs%3Aals_rs%3Aa1b2&conversation_id=conv_123",
    "restoreUrl": "/app/als-rs?embed=1&te2_host_id=slot%3Aals-rs%3Aals_rs%3Aa1b2&conversation_id=conv_123",
    "token_id": "als_rs",
    "tokenId": "als_rs",
    "console_worker_id": "als_rs:a1b2",
    "consoleWorkerId": "als_rs:a1b2",
    "focused": true,
    "source": "header_icon",
    "ts": 1778220000000
  }
}
```

The notification is app-specific and optional. Apps that do not need focus
targeting can ignore it. Apps that do need it should derive their own target
state from `query_state` or `restore_url`; Code TE2 still does not interpret
app-specific state such as `conversation_id`.

## App Backend Readiness

TCP or shell readiness only means the process was spawned or a port probe
passed. App backend readiness means the app worker/backend is actually ready
to accept the app requests its contract requires.

For normal framework apps, the standard app worker posts this readiness after
the backend module is imported, routes are mounted, lifespans are active, and
the backend can accept requests. Apps with special backend readiness needs can
provide their own backend hook and post the same endpoint from there.

For proxy or shim apps where the app's own backend actually serves the
frontend content, readiness means that upstream/backend is serving the frontend
content. Those apps should post or put readiness only when that serving point is
true.

Every app backend can publish minimum readiness:

```http
POST /api/apps/{app_id}/readiness
Content-Type: application/json
```

`PUT /api/apps/{app_id}/readiness` has the same semantics.

Minimum body:

```json
{
  "status": "ready"
}
```

Allowed statuses:

```text
starting
ready
error
stopped
```

The framework stores this as app lifecycle state keyed by `app_id` for the
running app worker lifetime. A running backend that has not posted `ready` is
treated as `starting`. The app shell uses that state to keep the framework-level
loading placeholder visible for as long as the backend needs, including
compile-heavy apps that take minutes.

Readiness is not sidebar-window state. Do not include `host_id`, `token_id`,
`console_worker_id`, `url`, `path`, or conversation state in this POST.

This backend gate matters for stateful sidebar apps because the frontend is not
the authority for restore/checkpoint state. Until the backend is ready, the app
cannot reliably validate state, persist restore checkpoints, or send canonical
`sidebar.window.state.update` calls to the sidebar ledger. The dock/iframe can
exist, but the app is not ready to participate in the stateful sidebar contract
until its backend readiness is `ready`.

To read the current app lifecycle readiness:

```http
GET /api/apps/{app_id}/readiness
```

For stateful sidebar window restore/checkpoint data, publish state through
`sidebar.window.state.update` from the app backend.

If a sidebar slot needs slot-local status metadata, use the sidebar RPC method
for window readiness instead:

```json
{
  "method": "sidebar.window.readiness.update",
  "host_id": "slot:file_explorer:file_explorer:a1b2",
  "status": "ready",
  "message": "Window state restored"
}
```

## Restore Semantics

The sidebar ledger stores both live URL and restore state.

`url`

The currently loaded or last live iframe URL.

`restore_url`

The URL Code TE2 should use on cold load, reload, or explicit host navigation.

`query_state`

The app-owned query object used to reconstruct restore state.

Normal in-app navigation should update `restore_url` and `query_state`, not
force the current iframe to reload. If the iframe is already loaded, it should
keep running and keep its own state.

## Multiple Windows Of The Same App

Do not use `app_id` as a window key.

Bad:

```json
{
  "app_id": "file_explorer",
  "query_state": {
    "path": "/tmp"
  }
}
```

Good:

```json
{
  "app_id": "file_explorer",
  "host_id": "slot:file_explorer:file_explorer:a1b2",
  "query_state": {
    "path": "/tmp"
  }
}
```

Every mutable state update must target one `host_id`. If the app has two open
slots, each slot publishes its own state using its own `host_id`.

## Non-Stateful Apps

Apps without `sidebar_state.enabled` can still be launched from the sidebar app
drawer.

They become normal ledger-backed app dock slots. They use the manifest/catalog
base URL and do not receive stateful token/query-state semantics.

This is useful for apps like Terminal. They get dock identity and focus/close
behavior without becoming stateful.

## Dock Order

Dock/icon order is sidebar host chrome state. It is stored in the backend
`sidebarWindowState.order` ledger, not in app-owned state and not in guest
frontend localStorage.

The current automatic order is the default until the user reorders the dock.
When the user drags dock icons, Code TE2 writes the new `host_id` order through
UI IPC and persists it in the sidebar ledger. App backends should not publish or
interpret dock order.

## Validation Checklist

Use this checklist when making an app stateful:

- Manifest includes `sidebar_state.enabled: true`.
- Manifest `base_url` is the app URL Code TE2 should load.
- Frontend reads `te2_host_id`, `te2_token_id`, and `te2_console_worker_id`.
- Frontend runs normally when `te2_host_id` is absent.
- Frontend sends restorable state to its own backend.
- Backend validates app state before publishing it.
- Backend calls `sidebar.window.state.update`, not frontend code.
- State update includes `app_id`, `base_url`, `host_id`, `token_id`, and `query_state`.
- State update includes `console_worker_id` when available.
- State update uses `activate: false` for ordinary in-app navigation.
- App backend readiness POST or PUT sends at least `{"status":"ready"}` when the backend is ready for its contract.
- App backend readiness does not include sidebar slot identity or app-owned URL state.
- Persistent app backend connection registers `app`, `app_id`, or `appId` if it
  wants `sidebar.window.focused` notifications.
- Two windows of the same app get different `host_id` values.
- Updating one `host_id` does not mutate another slot with the same `app_id`.
- Reordering dock icons changes only `sidebarWindowState.order`; it does not
  mutate app-owned `query_state`.
- Reloading Code TE2 restores sidebar slots from the ledger.
- Existing full-page app behavior still works outside sidebar mode.

## Things Not To Do

- Do not make the app require TE2 to function.
- Do not use `app_id` as window identity.
- Do not let the frontend mutate the sidebar ledger directly.
- Do not use `postMessage` as the stateful-sidebar contract.
- Do not scrape iframe URLs to infer app state.
- Do not make Code TE2 understand app-specific state such as File Explorer
  `path`.
- Do not use `/api/apps/{app_id}/readiness` for sidebar slot state.
- Do not reset readiness to `starting` for ordinary state updates.
- Do not reload the live iframe just because the app published a new restore
  checkpoint.

## Reference Implementation

The reference implementation is File Explorer:

```text
app/apps/file_explorer/manifest.json
app/apps/file_explorer/main.js
app/apps/file_explorer/file_explorer.py
```

The host/sidebar implementation lives in:

```text
app/apps/file_editor_cm6/ui_ipc/sidebar_window_state.py
app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py
app/apps/file_editor_cm6/ui_ipc/sidebar_rpc_contract.py
app/apps/file_editor_cm6/src/sidebar_ipc/rpc_contract.ts
app/apps/file_editor_cm6/main_page/frontend/sidebar-shortcuts/
```

The planning/progress tracker is:

```text
docs/planning/TE2_SIDEBAR_STATEFUL_APP_WINDOWS_NORTH_STAR.md
```
