# File Editor CM6 Ownership Boundary Contract

This document is optimistic by design.

It describes the ownership boundaries we want `file_editor_cm6` to converge toward, even where the current code still has transitional seams.

## Goal

Keep frontend surfaces as initiation/render layers and keep durable authority in backend-owned hook surfaces and state.

For the current single-project / single-open-document model, the intended split is:

- host page initiates app actions and renders host UI
- editor frontend renders the active document and consumes file-scoped intelligence
- explorer frontend renders project-scoped state and consumes project-scoped intelligence
- backend owns hook surfaces, SSOT updates, and state projection
- WBA is an intelligence producer, not the owner of frontend behavior

## Domain Ownership

### Host Page

Owns:

- toolbar and `fe-menubar` initiation
- terminal drawer open/close orchestration
- side-bar drawer shell open/close/toggle rendering through the main-page sidebar runtime
- problems panel host rendering
- watcher modal / watcher settings UI
- file open/save/run initiation from the host chrome

Should not own:

- direct editor transport semantics
- direct WBA request choreography for non-host domains
- in-app agent transcript/session state or direct Codex appserver socket control
- persistent project/document intelligence state

### Editor Frontend

Owns:

- active document rendering
- file-scoped editor behaviors
- file-scoped diagnostics rendering
- file-scoped git baseline / draft diff rendering
- editor-specific commands such as jump/find/issues navigation

Should not own:

- project-wide watcher state
- project-wide diagnostics state
- explorer tree state
- host toolbar policy

### Explorer Frontend

Owns:

- tree rendering
- open-directories presentation
- explorer-side git decorations presentation
- explorer-side watcher refresh presentation

Should not own:

- editor transport semantics
- terminal execution semantics
- project event production

### Sidebar Shortcut Lane

Owns:

- persisted shortcut preferences and shortcut-modal rendering
- header shortcut rendering and iframe-stack activation
- shortcut-frame coordination through `/sidebar_ipc`
- cwd sync, active shortcut state, refresh/mention relay, and sidebar-originated editor-open requests

Should not own:

- the removed in-app agent transcript/session backend
- direct Codex appserver socket control from the host page
- editor transport semantics
- project state authority outside backend-owned hook surfaces

### Backend Hook Surfaces

Own:

- non-editor host actions
- project-scoped event publication
- editor-facing and explorer-facing projections
- transport boundary parsing

Examples today:

- `host/file_ops_backend.py`
- `host/editor_preferences_backend.py`
- `workspace_events.py`
- `ui_ipc/sidebar_ws.py`

Examples that should continue to move this direction:

- host run-active-file
- project diagnostics publication
- watcher event publication

### Terminal Backend

Owns:

- shell selection/creation/activation
- dispatching run commands into the active terminal shell
- terminal execution semantics for runnable files

Should not own:

- host toolbar button policy
- explorer state
- editor rendering state

### WBA

Owns:

- extension-host intelligence
- diagnostics production
- hover/completion/symbol/folding/semantic-token production
- IPC watcher events from code-server

Should not own:

- frontend state authority
- host/editor/explorer policy
- transport-specific frontend orchestration

## Transport Contract

### Host-Initiated App Actions

Preferred path:

1. host UI initiates
2. `/ui_ipc` request/reply
3. host backend hook
4. domain backend hook/service
5. resulting editor/explorer/host notifications come from backend

Examples:

- open file
- save file
- update editor preferences
- run active file

### Sidebar Drawer And Shortcut Coordination

Preferred path:

1. host or shortcut UI initiates a drawer/shortcut action
2. `/sidebar_ipc` carries sidebar events where cross-surface coordination is required
3. `src/host/connections/ui-ipc.ts` bridges sidebar events into host window events
4. `main_page/frontend/host-sidebar-runtime.ts` applies local drawer shell state
5. backend hook surfaces handle any editor-open or project-state side effects

The old `/agent/*` route family and direct host-to-Codex appserver socket are not part of this contract.

### Editor Intelligence

Preferred path:

1. editor frontend emits file-scoped request
2. editor backend / RPC adapter handles it
3. WBA responds
4. backend projects result to editor consumer

Examples:

- hover
- completions
- semantic tokens
- folding
- active-file diagnostics

### Project Events

Preferred path:

1. producer publishes to backend project/workspace hook surface
2. backend stores or rebroadcasts stable payload shape
3. editor/explorer/host consume their own projections

Examples:

- watcher file changes
- watcher errors
- project diagnostics detail
- git decorations/status changes

## Current Target Call Sites

### Already Moving In The Right Direction

- host open: `src/host/connections/ui-ipc.ts` -> `host/file_ops_backend.py`
- host save: `src/host/connections/ui-ipc.ts` -> `host/file_ops_backend.py`
- host prefs: `src/host/connections/ui-ipc.ts` -> `host/editor_preferences_backend.py`
- project events: producers -> `workspace_events.py`

### Known Transitional / Legacy Areas

- some editor-lane host commands still emit on `/editor`
- `terminal/run_active_file` still exists as HTTP compatibility route
- project events are not yet a full backend state machine
- some legacy backend files still publish directly at consumer edges

## What “Correct” Looks Like

- host page is an initiator and renderer, not a domain owner
- editor frontend is a file-scoped renderer/consumer
- explorer frontend is a project-scoped renderer/consumer
- backend hook surfaces own cross-domain orchestration
- project-wide WBA output lands in backend-owned project event/state surfaces first
- frontend reconnect/reload repopulates from backend state/projections rather than re-querying everything ad hoc

## Immediate Rule Of Thumb

When adding or repairing behavior:

- if it starts in host chrome, prefer `ui_ipc` -> host backend hook
- if it is project-scoped, prefer backend project/workspace event surfaces
- if it is file-scoped editor intelligence, keep it in editor/backend WBA lanes
- do not use frontend transports as backend-to-backend buses unless explicitly parked as temporary
