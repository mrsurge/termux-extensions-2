# Socket.IO Integration Method
**Date:** 2025-12-08
**Status:** Production
**Component:** `app/apps/file_editor_cm6`

## Overview
This document describes the method used to integrate Socket.IO into the existing FastAPI/NiceGUI architecture to support the File Explorer's real-time updates. The challenge was to add a Socket.IO namespace (`/explorer`) alongside the existing NiceGUI application (which already uses Socket.IO internally) without creating port conflicts or "split-brain" server instances.

## The Architecture

### 1. The "Piggyback" Strategy
Instead of running a separate Socket.IO server for the explorer, we attach our custom namespace to the **existing NiceGUI Socket.IO instance**.

*   **NiceGUI** initializes its own `socketio.AsyncServer` (available as `nicegui.nicegui.sio`).
*   **We register** our `ExplorerSocketIONamespace` directly onto that existing server instance.
*   **Result:** Both NiceGUI's internal events and our custom explorer events travel over the same physical WebSocket connection (or at least the same port/server).

### 2. Implementation Details

#### A. The Namespace (`explorer_ws.py`)
We define a custom `socketio.AsyncNamespace` that handles explorer-specific events.

```python
# app/apps/file_editor_cm6/explorer_ws.py
class ExplorerSocketIONamespace(socketio.AsyncNamespace):
    def __init__(self, namespace='/explorer'):
        super().__init__(namespace)
        # ... dispatcher management ...

    async def on_connect(self, sid, environ):
        # Create a shim that looks like a WebSocket to our existing dispatcher logic
        ws = SocketIOSocketShim(self, sid)
        dispatcher = ExplorerDispatcher(ws)
        await dispatcher.initialize()
        # ...
```

#### B. The Registration Hook (`main.py`)
We use a special initialization hook `init_nicegui_with_app` in the app's `main.py`. This function is called by the worker process (`app_worker.py`) *after* the FastAPI app is created but *before* the server starts serving requests.

```python
# app/apps/file_editor_cm6/main.py

def init_nicegui_with_app(fastapi_app):
    # ... standard NiceGUI setup ...
    
    # CRITICAL: Register our namespace onto NiceGUI's existing server
    import nicegui.nicegui as ng
    from app.apps.file_editor_cm6.explorer_ws import ExplorerSocketIONamespace
    
    # This is the magic line:
    ng.sio.register_namespace(ExplorerSocketIONamespace('/explorer'))
```

#### C. The Client-Side Connection (`template.html`)
The frontend explicitly connects to this namespace using the `socket.io-client` library.

```javascript
// app/apps/file_editor_cm6/template.html

// 1. Load the library
import { io } from "/ui/_nicegui/static/socket.io.min.js";

// 2. Connect to the specific namespace
const socket = io("/explorer", {
    path: "/ui/_nicegui_ws/socket.io", // Must match the proxy path
    transports: ["websocket", "polling"],
    // ...
});

// 3. Handle events
socket.on("connect", () => {
    console.log("[Explorer] Connected via Socket.IO");
});
```

### 3. The Proxy Layer (`app/main.py`)
Since the application runs behind a main proxy (the "Launcher" or "Framework"), we must ensure Socket.IO traffic is correctly forwarded to the worker process.

*   **HTTP Polling:** The route `/ui/_nicegui_ws/socket.io/{rest:path}` forwards HTTP polling requests.
*   **WebSocket Upgrade:** The websocket route `/ui/_nicegui_ws/socket.io/{rest:path}` handles the connection upgrade.
*   **Referer Detection:** The proxy uses the `Referer` header (or `app_id` query param) to determine which worker process (e.g., `file_editor_cm6`) should receive the traffic.

## Key Benefits
1.  **Single Port:** No need to open extra ports for the explorer.
2.  **Shared Session:** Potential to share authentication/session state with NiceGUI (though currently loosely coupled).
3.  **Robustness:** Leverages Socket.IO's reconnection logic (heartbeats, fallbacks) which is more robust than raw WebSockets for mobile/unstable networks.

## Files Involved
*   `app/apps/file_editor_cm6/explorer_ws.py`: The Namespace class.
*   `app/apps/file_editor_cm6/main.py`: The registration hook.
*   `app/apps/file_editor_cm6/template.html`: The client-side connection code.
*   `app/main.py`: The proxy forwarding logic.
