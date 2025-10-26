# code_cm6 — CodeMirror 6 Editor Bundle

_Last updated: October 26, 2025_

## Overview
code_cm6 is the full-screen CodeMirror 6 editor bundled with Termux Extensions 2. It replaces the earlier Monaco-based integration and offers a native-feeling authoring surface for Termux projects, including Android long-press selection, autosave, and live file streaming. The bundle is delivered as the `file_editor_cm6` app (`app/apps/file_editor_cm6/`) and runs inside its own framework worker activated by the main supervisor.

## Feature Highlights
- **Live file streaming:** A universal WebSocket discovery helper (`app/static/js/ws_port.js`) reads the `X-App-Worker-Port` header so the frontend can always locate its worker, even as ports change between launches.
- **Robust watcher pipeline:** `core_read.py` normalises all subscription keys with `_norm_path()` and tears down/restarts the watcher if the project root changes, guaranteeing consistent `replace_full` delivery.
- **Disk-backed project memory:** `history_store.py` persists the active project, the last-open file, and per-project recents in `~/.local/share/termux-extensions-2/code_oss_history.json`, so reloads restore the previous workspace and expose missing files gracefully.
- **Native Android selection:** The dual-surface long-press mode mirrors the behaviour of the standalone CM6 app, keeping Android selection handles and clipboard accessible without sacrificing syntax highlighting.
- **Autosave with conflict detection:** Saves include the last seen `sha256` and surface `BASE_MISMATCH` errors so the user can pull the latest content and explicitly confirm overwrites.

## Key Modules
- **Backend** (`app/apps/file_editor_cm6/main.py`)
  - Registers REST endpoints, WebSocket routes via `flask_sock`, and the consolidated `/state` API.
  - Syncs the runtime project root with the persisted active project on worker boot.
  - Streams file-change events from `core_read.py` into WebSocket clients and acknowledges writes via `push_save_ack`.
- **File watcher** (`app/apps/file_editor_cm6/core_read.py`)
  - Supports watchdog or polling, debounces events, prevents self-echo, and restarts when the active project changes.
- **Persistence** (`app/apps/file_editor_cm6/history_store.py`)
  - Stores per-project recents, last-open file metadata, and the globally active project. All helpers resolve paths inside the user’s home directory before persisting them.
- **Frontend entry point** (`app/apps/file_editor_cm6/main.js`)
  - Boots the editor, fetches `/api/app/file_editor_cm6/state`, automatically reopens the last known file when it still exists, and records activity back through `/state/file_activity`.
  - Manages CodeMirror extensions (themes, autosave, line wrapping) and the native-selection surface.
- **Explorer drawer** (`app/apps/file_editor_cm6/static/js/explorer.js` & `.css`)
  - Consumes the same server state to populate the project label and recent files, flags missing entries, and blocks tree interaction until a valid project is selected.
- **Worker launcher** (`app/libs/app_worker.py`)
  - Detects a module-level `sock` object and calls `init_app(app)` so the CM6 blueprint’s WebSocket routes are registered automatically.

## Runtime Flow
1. **Worker start:** `scripts/run_framework.sh` launches the supervisor, which spawns an app worker. `app_worker.py` loads `file_editor_cm6.main` and initialises its `sock` routes.
2. **State sync:** On module import, the backend reconciles the active project from `history_store` with the in-memory project root. Clients call `GET /api/app/file_editor_cm6/state` during boot to retrieve the same snapshot.
3. **Editor bootstrap:** `main.js` loads UI preferences from `host.loadState`, fetches server state, optionally reopens the last file, and wires the explorer/menus.
4. **Live updates:** The frontend requests a WebSocket URL from `ws_port.js`, connects to `/ws/read`, and receives `replace_full` and `save_ack` events keyed by normalised absolute paths.
5. **Persistence:** Whenever a document is opened or saved-as, the client posts to `/state/file_activity`, keeping `history_store` in sync. The explorer reflects these changes immediately.

## REST & WebSocket API
| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/app/file_editor_cm6/status` | Health probe for the worker. |
| `GET` | `/api/app/file_editor_cm6/state` | Returns `{ activeProject, lastFile, recents[], … }` plus status messages when paths are missing. |
| `POST` | `/api/app/file_editor_cm6/state/file_activity` | Records the last-open file and updates per-project recents. |
| `POST` | `/api/app/file_editor_cm6/project/open` | Validates a directory, sets it as the active project, and returns the new state snapshot. |
| `GET` | `/api/app/file_editor_cm6/project/current` | Returns the currently selected project path. |
| `GET` | `/api/app/file_editor_cm6/read?path=` | Reads a file (absolute path) and returns `{ content, sha256 }`. |
| `POST` | `/api/app/file_editor_cm6/write` | Writes the document with optional base hash verification. |
| `GET` | `/api/app/file_editor_cm6/explorer/list?dir=` | Lists directories relative to the active project. |
| `GET` | `/api/app/file_editor_cm6/history/files` | Lists recent files for the active project, including an `exists` flag. |
| `DELETE` | `/api/app/file_editor_cm6/history/file?path=` | Removes a file from the recents list. |
| `WS` | `/ws/read?path=…&client_id=…` | Streams `replace_full`, `save_ack`, and (future) git-status events for the requested file. |

## Persistence Details
- Storage file: `~/.local/share/termux-extensions-2/code_oss_history.json`.
- Top-level fields:
  - `active_project`: absolute path of the currently selected project (or `null`).
  - `projects`: map from project path to `{"label", "opened_at", "last_file", "files"}`.
  - `recent_projects`: MRU list for the project picker.
- Each `files` entry includes `{ path, label, opened_at }`. The backend annotates responses with `exists` so the UI can highlight missing files.

## WebSocket Event Lifecycle
1. Client opens a document (`openFile`), then calls `openWebSocket(resolvedPath)`.
2. Backend subscribes via `core_read.subscribe`, sending an initial `replace_full` snapshot containing `content`, `language`, and `sha256`.
3. Filesystem events are debounced; for each valid change, `_emit_event` transmits `replace_full` with an absolute path. `push_save_ack` keeps track of client IDs to avoid echoing the author’s own saves.
4. The frontend ignores `replace_full` while a save is inflight (`SELF_ECHO_GRACE` window), otherwise it updates the document and clears the unsaved indicator.

## Frontend Behaviour
- **Explorer drawer:** Tracks the active project label, displays missing-project warnings, and lets the user open directories through `teFilePicker`. Recents show `(missing)` when paths are absent. Directory listings now arrive annotated with git status, executable flags, and symlink hints so the tree can style modified files, untracked work, and executable scripts inline.
- **Editor menus:** File/Edit/View/Theme menus toggle CM6 options and autosave. The “Recent Files” dropdown is a shared component populated from the persisted state.
- **Android selection surface:** Long-press swaps to the contenteditable overlay; exiting selection syncs edits back to CM6.
- **Autosave:** After 1.2 s of inactivity the editor triggers `/write`; manual saves (Ctrl/Cmd+S) reuse the same pipeline.

## Known Limitations & Follow-Up
- Directory listings and watcher events rely on the selected project remaining accessible; if a project is moved or deleted, the UI reports the issue but manual reselection is required.
- The backend rejects writes outside the active project root; a future enhancement could surface friendlier picker messages before submitting the request.
- Git status snapshots are cached in-memory for a few seconds to keep drawer renders snappy; rapid external git operations may take one refresh cycle to appear.
Future enhancements will be captured in a dedicated roadmap once the next development cycle begins.
