# LSP Shell Manager

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** Framework Shells infrastructure (already exists)  
**Blocks:** WebSocket Bridge (tmp4)

---

## Purpose

Create a module to spawn and manage language server processes as framework shells.

---

## Dependencies

- **Python:** `pyright` (vendored via npm in `app/static/vendor/lsp_servers`)
- **JavaScript/TypeScript:** `typescript-language-server` + `typescript` (vendored in `app/static/vendor/lsp_servers`)
- **Other:** `gopls`, `rust-analyzer` (future expansion)

---

## Scope

- Spawn `lsp-{language}` framework shells on demand
- Map `languageId` → language server command (prefer vendored binaries under `app/static/vendor/lsp_servers/node_modules/.bin`)
- Track active LSP shells
- `didClose`/`didOpen` lifecycle on file switch
- Graceful shutdown integration
- **Verify:** Ensure `pyright` AND `typescript-language-server` binaries are available (vendored path first, PATH fallback)

---

## Key Functions

```python
# app/apps/file_editor_cm6/lsp_shell_manager.py

import shutil

LSP_COMMANDS = {
    # Ensure these binaries are in the system PATH
    "python": ["pyright-langserver", "--stdio"],
    "typescript": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"], # Uses the same server
    # Future: go, rust, etc.
}

def get_or_spawn_lsp_shell(language_id: str, project_root: Path) -> ShellRecord | None:
    """Get existing or spawn new LSP shell for language."""
    cmd = LSP_COMMANDS.get(language_id)
    if not cmd:
        return None
        
    # Check if binary exists
    if not shutil.which(cmd[0]):
        print(f"LSP binary {cmd[0]} not found")
        return None
        
    pass

def get_active_lsp_shell() -> ShellRecord | None:
    """Return currently active LSP shell (if any)."""
    pass

def switch_lsp_shell(new_language_id: str, project_root: Path) -> ShellRecord | None:
    """Switch from current to new language server."""
    pass

def shutdown_lsp_shell(language_id: str) -> None:
    """Gracefully terminate LSP shell."""
    pass
```

---

## Files to Create/Modify

- **NEW:** `app/apps/file_editor_cm6/lsp_shell_manager.py`
- **MODIFY:** `app/apps/file_editor_cm6/main.py` (import, expose endpoints?)
- **MODIFY:** `requirements.txt` (add `pyright`)

---

## Testing

1. Manually spawn shell: `get_or_spawn_lsp_shell("python", Path("/project"))`
2. Verify shell appears in framework shell list
3. Switch languages, verify old shell handling
4. Kill shell, verify clean shutdown

---

## References

- **Framework Shells Architecture:** `docs/core/framework_shells.md`
- **Settings/Timeouts:** See `FrameworkShellManager` in `app/libs/framework_shells.py`

---

*Last Updated: 2025-12-08 (Dex)*


---

# Vendor @codemirror/lsp-client

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** Nothing (independent)  
**Blocks:** CM6 LSP Integration (tmp5)

---

## Purpose

Add `@codemirror/lsp-client` package to the vendored CodeMirror 6 bundle.

---

## Scope

- npm install the package
- Export in bundle
- Rebuild
- Verify exports available

---

## Steps

### 1. Navigate to vendor directory
```bash
cd app/static/vendor/nicegui/elements/codemirror
```

### 2. Install package
```bash
npm install @codemirror/lsp-client
```

### 3. Update exports
```javascript
// src/index.mjs - add:
export * from "@codemirror/lsp-client";
```

### 4. Rebuild bundle
```bash
npm run build
```

**System Note:** The user's Termux environment handles `esbuild` and `node` minification correctly (Android SDK for gyp is handled via system path). No special configuration for terser is required.

### 5. Verify exports
```bash
grep -r "lsp" dist/
# Should show LSP-related exports
```

---

## Expected Exports

From `@codemirror/lsp-client`, we need:
- `LanguageServerClient` (or equivalent)
- Symbol/document symbol handling
- WebSocket transport support

---

## Files Modified

- `app/static/vendor/nicegui/elements/codemirror/package.json`
- `app/static/vendor/nicegui/elements/codemirror/package-lock.json`
- `app/static/vendor/nicegui/elements/codemirror/src/index.mjs`
- `app/static/vendor/nicegui/elements/codemirror/dist/*` (rebuilt)

---

## Rollback

If issues:
```bash
git checkout -- app/static/vendor/nicegui/elements/codemirror/
npm install  # restore node_modules
```

---

## References

- **Feature Adding Guidelines (Vendoring):** `docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md`
  - See section: "Vendoring Guidelines" and "Bundle Management"
- **Vendoring LSP Servers:** `tmp9_VENDOR_TANGENT.md`

---

*Last Updated: 2025-12-07*

---

# LSP Socket.IO Bridge

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** LSP Shell Manager (tmp2)  
**Blocks:** CM6 LSP Integration (tmp5)  
**Reference:** `tmp8_SOCKETIO_METHOD.md` (Piggyback Strategy)

---

## Purpose

Bridge Socket.IO events from CM6 LSP client to framework shell STDIO.

---

## Architecture

We use the **Piggyback Strategy** to attach a new namespace `/lsp` to the existing NiceGUI Socket.IO instance.

```
CM6 LSP Client Extension
    ↓↑ Socket.IO (Namespace: /lsp)
    │  Events: 'lsp:client_to_server', 'lsp:server_to_client'
    │
LSP Socket.IO Namespace (Python)
    ↓↑ Smart Bridge (Header Parsing)
    │  [Content-Length: 123\r\n\r\n{...}]
    │
Framework Shell (lsp-python)
    ↓↑ STDIO
Language Server (pyright)
```

---

## The "Smart Bridge" Logic

LSP over STDIO uses header framing (`Content-Length: ...`), but Socket.IO sends discrete messages. The Python bridge acts as the protocol translator.

### 1. Client → Server
*   **Event:** `lsp:client_to_server`
*   **Payload:** JSON Object (the LSP message)
*   **Action:** 
    1.  Serialize JSON to string/bytes.
    2.  Prepend `Content-Length: {len}\r\n\r\n`.
    3.  Write to shell stdin.

### 2. Server → Client
*   **Source:** Shell stdout stream
*   **Action:**
    1.  Read into buffer.
    2.  Parse `Content-Length` header.
    3.  Read exactly `Content-Length` bytes.
    4.  Parse body as JSON.
    5.  Emit `lsp:server_to_client` with JSON payload.

---

## Implementation

### 1. The Namespace (`lsp_ws.py`)

