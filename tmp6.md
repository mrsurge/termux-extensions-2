# Explorer WS → Socket.IO Integration – Change Plan

## 1. Current State (What You Have Now)

### 1.1 `explorer_ws.py`

- Uses **FastAPI WebSocket** directly (`WebSocket`, `receive_text`, `send_text`).
- `ConnectionManager` tracks connections per `project_path` and supports:
  - `connect(websocket, project_path)` → `accept()` + register.
  - `disconnect(websocket)` → remove from maps.
  - `broadcast(project_path, message)` → send JSON to all sockets for that project.
- `ExplorerDispatcher` wraps a single `WebSocket` and currently:
  - Has `initialize()` which:
    - Calls `manager.connect(self.websocket, project_root)`.
    - Emits initial state via `emit_personal`:
      - `project:setActive` (active project path).
      - `git:status` via `broadcast_git_status()`.
      - `explorer:setList` with `list_dir('.')`.
      - `review:setEntries` via `broadcast_review_state()`.
  - Provides `emit_personal(type, payload, reply_to)` and `broadcast(type, payload)`.
  - Provides `send_error()` for error replies.
- Handler naming: inbound `type` strings like:
  - `explorer_list`, `explorer_refresh`, `explorer_createFile`, `git_status`, `git_commit`, `search_run`, `review_list`, `review_save`, etc.
  - Outbound events: `explorer:setList`, `explorer:created`, `git:status`, `search:setResults`, `review:setEntries`, etc.
- `explorer_websocket()` endpoint:
  - Instantiates `ExplorerDispatcher(websocket)`.
  - Calls `await dispatcher.initialize()`.
  - Loops on `await websocket.receive_text()` → `dispatcher.handle_message()`.

### 1.2 `explorer/search.py`

- Implements all three search modes:
  - `search_by_name(root, query)` – simple path walk with ignore patterns.
  - `search_by_content(root, query)` – prefers ripgrep, falls back to Python.
  - `search_by_changes(project_root)` – uses git helpers and `collect_diff` to build `changes` array with hunks.
- Returns structured payloads matching the current search overlay expectations.

### 1.3 `explorer/review.py`

- `list_reviews(project_root, lightweight=False)` – enumerates draft sidecars, optionally computes draft hunks.
- `save_reviews(project_root, files)` – writes drafts to disk using `write_full`, pushes save acks, invalidates diff cache, clears sidecars.
- `discard_reviews(project_root, files)` – clears sidecars and calls `handle_external_discard` to revert the live editor if open.


## 2. Issues to Fix Before/While Introducing Socket.IO

### 2.1 Project switching double-`accept` risk

- `ConnectionManager.connect` always calls `await websocket.accept()`.
- `ExplorerDispatcher.initialize()` calls `manager.connect()` once at startup.
- `handle_project_open` does:
  - `manager.disconnect(self.websocket)`
  - `set_project_root(path)` → updates project root.
  - `_history_store.set_active_project(...)`.
  - Then **calls `manager.connect(self.websocket, str(new_root))` again**.

On a FastAPI `WebSocket`, calling `accept()` twice is not supported and will break if not already masked by the current flow.

**Fix** (pre‑Socket.IO or as part of migration):

- Split `connect()` into two concepts:
  - `accept_and_register(websocket, project_path)` – used only once on initial connection.
  - `register_existing(websocket, project_path)` – update maps without calling `accept()`.
- In `ExplorerDispatcher.initialize()`:
  - Call `accept_and_register(...)`.
- In `handle_project_open()`:
  - Call `manager.disconnect(self.websocket)`.
  - Call `register_existing(self.websocket, new_root)` (no `accept()`).

### 2.2 RPC-ish semantics vs UI state bus

- Handlers are still largely RPC-shaped, keyed by string `type` with per-call responses.
- Some outbound events already look like good UI events (`explorer:setList`, `git:status`, `review:setEntries`), but there is no **authoritative explorer tree snapshot** (with git + draft decorations) emitted as a single state message.

**Change needed (conceptual, applies to Socket.IO too):**

- Promote these as **primary outbound UI messages**:
  - `explorer:setTree` – full tree snapshot (root + nodes + selection).
  - `explorer:updateDecorations` – git + drafts decoration map.
  - `search:setResults` – search results snapshot.
  - `review:setEntries` – full review list.
- Make RPC‑like responses (e.g. `explorer:created`, `review:saved`) secondary; the main way the UI updates is via state events.

