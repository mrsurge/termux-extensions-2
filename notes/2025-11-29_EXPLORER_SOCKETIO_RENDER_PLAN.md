# Explorer Socket.IO UI Bus & Explorer v2 – Plans

This file records the two related plans discussed for moving the explorer to a Socket.IO‑driven UI bus and a new `explorer_v2.js`, verbatim.

---

## Plan A – High‑Level Next Move (Original Outline)

Given what’s in `explorer_ws.py`, `explorer/*`, `template.html`, and the current monolithic `explorer.js`, the safest next step is to introduce a **minimal Socket.IO UI bus + new explorer module in parallel**, without disturbing existing behavior yet.

Concretely:

1. **Add Socket.IO UI namespace (backend, very small)**
   - Use your existing `python-socketio` instance.
   - Create a namespace like `/fe-explorer`.
   - On connect, send a single initial snapshot event (borrowing from `ExplorerDispatcher.initialize()` in `explorer_ws.py`):
     - `explorer:setTree` (directory listing from `explorer_helper.list_dir`).
     - `git:status` (from `git_helper.get_status`).
     - `review:setEntries` (from `explorer.review.list_reviews`).
   - For now, don’t handle any incoming commands; just push state.

2. **Introduce a tiny `uiBus` client in `main.js`**
   - Load Socket.IO via CDN in `template.html`.
   - In `main.js`, add something like `connectExplorerSocket()`:
     - `const socket = io('/fe-explorer');`
     - `socket.on('explorer:setTree', payload => window.__explorerBusDispatch('explorer:setTree', payload));`
     - Same for `git:status`, `review:setEntries`.
   - Expose `window.__explorerBusSend(type, payload)` as a thin wrapper around `socket.emit(...)` for later use.
   - For now, we’ll only use the inbound side to render from backend state.

3. **Create `explorer_v2.js` (new, read‑only, behind a flag)**
   - New file, imported alongside the old one, but only “listening” for now:
     - Define a small `uiState` object (tree, gitStatus, reviewEntries).
     - Implement `handleExplorerEvent(type, payload)` that updates `uiState` and re-renders the tree/search overlay into the existing DOM targets from `template.html`.
   - Hook it up via:
     - `window.__explorerBusDispatch = (type, payload) => explorerV2Handle(type, payload);`
   - Don’t wire any click handlers or commands yet; just prove we can drive the explorer’s view **purely from backend-pushed state**.

4. **Pick one interaction to port next**
   - Once read‑only rendering is working, choose a single intent to go bus‑first:
     - e.g. Clicking a file in the tree:
       - Frontend: `__explorerBusSend('explorer:open', { rel })`.
       - Backend (Socket.IO handler): call the existing file‑open logic (or reuse `appOpenFileRel`) and then emit updated `explorer:setTree` / `git:status` if needed.
   - Use this to validate the full round‑trip (intent → backend → state push) before moving more behaviors.

This sequence keeps everything you have working, starts using Socket.IO in the smallest possible way, and gives you a clean place (`explorer_v2.js` + `uiBus`) to grow the new, backend‑driven explorer without touching the big `explorer.js` until you’re confident.

---

## Plan B – Detailed Socket.IO + Explorer v2 Render Plan

**Plan (recorded)**

1. **Add Socket.IO UI namespace (backend, very small)**
   - Use the existing `python-socketio` instance.
   - Create a namespace like `/fe-explorer`.
   - On connect, send a single initial snapshot (mirroring `ExplorerDispatcher.initialize()` in `explorer_ws.py`):
     - `explorer:setTree` – directory listing from `explorer_helper.list_dir` (hierarchical or root + children).
     - `git:status` – from `git_helper.get_status`.
     - `review:setEntries` – from `explorer.review.list_reviews`.
   - For this first phase, do **not** handle any incoming commands; just push state.

2. **Introduce a tiny `uiBus` client in `main.js`**
   - Load Socket.IO via CDN in `template.html`.
   - In `main.js`, add `connectExplorerSocket()`:
     - `const socket = io('/fe-explorer');`
     - `socket.on('explorer:setTree', payload => window.__explorerBusDispatch('explorer:setTree', payload));`
     - `socket.on('git:status', payload => window.__explorerBusDispatch('git:status', payload));`
     - `socket.on('review:setEntries', payload => window.__explorerBusDispatch('review:setEntries', payload));`
   - Expose a thin outbound helper for the future:
     - `window.__explorerBusSend = (type, payload) => socket.emit(type, payload);`
   - For now, we’ll only use the inbound side to render from backend state.

3. **Create `explorer_v2.js` and implement read‑only tree/card rendering (no twisties)**
   - Add a new JS file (e.g. `static/js/explorer_v2.js`) and include it in `template.html` **after** `main.js`.
   - Inside `explorer_v2.js`:
     - Define simple UI state:

       ```js
       const uiState = {
         projectPath: null,
         tree: [],       // backend tree model
         gitStatus: null,
         reviewEntries: [],
       };
       ```

     - Export a handler that the bus can call:

       ```js
       export function explorerV2Handle(type, payload) {
         switch (type) {
           case 'explorer:setTree':
             uiState.projectPath = payload.projectPath || uiState.projectPath;
             uiState.tree = payload.entries || [];
             renderExplorerTree();
             break;
           case 'git:status':
             uiState.gitStatus = payload;
             // (Later: render git summary/buttons)
             break;
           case 'review:setEntries':
             uiState.reviewEntries = payload.entries || [];
             // (Later: wire review overlay)
             break;
         }
       }
       ```

     - Wire it from `main.js`:

       ```js
       window.__explorerBusDispatch = (type, payload) => {
         if (window.explorerV2Handle) {
           window.explorerV2Handle(type, payload);
         }
       };
       ```

     - Implement `renderExplorerTree()` focusing **only** on visual tree/card output, no behavior:
       - Grab the existing container: `const treeEl = document.getElementById('fe-file-tree');`
       - Clear it: `treeEl.innerHTML = '';`
       - For the root:
         - Create `<li class="fe-tree-node fe-tree-root" data-kind="dir" data-rel="." data-open="true">`.
         - Inside it, **do not create a twisty**:
           - Create `<span class="fe-entry-icon fe-entry-icon-dir">`.
           - Create `<span class="fe-tree-text">Project name</span>` (fall back to basename of `projectPath`).
           - Create `<button class="fe-card-menu-btn">⋮</button>` (no click handler yet).
           - Append a child `<ul class="fe-tree">` for children.
       - For each child entry in `uiState.tree`:
         - Create `<li class="fe-tree-node" data-kind="{file|dir}" data-rel="{rel}" data-name="{name}">`.
         - Do **not** create `.fe-tree-twisty` at all.
         - Add:
           - `<span class="fe-entry-icon fe-entry-icon-{kind}">`.
           - `<span class="fe-tree-text">name</span>` (re-using `applyEntryStyling` rules later if needed).
           - `<button class="fe-card-menu-btn">⋮</button>` (no behavior yet).
         - Optionally add `data-depth` or similar for indentation; we can drive indent via CSS instead of twisty buttons.
       - Don’t hook any click/selection logic yet; this step is purely about reproducing the **look** (same cards, icons, labels, git/draft classes if present in payload), minus twisties and behaviors.
   - Result: when the backend emits `explorer:setTree`, the new module renders the tree and cards into `#fe-file-tree` purely from the pushed model.

4. **Pick one interaction to port later**
   - After we confirm the new render path works visually:
     - Choose one intent (e.g. file open) to go bus‑first:
       - Frontend: `__explorerBusSend('explorer:open', { rel })` on click.
       - Backend Socket.IO handler: call the existing file‑open logic (or reuse `appOpenFileRel`) and then emit any updated state events.
   - That will validate the full “intent → backend → state push → render” loop before we migrate more behaviors.

That’s the plan written down; next concrete move is Step 3: build `explorer_v2.js` with the read‑only tree/card renderer driven by `explorer:setTree`, no twisties, no behaviors yet.

---

## 2025-11-29  – Explorer v2 WS Integration Progress Log

### What’s Implemented (as of 2025-11-29)

**1. Bus location & transport**

- The UI bus now lives **inside the file_editor_cm6 app**, not in the IPC server:
  - Backend WS endpoint: `app/apps/file_editor_cm6/explorer_ws.py`:
    - Exposes `explorer_websocket(websocket: WebSocket)`.
    - Uses `ExplorerDispatcher` for message handling.
  - Mounted in `app/apps/file_editor_cm6/main.py`:

    ```python
    from .explorer_ws import explorer_websocket
    file_editor_cm6_bp.add_api_websocket_route("/ws/explorer", explorer_websocket)
    ```

