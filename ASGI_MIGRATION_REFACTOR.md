# ASGI Migration Refactor - anyio.to_thread.run_sync Keyword Argument Issues

## Problem
`anyio.to_thread.run_sync()` does not support passing keyword arguments directly to the target function. All calls that use `key=value` syntax must be wrapped in a lambda.

## Pattern to Fix
```python
# BROKEN:
await anyio.to_thread.run_sync(some_function, arg1, arg2, kwarg=value)

# FIXED:
await anyio.to_thread.run_sync(lambda: some_function(arg1, arg2, kwarg=value))
```

---

## Files Requiring Changes

### 1. app/apps/file_editor_cm6/main.py

**Line 218-220** ✅ ALREADY FIXED
```python
# Current (FIXED):
file_meta = await anyio.to_thread.run_sync(
    lambda: write_full(project_root, str(rel_path), content, base_sha256=base_sha256)
)
```

---

### 2. app/apps/file_editor_cm6/terminal_backend.py

**Line 33** ❌ NEEDS FIX
```python
# Current (BROKEN):
shell_info = await anyio.to_thread.run_sync(create_editor_shell, cwd=cwd, shell_cmd=shell_cmd)

# Replace with:
shell_info = await anyio.to_thread.run_sync(
    lambda: create_editor_shell(cwd=cwd, shell_cmd=shell_cmd)
)
```

**Line 135** ❌ NEEDS FIX
```python
# Current (BROKEN):
chunk = await anyio.to_thread.run_sync(output_queue.get, timeout=0.5)

# Replace with:
chunk = await anyio.to_thread.run_sync(lambda: output_queue.get(timeout=0.5))
```

---

### 3. app/apps/file_editor_cm6/agent_ws.py

**Line 239** ❌ NEEDS FIX
```python
# Current (BROKEN):
chunk = await anyio.to_thread.run_sync(output_queue.get, timeout=0.5)

# Replace with:
chunk = await anyio.to_thread.run_sync(lambda: output_queue.get(timeout=0.5))
```

---

### 4. app/apps/file_explorer/file_explorer.py

**Line 257** ❌ NEEDS FIX
```python
# Current (BROKEN):
await anyio.to_thread.run_sync(os.makedirs, target, exist_ok=False)

# Replace with:
await anyio.to_thread.run_sync(lambda: os.makedirs(target, exist_ok=False))
```

---

## Other anyio.to_thread.run_sync Calls (Already Correct - Positional Args Only)

These calls do NOT need changes because they only use positional arguments:

### app/apps/file_editor_cm6/terminal_backend.py
- Line 52: `await anyio.to_thread.run_sync(destroy_editor_shell, shell_id)`
- Line 80: `await anyio.to_thread.run_sync(resize_editor_shell, shell_id, cols, rows)`
- Line 152: `await anyio.to_thread.run_sync(mgr.write_to_pty, shell_id, msg)`
- Line 165: `await anyio.to_thread.run_sync(mgr.unsubscribe_output, shell_id, output_queue)`

### app/apps/file_editor_cm6/agent_routes.py
- Line 57: `await anyio.to_thread.run_sync(bridge.spawn_agent, agent_type, cwd, session_id)`
- Line 97: `await anyio.to_thread.run_sync(bridge.list_agents)`
- Line 127: `await anyio.to_thread.run_sync(bridge.get_agent_stats, session_id)`
- Line 159: `await anyio.to_thread.run_sync(bridge.terminate_agent, session_id)`
- Line 182: `await anyio.to_thread.run_sync(bridge._sessions.get, session_id)`
- Line 187: `await anyio.to_thread.run_sync(bridge.manager.write_to_pty, shell_id, message + '\n')`
- Line 201: `await anyio.to_thread.run_sync(load_preferences)`
- Line 217: `await anyio.to_thread.run_sync(load_preferences)`
- Line 219: `await anyio.to_thread.run_sync(save_preferences, prefs)`
- Line 254: `await anyio.to_thread.run_sync(list_sessions)`
- Line 283: `await anyio.to_thread.run_sync(get_session, session_id)`
- Line 329-336: Multi-line call (check context)
- Line 358: `await anyio.to_thread.run_sync(delete_session, session_id)`
- Line 392: `await anyio.to_thread.run_sync(get_session, session_id)`
- Line 404: `await anyio.to_thread.run_sync(append_message, session_id, message)`
- Line 440: `await anyio.to_thread.run_sync(mgr.list_shells)`

