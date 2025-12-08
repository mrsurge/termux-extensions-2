# LSP WebSocket Bridge

**Created:** 2025-12-07  
**Status:** Not Started  
**Depends On:** LSP Shell Manager (tmp2)  
**Blocks:** CM6 LSP Integration (tmp5)

---

## Purpose

Bridge WebSocket connections from CM6 LSP client to framework shell STDIO.

---

## Scope

- WebSocket endpoint for LSP communication
- Bidirectional JSON-RPC message routing
- Shell STDIO ↔ WebSocket translation
- Connection lifecycle management

---

## Architecture

```
CM6 LSP Client Extension
    ↓↑ WebSocket (JSON-RPC)
LSP WebSocket Endpoint
    ↓↑ Framework Shell API
Framework Shell (lsp-python)
    ↓↑ STDIO
Language Server (pyright)
```

---

## Options

### Option A: Use Existing Framework Shell WebSocket

```python
# Already exists: /api/framework_shells/<id>/ws
# CM6 connects directly to shell WebSocket
ws_url = f"/api/framework_shells/{shell.id}/ws"
```

Pros: No new code needed on backend
Cons: CM6 needs shell ID, raw byte stream

### Option B: Dedicated LSP Endpoint

```python
# New: /ws/lsp/<language>
@app.websocket("/ws/lsp/{language}")
async def lsp_websocket(websocket: WebSocket, language: str):
    shell = get_or_spawn_lsp_shell(language, project_root)
    # Bridge websocket ↔ shell.stdin/stdout
```

Pros: Clean API, handles shell lifecycle
Cons: New endpoint to maintain

---

## Recommended: Option B

The dedicated endpoint:
- Handles shell spawning automatically
- Abstracts shell ID from frontend
- Can add LSP-specific protocol handling

---

## Key Implementation

```python
# app/apps/file_editor_cm6/lsp_bridge.py

async def lsp_websocket_handler(websocket: WebSocket, language: str):
    await websocket.accept()
    
    # Get or spawn shell
    shell = get_or_spawn_lsp_shell(language, get_project_root())
    if not shell:
        await websocket.close(4001, f"No LSP for {language}")
        return
    
    # Bidirectional bridge
    async def shell_to_ws():
        async for chunk in shell.stdout_stream():
            await websocket.send_bytes(chunk)
    
    async def ws_to_shell():
        async for msg in websocket.iter_bytes():
            shell.write_stdin(msg)
    
    await asyncio.gather(shell_to_ws(), ws_to_shell())
```

---

## Files to Create/Modify

- **NEW:** `app/apps/file_editor_cm6/lsp_bridge.py`
- **MODIFY:** `app/apps/file_editor_cm6/main.py` (mount WS endpoint)

---

## Testing

1. Start LSP shell manually
2. Connect WebSocket client (wscat)
3. Send LSP initialize request
4. Verify response received

---

*Last Updated: 2025-12-07*