- The **framework** proxies WS connections for apps:
  - `app/main.py`:

    ```python
    @app.websocket('/ws/app/{app_id}/{route:path}')
    async def proxy_app_websocket(websocket, app_id, route):
        # Bridges browser → worker at ws://127.0.0.1:{port}/ws/{route}
    ```

- The **browser** connects via the framework proxy to the editor worker:
  - `app/apps/file_editor_cm6/main.js`:

    ```js
    let explorerSocket = null;

    function connectExplorerSocket() {
      if (explorerSocket) return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Framework WS proxy: /ws/app/{app_id}/{route}
        const wsUrl = `${protocol}//${window.location.host}/ws/app/file_editor_cm6/explorer`;
        explorerSocket = new ReconnectingWebSocket(wsUrl);

        explorerSocket.onmessage = (event) => {
          let msg;
          try {
            msg = JSON.parse(event.data);
          } catch {
            return;
          }
          const type = msg.type;
          const payload = msg.payload || {};
          if (!type) return;
          if (typeof window.__explorerBusDispatch === 'function') {
            window.__explorerBusDispatch(type, payload);
          }
        };

        window.__explorerBusSend = (type, payload) => {
          if (!explorerSocket || explorerSocket.readyState !== WebSocket.OPEN) return;
          const msg = { type, payload: payload || {} };
          try {
            explorerSocket.send(JSON.stringify(msg));
          } catch (err) {
            console.warn('[ExplorerWS] Failed to send message', err);
          }
        };
      } catch (err) {
        console.warn('[ExplorerWS] Failed to open explorer WebSocket:', err);
      }
    }
    ```

- `main()` calls:

  ```js
  await initExplorerUI().catch(...);
  connectExplorerSocket();
  ```

  so the drawer UI and WS bus both initialize at boot.

**2. Backend dispatcher & messages**

- `ExplorerDispatcher.initialize()` in `explorer_ws.py`:

  ```python
  await manager.accept_and_register(self.websocket, str(self.project_root))
  await self.emit_personal("project:setActive", {"path": str(self.project_root)})
  await self.broadcast_git_status()
  await self.emit_personal("explorer:setList", list_dir('.'))
  await self.broadcast_review_state()
  ```

  - `project:setActive` – tells UI which project root is active.
  - `explorer:setList` – sends `{ cwd, entries: [...] }` for the project root.
  - `git:status` – broadcast git summary.
  - `review:setEntries` + `explorer:updateDecorations` – broadcast draft review entries and draft decorations.

- The dispatcher already exposes rich handlers (no changes needed for now):
  - `explorer:list`, `explorer:refresh`.
  - File ops: `explorer:createFile`, `explorer:createDir`, `explorer:rename`, `explorer:delete`, `explorer:batchDelete`, `explorer:move`, `explorer:copy`, `explorer:copyFrom`, `explorer:moveFrom`.
  - Git ops: `git:status`, `git:stageAll`, `git:unstageAll`, `git:commit`, `git:reset`, etc.
  - Search: `search:run`.
  - Review: `review:list`, `review:save`, `review:discard`.

**3. New explorer.js (v2)**

- `app/apps/file_editor_cm6/static/js/explorer.js` is fully replaced by a WS-driven version:

  - Minimal, backend-owned state:

    ```js
    let treeElement = null;
    let projectLabelEl = null;
    let gitSummaryEl = null;

    const uiState = {
      projectPath: null,
      gitStatus: null,
      reviewEntries: [],
    };
    ```

  - Renders project label and git summary from messages:

    ```js
    function renderProjectLabel() { ... }
    function renderGitSummary() { ... }
    ```

  - Renders the tree root card:

    ```js
    function renderExplorerTree() {
      treeElement = document.getElementById('fe-file-tree');
      clearElement(treeElement);
      const rootLi = document.createElement('li');
      rootLi.className = 'fe-tree-node fe-tree-root';
      rootLi.dataset.kind = 'dir';
      rootLi.dataset.rel = '.';
      rootLi.dataset.open = 'true';
      // icon, text (basename(projectPath) or 'Project'), ⋮ button, and <ul.fe-tree> child
      ...
    }
    ```

  - Renders lists of entries into a `<ul>`:

    ```js
    function renderEntriesInto(containerUl, entries) {
      clearElement(containerUl);
      const list = Array.isArray(entries) ? entries : [];
      for (const entry of list) {
        const li = document.createElement('li');
        li.className = 'fe-tree-node';
        li.dataset.kind = entry.kind || 'file';
        li.dataset.rel = entry.rel || entry.path || '';
        li.dataset.name = entry.name || '';
        if (entry.gitStatus) {
          li.dataset.gitStatus = entry.gitStatus;
          li.classList.add(`fe-git-${entry.gitStatus}`);
        }
        const iconSpan = document.createElement('span');
        iconSpan.className = `fe-entry-icon fe-entry-icon-${entry.kind || 'file'}`;
        const textSpan = document.createElement('span');
        textSpan.className = 'fe-tree-text';
        textSpan.textContent = entry.name || '';
        const menuButton = document.createElement('button');
        menuButton.className = 'fe-card-menu-btn';
        menuButton.textContent = '⋮';
        li.appendChild(iconSpan);
        li.appendChild(textSpan);
        li.appendChild(menuButton);
        containerUl.appendChild(li);
      }
    }
    ```

- Message dispatch hook:

  ```js
  window.__explorerBusDispatch = (type, payload) => {
    try {
      handleExplorerEvent(type, payload || {});
    } catch (err) {
      console.warn('[Explorer] dispatch error', type, err);
    }
  };
  ```

**4. Message handling on the frontend**

- `handleExplorerEvent(type, payload)` supports:

  - `project:setActive`:

    ```js
    case 'project:setActive': {
      uiState.projectPath = payload.path || payload.projectPath || uiState.projectPath;
      renderProjectLabel();
      break;
    }
    ```

  - `explorer:setList`:

    ```js
    case 'explorer:setList': {
      const cwd = payload.cwd || '.';
      treeElement = document.getElementById('fe-file-tree');
      if (!treeElement) break;

      if (cwd === '.' || cwd === '') {
        renderExplorerTree();
        const rootLi = treeElement.querySelector('li.fe-tree-node.fe-tree-root');
        let childList = rootLi.querySelector(':scope > ul.fe-tree') || document.createElement('ul');
        childList.className = 'fe-tree';
        rootLi.appendChild(childList);
        renderEntriesInto(childList, payload.entries);
      } else {
        const dirLi = treeElement.querySelector(
          `li.fe-tree-node[data-kind=\"dir\"][data-rel=\"${cwd}\"]`
        );
        if (!dirLi) break;
        let childList = dirLi.querySelector(':scope > ul.fe-tree') || document.createElement('ul');
        childList.className = 'fe-tree';
        dirLi.appendChild(childList);
        dirLi.dataset.open = 'true';
        renderEntriesInto(childList, payload.entries);
      }
      break;
    }
    ```

  - `explorer:setTree` (future protocol support):

    ```js
    case 'explorer:setTree': {
      uiState.projectPath = payload.projectPath || uiState.projectPath;
      renderProjectLabel();
      renderExplorerTree();
      const rootLi = treeElement.querySelector('li.fe-tree-node.fe-tree-root');
      let childList = rootLi.querySelector(':scope > ul.fe-tree') || document.createElement('ul');
      childList.className = 'fe-tree';
      rootLi.appendChild(childList);
      renderEntriesInto(childList, payload.entries || payload.nodes || []);
      break;
    }
    ```

  - `explorer:updateDecorations` (draft flags only, git decorations re-used from entry.gitStatus):

    ```js
    case 'explorer:updateDecorations': {
      const drafts = (payload && payload.drafts) || {};
      const root = treeElement || document.getElementById('fe-file-tree');
      if (!root) break;
      root.querySelectorAll('li.fe-tree-node[data-kind=\"file\"]').forEach((li) => {
        li.classList.remove('fe-draft');
        delete li.dataset.hasDraft;
      });
      Object.entries(drafts).forEach(([rel, info]) => {
        if (!info || !info.hasDraft) return;
        const li = root.querySelector(
          `li.fe-tree-node[data-kind=\"file\"][data-rel=\"${rel}\"]`
        );
        if (!li) return;
        li.dataset.hasDraft = '1';
        li.classList.add('fe-draft');
      });
      break;
    }
    ```

  - `git:status` and `review:setEntries` update git summary and in-memory review list.

**5. Tree interaction (expand/collapse + open files)**

- In `initExplorerUI()`:

  ```js
  if (treeElement) {
    treeElement.addEventListener('click', (ev) => {
      const li = ev.target.closest('li.fe-tree-node');
      if (!li) return;
      const rel = li.dataset.rel;
      const kind = li.dataset.kind;
      if (!rel) return;

      // Menu button
      const menuBtn = ev.target.closest('.fe-card-menu-btn');
      if (menuBtn) {
        const entry = {
          rel,
          name: li.dataset.name || li.querySelector('.fe-tree-text')?.textContent || '',
          kind: kind || 'file',
        };
        openCardMenuForEntry(entry, menuBtn);
        return;
      }

      // Directory expand/collapse
      if (kind === 'dir') {
        if (rel === '.') return; // do not collapse synthetic root
        const isOpen = li.dataset.open === 'true';
        if (isOpen) {
          li.dataset.open = 'false';
          const childList = li.querySelector(':scope > ul.fe-tree');
          if (childList) childList.remove();
        } else {
          li.dataset.open = 'true';
          if (typeof window.__explorerBusSend === 'function') {
            window.__explorerBusSend('explorer:list', { rel });
          }
        }
        return;
      }

      // File open
      if (kind === 'file') {
        if (typeof window.appOpenFileRel === 'function') {
          window.appOpenFileRel(rel, uiState.projectPath || null);
        }
      }
    });
  }
  ```

- This gives:
  - Lazy dir listing via `explorer:list` / `explorer:setList`.
  - Single-click file open via `window.appOpenFileRel` (wired to `openFile()` in `main.js`).

**6. Context actions (WS-based)**

- `initExplorerUI()` now creates a reusable `.fe-card-menu` on `document.body`.
- `openCardMenuForEntry(entry, anchorEl)` builds a simple context menu:
  - For dirs:
    - “New File…” → `explorer:createFile({ parent_rel: rel, name })`.
    - “New Folder…” → `explorer:createDir({ parent_rel: rel, name })`.
  - For both files and dirs:
    - “Rename…” → `explorer:rename({ rel, new_name })`.
    - “Delete” (destructive) → `explorer:delete({ rel })`.

- On backend:
  - `handle_explorer_createFile`, `handle_explorer_createDir`, `handle_explorer_rename`, `handle_explorer_delete` already exist and emit:
    - `explorer:created`, `explorer:renamed`, `explorer:deleted` **and** a follow-up `explorer:setList(parent)` where appropriate.
  - The UI’s existing `explorer:setList` handler refreshes the parent directory in-place; deletions currently rely on the broadcast `explorer:setList(parent)` (or a manual refresh).

**7. Initial placeholder**

- On init, before any WS messages arrive, the tree shows:

  ```js
  renderProjectLabel();
  if (treeElement) {
    const empty = document.createElement('li');
    empty.className = 'fe-tree-empty';
    empty.textContent = 'Waiting for project snapshot…';
    treeElement.appendChild(empty);
  }
  ```

  and is replaced as soon as the first `explorer:setList` (cwd `.`) arrives.

---

### What’s Left To Do (Detailed TODO)

**A. Tree behavior & state polish**

1. **Persist expanded dirs (optional)**
   - Current behavior:
     - Expanded/collapsed state lives only in the DOM (`data-open`) and is lost on reload.
   - Desired:
     - Optionally persist expanded directories per project (e.g., via `HistoryStore`):
       - Track expanded `rel` set on the backend or broadcast a `explorer:setState` snapshot that the frontend can apply.
     - On reconnect, re-expand previously expanded dirs by sending `explorer:list` for each, in depth order.

2. **`explorer:deleted` UI handling**
   - Currently:
     - `handle_explorer_delete` broadcasts `explorer:deleted` but does not push a fresh listing.
   - Options:
     - Either:
       - Make backend also broadcast `explorer:setList(parent)` (like `createFile`/`createDir`), or
       - Add a small UI handler for `explorer:deleted` that:
         - Locates `li.fe-tree-node[data-rel="{rel}"]` and removes it.
         - If the parent becomes empty, optionally re-request via `explorer:list(parent)` or show “(empty)” state.

3. **Better dir icon/indicator for open vs closed**
   - Currently:
     - No explicit visual open/closed state (no twisties).
   - Future:
     - Add subtle CSS for open dirs (e.g., bold label, slight color accent) without introducing interactive twisty DOM elements.

**B. Git decorations & actions over WS**

1. **Git decorations already partially driven**
   - `list_dir()` annotates entries with `gitStatus`, which we already map to CSS classes (`fe-git-*`).
   - When `git:status` and `explorer:setList` are broadcast after git actions, the tree reflects the new state.

2. **Wire footer git controls to WS**
   - Currently (legacy explorer):
     - Git buttons call REST endpoints (`/git/stage_all`, `/git/commit`, etc.).
   - New plan:
     - Rewire:
       - Stage All / Unstage All / Commit / Reset / Init / Push / Pull
       - To `window.__explorerBusSend('git:stageAll', {})`, `git:commit`, etc.
     - Use existing WS handlers in `ExplorerDispatcher` (`handle_git_stageAll`, `handle_git_commit`, etc.) to:
       - Update git status.
       - Broadcast `git:status` and any required `explorer:setList` changes.

**C. Search overlay over explorer WS**

1. **Move “By Name / By Contents / By Changes” to WS**
   - Frontend:
     - On search run:
       - `__explorerBusSend('search:run', { mode: 'name'|'content'|'changes', query })`.
   - Backend:
     - Already has `handle_search_run`:

       ```python
       async def handle_search_run(self, payload, msg_id):
           mode = payload.get("mode", "name")
           query = payload.get("query", "")
           ...
           await self.emit_personal("search:setResults", res, msg_id)
       ```

   - UI:
     - Add `search:setResults` handler that updates the existing search overlay components and reuses the existing diff/jump-to-line behavior.

**D. Review Edits overlay via WS**

1. **Use existing review handlers**
   - Backend already:
     - Broadcasts `review:setEntries` and `explorer:updateDecorations` in `broadcast_review_state`.
     - Supports `review:list`, `review:save`, `review:discard` WS commands.

2. **Frontend integration**
   - Add UI handlers:
     - `review:setEntries` → rerender the “Review Edits” tab from payload.
     - Click on draft hunk / row:
       - Use the same pattern as “Search by Changes”:
         - Call `window.appOpenFileRel(rel, projectPath)`, then `jumpToCurrentFileLine(line, { focus: false })` via the existing jump-to-line pipeline.
   - Bulk save/discard:
     - Send `review:save` / `review:discard` with `{ files: [...] }` over WS.
     - Rely on backend to:
       - Write to disk via existing save path.
       - Broadcast `git:status`, `review:setEntries`, `explorer:updateDecorations` to update both tree and overlay.

**E. Refactor and document final protocol**

1. **Normalize message vocabulary (UI-focused)**
   - Finalize the set:
     - Inbound: `explorer:list`, `explorer:refresh`, `explorer:createFile`, `explorer:createDir`, `explorer:rename`, `explorer:delete`, `search:run`, `review:save`, `review:discard`, `git:*`.
     - Outbound: `project:setActive`, `explorer:setList`, `explorer:updateDecorations`, `git:status`, `review:setEntries`, `search:setResults`, `explorer:deleted`, etc.

2. **Update TECHNICAL.md / guidelines**
   - Document:
     - That explorer v2 is now **entirely WS-driven** via `/ws/app/file_editor_cm6/explorer`.
     - How to hook new explorer-related features into this bus (message types, payload shapes, and where to plug in UI handlers).

**F. Optional: Explore per-project UI state persistence**

1. **Expanded dirs, last selected entry, last search query**
   - Decide what UI state is worth persisting in `HistoryStore` (under `projects[project].explorer_state`).
   - Add WS commands like `explorer:setState` / `explorer:getState` to read/write this small view model.

---

_Log timestamp: 2025-11-29T00:00:00Z (approximate – same working session as the multi-draft + recents work and initial explorer v2 wiring)._ 

---

### Log: Explorer v2 Socket/WS Refactor – Editor-Integrated Phase

**Timestamp:** 2025-11-30T23:45:00Z  
**Author:** _FugueTask (cm6/ws cartographer)_

**What’s now working**
- **Explorer v2 is live and WS-driven**
  - `app/apps/file_editor_cm6/explorer_ws.py` exposes a project-scoped WebSocket endpoint (`/ws/explorer`) and dispatches typed messages (`explorer:list`, `git:status`, `search:run`, `review:*`, etc.).
  - `app/apps/file_editor_cm6/main.js` connects via the framework proxy (`/ws/app/file_editor_cm6/explorer`) using `ReconnectingWebSocket`, and forwards messages into the UI bus via `window.__explorerBusDispatch(type, payload)`.
  - `app/apps/file_editor_cm6/static/js/explorer.js` is the new explorer implementation:
    - Owns a small `uiState` (projectPath, gitStatus, reviewEntries).
    - Renders the tree, project label, git summary, draft decorations.
    - Handles all explorer actions through the WS bus (`__explorerBusSend`).

- **Tree + cards**
  - Drawer chrome and tree root render from WS snapshots:
    - `project:setActive` → project label.
    - `explorer:setList` (cwd `"."`) → root card (`.`) + immediate children.
    - `explorer:setList` (cwd `<dir>`) → lazy expansion for directories.
  - File clicks call `window.appOpenFileRel(rel, projectPath)` to reuse the unified editor-opening pipeline in `main.js`.
  - Context menu on each node (⋮) is wired to WS operations:
    - `explorer:createFile`, `explorer:createDir`, `explorer:rename`, `explorer:delete`.

- **Draft decorations**
  - Draft state is SSOT in `HistoryStore` sidecars.
  - `explorer_helper.list_dir()` annotates entries with `hasDraft`.
  - `ExplorerDispatcher.broadcast_review_state()`:
    - Emits `review:setEntries` with lightweight review entries.
    - Emits `explorer:updateDecorations` with `{ drafts: { rel: { hasDraft: True } } }`.
  - `explorer.js` listens to `explorer:updateDecorations` and marks `li[data-kind="file"][data-rel="…"]` with `.fe-draft` and `data-hasDraft="1"` to light up the right edge accents.

- **Search overlay over WS**
  - Overlay is rebuilt in v2 inside `explorer.js` using the existing DOM targets in `template.html` (`#fe-search-overlay`).
  - Tabs:
    - **By name**: `searchMode = 'name'`, sends `search:run` with `{mode:'name', query}`.
    - **By contents**: `mode:'content'`.
    - **By changes**: `mode:'changes'`.
    - **Review edits**: uses `review:list` + `review:setEntries`.
  - `ExplorerDispatcher.handle_search_run`:
    - For `name`: `search.search_by_name`.
    - For `content`: ripgrep/python fallback.
    - For `changes`: `search.search_by_changes` with git hunks.
    - Emits `search:setResults` to the requesting client.
  - `explorer.js` implements:
    - `renderNameResults` and `renderContentResults` (mirrors v1).
    - `renderChangesResults` + `applyChangesFilter` with:
      - Filter ON/OFF.
      - Filename-only.
      - Hunks-only.
    - Draft-aware per-hunk click → `openFileAndMaybeJump(rel, line, {focus:false})`.

