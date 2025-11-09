# 8_0_30_FEC_AD – File Editor CM6 Agent Drawer Intended Architecture

> **Status:** Desired architecture; implementation parity unknown.  
> **Audience:** Engineers auditing or rebuilding the CM6 agent drawer + IPC stack.  
> **Purpose:** Describe the end-state architecture that should exist, regardless of the framework’s current behavior.

---

## 1. Guiding Intent

1. The backend (Python) owns every mutation: shell lifecycle, request/session routing, IPC transport, conversation history, and restoration logic.  
2. The frontend (JS) acts strictly as a display client: it renders snapshots and streams but never persists state.  
3. The IPC microservice exposes Socket.IO but still depends entirely on the ASGI framework’s documented internal APIs (no new agent endpoints).  
4. Socket.IO is solely a transport swap for the documented WebSocket protocol—every payload follows the same schema and semantics as in `docs/apps/code_cm6/AGENT_DRAWER.md`.  
5. Conversation restoration is deterministic: whenever the drawer reconnects, the backend decides whether to inject history, reuse an existing shell, or spawn a new PTY, following the canonical algorithm.  
6. Reasoning steps, planning tokens, error notifications, and final responses are all persisted on the backend before any UI acknowledgement.

---

## 2. High-Level Components (Desired)

- **FastAPI framework (app/main.py + worker apps):**  
  - Hosts REST APIs, serves the CM6 app, proxies HTTP routes, and exposes the internal shell APIs (`/api/internal/shells/*`) that `agent_ws.py` already uses.  
  - Runs the worker-side WebSocket implementation documented in `docs/apps/code_cm6/AGENT_DRAWER.md`; the IPC stack must behave identically so the two transports stay interchangeable.  
  - Owns conversation restoration logic via the session store and metadata updates.

- **IPC Microservice (`app/ipc/server.py`):**  
  - Flask + Socket.IO (async_mode=gevent).  
  - Provides REST control endpoints (shutdown/SSE) and loads per-app IPC modules from manifest `ipc_modules`.  
  - Delegates every agent action back into the framework via the existing internal APIs (no bespoke `/api/internal/agents/spawn` route).

- **Socket.IO Namespace (`app/apps/file_editor_cm6/ipc_stack/agent_handler.py`):**  
  - Accepts Socket.IO connections from the drawer but internally mirrors the exact `agent_ws.py` flow: ensure shell, maintain request/session map, persist before emit, and inject transcripts when conversation IDs become invalid.  
  - Uses `CodexAdapter` so MCP translation remains shared between IPC and ASGI code paths.

- **Framework Shell Manager (`app/libs/framework_shells.py`):**  
  - Spawns Codex MCP shells (`codex mcp-server`) on demand.  
  - Enforces shared shell labels (`agent-codex-shared-c`), adoption logic, PID monitoring, and PTY output subscription.  
  - Provides the `/api/internal/shells/spawn|write|stream|describe|find` endpoints consumed by both transports.

- **Agent Session Store (`app/apps/file_editor_cm6/agent_session_store.py`):**  
  - Persistent JSON map keyed by session ID.  
  - Stores session metadata, conversation IDs, message history, timestamps, preferences.  
  - Thread-safe via `RLock`, matching the behavior described in the canonical doc.

- **Frontend Drawer (`agent_drawer.js` + HTML/CSS):**  
  - Loads CM6 UI, fetches session snapshots via REST (`/api/app/file_editor_cm6/agent/session/*`).  
  - Connects to Socket.IO using the IPC host/port, but exchanges the same JSON payloads that the original WebSocket implementation expects.  
  - Displays streaming events while relying on backend state for the canonical transcript.

---

## 3. Desired Message Flow (Overview)

This section mirrors the “Message Flow” chapter in `docs/apps/code_cm6/AGENT_DRAWER.md`. The only change is that the browser now reaches the backend through Socket.IO ↔ IPC instead of a direct WebSocket; every payload and side effect remains the same.

1. **User opens drawer:**  
   - Frontend fetches `/api/app/file_editor_cm6/agent/shell/status`, `/preferences/get?key=last_active_session_id`, and `/agent/session/<id>`.  
   - Backend returns the stored session (messages, `conversationId`, `shell_id`, metadata).

