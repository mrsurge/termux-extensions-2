# Agent Drawer MCP Initialization Bug Analysis

**Date:** 2025-11-08  
**Severity:** CRITICAL - Blocks all agent communication  
**Symptom:** First tool call (initialize) works, but subsequent tool calls fail completely

---

## Problem Summary

The agent drawer successfully spawns the Codex MCP shell and sends the `initialize` method, but all subsequent user messages fail to reach the agent. The system appears to hang with no responses.

**What Works:**
- Shell spawns successfully
- PTY connection established
- `initialize` method sent and acknowledged
- WebSocket connection established
- Frontend can send messages

**What Breaks:**
- User messages never reach the Codex MCP server
- No response from agent
- No error messages
- System appears frozen

---

## Root Cause Analysis

### Primary Bug: Variable Shadowing in Initialization Block

**Location:** `app/apps/file_editor_cm6/agent_ws.py` line 257

**The Code:**
```python
# Line 242-260: Initialize MCP for Codex once per shell lifetime
if agent_type == 'codex' and shell_id and shell_id not in _initialized_shells:
    try:
        init_msg = {
            'jsonrpc': '2.0',
            'id': 'init-mcp',
            'method': 'initialize',
            'params': {
                'protocolVersion': '2024-11-05',
                'capabilities': {},
                'clientInfo': {
                    'name': 'code_cm6',
                    'version': '1.0.0'
                }
            }
        }
        shell_id = bridge._sessions.get(session_id)  # ❌ BUG HERE
        if shell_id:
            await manager.write_to_pty(shell_id, json.dumps(init_msg) + '\n')
            _initialized_shells.add(shell_id)
    except Exception as e:
        print(f'Failed to initialize Codex MCP: {e}')
```

**The Bug:**
```python
shell_id = bridge._sessions.get(session_id)  # Line 257
```

This line OVERWRITES the `shell_id` variable that was carefully set up in the shell discovery/spawn logic above (lines 147-210).

**Why This Breaks Everything:**

### Scenario 1: First Connection (New Shell)

**Before initialization block:**
```python
# Lines 199-210: Spawn new shell
shell_id = shell_info['id']  # e.g., "fs_1234567890_abcd1234"
session_id = f'shared-{agent_type}-{uuid}'  # e.g., "shared-codex-a1b2c3d4"
bridge.attach_session(session_id, shell_id)  # Stores mapping
```

**During initialization block:**
```python
shell_id = bridge._sessions.get(session_id)  # Returns the SAME shell_id (works by accident)
await manager.write_to_pty(shell_id, init_msg)  # ✓ Works
```

**Result:** Initialize succeeds because `bridge._sessions` was just populated.

**After initialization:**
```python
# User sends first message
await bridge.write_message(session_id, 'codex', message, context)
```

Inside `bridge.write_message()`:
```python
shell_id = self._sessions.get(session_id)  # ✓ Found
await manager.write_to_pty(shell_id, encoded)  # ✓ Works
```

**Why it still works:** The `session_id` used during initialization matches the one used for messages.

---

### Scenario 2: Reconnection (Existing Shell)

**Before initialization block:**
```python
# Lines 155-162: Found existing shell by label
existing_shell = await manager.find_shell_by_label("agent-codex-shared-c")
shell_id = existing_shell.id  # e.g., "fs_1234567890_abcd1234"

# If requested_session_id provided (from query param):
session_id = requested_session_id  # e.g., "session-abc123" (from UI)

# Otherwise:
if not session_id:
    cached = _shared_shells.get(agent_type)
    session_id = cached[0] if cached else f'shared-{agent_type}'

bridge.attach_session(session_id, shell_id)  # Stores mapping
```

**During initialization block:**
```python
# shell_id = "fs_1234567890_abcd1234"
# session_id = "session-abc123" (from frontend)

if shell_id not in _initialized_shells:  # True (shell reused, but not in set)
    shell_id = bridge._sessions.get(session_id)  # ❌ RETURNS None OR DIFFERENT ID
    
    # If session_id = "session-abc123":
    #   bridge._sessions = {"shared-codex-xyz": "fs_1234567890_abcd1234"}
    #   bridge._sessions.get("session-abc123") = None ❌
    
    if shell_id:  # False, so initialization SKIPPED
        await manager.write_to_pty(shell_id, init_msg)
```

**Result:** Initialization never sent! Shell not marked as initialized.