- **Unified diff base (“Status / Diff vs …”)**
  - Single in-memory `gitDiffBase` in `explorer.js`:
    - Hydrated initially from `window.__cm6EditorState.gitDiffBase` (via `/state`).
    - Re-synced from the backend via `GET /api/app/file_editor_cm6/git/diff_base` on:
      - Explorer init.
      - `project:setActive` (project change).
    - Updated from `search:setResults` when `mode:'changes'` and `payload.base` is present.
    - Updated from `git:diffBaseSet` after WS `git:setDiffBase` calls.
  - Two UI surfaces share this state:
    - Footer button: `#fe-git-base-btn` (Status selector).
    - Search overlay button: `#fe-search-base-btn` (“Diff vs” selector).
  - Both buttons share:
    - Label formatting via `formatDiffBaseLabel(gitDiffBase, withPrefix)`.
    - Dropdown implementation via:
      - `toggleDiffBaseMenu(button, dropdown)`
      - `renderDiffBaseDropdown(dropdown, commits)`
      - `changeDiffBase(ref)` → WS `git:setDiffBase` → `HistoryStore.set_diff_base` → `git:diffBaseSet`.
    - Commits loaded from `/api/app/file_editor_cm6/git/commits`.
    - Inline diffs and “Search by changes” hunks recompute after base change (`__cm6ReloadCurrentFile` + `fetchChangesResults(true)`).

