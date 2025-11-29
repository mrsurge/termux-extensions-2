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

