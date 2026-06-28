# Explorer RPC transport

## Scope

This document describes the live Explorer-owned frontend/backend transport in `file_editor_cm6` after the Explorer JSON-RPC cutover.

It covers the Explorer-owned lane only. The temporary non-Explorer backends that still emit Explorer-facing state are intentionally **not** part of this transport design; that follow-up is parked in `docs/planning/EXPLORER_CROSS_BACKEND_HOOK_SURFACES_PLAN.md`.

## Live transport topology

The live Explorer worker transport is:

- Socket.IO mount path: `/explorer_ws/socket.io`
- Explorer RPC namespace: `/rpc/explorer`
- request event: `rpc`
- server notification event: `rpc.notify`

The worker-owned Socket.IO app is mounted in:

- `app/apps/file_editor_cm6/explorer/transport/socketio_app.py`

The JSON-RPC namespace adapter lives in:

- `app/apps/file_editor_cm6/explorer/transport/rpc_socketio.py`

The Explorer backend composition shell lives in:

- `app/apps/file_editor_cm6/explorer_runtime.py`

## Wire contract

Explorer frontend/backend traffic is JSON-RPC 2.0 on the live wire.

### Requests

Frontend requests arrive on `/rpc/explorer` as:

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "method": "explorer.list",
  "params": { "path": "." }
}
```

The namespace parses the JSON-RPC request, resolves the backend dispatcher message type from `DISPATCHER_MESSAGE_TYPE_BY_RPC_METHOD`, and calls `ExplorerDispatcher.dispatch_message(...)`.

Representative methods:

| RPC method | Internal dispatcher label |
| --- | --- |
| `explorer.list` | `explorer:list` |
| `explorer.refresh` | `explorer:refresh` |
| `explorer.project.open` | `project:open` |
| `explorer.git.status.get` | `git:status` |
| `explorer.search.run` | `search:run` |
| `explorer.review.save` | `review:save` |
| `explorer.watcher.config.get` | `watcher:getConfig` |

Those colon-labeled strings are now an internal backend dispatch seam, not a live wire protocol.

### Success replies

When a request expects a reply, the namespace returns a JSON-RPC result:

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "result": { "ok": true }
}
```

### Error replies

Protocol or handler failures return JSON-RPC errors:

```json
{
  "jsonrpc": "2.0",
  "id": "req-123",
  "error": {
    "code": -32000,
    "message": "Explorer RPC request failed"
  }
}
```

### Notifications

Explorer-owned backend fanout is emitted as JSON-RPC notifications on `rpc.notify`:

```json
{
  "jsonrpc": "2.0",
  "method": "explorer.list.updated",
  "params": { "path": ".", "entries": [] }
}
```

Representative live notification methods:

| Method | Meaning |
| --- | --- |
| `explorer.list.updated` | directory/list refresh payload |
| `explorer.openDirs.updated` | persisted open-dirs state |
| `explorer.activeFile.updated` | active file state |
| `explorer.project.active.updated` | active project switch |
| `explorer.git.status.updated` | project git status |
| `explorer.git.decorations.updated` | per-entry git decorations |
| `explorer.review.entries.updated` | review list refresh |
| `explorer.search.results.updated` | search result refresh |
| `explorer.watcher.files` | watcher change payload |
| `explorer.watcher.config.updated` | watcher config snapshot |
| `explorer.prefs.ui.updated` | explorer UI prefs |
| `explorer.decorations.updated` | draft/diagnostic decoration refresh |
| `explorer.pulse` | keepalive pulse |
| `explorer.error` | explorer-scoped backend error |

## Removed legacy Explorer-owned surfaces

The following Explorer-owned legacy surfaces are removed from the live worker path:

- legacy Explorer namespace `/explorer`
- legacy websocket route `/ws/explorer`
- legacy outbound `{ type, payload }` Explorer notification envelopes
- legacy notification rewrap path that converted backend `type` messages into RPC notifications

The current live Explorer transport should be treated as JSON-RPC-native.

## Important boundary

Explorer transport ownership is now explicit:

- Explorer backend owns the Explorer transport
- Explorer frontend owns Explorer UI mutation
- non-Explorer backends should not use Explorer frontend transports as backend-to-backend buses

The temporary exceptions that still exist outside the Explorer tree are intentionally parked for later hook-surface work. See:

- `docs/planning/EXPLORER_CROSS_BACKEND_HOOK_SURFACES_PLAN.md`

## Current implementation notes

1. `explorer_runtime.py` emits Explorer-owned notifications directly as JSON-RPC envelopes.
2. `explorer/transport/rpc_contract.py` is the Python-side source of truth for Explorer RPC request parsing and method mapping.
3. `explorer/transport/connection_manager.py` fans notifications out to per-project clients and now accepts JSON-RPC envelopes directly.
4. `explorer/transport/rpc_socketio.py` is the only live namespace adapter for Explorer RPC traffic.
5. Some backend internals still use colon-style dispatcher labels for request routing and short-lived reply bookkeeping. That internal seam does not change the on-wire JSON-RPC contract.
