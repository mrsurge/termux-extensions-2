# Execution Path & Technology Trace

This document outlines the full execution path from the initial script launch to the key functionalities of the `file_editor_cm6` app: **Agent Interaction**, **Atomic Write**, and **Live Read**.

## I. Application Bootstrap

The application startup process follows a chain of execution, progressively launching components.

1.  **`scripts/run_framework.sh`**
    *   **Technology**: Bash
    *   **Purpose**: The main entry point script.
    *   **Execution**:
        *   Sets environment variables (`TE_RUN_MODE`, `TE_RUN_ID`).
        *   Checks if a supervisor process is already running.
        *   If not, it uses `exec` to replace itself with the supervisor process: `python -m app.supervisor`.

2.  **`app/supervisor.py`**
    *   **Technology**: Python (`subprocess`, `signal`)
    *   **Purpose**: A lightweight process supervisor to monitor and manage the main Flask application.
    *   **Execution**:
        *   Launches the main Flask application as a subprocess: `python -m app.main`.
        *   It captures `SIGINT` and `SIGTERM` signals to gracefully shut down the main app process group.
        *   On exit, it performs cleanup of "framework shells" by calling `_cleanup_framework_shells()` from `app.libs.framework_shells`.

3.  **`app/main.py`**
    *   **Technology**: Python, Flask, Gunicorn (implied for production), `flask-sock` (WebSockets), `requests`.
    *   **Purpose**: The primary web server and reverse proxy. It loads all extensions and apps but **does not** run app backends directly.
    *   **Execution**:
        *   Creates a main Flask `app` instance.
        *   On the first request (`@app.before_request`), it lazy-loads all apps and extensions found in their respective directories by reading their `manifest.json` files.
        *   **App Proxying**: It acts as a reverse proxy for all apps.
            *   HTTP requests to `/api/app/<app_id>/...` and WebSocket connections to `/ws/app/<app_id>/...` are intercepted.
            *   These routes call `ensure_app_running(app_id)` from `app.libs.app_manager`. This function is responsible for starting the requested app's backend as a separate, dedicated process if it isn't already running.
            *   The main app then forwards the request/connection to the correct port for that app's worker process.

4.  **`app/apps/file_editor_cm6/manifest.json`**
    *   **Technology**: JSON
    *   **Purpose**: Declares the entry points for the `file_editor_cm6` app.
    *   **Content**: Specifies `"backend_blueprint": "main.py"`, telling the framework that `app/apps/file_editor_cm6/main.py` is the entry point for this app's dedicated backend server.

5.  **`app/apps/file_editor_cm6/main.py`**
    *   **Technology**: Python, Flask, `flask-sock`.
    *   **Purpose**: The dedicated backend server for the File Editor app. It runs in its own process, launched by the main app's proxy system.
    *   **Execution**:
        *   Creates its own Flask `Blueprint` and `Sock` instance.
        *   Defines all the specific HTTP routes (`/read`, `/write`) and WebSocket endpoints (`/ws/read`, `/ws/agent`) required for the editor's functionality.
        *   Imports and calls functions from the various `core_*.py` and `agent_*.py` modules to handle the logic.

---

## II. Key Functionality Paths

The following paths trace the three specific features requested. They all begin after the `file_editor_cm6` app's backend is running.

### A. Atomic Write

This flow describes how a file is saved safely to disk.

1.  **Client Action**: The user saves a file in the editor. The frontend sends a `POST` request to `/api/app/file_editor_cm6/write`.
2.  **Route Handling (`.../file_editor_cm6/main.py`)**:
    *   The `@file_editor_cm6_bp.post('/write')` route is triggered.
    *   It extracts the file `path`, `content`, and an optional `base_sha256` from the JSON request body.
    *   It calls `write_full()` from `core_write.py`.
3.  **Core Logic (`.../file_editor_cm6/core_write.py`)**:
    *   The `write_full()` function performs the atomic write.
    *   **Conflict Check**: If `base_sha256` is provided, it hashes the current file on disk. If the hashes don't match, it raises a `BaseMismatchError` to prevent overwriting unsaved changes (optimistic locking).
    *   **Atomic Operation**:
        1.  A temporary file is created in the same directory (`tempfile.NamedTemporaryFile`).
        2.  The new content is written to the temporary file.
        3.  `os.fsync()` is called to ensure the content is flushed to disk.
        4.  `os.replace()` (an atomic `rename` on POSIX systems) is used to move the temporary file to the final destination path. This is the key atomic step.
    *   On success, it returns the new file's metadata (hash, size, mtime).
4.  **Acknowledgement (`.../file_editor_cm6/main.py`)**:
    *   After `write_full` succeeds, the route handler calls `push_save_ack()` from `core_read.py`. This notifies other connected clients of the save and is used to prevent the original saving client from receiving a "self-echo" of its own change.

### B. Live Read

This flow describes how the editor receives real-time updates when a file is changed on disk by an external process.

1.  **Client Action**: The user opens a file. The frontend opens a WebSocket connection to `/ws/app/file_editor_cm6/ws/read?path=<file_path>`.
2.  **Route Handling (`.../file_editor_cm6/main.py`)**:
    *   The `@sock.route('/ws/read')` handler is triggered.
    *   It calls `init_watcher()` from `core_read.py` to start a file system watcher on the project root if one isn't already running.
    *   It then calls `subscribe(path, client_id, callback)` from `core_read.py`.
3.  **Subscription Logic (`.../file_editor_cm6/core_read.py`)**:
    *   The `subscribe()` function stores the WebSocket's `send` method as a callback for the given file path.
    *   It immediately reads the file's current content and sends a `replace_full` event to the new subscriber, so the editor is populated with the initial state.
