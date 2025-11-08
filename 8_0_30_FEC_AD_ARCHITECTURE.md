# 8_0_30_FEC_AD – File Editor CM6 Agent Drawer Intended Architecture

> **Status:** Desired architecture; implementation parity unknown.  
> **Audience:** Engineers auditing or rebuilding the CM6 agent drawer + IPC stack.  
> **Purpose:** Describe the end-state architecture that should exist, regardless of the framework’s current behavior.

---

## 1. Guiding Intent

1. The backend (Python) owns every mutation: shell lifecycle, IPC transport, conversation history, and restoration logic.  
2. The frontend (JS) acts strictly as a display client: it renders snapshots and streams but never persists state.  
3. The IPC microservice provides a synchronous control plane decoupled from FastAPI/ASGI event loops.  
4. Socket.IO is the canonical transport between browser ↔ IPC server, enabling reliable reconnection and event semantics.  
5. Conversation restoration is deterministic: whenever the drawer reconnects, the backend decides whether to inject history, reuse an existing shell, or spawn a new PTY.  
6. Reasoning steps, planning tokens, error notifications, and final responses are all persisted on the backend before any UI acknowledgement.

---

## 2. High-Level Components (Desired)

- **FastAPI framework (app/main.py):**  
  - Hosts REST APIs, serves the CM6 app, proxies HTTP routes, exposes internal shell APIs (`/api/internal/shells/*`), and mirrors Socket.IO traffic if needed.  
  - Owns conversation restoration logic through the agent session store and metadata updates.

- **IPC Microservice (`app/ipc/server.py`):**  
  - Flask + Socket.IO (async_mode=gevent).  
  - Provides REST endpoints for shutdown, SSE broadcast, and (future) control actions.  
  - Loads per-app IPC modules via manifest `ipc_modules` list.  
  - Runs the Socket.IO namespaces defined by apps (e.g., `/agent` for file_editor_cm6).

- **Socket.IO Namespace (`app/apps/file_editor_cm6/ipc_stack/agent_handler.py`):**  
  - Accepts Socket.IO connections from the drawer.  
  - Manages `AgentSocketSession` instances that encapsulate shell lifecycle, PTY streaming, MCP protocol translation, persistence, and event emission.

- **Framework Shell Manager (`app/libs/framework_shells.py`):**  
  - Spawns Codex MCP shells (`codex mcp-server`) on demand.  
  - Enforces shared shell labels (`agent-codex-shared-c`), adoption logic, PID monitoring, and PTY output subscription.  
  - Provides the `/api/internal/shells/*` endpoints used by the IPC server.

- **Agent Session Store (`app/apps/file_editor_cm6/agent_session_store.py`):**  
  - Persistent JSON map keyed by session ID.  
  - Stores session metadata, conversation IDs, message history, timestamps, preferences.  
  - Thread-safe via RLock; all writes go through `append_message`, `update_session_metadata`, etc.

- **Frontend Drawer (`agent_drawer.js` + HTML/CSS):**  
  - Loads CM6 UI, fetches session snapshots via REST (`/api/app/file_editor_cm6/agent/session/*`).  
  - Connects to Socket.IO namespace using IPC host/port.  
  - Displays streaming events, but relies on backend state for the canonical transcript.

---

## 3. Desired Message Flow (Overview)

1. **User opens drawer:**  
   - Frontend fetches shell status, preferences, and last active session via REST.  
   - Backend returns session metadata, including conversation ID and shell linkage.

2. **Frontend connects Socket.IO:**  
   - Calls `/api/framework/ipc` to learn host/port.  
   - Loads Socket.IO client and connects to `http://<ipc-host>:<ipc-port>/agent` with query params (agent type, cwd, session id).  
   - Socket.IO namespace creates `AgentSocketSession`, calls `_ensure_shell()`.

3. **Backend ensures shell:**  
   - Looks for existing shell label (`agent-codex-shared-c`).  
   - If found and alive → attaches session.  
   - If not → `spawn_shell_pty` via `/api/internal/shells/spawn`.  
   - Stores shell/session mapping and conversation metadata.

4. **Backend restores conversation:**  
   - Reads session from `agent_session_store`.  
   - If stored conversation ID is missing or mismatched (shell restart), it instructs Codex to resume by injecting transcript + base instructions.  
   - Frontend doesn’t participate; backend decides when history injection is needed.

