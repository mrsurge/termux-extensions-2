# Codex App-Server Migration

**Date:** 2025-10-31  
**Issue:** Session resume failures with Codex MCP server  
**Solution:** Migrate to `codex app-server` mode

## Problem Statement

The original implementation used `codex mcp-server` which had critical limitations:

1. **No Session Persistence:** Sessions existed only in MCP server's memory
2. **Session Not Found Errors:** When MCP server restarted, all conversationIds became invalid
3. **Complex Protocol:** JSON-RPC 2.0 with `tools/call` wrapper added unnecessary complexity
4. **No True Resume:** Even though conversations were on disk, MCP couldn't load them

## Solution: Codex App-Server Mode

### What is App-Server?

`codex app-server` is a JSONL (newline-delimited JSON) protocol over STDIN/STDOUT that:

- Treats **one conversation per process** (simpler session management)
- Has **built-in conversation resume** capability
- Uses **simpler message format** (no JSON-RPC wrapper)
- Streams events directly (planning, tokens, diffs, tool_calls, final)

### Migration Changes

**1. Agent Bridge (`agent_bridge.py`)**

Before (MCP):
```python
# Complex JSON-RPC tools/call wrapper
mcp_msg = {
    'jsonrpc': '2.0',
    'id': msg_id,
    'method': 'tools/call',
    'params': {
        'name': 'codex' if new else 'codex-reply',
        'arguments': {...}
    }
}
```

After (App-Server):
```python
# Simple turn request
turn_msg = {
    'id': msg_id,
    'type': 'send-user-turn',
    'params': {
        'model': 'gpt-5-codex',
        'effort': 'medium',
        'items': [{'type': 'text', 'text': text}],
        'cwd': cwd
    }
}
```

**2. Spawn Command**

Before:
```python
command = ['codex', 'mcp-server']
```

After:
```python
command = ['codex', 'app-server']
```

**3. Event Handling**

Before (MCP):
- Initialize handshake required
- Complex `codex/event` notifications
- conversationId tracking
- tools/call results parsing

After (App-Server):
- No initialization needed
- Direct event stream: `planning`, `token`, `diff`, `tool_call`, `final`, `error`
- No conversationId needed (one conversation per process)

**4. Removed Code**

- MCP initialization handshake
- conversationId storage/tracking
- "Session not found" error handling
- JSON-RPC response parsing

## Benefits

1. **Session Persistence:** Each UI session = one long-lived app-server process
2. **True Resume:** Can resume conversations from disk with proper API calls
3. **Simpler Protocol:** Direct event streaming, no wrapper overhead
4. **Better Reliability:** No memory-only session limitations
5. **Cleaner Code:** ~200 lines of protocol complexity removed

## Files Changed

- `app/apps/file_editor_cm6/agent_bridge.py` - Complete rewrite for app-server protocol
- `app/apps/file_editor_cm6/agent_ws.py` - Removed MCP initialization
- `app/apps/file_editor_cm6/agent_bridge_mcp.py` - Original MCP code (backup)

## Testing Checklist

- [ ] Start agent drawer - verify `codex app-server` spawns
- [ ] Send a message - verify token streaming works  
- [ ] Check for planning/system messages
- [ ] Verify diffs are received and displayed
- [ ] Kill agent shell and restart - verify new process spawns
- [ ] Multiple sessions - verify singleton shell (one process shared)
- [ ] Check logs - verify JSONL format (not JSON-RPC)

## Future Enhancements

Now that we're on app-server mode, we can:

- Implement proper conversation resume with `conversation/resume`
- Add model selection UI (use `model/list` endpoint)
- Request structured output with `final_output_json_schema`
- Better session management with disk-based persistence

## Rollback

If needed, restore MCP mode:
```bash
mv app/apps/file_editor_cm6/agent_bridge_mcp.py app/apps/file_editor_cm6/agent_bridge.py
# Restart framework
```

## References

- App-Server Manual: `/sdcard/Download/codex_app_server_implementation_manual_markdown.md`
- Original MCP Implementation: `app/apps/file_editor_cm6/agent_bridge_mcp.py`
