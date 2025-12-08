# Repair Order: LSP Transport & Connection

**Created:** 2025-12-08  
**Target:** neon_ink (GPT 5.1)  
**Status:** Urgent

---

## Situation Analysis

The **Sticky Scroll** logic (`applyStickyScroll`) is present and correctly wired to consume `this.lspSymbols`. However, the **LSP Client Integration** is incomplete. There is no mechanism to actually connect to the server and populate `lspSymbols`.

**Missing Components:**
1.  **Frontend:** `SocketIOTransport` class (codemirror.js).
2.  **Frontend:** `connectLSP()` / `disconnectLSP()` methods (codemirror.js).
3.  **Backend:** `LSP_LANGUAGE_MAP` and auto-connect logic (editor_app.py).

---

## Directives

### 1. Implement `SocketIOTransport` (codemirror.js)
Add this class at the top level (before `export default`):

```javascript
class SocketIOTransport {
  constructor(namespace, languageId, projectRoot) {
    this.socket = io(namespace, {
      path: "/ui/_nicegui_ws/socket.io",
      transports: ["websocket", "polling"]
    });
    this.onMessage = null; 

    this.socket.on('connect', () => {
      this.socket.emit('initialize', { 
        languageId: languageId, 
        projectRoot: projectRoot 
      });
    });

    this.socket.on('lsp:server_to_client', (data) => {
      if (this.onMessage) this.onMessage(data);
    });
  }

  send(data) {
    this.socket.emit('lsp:client_to_server', data);
  }

  close() {
    this.socket.disconnect();
  }
}
```

### 2. Implement Connection Methods (codemirror.js)
Add to the `methods` object:

```javascript
connectLSP(languageId, projectRoot) {
  // Guard: Check if LSPClient is available (from vendor bundle)
  const LSPClient = CM.LanguageServerClient;
  if (!LSPClient) {
    console.warn('[CM6] LSP client not available');
    return;
  }

  if (this.lspClient) this.disconnectLSP();

  const transport = new SocketIOTransport('/lsp', languageId, projectRoot);
  
  this.lspClient = new LSPClient({
    transport: transport,
    rootUri: 'file://' + projectRoot,
    workspaceFolders: [{ name: 'root', uri: 'file://' + projectRoot }],
    languageId: languageId
  });

  // Wire up symbols to our existing handler
  this.lspClient.on('documentSymbols', (symbols) => {
    this.handleDocumentSymbols(symbols);
  });

  // Create/Update Compartment
  if (!this.lspCompartment) this.lspCompartment = new CM.Compartment();
  
  this.editor.dispatch({
    effects: [
      this.lspCompartment.reconfigure([this.lspClient.extension])
    ]
  });
  
  console.log(`[LSP] Connected to ${languageId}`);
},

disconnectLSP() {
  if (this.lspClient) {
    this.lspClient.dispose();
    this.lspClient = null;
  }
  if (this.lspCompartment) {
    this.editor.dispatch({
      effects: this.lspCompartment.reconfigure([])
    });
  }
}
```

### 3. Backend Wiring (editor_app.py)
1.  Define `LSP_LANGUAGE_MAP` (extensions -> language IDs).
2.  Implement `_maybe_connect_lsp` to call `editor.connect_lsp()`.
3.  Call this in `editor_page` (initial load) and `set_content` (file switch).

---

**Execution:**
Apply these changes immediately to bridge the gap between the backend servers and the frontend sticky scroll.
