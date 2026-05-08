# File Editor CM6 Transport Collapse Plan

## Status

Active execution plan for the transport-collapse slice under `FILE_EDITOR_CM6_REFACTOR_NORTH_STAR.md`.

Phase one is implemented in the current tree. Phase two remains planned.

This plan splits the old single "collapse Socket.IO" idea into two phases:

1. Collapse the worker-owned Python Socket.IO layer inside `file_editor_cm6` and add `msgspec` envelope validation.
2. Move physical Socket.IO relay/routing into a framework-owned manifest-declared `sio_service.json` system.

The split matters because the first phase is app-local and can preserve current public paths, while the second phase is a TE2 framework capability that should replace bespoke app `services/*_transport.py` modules.

## Current State

Before phase one, worker-owned Python Socket.IO servers were split across separate ASGI apps:

- `app/apps/file_editor_cm6/monaco_editor/editor_socketio.py` registers `/rpc/editor`.
- `app/apps/file_editor_cm6/explorer/transport/socketio_app.py` registers `/rpc/explorer`.
- `app/apps/file_editor_cm6/ui_ipc/ui_ipc_socketio.py` registers `/ui_ipc` and `/sidebar_ipc`.
- `app/apps/file_editor_cm6/terminal_socketio.py` registers `/terminal`.

Phase one now uses one app-local worker gateway:

- `app/apps/file_editor_cm6/socketio_gateway.py` creates the single Python `socketio.AsyncServer`.
- The gateway registers `/rpc/editor`, `/rpc/explorer`, `/ui_ipc`, `/sidebar_ipc`, and `/terminal`.
- `app/apps/file_editor_cm6/main.py` mounts that same ASGI app under the existing physical paths:

- `/editor_ws/socket.io`
- `/explorer_ws/socket.io`
- `/ui_ipc_ws/socket.io`
- `/terminal_ws/socket.io`

Main-process service modules still proxy those physical paths back to the worker, and `services/wba_transport.py` still separately proxies `/wba_ws/socket.io` to the Node WBA service.

`msgspec` is now declared in `requirements.txt`, which is also the dynamic dependency source for `pyproject.toml`.

## Phase One: App-Local Python Socket.IO Collapse

Goal: make `file_editor_cm6` own one worker-side Python Socket.IO server instance for its Python namespaces, without changing domain ownership or requiring the framework-level relay system first.

### Scope

Phase one includes:

- Add `msgspec` to `requirements.txt`.
- Add an app-local Socket.IO gateway module, for example `app/apps/file_editor_cm6/socketio_gateway.py`.
- Register the existing Python namespace handlers on one `socketio.AsyncServer`:
  - `/rpc/editor`
  - `/rpc/explorer`
  - `/ui_ipc`
  - `/sidebar_ipc`
  - `/terminal`
- Keep terminal server attachment behavior via `attach_terminal_socketio_server(...)`.
- Use the largest existing buffer requirement, currently UI IPC's `8 * 1024 * 1024`, on the collapsed server.
- Use `msgspec` for JSON-RPC 2.0 envelope validation/conversion at the Python Socket.IO edge.
- Preserve current logical namespace ownership. The gateway must not become a domain dispatcher.
- Preserve current physical paths in this phase unless a later approved substep changes frontend/Android callers:
  - mount the same collapsed worker ASGI app under the existing worker paths initially.
  - leave main-process websocket proxy paths stable for current clients.

### Non-Scope

Phase one does not include:

- Moving `/wba` behavior into the Python worker.
- Rewriting the Node WBA Socket.IO service.
- Moving SSOT, project state, terminal semantics, Explorer behavior, editor behavior, or WBA behavior into the gateway.
- Replacing the main-process service-loader model.
- Changing Android physical Socket.IO paths unless Android edits are explicitly approved.
- Removing old physical path compatibility before current clients are migrated.

### Proposed Implementation Shape

1. Create a `msgspec` JSON-RPC envelope codec module for the app Socket.IO layer.
   - Validate request, notification, result, and error envelopes with `msgspec.Struct` / `msgspec.convert(...)`.
   - Keep namespace-specific payload parsing in the existing contract modules.
   - Do not turn the codec into a giant domain schema registry.

2. Create one worker-side Socket.IO gateway module.
   - Instantiate one `socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*", max_http_buffer_size=8 * 1024 * 1024)`.
   - Register the existing namespace classes directly.
   - Export one ASGI app object.

3. Update worker mount wiring.
   - Change `main.py` `SUBAPPS` so current physical worker paths point at the same collapsed ASGI app.
   - Replace old per-surface Socket.IO modules with import-compatible shims or remove their imports if no longer needed.
   - Ensure importing old modules cannot create extra `AsyncServer` instances.

