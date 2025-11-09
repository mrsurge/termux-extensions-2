# 8_2_00_FEC_AD_MIGRATION_PLAYBOOK.md

> **Goal:** give the next agent a step-by-step script to port the *exact* (not approximate) Agent Drawer conversation lifecycle from the legacy repo (`../te-code-cm6-2`) into the ASGI build (`./te-code-cm6-2-bak`). No code should be touched until every deltas below are understood.

---

## 1. Canonical References

| Source | Why it is authoritative |
| ------ | ----------------------- |
| `../te-code-cm6-2/app/apps/file_editor_cm6/agent_ws.py` | Full legacy WebSocket implementation that already persists user/system/assistant/error messages exactly as `docs/apps/code_cm6/AGENT_DRAWER.md` describes. |
| `../te-code-cm6-2/app/apps/file_editor_cm6/agent_session_store.py` | Defines the storage schema (messages array, `version`, metadata) and atomic write flow that the docs call “backend owns everything.” |
| `docs/apps/code_cm6/AGENT_DRAWER.md` + `docs/apps/code_cm6/CODE_CM6_COMPLETE.md` | Narrative description of every route, event, and persistence rule. Use it to double check that the code you port matches the documented order of operations. |
| `../te-code-cm6-2/app/apps/file_editor_cm6/agent_routes.py` | Shows how `/api/app/file_editor_cm6/agent/*` endpoints interact with the store. The ASGI build needs to expose the same REST responses verbatim. |
| `../te-code-cm6-2/app/apps/file_editor_cm6/static/js/agent_drawer.js` (legacy) | Confirms what the browser expects (pure display client; never writes messages). Helps verify that the backend remains the single source of truth. |

**Expectation:** Every change in `te-code-cm6-2-bak` must be justified by a diff against the files above. If something is missing in the new tree, copy it wholesale first, then refactor for ASGI only if absolutely necessary.

---

## 2. Storage Layer (EXACT logic)

1. **New persistence module** – Create `app/apps/file_editor_cm6/conversation_store.py` (name can change, but keep it separate from `.codex`).
   - Copy the legacy implementation from `../te-code-cm6-2/app/apps/file_editor_cm6/agent_session_store.py` **verbatim**, then change only the base path constant. The user explicitly rejected reusing `~/.codex`; pick a new root such as `Path.home() / '.te_cm6' / 'agent_sessions'` and document it at the top of the file.
   - Keep the exact API surface: `load_session_map`, `save_session_map`, `list_sessions`, `create_session`, `append_message`, `update_message`, `update_session_metadata`, `delete_session`, `clear_conversation_id`.
   - Preserve atomic writes (tmp file + replace) and the `version` counter.

2. **Migration helper (one-time)** – add `scripts/migrate_agent_sessions.py` or equivalent that:
   - Reads `~/.codex/agent_sessions/sessions.json` if it exists.
   - Copies sessions into the new store, rewriting only the base path.
   - Is *not* invoked automatically; document it in `AGENTS.log` so the user can run it manually.

3. **REST endpoints** – Update `app/apps/file_editor_cm6/agent_routes.py` so every import of `agent_session_store` switches to the new module. Function bodies should remain identical to the legacy repo (compare `../te-code-cm6-2/.../agent_routes.py` lines 260‑520).

4. **Preferences** – Leave `~/.codex/app_prefs/code_cm6.json` untouched; only the conversation history moves. The drawer still reads/writes `last_active_session_id` there.

---

## 3. Transport Layers

### 3.1 Socket.IO IPC (`app/apps/file_editor_cm6/ipc_stack/agent_handler.py`)

Follow the exact order from the legacy WebSocket handler:

1. **Request map** – Maintain `request_id → session_id` mapping just like `request_session_map` in the legacy file. The current IPC handler only stores `_shell_by_session`; add the mapping so you can associate streaming events with the correct session transcript.
2. **User message persistence** – Call `append_message()` *before* writing to the PTY (see legacy lines ~470‑520). Use the exact message shape:
   ```python
   {
       'id': f'msg-{uuid.uuid4()}',
       'type': 'user',
       'text': payload.get('text', ''),
       'timestamp': time.time()
   }
   ```
3. **System/assistant/error/tool events** – In `_process_agent_chunk`, after `normalized = CodexAdapter.from_agent(...)`, copy the `if/elif` ladder from the legacy handler. Do **not** skip planning/diff/tool events; the docs call out that they must be stored so the UI can reconstruct transcripts.
4. **Streaming tokens** – Continue to stream `token` events to Socket.IO clients without persisting, but feed every delta to `CodexAdapter` via a new helper (see “Adapter parity” below) so the final assembled text is accurate.
5. **Conversation IDs** – When `event == 'conversation_started'`, call `update_session_metadata(session_id, conversationId=...)` immediately, exactly like the legacy handler.

### 3.2 Legacy FastAPI WebSocket (`app/apps/file_editor_cm6/agent_ws.py`)