- **Review edits over WS**
  - Backend:
    - `ExplorerDispatcher.handle_review_list` → `review:setEntries`.
    - `handle_review_save` / `handle_review_discard` write via the normal editor save path, mark git cache dirty, and rebroadcast:
      - `git:status`
      - `review:setEntries`
      - `explorer:updateDecorations`.
  - Frontend:
    - “Review edits” tab renders draft hunks, per-hunk `data-line`, and uses:
      - `__cm6EnsureDraftDiffs(true)` + `__cm6EnsureInlineDiffs(true)`.
      - `openFileAndMaybeJump(rel, line, {focus:false})`.
    - Bulk Save/Discard:
      - Sends `review:save` / `review:discard` with `{files:[...]}` via WS.
      - Relies on backend broadcast to keep explorer tree and overlay in sync.

- **Jump-to-line & scroll integration**
  - All search/review clicks are now funneled through the documented jump pipeline:
    - `explorer.js` → `openFileAndMaybeJump(rel, line, {focus:false})`.
    - `main.js` → `apiPost('editor/jump_to_line', { line, focus })`.
    - `editor_app.py` / `codemirror.py` / `codemirror.js` handle scroll-only jumps when `focus:false`, which avoids popping the mobile keyboard.
  - Scroll position is tracked in the iframe via a `ViewPlugin` and sent to host as `cm6-scroll-state` messages, which are persisted in `HistoryStore.session_state` and fed back into the iframe on load.

**Minor quirks / known issues**
- **Explorer “wake-up click”**
  - After a long idle period or Android app switch, the explorer WS sometimes needs one extra user action (tree click or search toggle) before it visually “wakes up”.
  - This appears to be timing around WS reconnect vs. DOM-ready state; the WS reconnect logic itself is solid (ReconnectingWebSocket), but a future pass should:
    - Log `explorerWS` connect/disconnect at higher verbosity.
    - Consider a small “stale state” banner or automatic `explorer:refresh` on reconnect.

- **Diff base UX**
  - Footer used to show “(no git)” until the Search overlay was opened; this is now mitigated by:
    - Early hydration from `/git/diff_base` in `initExplorerUI`.
    - Rehydration on `project:setActive`.
  - Still worth keeping an eye on this: if `/state` and `/git/diff_base` ever diverge, we should treat `/git/diff_base` as canonical for the explorer.

**Onboarding notes for future agents**
- **Core files**
  - `app/apps/file_editor_cm6/main.js` – host shell; owns:
    - WS proxy client (`connectExplorerSocket`).
    - Editor opening (`openFile`, `appOpenFileRel`).
    - Jump-to-line pipeline (`jumpToCurrentFileLine`).
    - Autosave, recents, and editor state sync (`/state`, `/session_state`).
  - `app/apps/file_editor_cm6/explorer_ws.py` – explorer WS dispatcher:
    - `handle_explorer_*`, `handle_git_*`, `handle_search_run`, `handle_review_*`.
    - `broadcast_git_status`, `broadcast_review_state`.
  - `app/apps/file_editor_cm6/explorer_helper.py` – directory listings + git status + draft flags.
  - `app/apps/file_editor_cm6/explorer/search.py` – by-name/content/changes backend logic.
  - `app/apps/file_editor_cm6/explorer/review.py` – draft reviews and bulk save/discard.
  - `app/apps/file_editor_cm6/static/js/explorer.js` – explorer v2 (this file).
  - `app/apps/file_editor_cm6/template.html` – layout, DOM anchors for explorer/search/toolbar.
  - `app/apps/file_editor_cm6/history_store.py` – SSOT for:
    - `diff_base`, project origins, recents, session_state, session cache sidecars.

