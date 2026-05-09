# App Services (Main-Process Modules)

This directory contains **app-specific services** that run in the **main server
process**, not in the app worker. These modules are loaded at framework startup
via the apps extension loader and can register routes, websocket proxies, or
other infrastructure that should outlive worker restarts.

## Why this exists

We split services from workers to avoid transport interference and reconnect
loops. Socket.IO route-level proxying is now framework-owned through the
manifest-declared `sio_service.json` surface instead of one handwritten service
module per Engine.IO path.

## How it’s loaded

The app manifest declares a `services` entry for non-Socket.IO service modules:

```
"services": {
  "path": "services",
  "modules": ["vscode_rpc_transport", "sidebar_backchannel_uds"]
}
```

Socket.IO route proxies are declared separately:

```
"sio_service": "sio_service.json"
```

The apps extension loader imports each module and:
- calls `register(app)` if present
- auto-registers any `APIRouter` found in the module

## Service module contract

A service module can export either or both:

- `register(app)`: imperative hook for mounting or custom setup
- `APIRouter` instances for standard route registration

## Current services

- `vscode_rpc_transport.py` — Proxy-only WebSocket shim mounted at
  `/vscode_rpc_ws` that forwards frames to the `vscode_rpc` framework shell.
- `sidebar_backchannel_uds.py` — Main-process Unix domain socket JSON-RPC host
  for sidebar backchannel transport (Phase 0 scaffolding: `session.hello`,
  `health.ping`, structured request logs, safe socket lifecycle).
- `../sio_service.json` — Framework-owned raw Socket.IO route proxy definition
  for the app-worker endpoint and the adapter-owned WBA endpoint. Logical
  namespaces remain owned by the upstream Socket.IO servers.

## TE2 runtime-owned mounts

The framework-owned TE2 console and TE2 MCP transports are mounted from the
runtime layer, not from this app-service directory:

- `app/te2_console_runtime.py` — canonical TE2 console runtime and Socket.IO
  namespace/path definitions
- `app/te2_runtime_mounts.py` — mounts `/te2_console_ws/socket.io`, `/te2_mcp`,
  and `/te2_mcp_http` from `app/main.py`
