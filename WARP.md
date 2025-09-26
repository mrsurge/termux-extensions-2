# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Project overview
- This is a Python/Flask web framework that runs locally to provide a touch-friendly UI for controlling Termux sessions and tools. The backend exposes a small core API and dynamically loads “extensions” and full-page “apps.” Shell helpers in scripts/ bridge Flask to the Termux environment.

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
    - GET /api/browse — Limited filesystem browser under the user’s home directory; calls scripts/browse.sh
    - POST /api/run_command — Runs a shell command and returns stdout (use sparingly)
    - GET /api/list_path_executables — Enumerates PATH executables; calls scripts/list_path_execs.sh
    - GET /api/extensions — Returns loaded extension manifests
    - GET /api/apps — Returns loaded app manifests
    - Service worker served at /sw.js for PWA installability
  - Dynamic module loading
    - Extensions: app/extensions/<ext_dir>/manifest.json is required. If manifest.entrypoints.backend_blueprint points to a .py file that defines a Flask Blueprint, it is mounted under /api/ext/<ext_dir>.
    - Apps: app/apps/<app_dir>/manifest.json is required. If manifest.entrypoints.backend_blueprint exists, it mounts under /api/app/<app_id> (id from manifest or directory name). Frontend HTML/JS is loaded dynamically by the UI.
  - Lazy init: On first request, load_extensions() and load_apps() populate in-memory registries used by /api/extensions and /api/apps.
- Framework Shells subsystem
  - Implementation: app/framework_shells.py provides FrameworkShellManager and a Flask blueprint under /api/framework_shells.
  - Purpose: Manage long-lived, background processes tagged TE_SESSION_TYPE=framework so they don’t pollute the interactive Sessions UI.
  - State & logs: ~/.cache/te_framework/{meta,logs,sockets}. Each shell has a stable id (fs_<timestamp>_<uuid8>) with stdout/stderr logs.
  - Config: TE_FRAMEWORK_SHELL_TOKEN (optional header X-Framework-Key on mutations), TE_FRAMEWORK_SHELL_MAX (default 5), TE_FRAMEWORK_SHELL_DIR (override state dir).
- Termux bridge scripts (scripts/)
  - init.sh: Wraps interactive shells in dtach, writes session metadata to ~/.cache/te/<SID>, and sets TE_SESSION_TYPE (interactive by default). Source this in shells to participate in the UI.
  - list_sessions.sh: Reads ~/.cache/te entries and emits JSON for active interactive sessions (typically consumed by a “Sessions & Shortcuts” extension).
  - browse.sh, list_path_execs.sh, run_in_session.sh: Helpers the backend uses to bridge to the device environment.
- Frontend shell (PWA)
  - Templates: app/templates/index.html (launcher) and app/templates/app_shell.html (container for full-page apps).
  - Dynamic UI: index.html requests /api/extensions then injects each extension’s frontend_template and optionally imports its frontend_script as an ES module. A small host API (teFetch, teUI.toast) is exposed to keep extension code consistent.
  - Service Worker: app/static/js/sw.js provides basic caching for installability and resilience.

Notes and rules from project docs
- Running the backend from a non-monitored shell: Set TE_SESSION_TYPE="framework" in the server’s environment so the control shell stays hidden in the UI (README.md).
- Response envelope: All endpoints (core and per-extension/app) should return { ok, data } on success or { ok: false, error } on failure (CORE_API_MANUAL.md).
- Extension/app isolation: Only modify code inside app/extensions/<name>/ or app/apps/<id>/ unless explicitly asked to change core (CORE_API_MANUAL.md, PLANNER_GUARDRAILS.md).
- Security constraints baked into core endpoints:
  - /api/browse restricts access to paths under $HOME; rejects traversal outside.
  - Mutating framework shells requests can be gated by X-Framework-Key when TE_FRAMEWORK_SHELL_TOKEN is set.

What’s not configured in this repo (as of now)
- No Python test suite or runner is present (no tests/, pytest.ini, or tox.ini). If a test harness is added later, prefer documenting how to run a single test here.
- No formatter/linter configuration is present (e.g., black/flake8).

Key files to know
- app/main.py — Flask app, extension/app discovery, core endpoints
- app/framework_shells.py — Background process manager + blueprint
- scripts/ — Termux integration scripts (init.sh, list_sessions.sh, etc.)
- app/templates/, app/static/ — UI shell, PWA artifacts
- wsgi.py — Gunicorn entrypoint
- README.md, docs/* — Run instructions and deeper architectural references
