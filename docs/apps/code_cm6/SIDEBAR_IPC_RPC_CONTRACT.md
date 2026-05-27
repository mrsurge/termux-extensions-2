# Code TE2 Sidebar IPC/RPC Contract

## Status

Typed contract definition for the live `/sidebar_ipc` lane.

The live implementation accepts typed JSON-RPC envelopes on `/sidebar_ipc`. Legacy `sidebar:*` event names are retired from the active source path.

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
- external/sidebar-originated project lookup/open/create requests, routed through backend project hooks
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
- `sidebar.project.lookup`
  - Checks whether a path is an official known project root.
  - Params: `{ path }`.
  - Known means the history store contains the logical path and the project sidecar file exists.
- `sidebar.project.open`
  - Opens a known project root through backend project hooks.
  - Params: `{ path }`.
  - This refuses paths that are not in project history or have no sidecar.
- `sidebar.project.create`
  - Creates or optionally adopts a project from a target path through backend project hooks.
  - Params: `{ path, adoptExisting?, open? }`.
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
- `sidebar.project.opened`
  - Params: `{ path, resolved_path, state, source, ts }`.
  - Sent after sidebar IPC successfully opens or creates-and-opens a project. Host clients consume this via their existing sidebar IPC frontend transport and run their own project-open resync.
- `sidebar.activeShortcut.refresh`
  - Params: `{ client_id? , flushCache? , source? }`.
- `sidebar.drawer.state`
  - Params: `{ open, source, ts }`.
- `sidebar.drawer.open`, `sidebar.drawer.close`, `sidebar.drawer.toggle`
  - Params: `{ source? , ts? }`.

## Project Ownership Rule

Sidebar IPC is only the transport edge for sidebar clients. Project lookup/open/create behavior is owned by backend project hooks that reuse the same history store, sidecar lookup, project-root switch, terminal cleanup, diagnostics stop, adapter termination, retired change-ledger cleanup, and cwd fanout used by the existing backend project route family. Frontend synchronization after `sidebar.project.opened` happens over the receiving frontend's existing sidebar IPC transport.

## Implementation Files

Contract constants/parsers:

- `app/apps/file_editor_cm6/src/sidebar_ipc/rpc_contract.ts`
- `app/apps/file_editor_cm6/ui_ipc/sidebar_rpc_contract.py`

Current implementation/source surfaces:

- `app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py`
- `app/apps/file_editor_cm6/host/project_backend.py`
- `app/apps/file_editor_cm6/main_page/backend/project_service.py`
- `app/apps/file_editor_cm6/main_page/frontend/sidebar-shortcuts/runtime.ts`
- `app/apps/file_editor_cm6/main_page/frontend/sidebar-shortcuts/`
- `app/apps/file_editor_cm6/main_page/frontend/ui/sidebar-shortcuts-bootstrap.ts`
- `app/apps/file_editor_cm6/main_page/frontend/host-sidebar-runtime.ts`

## Cutover Rule

Do not collapse the physical transports until this contract and the editor/UI IPC RPC cutovers are coherent. Transport consolidation should preserve this logical namespace and route messages to the same backend ownership points; it should not move sidebar behavior into the gateway.
