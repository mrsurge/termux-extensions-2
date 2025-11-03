## NiceGUI Code CM6 — Architecture Review

_Last updated: November 3, 2025_

### Overview
- The Code CM6 app now runs as a **standalone NiceGUI worker** launched through a shared shell (`app/apps/nicegui_shell/worker.py`).
- The framework detects NiceGUI apps via `manifest.json` (`nicegui_module` + `nicegui_shell`) and redirects `/app/<id>` directly to the worker’s port.
- UI composition happens in Python. We scaffolded a modular layout that mirrors the legacy CM6 editor without relying on client-side JavaScript logic.

### Launch Flow
1. User navigates to `/app/nice_code_cm6`.
2. `/api/ext/apps/app/<id>` checks the manifest, calls `ensure_app_running`, and spawns the NiceGUI shell worker when needed.
3. The worker imports `app.apps.nic e_code_cm6.ui::build_ui`, builds the shared shell chrome, and renders the editor layout.
4. The browser is redirected to `http://<host>:<worker-port>/`, where NiceGUI serves the full page.

#### Processes
- Shell label: `asgi-app:nice_code_cm6`
- Command: `python app/apps/nicegui_shell/worker.py --app-id nice_code_cm6 --module app.apps.nice_code_cm6.ui --port <dynamic>`
- NiceGUI serves everything (HTML, CSS, Socket.IO) directly; no reverse proxy required.

### Module Architecture
```
app/apps/nice_code_cm6/
├── manifest.json
├── ui.py                       # Bootstraps modules + layout
├── core/
│   ├── module.py               # Base Module contract
│   ├── module_loader.py        # Reflective loader (native modules)
│   └── layout_manager.py       # Phase-1 layout grid
├── modules/
│   ├── native/
│   │   ├── file_header.py
│   │   ├── menu_header.py
│   │   ├── explorer.py
│   │   ├── editor.py
│   │   ├── terminal.py
│   │   └── agent_drawer.py
│   └── third_party/            # Reserved for future plugin modules
└── static/cm6/                 # Placeholder for CM6 assets
```

#### Module Contract (`core/module.py`)
- `key` (str): stable identifier used for layout placement.
- `render(container)`: draws a module into the supplied NiceGUI element.
- Optional hooks: `on_mount`, `on_unmount`, `on_file_open`, `on_file_saved`.

#### Layout Manager (`core/layout_manager.py`)
- Renders headers, three-column body (Explorer → Editor → Agents), and bottom terminal strip.
- Uses CSS utility classes to keep explorer/agent tiles full height and the terminal spanning beneath the editor.
- Automatically places modules based on their `key` values; unknown modules fall back to a misc zone.

### Shell Chrome (`app/apps/nicegui_shell/worker.py`)
- Full-screen flex container with shared header (Home, Reload, Toast, title).
- Inline toast button verifies the NiceGUI runtime without needing app-specific modules.
- Body canvas delegates to the target app’s `build_ui` module.
- Global `<style>` ensures true edge-to-edge rendering without white borders or scroll gaps.

### Current UI State
- Header rows display “Untitled • No file selected” and placeholder menu buttons.
- Explorer, Editor, Agent Drawer, and Terminal areas render stub cards; layouts fill the entire viewport.
- “Show Toast” button in the editor module (and in the shell) confirms WebSocket/event loop wiring.

### Outstanding Work
- Flesh out each module:
  - Explorer: real file tree + navigation API
  - Editor: CM6 integration using NiceGUI `ui.html` wrapper
  - Agent Drawer & terminal: connect to framework services
- Implement state management (open file path, selections, etc.) in `core/state_manager.py` (not yet created).
- Introduce responsive behavior (drawer overlays on mobile) via future layout manager enhancements.
- Add NiceGUI-based shell controls (lock, quit, recents) to match the existing Flask shell features.

### Testing Notes
- Manual: start supervisor (`./scripts/run_framework.sh`), open `/app/nice_code_cm6`, click toast buttons.
- Framework logs reside under `~/.cache/te_framework/logs/`; `asgi-app:nice_code_cm6` is the worker label.

### Next Steps
1. Build out the file explorer module with filesystem APIs.
2. Embed CodeMirror 6 assets under `static/cm6/` and wrap them through NiceGUI.
3. Port terminal streaming and agent drawer logic as Python modules.
4. Expand the NiceGUI shell to include quit/lock buttons and recents overlay.

---
_This document covers the changes made since the repo reset (when NiceGUI files were reintroduced) up through the current modular layout stage._
