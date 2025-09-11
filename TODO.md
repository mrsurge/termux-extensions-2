# Project Task List

---

## Completed

### Core Framework & Architecture
- [x] **Initial Project Setup:** Created Git repo, directory structure, and initial Flask server.
- [x] **Architectural Refactor:** Refactored the application into a modular framework that dynamically loads extensions from the `app/extensions` directory using `manifest.json` files, Flask Blueprints, and a dynamic frontend loader.

### Session Management (`sessions_and_shortcuts` extension)
- [x] **Core Session Hooking:** Implemented `init.sh` to wrap interactive shells in `dtach` and create discoverable metadata files.
- [x] **Session Enumeration:** Implemented `list_sessions.sh` and the corresponding API endpoint to reliably list active sessions.
- [x] **Session Interaction:** Implemented `run_in_session.sh` to allow running commands and killing sessions through the UI.

### Shortcut Wizard (`shortcut_wizard` extension)
- [x] **Initial UI:** Created the main menu (`New`/`Edit`) and the editor view.
- [x] **Save/Edit Logic:** Implemented the backend to save a script (`.sh`) and its corresponding metadata (`.json`), and to load that data back into the editor.
- [x] **Delete Logic:** Implemented the UI and backend for deleting shortcuts.
- [x] **Dynamic Argument Rows (v1):** Implemented the ability to add and remove argument rows.
- [x] **UI Enhancements:** Swapped argument field sizes, re-implemented reordering, and adjusted editor layout.
- [x] **Implement File Browser (v1):** Created the initial file browser modal and API. The "up" navigation is buggy.

---

## Pending

## Pending

### Core Framework Tasks (Gemini's Responsibilities)

- [ ] **Implement `$PATH` Executable API:** Create a new script and a `/api/list_path_executables` endpoint for the Shortcut Wizard to consume.
- [ ] **Fix Menu Dismissal:** Modify the UI so that the session context menu (`...`) closes when the user clicks anywhere else on the page.
- [ ] **Implement System Stats:** Debug and fix the System Stats implementation.
