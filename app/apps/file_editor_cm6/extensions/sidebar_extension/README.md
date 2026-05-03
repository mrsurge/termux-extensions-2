# Sidebar Extension (Code TE2 / file_editor_cm6)

This folder now contains the main-page sidebar shortcut frontend only.

The old in-app agent harness, transcript/session UI, direct Codex appserver socket,
and `/agent/*` FastAPI routes were removed. The Codex agent runtime is a separate
TE2 app (`app/apps/codex_agent`) and is loaded through sidebar shortcuts.

## Live Surfaces

- `static/js/sidebar_shortcuts.js`
  - Owns sidebar shortcut preferences, the shortcut modal, header shortcut icons,
    iframe stack activation, and framework-app shortcut startup.
- `/sidebar_ipc` on path `/ui_ipc_ws/socket.io`
  - Owns host/shortcut-frame coordination, cwd sync, active shortcut state,
    refresh requests, mentions, and sidebar-originated editor-open requests.
- `app/apps/file_editor_cm6/ui_ipc/sidebar_ws.py`
  - Backend handler set for the live sidebar IPC namespace.
- `app/apps/file_editor_cm6/main_page/frontend/host-sidebar-runtime.ts`
  - Main-page drawer controller for local toolbar clicks plus sidebar RPC/IPCs
    such as drawer open/close/toggle events.

## Preserved Contracts

The DOM ids and UI preference keys still use the historical `agent*` names because
existing sidebar shortcut preferences and CSS depend on them:

- `agentActiveShortcutId`
- `agentToggleDisplay`
- `agentHeaderDisplay`
- `agentShortcuts`
- `#agent-drawer`, `#fe-agent-toggle`, and shortcut-modal ids

Those names are compatibility surface for sidebar shortcuts, not proof that the
old in-app agent harness still exists.
