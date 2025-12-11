# LSP-Powered Sticky Scroll MVP
**Date:** 2025-12-08  
**Status:** ✅ Working MVP (Python via Pyright, TypeScript/JavaScript via typescript-language-server)  
**Authors:** vectorArc, neonInk, Dex 

---

## Executive Summary

We successfully integrated Language Server Protocol (LSP) document symbols into the CodeMirror 6 sticky scroll feature. The system now uses **Pyright** for Python files and **typescript-language-server** for JavaScript/TypeScript files, falling back to the existing Lezer parser for unsupported languages.

**Key Achievements:**
- Real-time LSP `textDocument/documentSymbol` responses driving sticky scroll with proper nesting
- Programmatic syntax highlighting via `highlightCode` API (works for any line, even outside viewport)
- Push-up animations working for LSP-backed scopes
- Decorator skip for Python (shows `def` line, not `@decorator` line)
- Deduplication of same-line scopes (e.g., variable + anonymous class)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Browser (CodeMirror iframe)                                                 │
│                                                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────────┐│
│  │ codemirror.js   │───▶│ SocketIOTransport │───▶│ Socket.IO /lsp namespace││
│  │ (connectLSP)    │    │ (lsp_client_to_  │    │ (via parent window.io) ││
│  │                 │◀───│  server event)   │◀───│                         ││
│  │ @codemirror/    │    │ (lsp_server_to_  │    │                         ││
│  │  lsp-client     │    │  client event)   │    │                         ││
│  └─────────────────┘    └──────────────────┘    └─────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Backend Worker (NiceGUI app_worker)                                         │
│                                                                             │
│  ┌─────────────────────┐    ┌───────────────────┐    ┌───────────────────┐ │
│  │ LSPSocketIONamespace│───▶│ lsp_shell_manager │───▶│ Framework Shell   │ │
│  │ (lsp_ws.py)         │    │ get_or_spawn_     │    │ (spawn_shell_pipe)│ │
│  │                     │    │ lsp_shell()       │    │                   │ │
│  │ - on_connect        │    └───────────────────┘    │ pyright-langserver│ │
│  │ - on_initialize     │                             │ --stdio           │ │
│  │ - on_lsp_client_to_ │◀────────────────────────────│                   │ │
│  │   server            │    LSP JSON-RPC over pipes  │                   │ │
│  │ - _bridge_output    │───────────────────────────▶│                   │ │
│  └─────────────────────┘                             └───────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Deep Dive

### 1. Frontend: `codemirror.js`

#### SocketIOTransport Class
Bridges the iframe barrier to access Socket.IO from the parent window.

```javascript
// Access io from parent window (NiceGUI loads socket.io in main page)
const _io = (window.parent && typeof window.parent.io === 'function') 
  ? window.parent.io 
  : (typeof io === 'function' ? io : null);

class SocketIOTransport {
  constructor(namespace, languageId, projectRoot) {
    this.socket = _io(namespace, {
      path: "/ui/_nicegui_ws/socket.io",
      transports: ["websocket"],
      query: { app_id: 'file_editor_cm6' },
    });
    
    this.socket.on('connect', () => {
      // Send our custom initialize event (spawns LSP shell)
      this.socket.emit('initialize', { languageId, projectRoot });
    });
  }
  
  send(data) {
    this.socket.emit('lsp_client_to_server', data);
  }
  
  close() {
    this.socket.disconnect();
  }
}
```

#### connectLSP Method
Establishes LSP connection and wires up the @codemirror/lsp-client.

**Key Steps:**
1. Create `SocketIOTransport` for `/lsp` namespace
2. Create `LSPClient` from vendored @codemirror/lsp-client
3. Create `cmTransport` adapter (Socket.IO ↔ JSON string conversion)
4. Connect client to transport
5. Wait for initialization
6. Send `textDocument/didOpen` with document content
7. Request `textDocument/documentSymbol` after 1000ms delay (with retry on timeout)

#### LSP Client Capabilities
The client advertises `hierarchicalDocumentSymbolSupport: true` to receive nested symbols:

```javascript
const extendCapabilities = (caps) => ({
  ...caps,
  textDocument: {
    ...caps.textDocument,
    documentSymbol: {
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: { valueSet: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26] },
      labelSupport: true,
    },
  },
});
```

#### requestDocumentSymbols Method
Sends `textDocument/documentSymbol` request with retry logic:

```javascript
async requestDocumentSymbols(retryCount = 0) {
  // ... validation ...
  try {
    const symbols = await this.lspClient.request('textDocument/documentSymbol', {
      textDocument: { uri: this._lspFileUri }
    });
    this.handleDocumentSymbols(symbols);
  } catch (err) {
    if (err.message?.includes('timed out') && retryCount < 3) {
      const delay = 1000 * (retryCount + 1); // 1s, 2s, 3s backoff
      setTimeout(() => this.requestDocumentSymbols(retryCount + 1), delay);
    }
  }
}
```

