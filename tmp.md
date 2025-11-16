# Terminal Lifecycle Architecture Fix - Proposal

**Timestamp:** 2025-11-16T15:44:27.823Z  
**Status:** 📋 Proposal - Awaiting Implementation Approval  
**Issue:** Terminal shell not properly destroyed on close, causing blank screen on reopen

---

## Executive Summary

The terminal drawer has a lifecycle bug where clicking the X button doesn't properly destroy the shell, causing a blank screen when reopened. The root cause is frontend-managed async operations racing with user interactions. 

**Solution:** Make terminal lifecycle backend-dependent (like the editor), using cache presence as state and a single WebSocket message for destroy operations.

---

## Problem Statement

### Current Broken Behavior

1. User clicks X button on terminal
2. Terminal UI disappears
3. Backend shell stays alive (zombie state)
4. User reopens terminal
5. **Result:** Blank screen, but typing still inputs to zombie shell

### Technical Root Cause

**Frontend race condition:**
```javascript
// terminal.js line 426
closeBtn.addEventListener('click', destroy);  // ❌ No await!

async function destroy() {
  close();              // UI disappears
  term.dispose();       // xterm destroyed
  ws.close();          // WebSocket closes
  await destroyShell(); // ⚠️ Runs in background, may not complete
}
```

**Problems:**
- Event listener doesn't await async `destroy()`
- Multiple HTTP calls (DELETE + POST) can be interrupted
- WebSocket closes before backend destroy completes
- If user quickly reopens, old `shell_id` still in cache
- Backend reconnects to zombie shell with no frontend xterm instance

---

## Proposed Solution

### Architecture Change

**Current (Frontend-Managed):**
```
Frontend                    Backend
  |                           |
  |-- DELETE /terminal/id --> | (async)
  |-- POST /shell-id -------> | (async)
  |-- Close WebSocket ------> |
  └─ (User can reopen before backend completes)
```

**Proposed (Backend-Managed):**
```
Frontend                    Backend
  |                           |
  |-- WS: {"action":"destroy"} |
  |                           |-- terminate shell
  |                           |-- clear cache (atomic)
  |<-- WS: {"type":"destroyed"} |
  |<-- WS: close ------------ |
  └─ (Backend guarantees cleanup before close)
```

### State Management Philosophy

**Single source of truth:** `history_store.get_terminal_shell_id()`

| Cache State | Meaning | Action on Connect |
|------------|---------|------------------|
| `shell_id` exists | Terminal "open" | Check if shell alive → reconnect or create new |
| `shell_id` is `null` | Terminal "closed" | Create new shell in project dir |

**No extra flags needed!** The presence/absence of a running shell ID IS the state.

---

## Implementation Details

### Backend Changes

**File:** `app/apps/file_editor_cm6/terminal_backend.py`

**Location:** Line 262 (WebSocket input loop)

**Current code:**
```python
async for msg in websocket.iter_text():
    try:
        await mgr.write_to_pty(shell_id, msg)
    except Exception:
        pass
```

**Replace with:**
```python
async for msg in websocket.iter_text():
    # Check if this is a command message
    try:
        data = json.loads(msg)
        if isinstance(data, dict) and data.get('action') == 'destroy':
            print(f"[Terminal WS] Received destroy command for shell {shell_id}")
            
            # Terminate the shell
            try:
                await mgr.terminate_shell(shell_id, force=True)
            except Exception as e:
                print(f"[Terminal WS] Error terminating shell: {e}")
            
            # Clear from history store (ATOMIC with terminate)
            history_store.set_terminal_shell_id(None)
            print(f"[Terminal WS] Shell {shell_id} destroyed and cache cleared")
            
            # Send confirmation and close
            await websocket.send_json({"type": "destroyed", "shell_id": shell_id})
            break  # Exit loop, triggers cleanup in finally block
    except (json.JSONDecodeError, TypeError):
        # Not JSON, treat as regular terminal input
        pass
    
    # Regular terminal input
    try:
        await mgr.write_to_pty(shell_id, msg)
    except Exception:
        pass
```

**CWD Fix Preservation:**

The existing creation logic (lines 217-230) already uses project path:
```python
project_path = history_store.get_active_project()
cwd = project_path if project_path and Path(project_path).is_dir() else str(Path.home())
shell_rec = await create_editor_shell(cwd=cwd)
```

✅ **No changes needed** - this continues to work!

---

### Frontend Changes

**File:** `app/apps/file_editor_cm6/static/js/terminal.js`

#### Change 1: Simplify destroyShell() (Lines 85-108)

**Current:**
```javascript
async function destroyShell() {
  if (!shellId) return;
  try {
    await fetch(`/api/app/file_editor_cm6/terminal/${shellId}`, {
      method: 'DELETE',
    });
    await fetch('/api/app/file_editor_cm6/terminal/shell-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shell_id: null }),
    });
  } catch (err) {
    console.error('Failed to destroy terminal shell:', err);
  }
  shellId = null;
}
```

**Replace with:**
```javascript
async function destroyShell() {
  if (!shellId) return;
  
  const currentShellId = shellId;
  shellId = null;  // Clear immediately to prevent reconnection
  
  // Send destroy command through WebSocket
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ action: 'destroy' }));
      console.log('Sent destroy command for shell:', currentShellId);
      
      // Wait briefly for backend to process
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      console.error('Failed to send destroy command:', err);
    }
  }
}
```

#### Change 2: Update destroy() order (Lines 306-325)