5. **User sends message:**  
   - Frontend emits `agent_user_message` over Socket.IO.  
   - Backend:
     - Persists user message immediately (`append_message`).  
     - Builds MCP payload via `CodexAdapter.to_agent`.  
     - Writes JSON line to PTY (`manager.write_to_pty`).

6. **Codex MCP output loop:**  
   - Backend subscribes to PTY output (`/api/internal/shells/{id}/stream`).  
   - Each JSON line → `CodexAdapter.from_agent`.  
   - Backend persists:
     - `system` events (planning, reasoning, notifications) when `complete` flag is set.  
     - `assistant` final messages (`event == 'final'`).  
     - `error` events (type `error`).  
   - Backend emits these events to Socket.IO so the UI updates instantly; however, persistence happens before (or simultaneously with) broadcasting.

7. **Conversation IDs:**  
   - When Codex sends `conversation_started`, backend updates the session store with the new `conversationId`.  
   - Future requests reuse the stored ID unless `needs_restore` triggers a transcript injection.

8. **Disconnect / reconnect:**  
   - Backend keeps shell alive.  
   - If Socket.IO disconnects, backend keeps streaming, persisting results.  
   - On reconnection, backend replays the latest session state via REST; Drawer simply renders.

---

## 4. Desired Backend Logic (Detailed)

### 4.1 Shell Lifecycle Ownership

- Shells are created/destroyed exclusively on the backend.  
- Session metadata always tracks `shell_id`.  
- Frontend cannot spawn shells directly; it only sees statuses returned by `/api/app/file_editor_cm6/agent/shell/status`.

### 4.2 Conversation Restoration Algorithm

```
def _handle_client_message(payload):
    session = agent_session_store.get_session(chat_session_id)
    memory_conv = _conversations.get(chat_session_id)
    stored_shell = session.shell_id
    stored_conversation = session.conversationId

    needs_restore = (
        session.messages (history exists)
        and (
            stored_shell != current_shell
            or not stored_conversation
            or not memory_conv
        )
    )

    if needs_restore:
        payload.text = transcript + "\n\nUser: latest_input"
        payload.conversationId = None
        CodexAdapter.clear_conversation(chat_session_id)
    elif stored_conversation:
        payload.conversationId = stored_conversation
```

- Transcript built via `build_transcript(session.messages)`  
- Base instructions appended automatically (“Resume prior conversation...”).  
- Backend updates state after sending the restore payload.

### 4.3 Persistence Rules

| Event Type              | Storage Action                                 | Frontend Action                       |
|-------------------------|-----------------------------------------------|---------------------------------------|
| `user`                  | `append_message(type='user', text=…)`         | Render bubble immediately             |
| `system` (complete)     | `append_message(type='system', text=…)`       | Show planning / reasoning bubble      |
| `assistant` (`final`)   | `append_message(type='assistant', text=…)`    | Replace pending bubble with final     |
| `error`                 | `append_message(type='error', text=…)`        | Display error toast + bubble          |
| `token` (stream)        | **Not persisted**                             | Streaming bubble only                 |
| `progress` / `tool_call`| (Optional) `append_message` for logging       | UI indications (if desired)           |

### 4.4 Socket.IO Events (Desired Contract)

- `agent_connected` → `{agent, shell_id, session_id}`  
- `agent_event` → normalized payload (token/system/final/etc.)  
- `agent_error` → `{message}` for fatal errors  
- `framework_agent_ready` (optional handshake) → indicates backend is ready before any shell creation

### 4.5 IPC Host/Port Discovery

- `/api/framework/ipc` returns `{host, port}` from env vars `TE_IPC_HOST`, `TE_IPC_PORT`.  
- Drawer uses this to build `io("http://host:port/agent", query=…)`.  
- All IPC traffic stays local to the device, with optional proxies if remote.

---

## 5. Desired Frontend Behavior

1. **Init Flow:**
   - Wait for `/api/app/file_editor_cm6/state` and `/agent/shell/status`.  
   - Fetch active session via `/agent/session/<id>`.  
   - Render transcript using backend messages (user/system/assistant). No local persistence.

2. **Socket.IO Lifecycle:**
   - On drawer open, call `connectSharedShell()` once.  
   - Handle `agent_connected` to update UI state, show spinner, etc.  
   - For every `agent_event`, update the transcript:  
     - `token` → streaming bubble (not saved).  
     - `system` → temporary bubble (backend already saved).  
     - `final` → finalize assistant bubble (backend already saved).  
   - Handle `agent_error` gracefully.

