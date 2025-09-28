# Termux-LM App Overview

Termux-LM is a first-party app within the `termux-extensions-2` framework. It provides a UI for managing llama.cpp models running locally inside the framework shell manager as well as remote LLM providers that expose an OpenAI-compatible chat API. The app is split into a Flask blueprint (`backend.py`), a static HTML template (`template.html`), bespoke styling (`style.css`), and the main frontend controller (`main.js`).

---

## High-Level Flow

1. **Model management** – Users add/edit/delete model definitions. Local models reference a GGUF on disk; remote models capture API configuration (API key, endpoint, model id, optional reasoning effort).
2. **Model loading** – Loading a local model spawns a `llama-server` via the framework shell manager. Loading a remote model simply marks it active (no shell), but flags `remote_ready` so the chat UI unlocks immediately.
3. **Session management** – Each model owns a set of stored chats under `~/.cache/termux_lm/models/<id>/sessions`. Sessions persist messages, run mode, timestamps, and editable titles, and the frontend now re-activates sessions through `/sessions/<id>/activate` whenever a drawer item is selected or renamed so UI state stays in sync with `state.json`.
4. **Chat** – The frontend stream-submits prompts to `/models/<id>/sessions/<session>/chat`. The backend dispatches to llama.cpp or the remote provider and streams responses back to the UI, writing streaming telemetry to `stream.log`. After each stream the session file is reloaded so the chat log reflects the canonical persisted ordering.
5. **Diagnostics** – Shell stdout/stderr are exposed through `/shell/log`, allowing the UI to surface llama.cpp startup and runtime logs, even while a chat stream is running.

---

## Persistence Layout

All runtime state is kept under the user's home cache:

```
~/.cache/termux_lm/
  state.json                # active model/session/run_mode and shell id
  stream.log                # append-only chat stream log (debugging)
  models/
    <model-id>/
      model.json            # manifest written via _write_model_manifest
      sessions/
        <session>.json      # per-session transcript and metadata
```

`state.json` is the source of truth for which model/session is active and which framework shell (if any) is running.

---

## Backend Blueprint (`backend.py`)

### Key Helpers
- `_write_model_manifest` – normalises and atomically writes model metadata.
- `_append_message` – appends messages to a session transcript.
- `_build_llama_command` / `_terminate_shell` – manage local llama.cpp shells via `app.framework_shells`.
- `_remote_*` helpers – construct payloads, headers, and streaming loops for OpenAI-compatible APIs.
- `_state_payload` – packages active state for the frontend, including `remote_ready` for remote models.

### REST Endpoints
- `GET /models` – list all model manifests (sorted by `updated_at`).
- `POST /models` – create a new model (local or remote). Requires `path` for local models and `api_key`/`remote_model` for remotes.
- `PUT|POST /models/<id>` – update an existing model (frontend uses POST for edits).
- `DELETE /models/<id>` – remove model directory; clears active state if the model was loaded.
- `POST /models/<id>/load` – activate a model. For locals, spawns `llama-server` and stores the shell id; for remotes sets `remote_ready`.
- `POST /models/<id>/unload` – terminate llama.cpp shell (if local) and clear active pointers.
- `GET|POST /models/<id>/sessions` – list sessions or create a new one (`run_mode` persisted in state).
- `GET|DELETE /models/<id>/sessions/<session>` – fetch or delete a session transcript.
- `POST /models/<id>/sessions/<session>/activate` – mark a session active and return its payload.
- `POST /models/<id>/sessions/<session>/messages` – append a role/content entry to the transcript.
- `POST /models/<id>/sessions/<session>/chat` – orchestrate chat completions. When `stream` is true, an SSE stream is returned.
- `GET /sessions/active` – describe current active model/session, run mode, shell, and remote readiness.
- `GET /shell/log` – return shell metadata and tail logs (stdout/stderr) for the active llama.cpp shell.

