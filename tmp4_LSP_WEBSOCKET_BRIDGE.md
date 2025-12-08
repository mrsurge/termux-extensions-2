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
