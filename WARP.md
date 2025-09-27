# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project overview
- Python/Flask web framework providing a touch-friendly UI to manage Termux sessions and tools. The backend exposes a small Core API and dynamically loads “extensions” and full-page “apps.” Shell helpers under scripts/ bridge Flask to the Termux environment.

Common commands
- Install dependencies
  - pip install -r requirements.txt
- Hook interactive Termux shells (so they show up/manage cleanly)
  - Source in each interactive shell or add to ~/.bashrc:
    - source scripts/init.sh
- Run the server (development/local)
  - TE_SESSION_TYPE="framework" python app/main.py
  - Notes: built-in server binds 0.0.0.0:8080 with debug disabled; run it from a shell you do NOT want monitored (that shell is hidden by TE_SESSION_TYPE=framework).
- Run the server (LAN/production-style)
  - TE_SESSION_TYPE="framework" gunicorn -w 2 -k gthread --threads 8 -b 0.0.0.0:8080 wsgi:application
  - Adjust workers/threads to device resources. Access via http://<device-ip>:8080
- Framework Shells (long-running background processes)
  - Optional auth: export FS_TOKEN={{TE_FRAMEWORK_SHELL_TOKEN}}  # if configured; omit header below if not set
  - Spawn
    - curl -X POST http://localhost:8080/api/framework_shells \
      -H 'Content-Type: application/json' \
      -H "X-Framework-Key: $FS_TOKEN" \
      -d '{"command":["aria2c","--enable-rpc"],"label":"aria2"}'
  - List
    - curl http://localhost:8080/api/framework_shells
  - Inspect with log tail
    - curl 'http://localhost:8080/api/framework_shells/<id>?logs=true&tail=200'
  - Stop / Kill / Remove
    - curl -X POST http://localhost:8080/api/framework_shells/<id>/action -H 'Content-Type: application/json' -H "X-Framework-Key: $FS_TOKEN" -d '{"action":"stop"}'
    - curl -X DELETE http://localhost:8080/api/framework_shells/<id> -H "X-Framework-Key: $FS_TOKEN"

High-level architecture
- Backend runtime (Flask)
  - Entry points
    - app/main.py: Creates the Flask app, registers the framework_shells blueprint, and exposes core endpoints.
    - wsgi.py: Exposes application for Gunicorn (wsgi:application).
  - Core endpoints (JSON envelope: { ok: true|false, data?, error? })
    - GET /api/browse — Filesystem browser under the user’s home; respects hidden toggle; see docs/shared_file_picker.md for the UI that consumes it.
    - POST /api/run_command — Runs a shell command and returns stdout (use sparingly).
    - GET /api/list_path_executables — Enumerates PATH executables; used by pickers and editors.
    - GET /api/extensions — Returns loaded extension manifests.
    - GET /api/apps — Returns loaded app manifests.
    - GET/POST /api/settings — Lightweight JSON settings persisted under ~/.cache/termux_extensions/settings.json.
    - GET/POST/DELETE /api/state — Shared front-end state store used via window.teState; see docs/state_store.md.
    - Static helpers: /extensions/<ext>/<file> and /apps/<app>/<file> for extension/app assets.
  - Dynamic module loading
    - Extensions: app/extensions/<ext_dir>/manifest.json is required. If manifest.entrypoints.backend_blueprint points to a .py file that defines a Flask Blueprint, it is mounted under /api/ext/<ext_dir>.
    - Apps: app/apps/<app_dir>/manifest.json is required. If manifest.entrypoints.backend_blueprint exists, it mounts under /api/app/<app_id> (id from manifest or directory name). App modules can optionally register WebSocket routes via register_ws_routes(app).
  - Lazy init
    - On first request, load_extensions() and load_apps() populate in-memory registries returned by /api/extensions and /api/apps.
