---
### TERMINAL LIFECYCLE FIX
**Timestamp:** 2025-11-16T15:51:50+00:00
**Implementer:** Gemini

**Changes Made:**
- `app/apps/file_editor_cm6/terminal_backend.py`:
  - The WebSocket message loop now listens for a `{"action": "destroy"}` message from the client.
  - Upon receiving this message, it atomically terminates the shell process and clears the shell ID from the history store, ensuring the backend state is clean.

- `app/apps/file_editor_cm6/static/js/terminal.js`:
  - The `destroy()` function's logic was re-ordered to be more robust: it now sends the destroy command to the backend *first* and waits for it to complete before cleaning up the frontend UI (disposing xterm, closing the WebSocket).
  - The `destroyShell()` helper was simplified to only send the WebSocket destroy command and immediately clear the local `shellId` to prevent race conditions.
  - The event listener for the 'X' close button was made `async` to properly `await` the `destroy()` function, ensuring the entire cleanup process completes before the user can interact with the UI again.

**Issue Fixed:**
- A race condition where a user could reopen the terminal before the previous shell was fully destroyed, resulting in a blank, unresponsive terminal connected to a zombie process. The new backend-managed lifecycle prevents this.

**Testing Notes:**
- As per the user's detailed testing plan, the terminal should now be robust against rapid open/close cycles and recover gracefully from shell crashes.
---