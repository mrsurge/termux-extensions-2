# 2025-11-20 Terminal Root + Cleanup Log
- Terminal backend now shares the global HistoryStore singleton, so the drawer always spawns shells in the active project recorded in ~/.local/share/termux-extensions-2/code_oss_history.json.
- Project switching no longer needs frontend state; the shell reads directly from the history file, so CWD updates happen mid-session.
- Removed unused terminal endpoints/helpers (POST /terminal/create, get_shell_info) and dangling imports.
- Verified CM6 terminal drawer opens in the correct project root after switching projects without restarting the app.

## Terminal Architecture Reference

1. **State of Truth** – `HistoryStore` serializes to `~/.local/share/termux-extensions-2/code_oss_history.json`. The terminal backend never caches the project root locally; every PTY creation reads `history_store.get_active_project()` from this file.
2. **Lifecycle** – `terminal.js` requests `/ws/app/file_editor_cm6/terminal/auto`. The FastAPI handler ensures a shell exists (creating one via `create_editor_shell()` if no cached `terminal_shell_id` is stored) and streams PTY output over the same socket.
3. **CWD Selection** – When a new shell is needed, the backend chooses `cwd = active_project if exists and dir else $HOME`. Because the history store is updated by `/project/open` & `/project/create` before shell creation, both manual opens and auto-open-on-run inherit the correct project path instantly.
4. **Persistence** – `history_store.set_terminal_shell_id(shell_id)` is written alongside the PTY metadata, so drawer reloads reconnect to the same PTY until it’s destroyed (X button or project switch). No frontend state is trusted.
5. **Cleanup & Guards** – The WebSocket handler terminates orphaned PTYs whose label is `code-editor-terminal` but are no longer referenced in history. Destroy events clear the cached ID so the next open must spawn fresh.

This flow keeps terminal behavior deterministic even across reconnects, page reloads, or project switches, because the only durable inputs are the history JSON file and the framework-shell metadata maintained by `FrameworkShellManager`.
