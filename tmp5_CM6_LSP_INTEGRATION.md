# CM6 LSP Integration

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** Vendor LSP Client (tmp3), WebSocket Bridge (tmp4)  
**Blocks:** Sticky Scroll Refactor (tmp6)

---

## Purpose

Wire `@codemirror/lsp-client` into vendored CM6 with Vue methods and Python wrappers.

---

## Scope

- Add LSP client extension to codemirror.js
- Vue methods for connect/disconnect
- Python wrappers for backend control
- Symbol subscription mechanism

---

## JavaScript Changes (codemirror.js)

### Imports
```javascript
// At top, check for LSP availability
const LSPClient = typeof CM.LanguageServerClient === 'function' 
  ? CM.LanguageServerClient : null;
```

### Data Properties
```javascript
data() {
  return {
    // ... existing ...
    lspCompartment: null,
    lspClient: null,
    symbolSubscribers: [],
  };
}
```

### Methods
```javascript
methods: {
  // Connect to LSP server via WebSocket
  connectLSP(wsUrl, languageId) {
    if (!LSPClient) {
      console.warn('[CM6] LSP client not available in bundle');
      return;
    }
    
    if (!this.lspCompartment) {
      this.lspCompartment = new CM.Compartment();
      this.editor.dispatch({
        effects: CM.StateEffect.appendConfig.of(this.lspCompartment.of([]))
      });
    }
    
    // Create LSP client
    this.lspClient = new LSPClient({
      transport: { type: 'websocket', url: wsUrl },
      languageId: languageId,
      // ... other config
    });
    
    // Subscribe to document symbols
    this.lspClient.on('documentSymbols', (symbols) => {
      this.handleDocumentSymbols(symbols);
    });
    
    // Install extension
    this.editor.dispatch({
      effects: this.lspCompartment.reconfigure([this.lspClient.extension])
    });
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
  },
  
  handleDocumentSymbols(symbols) {
    // Notify sticky scroll (tmp6 integration point)
    this.latestSymbols = symbols;
    // Trigger sticky scroll update
    this.updateStickyFromSymbols(symbols);
  },
  
  onSymbolUpdate(callback) {
    this.symbolSubscribers.push(callback);
  },
}
```

---

## Python Changes (codemirror.py)

```python
def connect_lsp(self, ws_url: str, language_id: str) -> None:
    """Connect editor to LSP server via WebSocket.
    
    Args:
        ws_url: WebSocket URL for LSP connection
        language_id: Language identifier (python, typescript, etc.)
    """
    self.run_method('connectLSP', {'wsUrl': ws_url, 'languageId': language_id})

def disconnect_lsp(self) -> None:
    """Disconnect from current LSP server."""
    self.run_method('disconnectLSP')
```

---

## Backend Integration (editor_app.py)

```python
# When opening a file, optionally connect LSP
async def _maybe_connect_lsp(editor, language: str, project_root: Path):
    # Check if LSP enabled for this project/language
    if not should_use_lsp(project_root, language):
        return
    
    # Get WebSocket URL for this language's LSP
    ws_url = f"/api/app/file_editor_cm6/ws/lsp/{language}"
    
    editor.connect_lsp(ws_url, language)
```

---

## Files to Create/Modify

- **MODIFY:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- **MODIFY:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
- **MODIFY:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

---

## Testing

1. Open Python file
2. Verify LSP connection established
3. Check console for symbol updates
4. Disconnect and verify cleanup

---

## Notes

- Actual API depends on @codemirror/lsp-client package
- May need to adapt based on package's actual exports
- Symbol format may need transformation for sticky scroll

---

*Last Updated: 2025-12-07*
