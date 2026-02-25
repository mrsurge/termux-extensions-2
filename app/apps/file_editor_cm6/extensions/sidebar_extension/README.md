# Sidebar Extension (Code TE2 / file_editor_cm6)

This folder is the hub for the **iframe sidebar** integration used by the Code TE2 app.

It is intentionally **platform-agnostic**: the front-end talks to the host via HTTP endpoints
(``/api/host/drawer/open`` and ``/api/host/drawer/close``) and to the app backend via FastAPI routes
mounted under ``/api/app/file_editor_cm6``.

## What Lives Here

- ``manifest.json``
  - Metadata + icon used by the front-end to render the sidebar toggle/header icon.

- ``sidebar_extension.py``
  - FastAPI router mounted by ``app/apps/file_editor_cm6/main.py``.
  - Provides lightweight endpoints used by the iframe sidebar:
    - ``POST /api/app/file_editor_cm6/agent/drawer/open``
    - ``POST /api/app/file_editor_cm6/agent/drawer/ui_hints``
    - ``GET  /api/app/file_editor_cm6/agent/cwd`` (CORS-gated for localhost:12359)
    - ``POST /api/app/file_editor_cm6/agent/open`` (broadcast via Explorer WS to host page)
    - ``POST /api/app/file_editor_cm6/agent/open_request`` and ``GET /agent/open_request/next``

- ``sidebar_state.py``
  - In-memory state and a small queue shared by the router:
    - open-count + last-open metadata
    - ``ui_hints`` map
    - open-request queue (host page can poll the next request)

- ``static/js/sidebar_iframe.js``
  - Iframe sidebar controller (open/close, setUrl) used by ``app/apps/file_editor_cm6/main.js``.
  - Talks to the host drawer endpoints:
    - ``/api/host/drawer/open``
    - ``/api/host/drawer/close``

- ``static/js/sidebar_drawer.js``
  - Legacy drawer implementation (kept for reference/compatibility).

## Other Sidebar Touchpoints (Outside This Folder)

- DOM + layout:
  - ``app/apps/file_editor_cm6/template.html`` (sidebar DOM, header elements, iframe stack)

- Front-end state + preferences + shortcut logic:
  - ``app/apps/file_editor_cm6/main.js`` (shortcuts, active selection, header icon list, eager/lazy, prefs wiring)
  - UI preference keys:
    - ``agentActiveShortcutId``
    - ``agentToggleDisplay``
    - ``agentHeaderDisplay``
    - ``agentShortcuts``

If you want the sidebar logic fully centralized, the next step is extracting the sidebar-related code
from ``app/apps/file_editor_cm6/main.js`` into a dedicated module under this extension (or under
``app/apps/file_editor_cm6/static/js/sidebar/``), keeping ``main.js`` as the app bootstrap only.
