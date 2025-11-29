# Explorer WebSocket Layer – Gaps & Required Changes

## 1. High-Level Assessment

The current `explorer_ws.py` + `explorer/search.py` + `explorer/review.py` stack is a good first step toward a unified WebSocket control surface, but it is still mostly **RPC-style** plumbing around existing helpers rather than a true **UI state bus**.

It exposes many operations via message types and handlers, but:

- The **frontend still owns most explorer state** (tree, decorations, overlays) using `fetch` + direct DOM updates.
- The WebSocket interface behaves like a **remote procedure call layer** (`handle_explorer_createFile`, `handle_git_status`, `handle_review_save`, etc.), returning one-off responses instead of pushing authoritative UI snapshots.
- Message naming and semantics are **mixed** (commands vs events) and don’t yet match the planned, small vocabulary of UI messages.

To achieve the “quick, modular, not hacky” explorer that’s driven by backend state via a robust WS bus, the current design needs to shift from RPC-style to **state + intent**:

- Backend: authoritative state + event publisher.
- Frontend: thin store + view that renders whatever the backend says.

---

## 2. Specific Issues in `explorer_ws.py`

### 2.1 RPC-style message semantics

**Current behavior**

- Every handler is shaped like a request/response:
  - Inbound: `{ "type": "explorer_createFile", "payload": {...}, "id": "123" }`
  - Outbound: `{ "type": "explorer:created", "payload": {...}, "id": "123" }`
- The UI still needs to interpret individual replies and update its own state.

**Why this is a problem**

- This pattern doesn’t naturally support **push-based updates** (e.g., watcher events, drafts changing from another source, git status changes after review save).
- It keeps a lot of state management and reconciliation in the browser, which is what we’re trying to reduce.

**Needed change**

- Recast the WS layer as a **UI event bus**, where the primary outbound messages are:
  - `explorer:setTree`, `explorer:updateDecorations`, `explorer:setSearchResults`, `review:setEntries`, etc.
- Command responses should generally:
  - Update server-side state, and
  - Trigger **state broadcasts** (e.g., refresh tree/decorations) rather than one-off response messages that the UI has to interpret procedurally.

### 2.2 Inbound message naming inconsistency

**Current behavior**

- Handlers are keyed by transformed types:
  - `explorer_list` → `explorer:setList`
  - `git_status` → `git:status`
  - `search_run` → `search:results`
  - `review_list` → `review:list`
- Inbound/outbound naming conventions differ and are not aligned with the future plan (`explorer:open`, `explorer:toggleExpand`, etc.).

**Why this is a problem**

- Makes it harder to reason about the protocol and to evolve it.
- Frontend code will end up littered with special-case string comparisons instead of a small, consistent message vocabulary.

**Needed change**

- Normalize inbound message types to the `domain:verb` style used in the playbook:
  - `explorer:list`, `explorer:refresh`, `explorer:createFile`, `explorer:delete`, `explorer:open`.
  - `git:status`, `git:stage`, `git:unstage`, etc.
  - `search:run`, `review:list`, `review:save`, `review:discard`.
- Keep outbound message types in the same family:
  - e.g. `explorer:setTree`, `explorer:updateDecorations`, `search:setResults`, `review:setEntries`.

### 2.3 No authoritative explorer tree/decorations feed yet

**Current behavior**

- `handle_explorer_list` calls `list_dir(rel)` and responds with `explorer:setList`, but there is:
  - No global notion of "current tree snapshot".
  - No pairing with git/draft decorations.
- `handle_explorer_refresh` simply replies with `explorer:refreshed` and does not push a fresh tree/decorations snapshot.

**Why this is a problem**

- The planned architecture requires the backend to act as the **single source of truth** for explorer tree and decorations.
- The frontend should be able to render the explorer entirely from WS messages without reaching back to legacy REST endpoints.

**Needed change**

- Introduce an ExplorerState builder on the backend that can construct:
  - Tree nodes (rels, names, kinds, parent/child structure, expansion hints).
  - Decorations (git + drafts) for each rel.
- Have WS emit:
  - `explorer:setTree { nodes, root, selected }` upon:
    - Initial connection,
    - Project change,
    - Explicit `explorer:refresh`.
  - `explorer:updateDecorations { git, drafts }` upon:
    - Git status changes,
    - Review save/discard,
    - Draft updates from other sources.

### 2.4 No multi-client or event broadcast support yet

**Current behavior**

- `explorer_websocket(websocket)` accepts a single `WebSocket` and loops on that connection.
- There is no registry of clients per project, and no helpers to broadcast state changes to all interested clients.

**Why this is a problem**

- The moment more than one front-end attaches (desktop browser + GeckoView, or two tabs), they will not receive consistent updates.
- Features like review/discard/update of draft indicators rely on **everyone seeing the same events**.

**Needed change**

- Add a simple client registry:
  - Keyed by project path (or session id).
  - Store `ExplorerDispatcher` instances or their `send()` methods.
- Provide broadcast helpers:
  - `broadcast(type, payload, project_path=None)` → sends message to all clients for that project.
- Use broadcast for state-changing operations (git, review, project open) so all frontends stay in sync.

---

## 3. Search & Review Modules – Integration Gaps

### 3.1 Search results are not yet “state events”

**Current behavior**

- `handle_search_run` chooses a search function based on `mode` and replies with `search:results` once.

**Needed change**

- Treat search as a UI state update:
  - Use `search:setResults` or `explorer:setSearchResults` as the canonical outbound event.
  - Frontend should render overlays based on that state instead of mixing direct `fetch` calls.
- Keep search logic itself as-is; just emit standardized WS events that map directly into the new `uiState.explorer.search` structure.

### 3.2 Review operations don’t emit new UI snapshots

**Current behavior**

- `handle_review_list` → `review:list { reviews: [...] }`.
- `handle_review_save` → `review:saved { ... }`.
- `handle_review_discard` → `review:discarded { ... }`.

**Why this is a problem**

- After save/discard, the frontend must manually re-request review list and redecorate the explorer.
- The goal is for the backend to drive UI state changes automatically.

**Needed change**

- After `save_reviews` / `discard_reviews`:
  - Recompute the latest review list and emit `review:setEntries { entries: [...] }`.
  - Emit `explorer:updateDecorations { drafts: {...} }` so the tree’s draft accents update without extra fetches.

---

## 4. Protocol Alignment with the Playbook

To align `explorer_ws.py` with the desired playbook:

1. **Normalize message types** to `domain:verb` and define a small set of canonical messages.
2. **Promote state updates** (`explorer:setTree`, `explorer:updateDecorations`, `search:setResults`, `review:setEntries`) to primary outbound events, not incidental replies.
3. **Introduce backend-side Explorer state assembly**, so the explorer can be rendered entirely from WS-fed state.
4. **Add client registry and broadcast support**, so multi-client scenarios (desktop + GeckoView) stay in sync.
5. **Refactor frontend explorer code** to consume these events as its primary data source, replacing piecemeal `fetch` + DOM updates over time.

Once these changes are in place, the Explorer WS layer will stop being “just another RPC surface” and become the robust UI bus we want it to be.
