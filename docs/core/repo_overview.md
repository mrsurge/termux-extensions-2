# Repository Overview

This document summarizes the structure of the `termux-extensions-2` repository to help new contributors ramp up quickly.

## Top-Level Layout

- **`app/`** – Flask web application that serves the Termux Extensions UI and API. It includes the backend entrypoint, shared libraries, per-app backends, and extension blueprints.
- **`docs/`** – Design notes, specifications, and app/extension deep dives. Highlights include runtime shell management docs and UI flow references.
- **`scripts/`** – Shell helpers for bootstrapping Termux devices, launching the framework supervisor, and interacting with background shells.
- **`termux-deb/`** – Debian packaging assets for distributing the framework as an installable Termux package.
- **`wsgi.py`** – Gunicorn-compatible WSGI entrypoint that imports the Flask application configured in `app/main.py`.
- **`requirements.txt`** – Python dependencies for running the framework locally or on-device.

## Backend Entry Points

- **`app/main.py`** bootstraps the Flask application, registers blueprints, exposes WebSocket support (`flask_sock`), and wires runtime metadata (such as `TE_RUN_ID`) into dynamically loaded modules.
- **`app/supervisor.py`** coordinates the overall framework lifecycle, ensuring the background services are ready before exposing the UI.
- **`wsgi.py`** simply imports the configured Flask app for production use via Gunicorn or other WSGI servers.
- **Supervisor Script**: `scripts/run_framework.sh` sets up environment variables and runs the supervisor entrypoint used during development.

## Shared Libraries

`app/libs/` hosts reusable services that power the extensions and apps:

- `framework_shells.py` tracks background shells, handles process bookkeeping, and exposes REST/WebSocket interfaces for the UI.
- `app_manager.py` and `app_worker.py` orchestrate on-demand workers that host app-specific backends.
- `jobs.py` provides a registry for background jobs with progress reporting.
- `archiver.py` and `archiver_service.py` wrap libarchive-based extraction utilities.
- `bookmarks.py` maintains the user bookmark state exposed to file pickers.
- `shell_groups.py` collects related framework shells into logical groups for management and cleanup.

## Apps and Extensions

The `app/apps/` directory contains feature-focused backends (e.g., the terminal, file explorer, distro manager, settings UI). Each app exposes a blueprint consumed by the SPA frontend.

The `app/extensions/` directory contains modular extension blueprints that complement the apps. Examples include the sessions/shortcuts controller, network tools, and system statistics panels. Extensions can register API routes, WebSocket handlers, and background workers.

## Frontend Assets

- `app/static/` provides compiled JavaScript/CSS assets and icons that power the web UI.
- `app/templates/` contains the Flask templates used to serve the main SPA shell and supporting HTML endpoints.

## CLI & Shell Utilities

The `scripts/` folder is the primary touchpoint for Termux device automation:

- `bootstrap_termux.sh` installs packages, Python dependencies, and shell hooks on a clean Termux environment.
- `init.sh` is sourced from `~/.bashrc` to register interactive shells with the framework.
- `run_in_session.sh`, `list_sessions.sh`, and related helpers wrap framework-shell API calls for managing sessions from the command line.
- `browse.sh` and `get_system_stats.sh` surface specific extension functionality for diagnostics or automation workflows.

## Additional Documentation

Several in-depth references live in `docs/`:

- `framework_shells.md` describes the lifecycle management API and metrics published by the supervisor.
- `state_store.md` explains the persistent browser-side storage exposed through `/api/state`.
- `shared_file_picker.md` outlines the universal picker component reused across apps and extensions.
- `docs/apps/terminal/terminal_app.md` and `docs/planning/distro_design.md` cover the architecture of major bundled apps.
- `termux_lm_setup_termux.md` steps through the Termux bootstrap script invoked by `scripts/bootstrap_termux.sh`.

These documents are invaluable when extending the framework or debugging the runtime.

## Development Workflow Tips

1. Install dependencies with `pip install -r requirements.txt`.
2. For local iteration, run `TE_SESSION_TYPE="framework" python app/main.py` to launch the Flask development server.
3. Source `scripts/init.sh` in any shell that should be tracked by the framework (`source scripts/init.sh`).
4. Use the metrics endpoint (`/api/framework/runtime/metrics`) to verify shell registration and background job health.
5. Consult `docs/PROJECT_SPECIFICATION.md` and `UI_FLOW.md` for product requirements and navigation patterns before implementing significant UI changes.

Keeping these touchpoints in mind will help new contributors become productive quickly.
