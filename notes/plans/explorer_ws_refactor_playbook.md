# Explorer WebSocket Refactor – Playbook

## Goal
Turn the explorer into a fast, modular, WS‑driven view that reflects backend state and emits high‑level intents, instead of being a DOM/`fetch` monolith.

---

### 1. Design the UI WebSocket Protocol

1.1 Define the UI channel

- Endpoint: `GET /api/app/file_editor_cm6/ws/ui`
- Transport: FastAPI/WebSocket (JSON messages only)
- Envelope:

```json
{
  "type": "string",
  "payload": { "any": "json" }
}
```

1.2 Define core outbound message types (backend → frontend)

- `explorer:setTree` – full tree snapshot
  - `payload`: `{ nodes: [...], root: "...", version: "...", selected?: "rel" }`
- `explorer:updateDecorations`
  - `payload`: `{ git: { [rel]: {...} }, drafts: { [rel]: {...} } }`
- `explorer:setSearchResults`
  - `payload`: `{ mode: "name"|"content"|"changes", results: [...] }`
- `review:setEntries`
  - `payload`: `{ entries: [...], timestamp: "..." }`
- Optional later:
  - `explorer:setState` (expanded nodes, selection)
  - `editor:state` (for toolbar, recents integration)

1.3 Define core inbound message types (frontend → backend)

- `explorer:open`
  - `payload`: `{ rel: "app/main.py" }`
- `explorer:toggleExpand`
  - `payload`: `{ rel: "docs/" }`
- `explorer:refresh`
  - `payload`: `{ reason: "git"|"drafts"|"manual" }`
- `search:run`
  - `payload`: `{ mode: "name"|"content"|"changes", query: "..." }`
- `review:save`
  - `payload`: `{ files: ["path1", "path2", ...] }`
- `review:discard`
  - `payload`: `{ files: ["path1", "path2", ...] }`

---

### 2. Implement Backend UI WS Endpoint & Dispatcher

2.1 WebSocket handler

- Path: `/api/app/file_editor_cm6/ws/ui`
- Responsibilities:
  - Authenticate / validate project context.
  - Register client in a small in‑process registry keyed by project.
  - Listen for incoming `type`/`payload` and pass to a dispatcher.
  - Provide a `send_ui_message(client, type, payload)` helper.

2.2 Dispatch inbound commands

- Map each inbound `type` to a backend function:
  - `explorer:open` → existing `openFile` logic (or equivalent) + `explorer:setTree` if needed.
  - `explorer:toggleExpand` → update expansion state (in history_store or in-memory UI state).
  - `search:run` → existing search endpoints; then send `explorer:setSearchResults`.
  - `review:save` / `review:discard` → existing review routes; then send updated `review:setEntries` and `explorer:updateDecorations`.

2.3 Hook backend events into the bus

- Whenever these change:
  - Git status / diff base,
  - Draft sidecars / review list,
  - Project switch / recents,
- Emit appropriate UI messages:
  - `explorer:updateDecorations`
  - `review:setEntries`
  - If necessary, an updated `explorer:setTree` snapshot.

---

### 3. Introduce a UI State Store on the Host (Front‑End)

3.1 Minimal UI state model

- In `main.js`:

```js
const uiState = {
  explorer: {
    tree: null,          // structured nodes
    decorations: { git: {}, drafts: {} },
    search: { mode: 'name', results: null },
  },
  review: {
    entries: [],
  },
};
```

3.2 UI bus client

- `uiBus.connect()` – opens `/ws/ui`, sets up `onmessage`, `onclose`, `onerror`.
- `uiBus.send({ type, payload })` – JSON stringify and send.
- `uiBus.handleMessage(msg)` – dispatches by `msg.type` to reducers:

```js
function handleUiMessage(msg) {
  switch (msg.type) {
    case 'explorer:setTree':          return reduceExplorerTree(msg.payload);
    case 'explorer:updateDecorations':return reduceExplorerDecorations(msg.payload);
    case 'explorer:setSearchResults': return reduceExplorerSearch(msg.payload);
    case 'review:setEntries':         return reduceReviewEntries(msg.payload);
  }
}
```

3.3 Reducers

- `reduceExplorerTree(payload)` → set `uiState.explorer.tree` then `renderExplorerFromState()`.
- `reduceExplorerDecorations(payload)` → update `uiState.explorer.decorations`, then apply via DOM helpers.
- `reduceExplorerSearch(payload)` → update `uiState.explorer.search` and re‑render overlay.
- `reduceReviewEntries(payload)` → update `uiState.review.entries` and re‑render Review overlay.

---

### 4. Form‑Based Dataset Discovery (Read & Write Map)

4.1 Dataset/DOM write inventory

- For `explorer.js` (current):
  - Enumerate all places that:
    - Set or read `dataset.*` on explorer DOM nodes.
    - Add/remove CSS classes that affect tree, decorations, selection.
  - Record each as:
    - “Operation”: e.g. `set draft flag`, `set git status`, `mark expanded`, `mark selected`.
    - “Location”: file:line.
    - “Inputs”: `rel`, status, draft flag, etc.

