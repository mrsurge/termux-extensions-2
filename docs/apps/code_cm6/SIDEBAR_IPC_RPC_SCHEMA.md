# Code TE2 Sidebar IPC/RPC Schema

## Status

This is the schema-level companion to `SIDEBAR_IPC_RPC_CONTRACT.md`.

It defines the JSON-RPC 2.0 envelope and payload shapes for the logical `/sidebar_ipc` namespace. The current live implementation may dual-emit legacy `sidebar:*` events during migration, but new clients should use the typed RPC event names described here.

## Ownership

`/sidebar_ipc` owns external sidebar-frame actions and host/sidebar coordination:

- sidebar client registration and presence
- backend-owned cwd sync to sidebar clients
- active shortcut state and refresh requests
- sidebar/external file-open and edit signals routed through backend host hooks
- sidebar/external mention relay
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

## Request Methods

### `sidebar.register`

Registers a host or sidebar-frame client and joins the appropriate rooms.

Params:

```json
{
  "role": "host",
  "client_id": "client_123",
  "app": "file_editor_cm6"
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

### `sidebar.mention`

Params: `MentionPayload`

### `sidebar.file.open`

Params: normalized backend file-open visibility payload. This notification is for sidebar clients that need visibility into backend-routed opens; it must not become the source of truth for editor open state.

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

## Legacy Compatibility Mapping

During migration, these legacy event names map to typed RPC methods or notifications:

| Legacy event | Legacy shape | RPC method / notification |
| --- | --- | --- |
| `sidebar:register` | `{ role, client_id }` | `sidebar.register` |
| `sidebar:cwd_get` | `{}` | `sidebar.cwd.get` |
| `sidebar:cwd_set` client request | `{ reason? }` | `sidebar.cwd.sync` |
| `sidebar:cwd_set` server event | `{ cwd, reason, ts }` | `sidebar.cwd.set` |
| `sidebar:agent_open` | `FileLocation` | `sidebar.file.open` |
| `sidebar:agent_edit` | `FileLocation` | `sidebar.file.edit` |
| `sidebar:mention` | `MentionPayload` | `sidebar.mention` |
| `sidebar:event` | `{ type: "active_shortcut:set", payload }` | `sidebar.activeShortcut.set` |
| `sidebar:event` | `{ type: "refresh_active", payload }` | `sidebar.activeShortcut.refresh` |
| `sidebar:event` | `{ type: "client_state", payload }` | `sidebar.clientState` |
| `sidebar:event` | `{ type: "drawer:state", payload }` | `sidebar.drawer.state` |
| `sidebar:event` | `{ type: "drawer:open", payload }` | `sidebar.drawer.open` |
| `sidebar:event` | `{ type: "drawer:close", payload }` | `sidebar.drawer.close` |
| `sidebar:event` | `{ type: "drawer:toggle", payload }` | `sidebar.drawer.toggle` |

## Source Of Truth

Code TE2 contract modules:

- `app/apps/file_editor_cm6/src/sidebar_ipc/rpc_contract.ts`
- `app/apps/file_editor_cm6/ui_ipc/sidebar_rpc_contract.py`

Code TE2 implementation edge:

- `app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py`
- `app/apps/file_editor_cm6/ui_ipc/ui_ipc_ws.py`
- `app/apps/file_editor_cm6/main_page/frontend/connections/ui-ipc.ts`
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
