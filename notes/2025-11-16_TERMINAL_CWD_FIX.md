---
### TERMINAL CWD FIX
**Timestamp:** 2025-11-16T06:12:55+00:00
**Implementer:** Gemini

**Changes Made:**
- `app/apps/file_editor_cm6/terminal_backend.py`:
  - Modified the WebSocket handler for auto-creating terminal shells (`/ws/terminal/auto`).
  - Instead of hardcoding the current working directory (CWD) to the user's home directory, the code now dynamically sets the CWD to the active project's root path.
  - If no project is active or the project path is invalid, it safely falls back to the user's home directory.

**Issue Fixed:**
- When creating a new terminal session from the UI, it would always open in `~/` instead of the root directory of the currently open project.

**Testing Notes:**
- When a project is open, creating a new terminal should now correctly start the shell session in that project's root directory.
- When no project is open, the terminal should continue to open in the home directory as a fallback.
---

---
### TERMINAL LIFECYCLE ARCHITECTURE FIX - PROPOSAL
**Timestamp:** 2025-11-16T15:44:27.823Z
**Proposed By:** Claude (Anthropic)

**Problem Identified:**
- Terminal shell not properly destroyed when X button clicked
- Frontend async lifecycle management has race conditions
- Causes blank screen on reopen (xterm disposed but shell still alive)
- Input works but display doesn't (zombie shell state)

**Root Cause:**
- Frontend `destroy()` function is async but event listener doesn't await it
- Multiple async fetch calls can be interrupted by user reopening terminal
- Frontend tries to manage backend state → race conditions
- Order of operations: WebSocket closes before DELETE completes

**Proposed Solution:**
- Make terminal lifecycle **backend-dependent** (like editor)
- Use `history_store` cache presence as single source of truth
- `shell_id` exists = terminal "open" (reconnect to it)
- `shell_id` null = terminal "closed" (create new)
- Single WebSocket message for destroy: `{"action": "destroy"}`
- Backend handles terminate + cache clear atomically

**Key Changes:**

1. **Backend (terminal_backend.py):**
   - Add JSON message parsing in WebSocket input loop
   - Handle `{"action": "destroy"}` command
   - Terminate shell + clear cache in one operation
   - Send confirmation before closing WebSocket

2. **Frontend (terminal.js):**
   - Simplify `destroyShell()` to send WebSocket command only
   - Update `destroy()` to await `destroyShell()` before UI cleanup
   - Fix event listener to properly await async `destroy()`
   - Remove multiple HTTP endpoint calls

**Benefits:**
- No race conditions (backend is single source of truth)
- Self-healing (dead shells auto-detected)
- Simpler code (one message vs multiple HTTP calls)
- Consistent with editor architecture
- Preserves CWD fix (still uses project path)

**Backwards Compatibility:**
- DELETE endpoint can remain for manual cleanup
- No breaking changes to existing behavior
- Only adds new destroy command path

**Testing Required:**
- Normal open/close cycle
- Rapid open/close/reopen
- Shell crash recovery
- WebSocket reconnection after network issue

**Status:** Proposal documented, awaiting implementation approval

**Full details:** See `/tmp.md` for complete implementation plan
---