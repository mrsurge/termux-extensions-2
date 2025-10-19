# Code OSS Application – Technical Overview

This document describes the Code OSS wrapper bundled with `termux-extensions-2`. It focuses on the runtime wiring, data flow, and disk persistence so that future changes can be made without re‑introducing brittle browser-state hacks.

## Runtime Topology

```
+-------------------+        +-------------------------------+
|  Browser (CM6 UI) |  ws    |   code-server (VS Code)       |
|                   +<------>+   Mobile Bridge Extension     |
|  ide_fullpage.js  |        |   extension.js                |
+--------+----------+        +---------------+---------------+
         | HTTP                                   ^
         v                                         |
+-------------------+        +---------------------+----------------+
| Flask Blueprint   |  <----> | preferences_store.py / history_store |
| app/apps/code_oss |          +-------------------------------------+
+-------------------+
```

- **`app/apps/code_oss/backend.py`** hosts the Flask blueprint, owns the long-lived `code-server` process (via `bin/code-server-wrapper.sh`), handles bridge traffic, and augments explorer events with git metadata.
- **`app/apps/code_oss/static/js/ide_fullpage.js`** renders the CodeMirror 6 surface, explorer drawer, and hidden iframe. It polls `/api/app/code_oss/state`, manages preferences, and orchestrates project switches.
- **`app/apps/code_oss/preferences_store.py`** is a disk-backed JSON store for editor/UI settings and last-open file per project.
- **`app/apps/code_oss/history_store.py`** keeps recent projects/files for both the launcher and CM6’s “Recent Files” dropdown.
- **`app/apps/code_oss/bridge_extension/extension.js`** runs inside code-server, pushing VS Code events to Flask over HTTP.

## Process Lifecycle

1. The launcher or `start-te` spins up the framework shell and navigates to `/app/code_oss/fullpage`.
2. `fullpage()` calls `_ensure_running()`, starting the wrapper if necessary. The wrapper always binds to the same port; workspace changes are handled by navigation.
3. On boot the frontend requests `GET /api/app/code_oss/preferences`, applies the persisted editor/UI state, then calls `POST /api/app/code_oss/start` to discover the iframe URL.
4. Once the iframe loads, the frontend posts `configureBridge`; the bridge extension responds with `bridgeActivated`, `workspaceFolders`, `explorerTree`, `activeEditor`, `doc_state`, `doc_changes`, etc.
5. Every bridge event is recorded by the blueprint (sequence number, timestamp) and replayed to the polling frontend.

## Disk Persistence

| Concern                    | File                                            | Notes |
|---------------------------|-------------------------------------------------|-------|
| Recent projects/files     | `~/.local/share/termux-extensions-2/code_oss_history.json` | Managed by `history_store.py`; reused by the launcher. |
| Editor/UI preferences     | `~/.local/share/termux-extensions-2/code_oss_prefs.json`   | Managed by `preferences_store.py`; replaces all `teState` usage. |
| Last open file per project| Same JSON as above                              | Drives automatic reopen after a reload. |

All writes go through a lock and are committed atomically (`*.tmp` + rename). No browser storage is used for IDE state.

## Explorer + Git Decorations

1. `_gather_git_status()` runs `git status --porcelain` on the active project (4 s TTL cache).
2. `explorerTree` payloads are augmented with:
   - `entries[path].executable` via `os.access(..., X_OK)`.
   - `directories[path].total` and `statuses` for folder-level badges.
3. The frontend merges the payload, renders separators, badges, and executable highlighting (green) regardless of git state. The “Git indicators” toggle only affects rendering and is persisted on disk.

## Project Switching

1. “Open Project…” prompts the shared file picker. If a directory is chosen:
   - POST `/api/app/code_oss/project` stops the old shell, records the new `_SHELL_STATE['project_path']`, refreshes git caches, and returns the new `/?folder=` URL.
   - Recent history is updated via `/history/project`.
   - Preferences are flushed (`last_file = null`).
2. The frontend immediately `window.location.replace()`s to the same page with `?project=<abs path>`. Reloading keeps the iframe, CM6, preferences, and explorer aligned and avoids stale focus problems.

## Document Loading Path

1. Explorer or “Recent Files” click calls `openFileInEditor(path)`.
2. We send `openPath` to code-server (so VS Code focuses the file) and fetch a snapshot via `GET /api/app/code_oss/file`.
3. CM6 renders the snapshot read-only; theme, line numbers, shading, and wrap reflect the editor preferences.
4. History (`/history/file`) and preferences (`project.last_file`) are updated. When the page reloads, a 4 s timer runs after the explorer hydrates; the stored `last_file` is then reopened automatically.

## Preference Flow

| User action                               | Frontend change                                        | Backend update |
|------------------------------------------ |-------------------------------------------------------|----------------|
| Toggle line numbers / syntax / shading / wrap | Update `cmState`, recreate CM6 view, `persistEditorPreferences()` | `POST /preferences` (`editor={...}`) |
| Theme change                              | Same                                                   | Same |
| Collapse assistant panel                  | Toggle `.assistant-collapsed`, update button state     | `POST /preferences` (`ui={'assistantCollapsed': …}`) |
| Toggle git indicators                     | Update `explorerState.indicatorsEnabled`, rerender     | `POST /preferences` (`ui={'gitIndicators': …}`) |
| Open file                                 | Record history and `updateLastOpenedFile(path)`        | `POST /preferences` (`project={'path':…, 'last_file': …}`) |

Network failures simply log warnings; in-memory defaults remain untouched.

## Relevant Files

| Path                                            | Role |
|-------------------------------------------------|------|
| `app/apps/code_oss/backend.py`                  | Flask blueprint, code-server lifecycle, git augmentation, REST API. |
| `app/apps/code_oss/preferences_store.py`        | Disk-backed editor/UI preference store. |
| `app/apps/code_oss/history_store.py`            | Recent project/file lists exposed via `/history`. |
| `app/apps/code_oss/static/js/ide_fullpage.js`   | Frontend controller (CM6 lifecycle, explorer drawer, preferences client). |
| `app/apps/code_oss/static/css/ide_fullpage.css` | Styles for the full-page layout. |
| `app/apps/code_oss/templates/fullpage.html`     | HTML scaffold (top bar, drawer, CM6 container, iframe). |
| `app/apps/code_oss/bridge_extension/extension.js` | VS Code web extension that forwards workspace/editor events. |

## Outstanding Work

1. **Bi-directional editing** – CM6 is read-only; we need an `updateListener` that batches edits and hits `/api/app/code_oss/edits`, along with bridge `ack` handling.
2. **Command wiring** – File/Save/Undo/Redo menu items must dispatch CM6 or bridge commands once editing is live.
3. **Terminal panel refresh** – Replace the assistant tray with a terminal/agent dock backed by framework shells.
4. **Inline git diffs** – Use the cached git metadata to decorate CM6 with staged/unstaged hunks.
5. **Bridge backoff** – The handshake retry loop is timer-based; replace with a proper backoff strategy for slow code-server boots.
