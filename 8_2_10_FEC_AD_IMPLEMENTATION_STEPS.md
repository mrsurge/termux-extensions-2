# 8_2_10_FEC_AD_IMPLEMENTATION_STEPS.md

> **Objective:** Implement the Agent Drawer persistence/restoration flow exactly as described in `docs/apps/code_cm6/AGENT_DRAWER.md` and reiterated in `docs/apps/code_cm6/CODE_CM6_COMPLETE.md`, without referencing any files outside this repository. Every instruction below maps directly to language in those docs so there is zero ambiguity or “wiggle room.”

---

## 1. Storage Layer (Docs §§3–4)

1. **Create** `app/apps/file_editor_cm6/conversation_store.py`.
   - Copy the API surface verbatim from the docs’ “`agent_session_store.py`” description (`AGENT_DRAWER.md` §§3 & 4, `CODE_CM6_COMPLETE.md` §§“Session Object Structure” & “Key Backend Modules”).
   - Functions required (names must match the docs): `load_session_map`, `save_session_map`, `list_sessions`, `create_session`, `append_message`, `update_message`, `update_session_metadata`, `delete_session`, `clear_conversation_id`.
   - Follow the documented schema exactly: session dict with `id`, `name`, `agent`, `conversationId`, `shell_id`, `messages`, `createdAt`, `cwd`, `auto`, `fullAccess`, `version`. Messages contain `id`, `type`, `text`, `timestamp` (plus optional per-type fields such as `tool`, `args`, `patch`).
   - Location per docs: `~/.codex/agent_sessions/sessions.json`. (We keep that path because the documentation explicitly names it as the canonical storage location.)
   - Implement the atomic write flow described in §3 (“Write to `.tmp`, then replace”) using `Path.write_text()` and `Path.replace()`.
   - Guard all read/write operations with a module-level `threading.RLock()` as documented.

2. **Migration helper (optional but recommended)**: Add `scripts/migrate_agent_sessions.py` that copies existing `sessions.json` to a backup before any edits. (Docs don’t mention migration, but this prevents data loss while aligning with the documented file layout.)

3. **Wire REST routes** (`app/apps/file_editor_cm6/agent_routes.py`). Replace every import of `agent_session_store` with the new `conversation_store` module. Do not change function bodies; they already match the REST shapes specified in `AGENT_DRAWER.md` §11 and `CODE_CM6_COMPLETE.md` §“REST API Reference`.

---

## 2. Codex Adapter Parity (Docs §§6 & 8)

1. **Buffer streaming output**: Reintroduce `_last_messages` + helper functions inside `app/apps/file_editor_cm6/agent_bridge.py`:
   - `store_message_chunk(request_id, text)` → append to buffer.
   - `get_complete_message(request_id)` → pop buffer and return final text.
   - Call `store_message_chunk()` whenever `CodexAdapter.from_agent()` sees `event_type == 'agent_message_delta'`. This is mandated in `AGENT_DRAWER.md` §6 (“Message Flow”) where `agent_message_delta` is “streaming token – DIRECT RESPONSE,” followed by `agent_message`/`task_complete` finalization.

2. **Conversation tracking**: Ensure `CodexAdapter.store_conversation_id()` and `.clear_conversation()` are invoked exactly as described in §8 (“Conversation Restoration”) — i.e., clear when prepending transcript, set when `conversation_started` arrives.

---

## 3. Socket.IO IPC Namespace (Docs §§6, 10, 13)

Modify `app/apps/file_editor_cm6/ipc_stack/agent_handler.py` so it mirrors the doc’s pseudocode (`AGENT_DRAWER.md` §6, code block at lines ~500‑560):

1. **Request/session map** – Introduce `self._request_map: Dict[str, str]` on `AgentSocketSession`. Whenever `_handle_client_message()` prepares `payload['id']`, record `self._request_map[payload['id']] = chat_session_id`.

2. **User message persistence** – Before writing to the PTY, call `conversation_store.append_message()` with the exact dict shown in §6 (type `'user'`, new UUID, timestamp).

3. **Streaming output** – In `_process_agent_chunk()`:
   - On `event == 'token'`, call `CodexAdapter.store_message_chunk(normalized['id'], normalized.get('text',''))` and emit to clients without persisting.
   - On `event == 'system'`, persist immediately using the schema from §6 (`type: 'system'`, include `text`).
   - On `event == 'final'`, call `CodexAdapter.get_complete_message(request_id)` to retrieve the assembled assistant text, persist it with `type: 'assistant'`, then clear the request map entry.
   - On `event == 'error'`, persist `{type: 'error', 'text': error_text}`.
   - On `event == 'tool_call'`, persist with `type: 'tool_call'`, including `tool`/`args` keys (docs §6, message type table).
   - On `event == 'diff'`, persist `type: 'diff'` with `path` & `patch`.

4. **Conversation IDs** – When `event == 'conversation_started'`, immediately call `update_session_metadata(chat_session, conversationId=normalized['conversationId'], shell_id=self.shell_id)` per §7 (“Session Management”).

5. **Restoration** – When `_handle_client_message()` detects `needs_restore`, prepend the transcript to the user text exactly as described in §8: `payload['text'] = f"{transcript}\n\nUser: {original_text}"` and set `payload['conversationId'] = None`. Do **not** inject base instructions; the docs say “the transcript is appended to the next user message.”

6. **Cleanup** – After persisting a `final` or `error`, remove the request ID from `self._request_map` as shown in the pseudocode (docs §6 “Clean up mapping” step).

---

## 4. Legacy FastAPI WebSocket (`app/apps/file_editor_cm6/agent_ws.py`)

Apply the identical changes there so both transports behave the same (docs §10 “WebSocket Communication” and §13 “Implementation Details”):

1. Use the new `conversation_store` module for all persistence calls.
2. Reuse the same request/session mapping approach.
3. Call the Codex adapter helpers in the same places as the Socket.IO handler.
4. Follow the documented event handling order (token → system → final → cleanup).

---

## 5. Validation Steps (Docs §§6, 7, 8)

1. Start the framework and create a new session via `/api/app/file_editor_cm6/agent/sessions`.
2. Send a prompt through the Agent Drawer; tail `~/.codex/agent_sessions/sessions.json` and confirm a `user` entry appears immediately, followed by `system` entries during reasoning and an `assistant` entry on completion.
3. Refresh the page; the drawer should render the entire transcript (user, system, assistant) without re-contacting the agent.
4. Kill the Codex MCP shell (`/api/internal/shells/<id>/kill`), reopen the drawer, and verify the conversation is restored by prepending the transcript to the next user message (see §8 for the exact behavior).

These checks come straight from the “Message Flow,” “Session Management,” and “Conversation Restoration” sections—if any fail, the implementation still diverges from the documented design.

---

## 6. Non-Negotiable Rules (from the docs)

1. **Frontend never mutates state** – No new client-side persistence; all mutations go through the backend (docs §2 “Frontend is Display-Only”).
2. **Single shared MCP shell** – Continue to use one shell per agent type (`agent-codex-shared-c`) and reuse it (docs §Overview & §10).
3. **Atomic writes** – Never write directly to `sessions.json` without the `.tmp` swap (docs §3).
4. **Full message types** – Persist every event type listed in §3 (`user`, `assistant`, `system`, `error`, `planning`, `tool_call`, `diff`). Streaming tokens are the only ones explicitly allowed to stay ephemeral.

Follow these instructions verbatim and the ASGI implementation will finally match the canonical Agent Drawer specification without needing to reference any external checkout.

