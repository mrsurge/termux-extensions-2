# Termux-LM Remote Support Notes

## Remote Model Forms
- `template.html` now includes remote-only inputs for **Model Identifier** (`remote_model`) and **Reasoning Effort**.
- `main.js` validates these fields, normalises the values, and carries them forward in edit mode.
- The modal stores the active draft so edits pre-populate correctly and update the same card instead of creating duplicates.

## Backend Additions
- Manifest writer persists `remote_model` and `reasoning_effort` for API-backed models.
- Remote helpers (`_remote_endpoint`, `_remote_headers`, `_remote_payload`, `_remote_chat_completion`, `_remote_stream_completion`) implement an OpenAI-style `/v1/chat/completions` flow with streaming tokens.
- `sessions_chat` automatically dispatches to llama.cpp or the remote provider, reusing the SSE pipeline.
- Model updates accept both `PUT` and `POST`, matching the frontend’s use of `api.post` for edit saves.

## Frontend Chat & Load Flow
- New helpers `getModelById` / `isRemoteModel` let the UI distinguish remotes from locals everywhere.
- Remote cards no longer wait for a framework shell to mark themselves “ready”; the backend publishes `remote_ready`, and `main.js` tracks it so remote cards display status instantly.
- `handleStartChat`, `createSessionFromDrawer`, `ensureSession`, `startSession`, and `openChatOverlay` all bypass shell checks for remote models but keep the guard for llama.cpp locals.
- Message streaming now hydrates the session from disk after completion, preventing duplicates and keeping history in sync.

## Known Issues
- Editing a remote model still keeps the modal open after save and the UI doesn’t show the updated value until interactively refreshed.
- Remote cards display status with the new “Ready” badge, but the chat overlay still doesn’t open because the front-end never receives a usable `remote_ready` signal from the backend’s load call in the running server build. Further investigation required.