### Chat Routing Logic
```
if model.type == 'remote':
    _remote_chat_completion / _remote_stream_completion
else:
    _llama_chat_completion / _llama_stream_completion
```
Each path records the user's prompt, streams assistant tokens, appends to the session transcript, and logs token flow into `stream.log`.

---

## Frontend Controller (`main.js`)

### State Shape
```js
state = {
  models: [],
  sessions: {},
  activeModelId: null,
  activeSessionId: null,
  runMode: 'chat',
  shell: null,
  remoteReady: false,
  chatMessages: [],
  streaming: false,
  streamController: null,
  pendingModelType: 'local',
  modalMode: 'create' | 'edit',
  modalDraft: {},
  drawerOpen: false,
  activeMenu: null,
};
```
`sessions` caches session lists per model id. `remoteReady` mirrors the backend’s state to mark remote models “loaded” without a shell.

### Main Flows
- **Initialisation**: injects `style.css`, maps DOM elements, binds listeners, kicks off a refresh timer (6s) to sync state/logs.
- **Model modal**: handles create/edit flows, persisting remote fields (`remote_model`, `reasoning_effort`) and reopening draft state.
- **Model cards**: cards show type, status, file/provider, and shell stats when available. Status logic marks remote cards “Ready” when `remoteReady` is true.
- **Menus**: inline menu actions handle load/unload/start session/edit/delete. Active menu state is tracked to close when tapping outside.
- **Shell logs**: `updateShellLogs` writes stdout/stderr panes using `/shell/log`.
- **Sessions**: `startSession`, `ensureSession`, and `openChatOverlay` respect remote models (skip shell requirement). Session drawer lists sessions with delete buttons.
- **Chat**: `sendChatMessage` streams responses via `requestStream`, updating UI incrementally and hydrating the session from disk after completion to remove duplicates.

### Remote-Specific UI Logic
- Helper `isRemoteModel` is used in load/chat guards so remote models are treated as instantly available once `remote_ready` is reported.
- When loading/unloading, the frontend stores `remoteReady` from the backend payload so remote cards display the correct status badge.
- Session rename/delete controls appear in the drawer; rename prompts users and persists via the session detail endpoint.

### Host Integration
Uses the framework host API (`host.toast`, `host.setTitle`, `host.onBeforeExit`) and shared file picker (`window.teFilePicker`) for user feedback and file selection.

---

## Template (`template.html`) Overview

Sections:
1. **Header** – title, description, “Refresh” and “Add Model” buttons.
2. **Shell Status** – displays active model, shell logs, and “Start Chat” button.
3. **Model Grid** – card layout showing models with inline menu.
4. **Run Mode** – radio group for `chat` vs `open_interpreter` (placeholder).
5. **Modal Dialog** – unified create/edit markup. Remote section now includes provider, API key, endpoint, model identifier, reasoning effort.
6. **Chat Overlay** – left drawer of sessions, chat header/back button, chat log, form, token readout, open-interpreter placeholder, overlay background.

---

## Styling (`style.css`) Highlights
- Conforms to the framework’s button/input conventions (`tlm-btn`, `tlm-field`).
- Model cards use CSS variables to highlight active status (including green glow elsewhere in the stylesheet).
- Chat overlay uses flex layouts for the drawer and main panel; responsive data attributes control drawer open/closed state.

---

## Known Limitations / TODOs
1. Remote load state – the backend publishes `remote_ready`, but we still rely on polling. Consider pushing readiness in real time.
2. Modal close UX – after saving edits the dialog remains open; the UI waits for a refresh cycle before showing updated data.
3. Remote chat verification – remote streaming works end-to-end, but we need richer error surfacing/retry logic for flaky providers.
4. Cache hygiene – no automatic rotation of transcripts or log truncation yet.
5. Run mode placeholder – open interpreter mode is disabled (UI hides the form, shows placeholder copy).
6. Session ordering – we keep insertion order. Sorting by last activity would improve navigation.

### Reference Snippets

Backend rename handler:

