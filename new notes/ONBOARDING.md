# Termux-Extensions-2 Code Editor Onboarding (Gotchas + Architecture)

This doc is for new devs who want to understand how the **CM6 editor + NiceGUI**
stack fits together, and what the common pitfalls are.

## Big Picture

- **Main framework process** (FastAPI) is the **host**. It owns routing,
  proxies, app discovery, and long-lived services. It is the only process that
  should expose stable, app-level transports.
- **App workers** (framework_shells) are **per-app processes**. They host the
  app UI/runtime (NiceGUI pages, LSP brokers, background tasks). Workers can be
  restarted or killed without taking down the whole framework.
- **CM6 editor** runs inside a **NiceGUI iframe**. The iframe is the editor UI,
  while the **parent page** (`app_shell.html + main.js`) owns chrome, menus,
  Explorer, and high-level navigation.

## Conceptual Model

### Framework vs Worker

**Framework (main process)**  
Think of the framework as the operating system for apps:
- Discovers apps and their manifests.
- Loads **per-app services** that must stay up even if a worker dies.
- Proxies traffic to workers where needed.
- Holds shared infrastructure (IPC, lifecycle, global settings).

**Worker (per-app process)**  
Think of the worker as the app’s runtime:
- Hosts the NiceGUI page and CM6 editor.
- Runs LSP brokers, file watchers, and app-specific background tasks.
- Can be restarted without reloading the entire framework.

### App Services (main process)

Per-app services are loaded before any worker starts. They are the right place
for endpoints that must be stable:
- Explorer Socket.IO transport (separate from NiceGUI).
- Future: app-specific APIs that should not be tied to worker uptime.

### Iframe Model

The editor is a **NiceGUI iframe** that lives inside the app shell page.

- **Parent page** (app shell):
  - File tree / Explorer
  - Menu/toolbar chrome
  - Coordinates high-level navigation and state
- **Iframe (NiceGUI)**:
  - CodeMirror editor
  - LSP interaction
  - Diff/decorations rendering

This split lets the UI be richer and isolates the editor runtime from the
outer app chrome.

## Core Components (Code Editor)

- `app/apps/file_editor_cm6/`
  - `main.py` -> app worker entry (FastAPI + NiceGUI)
  - `nicegui_editor/editor_app.py` -> NiceGUI UI + CM6 binding
  - `static/js/explorer.js` + `main.js` -> parent page logic
  - `explorer_ws.py` -> Explorer websocket dispatcher
  - `project_sidecar.py` + `history_store.py` -> SSOT for state

## Gotchas (Real Issues We Hit)

### 1) NiceGUI Transport vs Explorer Transport
- NiceGUI uses Socket.IO at `/ui/_nicegui_ws/socket.io`.
- Explorer/LSP *used* to share that endpoint -> reconnection loops on Android.
- Fix: Explorer now uses a **separate Socket.IO transport**:
  - client path: `/explorer_ws/socket.io`
  - server mounted in **main process** via app services.

### 2) App Services vs App Workers
- App workers are separate processes; their sockets can die on backgrounding.
- If you need a stable endpoint (Explorer), put it in **app services**:
  - Manifest: `services.path + services.modules`
  - Loaded by apps extension loader at framework startup.

### 3) Project Root SSOT
- `_PROJECT_ROOT` in `explorer_helper.py` defaults to `~`.
- On full framework restart, Explorer may open home unless we **rehydrate**
  from `HistoryStore.active_project` before sending snapshots.

### 4) Draft Cache Behavior
- Drafts are stored in `ProjectSidecar.session_cache`.
- `unsaved == false` entries are now pruned on:
  - startup, project switch, save
- Drafts live across worker restarts (unless explicitly cleared).

### 5) LSP + NiceGUI Timing
- LSP is connected by the iframe after file open.
- When backgrounded, Socket.IO timeouts can cause reload loops.
- Reload logic in NiceGUI was gated to avoid iframe reloads.

## App Services Architecture (New)

Each app can declare services in its manifest:

```
"services": {
  "path": "services",
  "modules": ["explorer_transport"]
}
```

The loader:
- imports `app/apps/<app_id>/<path>/<module>.py`
- calls `register(app)` if present
- auto-registers any `APIRouter` in the module

Example service module:
`app/apps/file_editor_cm6/services/explorer_transport.py`

## Process/WS Routing Map

Main process:
- `/explorer_ws/socket.io` -> Explorer Socket.IO (app service)
- `/ui/_nicegui_ws/socket.io` -> NiceGUI Socket.IO proxy to worker

Worker process:
- NiceGUI UI (`/ui/*`)
- CM6 iframe logic + LSP handling

## Debugging Checklist

- **Reconnect loops**: check Socket.IO path/namespace and reload logic.
- **Wrong project root**: check `HistoryStore.active_project`, then
  `ExplorerDispatcher.initialize()` to set `_PROJECT_ROOT`.
- **Draft weirdness**: inspect `ProjectSidecar.session_cache`.
- **LSP stuck**: confirm worker shells are running and broker is connected.

## Key Files

- `app/extensions/apps/loader.py` (app services loader)
- `app/apps/file_editor_cm6/services/README.md`
- `app/apps/file_editor_cm6/explorer_ws.py`
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- `app/apps/file_editor_cm6/main.js`