4.2 Normalization into helper operations

- From the inventory, identify a **small set of canonical operations**, e.g.:
  - `setNodeGitStatus(rel, status)`
  - `setNodeDraft(rel, hasDraft)`
  - `setNodeExpanded(rel, expanded)`
  - `setNodeSelected(rel, selected)`
- Later, all dataset/class changes must go through these helpers.

---

### 5. Form‑Based Intent / Command Discovery

5.1 User intent inventory

- For each user interaction in explorer/search/review:
  - Identify the **intent** (e.g., “open file”, “toggle expand”, “rename entry”, “run search by changes”, “save review selection”).
  - Record:
    - Intent name,
    - Front‑end entrypoint (click handler, keybinding, etc),
    - Backend endpoint or side effect currently used (`fetch` URL, body).

5.2 Map each intent to a WS command

- For each intent, define:
  - `type`: e.g. `explorer:open`, `explorer:toggleExpand`, `search:run`, `review:save`.
  - `payload` shape.
- If the behavior is currently fully front‑end only (no backend involvement):
  - Decide if it should stay local (pure UI concern), or
  - Design a backend protocol (e.g., to persist expanded dirs, recent search) and define a WS message for it.

---

### 6. DOM Helper Layer for Explorer (View Adapters)

6.1 DOM lookup helpers

- Introduce an `explorerDom` layer:

```js
const explorerDom = {
  getNode(rel) { ... },
  setGitStatus(rel, status) { ... },
  setDraft(rel, hasDraft) { ... },
  setExpanded(rel, expanded) { ... },
  setSelected(rel, selected) { ... },
};
```

6.2 Replace direct DOM writes

- As you touch code:
  - Replace direct class/dataset manipulations with calls to `explorerDom`.
  - New code only uses `explorerDom` for explorer tree manipulation.

---

### 7. Logical Map of Explorer Views & Modular Replacement Design

7.1 Identify explorer “sub‑apps”

- Tree view (left pane).
- Search overlay:
  - By Name.
  - By Content.
  - By Changes.
  - Review Edits (drafts).
- Git status summary bar.
- Recents dropdown.

7.2 Design a modular structure

- Define logical modules:
  - `explorerTreeView` – renders `uiState.explorer.tree` into the tree DOM.
  - `explorerSearchView` – renders overlay based on `uiState.explorer.search`.
  - `explorerDecorationsView` – applies git/draft decorations from `uiState.explorer.decorations`.
  - `reviewView` – renders `uiState.review.entries`.

- Each module:
  - Only reads from `uiState`.
  - Only writes via `explorerDom` and limited DOM APIs.
  - Sends intents via `uiBus.send(...)`.

---

### 8. Protocol Implementation to Replace Old Functionality

8.1 Backport existing behavior onto WS messages

- For each discovered intent (from step 5):
  - Move logic from “click → fetch → DOM” to:
    - “click → `uiBus.send({type, payload})`”.
    - Backend handles the command, updates server state, then emits UI updates via `explorer:setTree`, `explorer:updateDecorations`, etc.

8.2 Deprecate direct fetches in explorer UI

- Remove or phase out direct `fetch('/explorer/...')` calls from explorer UI.
- Keep HTTP endpoints as implementation detail for the backend; front‑end only talks via WS (for explorer concerns).

---

### 9. Adapter Layer for Existing Backend Components

9.1 Identify existing backend services

- `history_store` – projects, recents, diff base.
- `preferences_store` – UI/editor prefs.
- `diff_helper` / git helpers – collect diffs, statuses.
- `review` routes – draft sidecars and operations.

9.2 Create small WS adapters

- For each service, define a thin layer that:
  - Listens for relevant inbound WS commands.
  - Calls existing service functions.
  - Emits outbound UI messages using the same shapes defined in step 1.

Examples:

- `explorer:open` → derive absolute path → ensure state/file_activity → emit `editor:state` (optional) + any needed `explorer` messages.
- `explorer:refresh` → recompute tree + decorations from `history_store` and git → emit `explorer:setTree` + `explorer:updateDecorations`.
- `review:save` / `review:discard` → existing review logic → emit `review:setEntries` + `explorer:updateDecorations`.

---

### 10. Wire Explorer UI to the New Bus

10.1 Initialize bus on UI startup

- In `main()`:
  - After initial `/state` snapshot:
    - Connect `uiBus`.
    - Request initial explorer snapshot via WS (if needed).

10.2 Explorer intent handlers

- All user actions in explorer/search/review:
  - Call intent functions that only:
    - Update local UI state where purely visual, or
    - Send WS messages (`uiBus.send`).

10.3 Rendering loop

- Any time a reducer modifies `uiState.explorer` or `uiState.review`:
  - Call `renderExplorerFromState()` / `renderReviewFromState()`.

This playbook keeps the focus on:

- One robust WS bus (`/ws/ui`),
- A unified front‑end control surface (`uiBus` + `uiState`),
- A systematic inventory of existing behaviors (forms),
- And a clear path to replace old behavior with clean protocols and adapters.