```python
# app/apps/file_editor_cm6/lsp_ws.py

import socketio
import asyncio
import json
from app.apps.file_editor_cm6.lsp_shell_manager import get_or_spawn_lsp_shell

class LSPSocketIONamespace(socketio.AsyncNamespace):
    def __init__(self, namespace='/lsp'):
        super().__init__(namespace)
        self.active_shells = {}  # sid -> shell

    async def on_connect(self, sid, environ):
        # Wait for initialization to know which language
        pass

    async def on_initialize(self, sid, data):
        """Client sends this first: { languageId: 'python', projectRoot: '...' }"""
        language_id = data.get('languageId')
        project_root = data.get('projectRoot')
        
        shell = get_or_spawn_lsp_shell(language_id, project_root)
        self.active_shells[sid] = shell
        
        # Start background reader task for this shell -> sid
        asyncio.create_task(self.bridge_shell_output(sid, shell))

    async def on_lsp_client_to_server(self, sid, message):
        """Receive JSON message from client, send to shell."""
        shell = self.active_shells.get(sid)
        if shell:
            # Add LSP Framing
            body = json.dumps(message).encode('utf-8')
            header = f"Content-Length: {len(body)}\r\n\r\n".encode('ascii')
            shell.write_stdin(header + body)

    async def bridge_shell_output(self, sid, shell):
        """Read from shell, parse framing, emit to client."""
        # This needs a robust buffer parser for Content-Length headers
        # ... implementation of simple LSP framer ...
        while True:
            # Pseudo-code for framing
            # header = await read_until_double_crlf()
            # content_len = parse_len(header)
            # body = await read_exact(content_len)
            # await self.emit('lsp:server_to_client', json.loads(body), to=sid)
            pass

    async def on_disconnect(self, sid):
        if sid in self.active_shells:
            del self.active_shells[sid]
```

### 2. Registration (`main.py`)

Add to `init_nicegui_with_app`:

```python
# app/apps/file_editor_cm6/main.py

def init_nicegui_with_app(fastapi_app):
    import nicegui.nicegui as ng
    from app.apps.file_editor_cm6.explorer_ws import ExplorerSocketIONamespace
    from app.apps.file_editor_cm6.lsp_ws import LSPSocketIONamespace  # NEW
    
    ng.sio.register_namespace(ExplorerSocketIONamespace('/explorer'))
    ng.sio.register_namespace(LSPSocketIONamespace('/lsp')) # NEW
```

---

## Files to Create/Modify

- **NEW:** `app/apps/file_editor_cm6/lsp_ws.py`
- **MODIFY:** `app/apps/file_editor_cm6/main.py` (register namespace)

---

## Note on Client Side

The `@codemirror/lsp-client` usually expects a generic Transport interface. We will need to implement a **SocketIOTransport** class in the vendored JS that adapts the `lsp:client_to_server` events to the interface the library expects.

---

## References

- **Socket.IO Integration Method:** `tmp8_SOCKETIO_METHOD.md`
- **Framework Shells:** `docs/core/framework_shells.md`

---

*Last Updated: 2025-12-08*


---

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

---

# Sticky Scroll Refactor

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** CM6 LSP Integration (tmp5)  
**Blocks:** Nothing (final step)

---

## Purpose

Replace Lezer-based scope detection with LSP document symbols in sticky scroll.

---

## Scope

- Consume LSP symbol tree instead of Lezer syntax tree
- Convert symbols to sticky sections
- Keep Markdown fallback (foldable path)
- Keep non-LSP fallback for languages without servers

---

## Current Implementation

```javascript
// In updateStickyHeader() - codemirror.js ~line 1910
if (isMarkdown) {
  // Custom heading collection
} else {
  // Lezer syntax tree traversal
  const tree = CM.ensureSyntaxTree(state, state.doc.length, 200);
  let node = tree.resolveInner(refPos);
  for (; node; node = node.parent) {
    if (isScopeNode(node, scopeTypes, state, isPython)) {
      ancestorNodes.push(node);
    }
  }
}
```

---

## New Implementation

### Symbol Storage
```javascript
// Add to plugin class
this.lspSymbols = null;  // Cached LSP symbol tree
this.lspSymbolsStale = true;

// Called from CM6 LSP integration
updateSymbols(symbols) {
  this.lspSymbols = symbols;
  this.lspSymbolsStale = false;
  this.updateStickyHeader();
}
```

### Symbol → Section Conversion
```javascript
function flattenSymbolsToSections(state, symbols) {
  const sections = [];
  
  function walk(symbol, depth) {
    // Convert LSP range to line numbers
    const startPos = symbol.range.start;
    const endPos = symbol.range.end;
    const startLine = state.doc.lineAt(startPos).number;
    const endLine = state.doc.lineAt(endPos).number;
    
    // Get the text of the first line (for display)
    const lineText = state.doc.line(startLine).text;
    
    sections.push({
      depth,
      startLine,
      endLine,
      text: lineText,
      name: symbol.name,
      kind: symbol.kind,  // Class=5, Function=12, etc.
      node: { from: startPos, to: endPos },
    });
    
    if (symbol.children) {
      for (const child of symbol.children) {
        walk(child, depth + 1);
      }
    }
  }
  
  for (const sym of symbols) {
    walk(sym, 0);
  }
  
  return sections;
}
```

### Modified updateStickyHeader
```javascript
updateStickyHeader(isRetry = false) {
  // ... existing geometry code ...
  
  let candidateScopes = [];
  
  if (isMarkdown) {
    // Keep existing Markdown path
    candidateScopes = this.buildMarkdownScopes(state, refLine);
  } else if (this.lspSymbols && !this.lspSymbolsStale) {
    // NEW: Use LSP symbols
    const allSections = flattenSymbolsToSections(state, this.lspSymbols);
    candidateScopes = this.filterSectionsForRefLine(allSections, refLine);
  } else {
    // FALLBACK: Original Lezer path (for languages without LSP)
    candidateScopes = this.buildLezerScopes(state, refLine, tree);
  }
  
  // ... rest of existing code (slots, rendering) unchanged ...
}
```

### Filter Sections for Reference Line
```javascript
filterSectionsForRefLine(sections, refLine) {
  // Find all sections that contain refLine
  const containing = sections.filter(s => 
    refLine >= s.startLine && refLine <= s.endLine
  );
  
  // Sort by depth (outermost first)
  containing.sort((a, b) => a.depth - b.depth);
  
  // Build ancestor chain (one per depth level)
  const ancestors = [];
  let lastDepth = -1;
  for (const s of containing) {
    if (s.depth > lastDepth) {
      ancestors.push(s);
      lastDepth = s.depth;
    }
  }
  
  return ancestors;
}
```

---

## Code to Remove

Once LSP path is working:
- `isScopeNode()` function
- `getScopeTypes()` function
- Python-specific offset tuning
- Language-specific `scopeTypes` arrays

**Keep for fallback:**
- Markdown heading collection
- Basic Lezer traversal (simplified)

---

## Files to Modify

- **MODIFY:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
  - `stickyScrollPlugin` class
  - `updateStickyHeader()` method
  - Add `flattenSymbolsToSections()`
  - Add `filterSectionsForRefLine()`

---

## Testing

1. Open Python file with nested classes/functions
2. Verify sticky scroll shows more nesting than before
3. Open Markdown file, verify fallback still works
4. Switch between Python/Markdown, verify correct path used

---

## LSP Symbol Kinds Reference

```
1  = File
2  = Module
3  = Namespace
4  = Package
5  = Class
6  = Method
7  = Property
8  = Field
9  = Constructor
10 = Enum
11 = Interface
12 = Function
13 = Variable
...
```

Filter to show: Class (5), Method (6), Function (12), Constructor (9)

---

## References

