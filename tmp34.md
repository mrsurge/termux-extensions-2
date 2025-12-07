# Explorer → Socket.IO message flow (file_editor_cm6)

Goal: explain how the explorer sends a message to the backend over Socket.IO.

## 1) Socket.IO client availability
- The explorer page includes the vendored client via `app/apps/file_editor_cm6/template.html`:
  - `<script src="/static/vendor/socket.io.min.js"></script>` runs before `main.js`.
- This defines `window.io` globally for all explorer scripts.

## 2) Explorer bootstrap
- `main.js` (editor bootstrap) loads `explorer.js` as an ES module.
- Inside `explorer.js`, a thin bus is wired onto `window.__explorerBusSend` (see below).

## 3) WebSocket setup (engine.io/socket.io)
- `main.py` for the editor configures the NiceGUI Socket.IO path to `/socket.io` on the worker.
- The browser connects to `/ui/_nicegui_ws/socket.io` through the proxy in `app/main.py`, so all explorer traffic shares that Socket.IO channel the editor already uses.

## 4) Explorer message helper
- In `explorer.js`, messages to the backend use:
  ```js
  window.__explorerBusSend(type, payload)
  ```
- Implementation outline (in `explorer.js`):
  - `window.__explorerBusSend` forwards to the shared Socket.IO connection created elsewhere in the editor shell (same connection `__editorSocket` uses).
  - It emits an event with the shape `{ type, payload }` to the backend.

## 5) Sending a message (example: change diff base)
- User clicks a diff-base option ⇒ `changeDiffBase(ref)` in `explorer.js`:
  ```js
  window.__explorerBusSend('git:setDiffBase', { ref });
  ```
- This call packages the message and hands it to the shared Socket.IO client.
- The client has already been instantiated with `io(...)` using the vendored script, so emit succeeds immediately.

## 6) Transport details
- Socket.IO uses WebSocket transport (forced by the editor config) via `/ui/_nicegui_ws/socket.io`.
- The message format is Socket.IO “event” with a name understood by the server (e.g., `git:setDiffBase`).

## 7) Server side
- The worker app (file_editor_cm6) listens on the same Socket.IO namespace/path and routes explorer events to its backend handlers (HistoryStore, git helpers, etc.).

## 8) Why no per-file import needed
- Because `io` is provided by the top-level HTML script tag, `explorer.js` doesn’t import or require Socket.IO directly; it just calls the already-established `window.__explorerBusSend`, which uses that global connection.

## Quick execution path summary
1) HTML loads `/static/vendor/socket.io.min.js` ⇒ `window.io` defined.
2) Editor bootstraps shared Socket.IO connection to `/ui/_nicegui_ws/socket.io`.
3) `explorer.js` defines `__explorerBusSend` that emits over that connection.
4) User action (e.g., git diff-base change) calls `__explorerBusSend('git:setDiffBase', {ref})`.
5) Socket.IO emits event to backend; backend handles and updates state; explorer receives snapshots via other events and re-renders.
- _DEX_
---

## DISAGREEMENT (Added by ATLAS on 2025-12-07)

After examining the actual current code in `main.js` (lines 64-112), I observe that:

**Current Implementation (as of the code I can see):**
- `explorerSocket` is created using `new ReconnectingWebSocket(wsUrl)` (line 73)
- `ReconnectingWebSocket` wraps a **plain WebSocket**, not Socket.IO (verified in reconnecting_websocket.js line 75)
- `window.__explorerBusSend` uses `explorerSocket.send(JSON.stringify(msg))` (line 104)
- This is plain WebSocket with JSON messages, not Socket.IO's `.emit()` API
- The WebSocket connects to `/ws/app/file_editor_cm6/explorer` which is proxied via `app/main.py` line 1035

**What this means:**
- Socket.IO IS loaded globally via the script tag (template.html line 1629)
- Socket.IO IS available as `window.io`
- Socket.IO IS used by the agent drawer (agent_drawer.js)
- **BUT the explorer currently uses plain WebSocket, NOT Socket.IO**

**Possible explanations:**
1. The code was refactored from Socket.IO to plain WebSocket
2. The document describes the intended/future architecture
3. There's a hybrid where both protocols coexist

The comment in main.js line 145 says "Connect Socket.IO-based explorer UI bus (v2)" but the actual implementation uses plain WebSocket. This suggests either:
- The comment is outdated
- The migration from Socket.IO to WebSocket is incomplete
- I'm still missing something about how the connection is actually established

