# Repository Structure

This document outlines the layout of the `termux-extensions-2` repository with an emphasis on the current Code CM6 editor stack and supporting infrastructure.

```
.
├── AGENTS.md                      # Operating instructions for agents working on the repo
├── CHANGELOG_2025_10_28.md        # Latest release notes for the Code CM6 milestone
├── CODE_CM6_DOCUMENTATION.md      # Complete technical reference for the Code CM6 app
├── README.md                      # Project overview, setup, and architecture summary
├── README_code_cm6.md             # Quick-start guide for the Code CM6 editor
├── REPO_STRUCTURE.md              # (This file) Detailed repository map
├── auto_save_implementation.md    # Spec for future bi-directional editor sync work
├── code_cm6_inline_diff_architecture.md # Inline diff implementation deep dive
├── code_cm6_todo.md               # Active backlog for the Code CM6 roadmap
├── docs/                          # Global documentation (framework shell internals, state store, etc.)
├── requirements.txt               # Python dependencies for Flask backend
├── scripts/                       # Bootstrap and helper scripts for Termux integration
│   ├── bootstrap_termux.sh        # One-step setup for fresh Termux installs
│   ├── run_framework.sh           # Launches the supervisor entrypoint
│   └── ...
├── app/                           # Main Flask application package
│   ├── main.py                    # Root Flask entrypoint + WebSocket proxy
│   ├── supervisor.py              # Framework supervisor and lifecycle management
│   ├── libs/                      # Shared Python libraries
│   │   ├── framework_shells.py    # PTY shell lifecycle + log streaming helpers
│   │   ├── app_manager.py         # Discovers apps and manages worker processes
│   │   └── ...
│   ├── extensions/                # Modular dashboard extensions
│   │   ├── sessions_and_shortcuts/
│   │   ├── system_stats/
│   │   └── ...
│   ├── apps/                      # Bundled full-page applications
│   │   ├── file_editor_cm6/       # "Code CM6" editor (current flagship)
│   │   │   ├── manifest.json      # Registers the app with the framework shell
│   │   │   ├── main.py            # Flask blueprint + REST and WebSocket routes
│   │   │   ├── core_read.py       # File watcher + WebSocket diff notifications
│   │   │   ├── core_write.py      # Write handler with diff cache invalidation
│   │   │   ├── diff_helper.py     # Git diff orchestration and caching
│   │   │   ├── explorer_helper.py # File tree generation and metadata enrichment
│   │   │   ├── history_store.py   # Disk-backed recent project/file history
│   │   │   ├── preferences_store.py # Disk-backed editor/view preferences
│   │   │   ├── terminal_shell.py  # Framework shell helpers for the embedded terminal
│   │   │   ├── terminal_backend.py# Terminal REST + WebSocket adapter
│   │   │   ├── template.html      # App HTML shell, drawers, and header layout
│   │   │   └── static/
│   │   │       └── js/
│   │   │           ├── diff_decorations.js # CodeMirror 6 inline diff controller
│   │   │           ├── explorer.js         # Explorer drawer UI + bridge handshake
│   │   │           ├── explorer.css        # Drawer styling (exports as CSS string)
│   │   │           └── terminal.js         # xterm.js lifecycle + shell persistence
│   │   ├── terminal/             # Standalone terminal app (legacy but maintained)
│   │   ├── file_editor/          # Legacy CM5 editor (kept for compatibility)
│   │   ├── file_editor_monaco/   # Monaco-based editor (deprecated)
│   │   ├── code_oss/             # Code OSS wrapper (deprecated; retained for reference)
│   │   └── ...                   # Additional bundled apps (distro manager, etc.)
│   └── templates/                # Global Flask templates for the SPA shell
│       ├── app_shell.html
│       └── index.html
└── wsgi.py                       # WSGI entrypoint for Gunicorn deployments
```

### Notes on Deprecated Apps

- `app/apps/code_oss/` and `app/apps/file_editor_monaco/` remain in the tree for historical reference but are no longer the primary editor experience. New development targets `file_editor_cm6/`.
- When trimming unused assets, ensure documentation and navigation (Apps extension) reflect any removals.

### Key Documentation

- `CODE_CM6_DOCUMENTATION.md` — Authoritative source for Code CM6 architecture, WebSocket proxying, diff pipeline, terminal drawer, and roadmap items.
- `code_cm6_todo.md` — Live backlog with completion dates for shipped features.
- `code_cm6_inline_diff_architecture.md` — Historical record of the diff pipeline (kept for reference).
- `CHANGELOG_2025_10_28.md` — Latest milestone summary; use it when updating other docs.

### Script Highlights

- `scripts/bootstrap_termux.sh` — Installs system packages, Python deps, and shell hooks on a fresh Termux device.
- `scripts/run_framework.sh` — Preferred entrypoint for the supervisor; generates `TE_RUN_ID` and manages cleanup.
- `scripts/vendor_cm6.sh` — Vends CodeMirror 6 assets into `app/static/vendor`.

Update this file whenever major directories move, new apps are added, or deprecated components are removed.