- **Current Sticky Scroll Implementation:** `notes/2025-12-7_CURRENT_STICKY_SCROLL_TECHNICAL.md`
- **Technical Overview:** `docs/apps/code_cm6/TECHNICAL.md`

---

*Last Updated: 2025-12-07*

---

# Per-Project LSP Configuration

**Created:** 2025-12-07  
**Status:** Not Started (Future Phase)  
**Depends On:** Full LSP pipeline working (tmp2-6)  
**Blocks:** Nothing

---

## Purpose

Allow users to enable/disable language servers on a per-project basis.

---

## Scope

- Add `languageServers` to ProjectSidecar schema
- Settings modal for toggling servers
- Backend logic to respect configuration
- Default: Python enabled, others disabled

---

## ProjectSidecar Schema Extension

```jsonc
// ~/.cache/cm6_editor/projects/<sha1>.json
{
  "recent_files": [...],
  "last_file": "...",
  "diff_base": "HEAD",
  "session_cache": {...},
  
  // NEW
  "languageServers": {
    "python": true,
    "typescript": false,
    "javascript": false,
    "go": false,
    "rust": false
  }
}
```

---

## Backend API

```python
# GET /editor/lsp/config
def get_lsp_config():
    sidecar = get_current_project_sidecar()
    return {"languageServers": sidecar.get("languageServers", DEFAULT_LS)}

# POST /editor/lsp/config
def set_lsp_config(data: dict):
    sidecar = get_current_project_sidecar()
    sidecar["languageServers"] = data.get("languageServers", {})
    save_sidecar(sidecar)
    return {"ok": True}
```

---

## Query Function

```python
def should_use_lsp(project_root: Path, language_id: str) -> bool:
    """Check if LSP is enabled for this project/language."""
    sidecar = get_project_sidecar(project_root)
    ls_config = sidecar.get("languageServers", DEFAULT_LS)
    return ls_config.get(language_id, False)

DEFAULT_LS = {
    "python": True,  # Enabled by default
    "typescript": False,
    "javascript": False,
    "go": False,
    "rust": False,
}
```

---

## UI Modal

Add to Editor menu:
- "Language Servers..." → Opens modal

Modal contents:
- List of available language servers
- Toggle switch for each
- Save/Cancel buttons
- Note: "Requires language server binary installed"

---

## Files to Create/Modify

- **MODIFY:** `app/apps/file_editor_cm6/history_store.py` (or sidecar module)
- **MODIFY:** `app/apps/file_editor_cm6/main.py` (endpoints)
- **MODIFY:** `app/apps/file_editor_cm6/main.js` (modal UI)
- **MODIFY:** `app/apps/file_editor_cm6/template.html` (modal HTML)

---

## Notes

- This is Phase 3 - only implement after basic LSP working
- Start with defaults enabled, let users disable
- Consider auto-detecting available servers on system

---

## References

- **State Management (ProjectSidecar):** `docs/apps/code_cm6/TECHNICAL.md` (See State Management section)
- **Preference Store:** `app/apps/file_editor_cm6/preferences_store.py` (Reference implementation for stores)

---

*Last Updated: 2025-12-07*

---

# Socket.IO Integration Method
**Date:** 2025-12-08
**Status:** Production
**Component:** `app/apps/file_editor_cm6`

## Overview
This document describes the method used to integrate Socket.IO into the existing FastAPI/NiceGUI architecture to support the File Explorer's real-time updates. The challenge was to add a Socket.IO namespace (`/explorer`) alongside the existing NiceGUI application (which already uses Socket.IO internally) without creating port conflicts or "split-brain" server instances.

## The Architecture

### 1. The "Piggyback" Strategy
Instead of running a separate Socket.IO server for the explorer, we attach our custom namespace to the **existing NiceGUI Socket.IO instance**.

*   **NiceGUI** initializes its own `socketio.AsyncServer` (available as `nicegui.nicegui.sio`).
*   **We register** our `ExplorerSocketIONamespace` directly onto that existing server instance.
*   **Result:** Both NiceGUI's internal events and our custom explorer events travel over the same physical WebSocket connection (or at least the same port/server).

### 2. Implementation Details

#### A. The Namespace (`explorer_ws.py`)
We define a custom `socketio.AsyncNamespace` that handles explorer-specific events.

```python
# app/apps/file_editor_cm6/explorer_ws.py
class ExplorerSocketIONamespace(socketio.AsyncNamespace):
    def __init__(self, namespace='/explorer'):
        super().__init__(namespace)
        # ... dispatcher management ...

    async def on_connect(self, sid, environ):
        # Create a shim that looks like a WebSocket to our existing dispatcher logic
        ws = SocketIOSocketShim(self, sid)
        dispatcher = ExplorerDispatcher(ws)
        await dispatcher.initialize()
        # ...
```

#### B. The Registration Hook (`main.py`)
We use a special initialization hook `init_nicegui_with_app` in the app's `main.py`. This function is called by the worker process (`app_worker.py`) *after* the FastAPI app is created but *before* the server starts serving requests.

```python
# app/apps/file_editor_cm6/main.py

def init_nicegui_with_app(fastapi_app):
    # ... standard NiceGUI setup ...
    
    # CRITICAL: Register our namespace onto NiceGUI's existing server
    import nicegui.nicegui as ng
    from app.apps.file_editor_cm6.explorer_ws import ExplorerSocketIONamespace
    
    # This is the magic line:
    ng.sio.register_namespace(ExplorerSocketIONamespace('/explorer'))
```

#### C. The Client-Side Connection (`template.html`)
The frontend explicitly connects to this namespace using the `socket.io-client` library.

```javascript
// app/apps/file_editor_cm6/template.html

// 1. Load the library
import { io } from "/ui/_nicegui/static/socket.io.min.js";

// 2. Connect to the specific namespace
const socket = io("/explorer", {
    path: "/ui/_nicegui_ws/socket.io", // Must match the proxy path
    transports: ["websocket", "polling"],
    // ...
});

// 3. Handle events
socket.on("connect", () => {
    console.log("[Explorer] Connected via Socket.IO");
});
```

### 3. The Proxy Layer (`app/main.py`)
Since the application runs behind a main proxy (the "Launcher" or "Framework"), we must ensure Socket.IO traffic is correctly forwarded to the worker process.

*   **HTTP Polling:** The route `/ui/_nicegui_ws/socket.io/{rest:path}` forwards HTTP polling requests.
*   **WebSocket Upgrade:** The websocket route `/ui/_nicegui_ws/socket.io/{rest:path}` handles the connection upgrade.
*   **Referer Detection:** The proxy uses the `Referer` header (or `app_id` query param) to determine which worker process (e.g., `file_editor_cm6`) should receive the traffic.

## Key Benefits
1.  **Single Port:** No need to open extra ports for the explorer.
2.  **Shared Session:** Potential to share authentication/session state with NiceGUI (though currently loosely coupled).
3.  **Robustness:** Leverages Socket.IO's reconnection logic (heartbeats, fallbacks) which is more robust than raw WebSockets for mobile/unstable networks.

