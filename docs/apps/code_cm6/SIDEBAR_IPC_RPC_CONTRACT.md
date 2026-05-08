# Code TE2 Sidebar IPC/RPC Contract

## Status

Initial contract definition for the `/sidebar_ipc` cleanup.

The live implementation still contains legacy Socket.IO event names such as `sidebar:event`, `sidebar:mention`, `sidebar:agent_open`, and `sidebar:cwd_get`. This document defines the typed JSON-RPC target that those event-name conventions should migrate toward before the physical Socket.IO transports are collapsed behind one app gateway path.

## Transport

Logical namespace:

- `/sidebar_ipc`

Current physical path:

- `/ui_ipc_ws/socket.io`

Future physical path:

- the consolidated `file_editor_cm6` app Socket.IO gateway path, preserving `/sidebar_ipc` as the logical namespace unless a later contract revision removes it.

RPC event names:

- request and client notification event: `rpc`
- server notification event: `rpc.notify`

## Ownership

`/sidebar_ipc` is for external/sidebar-frame actions and host/sidebar coordination.

It owns:

- sidebar frame registration and presence
- cwd sync from backend to sidebar frames
- active shortcut state and refresh requests
- external/sidebar-originated file opens and edit notifications
- external/sidebar-originated mentions
- drawer open/close/toggle requests and state notifications

It does not own:

- Explorer tree/project behavior; Explorer-originated actions use Explorer RPC or backend relays
- editor touch-selection behavior; editor-originated actions use editor RPC/backend relays
- host toolbar/file/save/run behavior; host actions use UI IPC backend hooks
- WBA intelligence or provider state

## Request Methods

- `sidebar.register`
  - Registers a host or iframe/sidebar-frame client.
  - Params: `{ role, client_id }`.
- `sidebar.cwd.get`
  - Requests the backend-owned current cwd/project root.
  - Params: `{}`.
- `sidebar.cwd.sync`
  - Requests an authoritative cwd broadcast. Client-supplied cwd must not become source of truth.
  - Params: `{ reason? }`.
- `sidebar.file.open`
  - External/sidebar-originated request to open a file through backend host file-open hooks.
  - Params: `{ path? , abs? , rel? , line? , column? , source? , request_id? }`.
- `sidebar.file.edit`
  - External/sidebar-originated edit/open signal, gated by `trackAgentSidebarEdits` where applicable.
  - Params: `{ path? , abs? , rel? , line? , column? , source? , conversation_id? }`.
- `sidebar.mention`
  - External/sidebar-originated mention relay to sidebar listeners.
  - Params: `{ path? , rel? , line? , column? , source? , conversation_id? , text? }`.
- `sidebar.activeShortcut.set`
  - Sets active shortcut state for a sidebar client id.
  - Params: `{ client_id? , shortcutId? , activeShortcutId? }`.
- `sidebar.activeShortcut.refresh`
  - Requests refresh of the active shortcut frame.
  - Params: `{ client_id? , flushCache? , source? }`.
- `sidebar.drawer.open`
  - Requests drawer open on host clients.
  - Params: `{ source? }`.
- `sidebar.drawer.close`
  - Requests drawer close on host clients.
  - Params: `{ source? }`.
- `sidebar.drawer.toggle`
  - Requests drawer toggle on host clients.
  - Params: `{ source? }`.

## Server Notifications

- `sidebar.presence`
  - Params: `{ hosts, iframes }`.
- `sidebar.cwd.set`
  - Params: `{ cwd, reason, ts }`.
- `sidebar.clientState`
  - Params: `{ client_id, activeShortcutId, ts }`.
- `sidebar.mention`
  - Params: same shape as `sidebar.mention` request.
- `sidebar.file.open`
  - Params: normalized backend open payload for listeners that need visibility.
- `sidebar.activeShortcut.refresh`
  - Params: `{ client_id? , flushCache? , source? }`.
- `sidebar.drawer.state`
  - Params: `{ open, source, ts }`.
- `sidebar.drawer.open`, `sidebar.drawer.close`, `sidebar.drawer.toggle`
  - Params: `{ source? , ts? }`.

## Compatibility Mapping

Legacy event names should map as follows during migration:

- `sidebar:register` -> `sidebar.register`
- `sidebar:cwd_get` -> `sidebar.cwd.get`
- `sidebar:cwd_set` -> `sidebar.cwd.sync` for client request, `sidebar.cwd.set` for server notification
- `sidebar:agent_open` -> `sidebar.file.open`
- `sidebar:agent_edit` -> `sidebar.file.edit`
- `sidebar:mention` -> `sidebar.mention`
- `sidebar:event { type: "active_shortcut:set" }` -> `sidebar.activeShortcut.set`
- `sidebar:event { type: "refresh_active" }` -> `sidebar.activeShortcut.refresh`
- `sidebar:event { type: "drawer:state" }` -> `sidebar.drawer.state`
- `sidebar:event { type: "drawer:open" }` -> `sidebar.drawer.open`
- `sidebar:event { type: "drawer:close" }` -> `sidebar.drawer.close`
- `sidebar:event { type: "drawer:toggle" }` -> `sidebar.drawer.toggle`

## Implementation Files

Contract constants/parsers:

- `app/apps/file_editor_cm6/src/sidebar_ipc/rpc_contract.ts`
- `app/apps/file_editor_cm6/ui_ipc/sidebar_rpc_contract.py`

Current implementation/source surfaces:

- `app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py`
- `app/apps/file_editor_cm6/main_page/frontend/sidebar-shortcuts/runtime.ts`
- `app/apps/file_editor_cm6/main_page/frontend/sidebar-shortcuts/`
- `app/apps/file_editor_cm6/main_page/frontend/ui/sidebar-shortcuts-bootstrap.ts`
- `app/apps/file_editor_cm6/main_page/frontend/host-sidebar-runtime.ts`

## Cutover Rule

Do not collapse the physical transports until this contract and the editor/UI IPC RPC cutovers are coherent. Transport consolidation should preserve this logical namespace and route messages to the same backend ownership points; it should not move sidebar behavior into the gateway.
