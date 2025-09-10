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

---

## Pending

### 1. Shortcut Wizard UI/UX
- [x] **Swap Argument Field Sizes:** In the editor, swap the widths of the "Option/Flag" and "Value" input fields.
- [x] **Re-implement Argument Reordering:** Add "Up" and "Down" arrow buttons to each argument row to allow for reordering.
- [x] **Adjust Editor Layout:** Move the "Save Shortcut" button to the bottom of the view and add a new "Add Command" button above it.
- [x] **Implement File Browser:** Create a modal file browser to select file and directory paths for arguments.
- [ ] **Fix File Browser "Up" Navigation:** The '..' entry in the file browser does not correctly navigate to the parent directory.

### 2. Shortcut Wizard Functional Enhancements
- [ ] **Multi-Command Support:** Implement the backend and script generation logic for the "Add Command" button.
- [ ] **(Future) Loop Constructs:** Design and implement a UI and logic for adding `do-while` and `for` loops to a script.

### 3. Core Framework Tasks
- [ ] **Implement System Stats:** Debug and fix the System Stats implementation.
- [ ] **Fix Menu Dismissal:** Modify the UI so that the session context menu (`...`) closes when the user clicks anywhere else on the page.