---

### 2. Syntax Highlighting: `highlightCode` API

#### The Problem
CM6 only applies syntax highlighting to lines in/near the viewport. When sticky headers show lines that have scrolled far away, they lose their styling.

#### The Solution
Export `highlightCode` from `@lezer/highlight` in the bundle and use it to programmatically highlight any line:

**Bundle Export (src/index.mjs):**
```javascript
export { highlightCode } from "@lezer/highlight";
```

**Usage in getStyledLineHTML():**
```javascript
getStyledLineHTML(lineNumber) {
  const line = state.doc.line(lineNumber);
  const lang = state.facet(CM.language);
  if (!lang?.parser) return this.escapeHTML(line.text);

  let result = "";
  CM.highlightCode(
    line.text,
    lang.parser.parse(line.text),
    { style: tags => CM.highlightingFor(state, tags) },
    (text, cls) => {
      result += cls
        ? `<span class="${cls}">${this.escapeHTML(text)}</span>`
        : this.escapeHTML(text);
    },
    () => { /* line break callback - not needed for single line */ }
  );
  return result;
}
```

**Key Insight:** This parses only the single line in isolation, not the whole document. The language parser is obtained from `state.facet(CM.language)`.

---

### 3. Sticky Scroll Integration

#### Ancestor Path Algorithm
Finds LSP symbols containing the current reference line:

```javascript
const findAncestorPath = (symbols, targetLine, currentPath = []) => {
  for (const sym of symbols) {
    const startLine = sym.range.start.line + 1; // LSP is 0-based
    const endLine = sym.range.end.line + 1;
    
    // Use > startLine (not >=) so scope activates AFTER definition scrolls out
    if (targetLine > startLine && targetLine <= endLine) {
      const newPath = [...currentPath, { sym, startLine, endLine, name: sym.name }];
      
      // Recurse into children for deeper matches
      if (sym.children?.length) {
        const deeperPath = findAncestorPath(sym.children, targetLine, newPath);
        if (deeperPath.length > newPath.length) return deeperPath;
      }
      return newPath;
    }
  }
  return currentPath;
};
```

#### Python Decorator Skip
When LSP reports a function starting on a decorator line, skip to the actual `def`:

```javascript
if (isPython) {
  const trimmed = lineText.trim();
  if (trimmed.startsWith('@')) {
    for (let scanLine = startLine + 1; scanLine <= Math.min(endLine, startLine + 10); scanLine++) {
      const scanText = state.doc.line(scanLine).text.trim();
      if (scanText.startsWith('def ') || scanText.startsWith('async def ') || scanText.startsWith('class ')) {
        startLine = scanLine;
        lineText = state.doc.line(scanLine).text;
        break;
      }
    }
  }
}
```

#### Same-Line Deduplication
When LSP returns multiple symbols starting on the same line (e.g., `const x = ViewPlugin.fromClass(class {...})`), deduplicate:

```javascript
const deduped = [];
for (const sec of filteredPath) {
  const prev = deduped[deduped.length - 1];
  if (prev && prev.startLine === sec.startLine) {
    // Prefer real names over synthetic (<class>, <function>)
    const prevIsSynthetic = /^<.*>$/.test(prev.name);
    const currIsSynthetic = /^<.*>$/.test(sec.name);
    if (prevIsSynthetic && !currIsSynthetic) {
      deduped[deduped.length - 1] = sec;
    }
  } else {
    deduped.push(sec);
  }
}
```

#### Push-Up Animation for LSP Scopes
The push-up effect requires knowing the scope's end position. LSP scopes don't have `node.to`, so use `endLine`:

```javascript
if (innermost.node) {
  // Lezer-backed: use node.to for precise end
  const endLine = state.doc.lineAt(innermost.node.to);
  endBottomViewport = view.lineBlockAt(endLine.to).bottom - scrollTop;
} else {
  // LSP-backed: use endLine directly
  const endLineObj = state.doc.line(innermost.endLine);
  endBottomViewport = view.lineBlockAt(endLineObj.to).bottom - scrollTop;
}
```

#### Simplified Trigger Offsets
LSP scopes use a unified offset formula:

```javascript
// Non-wrapped mode: simple depth-based offset
offset = -(depth + 1);

// Wrapped mode: cumulative height of ancestors
offset = -(cumulativeHeight + 1);
cumulativeHeight += cachedHeight;
```

---

### 4. Backend: `lsp_ws.py`