4.  **File System Watcher (`.../file_editor_cm6/core_read.py`)**:
    *   A background thread runs, using the `watchdog` library (or a polling fallback).
    *   When any file in the project is modified, the watcher's handler is called.
    *   The event is **debounced** (delayed by ~150ms) to prevent event storms.
    *   After the delay, the file's new content is read from disk.
5.  **Event Emission (`.../file_editor_cm6/core_read.py`)**:
    *   The `_emit_event()` function is called.
    *   It looks up all callbacks subscribed to the modified file's path.
    *   It sends a `replace_full` event containing the new content to each subscribed client via their WebSocket callback.

### C. Agent Interaction

This flow describes the complex path of communicating with an AI agent (`gemini` or `codex`). This interaction is underpinned by the generic WebSocket forwarding architecture detailed in Section III.

1.  **Client Action**: The user initiates a chat. The frontend opens a WebSocket to `/ws/app/file_editor_cm6/agent`.
2.  **Proxy Handling (`app/main.py`)**:
    *   The generic WebSocket proxy `@sock.route('/ws/app/<app_id>/<path:subpath>')` intercepts the connection.
    *   It identifies `app_id` as `file_editor_cm6` and `subpath` as `agent`.
    *   It ensures the `file_editor_cm6` worker process is running and establishes a new, backend WebSocket connection to it at `ws://127.0.0.1:<worker_port>/ws/agent`.
    *   It then begins transparently relaying messages in both directions.
3.  **App Worker Handling (`.../file_editor_cm6/agent_ws.py`)**:
    *   The `@sock.route('/ws/agent')` handler in the app worker process receives the forwarded connection from the proxy.
    *   It acquires the singleton `AgentBridge` instance by calling `get_bridge()` from `agent_bridge.py`.
4.  **Agent Spawning (`.../file_editor_cm6/agent_bridge.py`)**:
    *   The `AgentBridge` finds or creates a long-running, shared shell process for the requested agent type (e.g., `gemini`).
    *   It calls `spawn_agent()`, which uses the `FrameworkShellManager` (`app/libs/framework_shells.py`) to run the agent's command-line tool (e.g., `gemini --experimental-acp`) inside a managed pseudoterminal (PTY).
5.  **Message Sending (Client -> Agent)**:
    *   The client sends a JSON message over its WebSocket.
    *   The main app's proxy relays it to the app worker.
    *   The `agent_ws.py` handler in the worker receives the message and calls `bridge.write_message()`.
    *   The `AgentBridge` selects the appropriate **Protocol Adapter** (`GeminiAdapter` or `CodexAdapter`).
    *   The adapter's `to_agent()` method translates the message into the agent's specific JSON-RPC format.
    *   The bridge writes the translated, line-delimited JSON string to the agent's PTY.
6.  **Message Receiving (Agent -> Client)**:
    *   The agent process writes its JSON-RPC response to its standard output.
    *   This output is captured and placed into a queue that `agent_ws.py` is subscribed to.
    *   A background thread in `agent_ws.py` reads the output and calls `bridge.parse_agent_output()`.
    *   The `Adapter.from_agent()` method translates the response back into the normalized format for the frontend.
    *   The `agent_ws.py` handler sends the normalized event to the proxy via its WebSocket.
    *   The main app's proxy relays the message to the original client.

---

## III. WebSocket Forwarding Architecture

The framework uses a generic, two-hop proxy architecture to route WebSocket traffic from a client browser to the correct on-demand app worker process. This allows multiple apps to expose WebSockets without needing to be loaded into the main process.

1.  **Hop 1: Client to Main App Proxy**
    *   **File**: `app/main.py`
    *   **Endpoint**: `@sock.route('/ws/app/<app_id>/<path:subpath>')`
    *   **Technology**: `flask-sock`
    *   **Logic**:
        *   A client (e.g., the browser) establishes a WebSocket connection to this single, generic endpoint. For example, to connect to the agent, the URL is `/ws/app/file_editor_cm6/agent`.
        *   The `proxy_app_websocket` function is invoked with `app_id='file_editor_cm6'` and `subpath='agent'`.
        *   It calls `ensure_app_running(app_id)` to guarantee the target app worker process is running and listening on a dedicated port.

2.  **Hop 2: Main App Proxy to App Worker**
    *   **File**: `app/main.py`
    *   **Technology**: `simple-websocket` (as a client)
    *   **Logic**:
        *   The `proxy_app_websocket` function constructs a new, internal WebSocket URL based on the worker's port and the `subpath`. The path is rewritten according to the convention: `/ws/app/<app_id>/<route>` becomes `ws://127.0.0.1:<worker_port>/ws/<route>`.
        *   It then acts as a WebSocket *client*, connecting to the app worker's specific WebSocket endpoint (e.g., `ws://127.0.0.1:8081/ws/agent`).
        *   The connection is received by the corresponding `@sock.route` in the app worker's code (e.g., `@sock.route('/ws/agent')` in `agent_ws.py`).

3.  **Bidirectional Message Relaying**
    *   **File**: `app/main.py`
    *   **Technology**: `threading`
    *   **Logic**:
        *   Once both WebSocket connections (client-to-proxy and proxy-to-worker) are established, the `proxy_app_websocket` function spawns two threads.
        *   `forward_client_to_worker`: Runs a loop that blocks on `client_ws.receive()` and immediately sends any received message to the `worker_ws`.
        *   `forward_worker_to_client`: Runs a loop that blocks on `worker_ws.receive()` and immediately sends any received message to the `client_ws`.
        *   This creates a completely transparent, bidirectional pipe. The main proxy app does not inspect or modify the content of the WebSocket messages; it only relays them between the browser and the correct app worker.
