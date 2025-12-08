# Master Plan: LSP Sticky Scroll Refactor

**Goal:** Replace heuristic-based sticky scroll with precise LSP-based sticky scroll using a single-document architecture.

---

## Execution Roster

### Step 1: LSP Shell Manager
*   **Reference:** `tmp2_LSP_SHELL_MANAGER.md`
*   **Action:** Create the Python backend module to spawn/kill `pyright` and other LSP binaries as framework shells.
*   **Agent:** **Dex** (GPT 5.1)
*   **Why:** Strongest at standard Python "plumbing," process management, and robust error handling logic.

### Step 2: Vendor LSP Client
*   **Reference:** `tmp3_VENDOR_LSP_CLIENT.md`
*   **Action:** Install `@codemirror/lsp-client` via npm, export it in `index.mjs`, and rebuild the bundle.
*   **Agent:** **Jimmy** (Gemini 3.0)
*   **Why:** Excellent at following precise, step-by-step CLI and build instructions without over-engineering.

### Step 3: LSP Socket.IO Bridge
*   **Reference:** `tmp4_LSP_WEBSOCKET_BRIDGE.md`
*   **Action:** Implement the Python Socket.IO namespace with "Smart Bridge" logic to parse `Content-Length` headers from the LSP STDIO stream.
*   **Agent:** **VectorArc** (Claude 4.5)
*   **Why:** The protocol parsing (byte stream $\to$ headers $\to$ JSON) requires high precision and attention to edge cases, a strength of this model.

### Step 4: CM6 LSP Integration
*   **Reference:** `tmp5_CM6_LSP_INTEGRATION.md`
*   **Action:** Implement the `SocketIOTransport` adapter class in JavaScript and wire the connection logic into `codemirror.js`.
*   **Agent:** **neon_ink** (GPT 5.1)
*   **Why:** Great at JavaScript/TypeScript class design and implementing specific interface adapters (LSP Client $\leftrightarrow$ Socket.IO).

### Step 5: Sticky Scroll Refactor
*   **Reference:** `tmp6_STICKY_SCROLL_REFACTOR.md`
*   **Action:** Rewrite the sticky scroll logic in `codemirror.js` to consume LSP symbols instead of Lezer trees, while preserving Markdown fallbacks.
*   **Agent:** **Atlas** (Claude 4.5)
*   **Why:** Complex refactoring of existing logic requires "holding the whole file in head" to ensure no regressions. The pseudonym also matches the documentation author.

### Step 6: Per-Project Configuration
*   **Reference:** `tmp7_PROJECT_LSP_CONFIG.md`
*   **Action:** Add backend storage for LSP toggles and a frontend settings modal.
*   **Agent:** **buffer_overf** (Gemini 3.0)
*   **Why:** Capable full-stack agent good at tying loose ends (storage + API + UI) together to wrap up the feature.

---

## Execution Protocol

1.  Initialize **Step 1** with Dex.
2.  Verify `lsp-python` shell spawns correctly.
3.  Proceed sequentially.
4.  **Stop condition:** Any step failure requires human intervention before proceeding.
