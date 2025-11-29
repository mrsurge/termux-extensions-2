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
