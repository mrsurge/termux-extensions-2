# Explorer v2 – Context & Requirements Snapshot (for Future Work)

This file is a compressed context dump for rebuilding the explorer frontend around a WebSocket/Socket.IO bus and a cleaner JS architecture.

## 1. High-Level Project Context

- **Project:** `termux-extensions-2` (TE2)
- **Role:** A Termux-centric app framework providing a full IDE and shell environment, with the Code-CM6 editor as one "app".
- **Platforms:** Primarily Android (Termux + GeckoView wrapper), but also runs on desktop (Ubuntu etc.).
- **Key principle:** Disk is the **single source of truth** (SSOT). No localStorage / in-memory-only state for drafts, preferences, or session data.

## 2. Editor & Draft System (Already Working)

- Editor is a NiceGUI CodeMirror 6 iframe:
  - Vendored `codemirror.py` / `codemirror.js` under `app/static/vendor/nicegui/elements/codemirror/`.
  - `editor_app.py` is the NiceGUI iframe backend.
  - `main.js` is the host shell around the iframe.

- **Diff system:**
  - Git diffs (green/red) and draft diffs (blue/yellow) are **unified** into a combined decoration set.
  - Decorations propagate to gutters, fold markers, and minimap.

- **Draft sidecars:**
  - Stored on disk via `HistoryStore` under `~/.cache/cm6_sessions/...`.
  - Entries include `project_path`, `file_path`, `content`, `base_sha256`, `content_sha256`, `unsaved`, `run_id`, etc.
  - `list_project_drafts(project_path)` scans sidecars for unsaved entries.

- **Multi-file drafts:**
  - Multiple drafts across files are supported.
  - "Review Edits" overlay lists draft hunks across the project.
  - Explorer tree uses draft accents (right-side bar) to show which files have drafts.

- **Review Edits overlay:**
  - Renders hunks from `review.list_reviews()`.
  - Clicking file header or hunk header or diff row:
    - Calls `openFileAndMaybeJump(entry.rel, line, { focus: false })`.
    - Jumps to the correct line in the editor using the jump-to-line pipeline.
  - Supports bulk save/discard; backend uses normal write path so git/drafts/inline diffs remain in sync.

- **Session cache semantics:**
  - Uses "Option 2": null/clean sidecars considered unmodified.
  - Sidecar created only when unsaved changes exist.
  - `state` for a cached entry is `mid_session` or `crashed` based on `run_id` vs current `RUN_ID`.

- **Autosave:**
  - When ON: drafts for the active file are not written; autosave writes directly to disk.
  - Enabling autosave prompts the user (warns about saving current file and discarding other drafts if they choose to accept).

- **Scroll tracking:**
  - A ViewPlugin tracks **visible viewport** in CM6 and posts `cm6-scroll-state` messages via `notifyParent`.
  - Host `main.js` saves `{ scrollLine, scrollTop }` into `HistoryStore.session_state`.
  - On editor init, `editor_app.py` reads `scrollLine` and passes `initial_scroll_line` to `ui.codemirror`.
  - `codemirror.js` uses `initialScrollLine` to build the editor viewport around that line (no post-load jump). Keyboard is not popped on mobile.

- **Editor focus integration:**
  - `codemirror.js` emits `cm6-editor-focus` on focusin/mousedown inside the editor.
  - `main.js` listens and `closeAllMenus()`; this keeps top-level menus in sync with iframe focus.

## 3. Current Explorer Responsibilities & Features

The existing `explorer.js` (v1) is a large, monolithic script that handles:

- The **tree view** (file/folder list) in the left sidebar.
- **Git decorations** on tree nodes.
- **Draft decorations** on tree nodes (using review sidecar info).
- The **search overlay** with tabs:
  - By Name (path search).
  - By Contents (rg/Python-based content search).
  - By Changes (git diff hunk view).
  - Review Edits (draft diff review across all files).
- **Search by Changes:**
  - Calls backend diff routines.
  - Renders per-file groups + hunks + per-line diff rows.
  - Now supports per-hunk and per-row jumping using `data-line` and `openFileAndMaybeJump(rel, line, {focus:false})`.
- **Review Edits tab:**
  - Renders the draft review list/hunks.
  - Uses `firstDiffLine(entry)` and per-row `data-line` as the jump target.
  - Auto-enables draft diffs (`__cm6EnsureDraftDiffs`) and inline diffs (`__cm6EnsureInlineDiffs`) before jumping.
- **Recents dropdown:**
  - Lists last opened files; now correctly refreshed from backend state.
- Various context menus and actions:
  - Rename, delete, copy/move, stage/unstage, batch ops, restore from HEAD, etc.

## 4. Explorer WebSocket Layer (Raw WS, current)

### 4.1 `explorer_ws.py` now

- Uses FastAPI raw `WebSocket` with a `ConnectionManager`:
  - Tracks connections per `project_path` and supports broadcast.
- `ExplorerDispatcher`:
  - On `initialize()`:
    - Registers connection: `manager.connect(websocket, project_root)`.
    - Emits initial state:
      - `project:setActive { path }`.
      - `git:status { ... }` via `broadcast_git_status()`.
      - `explorer:setList` using `list_dir('.')`.
      - `review:setEntries` via `broadcast_review_state()`.
  - Provides helpers:
    - `emit_personal(type, payload, reply_to)`.
    - `broadcast(type, payload)`.
    - `send_error(message, reply_to)`.
  - Handlers for:
    - Explorer: list/refresh/create/rename/delete/batch ops, move/copy, project open/create/list.
    - Git: status, stage/unstage, stageAll/unstageAll, restore, commit, push/pull, reset, init, diff base set, list branches/commits.
    - Search: `search_run` → `search:setResults`.
    - Review: `review_list` → `review:setEntries`, `review_save`, `review_discard`.