#### Session Management
```python
self.active_sessions: Dict[str, dict] = {}  # sid -> session info
self.pending_messages: Dict[str, list] = {}  # queued before session ready
self.session_ready: Dict[str, asyncio.Event] = {}
self.reader_tasks: Dict[str, asyncio.Task] = {}  # output bridge tasks
```

#### Race Condition Handling
The @codemirror/lsp-client sends LSP `initialize` immediately, but our Socket.IO `initialize` event (which spawns the shell) may arrive later:

```python
async def on_lsp_client_to_server(self, sid, message):
    session = self.active_sessions.get(sid)
    if not session:
        self.pending_messages[sid].append(message)  # Queue it
        return
    await self._forward_to_shell(sid, message)

async def on_initialize(self, sid, data):
    # Spawn shell, create session...
    self.active_sessions[sid] = { ... }
    
    # Process queued messages
    for msg in self.pending_messages.get(sid, []):
        await self._forward_to_shell(sid, msg)
```

#### LSP Framing
```python
async def _forward_to_shell(self, sid, message):
    body = json.dumps(message).encode("utf-8")
    header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
    pipe_state.process.stdin.write(header + body)
    await pipe_state.process.stdin.drain()
```

---

### 5. Shell Manager: `lsp_shell_manager.py`

```python
LSP_COMMANDS = {
    "python": ["pyright-langserver", "--stdio"],
    "typescript": ["typescript-language-server", "--stdio"],
    "typescriptreact": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"],
    "javascriptreact": ["typescript-language-server", "--stdio"],
}
```

---

## Language-Specific Behavior

### Python (via Pyright)
| Behavior | Implementation |
|----------|----------------|
| Decorator Skip | Scan forward from `@` to find `def`/`class` |
| Indent-0 Filter | Drop outermost scopes not at column 0 |

### JavaScript/TypeScript (via typescript-language-server)
| Behavior | Implementation |
|----------|----------------|
| Deduplication | Merge same-line scopes, prefer real names |
| No Filtering | Braces define scopes, not indentation |

### Common (all languages)
| Behavior | Implementation |
|----------|----------------|
| Offset | `-(depth + 1)` for non-wrapped, cumulative for wrapped |
| Activation | `targetLine > startLine && targetLine <= endLine` |
| Push-up | Uses `endLine` for geometry calculation |
| Syntax Highlighting | `highlightCode()` API for any line |

---

## Supported File Types

| Extension | Language ID | LSP Server |
|-----------|-------------|------------|
| `.py`, `.pyw` | `python` | pyright-langserver |
| `.js`, `.mjs`, `.cjs` | `javascript` | typescript-language-server |
| `.jsx` | `javascriptreact` | typescript-language-server |
| `.ts`, `.mts` | `typescript` | typescript-language-server |
| `.tsx` | `typescriptreact` | typescript-language-server |

---

## Files Modified

| File | Changes |
|------|---------|
| `codemirror.js` | SocketIOTransport, connectLSP, handleDocumentSymbols, requestDocumentSymbols (with retry), findAncestorPath, decorator skip, deduplication, getStyledLineHTML (highlightCode), push-up for LSP scopes |
| `src/index.mjs` | Added `export { highlightCode } from "@lezer/highlight"` |
| `codemirror.py` | Added `connect_lsp(language_id, project_root, file_path)` wrapper |
| `editor_app.py` | LSP_LANGUAGE_MAP, `_should_use_lsp()`, `_maybe_connect_lsp()` |
| `lsp_ws.py` | LSPSocketIONamespace with session management and output bridging |
| `lsp_shell_manager.py` | `get_or_spawn_lsp_shell()` with JSX/TSX support |
| `main.py` | Namespace registration |

---

## Debugging

### Enable Debug Logging
```javascript
const DEBUG_LSP_STICKY = true;  // In updateStickyHeader()
const DEBUG_SLOTS = true;       // For activation logic
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| No symbols | File not opened with didOpen | Check LSP initialization sequence |
| Flat scopes | Missing `hierarchicalDocumentSymbolSupport` | Verify client capabilities |
| No highlighting | `highlightCode` not exported | Rebuild bundle |
| Push-up broken | Using `node.to` for LSP scope | Check `innermost.node` before using |
| Timeout on load | LSP server cold start | Retry logic with backoff |

---

## Known Limitations

1. **Single-line parsing**: `highlightCode` parses each line in isolation, so multi-line constructs (template literals, etc.) may not highlight correctly at boundaries
2. **Initial delay**: LSP symbols take ~1-3 seconds on cold start
3. **No incremental sync**: Full document sent on each change (could optimize with `textDocument/didChange`)

---

**Status:** MVP Complete ✅  
**Last Updated:** 2025-12-08
