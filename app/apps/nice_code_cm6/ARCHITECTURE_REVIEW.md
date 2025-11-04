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
- Command: `python app/apps/nicegui_shell/worker.py --app-id nice_code_cm6 --module app.apps.nice_code_cm6.nccm6 --port <dynamic>`
- NiceGUI serves everything (HTML, CSS, Socket.IO) directly; no reverse proxy required.

### Module Architecture
```
app/apps/nice_code_cm6/
├── manifest.json
├── nccm6.py                    # Bootstraps modules + layout
├── core/
│   ├── module.py               # Base Module contract
│   ├── module_loader.py        # Reflective loader (native modules)
│   ├── layout_manager.py       # Phase-1 layout grid
│   └── project_context.py      # Project root resolution & guardrails
├── modules/
│   ├── native/
│   │   ├── file_header.py
│   │   ├── menu_header.py
│   │   ├── explorer.py
│   │   ├── editor.py
│   │   ├── terminal.py
│   │   └── agent_drawer.py
│   └── third_party/            # Reserved for future plugin modules
├── helpers/
│   ├── explorer_backend.py     # File tree backing services
│   └── state_store.py          # JSON-backed settings cache
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
- Quasar/NiceGUI wrappers (`.q-page-container`, `.q-page`, `.nicegui-page*`) are forced into the
  same flex column so the explorer/editor/agent stack inherits the full height beneath the headers.

### Current UI State
- Header rows expose File / Edit / View menus with project actions and terminal toggle.
- Explorer renders the project tree as full-width gradient cards, persists expansion/recents, and opens files in the editor.
- Project root + recent files live in the shared `StateStore`, with `ProjectContext` enforcing on-disk boundaries.
- Editor loads CodeMirror 6, tracks the last-opened file, and updates from explorer selections.
- Agent drawer and terminal remain placeholders pending feature parity work.

### Outstanding Work
- Explorer: implement git actions (stage/commit/push) and richer context menus.
- Editor: surface save/write-back, diagnostics, and CM6 extensions.
- Agent Drawer & terminal: connect to framework services and streaming backends.
- Broaden state persistence (editor settings, layout preferences) atop `helpers/state_store.py`.
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
