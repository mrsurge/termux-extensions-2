## NiceGUI Code CM6 — Architecture Review

_Last updated: November 4, 2025_

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
├── nccm6.py                    # ENTRY POINT - reads project root, bootstraps modules
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
├── helpers/
│   ├── explorer_backend.py     # File tree backing services
│   ├── state_store.py          # JSON-backed settings cache
│   ├── core_read.py            # File watcher & subscriptions (from file_editor_cm6)
│   ├── core_write.py           # Atomic writes with conflict detection
│   ├── edit_tracker.py         # Agent/terminal edit tracking
│   ├── diff_helper.py          # Git diff utilities
│   ├── file_watcher.py         # NiceGUI subscription adapter
│   └── autosave.py             # Autosave manager with debouncing
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
- Header rows expose File / Edit / View menus with project actions, terminal toggle, and editor settings.
- Explorer renders the project tree as full-width gradient cards with git status backgrounds (orange=modified, purple=untracked, green=staged).
- **Project root management:** `nccm6.py` is the SINGLE SOURCE OF TRUTH - reads from `StateStore` on startup, passes `Path` to all modules.
- **Project changes:** ONLY `ExplorerState.set_project()` writes to disk via dialog; no circular writes on startup.
- Editor loads CodeMirror 6 with 12 themes (6 dark, 6 light), word wrap, zebra stripes, and live file streaming.
- Live file updates: watches open files and auto-reloads on external changes (ON by default).
- Autosave: debounced writes with SHA256 conflict detection (OFF by default).
- Edit tracker: infrastructure ready for terminal/agent integration (OFF by default).
- Agent drawer and terminal remain placeholders pending feature parity work.

### Completed Features
- ✅ Git status card backgrounds (modified/untracked/staged)
- ✅ 12 CodeMirror themes with theme picker
- ✅ Word wrap toggle
- ✅ Zebra stripe line shading
- ✅ Live file streaming with watchdog
- ✅ Autosave with debouncing (1.5s)
- ✅ SHA256-based conflict detection
- ✅ Find/Replace dialog UI
- ✅ All settings persist to StateStore

### Outstanding Work
- Explorer: implement git actions (stage/commit/push) and richer context menus.
- Editor: manual save button, Find/Replace CM6 integration, diagnostics.
- Agent Drawer & terminal: connect to framework services and streaming backends.
- Edit tracker: register shells when terminal/agent modules are active.
- Add NiceGUI-based shell controls (lock, quit, recents) to match the existing Flask shell features.

### Testing Notes
- Manual: start supervisor (`./scripts/run_framework.sh`), open `/app/nice_code_cm6`, click toast buttons.
- Framework logs reside under `~/.cache/te_framework/logs/`; `asgi-app:nice_code_cm6` is the worker label.

### Live Streaming Architecture

**File Watcher System:**
- Uses `watchdog` (or polling fallback) to monitor project files
- Subscription-based event system with 100ms polling from NiceGUI timer
- Self-echo suppression (300ms) prevents save flicker
- Debounced events (150ms) reduce notification storms

**Autosave Flow:**
1. User types → mark editor dirty
2. Cancel pending timer, schedule new save (1.5s)
3. Timer fires → atomic write with SHA256 check
4. On success → update base SHA256, emit save_ack
5. Watcher receives save_ack → notify other subscribers

**Conflict Resolution:**
- Clean editor + external change → silent reload
- Dirty editor + external change → show dialog ("Keep Mine" / "Reload")
- Base SHA256 mismatch on save → conflict warning

**Edit Tracker (Ready for Integration):**
- Monitors terminal/agent shells for file modifications
- Extracts line numbers from git diff
- Will emit jump-to-line events when shells are registered

### Next Steps
1. Implement git actions in explorer (stage/commit/push).
2. Connect Find/Replace dialog to CM6 search addon.
3. Port terminal streaming and agent drawer logic as Python modules.
4. Register shells with edit tracker when terminal/agent become active.
5. Add manual "Save Now" button to File menu.
6. Expand the NiceGUI shell to include quit/lock buttons and recents overlay.

---
_Last updated: November 4, 2025 - Added live file streaming, autosave, and theme system._
