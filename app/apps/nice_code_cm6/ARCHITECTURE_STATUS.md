# Nice Code CM6 — Phase 1 Architecture Snapshot

Last updated: November 2, 2025

## Current Layout

- **Worker entrypoint:** `app/apps/nice_code_cm6/main.py`
  - Registers a NiceGUI page at `/ui`
  - Exposes a JSON health probe at `/status`
  - Provides `run_worker()` so the NiceGUI server (uvicorn) replaces the default Flask server launched by `app.libs.app_worker`
- **Launcher template:** `app/apps/nice_code_cm6/template.html`
  - Embedded by `app_shell.html`
  - Loads the NiceGUI UI inside a full-height iframe via `/api/app/nice_code_cm6/ui`
- **App manifest:** `app/apps/nice_code_cm6/manifest.json`
  - Declares backend entrypoint (`main.py`) and frontend template (`template.html`)
  - Uses `icon_emoji` for the Apps launcher grid
  - Adds a `worker_proxy` section so the framework registers HTTP/WS proxy routes automatically (`_nicegui`, `_nicegui_ws/socket.io`, `_nicegui/ws`)

## Framework Integration

- **Worker orchestration:** `app/libs/app_worker.py`
  - Recognises optional `init_app()` / `run_worker()` hooks so NiceGUI can own the server loop
- **HTTP proxy routes:** `app/main.py#L408-L487`
  - `/api/app/<app_id>/<path:subpath>` forwards REST calls to the worker
  - `_register_worker_proxy_routes` reads the manifest `worker_proxy.http` list and binds `/prefix` and `/prefix/*` handlers dynamically
- **WebSocket proxy helpers:** `app/main.py#L825-L925`
  - `_register_worker_proxy_routes` also binds WebSocket endpoints listed in `worker_proxy.websocket`, forwarding through `_proxy_app_websocket`
  - `raw=True` entries bypass the legacy `/ws/…` prefix so NiceGUI’s Socket.IO channel upgrades correctly

## Outstanding Issue

## Outstanding Issue

Socket.IO upgrades are still failing (HTTP 400/404) when the browser attempts to switch to the WebSocket transport via `/_nicegui_ws/socket.io`. The HTTP polling handshake succeeds, but the upgrade path is not yet wired correctly through the framework proxy, so events such as `ui.notify` never reach the client.

### Next Steps

1. Adjust the worker proxy routing so `/_nicegui_ws/socket.io` upgrades are handled directly (or eliminate the iframe/proxy hop).
2. Verify in DevTools that the upgrade responds with 101 Switching Protocols.
3. Trigger `ui.notify("test")` from the worker and confirm the toast appears without console errors.
