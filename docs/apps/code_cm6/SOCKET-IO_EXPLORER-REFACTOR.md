# Socket.IO Explorer Refactor

> **PR Summary** — Major architectural migration from REST/fetch to WebSocket-driven explorer

## Overview

This refactor replaces the REST-based file explorer with a real-time WebSocket architecture, enabling live file system updates, collaborative editing support, and robust state synchronization across clients.

## Key Architectural Changes

| Change | Description |
|--------|-------------|
| **WebSocket Protocol** | Replaced REST endpoints with typed message handlers (`explorer:*`, `git:*`, `search:*`, `review:*`) |
| **Connection Manager** | Multi-client support with project-based connection tracking and lifecycle management |
| **File Watcher Integration** | External filesystem changes automatically notify connected clients |
| **Draft Notifications** | Debounced (500ms) broadcasts keep explorer in sync with editor draft state |
| **Unified Status Flow** | Git and draft status propagate to ancestor directories even when collapsed |

## Files Changed

| File | Changes |
|------|---------|
| `app/ipc/server.py` | Removed duplicate SocketIO import |
| `app/apps/file_editor_cm6/template.html` | Added Socket.IO CDN; restructured git footer (two rows) |
| `app/apps/file_editor_cm6/main.js` | WebSocket connection setup; removed redundant refresh calls |
| `app/apps/file_editor_cm6/explorer_ws.py` | **New** — WS dispatcher, connection manager, message handlers, broadcasts |
| `app/apps/file_editor_cm6/explorer_helper.py` | Draft cache (5s TTL), git flags, performance instrumentation |
| `app/apps/file_editor_cm6/static/js/explorer.js` | WS-driven rendering, status propagation, hunk formatting |
| `app/apps/file_editor_cm6/static/js/explorer.css` | Git status styling, draft indicators, `fe-dir-has-*` classes |
| `app/apps/file_editor_cm6/explorer/search.py` | **New** — Name/content/changes search implementations |
| `app/apps/file_editor_cm6/explorer/review.py` | **New** — Draft management, bulk save/discard |
| `app/apps/file_editor_cm6/core_read.py` | Explorer notification hooks in file watcher |
| `app/apps/file_editor_cm6/main.py` | WebSocket route integration, draft state notifications |
| `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` | Draft state notifications on save/discard |
| `notes/`, `docs/` | Architecture, protocol, and implementation documentation |

## Protocol Summary

| Direction | Event Types |
|-----------|-------------|
| **Outbound (Client → Server)** | `explorer:list`, `explorer:refresh`, `explorer:createFile`, `explorer:rename`, `explorer:delete`, `git:stage`, `git:commit`, `search:run`, `review:save` |
| **Inbound (Server → Client)** | `project:setActive`, `explorer:setList`, `explorer:updateDecorations`, `explorer:updateGitStatus`, `git:status`, `git:diffBaseSet`, `search:setResults`, `review:setEntries` |

---

_VectorArc, 2025-12-01_