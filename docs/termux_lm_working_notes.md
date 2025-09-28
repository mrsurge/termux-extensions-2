# Termux-LM Working Notes

This document captures the current state of the Termux-LM app, design goals, and practices for contributors.

## Overview
- **App Path:** `app/apps/termux_lm`
- **Backend Blueprint:** `backend.py` — manages model manifests, llama.cpp shell orchestration, session storage, and chat completions (local + remote).
- **Frontend Entrypoint:** `main.js` — drives model cards, modal configuration, session drawer, chat streaming, and shell diagnostics.
- **Template:** `template.html` — Termux-themed layout for status header, card grid, run-mode radios, and chat overlay.
- **Styles:** `style.css` — aligns buttons, cards, drawers, and chat bubbles with the framework aesthetic (`tlm-*` classes).
- **Cache Layout:** `~/.cache/termux_lm/` stores manifests, sessions, `state.json`, and `stream.log`.

## UX Flow Recap
1. Landing shows model cards with status, provider/file name, CPU/RSS for active shells.
2. Run-mode radios (chat vs open interpreter placeholder) persist via `/sessions/active`.
3. Shell status panel surfaces stdout/stderr and provides a manual refresh button.
4. Chat overlay slides in when a session is active; remote/local sessions share the same UI, including rename/delete icons.

## Frontend Implementation Notes
- **State polling:** `refreshState()` hits `/sessions/active`, populates `remoteReadiness`, hydrates sessions.
- **Model modal:** toggles between local/remote forms, integrates `teFilePicker` for GGUF selection.
- **Session drawer:** `renderSessionList()` renders each session with `×` (delete) and `✏️` (rename). Renames prompt the user and call the backend; deletions trim the local state cache.
- **Chat streaming:** `requestStream()` consumes the SSE feed, updating the pending assistant bubble and reloading the session JSON post-stream to remove duplicates.
- **Whitespace preservation:** chat bubbles use `white-space: pre-wrap`, so streamed markdown/text keeps indentation and newlines.

## Backend Implementation Notes
- **Persistence helpers:** `_write_model_manifest`, `_save_session`, `_append_message` keep JSON atomic and normalized.
- **Shell management:** `_build_llama_command` constructs `llama-server` CLI; `_terminate_shell` removes stale shells.
- **Remote helpers:** `_remote_endpoint`, `_remote_headers`, `_remote_payload`, `_remote_stream_completion` implement an OpenAI-compatible pipeline (tested against OpenRouter).
- **Session rename:** `POST /models/<id>/sessions/<session>` accepts `{ "title": "..." }` and rewrites the JSON; delete removes the file.
- **Streaming logs:** `_append_stream_log` writes token flow and errors to `~/.cache/termux_lm/stream.log` for debugging.

```python
# Example: rename endpoint (backend)
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

## Manual Testing Checklist (updated)
- Add local & remote models; verify manifest JSON.
- Load/unload local models; confirm shell card glow + CPU/RSS update and stdout log refresh.
- Load remote models; ensure cards display "Ready", chat overlay opens without shell.
- Create, rename, delete sessions; check `sessions/*.json` for updated titles and message transcripts.
- Send chat messages (local): confirm streaming tokens and shell log output.
- Send chat messages (remote): confirm streamed tokens and no connection errors.
- Inspect `stream.log` after both runs to confirm start/token/done entries.

## Quick Commands
```bash
# Run framework
./run_framework.sh

# Tail stream log
tail -f ~/.cache/termux_lm/stream.log

# Inspect active shell
toolbox/run_framework_shell.sh list
```

## TODO Backlog (see detailed list in overview)
- Streamline model modal flow
- Add system prompt support per session
- Automate llama.cpp apt install/bootstrap
- Integrate Hugging Face URIs via Aria2
- Wire up Open Interpreter mode
- Add retrieval/web search integrations
- Improve transcript sorting/export/log rotation

## Termux llama.cpp Installation
```bash
pkg update
pkg install llama-cpp
# Optional GPU backend for Snapdragon devices
pkg install llama-cpp-backend-opencl
```
Run `llama-server --help` to verify installation, then point Termux-LM to your GGUF model.

---
Keep this file alongside `docs/termux_lm_overview.md` for quick pointers while developing.