**Current:**
```javascript
async function destroy() {
  close();
  if (term) {
    term.dispose();
    term = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  await destroyShell();  // ⚠️ Happens LAST
  container.innerHTML = '';
}
```

**Replace with:**
```javascript
async function destroy() {
  console.log('Terminal destroy() called');
  
  // Send destroy command to backend FIRST (before UI cleanup)
  await destroyShell();
  
  // Close drawer UI
  close();
  
  // Close WebSocket (backend already terminated shell)
  if (ws) {
    ws.close();
    ws = null;
  }
  
  // Dispose xterm instance
  if (term) {
    term.dispose();
    term = null;
  }
  
  container.innerHTML = '';
  console.log('Terminal destroy() complete');
}
```

#### Change 3: Fix event listener (Lines 425-427)

**Current:**
```javascript
if (closeBtn) {
  closeBtn.addEventListener('click', destroy);  // ❌ No await!
}
```

**Replace with:**
```javascript
if (closeBtn) {
  closeBtn.addEventListener('click', async () => {
    await destroy();  // ✅ Properly await async function
  });
}
```

---

## Testing Plan

### Test Case 1: Normal Open/Close Cycle
```
1. Open terminal → verify new shell created in project directory
2. Note shell ID from console log
3. Click X button → verify "destroyed" message in console
4. Reopen terminal → verify NEW shell ID (different from step 2)
5. Verify commands work and display correctly
```

**Expected:** Each open creates fresh shell, no blank screens

### Test Case 2: Rapid Open/Close/Reopen
```
1. Open terminal
2. Immediately click X
3. Immediately reopen (< 1 second)
4. Verify terminal works normally
```

**Expected:** No blank screen, no zombie shell

### Test Case 3: Shell Crash Recovery
```
1. Open terminal, note shell ID
2. In another terminal: kill -9 <shell_pid>
3. Wait for WebSocket to detect and close
4. Reopen terminal
5. Verify new shell created (cache detects dead shell)
```

**Expected:** Self-healing behavior, new shell created

### Test Case 4: WebSocket Reconnection
```
1. Open terminal
2. Disconnect network for 5 seconds
3. Reconnect network
4. Verify terminal reconnects to SAME shell
5. Type commands, verify input AND output work
```

**Expected:** Reconnection to existing shell works correctly

### Test Case 5: Multiple Project Switches
```
1. Open project A, open terminal → verify CWD is project A
2. Switch to project B
3. Close terminal
4. Reopen terminal → verify CWD is project B
```

**Expected:** CWD fix still works, new shells use current project path

---

## Verification Commands

**Check framework shells:**
```bash
curl -s http://localhost:8088/api/framework_shells | \
  jq '.data[] | select(.label == "code-editor-terminal") | {id, status, cwd}'
```

**Check history store cache:**
```python
# In Python console or script
from app.apps.file_editor_cm6.history_store import HistoryStore
store = HistoryStore()
shell_id = store.get_terminal_shell_id()
print(f"Cached shell_id: {shell_id}")  # Should be None after destroy
```

**Watch WebSocket messages:**
```javascript
// In browser console
// Look for: "Sent destroy command"
// Look for: "Terminal destroy() complete"
```

---

## Benefits

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Race conditions** | ❌ Multiple async calls can race | ✅ Atomic backend operation |
| **State management** | ❌ Frontend tracks state | ✅ Backend owns state |
| **Error recovery** | ❌ Manual intervention needed | ✅ Self-healing (auto-detects dead shells) |
| **Code complexity** | ❌ Multiple endpoints, HTTP calls | ✅ Single WebSocket message |
| **Architecture** | ❌ Inconsistent with editor | ✅ Matches editor pattern |
| **Debugging** | ❌ State split across layers | ✅ Single source of truth |
| **CWD fix** | ✅ Works | ✅ Still works (preserved) |

---

## Migration & Rollback

**Backwards Compatibility:**
- DELETE endpoint (`/terminal/{shell_id}`) can remain for manual cleanup
- Old behavior still works if frontend doesn't send destroy message
- No breaking changes to existing functionality

**Rollback Plan:**
- Revert frontend changes → falls back to old DELETE endpoint flow
- Backend message handling is additive (doesn't break old flow)
- Low risk change

---

## Files to Modify

1. ✅ `app/apps/file_editor_cm6/terminal_backend.py` - Add destroy message handling (~20 lines)
2. ✅ `app/apps/file_editor_cm6/static/js/terminal.js` - Simplify lifecycle, fix await (~30 lines)
3. ❌ `app/apps/file_editor_cm6/terminal_shell.py` - No changes needed

**Total changes:** ~50 lines across 2 files

---

## Next Steps

1. ✅ Proposal documented
2. ✅ Logged in `notes/2025-11-16_TERMINAL_CWD_FIX.md`
3. ⏳ User review and approval
4. ⏳ Implementation
5. ⏳ Testing all scenarios
6. ⏳ Update progress log with results

---

## Questions for Review

1. Should we keep the DELETE endpoint for backwards compat or deprecate it?
2. Any concerns about the 100ms delay in `destroyShell()`?
3. Should we add a timeout for the destroy command (in case backend doesn't respond)?
4. Any edge cases not covered in testing plan?

---

**Proposal Status:** 📋 Ready for Review  
**Risk Level:** 🟢 Low (additive changes, backwards compatible)  
**Estimated Effort:** 🕐 30 minutes implementation + 15 minutes testing

---

**Session End:** 2025-11-16T15:44:27.823Z
