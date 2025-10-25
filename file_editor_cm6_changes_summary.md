# file_editor_cm6 — Canonical Technical Overview (October 2025)

This document provides a comprehensive, up-to-date technical overview of the `file_editor_cm6` application, expanded with code snippets for clarity. It reflects the current working state, architecture, and all recent modifications, superseding all previous summary documents.

---

## 1. Recent Changes & Fixes (October 2025)

This section details the recent fixes that have been implemented to address critical bugs.

### 1.1. Universal WebSocket Port Resolution
- **Problem:** The frontend was unable to connect to the app's WebSocket handler because it was targeting the main framework's port, not the app worker's dynamic port.
- **Fix:** A universal, app-agnostic mechanism was implemented to allow the frontend to discover the correct worker port.

  **1. Backend Port Hinting (`main.py`):** The main framework's reverse proxy now adds an `X-App-Worker-Port` header to all proxied app responses.
    ```python
    # In the proxy_app_request function
    resp = Response(
        stream_with_context(upstream.iter_content(chunk_size=8192)),
        status=upstream.status_code,
        headers=resp_headers,
    )
    # Universal hint for clients: current worker port for this app
    resp.headers['X-App-Worker-Port'] = str(port)
    return resp
    ```

  **2. Frontend Port Discovery Helper (`app/static/js/ws_port.js`):** A new shared helper was created to read this header and construct a correct WebSocket URL.
    ```javascript
    // app/static/js/ws_port.js
    (function () {
      async function getWsPort(appId) {
        const r = await fetch(`/api/app/${encodeURIComponent(appId)}/status`, { cache: 'no-store' });
        const p = r.headers.get('X-App-Worker-Port');
        if (!p) throw new Error('WS port header missing');
        return Number(p);
      }

      async function buildWsUrl(appId, path, clientId) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const port  = await getWsPort(appId);
        return (
          `${proto}//${location.hostname}:${port}/ws/read` +
          `?path=${encodeURIComponent(path)}` +
          `&client_id=${encodeURIComponent(clientId)}`
        );
      }

      window.wsPort = { getWsPort, buildWsUrl };
    })();
    ```

  **3. Integration:** The base template `app/templates/app_shell.html` was updated to include the new script, and the editor's `main.js` was modified to use it.
    ```javascript
    // In app/apps/file_editor_cm6/main.js -> openWebSocket()
    const appId = 'file_editor_cm6';
    const wsUrl = await window.wsPort.buildWsUrl(appId, path, clientId);
    ws = new WebSocket(wsUrl);
    ```

### 1.2. Path Resolution & Normalization
- **Problem:** A series of bugs caused incorrect file paths to be used, leading to "File not found" errors and failed WebSocket connections.
- **Fixes:**
  1.  **Frontend:** The logic for opening files from the explorer was corrected to resolve paths relative to the current project root.
  2.  **Backend (`core_read.py`):** The file watching logic was overhauled to use a `_norm_path` function, ensuring that the path used when subscribing to a file change perfectly matches the path used when an event is emitted.
      ```python
      # In app/apps/file_editor_cm6/core_read.py
      def _norm_path(p: str) -> str:
          """Canonical absolute path used for both subscribe keys and emitted events."""
          try:
              return str(Path(p).resolve())  # resolves symlinks when possible
          except Exception:
              return str(Path(p).absolute())

      # Example usage in the subscribe function
      def subscribe(path: str, token: str, on_event):
          key = _norm_path(path)
          bucket = _subscribers[key]
          # ...
      ```
  3.  **Backend (`main.py`):** The `/ws/read` and `/write` endpoints were updated to correctly handle relative paths from the frontend and to use a more robust security check.

### 1.3. UI/UX Enhancements
- **Drawer Layout:** The file explorer drawer was restyled to occupy 75% of the screen width, and its internal layout was improved with Flexbox.
- **Theming:** The drawer's hardcoded CSS colors were replaced with the framework's shared theme variables (`--card`, `--border`, etc.).

---

## 2. High-Level Architecture

- **Single-User, Localhost Model:** The application is designed for a single user, with exactly one document considered “open” at a time.
- **Split UI/Backend:**
  - **Frontend (CodeMirror 6):** Renders the editor, manages autosave/manual save, and connects via a single WebSocket for live file updates. It communicates with the backend via REST for writes, preferences, and history.
  - **Backend (Flask + Flask-Sock):** Exposes a set of REST and WebSocket routes under the app’s unique prefix (`/api/app/file_editor_cm6`).
- **Optimistic Concurrency:** File saves include a `base.sha256` hash of the buffer the user started with. If the file has changed on disk in the meantime, the server returns a `409 BASE_MISMATCH` error, prompting the client to reload and retry.

---

## 3. Framework Loading & App Lifecycle

1.  **App Discovery:** The main framework scans `app/apps/*/manifest.json` to find and register the application.
2.  **Blueprint Mounting:** The app's `main.py` defines a Flask Blueprint which is mounted by the framework at the `/api/app/file_editor_cm6` prefix.
3.  **Template Rendering:** A `GET` request to `/app/file_editor_cm6` renders the `template.html` file, which serves as the main page for the application.
4.  **Static Asset Mapping:** The app's `static` directory is served at `/apps/file_editor_cm6/static/`, allowing the template to load `main.js`, CSS, and other assets.

---

## 4. Core Components & File Structure

```
app/apps/file_editor_cm6/
  ├── main.py                 # Flask blueprint, REST & WebSocket API endpoints.
  ├── main.js                 # Frontend logic: CM6 setup, UI, WebSocket handling, save logic.
  ├── template.html           # App's HTML structure: toolbar, drawer, editor host.
  ├── core_read.py            # File watcher (Watchdog/polling) and event fan-out.
  ├── core_write.py           # Atomic full-file writes with optional base hash check.
  ├── history_store.py        # Per-project recent file history.
  ├── explorer_helper.py      # Manages the active project root and lists directory contents.
  └── static/
      └── js/
          ├── explorer.js     # UI logic for the file explorer drawer.
          └── explorer.css    # Styling for the file explorer drawer.
```

---

## 5. Backend API & Data Contracts

All endpoints are prefixed with `/api/app/file_editor_cm6`.

### 5.1. WebSocket (`/ws/read`)
- **Purpose:** Provides real-time file change notifications.
- **Connection:** `GET /ws/read?path=<rel_path>&client_id=<id>`
- **Lifecycle:** On connect, the server subscribes the client to events for the given file path. It immediately sends one `replace_full` event as an initial snapshot.
- **Code Snippet (`app/apps/file_editor_cm6/main.py`):**
  ```python
  @sock.route('/ws/read')
  def ws_read(ws):
      """WebSocket endpoint for file change notifications."""
      path = request.args.get('path')
      client_id = request.args.get('client_id', 'unknown')

      if not path:
          ws.close(reason='Missing path parameter')
          return

      project_root = get_project_root()
      rel_path = path

      # Security check logic...

      init_watcher(project_root)
      token = subscribe(project_root, str(rel_path), client_id, lambda event: ws.send(json.dumps(event)))

      try:
          while True:
              msg = ws.receive()
              if msg is None: break
      finally:
          unsubscribe(token)
  ```
- **Events (Server -> Client):**
  - `replace_full`: An authoritative snapshot of the file content. The `path` in this event is a normalized, absolute path.
    ```json
    {"type":"replace_full","path":"/path/to/file.txt","content":"...","language":"python"}
    ```
  - `save_ack`: Confirms that a client-initiated save operation has completed.
    ```json
    {"type":"save_ack","path":"/path/to/file.txt","op_id":"...","client_id":"..."}
    ```

### 5.2. File Write (`/write`)
- **Method:** `POST`
- **Body:** `{ path, content, client_id, op_id, base?: { sha256 } }`
- **Functionality:** Performs an atomic, durable write (`fsync(temp) -> replace -> fsync(dir)`).
- **Code Snippet (`app/apps/file_editor_cm6/main.py`):**
  ```python
  @file_editor_cm6_bp.post('/write')
  def write_file_route():
      data = request.get_json(silent=True) or {}
      path = data.get('path')
      content = data.get('content')
      # ... other params ...

      project_root = get_project_root()
      rel_path = path

      # Security check logic...

      try:
          file_meta = write_full(project_root, str(rel_path), content, base_sha256=base_sha256)
          push_save_ack(str(rel_path), op_id, client_id, file_meta)
          return jsonify({"ok": True, "data": file_meta})
      except BaseMismatchError as e:
          return jsonify({"ok": False, "error": "BASE_MISMATCH", "data": {"current": e.current_meta}}), 409
      except Exception as e:
          return jsonify({"ok": False, "error": str(e)}), 500
  ```
- **Responses:**
  - **200 OK:** `{ "ok": true, "data": { "mtime": ..., "size": ..., "sha256": "..." } }`
  - **409 Conflict:** `{ "ok": false, "error": "BASE_MISMATCH", "data": { "current": { "sha256": "...", "mtime": ... } } }`

### 5.3. Project & Explorer
- **`/project/open` (`POST`):** Sets the active project root directory.
- **`/project/current` (`GET`):** Returns the current project root directory.
- **`/explorer/list` (`GET`):** Lists the contents of a directory relative to the current project root.

### 5.4. History & Preferences
- **`/history/*`:** Endpoints for CRUD operations on the per-project recent files list.
- **`/preferences`:** `GET`/`POST` endpoint for managing editor settings (e.g., `editor.autoSave`).

---

## 6. Python Helper Libraries

- **`core_write.py`:** Provides an atomic full-file replacement function with durability guarantees. It can optionally check a `base_sha256` to prevent overwriting external changes, raising a `BaseMismatchError` (HTTP 409) if the check fails.
  ```python
  # In app/apps/file_editor_cm6/core_write.py
  def write_full(project_root: Path, path: str, content: str, *, base_sha256: str | None = None) -> dict:
      # ... resolves target_path within project_root ...
      # ... checks base_sha256 if provided ...
      with tempfile.NamedTemporaryFile(mode='w', ..., delete=False) as tmp:
          # ... write content, flush, fsync ...
      os.replace(tmp_path, target_path)
      # ... fsync directory ...
      return _get_file_meta(target_path)
  ```
- **`core_read.py`:** Initializes a file system watcher (Watchdog or a polling fallback) for the current project root. It exposes `subscribe`/`unsubscribe` functions and fans out `replace_full` and `save_ack` events to clients. It includes a debounce mechanism to coalesce rapid file change events.
- **`history_store.py`:** Manages a persistent, on-disk JSON file that maps project roots to a list of recently opened files for that project.
- **`explorer_helper.py`:** Manages the global state of the current project root for the app.

---

## 7. Frontend Logic & State

- **Initialization:** `main.js` sets up the CodeMirror 6 editor, loads user preferences, and initializes the explorer UI via `explorer.js`.
- **Project Management:** The file explorer drawer (`explorer.js`) handles opening projects. It uses the shared `window.teFilePicker` to select a directory, then calls the `/project/open` endpoint and reloads the page to reflect the new project context.
- **File Open & WebSocket Connection:**
  ```javascript
  // In app/apps/file_editor_cm6/main.js
  async function openWebSocket(path) {
    closeWebSocket();
    if (!path) return;

    const appId = 'file_editor_cm6';
    const wsUrl = await window.wsPort.buildWsUrl(appId, path, clientId);
    ws = new WebSocket(wsUrl);

    // ... setup ws.onopen, ws.onmessage, etc. ...
  }
  ```
- **Live Updates:** The frontend listens for `replace_full` events on the WebSocket. To prevent conflicts and UI flicker, it ignores these events if a save operation is currently in flight (the "echo guard").
- **Path Handling:** All paths sent to the backend for WebSocket connections and file writes are **relative** to the current project root. The frontend is responsible for calculating these relative paths.
- **Autosave:** On any change to the editor content, a debounced save operation is scheduled (~1200ms). This operation posts the full file content to the `/write` endpoint with the last known `base.sha256`.

---

## 8. Current Status & Known Issues

- **WebSocket Connection:** The WebSocket handshake is now successful (returning `200 OK`), confirming that the port resolution and initial connection are working correctly.
- **Live Updates:** **This is the primary outstanding issue.** Despite the successful connection and the path normalization fixes, the editor is still not receiving live updates when a file is modified on disk. The backend watcher appears to detect the change, but the `replace_full` event is not being successfully delivered to or processed by the frontend UI. The root cause is still under investigation but is hypothesized to be a subtle mismatch in the eventing pipeline.