2. **Frontend connects Socket.IO:**  
   - Calls `/api/framework/ipc` to discover `{host, port}`.  
   - Connects to `http://<ipc-host>:<ipc-port>/agent` with `agent`, `cwd`, `session` query params.  
   - IPC namespace instantiates `AgentSocketSession`, which immediately replicates `_ensure_shell()` from the doc.

3. **Backend ensures shell:**  
   - Attempt to reuse an in-memory shared shell; otherwise call `/api/internal/shells/find`.  
   - If nothing is running, spawn via `/api/internal/shells/spawn` and cache `{agent_type -> shell_id}`.  
   - Update `agent_session_store` with the active `shell_id`.

4. **Conversation restoration:**  
   - Load persisted session, compare stored `shell_id`/`conversationId` with the active shell and `_conversations` cache.  
   - If history exists and anything is mismatched, build transcript text using `build_transcript()`, prepend it to the new prompt, clear the conversation ID, and set `base_instructions`.  
   - Otherwise reuse the stored `conversationId`. Frontend never participates in this decision.

5. **User sends message:**  
   - Drawer emits `agent_user_message` over Socket.IO with the same schema as the WebSocket version (`{id, text, session, conversationId?, context?}`).  
   - Backend persists the user message immediately (`append_message`) and records `request_id → session_id` in a request map.  
   - Payload is translated with `CodexAdapter.to_agent` and written to the shared PTY via `/api/internal/shells/{id}/write`.

6. **Codex MCP output loop:**  
   - Backend streams `/api/internal/shells/{id}/stream`, decodes JSON-RPC lines, and normalizes them with `CodexAdapter.from_agent`.  
   - Persistence rules are identical to the doc: `system/agent_reasoning` and completed planning blocks are appended before emission; `token` events remain transient; `final` combines accumulated text, persists the assistant message, updates `conversationId`, and removes the request-map entry; `error` events persist as `type: "error"`.  
   - Each emitted payload already includes the originating `session` so multiple drawers can safely share the shell.

7. **Conversation IDs:**  
   - When MCP emits `conversation_started`, update both `_conversations[session]` and the session store.  
   - If a shell dies, clear the stored ID so the next message triggers the restore path automatically.

8. **Disconnect / reconnect:**  
   - Socket.IO disconnects do not affect PTY streaming or persistence.  
   - Drawer refresh reloads the full transcript via REST and resumes streaming once Socket.IO reconnects.

---

## 4. Desired Backend Logic (Detailed)

### 4.1 Shell Lifecycle Ownership

- Shells are created/destroyed exclusively on the backend via `/api/internal/shells/*`.  
- Session metadata always tracks `shell_id`, updated with `update_session_metadata()` immediately after `_ensure_shell()` or `needs_restore`.  
- IPC helpers never invent new internal endpoints; even “spawn agent” actions must call `/api/internal/shells/spawn`.

### 4.2 Conversation Restoration Algorithm

```
def _handle_client_message(payload):
    chat_session_id = payload["session"]
    session = agent_session_store.get_session(chat_session_id)
    memory_conv = _conversations.get(chat_session_id)
    stored_shell = session.get("shell_id")
    stored_conversation = session.get("conversationId")

    needs_restore = bool(session.get("messages")) and (
        (stored_shell and stored_shell != self.shell_id)
        or not stored_conversation
        or not memory_conv
    )

    if needs_restore:
        base_instr, transcript = build_transcript(session["messages"])
        payload["text"] = f"{transcript}\n\nUser: {payload.get('text', '')}"
        payload.pop("conversationId", None)
        context["base_instructions"] = base_instr
        CodexAdapter.clear_conversation(chat_session_id)
    elif stored_conversation:
        payload["conversationId"] = stored_conversation

    append_message(chat_session_id, user_msg)
    request_session_map[request_id] = chat_session_id
    write_to_pty(json.dumps(CodexAdapter.to_agent(payload)))
```

### 4.3 Persistence Rules

| Event Type              | Storage Action                                 | Frontend Action                       |
|-------------------------|-----------------------------------------------|---------------------------------------|
| `user`                  | `append_message(type='user', text=…)`         | Render bubble immediately             |
| `system` (complete)     | `append_message(type='system', text=…)`       | Show planning / reasoning bubble      |
| `assistant` (`final`)   | `append_message(type='assistant', text=…)`    | Replace pending bubble with final     |
| `error`                 | `append_message(type='error', text=…)`        | Display error toast + bubble          |
| `token` (stream)        | **Not persisted**                             | Streaming bubble only                 |
| `progress` / `tool_call`| Optional `append_message` for audit trail     | UI indications (if desired)           |