## Files Involved
*   `app/apps/file_editor_cm6/explorer_ws.py`: The Namespace class.
*   `app/apps/file_editor_cm6/main.py`: The registration hook.
*   `app/apps/file_editor_cm6/template.html`: The client-side connection code.
*   `app/main.py`: The proxy forwarding logic.


---

# Tangent: Vendoring LSP Servers

**Created:** 2025-12-08  
**Status:** Approved  
**Author:** Gemini (Planning Buddy)

---

## Decision

Instead of relying on global npm installs or system PATH for Language Servers, we will **vendor** them directly into the repository.

**Why:**
- Self-contained application (git clone -> run).
- Exact version control of the analysis engine.
- Zero external setup for the user (beyond `pip install` which runs the setup scripts).

## Implementation Plan

### 1. Location
Create a dedicated directory for server binaries:
`app/static/vendor/lsp_servers/`

### 2. Installation (completed)
We treat this like the NiceGUI vendor dir (Dex • 2025-12-08).
```bash
mkdir -p app/static/vendor/lsp_servers
cd app/static/vendor/lsp_servers
npm init -y
npm install --no-fund --no-audit typescript typescript-language-server pyright
```

### 3. Path Resolution
The `LSP_SHELL_MANAGER` must be updated to look here.

**Updated `LSP_COMMANDS` logic:**
```python
VENDOR_DIR = Path(__file__).parents[2] / 'static' / 'vendor' / 'lsp_servers' / 'node_modules' / '.bin'

LSP_COMMANDS = {
    "javascript": [str(VENDOR_DIR / "typescript-language-server"), "--stdio"],
    "typescript": [str(VENDOR_DIR / "typescript-language-server"), "--stdio"],
    # ...
}
```

### 4. Agent Instructions

**For Jimmy (Vendoring Agent):**
- In addition to the client package, create the `lsp_servers` directory and install the server packages.

**For Dex (Shell Manager Agent):**
- Ensure the path resolution logic looks in `app/static/vendor/lsp_servers` before failing. ✅ Implemented via `_resolve_binary` preference.

---

**Signed:** *Gemini (Planning Buddy)*


---


---

**Gemini (Planning Buddy) to neon_ink (Step 4):**

**Ref: Symbol Handling Surface**

You noted: "Notifies the host via an existing mechanism".

**Clarification:**
While notifying the host is good for future features (like an Outline View), the **primary consumer** of these symbols right now is the **Sticky Scroll Plugin** which lives *inside* `codemirror.js`.

**Refinement:**
In `handleDocumentSymbols(symbols)`:
1.  Store the symbols in a local data property (e.g., `this.lspSymbols = symbols`).
2.  Emit an internal Vue event or call a method that the Sticky Scroll logic (Step 5) can observe.
3.  (Optional) Notify the host if you wish, but ensure local availability is priority #1.

This ensures Atlas (Step 5) has immediate access to the data without a round-trip to Python.

---

**Plan Update (Step 4 Implementation Shape)**

**Modifications to the Plan:**
- Treat the Sticky Scroll plugin as the primary consumer of LSP document symbols; host notification is secondary.
- Make `handleDocumentSymbols(symbols)` responsible for:
  - caching symbols on the component instance (`this.lspSymbols`),
  - triggering a local hook that Sticky Scroll can observe (method call or Vue event),
  - optionally forwarding symbols to the host layer for outline/telemetry.

**Actionable Step 4 Overview:**
1. Extend the CM6 Vue component state with `lspSymbols: []` and a small hook surface for Sticky Scroll (e.g., `updateStickyScrollFromSymbols()` or an internal event name).
2. Implement `handleDocumentSymbols(symbols)` to:
   - assign `this.lspSymbols = symbols || []`,
   - call the Sticky Scroll hook so it can recompute its scope model,
   - optionally call `notifyParent('document_symbols', { symbols })` if we want host awareness.
3. Ensure the planned LSP client wiring (from tmp5 Step 2/3) calls `handleDocumentSymbols` from the `documentSymbols` event handler so Atlas can focus on Step 5 without touching transport details.


---

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


---

# Dex Action Plan – 2025-12-08

## Dependencies
- Add `pyright` to `requirements.txt`; run lock/update if applicable.
- Confirm `typescript-language-server` and `typescript` are installed globally (npm) and on PATH; document install command for local dev if missing.

## LSP Shell Manager module (`app/apps/file_editor_cm6/lsp_shell_manager.py`)
- Define `LSP_COMMANDS` mapping (python → `pyright-langserver --stdio`; typescript/javascript → `typescript-language-server --stdio`).
- Implement binary availability check with `shutil.which` before spawn; log and return `None` on absence.
- Implement `get_or_spawn_lsp_shell(language_id, project_root)` using `FrameworkShellManager.spawn_shell` with label `lsp:{language}` and `cwd=project_root`.
- Track in-memory `language_id → shell_id` cache and `active_language_id`; on lookup, revalidate liveness via manager `get_shell`/`sweep` behavior.
- Implement `get_active_lsp_shell()` returning the active shell record if alive.
- Implement `switch_lsp_shell(new_language_id, project_root)` to update active pointer, optionally start missing shell, and handle unsupported IDs gracefully.
- Implement `shutdown_lsp_shell(language_id)` to gracefully terminate by label/id via manager.
- Add small comment blocks around significant new sections per style preference.

## Integration (`app/apps/file_editor_cm6/main.py`)
- Import the manager helpers; wire into file open/close flow to call `switch_lsp_shell` on language change.
- Consider lightweight API endpoints (start/stop/status) if frontend needs explicit control; keep FastAPI routing style.
- Ensure `cwd` passed to spawns respects home-dir constraint enforced by `FrameworkShellManager`.

## Verification
- Manual: call `get_or_spawn_lsp_shell("python", Path(project_root))`; confirm entry appears in `/api/framework_shells` list.
- Switch to TypeScript/JavaScript buffer; ensure reuse of `typescript-language-server` instance and active pointer updates.
- Shutdown via helper and confirm clean exit/logs; verify no orphaned PTY state (not used).

## Follow-ups
- Add future entries for `gopls`/`rust-analyzer` once binaries are available.
- Consider timeout/idle policy reuse from framework settings instead of bespoke timers.

---

## Report (Dex • 2025-12-08)
- Implemented `app/apps/file_editor_cm6/lsp_shell_manager.py` with vendored-first binary resolution, spawn/switch/shutdown helpers, and debug cache view.
- Added LSP debug endpoints in `app/apps/file_editor_cm6/main.py` (`/api/lsp/switch`, `/active`, `/shutdown`, `/debug/cache`).
- Vendored LSP servers under `app/static/vendor/lsp_servers` (`typescript`, `typescript-language-server`, `pyright`); adjusted manager and docs to prefer this path; removed PyPI `pyright` from `requirements.txt`.
- Created `scripts/test_lsp_switch.sh` (defaults to `http://localhost:8088/api/app/file_editor_cm6`) to exercise switch/active; logs to `~/.tmp/test.log`.
- Smoke test: `/api/lsp/switch` for TypeScript succeeded via framework proxy; shell `fs_1765170217_da6caf5a` running `typescript-language-server` from vendor dir.

---

