# Code OSS TODO / Status

## Recently Completed
- **Disk-backed editor/UI preferences** – frontend now loads/saves settings via `/api/app/code_oss/preferences`, replacing all `teState` usage. The JSON store in `preferences_store.py` also tracks the last-open file per project for automatic restores.
- **Explorer git/executable decorations** – backend augments `explorerTree` events with git status and executable flags; the drawer renders badges/separators and styles executables even when a repo is clean.
- **Project reload path** – “Open Project…” calls `/project` and reloads the IDE with `?project=<abs path>`, keeping CM6 focus/states consistent while retaining history and preferences.

## Next Up
1. **Menu actions & auto-save wiring**  \
   Wire File/Edit menu items to either CM6 commands or bridge commands. Once two-way editing lands, add an auto-save toggle (persisted on disk) that controls when bridge `replace_full` / `apply_edits` requests are issued.

2. **Bi-directional editing**  \
   Implement an `updateListener` that diffs CM6 changes, batches them, and posts to `/api/app/code_oss/edits`. Handle bridge `ack` responses to reconcile revisions and surface sync errors in the UI.

3. **Terminal panel replacement**  \
   Replace the assistant tray with a multi-tab terminal/agent panel backed by framework shells. Persist layout/shim state beside the existing UI prefs.

4. **Inline git diffs**  \
   Use the cached git metadata to render staged/unstaged hunks inside CM6 via decorations, and add badges to the recent-file menu for dirty items.

5. **Bridge handshake hardening**  \
   Replace the current timer-based retry with an exponential backoff strategy and clearer telemetry when code-server takes longer to boot.