### 2.3 Multi-client broadcasting semantics

- `ConnectionManager` already supports broadcasts per project.
- Some operations broadcast the right state:
  - `broadcast_git_status()` broadcasts `git:status` to all connections on that project.
  - `broadcast_review_state()` emits `review:setEntries` to all project clients.
- Many operations still **only respond to the caller**:
  - `handle_explorer_createFile`, `handle_explorer_delete`, etc., call `broadcast("explorer:created", ...)` or `"explorer:deleted"`, but there is no tree snapshot update message.

**Change needed:**

- After any operation that changes tree/decoration state:
  - Emit a canonical state event (e.g. `explorer:setTree`, `explorer:updateDecorations`) via broadcast for that project.

This change is independent of Socket.IO and will carry over.


## 3. Incremental Socket.IO Integration Plan (CDN-first)

Goal for this phase: **Use Socket.IO for the explorer UI bus while leaving the rest of the app as-is**, and keep the protocol you’ve started (`explorer:*`, `git:*`, `search:*`, `review:*`).

### 3.1 Server: introduce a Socket.IO namespace for explorer UI

1. **Reuse existing Socket.IO server**
   - NiceGUI already initializes a global `socketio.AsyncServer` in `app/static/vendor/nicegui/nicegui.py` (`core.sio`).
   - For a first integration, register an explorer namespace on that server rather than wiring a new Socket.IO stack.

2. **Create an explorer namespace module**, e.g. `app/apps/file_editor_cm6/explorer_socketio.py`:

   - Define a namespace class:

     ```python
     import socketio
     from pathlib import Path
     from .explorer_ws import ExplorerDispatcher  # reuse handler logic

     class ExplorerNamespace(socketio.AsyncNamespace):
         def __init__(self, namespace='/explorer-ui'):
             super().__init__(namespace)
             self.dispatchers = {}  # sid -> ExplorerDispatcher

         async def on_connect(self, sid, environ):
             # Resolve active project root
             from .explorer_helper import get_project_root
             dispatcher = ExplorerDispatcher(None)  # adapt to Socket.IO
             dispatcher.project_root = get_project_root()
             self.dispatchers[sid] = dispatcher
             # Send initial state via dispatcher helpers
             await dispatcher.initialize_socketio(self, sid)

         async def on_disconnect(self, sid):
             dispatcher = self.dispatchers.pop(sid, None)
             if dispatcher:
                 await dispatcher.cleanup_socketio(self, sid)

         async def on_message(self, sid, data):
             # Optional generic entrypoint if you want {type,payload} framing
             ...

         # Or: explicit event handlers matching your types
         async def on_explorer_list(self, sid, payload):
             ...  # call underlying list_dir and emit back via self.emit(...)
     ```

   - For CDN testing, you can start with just a couple of events (`git_status`, `explorer_list`) and call into existing helpers directly, without fully reusing `ExplorerDispatcher`.

3. **Register the namespace** in the right place:

   - In the main app startup (where NiceGUI’s Socket.IO server is already created), do something like:

     ```python
     from nicegui import core
     from app.apps.file_editor_cm6.explorer_socketio import ExplorerNamespace

     core.sio.on_namespace(ExplorerNamespace('/explorer-ui'))
     ```

   - This gives you a Socket.IO endpoint at `ws://host/socket.io` with namespace `/explorer-ui` (default path `/socket.io`).

### 3.2 Frontend: CDN Socket.IO client and thin bridge

1. **Include Socket.IO client from CDN** into the editor shell template (`template.html`):

   ```html
   <script src="https://cdn.socket.io/4.7.4/socket.io.min.js" crossorigin="anonymous"></script>
   ```

2. **Initialize a Socket.IO client in `main.js`**:

   ```js
   let explorerSocket = null;

   function connectExplorerSocket() {
     explorerSocket = io({ path: '/socket.io', transports: ['websocket'] });

     explorerSocket.on('connect', () => {
       console.log('[ExplorerWS] connected', explorerSocket.id);
       // Optionally send a hello with project context if needed later
     });

     explorerSocket.on('disconnect', (reason) => {
       console.log('[ExplorerWS] disconnected', reason);
     });

     explorerSocket.on('explorer:setList', (payload) => {
       // For now, just log and/or feed into existing renderChangesList/renderTree
       console.log('[ExplorerWS] setList', payload);
     });

     explorerSocket.on('git:status', (payload) => {
       console.log('[ExplorerWS] git status', payload);
     });
   }
   ```