**After "initialization" (which didn't happen):**
```python
# User sends message
chat_session_id = "session-abc123"  # From frontend
await bridge.write_message(session_id, 'codex', message, context)

# Inside write_message():
shell_id = self._sessions.get(session_id)  # session_id = "shared-codex-xyz"?
# OR
shell_id = self._sessions.get(chat_session_id)  # chat_session_id = "session-abc123"?

# MISMATCH: The session_id used during "initialization" doesn't match
# the session_id used during message sending
```

**Result:** Either:
1. `shell_id` is None → KeyError or exception
2. `shell_id` is wrong shell → message sent to wrong/dead process
3. Message sent to uninitialized shell → Codex rejects (no initialize handshake)

---

## Session ID Confusion

There are THREE different session IDs in play:

1. **`requested_session_id`** - From WebSocket query param `?session=xxx`
   - This is the **UI session ID** (persistent, saved to disk)
   - Used for conversation restoration and message persistence

2. **`session_id`** (local variable in `agent_websocket()`)
   - Initially set to `requested_session_id` OR generated as `shared-{agent_type}-{uuid}`
   - This is the **bridge session ID** (maps to shell)
   - Used for `bridge.attach_session()` and `bridge.write_message()`

3. **`chat_session_id`** (extracted from incoming messages)
   - From `message.get('session')` field
   - This is the **conversation session ID** (for routing responses)
   - Used for persistence and conversation ID mapping

**The Problem:**
The initialization block uses `session_id` (bridge session ID) to look up the shell, but during message sending, the code might use `chat_session_id` or `requested_session_id`, causing a mismatch.

---

## Possible Failure Modes

### Mode 1: Shell ID Becomes None
```python
# Line 257
shell_id = bridge._sessions.get(session_id)  # Returns None

# Line 258
if shell_id:  # False, skip initialization
    await manager.write_to_pty(shell_id, init_msg)

# Later, user sends message:
await bridge.write_message(session_id, 'codex', message, context)

# Inside write_message:
shell_id = self._sessions.get(session_id)  # Still None or wrong ID
await manager.write_to_pty(shell_id, encoded)  # ❌ Fails with KeyError
```

### Mode 2: Wrong Shell ID
```python
# Initialization uses session_id = "shared-codex-abc"
# But message uses session_id = "session-user-123"

# bridge._sessions = {
#   "shared-codex-abc": "fs_111",
#   "session-user-123": "fs_222"  # Different shell!
# }

# Message sent to fs_222 (wrong shell or dead shell)
```

### Mode 3: Uninitialized Shell
```python
# Initialization skipped (shell_id became None)
# Shell not added to _initialized_shells

# Later messages sent to uninitialized Codex MCP server
# Codex MCP spec requires initialize before tool calls
# Codex rejects messages with error or ignores them
```

---

## Why This Worked in WSGI

**WSGI/Flask behavior:**
- Single worker process
- `bridge._sessions` persisted across all requests
- `_initialized_shells` persisted across all requests
- Once initialized, shell stayed initialized forever
- Session ID mismatches less likely (simpler flow)

**ASGI/Uvicorn behavior:**
- Multiple worker processes OR worker restarts
- `bridge._sessions` reset on worker restart
- `_initialized_shells` reset on worker restart
- Shell survives (framework shell in separate process)
- Reconnection path triggers bug (shell exists but not in `_initialized_shells`)

---

## The Fix

**Remove the variable shadowing. Use the `shell_id` that was already determined.**

**Current (BROKEN):**
```python
# Line 242-260
if agent_type == 'codex' and shell_id and shell_id not in _initialized_shells:
    try:
        init_msg = {...}
        shell_id = bridge._sessions.get(session_id)  # ❌ BUG
        if shell_id:
            await manager.write_to_pty(shell_id, json.dumps(init_msg) + '\n')
            _initialized_shells.add(shell_id)
    except Exception as e:
        print(f'Failed to initialize Codex MCP: {e}')
```

**Fixed (Option 1 - Remove redundant lookup):**
```python
# Line 242-260
if agent_type == 'codex' and shell_id and shell_id not in _initialized_shells:
    try:
        init_msg = {
            'jsonrpc': '2.0',
            'id': 'init-mcp',
            'method': 'initialize',
            'params': {
                'protocolVersion': '2024-11-05',
                'capabilities': {},
                'clientInfo': {
                    'name': 'code_cm6',
                    'version': '1.0.0'
                }
            }
        }
        # Use the shell_id we already have (don't look it up again)
        await manager.write_to_pty(shell_id, json.dumps(init_msg) + '\n')
        _initialized_shells.add(shell_id)
        print(f'[Agent WS] Initialized Codex MCP for shell {shell_id}')
    except Exception as e:
        print(f'[Agent WS] Failed to initialize Codex MCP: {e}')
        # Should we close the connection here?
```

**Fixed (Option 2 - Verify shell_id matches):**
```python
if agent_type == 'codex' and shell_id and shell_id not in _initialized_shells:
    try:
        init_msg = {...}
        
        # Verify our shell_id is actually registered
        registered_shell_id = bridge._sessions.get(session_id)
        if registered_shell_id != shell_id:
            print(f'[Agent WS] WARNING: shell_id mismatch! local={shell_id} registered={registered_shell_id}')
            # Re-register with correct mapping
            bridge.attach_session(session_id, shell_id)
        
        await manager.write_to_pty(shell_id, json.dumps(init_msg) + '\n')
        _initialized_shells.add(shell_id)
    except Exception as e:
        print(f'Failed to initialize Codex MCP: {e}')
```

**Recommended: Option 1** - Simpler, less code, `shell_id` is already validated by the time we reach this block.

---

## Additional Issues to Investigate

### Issue 1: Session ID Consistency
The code uses different session ID variables in different contexts. Need to clarify:
- When to use `session_id` (bridge session)
- When to use `requested_session_id` (UI session)
- When to use `chat_session_id` (message session)

Currently:
```python
# WebSocket connection uses session_id
bridge.attach_session(session_id, shell_id)

# Message sending might use different session_id
chat_session_id = message.get('session') or requested_session_id or session_id
await bridge.write_message(session_id, agent_type, message, context)  # Which session_id?
```

**Recommendation:** Use a single session ID throughout the WebSocket connection lifecycle. Map UI session IDs to bridge session IDs explicitly.

### Issue 2: Shell Reuse Without Initialization
When a shell is reused (found by label), it might already be initialized, but `_initialized_shells` is empty (worker restart). The code tries to initialize again.

**Current behavior:**
```python
if shell_id not in _initialized_shells:
    # Always tries to reinitialize on worker restart
```

**Problem:** Codex MCP spec might not allow re-initialization. Need to check if sending `initialize` twice causes issues.

**Possible solutions:**
1. Always send initialize (idempotent)
2. Persist `_initialized_shells` to disk
3. Check if shell responds to initialize (wait for response)

### Issue 3: No Response Handling for Initialize
The code sends the `initialize` message but never waits for the response. Codex MCP should send back a response with server capabilities.

**Current:**
```python
await manager.write_to_pty(shell_id, json.dumps(init_msg) + '\n')
_initialized_shells.add(shell_id)  # Immediately mark as initialized
```

**Problem:** If initialize fails (wrong protocol, shell not ready, etc.), the code doesn't know. Subsequent messages will fail.

**Fix:** Wait for initialize response before marking shell as initialized:
```python
await manager.write_to_pty(shell_id, json.dumps(init_msg) + '\n')
# DON'T mark as initialized yet

# In forward_agent_to_ws loop:
if normalized.get('event') == 'initialized' and normalized.get('id') == 'init-mcp':
    _initialized_shells.add(shell_id)
    print(f'[Agent WS] Codex MCP initialized successfully')
```

---

## Testing Recommendations

### Test 1: First Connection
1. Start framework
2. Open agent drawer (first time)
3. Send message "Hello"
4. **Expected:** Message sent, response received
5. **Verify:** Initialize sent before first message

### Test 2: Reconnection (Same Shell)
1. Start framework
2. Open agent drawer, send message
3. Close agent drawer (keep shell alive)
4. Reopen agent drawer
5. Send message "Hello again"
6. **Expected:** Message sent, response received
7. **Verify:** Initialize NOT sent again (already initialized)

### Test 3: Worker Restart (Shell Survives)
1. Start framework, open drawer, send message
2. Restart uvicorn worker (keep shell alive)
3. Reopen agent drawer
4. Send message "Hello after restart"
5. **Expected:** Initialize sent again (worker lost state)
6. **Verify:** Message reaches agent, response received

### Test 4: Multiple Sessions on Same Shell
1. Start framework
2. Open agent drawer in tab 1 (session A)
3. Open agent drawer in tab 2 (session B)
4. Send message in tab 1
5. Send message in tab 2
6. **Expected:** Both messages work, routed to correct conversations
7. **Verify:** Only one initialize sent (shared shell)

---

## Log Analysis

To diagnose this in production, add debug logging:

```python
# Before initialization block:
print(f'[Agent WS] PRE-INIT: session_id={session_id} shell_id={shell_id} bridge._sessions={bridge._sessions}')

# During initialization:
print(f'[Agent WS] INIT-START: agent={agent_type} shell_id={shell_id} initialized={shell_id in _initialized_shells}')
fetched_shell_id = bridge._sessions.get(session_id)
print(f'[Agent WS] INIT-FETCH: session_id={session_id} fetched={fetched_shell_id} match={fetched_shell_id == shell_id}')

# After initialization:
print(f'[Agent WS] INIT-DONE: shell_id={shell_id} marked_initialized={shell_id in _initialized_shells}')

# During message send:
print(f'[Agent WS] MSG-SEND: session_id={session_id} chat_session={chat_session_id} shell={shell_id}')
```

Look for:
- `shell_id` changing unexpectedly
- `fetched != match` (mismatch)
- `marked_initialized=False` when it should be True

---

## Summary

**Primary Bug:** Variable shadowing at line 257 causes `shell_id` to become None or incorrect, breaking all subsequent communication.

**Fix:** Remove the redundant `shell_id = bridge._sessions.get(session_id)` line. Use the `shell_id` already determined.

**Secondary Issues:**
- Session ID consistency across connection lifecycle
- No response handling for initialize
- Shell reuse without proper initialization tracking

**Impact:** CRITICAL - Completely blocks agent communication after first connection or worker restart.

**Estimated Fix Time:** 5 minutes (one line deletion + testing)

---

**Document Version:** 1.0  
**Date:** 2025-11-08  
**Priority:** P0 - CRITICAL