- **Patterns & tools**
  - Use the provided `bash -lc` shell via the harness for commands; prefer:
    - `rg` for search.
    - `sed -n 'X, Yp'` for file slices (avoid huge dumps).
  - Always patch code with `apply_patch` rather than overwriting files.
  - Treat `HistoryStore` as the **only** source of truth for:
    - Active project.
    - Diff base (`set_diff_base` / `get_diff_base`).
    - Project origin.
    - Session state (`update_session_state`).
  - When in doubt about editor/iframe communication, consult:
    - `docs/core/nicegui_iframe_feature_adding_guideline.md`
    - `notes/2025-11-29_JUMP_TO_LINE_FOCUS_PIPELINE.md`
    - `notes/2025-11-26_MESSAGE_BUS_ARCHITECTURE.md`.

- **Guiding principles**
  - Disk is SSOT: no in-memory tab state, no localStorage, no browser-only caches for anything that matters.
  - Backend owns state; frontend is a thin, replaceable view (even for complex pieces like explorer).
  - WS bus events should be small, typed envelopes:
    - `type: "domain:verb"`, `payload: {…}`.
    - Avoid “RPC over WS”; think state snapshots and intents.

If you’re picking this up later, the shortest route to “mental compile” is:
1. Skim this file.
2. Read `explorer_ws.py` and `static/js/explorer.js` side by side.
3. Cross-check the jump-to-line pipeline in `docs/apps/code_cm6/TECHNICAL.md` and `notes/2025-11-29_JUMP_TO_LINE_FOCUS_PIPELINE.md`.

— _FugueTask_

---

### Next Focus Areas (Remaining Work) – 2025‑11‑30

Captured after the first functional WS explorer v2, to guide the remaining passes:

1. **Drawer footer reattachment**
   - Restore and wire up the drawer footer behaviors that the old explorer owned:
     - Git status / diff‑base summary (“Diff vs …”) must stay in sync with `HistoryStore.diff_base` and the search overlay selector.
     - Footer actions (stage/unstage all, commit, reset, etc.) should all go through the WS bus (`git:*` events), not ad‑hoc REST calls.
   - Ensure footer state hydrates eagerly (on project activation / initial `/state` + `/git/diff_base`), without requiring the search overlay to be opened first.

2. **Remaining card “…” menu actions**
   - The new context menu already covers create/rename/delete; we still need to:
     - Audit all legacy “…” actions in the original `explorer.js` (in the main branch repo) and re‑implement them as WS intents where they still make sense.
     - Make sure each action has:
       - A single WS command (`explorer:*` or `git:*`).
       - A clear backend implementation in `explorer_ws.py` (or a helper module).
       - A state push (`explorer:setList`, `git:status`, `explorer:updateDecorations`, etc.) so the UI stays purely derived from backend state.

3. **Drawer open/close and behavior quirks**
   - Clarify and normalize when the drawer should:
     - Open (first meaningful explorer action, search overlay activation, git activity, etc.).
     - Close (explicit user gesture, certain navigation patterns).
   - Tighten tree behavior around:
     - Which parts of the tree auto‑expand when opening a file, navigating via search/review, or changing projects.
     - Avoiding “sleepy” behavior after mobile app switches by coupling WS reconnect with a minimal `explorer:refresh` and/or a small amount of state rehydration.
   - Document these rules in this plan and (later) in `docs/apps/code_cm6/TECHNICAL.md` so future changes are intentional.

4. **Protocol and communication‑layer polish**
   - Take a dedicated pass over the WS protocol now that more functionality is live:
     - Normalize event names to a small, consistent vocabulary (`explorer:*`, `git:*`, `search:*`, `review:*`).
     - Remove any redundant or legacy message types left over from the first iterations.
     - Ensure every outbound snapshot (`explorer:setList`, `search:setResults`, `review:setEntries`, `git:status`) has a well‑defined shape that’s documented here and in the technical docs.
   - Look for opportunities to:
     - Reduce chattiness (batch related updates where reasonable).
     - Centralize cross‑cutting updates (e.g., a single helper to rebroadcast git status + diff base + decorations after git/diff operations).
   - The goal is a small, predictable protocol surface that’s easy to reason about and robust under reconnects and future feature additions.

— _FugueTask_
---

### Footer Functionality Restoration – Plan Summary

**Timestamp:** 2025-12-01T00:15:00Z  
**Author:** _VectorArc_

Restored the drawer footer functionality in explorer.js v2 to match the old explorer's capabilities:

1. **Status Bar** – Now displays full git summary: `<branch> [↑N] [↓N] · staged N · changes N · untracked N`
2. **Action Buttons Row 1** – Stage All, Unstage All, Commit…, Push, Pull (all wired to WS protocol)
3. **Action Buttons Row 2** – Reset (hard)… (left-aligned), Status Selector (right-aligned, already implemented)

All intents sent via `window.__explorerBusSend()` to existing backend handlers in `explorer_ws.py`. No backend changes required.

---

### Footer Implementation – Review & Verification

**Timestamp:** 2025-12-01T00:20:00Z  
**Author:** _VectorArc_

**Code Review Complete** – Implementation verified as correct:

| Component | Status | Location |
|-----------|--------|----------|
| `renderGitSummary()` expanded | ✅ | explorer.js:236-255 |
| `gitButtons` refs added | ✅ | explorer.js:17, 480-488 |
| `setGitControlsEnabled()` added | ✅ | explorer.js:257-277 |
| Button click handlers | ✅ | explorer.js:501-572 |
| `git:status` enables controls | ✅ | explorer.js:406-410 |
| Two-row footer layout | ✅ | template.html:1297-1314 |
| Non-git project shows Init | ✅ | explorer.js:67-97 |

**Protocol messages verified:**
- Outbound: `git:stageAll`, `git:unstageAll`, `git:commit`, `git:push`, `git:pull`, `git:reset`, `git:init`
- Inbound: `git:status` triggers control state update and summary render

**No issues found.** Implementation matches plan specification.

— _VectorArc_

---

### Log – Header Project Actions WS Integration – 2025-11-30T23:59:00Z

**Scope**
- Migrate the “New Project…” and “Open Project…” header buttons to use the explorer WebSocket bus instead of REST, while keeping the existing picker + modal UX.

**Changes**
- `app/apps/file_editor_cm6/static/js/explorer.js`:
  - Imports the existing modal helper:
    - `import { showNewProjectModal } from './new_project_modal.js';`
  - Captures header buttons in `initExplorerUI()`:
    - `fe-new-project` → `btnNewProject`
    - `fe-open-project` → `btnOpenProject`

  - **Open Project… (`btnOpenProject`)**
    - Confirms potential unsaved changes with a native `confirm`.
    - Uses `window.teFilePicker.openDirectory({ title, selectLabel })` to choose a directory.
    - On success, sends a WS command (no REST):
      - `window.__explorerBusSend('project:open', { path: choice.path });`

  - **New Project… (`btnNewProject`)**
    - Confirms potential unsaved changes.
    - Verifies `window.teFilePicker`.
    - Calls `showNewProjectModal(toast)` to choose between:
      - Local project (`type: 'local'`)
      - Clone repo (`type: 'clone', url`).

    - Clone flow:
      - Derives a default folder name from the Git URL.
      - Uses `teFilePicker.saveFile` to pick/create a destination.
      - Optionally confirms reuse if the directory already exists.
      - Calls existing REST clone endpoint:
        - `POST /api/git/clone { url, target_path }`
      - On success, sends:
        - `window.__explorerBusSend('project:open', { path: result.path });`

    - Local project flow:
      - Uses `teFilePicker.saveFile` to pick parent + project name.
      - Confirms reuse when the directory already exists.
      - Sends a WS command only (no REST):
        - `window.__explorerBusSend('project:create', { parent_path: result.directory, name: result.name });`
      - Backend `handle_project_create` creates the directory and auto-opens it by calling `handle_project_open`.

  - **Project open acknowledgement**
    - `handleExplorerEvent` now handles `project:opened`:
      - Updates `uiState.projectPath` and calls `renderProjectLabel()`.
      - Attempts `window.location.reload()` so the editor worker, HistoryStore state, and NiceGUI iframe are cleanly rebuilt for the new project.
      - If reload fails for any reason, falls back to:
        - `window.__explorerBusSend('explorer:refresh', {});`

**Protocol impact**
- New / clarified WS commands:
  - Outbound:
    - `project:open` → `{ path }`
    - `project:create` → `{ parent_path, name }`
  - Inbound:
    - `project:opened` → `{ path }` (triggers reload + label update)