- Framework Shells subsystem
  - Implementation: app/framework_shells.py provides FrameworkShellManager and a Flask blueprint under /api/framework_shells. See docs/framework_shells.md for capabilities and API examples.
  - Purpose: Manage long-lived background processes tagged TE_SESSION_TYPE=framework so they don’t pollute the interactive Sessions UI.
  - State & logs: ~/.cache/te_framework/{meta,logs,sockets}. Each shell has a stable id (fs_<timestamp>_<uuid8>) with stdout/stderr logs. PTY-backed shells stream output into logs and fan-out to subscribers (used internally by apps).
  - Config: TE_FRAMEWORK_SHELL_TOKEN (optional header X-Framework-Key on mutations), TE_FRAMEWORK_SHELL_MAX (default 5), TE_FRAMEWORK_SHELL_DIR (override state dir).
- Termux bridge scripts (scripts/)
  - init.sh: Wraps interactive shells in dtach, writes session metadata to ~/.cache/te/<SID>, and sets TE_SESSION_TYPE (interactive by default). Source this in shells to participate in the UI.
  - list_sessions.sh: Emits JSON for active interactive sessions (consumed by the Sessions & Shortcuts extension/app).
  - browse.sh, list_path_execs.sh, run_in_session.sh, get_system_stats.sh, manage_helper.sh: Backend helpers bridging to the device environment.
- Frontend shell (PWA)
  - Templates: app/templates/index.html (launcher) and app/templates/app_shell.html (container for full-page apps).
  - Host API & shared primitives: index.html loads extensions dynamically and exposes helpers: teFetch, teUI.toast, teState (app/static/js/te_state.js), and teFilePicker (app/static/js/file_picker.js). See docs/state_store.md and docs/shared_file_picker.md.
  - Service Worker: app/static/js/sw.js provides basic caching for installability and resilience.

Notes and rules from project docs
- Running the backend from a non-monitored shell: Set TE_SESSION_TYPE="framework" so the control shell stays hidden in the UI (README.md).
- Response envelope: All endpoints (core and per-extension/app) must return { ok, data } on success or { ok: false, error } on failure (CORE_API_MANUAL.md).
- Extension/app isolation: Only modify code inside app/extensions/<name>/ or app/apps/<id>/ unless explicitly asked to change core (CORE_API_MANUAL.md, PLANNER_GUARDRAILS.md).
- Security constraints baked into core endpoints:
  - /api/browse restricts access to paths under $HOME; rejects traversal outside (with optional sudo fallback limited by root param).
  - Mutating framework shells requests can be gated by X-Framework-Key when TE_FRAMEWORK_SHELL_TOKEN is set.

Docs to consult first
- README.md — How to run locally and via Gunicorn; PWA install notes; key features (Sessions & Shortcuts, Framework Shells, Universal Picker, Built-in Diagnostics).
- CORE_API_MANUAL.md — Definitive reference for Core API contracts and the response envelope.
- docs/framework_shells.md — Manager behaviour, endpoints, and usage walkthrough.
- docs/state_store.md — window.teState helper and /api/state contract.
- docs/shared_file_picker.md — window.teFilePicker usage and behaviours.
- docs/PROJECT_SPECIFICATION.md, docs/UI_FLOW.md — Big-picture architecture and launcher flow.
- docs/distro_design.md, docs/distro_states.md — Distro app state machine and lifecycle (mount/start/stop; cleanup endpoint).
- docs/terminal_app.md — Terminal app WebSocket architecture and xterm.js integration.
- docs/aria_downloader_framework_integration.md — Example integration using framework shells.

What’s not configured in this repo (as of now)
- No Python test suite or runner is present (no tests/, pytest.ini, or tox.ini). If a test harness is added later, add how to run a single test here.
- No formatter/linter configuration is present (e.g., black/flake8).

Key files to know
- app/main.py — Flask app, extension/app discovery, core endpoints (incl. /api/state, /api/settings).
- app/framework_shells.py — Background process manager + blueprint.
- app/static/js/te_state.js, app/static/js/file_picker.js — Shared front-end primitives referenced in docs.
- scripts/ — Termux integration scripts (init.sh, list_sessions.sh, etc.).
- app/templates/, app/static/ — UI shell, PWA artifacts (service worker in app/static/js/sw.js).
- wsgi.py — Gunicorn entrypoint.
- README.md, docs/* — Run instructions and deeper architectural references.