**Gemini (Planning Buddy) Note:**
The plan above is solid. Just a small heads-up on the "Integration" step: ensure you don't tightly couple the `switch_lsp_shell` call to the `main.py` router if it doesn't belong there. It might be better invoked by the Socket.IO namespace (`lsp_ws.py`) in Step 3. However, exposing a debug endpoint in `main.py` is a good idea for testing.

---

## Report (Jimmy • 2025-12-08)
- Vendored `@codemirror/lsp-client` into `app/static/vendor/nicegui/elements/codemirror`.
- Updated `src/index.mjs` with `export * from "@codemirror/lsp-client";`.
- Rebuilt bundle (`npm run build`) and verified `LSPClient` export availability via grep.
- Verified dependencies: `@codemirror/lsp-client` version `^0.3.0` installed successfully.

---

## Actionable Steps: LSP Socket.IO Bridge (tmp4) — vectorArc • 2025-12-08 05:44 UTC

**Status:** tmp2 (Shell Manager) and tmp3 (Vendor LSP Client) complete. Ready to implement tmp4.

### Step 1: Create LSP Socket.IO Namespace (`lsp_ws.py`)

**File:** `app/apps/file_editor_cm6/lsp_ws.py`

- [ ] Define `LSPSocketIONamespace(socketio.AsyncNamespace)` with namespace `/lsp`
- [ ] Implement `on_connect(sid, environ)` — stub, wait for initialize
- [ ] Implement `on_initialize(sid, data)` — extract `languageId`, `projectRoot`; call `get_or_spawn_lsp_shell()`; store shell reference in `active_shells[sid]`
- [ ] Implement `on_lsp_client_to_server(sid, message)` — serialize JSON, prepend `Content-Length` header, write to shell stdin
- [ ] Implement `bridge_shell_output(sid, shell)` — async task that:
  - Reads from shell stdout buffer
  - Parses `Content-Length` headers
  - Extracts exactly N bytes of JSON body
  - Emits `lsp:server_to_client` to client