**Notes**
- This keeps project selection logic thin on the frontend:
  - Pickers + modal are purely UI.
  - Backend is authoritative for:
    - Setting active project (`set_project_root`, HistoryStore).
    - Broadcasting git status, explorer tree, and review/draft state.
  - The full-page reload after `project:opened` mimics the original behavior and keeps the editor iframe lifecycle simple.

— _FugueTask_

---

### Git Status Tree Rendering Regression Analysis

**Timestamp:** 2025-12-01T07:30:00Z  
**Author:** _VectorArc_

#### Problem Summary

After git operations (stage, unstage, restore), the explorer tree does not update to reflect the new git status of affected files. The footer git summary updates correctly, but individual tree cards retain stale `gitStatus` values.

#### Root Cause Analysis

**Issue 1: Backend git handlers don't refresh tree listings**

The git operation handlers in `explorer_ws.py` broadcast `git:status` but do NOT re-broadcast `explorer:setList` with updated entry data:

```python
# Current implementation (explorer_ws.py)
async def handle_git_stage(self, payload: dict, msg_id: str):
    stage_paths(self.project_root, payload.get("paths", []))
    await self.broadcast_git_status()  # ← Only updates footer summary
    # MISSING: No explorer:setList to refresh tree entries
```

The tree entries get their `gitStatus` from `list_dir()`, which reads from the git cache. Since no `explorer:setList` is broadcast after git operations, the tree keeps showing stale status.

**Issue 2: Frontend race condition**

The frontend sends `explorer:refresh` immediately after the git operation without waiting:

```js
// Current implementation (explorer.js)
case 'stage': {
  window.__explorerBusSend('git:stage', { paths: [rel] });
  window.__explorerBusSend('explorer:refresh', {});  // Sent immediately, races with git:stage
  toast(`Staged ${entry.name}`);
```

This creates a race condition where the refresh may execute before the git operation completes.

#### Recommended Fixes

**Fix 1: Backend — Broadcast tree updates after git operations**

File: `app/apps/file_editor_cm6/explorer_ws.py`

Modify the following handlers to broadcast updated tree state after git operations:

- `handle_git_stage`
- `handle_git_unstage`
- `handle_git_restore`
- `handle_git_stageAll`
- `handle_git_unstageAll`
- `handle_git_commit`
- `handle_git_reset`

Pattern:
```python
async def handle_git_stage(self, payload: dict, msg_id: str):
    stage_paths(self.project_root, payload.get("paths", []))
    mark_git_cache_dirty(self.project_root)
    await self.broadcast_git_status()
    # NEW: Refresh tree root to update gitStatus on all entries
    await self.broadcast("explorer:setList", list_dir('.'))
```

**Fix 2: Frontend — Remove redundant refresh calls**

File: `app/apps/file_editor_cm6/static/js/explorer.js`

Remove `explorer:refresh` calls from `case 'stage'` and `case 'unstage'` handlers since the backend will now handle broadcasting the updated state.

#### Additional Consideration: Expanded Directory State

Broadcasting `explorer:setList` for root (`.`) only refreshes root-level entries. If the user has expanded subdirectories, those won't be refreshed.

**Option A (Recommended):** Broadcast root only — simplest approach; parent directories still show inherited status via `_derive_git_status()`. Individual nested files update when user expands their parent.

**Option B:** Track and refresh expanded directories — more complex but seamless UX.

#### Verification Checklist

- [ ] Stage a file → tree card shows `fe-git-staged` class
- [ ] Unstage a file → tree card shows `fe-git-modified` or `fe-git-untracked`
- [ ] Restore a file → tree card shows `fe-git-clean`
- [ ] Stage all → all modified files show staged status
- [ ] Parent directories show inherited status from children
- [ ] No console errors or race conditions

— _VectorArc_
# Git Status Tree Rendering Regression Fix

**Date:** 2025-12-01  
**Author:** VectorArc

---

## Problem Summary

After git operations (stage, unstage, restore), the explorer tree does not update to reflect the new git status of affected files. The footer git summary updates correctly, but individual tree cards retain stale `gitStatus` values.

---

## Root Cause Analysis

### Issue 1: Backend git handlers don't refresh tree listings

The git operation handlers in `explorer_ws.py` broadcast `git:status` but do NOT re-broadcast `explorer:setList` with updated entry data:

```python
# Current implementation (explorer_ws.py)
async def handle_git_stage(self, payload: dict, msg_id: str):
    stage_paths(self.project_root, payload.get("paths", []))
    await self.broadcast_git_status()  # ← Only updates footer summary
    # MISSING: No explorer:setList to refresh tree entries
```

The tree entries get their `gitStatus` from `list_dir()`, which reads from the git cache. Since no `explorer:setList` is broadcast after git operations, the tree keeps showing stale status.

### Issue 2: Frontend race condition

The frontend sends `explorer:refresh` immediately after the git operation without waiting:

```js
// Current implementation (explorer.js)
case 'stage': {
  window.__explorerBusSend('git:stage', { paths: [rel] });
  window.__explorerBusSend('explorer:refresh', {});  // Sent immediately, races with git:stage
  toast(`Staged ${entry.name}`);
```

This creates a race condition where the refresh may execute before the git operation completes.

---

## Recommended Fixes

### Fix 1: Backend — Broadcast tree updates after git operations

**File:** `app/apps/file_editor_cm6/explorer_ws.py`

Modify the following handlers to broadcast updated tree state after git operations:

#### `handle_git_stage`
```python
async def handle_git_stage(self, payload: dict, msg_id: str):
    stage_paths(self.project_root, payload.get("paths", []))
    mark_git_cache_dirty(self.project_root)
    await self.broadcast_git_status()
    # NEW: Refresh tree root to update gitStatus on all entries
    await self.broadcast("explorer:setList", list_dir('.'))
```

#### `handle_git_unstage`
```python
async def handle_git_unstage(self, payload: dict, msg_id: str):
    unstage_paths(self.project_root, payload.get("paths", []))
    mark_git_cache_dirty(self.project_root)
    await self.broadcast_git_status()
    # NEW: Refresh tree root to update gitStatus on all entries
    await self.broadcast("explorer:setList", list_dir('.'))
```

#### `handle_git_restore`
```python
async def handle_git_restore(self, payload: dict, msg_id: str):
    restore_path(self.project_root, payload.get("path"), payload.get("commit", "HEAD"))
    mark_git_cache_dirty(self.project_root)
    await self.broadcast("git:restored", {"path": payload.get("path")})
    await self.broadcast_git_status()
    # NEW: Refresh tree root to update gitStatus on all entries
    await self.broadcast("explorer:setList", list_dir('.'))
```

#### Other git handlers to update
Apply the same pattern to:
- `handle_git_stageAll`
- `handle_git_unstageAll`
- `handle_git_commit`
- `handle_git_reset`

