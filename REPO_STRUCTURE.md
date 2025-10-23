# Repository Structure

This document provides an annotated view of the `termux-extensions-2` repository structure.

```
.
├── AGENTS.md - Internal documentation for agent-based development.
├── auto_save_implementation.md - Technical specification for the bi-directional editor sync feature.
├── build/ - Build-related configuration files.
│   └── config.gypi - Configuration for node-gyp builds.
├── CODE_OSS_APP_README.md - Technical overview of the Code OSS application wrapper.
├── CODE_OSS_APP_TODO.md - To-do list and feature planning for the Code-OSS app.
├── docs/ - Design notes, specifications, and deep-dive documents.
├── GEMINI.md - Context and operating instructions for the Gemini Code Assistant.
├── node_modules/ - (Directory) Node.js dependencies for frontend tooling or extensions.
├── README.md - Main project README with setup and usage instructions.
├── requirements.txt - Python dependencies for the Flask backend.
├── scripts/ - Shell scripts for bootstrapping, process management, and framework interaction.
│   ├── bootstrap_termux.sh - Sets up a fresh Termux environment with all dependencies.
│   ├── browse.sh - Utility script to open URLs.
│   ├── get_system_stats.sh - Retrieves and displays system metrics.
│   ├── init.sh - Sourced by `.bashrc` to register interactive shells with the framework.
│   ├── list_path_execs.sh - Lists executables in the system PATH.
│   ├── list_sessions.sh - Lists active framework shell sessions.
│   ├── list_shortcuts.sh - Lists user-defined shortcuts.
│   ├── manage_helper.sh - Helper script for various management tasks.
│   ├── run_framework.sh - Main entrypoint script to start the framework supervisor.
│   ├── run_in_session.sh - Executes a command within a specific framework shell.
│   └── vendor_cm6.sh - Script to vendor CodeMirror 6 assets.
├── temp/ - (Directory) Temporary file storage.
├── TODO.md - General project-wide to-do list.
├── wsgi.py - WSGI entrypoint for deploying the Flask app with Gunicorn.
├── app/
│   ├── __init__.py - Initializes the `app` package.
│   ├── main.py - Main Flask application entrypoint; bootstraps and registers blueprints.
│   ├── supervisor.py - Manages the lifecycle of the entire framework and its background services.
│   ├── utils.py - General utility functions for the application.
│   ├── apps/ - (Directory) Contains self-contained, full-page applications.
│   │   ├── code_oss/ - The Code OSS editor application.
│   │   │   ├── __init__.py - Initializes the `code_oss` app package.
│   │   │   ├── backend.py - Flask blueprint; manages `code-server` lifecycle and the event bridge.
│   │   │   ├── editor.py - Handles all file I/O operations (read, write) for the editor.
│   │   │   ├── history_store.py - Manages recent project and file history on disk.
│   │   │   ├── manifest.json - Describes the Code OSS app to the framework.
│   │   │   ├── preferences_store.py - Manages editor and UI preferences on disk.
│   │   │   ├── template.html - Main HTML template for the Code OSS app.
│   │   │   ├── static/ - Static assets for the Code OSS app.
│   │   │   │   ├── css/ - Stylesheets for the Code OSS app.
│   │   │   │   ├── js/ - JavaScript for the Code OSS app.
│   │   │   │   │   └── ide_fullpage.js - Core frontend logic for the CM6 editor, explorer, and event handling.
│   │   │   │   └── vendor/ - (Directory) Vendored Monaco editor assets.
│   │   │   └── bridge_extension/ - VS Code web extension that runs inside `code-server`.
│   │   │       └── extension.js - Captures VS Code events and forwards them to the Flask backend.
│   │   ├── terminal/ - A full-featured terminal application.
│   │   │   ├── backend.py - Flask backend for the terminal app, likely handling PTY spawning.
│   │   │   ├── main.js - Frontend JavaScript for the terminal UI (using xterm.js).
│   │   │   └── manifest.json - Describes the Terminal app to the framework.
│   │   └── ... (other applications like file_explorer, settings, etc.)
│   ├── extensions/ - (Directory) Contains modular extensions that add functionality.
│   │   ├── apps/ - An extension for managing other apps.
│   │   ├── network_tools/ - Provides network diagnostic tools.
│   │   ├── process_manager/ - UI for viewing and managing system processes.
│   │   ├── sessions_and_shortcuts/ - Manages terminal sessions and user-defined shortcuts.
│   │   └── system_stats/ - Displays real-time system statistics.
│   ├── libs/ - (Directory) Shared Python libraries and services for the backend.
│   │   ├── app_lifecycle.py - Manages the lifecycle of individual applications.
│   │   ├── app_manager.py - Discovers and loads app modules.
│   │   ├── framework_shells.py - Core logic for managing background shell processes.
│   │   ├── jobs.py - A system for managing and reporting progress on background jobs.
│   │   └── ... (other shared libraries)
│   ├── static/ - (Directory) Global static assets for the main UI.
│   │   ├── js/ - Shared JavaScript utilities.
│   │   │   ├── file_picker.js - The universal file picker modal component.
│   │   │   └── te_state.js - The client-side state-store helper.
│   │   └── vendor/ - (Directory) Third-party frontend libraries (CodeMirror, xterm.js, etc.).
│   └── templates/ - (Directory) Global Flask templates for the main application shell.
│       ├── app_shell.html - The main single-page application shell.
│       └── index.html - The main landing page.
└── ...
```