### app/apps/file_editor_cm6/agent_ws.py
- Line 154: `await anyio.to_thread.run_sync(bridge.spawn_agent, agent_type, cwd or os.path.expanduser('~'), session_id)`
- Line 193: `await anyio.to_thread.run_sync(bridge.subscribe_output, session_id)`
- Line 223: `await anyio.to_thread.run_sync(bridge.manager.write_to_pty, shell_id, json.dumps(init_msg) + '\n')`
- Line 494: `await anyio.to_thread.run_sync(bridge.write_message, session_id, msg_agent_type, message, context)`
- Line 523: `await anyio.to_thread.run_sync(bridge.unsubscribe_output, session_id, output_queue)`

### app/apps/file_explorer/file_explorer.py
- Line 220: `await anyio.to_thread.run_sync(_scandir_entries, abs_path, hidden)`
- Line 223: `await anyio.to_thread.run_sync(_scandir_with_sudo, abs_path, hidden)`
- Line 262: `await anyio.to_thread.run_sync(_run_sudo, ['mkdir', '-p', target])`
- Line 280: `await anyio.to_thread.run_sync(shutil.rmtree, abs_target)`
- Line 282: `await anyio.to_thread.run_sync(os.remove, abs_target)`
- Line 285: `await anyio.to_thread.run_sync(_run_sudo, ['rm', '-rf', abs_target])`
- Line 305: `await anyio.to_thread.run_sync(os.replace, src_abs, dest_abs)`
- Line 308: `await anyio.to_thread.run_sync(_run_sudo, ['mv', src_abs, dest_abs])`
- Line 341: `await anyio.to_thread.run_sync(shutil.copytree, src_abs, dest_abs)`
- Line 343: `await anyio.to_thread.run_sync(shutil.copy2, src_abs, dest_abs)`
- Line 346: `await anyio.to_thread.run_sync(_run_sudo, ['cp', '-r', src_abs, dest_abs])`
- Line 368: `await anyio.to_thread.run_sync(os.replace, src_abs, dest_abs)`
- Line 371: `await anyio.to_thread.run_sync(_run_sudo, ['mv', src_abs, dest_abs])`
- Line 395: `await anyio.to_thread.run_sync(os.readlink, abs_path)`
- Line 402: `await anyio.to_thread.run_sync(os.path.exists, target)`
- Line 405: `await anyio.to_thread.run_sync(os.path.isdir, target)`
- Line 407: `await anyio.to_thread.run_sync(os.path.isfile, target)`
- Line 409: `await anyio.to_thread.run_sync(os.path.islink, target)`
- Line 439: `await anyio.to_thread.run_sync(os.lstat, abs_path)`

---

## Summary

### Files to Modify: 4
1. ✅ **app/apps/file_editor_cm6/main.py** - Already fixed (1 location)
2. ❌ **app/apps/file_editor_cm6/terminal_backend.py** - 2 locations need fix
3. ❌ **app/apps/file_editor_cm6/agent_ws.py** - 1 location needs fix
4. ❌ **app/apps/file_explorer/file_explorer.py** - 1 location needs fix

### Total Fixes Needed: 4 locations
- terminal_backend.py: lines 33, 135
- agent_ws.py: line 239
- file_explorer.py: line 257

---

## Testing After Fix

After applying all changes, test:
1. File writes in Code CM6 (atomic writes with base_sha256)
2. Terminal creation/interaction
3. Agent WebSocket streaming
4. File Explorer mkdir operations

All should work without "unexpected keyword argument" errors.
