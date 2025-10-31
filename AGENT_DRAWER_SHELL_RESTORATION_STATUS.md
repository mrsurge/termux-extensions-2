# Agent Drawer Shell Restoration - Current Status

**Date:** 2025-10-31  
**Issue:** Agent drawer reconnection loop / shell not connecting properly

---

## Current State

### What We're Trying to Achieve

1. **Single Shared Shell Per Agent Type**
   - ONE framework shell for Codex (label: `agent-codex-shared-c`)
   - Reuse existing shell across page reloads and worker restarts
   - Find shell by label using `find_shell_by_label()` from framework_shells

2. **Conversation History Restoration**
   - Track which framework shell each session used (`shell_id`)
   - Detect when shell changes (restart/crash)
   - Restore conversation history via `base-instructions` parameter
   - Include complete message history (not limited to last N turns)

### Implementation Details

#### Backend (`agent_ws.py`)
- Uses `find_shell_by_label('agent-codex-shared-c', status='running')` to find existing shell
- Spawns new shell only if none found
- Label format: `agent-{type}-shared-c` for shared shells

#### Backend (`agent_bridge.py`)
- `spawn_agent()` uses consistent label: `agent-{agent_type}-shared-c` 
- Command: `['codex', 'mcp-server']` (Rust CLI, not npm)
- Passes `base-instructions` parameter for history restoration
- Uses `spawn_shell_pty()` from framework_shells manager

#### Frontend (`agent_drawer.js`)
- Sessions store `shell_id` to track which framework shell was used
- On connect, compares current `shell_id` vs stored `shell_id`
- If different → sets `needsHistoryRestore` flag
- `buildHistoryContext()` creates complete conversation history
- Sends as `context.base_instructions` in message
- Clears dead shell state on load

### Current Problem

**Reconnection Loop:**
- Frontend attempting to reconnect repeatedly
- Shell may be dying immediately after spawn
- OR: WebSocket connection failing to establish
- OR: Shell spawned but connection not working

### What's Been Changed (Latest Session)

1. ✅ Added `shell_id` tracking to sessions
2. ✅ Implemented `buildHistoryContext()` for full conversation history
3. ✅ Added `base-instructions` parameter support
4. ✅ Updated shell lookup to use `find_shell_by_label()` first
5. ✅ Fixed label to be consistent: `agent-codex-shared-c`
6. ✅ Clear dead shell state on page load
7. ⚠️ **ISSUE:** Reconnection loop - need to diagnose

---

## Debug Steps Needed

1. **Check if shell is spawning:**
   ```bash
   curl http://localhost:8080/api/framework_shells
   ```
   Should show one shell with label `agent-codex-shared-c`

2. **Check shell logs:**
   ```bash
   # Find the shell ID first, then:
   curl 'http://localhost:8080/api/framework_shells/<id>?logs=true&tail=100'
   ```

3. **Check WebSocket connection:**
   - Browser console should show WebSocket messages
   - Look for connection errors or rejected connections

4. **Check if shell dies immediately:**
   - Shell might be crashing on startup
   - Check stderr logs for Codex errors

---

## Files Modified

- `app/apps/file_editor_cm6/agent_ws.py` - Added label-based shell lookup
- `app/apps/file_editor_cm6/agent_bridge.py` - Consistent labels, base-instructions
- `app/apps/file_editor_cm6/static/js/agent_drawer.js` - History restoration, shell tracking

---

## Next Steps

1. Diagnose reconnection loop:
   - Check framework shell status
   - Review shell stderr logs
   - Check WebSocket handshake

2. Possible fixes:
   - Shell dying immediately → check Codex MCP server startup
   - WebSocket failing → check agent_ws.py connection logic
   - Label mismatch → verify `find_shell_by_label()` working

3. Verify framework_shells usage:
   - Using `spawn_shell_pty()` correctly
   - Label format correct
   - Shell cleanup on errors

---

## Framework Shells Key Points

From `docs/core/framework_shells.md`:

- Manager: `app.libs.framework_shells._manager()`
- Spawn: `spawn_shell_pty(command, label=..., cwd=...)`
- Find: `find_shell_by_label(label, status='running')`
- Shells survive Flask reloads (`start_new_session=True`)
- Labels enable cross-restart discovery
- Max 5 concurrent shells by default

**Important:** Labels must be consistent and unique per agent type to enable proper reuse.