### 4.2 Gaps / issues noted so far

- **Double-accept risk:**
  - `ConnectionManager.connect()` calls `websocket.accept()`.
  - `ExplorerDispatcher.initialize()` calls `manager.connect()`.
  - `handle_project_open()` calls `manager.disconnect()` then `manager.connect()` again.
  - For FastAPI `WebSocket`, calling `accept()` twice is unsafe.

- **RPC-ish semantics:**
  - Inbound events are more like `explorer_list`, `git_status`, etc.
  - Outbound events are sometimes stateful (`git:status`, `review:setEntries`), sometimes very specific (`explorer:created`).
  - There’s no single `explorer:setTree` or unified `explorer:updateDecorations` event yet.

- **No unified tree/decorations snapshot:**
  - WS emits `explorer:setList` for a directory listing but not a full tree view with git/draft decorations.
  - Explorer UI still relies heavily on REST and local state for tree + decorations.

- **Multi-client broadcast only partially used:**
  - Git/review events are broadcast appropriately.
  - Tree changes are not yet reflected as a canonical state snapshot for all clients.

## 5. Socket.IO Direction (To Be Implemented)

We’ve decided:

- For the **UI bus only**, adopting Socket.IO is reasonable because:
  - `python-socketio` is already in the stack (Flask IPC server, NiceGUI itself, vendored testing tools).
  - Reconnect & heartbeat issues are painful to hand-roll, especially on mobile; Socket.IO helps here.
- The **protocol** remains ours:
  - Event names like `explorer:open`, `explorer:setTree`, `explorer:updateDecorations`, `search:setResults`, `review:setEntries`.
  - Backend as state owner; frontend as thin store/view.

Planned approach:

- Add a Socket.IO namespace for explorer UI (e.g. `/explorer-ui`) on the existing Socket.IO server (NiceGUI’s `core.sio`), for testing via CDN client.
- In the explorer namespace:
  - Map events to the same handler logic as `ExplorerDispatcher` (either by:
    - Reusing it through a transport adapter, or
    - Implementing similar handlers that call the same backend helpers).
- On the frontend (host `main.js`):
  - Include Socket.IO client via CDN.
  - Initialize a client that:
    - Subscribes to `explorer:*`, `git:*`, `search:*`, `review:*` events.
    - Eventually uses these events to drive a **new explorer view model** instead of direct `fetch` calls.

## 6. New Explorer JS (v2) Requirements

Goal: A new JS module that will ultimately replace the old `explorer.js` for explorer/search/review responsibilities, with these properties:

1. **UI bus driven**
   - Core data comes from the Socket.IO UI bus (or raw WS in interim).
   - No direct REST calls from the explorer view for tree/search/review once migrated.

2. **State store + view model**
   - Single `uiState` object in `main.js` (or a dedicated module) holding:

     ```js
     const uiState = {
       explorer: {
         tree: null,
         decorations: { git: {}, drafts: {} },
         search: { mode: 'name', results: null },
       },
       review: {
         entries: [],
       },
     };
     ```

   - Reducers update this state based on bus messages.
   - Rendering functions (e.g. `renderExplorerFromState`, `renderSearchOverlayFromState`, `renderReviewFromState`) consume it to update the DOM.

3. **Small DOM helper layer**
   - A limited set of helpers for tree DOM manipulations:

     ```js
     const explorerDom = {
       getNode(rel) { ... },
       setGitStatus(rel, status) { ... },
       setDraft(rel, hasDraft) { ... },
       setExpanded(rel, expanded) { ... },
       setSelected(rel, selected) { ... },
     };
     ```

   - All class/dataset writing for the tree goes through `explorerDom`.

4. **Intent/command surface**
   - All user actions in explorer/search/review send high-level events over the UI bus, e.g.:

     ```js
     uiBus.send('explorer:open', { rel });
     uiBus.send('explorer:toggleExpand', { rel });
     uiBus.send('search:run', { mode, query });
     uiBus.send('review:save', { files });
     ```

   - Where some actions remain pure-frontend (e.g. transient UI toggles), they should still be tracked via `uiState`.

5. **Parity with existing behavior**

- Tree view features:
  - Git/draft accents.
  - Expand/collapse directories.
  - Context menu actions (rename, delete, copy/move, etc.).

- Search overlay tabs:
  - Name, Content, Changes, Review Edits.
  - Per-hunk/per-line jump behavior preserved.

- Review Edits:
  - Bulk save/discard.
  - Correct draft decorations across explorer.

- Recents dropdown and tree selection:
  - Still integrated with `HistoryStore` and `/state`/`/session_state` semantics.

6. **Keyboard/iframe interaction constraints**

- Don’t disturb the existing focus/keyboard logic for the editor iframe:
  - Jumps via `jumpToCurrentFileLine(line, { focus:false })` when coming from overlays.
  - Jumps via `jumpToCurrentFileLine(line)` (focus true) for direct editor actions (Go To Line).
- Menu closing via `cm6-editor-focus` should remain functional.

## 7. What the Future `tmp7.md` / new explorer module needs

When designing the replacement `explorer_v2` JS file, we need to:

- Use this snapshot (`tmp8.md`) as the source of truth for:
  - Existing behavior that must be preserved.
  - Events and protocols already in place (including CM6 messages and scroll/menus behavior).
  - The planned Socket.IO UI bus and message vocabulary.
- Avoid direct edits to the existing `explorer.js` until the new module is ready and validated against this behavior.