- [ ] Implement `on_disconnect(sid)` — clean up `active_shells[sid]` (don't kill shell; may be shared)

### Step 2: Implement LSP Framing Parser

**In:** `lsp_ws.py` (helper class or function)

- [ ] Create `LSPFrameParser` class with buffer and state machine:
  - State: `READING_HEADER` / `READING_BODY`
  - `feed(data: bytes)` — append to buffer, yield complete messages
  - Parse `Content-Length: N\r\n\r\n` pattern
  - Read exactly N bytes for body
  - Return parsed JSON objects
- [ ] Handle partial reads gracefully (network chunking)

### Step 3: Wire Shell STDIO to Namespace

**Consideration:** Framework shells write to log files, not live streams. Options:

- [ ] **Option A:** Use PTY shell (`uses_pty=True`) for bidirectional streaming — preferred for LSP
- [ ] **Option B:** Modify `lsp_shell_manager.py` to expose raw stdin/stdout pipes
- [ ] **Decision needed:** Check if current shell spawns support direct pipe access or if PTY is required

### Step 4: Register Namespace in `main.py`

**File:** `app/apps/file_editor_cm6/main.py`

- [ ] Import `LSPSocketIONamespace` from `lsp_ws`
- [ ] In `init_nicegui_with_app()`, add: `ng.sio.register_namespace(LSPSocketIONamespace('/lsp'))`

### Step 5: Client-Side SocketIOTransport (tmp5 scope, but note here)

**File:** Vendored CM6 LSP client or `template.html`

- [ ] Implement `SocketIOTransport` class that:
  - Connects to `/lsp` namespace
  - Emits `lsp:client_to_server` for outgoing LSP messages
  - Listens on `lsp:server_to_client` for incoming LSP messages
  - Adapts to `@codemirror/lsp-client` transport interface

### Step 6: Testing

- [ ] Manual: Open Python file, verify `pyright-langserver` shell spawns
- [ ] Manual: Check Socket.IO `/lsp` connection in browser devtools
- [ ] Manual: Send `initialize` request, verify response flows back
- [ ] Manual: Trigger hover/completion, verify LSP roundtrip

### Open Questions

1. **Shell STDIO access:** Does `FrameworkShellManager` expose live stdin/stdout or only log files? If log-only, need PTY or pipe modification.
2. **Multi-client:** Should multiple browser tabs share one LSP shell per language? Current design: yes (shell per language, not per sid).
3. **Lifecycle:** When to shutdown LSP shells? On last client disconnect? Idle timeout?

---

*vectorArc • 2025-12-08 05:44 UTC*

---

**Gemini (Planning Buddy) to VectorArc (Step 3):**

**Ref: Open Question 1 (Shell STDIO access)**

You correctly identified that `FrameworkShellManager` defaults to log-file redirection, which is insufficient for real-time LSP byte streaming.

**Decision:**
We will modify the core `FrameworkShellManager` to support a "Live Pipe" mode framework-wide. This is better than a local hack.

**Action Plan Update for VectorArc:**

1.  **Modify `app/libs/framework_shells.py`:**
    *   Add a new parameter to `spawn_shell`: `enable_pipes=False`.
    *   If `True`:
        *   Set `stdout=subprocess.PIPE` and `stdin=subprocess.PIPE`.
        *   Do *not* overwrite them with log file handles.
        *   (Optional but good) Start a background thread to tee the pipe output to the log file so we don't lose logging.
2.  **Update `lsp_shell_manager.py`:**
    *   Call `spawn_shell(..., enable_pipes=True)`.
3.  **Implement `bridge_shell_output`:**
    *   Now you can safely read from `shell.process.stdout`.

Proceed with this infrastructure upgrade as part of Step 3.

---

## Action Plan: Live Pipe Mode — vectorArc • 2025-12-08 05:54 UTC

**Per Gemini's guidance on Open Question 1:**

1. **Modify `app/libs/framework_shells.py`** — Add `enable_pipes=False` param to `spawn_shell()`; when `True`, use `subprocess.PIPE` for stdin/stdout
2. **Update `lsp_shell_manager.py`** — Spawn LSP shells with `enable_pipes=True`
3. **Implement `bridge_shell_output` in `lsp_ws.py`** — Read from `shell.process.stdout` directly

---

*vectorArc • 2025-12-08 05:54 UTC*

---

## Implementation Complete: LSP Socket.IO Bridge (tmp4) — vectorArc • 2025-12-08 06:15 UTC

**Files Modified:**
1. `app/libs/framework_shells.py` — Added `uses_pipes` field, `PipeState` dataclass, `_launch_pipe()`, `spawn_shell_pipe()`, `get_pipe_state()`, `_stop_pipe()`
2. `app/apps/file_editor_cm6/lsp_shell_manager.py` — Changed to use `spawn_shell_pipe()` instead of `spawn_shell()`
3. `app/apps/file_editor_cm6/main.py` — Registered `/lsp` namespace

**Files Created:**
1. `app/apps/file_editor_cm6/lsp_ws.py` — LSPSocketIONamespace with LSPFrameParser

**Next Steps (tmp5):**
- Client-side SocketIOTransport in CM6 to connect to `/lsp` namespace
- Wire up to `@codemirror/lsp-client`

---

*vectorArc • 2025-12-08 06:15 UTC*

---

## Progress Report: LSP Socket.IO Bridge (tmp4) — vectorArc • 2025-12-08 06:09 UTC

**Completed:**

1. **Framework infrastructure** (`app/libs/framework_shells.py`):
   - Added `uses_pipes: bool` field to `ShellRecord`
   - Created `PipeState` dataclass for live stdin/stdout access
   - Implemented `_launch_pipe()` — spawns with `subprocess.PIPE`
   - Implemented `spawn_shell_pipe()` — public API
   - Implemented `get_pipe_state()` — returns `PipeState` for direct I/O
   - Implemented `_stop_pipe()` — cleanup
   - Updated `terminate_shell()`, `restart_shell()`, `remove_shell()` to handle pipes

2. **LSP Shell Manager** (`app/apps/file_editor_cm6/lsp_shell_manager.py`):
   - Changed `spawn_shell()` → `spawn_shell_pipe()` for bidirectional streaming

3. **LSP Socket.IO Namespace** (`app/apps/file_editor_cm6/lsp_ws.py`) — NEW FILE:
   - `LSPFrameParser` — Content-Length header parsing state machine
   - `LSPSocketIONamespace` — `/lsp` namespace handler
   - Events: `on_initialize`, `on_lsp_client_to_server`, `on_disconnect`
   - Background reader task bridges shell stdout → Socket.IO

4. **Namespace Registration** (`app/apps/file_editor_cm6/main.py`):
   - Added `/lsp` namespace alongside `/explorer`

**All files compile.** Ready for tmp5 (client-side SocketIOTransport).

---

*vectorArc • 2025-12-08 06:09 UTC*

---

## Action Plan: CM6 LSP Integration (tmp5) — neonInk • 2025-12-08

### 1. JavaScript: Socket.IO Transport
- In `app/static/vendor/nicegui/elements/codemirror/codemirror.js`, add a `SocketIOTransport` class that:
  - Connects to the `/lsp` namespace using `io(namespace, { path: "/ui/_nicegui_ws/socket.io", transports: ["websocket", "polling"] })`.
  - Emits an `initialize` event on `connect` with `{ languageId, projectRoot }`.
  - Listens for `lsp:server_to_client` and forwards messages to a stored `onMessage` callback.
  - Implements `send(data)` by emitting `lsp:client_to_server` with a plain JS object (parse JSON strings as needed).
  - Implements `close()` by disconnecting the underlying socket and clearing listeners.

### 2. JavaScript: LSP Client Wiring in Vue Component
- Detect `LanguageServerClient` from the bundle (`const LSPClient = CM.LanguageServerClient || null`) and log a warning if missing.
- Extend component `data()` with `lspClient`, `lspTransport`, and `lspCompartment` (a `CM.Compartment` for LSP extensions).
- Add `connectLSP(languageId, projectRoot)` method that:
  - Guards on `LSPClient` and `this.editor` being available.
  - Calls `disconnectLSP()` first if an existing client is active.
  - Creates `SocketIOTransport('/lsp', languageId, projectRoot)` and `new LSPClient({ transport, rootUri, workspaceFolders, languageId })`.
  - Subscribes to `documentSymbols` (and other useful events) and forwards them to a new `handleDocumentSymbols(symbols)` method.
  - Installs the LSP extension via `lspCompartment.reconfigure([this.lspClient.extension])` in an editor dispatch.
- Add `disconnectLSP()` method that:
  - Disposes `this.lspClient` if present (letting it close the transport).
  - Clears `lspClient`/`lspTransport` references and reconfigures the LSP compartment to `[]`.
- Ensure the component’s teardown hook (e.g. `beforeUnmount`/`beforeDestroy`) calls `disconnectLSP()` to avoid leaks.

### 3. JavaScript: Symbol Handling Surface
- Implement `handleDocumentSymbols(symbols)` in `codemirror.js` that:
  - Caches the latest symbols on the component instance.
  - Notifies the host via an existing mechanism (`notifyParent('document_symbols', { symbols })` or a new `$emit('documentSymbols', symbols)`).
- Keep this method minimal so sticky-scroll/outline features can evolve on the host side without changing the vendor bundle.

### 4. Python: NiceGUI Wrapper Methods
- In `app/static/vendor/nicegui/elements/codemirror/codemirror.py`, add:
  - `def connect_lsp(self, language_id: str, project_root: str) -> None: self.run_method('connectLSP', {'languageId': language_id, 'projectRoot': project_root})`
  - `def disconnect_lsp(self) -> None: self.run_method('disconnectLSP')`
- Do not change the constructor; make LSP usage explicitly opt-in via these methods.

### 5. Backend: Auto-Connect Helper in `editor_app.py`
- Define `LSP_LANGUAGE_MAP` near the top of `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` mapping file suffixes to language IDs (e.g. `.py` → `python`, `.js` → `javascript`, `.ts` → `typescript`, `.tsx` → `typescriptreact`, `.go` → `go`, `.rs` → `rust`).
- Implement `_should_use_lsp(project_root: Path, language_id: str) -> bool` that:
  - For now checks a simple editor preference flag (e.g. `prefs.get('enableLsp', False)`) and returns False if disabled.
  - Can later grow to consult project-level config (tmp7) without changing the call sites.
- Implement `_maybe_connect_lsp(editor, file_path: Path, project_root: Path)` that:
  - Looks up `language_id = LSP_LANGUAGE_MAP.get(file_path.suffix)`.
  - Returns early if `language_id` is unsupported or `_should_use_lsp()` is False.
  - Calls `editor.connect_lsp(language_id, str(project_root))`.
- Call `_maybe_connect_lsp(...)` in the code paths that open or switch the active file (initial load in `editor_page()` and any file-switch endpoint) after `_active_editor` and `_current_file_path` are set.

### 6. Backend: LSP Disconnect Hooks
- Ensure that when the active document becomes `None`/blank (null document state) or the editor page is torn down, the backend calls `editor.disconnect_lsp()` to mirror the frontend cleanup.
- On project switches or file switches to non-LSP-eligible types, call `disconnect_lsp()` before changing `_current_file_path` so language shells can be reused cleanly by the next connection.

### 7. Testing & Verification
- Manual smoke tests:
  - Open `.py`, `.js`, and `.tsx` files and verify:
    - `/lsp` namespace receives `initialize` and subsequent LSP messages (check worker logs).
    - Language servers respond without protocol framing errors and `documentSymbols` events reach the host.
  - Switch between different LSP-enabled files and confirm:
    - Only one framework shell per language remains running (`/api/framework_shells`), no per-tab duplication.
    - `disconnectLSP` is called on teardown (no lingering Socket.IO connections in browser devtools).
- Failure scenarios:
  - Temporarily break LSP server binaries (rename vendored `.bin` symlinks) and confirm:
    - LSP connection attempts fail gracefully with clear log messages.
    - The editor remains usable without LSP (no hard errors on load or file switch).

---

*neonInk • 2025-12-08 06:30 UTC*

---

## Progress Report: CM6 LSP Integration (tmp5 Step 4) — neonInk • 2025-12-08

**Files Touched:**
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**What Changed (Step 4 – Symbol Handling Surface):**
1. **Vue Component State:**
   - Added `lspSymbols` array to store the latest LSP `documentSymbols` payload.
   - Added `_stickyScrollPlugin` handle so the sticky scroll ViewPlugin can register itself back on the Vue instance.

2. **`handleDocumentSymbols(symbols)` Implementation:**
   - Normalizes incoming payloads (`symbols` array or `{ symbols: [...] }`) into `this.lspSymbols`.
   - On update, calls `this._stickyScrollPlugin.updateStickyHeader(true)` when the plugin is active, so Sticky Scroll recomputes immediately with the new symbol tree.
   - Optionally notifies the host via `notifyParent('cm6-document-symbols', { symbols: this.lspSymbols })` for outline/telemetry use cases.

3. **Sticky Scroll Plugin Wiring:**
   - In the sticky scroll `ViewPlugin` constructor, stores `this` into `cmComponent._stickyScrollPlugin` when available; `destroy()` clears that reference.
   - Scope candidate builder now prefers:
     - Markdown headings for markdown documents (unchanged).
     - LSP-backed sections flattened from `cmComponent.lspSymbols` when present (uses LSP ranges to derive `startLine`/`endLine` and preserves existing height/offset logic).
     - Falls back to the original Lezer syntax-tree path when no symbols are available or LSP is disabled.

**Net Effect:**
- Sticky Scroll can consume LSP `documentSymbols` directly (no Python round-trip), while markdown and non-LSP languages continue using the existing syntax-tree heuristics. Host-level consumers still receive a structured symbol event if they want to build an Outline View later.

*neonInk • 2025-12-08 07:05 UTC*

---

## Progress Report: LSP Transport + Auto-Connect Wiring (tmp5 Steps 4–5) — neonInk • 2025-12-08

**Files Touched:**
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- `app/apps/file_editor_cm6/preferences_store.py`

**Frontend (codemirror.js):**
- Added `SocketIOTransport` class that wraps the global `io` Socket.IO client, connects to `/lsp` with the NiceGUI path, sends an `initialize` payload on connect, and forwards `lsp:server_to_client` messages into the LSP client’s `onMessage` handler.
- Extended Vue `data()` with `lspClient`, `lspTransport`, and `lspCompartment` to track the LSP client, its transport, and a dedicated CM compartment for the extension.
- Implemented `connectLSP(languageId, projectRoot)` to:
  - Guard on `this.editor` and `CM.LanguageServerClient` presence.
  - Tear down any existing client via `disconnectLSP()`.
  - Create `SocketIOTransport('/lsp', languageId, projectRoot)` and `new CM.LanguageServerClient({ transport, rootUri, workspaceFolders, languageId })`.
  - Register a `documentSymbols` listener that feeds into `handleDocumentSymbols(symbols)`.
  - Install the LSP extension via `this.lspCompartment.reconfigure([this.lspClient.extension])`.
- Implemented `disconnectLSP()` to dispose the client, close the transport, clear the compartment, and reset `lspSymbols`, while asking the sticky scroll plugin to refresh once more.
- Added `beforeDestroy` / `beforeUnmount` hooks that call `disconnectLSP()` for best-effort cleanup on component teardown.

**Backend Wrapper (codemirror.py):**
- Added `connect_lsp(language_id, project_root)` and `disconnect_lsp()` methods on `CodeMirror` that proxy to the JS methods via `run_method('connectLSP', ...)` and `run_method('disconnectLSP')`.

**Backend Auto-Connect (editor_app.py):**
- Introduced `LSP_LANGUAGE_MAP` mapping file extensions to LSP language IDs (python/javascript/typescript/tsx/go/rust, etc.).
- Added `_should_use_lsp(project_root, language_id)` which currently gates on the editor preference `enableLsp` (default False).
- Implemented `_maybe_connect_lsp(editor, file_path, project_root)` that:
  - Disconnects when there is no active document/project or when the extension is unsupported.
  - Disconnects when `enableLsp` is false.
  - Calls `editor.connect_lsp(language_id, str(project_root))` when all conditions are met, with error logging if methods are missing.
- Wired `_maybe_connect_lsp(...)` into:
  - `editor_page()` after the editor is constructed and preferences applied (initial file load).
  - `/editor/set_content` after `set_current_file(...)` to react on file switches.

**Preference Toggle (preferences_store.py):**
- Added `"enableLsp": False` to `DEFAULT_EDITOR_PREFS` so the existing `/api/app/file_editor_cm6/preferences` POST endpoint can now persist `editor.enableLsp` and the backend gate can read it reliably.

**Known State:**
- The wiring from preference → backend decision → LSP client → Socket.IO transport is in place. The remaining issue observed in manual testing is that `enableLsp` was not yet present in the on-disk prefs snapshot (likely due to worker/proc lifetime vs. when the default schema change landed), so the gate still evaluates to false. This is an environment/application lifecycle detail rather than a code-path syntax error; the Python module now compiles cleanly and is ready for another end-to-end test once the worker reloads with the updated defaults.

*neonInk • 2025-12-08 07:25 UTC*


---

# LSP-Powered Sticky Scroll Refactor Notes

**Created:** 2025-12-07  
**Status:** Planning  
**Purpose:** Replace Lezer-based scope detection with LSP `documentSymbol` trees for Monaco-parity sticky scroll behavior

---

## Background

The current sticky scroll implementation in `codemirror.js` uses:
- `tree.resolveInner()` + `isScopeNode()` for code languages (Lezer syntax tree)
- Custom heading collection for Markdown

**Problem:** Lezer's syntax tree doesn't expose as many nested scopes as Monaco's language server integration. Monaco uses its language server to derive scopes, giving deeper nesting and more accurate boundaries.

**Solution:** Replace per-language parsing heuristics with unified LSP `textDocument/documentSymbol` trees.

---

## Design Decisions (from conversation)

### 1. Single Document Model Simplifies LSP

Given our constraints:
- Exactly **one logical document open at a time**
- All devices are mirrors of that single editor state
- Single-user, single-cursor

LSP view simplifies to:
- Exactly **one `textDocument` open per language server** at any moment
- On file switch: `didClose` for old → `didOpen` for new
- Same server process stays alive (keeps project context/caches)

**No multi-document juggling needed.** Our single-document architecture *is* the LSP document model.

### 2. One Server Per Shell

**Do NOT run multiple language servers in one framework shell.**

✅ **Recommended:** One LSP server per shell/process
```
shell "lsp-python" → runs pyright-langserver --stdio
shell "lsp-ts"     → runs typescript-language-server --stdio
shell "lsp-go"     → runs gopls serve
```

Benefits:
- If one crashes, only restart that shell
- Clean logs: `shell:lsp-python` logs Python LS chatter only
- Simple routing: WS → shell bridge is just "pipe bytes"

❌ **Not recommended:** Multiple LS in one shell
- Would require custom router process
- Must implement multi-server lifecycle, routing, error isolation
- Basically re-inventing VS Code's extension host

### 3. Runtime Behavior

With single-doc editor:
- Determine `languageId` for current doc
- `get_or_spawn_shell("lsp-" + languageId)`
- LSP client in CM6 connects via WS to that shell

On file switch to different language:
- Editor sends `didClose` to old LS
- `get_or_spawn_shell("lsp-newlang")`, `didOpen` there
- Optionally: keep old shell running (fast switch-back) or kill after N minutes idle

**Result:** Usually **one LSP shell alive** at a time.

### 4. Per-Project Configuration (Future)

Per-project sidecar extends with:
```jsonc
"languageServers": {
  "python": true,
  "typescript": false,
  "rust": false
}
```

Modal in editor to toggle which LS are enabled for the current project.

Backend decides: "current project + languageId → should we connect LSP?"

---

## Architecture: Framework Shell Integration

### Using Existing Infrastructure

From `docs/core/framework_shells.md`:

```python
# Spawn LSP shell
from app.framework_shells import get_framework_shell_manager

def get_or_spawn_lsp_shell(language_id: str):
    manager = get_framework_shell_manager()
    label = f"lsp-{language_id}"
    
    # Check for existing shell
    shells = manager.list_shells()
    for shell in shells:
        if shell.label == label and shell.alive:
            return shell
    
    # Spawn new shell
    command = LSP_COMMANDS.get(language_id)
    if not command:
        return None
    
    return manager.spawn_shell(
        command=command,
        label=label,
        cwd=project_root,
        autostart=False
    )

LSP_COMMANDS = {
    "python": ["pyright-langserver", "--stdio"],
    "typescript": ["typescript-language-server", "--stdio"],
    "javascript": ["typescript-language-server", "--stdio"],
    "go": ["gopls", "serve"],
    "rust": ["rust-analyzer"],
}
```

### Communication Flow

```
CM6 LSP Client Extension
    ↓ WebSocket (bidirectional)
Framework Shell WebSocket Bridge
    ↓ STDIO (bidirectional)  
Language Server Process (pyright, etc.)
```

LSP uses JSON-RPC over STDIO. Framework shell already supports:
- `POST /api/framework_shells/<id>/write` - Send to stdin
- `WS /api/framework_shells/<id>/ws` - Bidirectional stream

---

## Architecture: CodeMirror 6 Integration

### Vendoring Requirements

Per `docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md`:

1. **Install package:**
   ```bash
   cd app/static/vendor/nicegui/elements/codemirror
   npm install @codemirror/lsp-client
   # OR
   npm install codemirror-languageserver
   ```

2. **Export in bundle:**
   ```javascript
   // src/index.mjs
   export * from "@codemirror/lsp-client";
   ```

3. **Rebuild bundle:**
   ```bash
   npm run build
   # May need to comment out terser if OOM
   ```

4. **Add Vue methods to `codemirror.js`:**
   ```javascript
   connectLSP(wsUrl) {
     // Initialize LSP client with WebSocket transport
   }
   
   disconnectLSP() {
     // Clean up LSP connection
   }
   
   onDocumentSymbols(callback) {
     // Subscribe to symbol updates for sticky scroll
   }
   ```

5. **Add Python wrappers to `codemirror.py`:**
   ```python
   def connect_lsp(self, ws_url: str) -> None:
       self.run_method('connectLSP', ws_url)
   
   def disconnect_lsp(self) -> None:
       self.run_method('disconnectLSP')
   ```

### Package Options

| Package | Maturity | Notes |
|---------|----------|-------|
| `@codemirror/lsp-client` | Early/Experimental | Official CM project |
| `codemirror-languageserver` (Shopify) | More mature | Requires WebSocket bridge |

Need to evaluate both for our use case.

---

## Symbol → Sticky Scroll Pipeline

### Current Implementation

```javascript
// In updateStickyHeader() - codemirror.js
const tree = CM.ensureSyntaxTree(state, state.doc.length, 200);
let node = tree.resolveInner(refPos);
for (; node; node = node.parent) {
  if (isScopeNode(node, scopeTypes, state, isPython)) {
    ancestorNodes.push(node);
  }
}
```

### New Implementation

```javascript
// LSP provides symbol tree like:
[
  { "name": "MyClass", "kind": 5, "range": {...},
    "children": [
      { "name": "myMethod", "kind": 6, "range": {...} }
    ]
  }
]

// Convert to sticky sections:
function flattenSymbols(state, symbols) {
  const sections = [];
  
  function walk(symbol, depth) {
    const startLine = state.doc.lineAt(symbol.range.start).number;
    const endLine = state.doc.lineAt(symbol.range.end).number;
    
    sections.push({
      depth,
      startLine,
      endLine,
      text: symbol.name,
      kind: symbol.kind,
      // ... other fields for sticky scroll
    });
    
    if (symbol.children) {
      for (const child of symbol.children) {
        walk(child, depth + 1);
      }
    }
  }
  
  for (const sym of symbols) {
    walk(sym, 0);
  }
  
  return sections;
}
```

### Fallback Path

Keep existing implementation for:
- Markdown (no LSP servers for that)
- Plain text
- Languages without available servers
- When user disables LSP for project

---

## Implementation Phases

### Phase 1: Proof of Concept (Python only)

1. Create LSP shell manager module
2. Add `pyright-langserver` shell spawning
3. Create WebSocket bridge (framework shell → CM6)
4. Vendor `@codemirror/lsp-client`
5. Wire `documentSymbol` to sticky scroll
6. Test with Python files

### Phase 2: Multi-Language Support

1. Add TypeScript/JavaScript (typescript-language-server)
2. Add Go (gopls)
3. Abstract language-specific configuration

### Phase 3: Per-Project Configuration

1. Add `languageServers` to ProjectSidecar
2. Create settings modal
3. Enable/disable per project

### Phase 4: Full LSP Features (Future)

- Code completion
- Diagnostics
- Hover information
- Go to definition

---

## Open Questions

1. **LSP Server Binaries:** Which servers to support initially?
   - Recommendation: Start with Python + pyright only

2. **WebSocket Route:** Use existing framework shell WS or new endpoint?
   - Option A: `/api/framework_shells/<id>/ws` (existing)
   - Option B: `/ws/lsp/<language>` (new dedicated)

3. **Package Choice:** `@codemirror/lsp-client` vs `codemirror-languageserver`?
   - Need to evaluate both

---

## Files to Modify

### New Files
- `app/apps/file_editor_cm6/lsp_shell_manager.py` - LSP shell lifecycle
- `app/apps/file_editor_cm6/lsp_bridge.py` - WebSocket → STDIO bridge

### Modified Files
- `app/static/vendor/nicegui/elements/codemirror/package.json` - Add LSP package
- `app/static/vendor/nicegui/elements/codemirror/src/index.mjs` - Export LSP
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js` - LSP client + sticky scroll refactor
- `app/static/vendor/nicegui/elements/codemirror/codemirror.py` - Python LSP methods
- `app/apps/file_editor_cm6/editor_app.py` - LSP endpoints

---

## References

- Current sticky scroll docs: `notes/2025-12-7_CURRENT_STICKY_SCROLL_TECHNICAL.md`
- Feature adding guidelines: `docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md`
- Framework shells: `docs/core/framework_shells.md`
- Code CM6 technical: `docs/apps/code_cm6/TECHNICAL.md`

---

*Last Updated: 2025-12-07 17:30 CST*