3. **Hook this into boot**, without changing explorer UI yet:

   - In `main()` after initial state fetch, call `connectExplorerSocket()`.
   - Keep using the existing REST/WS explorer logic; for now Socket.IO is just a side channel for logging and experimentation.

### 3.3 Use same message vocabulary

- Map Socket.IO events to your existing `type` strings:
  - In Socket.IO server/namespaces, use event names like `'explorer:open'`, `'explorer:setList'`, `'git:status'`, `'search:setResults'`, `'review:setEntries'`.
  - This matches the playbook and lets you reuse your `type` vocabulary on both transports (raw WS for now + Socket.IO for the new bus).


## 4. Evolving `ExplorerDispatcher` to Socket.IO

Once the CDN test proves out the Socket.IO path, adapt `ExplorerDispatcher` so it can be shared between FastAPI WS and Socket.IO without duplicating logic.

### 4.1 Abstract the transport

- Change `ExplorerDispatcher` to accept a generic `send`/`broadcast` interface instead of a `WebSocket` directly, e.g.:

  ```python
  class ExplorerTransport:
      async def send_personal(self, sid_or_ws, message: dict): ...
      async def broadcast(self, project_path: str, message: dict): ...
  ```

- For FastAPI WS, implement `ExplorerTransport` using `manager.send_personal` / `manager.broadcast`.
- For Socket.IO, implement `ExplorerTransport` using `socketio.emit(...)` with `room`/`sid`.

- Update `ExplorerDispatcher` to use this transport abstraction instead of calling `manager` directly.

### 4.2 Standardize on `{type,payload}` format for Socket.IO messages

- For Socket.IO events, you have two options:
  1. **Named events per type**: `socket.emit('explorer:open', payload)`.
  2. **Single event with `{type,payload}`**: `socket.emit('ui', {type:'explorer:open', payload})`.

- Since the current dispatcher already expects `{type,payload,id}`, option 2 lets you:
  - Reuse `ExplorerDispatcher.handle_message()` almost unchanged.
  - Only adjust the transport layer.

### 4.3 Decommission the raw FastAPI WS endpoint (later)

- After the Socket.IO path is stable and the explorer UI is reading from it:
  - Either remove `explorer_websocket()` or leave it as a legacy/debug channel.
  - Keep `ExplorerDispatcher` as the core logic, invoked by Socket.IO instead of raw WS.


## 5. Additional Corrective Notes

1. **Review list broadcasting**
   - `broadcast_review_state()` already emits `review:setEntries` to all clients.
   - Ensure that any **change to drafts** (autosave, discard from editor, etc.) calls into this helper (or into `review.list_reviews` + broadcast) so the explorer and review overlay stay aligned.

2. **Decoration updates**
   - After review save/discard, you correctly call `mark_git_cache_dirty()` and `broadcast_git_status()`.
   - When you later add an `explorer:updateDecorations` event, ensure it is triggered from the same places so tree accents stay in sync.

3. **Search by changes performance**
   - `search.search_by_changes` is synchronous and can be expensive for big repos.
   - When moving this behind Socket.IO, consider:
     - Keeping `CHANGE_RESULT_LIMIT` and returning `truncated` consistently.
     - Optionally emitting a “search:progress” event for long‑running operations, but that’s a second phase.


## 6. Summary of Concrete Changes for Socket.IO Testing (CDN-first)

1. **Fix project switching double-accept** by splitting `connect()` into `accept_and_register()` and `register_existing()` and using the latter in `handle_project_open`.
2. **Add a Socket.IO namespace** (e.g., `/explorer-ui`) using the existing NiceGUI `AsyncServer`.
3. **Wire minimal handlers** on that namespace for:
   - `explorer:list` → call `list_dir('.')`, send `explorer:setList`.
   - `git:status` → call `git_get_status`, send `git:status`.
4. **Add Socket.IO client via CDN** to the editor shell and connect from `main.js`, logging incoming events.
5. **Standardize event names** to `explorer:*`, `git:*`, `search:*`, `review:*` to match the future bus protocol.
6. **Once stable**, adapt `ExplorerDispatcher` to use an abstract transport so the same handler logic works for both FastAPI WS and Socket.IO, and gradually move explorer UI over to the Socket.IO bus as its primary data source.

