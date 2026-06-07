# Code TE2 Sidebar IPC/RPC Schema

## Status

This is the schema-level companion to `SIDEBAR_IPC_RPC_CONTRACT.md`.

It defines the JSON-RPC 2.0 envelope and payload shapes for the logical `/sidebar_ipc` namespace. The current live implementation uses typed JSON-RPC event names; legacy `sidebar:*` events are not part of the active contract.

## Ownership

`/sidebar_ipc` owns external sidebar-frame actions and host/sidebar coordination:

- sidebar client registration and presence
- backend-owned cwd sync to sidebar clients
- active shortcut state and refresh requests
- sidebar/external file-open and edit signals routed through backend host hooks
- sidebar/external mention relay
- sidebar/external project lookup, open, and create requests routed through backend project hooks
- drawer open, close, toggle, and state notifications

`/sidebar_ipc` does not own Explorer tree behavior, editor touch-selection behavior, host toolbar save/run/open behavior, WBA provider state, or terminal execution semantics.

## Transport

Current Socket.IO shape:

```text
namespace: /sidebar_ipc
path: /ui_ipc_ws/socket.io
request/client-notification event: rpc
server-notification event: rpc.notify
```

Future gateway work may change the physical path, but must preserve `/sidebar_ipc` as the logical namespace unless a later contract revision removes it.

## JSON-RPC Envelope Schemas

Request envelope:

```json
{
  "jsonrpc": "2.0",
  "id": "non-empty-string",
  "method": "sidebar.methodName",
  "params": {}
}
```

Client notification envelope:

```json
{
  "jsonrpc": "2.0",
  "method": "sidebar.notificationName",
  "params": {}
}
```

Success response envelope:

```json
{
  "jsonrpc": "2.0",
  "id": "same-request-id",
  "result": {}
}
```

Error response envelope:

```json
{
  "jsonrpc": "2.0",
  "id": "same-request-id-or-null",
  "error": {
    "code": -32600,
    "message": "error message",
    "data": {}
  }
}
```

Protocol error codes should follow JSON-RPC 2.0 conventions:

- `-32600`: invalid request envelope or invalid `jsonrpc` / `id` shape
- `-32601`: unknown sidebar IPC method or notification
- `-32603`: internal dispatch failure

## Shared Payload Shapes

`ClientId`:

```json
"non-empty-string"
```

`TimestampMs`:

```json
1778220000000
```

`FileLocation`:

```json
{
  "path": "optional absolute or repo-relative path",
  "abs": "optional absolute path",
  "rel": "optional project-relative path",
  "line": 1,
  "column": 1,
  "source": "sidebar_ipc",
  "request_id": "optional correlation id",
  "conversation_id": "optional conversation id"
}
```

`MentionPayload`:

```json
{
  "path": "optional absolute or repo-relative path",
  "rel": "optional project-relative path",
  "line": 1,
  "column": 1,
  "source": "sidebar",
  "conversation_id": "optional conversation id",
  "text": "optional mention text"
}
```

`DrawerPayload`:

```json
{
  "source": "main_page",
  "ts": 1778220000000
}
```

`ActiveShortcutPayload`:

```json
{
  "client_id": "optional client id",
  "shortcutId": "shortcut id",
  "activeShortcutId": "shortcut id"
}
```

`ActiveShortcutRefreshPayload`:

```json
{
  "client_id": "optional client id",
  "flushCache": false,
  "source": "sidebar_shortcuts"
}
```

`ProjectPathPayload`:

```json
{
  "path": "/absolute/or/~/project/path"
}
```

`ProjectCreatePayload`:

```json
{
  "path": "/desired/project/root",
  "adoptExisting": false,
  "open": true
}
```

`ProjectLookupResult`:

```json
{
  "ok": true,
  "known": true,
  "reason": null,
  "project": {
    "path": "/logical/history/path",
    "label": "project",
    "opened_at": "timestamp",
    "is_active": false,
    "directory_exists": true,
    "sidecar": {
      "exists": true,
      "path": "/home/.../.cache/cm6_editor/projects/<sha>.json"
    }
  }
}
```

## Request Methods

### `sidebar.register`

Registers a host or sidebar-frame client and joins the appropriate rooms.
When `app`, `app_id`, or `appId` is supplied, the client also joins that app's
notification room so persistent app backends can receive app-specific
notifications such as `sidebar.window.focused`.

Params:

```json
{
  "role": "iframe",
  "client_id": "als-rs-backend",
  "app": "als-rs"
}
```

Allowed `role` values:

- `host`
- `iframe`

Result:

```json
{
  "ok": true
}
```

### `sidebar.cwd.get`

Requests the backend-owned current cwd/project root.

Params:

```json
{}
```

Result:

```json
{
  "cwd": "/absolute/project/path",
  "reason": "request",
  "ts": 1778220000000
}
```

### `sidebar.cwd.sync`

Requests an authoritative cwd broadcast. Client-supplied cwd is not source of truth.

Params:

```json
{
  "reason": "manual"
}
```

Result:

```json
{
  "ok": true
}
```

### `sidebar.file.open`

External/sidebar-originated request to open a file through backend host file-open hooks.

Params: `FileLocation`

Result:

```json
{
  "ok": true
}
```

### `sidebar.file.edit`

External/sidebar-originated edit/open signal. This is gated by `trackAgentSidebarEdits` where applicable.

Params: `FileLocation`

Result when routed:

```json
{
  "ok": true
}
```

Result when dropped by preference gate:

```json
{
  "ok": false,
  "dropped": true,
  "reason": "trackAgentSidebarEdits disabled"
}
```

### `sidebar.mention`

External/sidebar-originated mention relay to sidebar listeners.

Params: `MentionPayload`

Result:

```json
{
  "ok": true
}
```

### `sidebar.project.lookup`

Checks whether a path is an official known project root. Known means exact history-store logical path match plus existing project sidecar.

Params: `ProjectPathPayload`

Result: `ProjectLookupResult`

Miss result:

```json
{
  "ok": true,
  "known": false,
  "reason": "not_in_history",
  "project": {
    "path": "/logical/path",
    "sidecar": {
      "exists": false,
      "path": "/home/.../.cache/cm6_editor/projects/<sha>.json"
    }
  }
}
```

Stable miss reasons include `invalid_path`, `not_in_history`, `sidecar_missing`, and `path_missing`.

### `sidebar.project.open`

Opens a known project root through backend project hooks. The sidebar IPC backend refuses paths that are not known with an existing sidecar.

Params: `ProjectPathPayload`

Success result:

```json
{
  "ok": true,
  "path": "/logical/history/path",
  "resolved_path": "/resolved/project/root",
  "state": {},
  "project": {}
}
```

Refusal result:

```json
{
  "ok": false,
  "reason": "sidecar_missing",
  "lookup": {}
}
```

### `sidebar.project.create`

Creates or optionally adopts a project from a target path through backend project hooks.

Params: `ProjectCreatePayload`

Success result follows `sidebar.project.open` when `open` is true and includes `created` / `adopted` flags where applicable.

### `sidebar.activeShortcut.set`

Sets active shortcut state for a sidebar client id.

Params: `ActiveShortcutPayload`

Result:

```json
{
  "ok": true,
  "client_id": "client_123",
  "activeShortcutId": "shortcut-id"
}
```

### `sidebar.activeShortcut.refresh`

Requests refresh of the active shortcut frame.

Params: `ActiveShortcutRefreshPayload`

Result:

```json
{
  "ok": true
}
```

### `sidebar.drawer.open`

Requests drawer open on host clients.

Params: `DrawerPayload`

Result:

```json
{
  "ok": true
}
```

### `sidebar.drawer.close`

