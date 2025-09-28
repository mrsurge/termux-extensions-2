# Termux-LM Working Notes

This document captures the current state of the Termux-LM app, key design goals, and
practices for contributors.

## Overview

- **App Path:** `app/apps/termux_lm`
- **Backend Blueprint:** `backend.py` — manages model manifests, llama.cpp shell
  orchestration, session storage, and chat completions against the llama-server REST
  API.
- **Frontend Entrypoint:** `main.js` — drives model cards, modal configuration, run
  mode selection, session creation, and shell diagnostics.
- **Template:** `template.html` — defines the Termux-aligned layout for cards, shell
  log view, modal, and chat overlay.
- **Styles:** `style.css` — mirrors the broader framework aesthetic (buttons, cards,
  menus, chat layout).
- **Cache Layout:** Models and sessions live under `~/.cache/termux_lm/models/<id>/`
  with `model.json` and `sessions/*.json`. Global active state is tracked in
  `~/.cache/termux_lm/state.json`.

## Current UX Flow

1. **Landing:** Model cards are the primary UI. Cards show status, type, filename, and
   surface model options via a hamburger menu (load/unload, start session, edit,
   delete). Active models glow green and show CPU/RSS metrics.
2. **Run Mode:** Toggle (`chat` vs `open_interpreter` placeholder) sits above the card
   grid; the selection is stored in backend state for new sessions.
3. **Shell Diagnostics:** Log panel exposes stdout/stderr for the llama.cpp shell and a
   refresh button for manual updates.
4. **Chat Sessions:** The chat drawer and view are scaffolded; session creation is
   wired, with streaming UI to be implemented next.

## Frontend Notes

- **API helpers:** `API_WRAPPER.get/post` wrap `api.get/post` to standardize error
  handling: backend endpoints return `{ ok, data }` objects.
- **Model modal:** `openModelModal(mode, model)` populates fields, manages draft state,
  and integrates the shared file picker (`window.teFilePicker`). When picking a file we
  temporarily close the dialog to avoid z-index clashes.
- **Card menu:** `setupMenu` binds actions inside the inline menu. Keep new card
  features inside this menu to stay consistent.
- **Active shell stats:** `renderShellStats` consumes `state.shell.stats` (cpu, rss_mb)
  when available. Ensure backend descriptions keep those metrics up to date.
- **Run mode radios:** `syncRunModeRadios` mirrors backend state on refresh; keep DOM
  names in sync (`run-mode`).
- **Chat placeholder:** Once streaming is ready, reuse `startSession` to open the chat
  overlay and load session transcripts.

## Backend Notes

- **Persistence helpers:** `_write_model_manifest`, `_save_session`, `_load_state`
  handle atomic JSON writes. Respect these helpers when extending data stored per
  model/session.
- **Shell orchestration:** `_build_llama_command` builds the llama-server CLI,
  `_terminate_shell` safely tears down framework shells. Loading a local model spawns a
  shell; remote models skip shell creation but maintain consistent state.
- **Chat API:** `sessions_chat` currently posts to llama-server with `stream=false`. A
  future enhancement will add streaming via server-sent events or websockets.
- **Active State Endpoint:** `/sessions/active` returns the active model/session/run
  mode and the shell description (including `stats` and recent logs). The frontend uses
  this to hydrate status badges and shell diagnostics.

## Testing & Debugging

- **Run the framework:** `./run_framework.sh` (from repo root) starts the Flask host
  and framework supervisor.
- **Manual checks:**
  - Add/edit/delete models through the modal.
  - Load a local GGUF model; observe the green card glow and CPU/RSS stats.
  - Create a session via the menu; confirm the backend writes `sessions/<id>.json`.
  - Inspect shell logs for llama-server startup output.
- **Logs:** Framework shell metrics are available via `state.shell.stats`. If logs or
  metrics appear stale, trigger `/shell/log` (wired to the refresh button) and ensure
  the backend’s shell manager includes `include_logs=True`.

## Pending Work

- **Chat UI:** Implement session drawer population, chat transcript rendering, and
  llama-server streaming in `main.js` once backend streaming is confirmed.
- **Model menu enhancements:** Add confirmation dialogs or inline status updates as
  more model actions appear.
- **Settings sync:** Persist run-mode preference or recently used models via the host
  state store if needed.

Keep this document updated as the app evolves so future passes have an up-to-date map
of the Termux-LM code path.