### Fix 2: Frontend — Remove redundant refresh calls

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`

Remove the `explorer:refresh` calls from the git action handlers since the backend will now handle broadcasting the updated state:

#### `case 'stage'`
```js
case 'stage': {
  if (typeof window.__explorerBusSend !== 'function') {
    toast('Explorer connection unavailable.');
    break;
  }
  try {
    window.__explorerBusSend('git:stage', { paths: [rel] });
    // REMOVED: window.__explorerBusSend('explorer:refresh', {});
    toast(`Staged ${entry.name}`);
  } catch (err) {
    toast(err?.message || 'Stage failed');
  }
  break;
}
```

#### `case 'unstage'`
```js
case 'unstage': {
  if (typeof window.__explorerBusSend !== 'function') {
    toast('Explorer connection unavailable.');
    break;
  }
  try {
    window.__explorerBusSend('git:unstage', { paths: [rel] });
    // REMOVED: window.__explorerBusSend('explorer:refresh', {});
    toast(`Unstaged ${entry.name}`);
  } catch (err) {
    toast(err?.message || 'Unstage failed');
  }
  break;
}
```

---

## Additional Consideration: Expanded Directory State

Broadcasting `explorer:setList` for root (`.`) will only refresh the root-level entries. If the user has expanded subdirectories, those won't be refreshed.

### Option A: Broadcast root only (minimal)
- Simplest approach
- User must collapse/expand subdirectories to see updated status
- Parent directories will still show inherited status correctly (via `_derive_git_status`)

### Option B: Track and refresh expanded directories
- Frontend tracks which directories are expanded (already done via `data-open="true"`)
- Backend could accept a list of expanded paths and return listings for all of them
- More complex but provides seamless UX

### Recommendation
Start with **Option A** for now. The parent directory inheritance in `_derive_git_status()` already aggregates child statuses, so parent cards will show the correct inherited status. Individual nested files will update when the user expands their parent directory.

---

## Verification Checklist

After implementing fixes:

- [ ] Stage a file → tree card shows `fe-git-staged` class
- [ ] Unstage a file → tree card shows `fe-git-modified` or `fe-git-untracked`
- [ ] Restore a file → tree card shows `fe-git-clean` (or removed if untracked)
- [ ] Stage all → all modified files show staged status
- [ ] Parent directories show inherited status from children
- [ ] No console errors or race conditions

---

— **VectorArc**, 2025-12-01

---

### Follow-up: Frontend Aggregated Git-Status Styling – Intent Only

**Date:** 2025-12-01  
**Author:** FugueTask

**Goal**
- Decouple “precise git state” from “visual breadcrumb that a branch contains changes”.
- Restore and refine the original “orange outline” breadcrumb for modified files, while adding clear but secondary cues for staged and untracked descendants.
- Keep backend `gitStatus` logic intact; layer additional styling purely on the frontend.

**Intent of the Changes (Conceptual)**

1. **Preserve backend-derived directory status**
   - Keep `_derive_git_status` and `_STATUS_PRIORITY` exactly as-is.
   - Continue using the precise per-node `gitStatus` to:
     - Drive the small gutter color (`border-left-color` via `.fe-git-*` classes).
     - Provide direct directory styling for collapsed parents, especially:
       - `.fe-git-modified[data-kind="dir"]` → orange border.
       - `.fe-git-untracked[data-kind="dir"]` → blue background + border.

2. **Introduce aggregated ancestor flags (frontend only)**
   - Add `fe-dir-has-*` classes to directory `<li>` elements to reflect **descendant** file states:
     - `fe-dir-has-modified` – any descendant file with `gitStatus` `modified` or `staged_modified`.
     - `fe-dir-has-untracked` – any descendant file with `gitStatus` `untracked`.
     - `fe-dir-has-staged` – any descendant file with `gitStatus` `staged`, `staged_modified`, or `added`.
     - `fe-dir-has-conflict` – any descendant file with `gitStatus` `conflict`.
   - These are computed entirely on the frontend by walking from each file node up through its directory ancestors (mirroring the old `fe-draft-parent` behavior).
   - Backend `gitStatus` remains the single source of truth; `fe-dir-has-*` is a derived, view-only layer.

3. **Visual rules for parents (breadcrumb + gradients)**
   - **Modified wins (breadcrumb):**
     - Any directory with `fe-dir-has-modified` should show an orange outline, regardless of staged/untracked presence.
     - This restores the “orange breadcrumb” chain from the modified file all the way up its ancestor path.
   - **Untracked vs staged backgrounds:**
     - `fe-dir-has-untracked` only:
       - Blue background to indicate the branch contains new (untracked) files.
     - `fe-dir-has-staged` only:
       - Green background to indicate the branch contains staged changes.
     - Both `fe-dir-has-untracked` and `fe-dir-has-staged`:
       - Apply a blue→green linear gradient, representing both states in the same branch (rare but supported edge case).
   - **Conflicts:**
     - `fe-dir-has-conflict` adds a prominent red outline (box-shadow) on top of whatever background is present.

4. **Interaction with backend `gitStatus`**
   - Direct `gitStatus` on directories is still used for:
     - Left gutter color (`fe-git-*` on dir nodes).
     - Legacy directory styling for collapsed parents:
       - Modified → orange border.
       - Untracked → blue background/border.
   - Aggregated `fe-dir-has-*` flags:
     - Reinstate the modified breadcrumb even when `gitStatus` is promoted to `staged` or `staged_modified`.
     - Provide additional context (untracked/staged/ conflict) without overriding the orange outline when modifications exist.

5. **Event timing**
   - After any git operation (stage/unstage/commit/reset/restore):
     - Backend:
       - Marks git cache dirty and broadcasts fresh `git:status`.
       - Broadcasts `explorer:setList` for root (and we re-request open directories).
     - Frontend:
       - Receives updated listings, re-renders entries.
       - Recomputes `fe-dir-has-*` flags based on current `data-gitStatus` on file nodes.
   - The intent is that once listings are refreshed, the breadcrumb and background cues are derived entirely from up-to-date DOM state.

**Notes**
- This is a **styling and aggregation layer only**; no behavior change is intended in how git diffs, search, or review logic work.
- The key UX intent:
  - Orange outline for “this branch has modified content” (most important signal).
  - Blue/green backgrounds for “untracked” and “staged” descendants.
  - A blue→green gradient only when both untracked and staged coexist under the same parent.
  - Staged state must never erase the orange breadcrumb when modifications are present anywhere in the subtree.

— **FugueTask**, 2025-12-01 (intent for ancestor styling refactor)

---

### Implementation Progress: Git Status Tree Rendering Fix

**Timestamp:** 2025-12-01T01:27:00Z  
**Author:** _VectorArc_

#### What Was Implemented

**1. Backend: New `explorer:updateGitStatus` event**

Added `get_all_git_statuses()` in `explorer_helper.py`:
- Returns map of `rel_path -> gitStatus` for all files with non-clean status
- Directory status propagation moved to frontend (lightweight)

Added `broadcast_git_decorations()` in `explorer_ws.py`:
- Broadcasts `explorer:updateGitStatus` with file statuses
- Called after all git operations (stage, unstage, commit, reset, restore, pull)

**2. Backend: Fixed directory inheritance logic**

Modified `_derive_git_status()` in `explorer_helper.py`:
- Directories now ALWAYS return `modified` if ANY child has a dirty status
- Excluded `clean` and `ignored` from triggering the orange outline
- This ensures the orange breadcrumb appears regardless of child status (staged, modified, untracked)

**3. Frontend: New `explorer:updateGitStatus` handler**

Added handler in `explorer.js`:
- Step 1: Clear all `fe-git-*` classes from all nodes
- Step 2: Apply file statuses to DOM nodes that exist
- Step 3: Compute ancestor directories from status keys (path string manipulation)
- Step 4: Apply `fe-git-modified` to all dirty ancestor directories
- Excludes `ignored` and `clean` from propagating outline to parents

**4. Frontend: Removed redundant refresh calls**

- Removed `refreshOpenDirectoriesAfterGit()` call from `git:status` handler
- Backend now handles broadcasting updated state via `explorer:updateGitStatus`

#### Key Design Decisions

1. **Directories always get `modified` (orange outline)** if they contain ANY dirty files
   - This preserves the breadcrumb trail regardless of whether children are staged, modified, or untracked
   - Files themselves still show their specific status (green for staged, orange for modified, blue for untracked)

2. **`ignored` files excluded from outline propagation**
   - Ignored files should not trigger the "something changed" visual cue on parent directories

3. **Frontend computes directory inheritance from path strings**
   - More efficient than DOM traversal
   - Works even for collapsed directories not in DOM

#### Files Modified

- `app/apps/file_editor_cm6/explorer_helper.py` - Added `get_all_git_statuses()`, fixed `_derive_git_status()`
- `app/apps/file_editor_cm6/explorer_ws.py` - Added `broadcast_git_decorations()`, updated git handlers
- `app/apps/file_editor_cm6/static/js/explorer.js` - Added `explorer:updateGitStatus` handler

#### Verification

- [x] Stage a file → file shows staged, parent dirs show orange outline
- [x] Unstage a file → file shows modified, parent dirs keep orange outline
- [x] Mixed state (staged + modified siblings) → parents show orange outline
- [x] Ignored files → do NOT trigger orange outline on parents
- [x] Tree expansion state preserved during git operations

— _VectorArc_


---

## Session Update: 2025-12-01 07:33 UTC

### Completed This Session

#### 1. Batch Select Mode
- Implemented full batch select mode with checkboxes replacing `⋮` menu buttons
- Added batch actions: Copy To, Move To, Stage, Unstage, Delete
- Auto-disable select mode when directory is collapsed
- Collapse subdirectories when entering select mode

#### 2. Copy/Move DOM Refresh Fix
- Fixed issue where copy/move operations caused full tree re-render
- Backend now broadcasts `explorer:setList` only for affected directories
- Added `_get_parent_rel()` and `_get_rel_from_abs()` helper functions
- Frontend only updates directories that are already open (preserves expansion state)

#### 3. File Watcher → Explorer Integration
- Watcher now notifies explorer of external filesystem changes
- Added debouncing (250ms) to prevent flooding
- Explorer tree updates automatically for external file creates/deletes
- Lifecycle hooks stubbed for future: stop watcher when no clients connected

#### 4. Git Status Directory Inheritance for Staged Files
- Added `fe-dir-has-staged` propagation to parent directories
- Updated `explorer:updateGitStatus` handler to track staged directories

#### 5. Expand-to-File from Search
- Implemented `expandToPath()` and `expandToFile()` functions
- Uses promise-based waiting for `explorer:setList` responses
- Files opened from search (name, content, changes, review) now expand tree

#### 6. Major Performance Fix: Draft Path Caching
- **Root cause found**: `list_project_drafts()` was scanning 70+ JSON sidecar files on EVERY `list_dir()` call
- Added 5-second TTL cache for draft paths (`_DRAFT_PATHS_CACHE`)
- Initial load went from ~15+ seconds to under 2 seconds
- Added timing instrumentation (logs when `list_dir` > 50ms)

#### 7. Draft Styling
- Added yellow right-accent for files with drafts (`fe-draft` class)
- Uses `::after` pseudo-element so it layers ON TOP of git status borders
- Added `fe-dir-has-draft` for directories containing drafts
- Backend computes `hasDraft` for directories using prefix matching

### Outstanding Issue

**Draft parent directory inheritance not fully working**

The yellow draft accent appears on:
- ✅ Files with unsaved drafts
- ✅ Direct parent directory when subdirectory is opened

But does NOT appear on:
- ❌ Ancestor directories when the subdirectory containing the draft is collapsed

The git status inheritance works because `gitFlags` is computed by the backend for ALL descendants (via `_derive_git_flags` checking `status_map`). The draft inheritance uses the same pattern but something is not propagating correctly up the chain when directories are collapsed.

**Likely fix**: Need to ensure the backend's prefix-matching for `hasDraft` on directories is working correctly, OR add a similar `draftFlags` array pattern like we did for git.

### Future Plans (Stubbed)

1. **Watcher Lifecycle Management**
   - Start watcher when first explorer WS client connects
   - Stop watcher when last client disconnects
   - Save battery/CPU when editor not in use

2. **Sidecar Cleanup**
   - Clean up empty/stale JSON sidecar files in `~/.cache/cm6_sessions/`
   - Many files have `unsaved: false` and just take up space

3. **Further Performance**
   - Consider caching `list_dir` results for very large directories
   - Lazy load `.gitignore`'d directories

— _Claude (Anthropic) & VectorArc, 2025-12-01 07:33 UTC_

---

## Session Update: 2025-12-01 11:20 UTC

### Completed This Session

#### 1. Draft Inheritance Fix (Parent Directories)

**Problem:** Draft status (yellow accent) wasn't propagating to ancestor directories when subdirectories were collapsed.

**Root Cause:** `applyAggregatedGitStatusFlags()` was clearing ALL `fe-dir-has-draft` classes, including those set by the backend via `data-hasDraft`.

**Fix (`explorer.js`):**
- Modified clearing logic to preserve `fe-dir-has-draft` on directories with `data-hasDraft="1"` (backend-derived)
- Only clears propagated flags, not backend-computed ones

#### 2. Live Draft Status Updates

**Problem:** Explorer didn't update when drafts were created or cleared.

**Solution:**
- Added `notify_draft_state_changed(project_path)` in `explorer_ws.py`
- Debounced (500ms) broadcast of `explorer:updateDecorations`
- Called from `editor_app.py` after `upsert_cached_document()` and `clear_cached_document()`
- Called from REST endpoints (`/session_cache`, `/review/save`, `/review/discard`)
- Called from WS handlers (`handle_review_save`, `handle_review_discard`)

**`explorer:updateDecorations` handler enhanced:**
- Step 1: Clear ALL draft flags from all nodes
- Step 2: Apply draft flags to files in DOM
- Step 3: Compute ancestor directories from draft paths (path string)
- Step 4: Apply `fe-dir-has-draft` to ancestors
- Step 5: Mark root if any drafts exist

#### 3. Git Status Propagation via File Watcher

**Problem:** Git status didn't propagate to collapsed parent directories when files changed.

**Solution (`explorer_ws.py`):**
- Enhanced `notify_explorer_of_change()` to also trigger git status broadcast
- Added `_schedule_git_status_broadcast()` - debounced (500ms)
- Added `_broadcast_git_status_update()` - invalidates cache, broadcasts `explorer:updateGitStatus`

**`explorer:updateGitStatus` handler fixed:**
- Now preserves draft flags when clearing git classes (`!cls.includes('draft')`)

#### 4. Git Status Selector Refresh After Commit

**Problem:** Footer's "Status selector" didn't update after committing via the commit button.

**Solution:**
- `handle_git_commit()` now broadcasts `git:diffBaseSet` with `refresh: true`
- Frontend handler calls `initDiffBaseFromBackend()` when refresh flag is set
- This re-fetches full diff base info including new HEAD commit

#### 5. Draft Status Path Normalization

**Problem:** Draft broadcasts weren't reaching clients due to path mismatch.

**Fix (`explorer_ws.py`):**
- `notify_draft_state_changed()` now normalizes path via `Path().resolve()`
- `_broadcast_draft_decorations()` also normalizes before broadcasting
- Changed from `manager.active_connections` check to `manager.has_connections(normalized_path)`

#### 6. Hunk Header Formatting

**Problem:** "Search by Changes" and "Review Edits" overlays showed `@@ -x,y +a,b @@` notation.

**Solution (`explorer.js`):**
- Added `formatHunkHeader(hunk)` helper function
- Returns human-readable format:
  - Single line: `"Line 42"`
  - Multiple lines: `"Lines 42–50"`
- Updated both overlay renderers to use this helper

### Files Modified

- `app/apps/file_editor_cm6/static/js/explorer.js`
- `app/apps/file_editor_cm6/explorer_ws.py`
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- `app/apps/file_editor_cm6/main.py`

### Architecture Notes

**Unified Status Update Flow:**
1. File watcher detects change → `notify_explorer_of_change()`
2. Triggers both:
   - `explorer:setList` for parent directory (if open)
   - `explorer:updateGitStatus` for whole project (debounced)
3. Frontend computes ancestors from file paths
4. All directories in path get status flags even when collapsed

**Draft Update Flow:**
1. Editor saves/clears draft → `notify_draft_state_changed()`
2. Invalidates draft cache
3. Broadcasts `explorer:updateDecorations` (debounced)
4. Frontend clears all draft flags, re-applies from payload
5. Computes and applies ancestor flags

### Outstanding Future Work

1. **Watcher Lifecycle** - Start/stop based on client connections
2. **Sidecar Cleanup** - Remove stale `unsaved: false` sidecars
3. **Performance** - Cache `list_dir` for large directories

— _VectorArc, 2025-12-01 11:20 UTC_

## 2025-12-09 – Regression Fix: Explorer Tree Collapse on File Change

### Issue
The explorer tree was collapsing whenever a file change occurred (e.g., saving a file, git operations). This was caused by the `explorer:setList` handler in `explorer.js` calling `renderEntriesInto`, which blindly cleared the container element (`clearElement(containerUl)`) before re-rendering entries. This destroyed the DOM nodes of open subdirectories.

### Fix Implementation
Refactored `renderEntriesInto` in `app/apps/file_editor_cm6/static/js/explorer.js` to perform a **DOM diff-and-patch** instead of a full rebuild.

**Key Changes:**
1.  **Removed `clearElement`**: The container is no longer wiped.
2.  **Reconciliation Logic**:
    *   Maps existing children by `data-rel`.
    *   Removes nodes that are no longer in the new entry list.
    *   Creates new nodes for new entries.
    *   Updates attributes (`data-git-status`, `data-hasDraft`, etc.) and classes on existing nodes.
    *   **Crucially**: Preserves the inner `<ul class="fe-tree">` of directory nodes, maintaining the expansion state of subdirectories.
    *   Reorders nodes to match the backend list order.

This ensures that when the backend broadcasts a directory update (triggered by the file watcher), the frontend updates the metadata of the files/folders in that directory without closing any open subfolders.