3. **Toolbar Toggles:**
   - Display status (`Connected`, `Reconnecting`, `Disconnected`).  
   - Provide manual reconnect button (calls `connectSharedShell()` again).  
   - Provide “Stop agent” button (calls backend REST to terminate shell).

4. **Session Switch:**
   - When user selects another session, fetch full history from backend.  
   - Socket.IO connection stays alive; backend uses message metadata to route responses to the proper session.

5. **Thin Client Guarantee:**
   - Drawer never manipulates session JSON; it only asks backend to mutate via REST or emits input events.  
   - On page reload, everything is rehydrated from backend files before Socket.IO handshake completes.

---

## 6. Desired IPC Deployment Notes

- **Process layout:**  
  - `scripts/run_framework.sh` spawns the Socket.IO IPC server (`python -m app.ipc.server`).  
  - IPC server logs to `~/.cache/te_framework/logs/ipc*.log`.  
  - IPC PID stored in `~/.cache/te_framework/ipc.pid`.  
  - Supervisor ensures IPC server is killed when framework shuts down.

- **Env vars:**  
  - `TE_IPC_HOST`, `TE_IPC_PORT` → default `127.0.0.1:9123`.  
  - `TE_FRAMEWORK_URL` → `http://127.0.0.1:8088`.  
  - `TE_FRAMEWORK_SHELL_TOKEN` → shared secret for internal APIs.

- **Security (future):**  
  - On-device only; no auth.  
  - Future enhancement: optional token for Socket.IO namespace or same host enforcement.

---

## 7. Failure Scenarios & Intended Handling

1. **IPC server down:**  
   - Drawer’s Socket.IO connection fails → user sees toast “Agent unavailable.”  
   - Backend logs show connection refused.  
   - User must restart framework to re-launch IPC service.

2. **Codex shell crash:**  
   - `FrameworkShellManager` sweep notices dead PID.  
   - Next request triggers `needs_restore`, spawns new shell, injects transcript.  
   - Backend emits `agent_error` so UI shows message, but persistence remains intact.

3. **Browser disconnect mid-response:**  
   - Socket.IO connection drops.  
   - Backend still streaming + persisting.  
   - When user reconnects, backend sends fresh transcript, no data loss.

4. **Conversation ID mismatch:**  
   - Backend compares stored conversation vs. in-memory mapping vs. shell.  
   - If mismatch, clears `conversationId` and injects transcript automatically.  
   - UI doesn’t need to know; experience is seamless.

---

## 8. Implementation Checklist (Desired, but status unknown)

- [ ] `agent_session_store` stores `system` and `assistant` messages for every Codex event (no reliance on JS).  
- [ ] `AgentSocketSession` persists `system` events whenever `complete == True`.  
- [ ] `CodexAdapter` returns `system` events for `agent_reasoning`, `task_started`, `notifications/message`.  
- [ ] `/api/internal/shells/*` endpoints enforce `X-Framework-Key`.  
- [ ] Drawer uses Socket.IO exclusively (no ReconnectingWebSocket fallback).  
- [ ] `__cm6TestSocketIO()` shows “connected → ready payload.”  
- [ ] Shutdown script cleans up IPC processes gracefully.

---

## 9. Open Questions (Implementation Unknown)

1. **Are `system` messages currently persisted?**  
   - Architecture requires it, but current logs suggest they might still be streaming-only.

2. **Does the front end still rely on ReconnectingWebSocket anywhere?**  
   - The desired state is Socket.IO-only.

3. **Does `_ensure_shell()` always run in backend before any user input?**  
   - PTY creation must be locked to backend; any UI fallback is out-of-spec.

4. **Are conversation IDs cleared when shells restart?**  
   - Without this step, Codex will reject `conversationId` and history injection fails.

5. **Is the IPC server auto-restarted when it crashes?**  
   - Run script should detect and respawn; status unknown.

---

## 10. Summary Statement

This document captures the **intended** architecture: a backend-driven Codex integration where the IPC Socket.IO service orchestrates shell lifecycle, persistence, and streaming, while the CM6 drawer merely visualizes events. Whether the current codebase meets this specification is unknown; this serves as the reference blueprint engineers should audit against.

-----------------------------------------------------------------------
(End of 8_0_30_FEC_AD_ARCHITECTURE.md)