```python
@termux_lm_bp.route("/models/<model_id>/sessions/<session_id>", methods=["GET", "DELETE", "POST"])
def sessions_detail(model_id: str, session_id: str) -> Any:
    session = _read_json(_session_path(model_id, session_id))
    if request.method == 'POST':
        payload = request.get_json(silent=True) or {}
        title = payload.get('title')
        if not isinstance(title, str) or not title.strip():
            return jsonify({"ok": False, "error": "title is required"}), 400
        session['title'] = title.strip()
        updated = _save_session(model_id, session)
        return jsonify({"ok": True, "data": updated})
```

Frontend session sync snippet:

```javascript
async function syncActiveSession(modelId, sessionId, { quiet = false } = {}) {
  const payload = await API.post(api, `models/${modelId}/sessions/${sessionId}/activate`, {});
  state.activeModelId = modelId;
  state.activeSessionId = sessionId;
  upsertSession(modelId, payload);
  state.chatMessages = payload.messages ?? [];
  renderChatMessages();
}

async function promptRenameSession(session) {
  const updated = await API.post(api, `models/${modelId}/sessions/${session.id}`, { title: trimmed });
  upsertSession(modelId, updated);
  await hydrateSession(modelId, session.id);
  if (state.activeSessionId === session.id) {
    await syncActiveSession(modelId, session.id, { quiet: true });
    renderChatOverlay();
  }
}
```

Remote streaming loop (backend excerpt):

```python
def _remote_stream_completion(model, session, prompt):
    url = _remote_endpoint(model)
    headers = _remote_headers(model)
    payload = _remote_payload(model, session, stream=True, prompt=prompt)
    response = urllib.request.urlopen(urllib.request.Request(url, json.dumps(payload).encode(), headers, 'POST'), timeout=600)
    with response:
        for block in _stream_sse(response):
            if block.get('type') == 'token':
                yield {"type": "token", "content": block['content']}
```

---

## Manual Testing Checklist
- **Model CRUD**: add local model, add remote model, edit remote fields, delete models, ensure manifests update under cache.
- **Load/unload**: load local model (shell should appear in Sessions & Shortcuts), unload it, ensure shell is terminated. Load remote model (card should flip to Ready).
- **Sessions**: create sessions via menu and drawer, delete sessions, ensure transcripts persist under `sessions/*.json`.
- **Chat (local)**: send prompts to a local llama.cpp model, observe token streaming and shell stdout.
- **Chat (remote)**: with a remote model configured, confirm POST/stream responses flow; check logs or developer tools for payload details.
- **Logs**: hit “Refresh Log” and ensure stdout/stderr appear.

---

## TODO Backlog

1. **Streamline the model card config flow** – reduce modal steps, pre-fill defaults, add validation tooltips.
2. **Incorporate a method for system prompting** – expose a per-session/system prompt field persisted with chats.
3. **Automate llama.cpp installation/configuration** – add helpers that install Termux packages (`llama-cpp`, `llama-cpp-backend-opencl`) and seed default manifests.
4. **Hugging Face URI integration** – allow GGUF selection via HF URIs and hand off downloads to the Aria2 framework app.
5. **Open Interpreter integration** – wire the alternate run-mode, including automated pip/apt dependency installs and UI toggles.
6. **RPC/RAG/web search** – add provider hooks for retrieval-augmented generation and search integrations.
7. **Additional polish** – telemetry, transcript export, better logging, and accessibility review.

---

## Installing llama.cpp via Termux APT

The framework expects `llama-server` to be present. On a Termux device:

```bash
pkg update
pkg install llama-cpp
```

For Snapdragon devices with OpenCL acceleration:

```bash
pkg install llama-cpp-backend-opencl
```

After installation, confirm the binary is on PATH:

```bash
llama-server --help
```

Configure Termux-LM to point at your GGUF file (e.g. `~/models/gemma-3-270m-it-F16.gguf`) and the shell manager will launch `llama-server` automatically when you load the model.

---

This document should give future contributors the necessary mental model of the Termux-LM code paths, provide reference snippets, and outline the next set of enhancements.
