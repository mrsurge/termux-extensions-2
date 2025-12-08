# CM6 LSP Integration

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** Vendor LSP Client (tmp3), LSP Socket.IO Bridge (tmp4)  
**Blocks:** Sticky Scroll Refactor (tmp6)

---

## Purpose

Wire `@codemirror/lsp-client` into vendored CM6 using the Socket.IO bridge.

---

## Scope

- Implement `SocketIOTransport` adapter (LSP Client ↔ Socket.IO)
- Add LSP client extension to codemirror.js
- Vue methods for connect/disconnect
- Python wrappers for backend control
- Symbol subscription mechanism

---

## JavaScript Changes (codemirror.js)

### 1. The Socket.IO Transport Adapter

The `@codemirror/lsp-client` expects a transport with `send(json)` and `close()`. We adapt Socket.IO to this interface.

```javascript
class SocketIOTransport {
  constructor(namespace, languageId, projectRoot) {
    // 1. Connect to /lsp namespace
    this.socket = io(namespace, {
      path: "/ui/_nicegui_ws/socket.io",
      transports: ["websocket", "polling"]
    });

    this.languageId = languageId;
    this.projectRoot = projectRoot;
    
    // 2. Queue for incoming messages
    this.onMessage = null; 

    // 3. Setup listeners
    this.socket.on('connect', () => {
      // Send initialization handshake
      this.socket.emit('initialize', { 
        languageId: this.languageId, 
        projectRoot: this.projectRoot 
      });
    });

    this.socket.on('lsp:server_to_client', (data) => {
      if (this.onMessage) {
        this.onMessage(JSON.stringify(data)); // LSP client expects stringified JSON sometimes? Verify package docs.
        // If package expects object: this.onMessage(data);
      }
    });
  }

  send(data) {
    // data is usually a JSON object or string. 
    // We emit 'lsp:client_to_server'
    this.socket.emit('lsp:client_to_server', data);
  }

  close() {
    this.socket.disconnect();
  }
}
```

### 2. Integration in Component

```javascript
// At top
const LSPClient = typeof CM.LanguageServerClient === 'function' 
  ? CM.LanguageServerClient : null;

methods: {
  connectLSP(languageId, projectRoot) {
    if (!LSPClient) {
      console.warn('[CM6] LSP client not available in bundle');
      return;
    }
    
    if (this.lspClient) this.disconnectLSP();

    // Create Transport
    const transport = new SocketIOTransport('/lsp', languageId, projectRoot);

    // Create Client
    this.lspClient = new LSPClient({
      transport: transport,
      rootUri: 'file://' + projectRoot,
      workspaceFolders: [{ name: 'root', uri: 'file://' + projectRoot }],
      languageId: languageId
    });

    // Subscribe to symbols
    this.lspClient.on('documentSymbols', (symbols) => {
      this.handleDocumentSymbols(symbols);
    });
    
    // Install extension
    if (!this.lspCompartment) this.lspCompartment = new CM.Compartment();
    
    this.editor.dispatch({
      effects: [
        this.lspCompartment.reconfigure([this.lspClient.extension])
      ]
    });
  },

  disconnectLSP() {
    if (this.lspClient) {
      this.lspClient.dispose(); // Should close transport
      this.lspClient = null;
    }
    // Clear compartment
  }
}
```

---

## Python Changes (codemirror.py)

```python
def connect_lsp(self, language_id: str, project_root: str) -> None:
    """Connect editor to LSP server via Socket.IO.
    
    Args:
        language_id: Language identifier (python, typescript, etc.)
        project_root: Absolute path to project root
    """
    self.run_method('connectLSP', {'languageId': language_id, 'projectRoot': project_root})

def disconnect_lsp(self) -> None:
    """Disconnect from current LSP server."""
    self.run_method('disconnectLSP')
```

---

## Backend Integration (editor_app.py)

We need robust mapping from file extensions to LSP language identifiers.

```python
LSP_LANGUAGE_MAP = {
    '.py': 'python',
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.jsx': 'javascriptreact',
    '.ts': 'typescript',
    '.mts': 'typescript',
    '.tsx': 'typescriptreact',
    '.go': 'go',
    '.rs': 'rust',
}

# When opening a file, optionally connect LSP
async def _maybe_connect_lsp(editor, file_path: Path, project_root: Path):
    ext = file_path.suffix
    language_id = LSP_LANGUAGE_MAP.get(ext)
    
    if not language_id:
        return

    # Check if LSP enabled for this project/language
    if not should_use_lsp(project_root, language_id):
        return
    
    # Trigger client-side connection logic
    editor.connect_lsp(language_id, str(project_root))
```

---

## Files to Create/Modify

- **MODIFY:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- **MODIFY:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
- **MODIFY:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

---

## Testing

1. Open Python file → Verify `python` LSP connects.
2. Open `.js` file → Verify `javascript` LSP connects (uses `typescript-language-server`).
3. Open `.tsx` file → Verify `typescriptreact` connection.
4. Check console for symbol updates.
5. Disconnect and verify cleanup.

---

## Notes

- **Verification:** Check `@codemirror/lsp-client` source or docs to confirm if `transport.send` receives an object or string, and what `onMessage` expects.
- **Transport Interface:** The adapter must match the `Transport` interface expected by the specific version of the LSP package we vendor.

---

## References

- **Feature Adding Guidelines:** `docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md`
- **Core Architecture:** `docs/apps/code_cm6/TECHNICAL.md` (See Frontend Architecture & Iframe Barrier)

---

*Last Updated: 2025-12-08*