Requests drawer close on host clients.

Params: `DrawerPayload`

Result:

```json
{
  "ok": true
}
```

### `sidebar.drawer.toggle`

Requests drawer toggle on host clients.

Params: `DrawerPayload`

Result:

```json
{
  "ok": true
}
```

## Server Notifications

Server notifications are emitted on Socket.IO event `rpc.notify`.

### `sidebar.presence`

Params:

```json
{
  "hosts": 1,
  "iframes": 2
}
```

### `sidebar.cwd.set`

Params:

```json
{
  "cwd": "/absolute/project/path",
  "reason": "sync",
  "ts": 1778220000000
}
```

### `sidebar.clientState`

Params:

```json
{
  "client_id": "client_123",
  "activeShortcutId": "shortcut-id",
  "ts": 1778220000000
}
```

### `sidebar.window.focused`

Sent to the focused stateful app's app-specific room when a sidebar window slot
is brought to the foreground. Apps that do not need focus targeting can ignore
this notification.

To receive it, keep a persistent `/sidebar_ipc` connection and call
`sidebar.register` with `app`, `app_id`, or `appId` set to the manifest app id.

Params:

```json
{
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
```

### `sidebar.mention`

Params: `MentionPayload`

### `sidebar.file.open`

Params: normalized backend file-open visibility payload. This notification is for sidebar clients that need visibility into backend-routed opens; it must not become the source of truth for editor open state.

### `sidebar.project.opened`

Params:

```json
{
  "path": "/logical/history/path",
  "resolved_path": "/resolved/project/root",
  "state": {},
  "source": "sidebar_ipc_rpc",
  "ts": 1778220000000
}
```

Host clients consume this via the existing `/sidebar_ipc` frontend connection and run their own project-open resync. Sidebar IPC does not call host functions directly.

### `sidebar.activeShortcut.refresh`

Params: `ActiveShortcutRefreshPayload`

### `sidebar.drawer.state`

Params:

```json
{
  "open": true,
  "source": "main_page",
  "ts": 1778220000000
}
```

### `sidebar.drawer.open`

Params: `DrawerPayload`

### `sidebar.drawer.close`

Params: `DrawerPayload`

### `sidebar.drawer.toggle`

Params: `DrawerPayload`

## Retired Legacy Events

Legacy `sidebar:*` Socket.IO event names are not part of this schema. New behavior must be added as typed JSON-RPC methods or `rpc.notify` notifications on `/sidebar_ipc`.

## Source Of Truth

Code TE2 contract modules:

- `app/apps/file_editor_cm6/src/sidebar_ipc/rpc_contract.ts`
- `app/apps/file_editor_cm6/ui_ipc/sidebar_rpc_contract.py`

Code TE2 implementation edge:

- `app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py`
- `app/apps/file_editor_cm6/ui_ipc/ui_ipc_ws.py`
- `app/apps/file_editor_cm6/main_page/frontend/connections/ui-ipc.ts`
- `app/apps/file_editor_cm6/host/project_backend.py`
- `app/apps/file_editor_cm6/main_page/backend/project_service.py`
- `app/apps/file_editor_cm6/main_page/frontend/sidebar-shortcuts/runtime.ts`
- `app/apps/file_editor_cm6/main_page/frontend/sidebar-shortcuts/`
- `app/apps/file_editor_cm6/main_page/frontend/ui/sidebar-shortcuts-bootstrap.ts`
- `app/apps/file_editor_cm6/main_page/frontend/host-sidebar-runtime.ts`

## Cutover Rule

Do not collapse the physical app Socket.IO transports until this logical schema is coherent on both frontend and backend.

Transport consolidation must preserve domain ownership:

- gateway owns routing only
- backend hooks own file open/edit routing
- host owns drawer rendering/initiation only
- sidebar frames own external/sidebar-frame initiation only
- Explorer/editor/WBA/terminal behavior must stay on their own logical lanes
