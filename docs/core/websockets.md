# WebSocket And Socket.IO Boundaries

The Rust/Axum framework owns public proxy routing. There is no Flask websocket
server or Python main-framework websocket registry.

## Rust Proxy Surfaces

- `app_proxy.rs` proxies generic app-worker HTTP and WebSocket routes.
- Manifest `sio_service` declarations register concrete Socket.IO public paths
  and aliases, including Engine.IO polling and WebSocket upgrades.
- `proxy_transport.rs` contains shared HTTP/WebSocket bridge behavior.
- `apps_lifecycle.rs` owns `/ws/apps` lifecycle events.
- `runtime_bridge.rs` exposes Ferrous/FWS routes and proxies TE2 console/FastMCP
  routes to the Python runtime sidecar.

The Rust proxy does not move application behavior into the framework. A running
app worker or declared static service remains the upstream authority.

## Code TE2 Socket.IO Lanes

`app/apps/file_editor_cm6/sio_service.json` exposes the worker-owned physical
Socket.IO service and the adapter-owned WBA service. Current logical namespaces
are:

- `/rpc/editor` for editor RPC;
- `/rpc/explorer` for Explorer RPC;
- `/ui_ipc` for host UI IPC;
- `/sidebar_ipc` for backend sidebar-app IPC;
- `/terminal` for terminal traffic;
- `/wba` for direct Workbench Adapter intelligence;
- `/te2_console` for the framework console sidecar.

Each frontend surface uses its assigned lane. Cross-surface behavior goes
through that surface's backend and the target backend hook; frontends do not
connect directly to another surface's private namespace.

## Debugging

Use TE2 console tools for browser/runtime observability and Framework-Shells
tools for process stdio. Identify the exact console worker or app shell before
inspection; neither visible UI state nor an old websocket document is runtime
authority.