4. Keep frontend physical paths stable in phase one.
   - `src/rpc/socketio-topology.ts` can remain unchanged for the first code slice.
   - This avoids bundling Android path migration into the app-local Python collapse.

5. Validate locally without restarting the shared framework server.
   - `python -m py_compile` on touched backend files.
   - Import smoke for the new gateway module and namespace registration.
   - App typecheck/build only if frontend source changes.
   - `git diff --check`.

### Phase One Success Criteria

- Done: one Python `socketio.AsyncServer` instance owns the app's Python Socket.IO namespaces.
- Done: existing logical namespaces still work through the same namespace handler classes.
- Done: existing physical paths remain stable.
- Done: JSON-RPC envelope parsing has a shared `msgspec`-validated boundary at `socketio_jsonrpc.py`.
- Done: no domain ownership moved into the gateway.
- Done: no Android edits were required for the first Python-layer collapse.

### Phase One Implementation Notes

- `app/apps/file_editor_cm6/socketio_gateway.py` owns the shared server and ASGI app.
- `app/apps/file_editor_cm6/socketio_jsonrpc.py` owns shared JSON-RPC 2.0 envelope validation/conversion with `msgspec`.
- The old per-surface Socket.IO app modules are import-compatible shims and do not create extra `AsyncServer` instances:
  - `monaco_editor/editor_socketio.py`
  - `explorer/transport/socketio_app.py`
  - `ui_ipc/ui_ipc_socketio.py`
  - `terminal_socketio.py`
- `app/apps/file_editor_cm6/main.py` mounts the shared ASGI app at `/editor_ws/socket.io`, `/explorer_ws/socket.io`, `/ui_ipc_ws/socket.io`, and `/terminal_ws/socket.io`.
- Local validation for the slice passed:
  - targeted `basedpyright`
  - targeted `python -m py_compile`
  - gateway import/alias smoke
  - JSON-RPC parser smoke
  - `rg` check proving only `socketio_gateway.py` constructs `socketio.AsyncServer(...)`
  - `git diff --check`

## Phase Two: Framework `sio_service.json` Relay

Goal: replace bespoke app `services/*_transport.py` Socket.IO websocket proxy scripts with a framework-owned relay declared by the app manifest.

### Target Shape

The app manifest points to a Socket.IO service definition, for example:

```json
{
  "sio_service": "sio_service.json"
}
```

The app-local `sio_service.json` defines physical mount and namespace routing, for example:

```json
{
  "mount": "/apps/file_editor_cm6/socket.io",
  "app_id": "file_editor_cm6",
  "namespaces": {
    "/rpc/editor": { "target": "app_worker" },
    "/rpc/explorer": { "target": "app_worker" },
    "/ui_ipc": { "target": "app_worker" },
    "/sidebar_ipc": { "target": "app_worker" },
    "/terminal": { "target": "app_worker" },
    "/wba": { "target": "adapter", "service": "workbench_adapter" }
  }
}
```

The framework relay owns:

- physical Socket.IO mount registration
- route lookup from app manifest metadata
- websocket frame relay/proxying
- target discovery for app worker and adapter-owned endpoints
- stable compatibility aliases only when explicitly declared in the JSON file

The framework relay must not own:

- editor SSOT
- Explorer behavior
- UI IPC semantics
- sidebar shortcut behavior
- terminal execution semantics
- WBA provider behavior
- JSON-RPC method dispatch

### Phase Two Success Criteria

- The physical app Socket.IO shape is manifest-declared instead of hardcoded in multiple service modules.
- `file_editor_cm6` no longer needs bespoke `editor_transport.py`, `explorer_transport.py`, `ui_ipc_transport.py`, `terminal_transport.py`, or `wba_transport.py` just to proxy Socket.IO frames.
- Logical namespaces remain stable unless a contract revision explicitly removes one.
- Compatibility aliases are visible in `sio_service.json`, not hidden in Python fallback code.
- The relay is reusable by other TE2 apps and is not a `file_editor_cm6`-specific gateway in disguise.

## Execution Order

1. Update planning docs to record this two-phase shape.
2. Completed: execute phase one as an app-local backend slice.
3. Completed: validate phase one with local backend checks. Live TE2 runtime checks remain explicit-approval only.
4. Completed: record phase-one durable facts in repo memory.
5. Design and implement the framework `sio_service.json` relay as its own later phase.
6. Migrate `file_editor_cm6` physical paths to the framework relay only after the relay exists and current clients are accounted for.
