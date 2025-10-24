# file_editor_cm6 — Issue Resolution Summary (as of 2025-10-23)

> **Goal of this doc:** Chronicle the diagnosis and resolution of a series of cascading bugs that affected the editor's core functionality, including project handling, file opening, and state management. This document reflects the state of the application *after* the fixes were implemented.

---

## 1) High-Level Summary

The `file_editor_cm6` application is a single-file CodeMirror 6 editor designed for a localhost, single-user environment. Its architecture consists of a vanilla JavaScript frontend that communicates with a Python (Flask) backend. The frontend is responsible for rendering the editor and handling user interactions, while the backend manages file I/O, state persistence (history/preferences), and file system watching via a WebSocket connection.

Following a significant debugging session, a series of deeply intertwined bugs related to state management, path resolution, and UI event handling have been resolved. The application is now in a stable state, with project and file operations functioning as originally designed.

---

## 2) Debugging & Resolution Log (Oct 2025)

The primary user-facing symptom was a persistent `400 Bad Request` error when the frontend tried to establish a WebSocket connection with the backend. This was the result of several underlying issues.

### 2.1) Initial UI/UX Inconsistencies

- **Issue:** The "Open Project" functionality was confusing and broken. An "Open Project" button in the main toolbar (`#fe-browse`) was disconnected from the project management logic in the explorer drawer. The drawer itself had inconsistent styling and behavior.
- **Resolution:**
    1.  The misplaced `#fe-browse` button was removed from the toolbar in `template.html`.
    2.  A new `#fe-open-project` button was placed directly inside the drawer's header, centralizing project actions.
    3.  The `explorer.js` script was updated to correctly bind to this new button, using the framework's `window.teFilePicker` modal to ensure only valid directory paths are selected.
    4.  Drawer styling was aligned with the project theme by replacing hardcoded colors with CSS variables (`--card`, `--border`) and improving the appearance of the file tree.

### 2.2) API Path Resolution Failures

- **Issue:** After fixing the UI, API calls from the explorer began failing with `404 Not Found` errors. The frontend was using relative URLs (e.g., `fetch('project/current')`) which did not correctly resolve to the API endpoints prefixed with `/api/app/file_editor_cm6`.
- **Resolution:** All `fetch` calls within `explorer.js` were updated to use the full, absolute API paths (e.g., `/api/app/file_editor_cm6/project/current`).

### 2.3) Frontend/Backend Path Mismatch

- **Issue:** The `404` errors were replaced by `400 Bad Request` errors. The root cause was a fundamental contradiction:
    - The frontend was sending **absolute** filesystem paths to the backend.
    - The backend API endpoints (`/ws/read`, `/write`) were expecting **relative** paths.
    - A server-level security filter was likely rejecting requests containing absolute paths in URL parameters, causing the `400` error before the application logic was even hit.
- **Resolution:**
    1.  The frontend (`main.js`) was modified to calculate a file's path *relative* to the current project root before sending it to any backend API.
    2.  This initially failed because the backend was *also* trying to do a relative path calculation. The logic was simplified and corrected in `main.py` to trust the relative path sent by the frontend.
    3.  A flawed security check in `main.py` that was causing false positives was removed after clarification that the app is localhost-only.

### 2.4) Race Condition on Page Load

- **Issue:** The `400` error persisted, but only for the *first file opened on page load*. The application was also stuck re-opening the same file on every load.
- **Diagnosis:** A race condition was occurring. The initial file-opening logic in `main.js` was executing *before* the `initExplorerUI()` function could finish and determine the current project root.
- **Resolution:**
    1.  The boot sequence at the end of `main.js` was refactored into a single `async function main()`.
    2.  This function now enforces a strict order of operations: first, `await initExplorerUI()` and `await getCurrentProjectRoot()` run to establish the project context.
    3.  Only *after* the project root is known does the logic proceed to open the initial file (from a URL parameter or saved state).

---

## 3) Architectural Changes & Final State

- **Sequential Boot Process:** The frontend initialization is no longer parallel. It strictly waits for project context before performing file operations, eliminating the race condition.
- **Consistent Path Handling:** The frontend is now solely responsible for resolving absolute paths. It sends only **relative paths** to the `/ws/read` and `/write` endpoints. The backend now correctly expects and handles these relative paths.
- **Centralized UI Logic:** All drawer and project-related UI logic is now correctly handled by `explorer.js`, with `main.js` responsible for core editor and file operations.

---

## 4) Current Verified Behavior

1.  **Project Switching:** The "Open Project" button in the drawer correctly launches the file picker. Selecting a new project reloads the app into the new context.
2.  **Per-Project Recents:** The "Recent Files" menu correctly shows files associated with the currently active project.
3.  **Initial File Load:** The application correctly loads the last opened file on boot without causing a WebSocket error.
4.  **File Opening:** Opening files from the drawer, the "File > Open" menu, or the "Recent Files" list all work correctly and establish a successful WebSocket connection.
5.  **Styling:** The explorer drawer is now visually consistent with the application's theme.