Even if it’s “diagnostic only”, it must behave identically:

1. Copy the persistence ladder from `../te-code-cm6-2/.../agent_ws.py` (lines ~240‑360) so every event writes through the new store.
2. Simplify the new `build_transcript()` usage so it only formats history for prepending. The docs make it clear we should **prepend** the transcript to the next user message instead of injecting `base_instructions`.
3. Ensure `bridge.parse_agent_output()` returns the same normalized events as the Socket.IO path so both transports stay in sync.

### 3.3 Codex Adapter Parity

The legacy `CodexAdapter` accumulates streaming deltas in `_last_messages` so that when `event == 'final'` the handler can persist the exact text that was streamed. In the ASGI repo this accumulation was removed.

Action items:

1. Restore `_last_messages` plus helper functions:
   - `CodexAdapter.store_message_chunk(request_id, text)` – append to a per-request buffer.
   - `CodexAdapter.get_complete_message(request_id)` – pop and return the buffer when finalizing.
2. Call `store_message_chunk()` whenever `event_type == 'agent_message_delta'`. The IPC handler’s `token` branch should use the same helper so both transports share the buffer.
3. On `event == 'final'`, persist the buffer output. Do not trust `normalized.get('text')` alone; the legacy server always used the buffered string for determinism (see doc section “Message Flow”, lines ~500‑560).

---

## 4. Conversation Restoration (prepend, no base instructions)

The docs mandate: *“The previous transcript is appended to the next user message when the conversationId is missing.”*

Implementation steps:

1. In both handlers, when `needs_restore` is true, build the transcript text using the new store and set:
   ```python
   payload['text'] = f"{transcript}\n\nUser: {payload['text']}"
   payload['conversationId'] = None
   CodexAdapter.clear_conversation(session_id)
   ```
2. Remove any path that injects `context['base_instructions']`. The MCP server already protested that pattern.
3. After restoration, once the agent sends `conversation_started`, persist the new `conversationId` immediately so the *next* user message skips the prepend.

---

## 5. IPC Server & Socket.IO Reliability

1. **async_mode fallback** – Already added (`_init_socketio`). Keep it.
2. **Werkzeug `allow_unsafe`** – Already handled. Document that the IPC server will log a warning when it falls back to threading mode.
3. **500 handshake** – The current stack still emits 500s like `write() before start_response`. This happens when a Socket.IO WebSocket request hits the threading backend without the proper Upgrade handshake. When porting the legacy code, ensure the server runs under `eventlet` or `gevent` before production (per `docs/apps/code_cm6/CODE_CM6_COMPLETE.md`, section “IPC Server Requirements”).
   - For dev environments without `gevent`, wrap the import in a try/except and print a clear log message instructing the operator to `pip install gevent gevent-websocket`.

---

## 6. Autostart Diagnosis (file_editor_cm6 worker)

The user asked why the CM6 worker launches automatically on framework boot. Trace it before making changes:

1. `app/main.py` calls `initialize_running_apps()` during startup (see `app/main.py:27-55`). That function in turn loads `~/.cache/te_framework/running_apps.json` and re-registers any previously running workers.
2. If the CM6 worker shell (label `app-worker:file_editor_cm6`) is still alive when the framework restarts, `_adopt_running_shells()` (in `app/libs/app_manager.py:52-140`) picks it up and registers it again, making it appear “auto-started”.
3. Recommendation for follow-up agent: add logging in `_adopt_running_shells()` that prints the label each time it is adopted, so we can confirm whether it’s a true autostart or just restoration. Do **not** disable the adoption flow until we confirm.

---

## 7. Verification Checklist (run in order)

1. **Data migration** – Run the migration script once and inspect the new store (`cat ~/.te_cm6/agent_sessions/sessions.json`). Confirm assistant/system entries exist.
2. **Drawer load** – Start the framework, open the drawer, refresh twice. Messages should survive reload without consulting `.codex`.
3. **Socket.IO stream** – Send a prompt via the UI while tailing `~/.te_cm6/agent_sessions/sessions.json`; verify a new `assistant` entry appears immediately after `final`.
4. **Legacy WS smoke** – `wscat -c ws://localhost:8088/ws/app/file_editor_cm6/agent?...` and send a message. Confirm the transcript updates identically.
5. **IPC handshake** – Hit `http://127.0.0.1:9123/socket.io/?EIO=4&transport=websocket` manually; no 500s should appear once the proper async backend is installed.

If any step fails, stop and update this playbook before touching code again. The entire point is to avoid iterative guesswork and reimplement the proven architecture verbatim.

---

## 8. Hand-off Notes

- Do **not** optimize or modernize while porting. Copy the working logic first (including variable names) so we have an apples-to-apples baseline.
- Keep a running log in `consolidated_review_addendum.log` summarizing each migration milestone (store copied, transports rewired, etc.).
- Once the parity baseline is in place, we can talk about future improvements (e.g., alternative stores, async refactors). Until then, perfect reproduction is the only success criterion.

