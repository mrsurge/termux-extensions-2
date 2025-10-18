# Code OSS App Readme

## What’s Shipped
- **Project-aware iframe** – the hidden `code-server` instance now stays on a single port and simply navigates to the selected workspace URL; no more shell restarts.
- **Drawer hydration, everywhere** – bridge events from any client (even another browser) keep the explorer tree in sync.
- **Stateful project tracking** – the active workspace lives in `teState`, updates from bridge events, and survives page reloads.
- **Lightweight CM6 surface** – the document view renders edge-to-edge with native Android text selection and theming toggles.

## High-Level Architecture

### Frontend (`app/apps/code_oss/static/js/ide_fullpage.js`)
- Drives the CM6 editor surface and the explorer drawer UI.
- Tracks the current workspace in `teState` (`codeOss.currentProjectPath`) and updates headers/placeholders automatically.
- On “Open Project…” it retargets the iframe to `/?folder=…`, displays a loading card, and lets bridge events rehydrate the tree.
- Polls `/api/app/code_oss/state` for bridge messages (explorer tree, document changes, chat status, etc.).

### Backend (`app/apps/code_oss/backend.py`)
- Boots the shared `code-server` process (wrapper script in `bin/`).
- Accepts bridge events at `/api/app/code_oss/state` and streams them back to the frontend.
- Keeps `_SHELL_STATE['project_path']` aligned with the latest workspace by observing bridge `workspaceFolders` / `explorerTree` payloads.
- Provides `/api/app/code_oss/file` for on-demand document reads and `/api/app/code_oss/start` for iframe boot.

### Bridge Extension (`app/apps/code_oss/bridge_extension`)
- Loads as a lightweight web extension inside code-server.
- On activation it emits `bridgeActivated`, `workspaceFolders`, `explorerTree`, `activeEditor`, and document events to the backend.
- Configuration (`mobile-bridge.endpoint`) stays in VS Code settings; no custom schema needed.

### Launcher (`app/apps/code_oss/main.js`, `template.html`)
- Home-screen entry point that can start the backend shell and deep-link into the full IDE view.

## Current Experience
- ✅ “Open Project…” retargets the hidden iframe and the drawer reloads automatically.
- ✅ Explorer tree mirrors whatever workspace code-server reports, even if the change originates elsewhere.
- ✅ CM6 editor opens read-only file snapshots with theme / line-number toggles.
- ✅ Assistant panel collapses and retains state via `teState`.

## Rough Edges & To-Dos
- Document edits are still one-way (read-only). Need to wire bridge `doc_changes` back into code-server when CM6 edits occur.
- Explorer selection opens a file snapshot but doesn’t focus the actual VS Code editor – the bridge command exists (`openPath`), just needs refinement.
- Mobile UX polish: header truncation, drawer polish, assistant resize, and overall spacing.
- Bridge retry loop is minimal; consider a bounded backoff if code-server takes longer to boot.

## Quick Start for Contributors
```bash
# Start the framework (Termux environment)
./scripts/bootstrap_termux.sh      # first time
python app/main.py                 # hot reload server

# Visit the IDE wrapper
# http://127.0.0.1:5000/app/code_oss/fullpage
```
- Use the drawer’s “Open Project…” button to switch workspaces; the iframe will handle the navigation.
- For debugging, open the hidden code-server URL in a desktop browser (`http://localhost:<port>`); explorer updates will still flow back.

## Useful Files
- `app/apps/code_oss/static/js/ide_fullpage.js` – main frontend logic.
- `app/apps/code_oss/backend.py` – Flask blueprint and code-server process management.
- `app/apps/code_oss/bridge_extension/extension.js` – VS Code extension that feeds bridge events.
- `app/apps/code_oss/templates/fullpage.html` – base layout for the CM6 view + iframe.

Happy hacking! Let me know what to prioritize next.***