### 4.4 Request/Session Mapping

```
request_session_map = {}
request_session_map[request_id] = session_id
session_id = request_session_map[request_id]
del request_session_map[request_id]
```

### 4.5 Socket.IO Events (Desired Contract)

- `agent_connected` → `{agent, shell_id, session_id}`  
- `agent_event` → normalized payload (includes `session`)  
- `agent_error` → `{message}`  
- Optional `framework_agent_ready` hook when the backend finishes MCP initialization

### 4.6 IPC Host/Port Discovery

- `/api/framework/ipc` returns `{host, port}` from env vars `TE_IPC_HOST`, `TE_IPC_PORT`.  
- Drawer uses this to call `io("http://host:port/agent", query=…)`.  
- All IPC traffic stays local to the device unless explicitly proxied.

---

## 5. Desired Frontend Behavior

The drawer retains the exact behavior described in `docs/apps/code_cm6/AGENT_DRAWER.md`; only the transport URL changes.

1. **Init Flow:** fetch state, shell status, and session snapshots from backend before opening the drawer.  
2. **Socket.IO Lifecycle:** call `connectSharedShell()` once, handle `agent_connected`, stream `agent_event` updates, and show `agent_error` toasts.  
3. **Toolbar Controls:** status indicators, reconnect button, and stop-agent action still call backend REST endpoints.  
4. **Session Switch:** fetching `/agent/session/<id>` rehydrates the full transcript; Socket.IO stays connected.  
5. **Thin Client Guarantee:** frontend never mutates or persists session JSON—everything comes from backend APIs.

---

## 6. Desired IPC Deployment Notes

- **Process layout:** `scripts/run_framework.sh` continues to spawn the IPC service (`python -m app.ipc.server`) alongside the supervisor. If the IPC process crashes, the supervisor terminates it on shutdown.  
- **API usage:** IPC never bypasses the framework—it calls `/api/internal/shells/*`, `/api/framework/runtime/shutdown`, etc., exactly as documented.  
- **Env vars:** `TE_IPC_HOST`, `TE_IPC_PORT`, `TE_FRAMEWORK_URL`, `TE_FRAMEWORK_SHELL_TOKEN`.  
- **Security:** still on-device only for alpha builds; future enhancement can add auth/tokens when needed.

---

## 7. Failure Scenarios & Intended Handling

1. **IPC server down:** Socket.IO connect fails, drawer shows “Agent unavailable,” user restarts framework.  
2. **Codex shell crash:** Framework shell manager detects dead PID; next message triggers restore, backend emits `agent_error`, state persists.  
3. **Browser disconnect mid-response:** Backend keeps streaming/persisting; on reconnect the drawer reloads session history and resumes streaming.  
4. **Conversation ID mismatch:** Backend clears stored ID, injects transcript, and updates metadata when MCP returns a new ID.

---

## 8. Implementation Checklist (Desired, but status unknown)

- [ ] IPC Socket.IO namespace mirrors `agent_ws.py`: request map, per-session tagging, persistence-before-emit, transcript injection.  
- [ ] `agent_session_store` persists every `system` and `assistant` event (no JS fallbacks).  
- [ ] `CodexAdapter` continues to emit `system` events for `agent_reasoning`, `task_started`, `notifications/message`.  
- [ ] `/api/internal/shells/*` endpoints enforce `X-Framework-Key`.  
- [ ] Drawer uses Socket.IO exclusively for live transport (legacy WebSocket kept only for diagnostics).  
- [ ] `__cm6TestSocketIO()` validates the handshake payloads described in the doc.  
- [ ] Shutdown script cleans up IPC processes gracefully.

---

## 9. Summary Statement

This document captures the intended architecture: Socket.IO provides the browser transport, but every lifecycle rule—request/session mapping, transcript restoration, persistence-before-emit—remains identical to the WebSocket flow in `docs/apps/code_cm6/AGENT_DRAWER.md`. Bringing the implementation to full compliance now depends on tightening the IPC namespace and legacy worker so both paths behave the same.
