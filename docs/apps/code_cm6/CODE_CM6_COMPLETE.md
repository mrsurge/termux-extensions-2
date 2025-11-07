# Code CM6 — Complete Technical Documentation

**Last Updated:** November 2, 2025

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Agent Drawer (Backend-Driven)](#agent-drawer-backend-driven)
4. [Responsive Layout System](#responsive-layout-system)
5. [Real-Time Features](#real-time-features)
6. [Backend Components](#backend-components)
7. [Frontend Components](#frontend-components)
8. [State Persistence](#state-persistence)
9. [REST & WebSocket API Reference](#rest--websocket-api-reference)
10. [Active TODO List](#active-todo-list)

---

## Overview

The `file_editor_cm6` app is a full-featured CodeMirror 6 editor bundled with Termux Extensions 2. It provides a native-feeling code editing experience optimized for mobile devices, with real-time file synchronization, live Git diffs, embedded terminal drawer, and AI agent integration.

### Key Design Principles

- **Mobile-first**: Android long-press selection, touch-friendly UI, PWA installable
- **Real-time**: WebSocket-driven file changes, diff updates, terminal, and agent streaming
- **Persistent**: Disk-backed project state, session recovery, preference storage
- **Isolated**: Runs in its own framework worker process for stability
- **Git-aware**: Built-in branch controls, footer staging/commit/push helpers
- **Backend-driven agents**: 100% of agent session state lives on the backend

### Key Features

- **Real-time file change notifications** via WebSocket
- **Live inline Git diffs** with instant updates on save/external changes
- **Embedded terminal drawer** with session persistence and history replay
- **Branch dropdown + Git footer** for Stage/Unstage/Commit/Push/Pull
- **AI Agent Integration** with Codex MCP server via backend persistence
- **Convergent responsive layout** adapting between desktop and mobile
- **Android-native selection mode** with long-press detection
- **Project-based file management** with explorer drawer
- **Disk-backed preferences** for themes and editor settings
- **Edit tracker** for monitoring agent file modifications

---

## Architecture

### App Worker Pattern

```
WebSocket Proxy (Main App - Port 8088)
  ↓
file_editor_cm6 Worker (Dynamic Port)
  ├─ core_read.py (file watcher)
  ├─ core_write.py (write handler)
  ├─ diff_helper.py (git diff parser)
  ├─ terminal_backend.py (PTY streaming)
  ├─ agent_ws.py (agent WebSocket)
  ├─ agent_bridge.py (MCP protocol adapter)
  ├─ agent_session_store.py (session persistence)
  ├─ agent_routes.py (REST API)
  └─ history_store.py (state persistence)
```

### WebSocket Infrastructure

The editor uses a unified WebSocket proxy architecture:

```
Client Browser
  ↓
ws://localhost:8088/ws/app/file_editor_cm6/{endpoint}
  ↓
Main App (proxy)
  ↓ (discovers port via X-App-Worker-Port header)
ws://localhost:<dynamic>/ws/{endpoint}
  ↓
file_editor_cm6 Worker (flask-sock)
```

**Key Benefits:**
- Workers bind to dynamic ports without client knowledge
- Main app handles connection lifecycle and error recovery
- Session isolation between multiple app instances
- Bidirectional proxying with `simple-websocket.WSClient`

---

## Agent Drawer (Backend-Driven)

**As of November 2, 2025** - Complete refactor to backend persistence architecture.

### Architecture Principles

1. **Backend owns all state** - Sessions, messages, transcripts, conversation IDs stored on disk
2. **Frontend is display-only** - Browser renders backend-provided snapshots, makes no mutations
3. **Single source of truth** - All persistence goes through Python backend
4. **Browser can close mid-conversation** - Full transcript preserved and restorable

### Storage Architecture

**Agent Sessions File:**
- **Location:** `~/.codex/agent_sessions/sessions.json`
- **Format:** JSON map of `session_id` → session object
- **Thread-safe:** Uses `threading.RLock()` for concurrent access

**App Preferences File (Separate):**
- **Location:** `~/.codex/app_prefs/code_cm6.json`
- **Contains:** View settings, last opened file, active session ID, theme, etc.
- **Does NOT contain agent sessions** (separated to avoid conflicts)

### Session Object Structure

```json
{
  "id": "session-8a3c472b9869",
  "name": "My Conversation",
  "agent": "codex",
  "conversationId": "019a41c9-f224-7911-b2ec-010baba7bafd",
  "shell_id": "fs_1762043953_7cd3f985",
  "messages": [
    {
      "id": "uuid-...",
      "type": "user|assistant|system|error|planning|tool_call|diff",
      "text": "message content",
      "timestamp": 1762044017.888
    }
  ],
  "createdAt": 1762044013.749,
  "cwd": "/path/to/project",
  "auto": false,
  "fullAccess": false,
  "version": 4
}
```

### Message Flow (Send → Persist → Display)

```
User sends message
  ↓
POST /api/app/file_editor_cm6/agent/sessions (create if new)
  ↓
WebSocket message: {"text": "...", "session": "session-id"}
  ↓
Backend: append_message(session_id, {type: 'user', text, ...})
  ↓
WebSocket to shell: codex MCP tool call
  ↓
Shell responds with streaming tokens
  ↓
Backend: Parse events, persist incrementally
  - 'token' → stream to frontend (don't persist yet)
  - 'system' → append_message(session_id, {type: 'system', ...})
  - 'agent_message' → Store complete text internally
  - 'task_complete' → append_message(session_id, {type: 'assistant', text: complete_msg})
  ↓
Frontend: Render tokens live, backend persists final on completion
```

### Key Backend Modules

#### `agent_session_store.py`
- `load_session_map()` → Dict of all sessions
- `save_session_map(data)` → Write all sessions atomically
- `create_session(...)` → New session with metadata
- `append_message(session_id, message)` → Add message, increment version
- `get_session(session_id)` → Load full session with messages
- `list_sessions()` → Summary list (no full transcripts)
- `delete_session(session_id)` → Remove session

#### `agent_routes.py`
REST API endpoints:
- `POST /api/app/file_editor_cm6/agent/sessions` → Create new session
- `GET /api/app/file_editor_cm6/agent/sessions` → List all sessions
- `GET /api/app/file_editor_cm6/agent/session/<id>` → Get full session
- `DELETE /api/app/file_editor_cm6/agent/session/<id>` → Delete session
- `PATCH /api/app/file_editor_cm6/agent/session/<id>` → Update metadata
- `GET /api/app/file_editor_cm6/agent/shell/status` → Check for active MCP shell

#### `agent_ws.py`
WebSocket handler at `/ws/app/file_editor_cm6/agent`:
- Manages Codex MCP server framework shell lifecycle
- Routes user messages to appropriate conversation
- Parses agent responses and persists to session store
- Handles conversation restoration on server restart
- Maintains `request_session_map` for message routing

#### `agent_bridge.py`
Protocol adapter for Codex MCP server:
- Converts normalized messages to MCP tool calls (`codex`, `codex-reply`)
- Parses MCP events (`agent_message_delta`, `agent_reasoning_delta`, `task_complete`)
- Normalizes to unified event format for backend persistence
- Stores conversation IDs per session

### Frontend Integration

#### JavaScript (`agent_drawer.js`)

**Key State:**
- `activeSessionId` - Currently displayed session
- `sharedShell` - Single MCP server shell info
- `streamingMessage` - Temporary cache for live tokens

**Key Functions:**
- `createSessionFromModal()` → POST new session, switch to it
- `switchToSession(id)` → GET session, render messages, save as last active
- `deleteSession(id)` → DELETE session, clear if active
- `sendMessage(text)` → Send via WebSocket with session context
- `handleAgentMessage(sessionId, msg)` → Render streaming tokens
- `checkExistingShell()` → Check for active MCP server on drawer open
- `renderMessages(messages)` → Display full transcript from backend

**Message Rendering:**
- `type: 'user'` → Green bubble on right
- `type: 'assistant'` → Blue bubble on left
- `type: 'system'` → Gray planning indicator
- `type: 'error'` → Red error bubble
- `type: 'diff'` → Diff display widget
- Tokens stream live, final message swapped in on completion

### Conversation Restoration

When Codex MCP server restarts, conversation IDs become invalid. The system handles this automatically:

**Detection:**
1. Session has `conversationId` and `shell_id` stored
2. Current shell ID differs from stored shell ID
3. Backend detects mismatch when message sent

**Restoration:**
1. Extract full conversation history from session
2. Prepend history to user's new message
3. Call `codex` tool (new conversation) with history in context
4. Save new `conversationId` and `shell_id`
5. Continue gracefully

**Three ID Numbers:**
1. **Internal session ID** - User-facing session identifier (persists forever)
2. **Framework shell ID** - Currently running MCP server shell (transient)
3. **MCP conversation ID** - Codex's internal conversation ID (transient)

### Active Session Persistence

When you switch to a session, it's saved as `last_active_session_id` in preferences. On page reload, the drawer automatically restores that session.

**Flow:**
```
switchToSession(id)
  ↓
POST /preferences/set {"key": "last_active_session_id", "value": id}
  ↓
Page refresh → Drawer opens
  ↓
GET /preferences/get?key=last_active_session_id
  ↓
switchToSession(id) automatically
```

---

## Responsive Layout System

**Code CM6** implements a **convergent layout architecture** that adapts seamlessly between desktop and mobile contexts.

### Design Philosophy: Convergence

Rather than compromising on features for mobile or cluttering the desktop experience, Code CM6 **converges** desktop power with mobile accessibility through intelligent layout transformations. The same editor, the same capabilities—just optimized for how you work in each context.

### Desktop/Landscape Mode (`min-width: 768px` + `orientation: landscape`)

**Layout Architecture:**
- **Tiled panel system** with resizable dividers
- **Explorer sidebar** (left, always visible, ~430px default)
- **Editor column** (center, flexible width)
- **Agent drawer** (right, toggleable, ~400px default)
- **Terminal** (bottom of editor column, toggleable, ~340px default)

**Key Features:**
- All panels scroll independently
- Drag-to-resize handles between panels
- Terminal scoped to editor width (not full viewport)
- Explorer always visible (no toggle needed)
- Z-index hierarchy: Dropdowns > Agent > Explorer

**Persistence:**
- Panel widths saved to localStorage
- Restored on page reload

### Mobile/Portrait Mode (all other viewports)

**Layout Architecture:**
- **Overlay drawer system** for explorer and agent
- **Editor** (full width, center focus)
- **Terminal** (tiled at bottom, toggleable, resizable)
- **Explorer/Agent** (fullscreen overlay drawers)

**Key Features:**
- Terminal pushes editor up when open
- Explorer/Agent slide over entire viewport
- Touch-friendly resize handles
- Z-index hierarchy: Agent (200) > Dropdowns (150) > Explorer (100) > Terminal (50)

**UX Priority:**
- Editor remains primary focus
- Drawers provide quick access without obscuring work
- Terminal integrated into layout (not overlay)

### Convergence in Action

| Feature | Desktop | Mobile | Result |
|---------|---------|--------|--------|
| **Explorer** | Tiled sidebar | Overlay drawer | Always accessible, context-appropriate |
| **Agent** | Tiled sidebar | Overlay drawer | Full AI power in both modes |
| **Terminal** | Tiled (editor width) | Tiled (full width) | Integrated shell access everywhere |
| **Editor** | Flexible column | Full focus | Optimized real estate |
| **Resize** | Drag dividers | Drag terminal top | Customizable workspace |

### Technical Implementation

**Responsive Detection:**
- JavaScript layout manager detects viewport changes
- Applies `.layout-desktop` or `.layout-mobile` class to root
- CSS Grid reconfigures based on class

**Grid Structure (Desktop):**
```css
grid-template-columns: var(--explorer-width) 1fr var(--agent-width);
grid-template-rows: auto auto 1fr auto;
```

**Grid Structure (Mobile):**
```css
grid-template-columns: 1fr;
grid-template-rows: auto auto 1fr auto;
```

---

## Real-Time Features

### Inline Git Diffs

Git diffs update instantly when files change, eliminating polling:

```
File Modification Detected
  ↓
core_read.py: emit_diff_changed(rel_path)
  OR
core_write.py: emit_diff_changed(rel_path)
  ↓
WebSocket Event: {"type": "diff_changed", "path": "..."}
  ↓
diff_controller.refresh(force=true)
  ↓
GET /api/app/file_editor_cm6/diff?path=...
  ↓
diff_helper.py: git diff --unified=0 (cached 5s)
  ↓
Parse hunks → {added_lines: [...], removed_lines: [...]}
  ↓
CodeMirror StateField updates decorations
  ↓
UI: Green highlights (additions), red widgets (deletions)
```

**Trigger Points:**
1. External file modifications detected by watchdog/polling
2. Successful saves via `/write` endpoint
3. Manual "Show Inline Diffs" toggle
4. File open/reload operations

**Performance:**
- Backend caches results for 5 seconds per file
- Frontend caches by file path + SHA256
- Diffs > 512 KB are skipped
- Debounced watcher events (300ms)

### File Watcher

`core_read.py` monitors the active project directory:

```python
# Watchdog observer detects file changes
watchdog.observers.Observer
  ↓
FileModifiedHandler
  ↓
emit_file_changed(rel_path)  # WebSocket: {"type": "file_changed"}
emit_diff_changed(rel_path)  # WebSocket: {"type": "diff_changed"}
  ↓
All connected clients receive events
  ↓
Frontend auto-reloads or updates diffs
```

### Terminal Drawer

**Features:**
- xterm.js terminal with PTY streaming
- Session persistence via disk-backed history store
- History replay: Preloads last 2000 lines from stdout logs before connecting WebSocket
- Smart cleanup: Destroys orphaned shells on startup

**REST API:**
- `POST /api/app/file_editor_cm6/terminal/create` - Spawn PTY shell
- `DELETE /api/app/file_editor_cm6/terminal/<id>` - Destroy shell
- `POST /api/app/file_editor_cm6/terminal/<id>/resize` - Resize PTY
- `GET /api/app/file_editor_cm6/terminal/<id>?logs=true&tail=N` - Get history

**WebSocket:**
- `/ws/app/file_editor_cm6/terminal/<id>` - Bidirectional PTY streaming

**Session Persistence:**
```
User toggles terminal
  ↓
Check disk: GET /terminal/shell-id
  ↓
If shell exists and running:
  - Reconnect
  - GET /terminal/<id>?logs=true&tail=2000
  - Replay stdout history in xterm
  - Connect WebSocket for live streaming
Else:
  - Clean up orphaned shells
  - POST /terminal/create
  - Save ID
  - Connect WebSocket
```

### Edit Tracker

Monitors file modifications made by agents or terminal commands:

**Backend (`edit_tracker.py`):**
- `register_shell_watcher(shell_id, shell_type)` - Track shell activity
- `on_file_modified(path)` - Extract line numbers from git diff
- `subscribe(callback)` - WebSocket event streaming

**Frontend:**
- Toggle: View → Track Agent Edits
- Status: `🤖 Tracking (N terminal|agent)`
- Auto-jump: Opens file and scrolls to modified line
- Flash effect: 1-second yellow highlight on jumped-to line

**Data Flow:**
```
Terminal/Agent connects
  ↓
register_shell_watcher(shell_id, type)
  ↓
File modified externally
  ↓
core_read.py → on_file_modified(path)
  ↓
Extract line numbers via git diff
  ↓
WebSocket: {"type": "edit_tracked", "path": "...", "line": N}
  ↓
Frontend: auto-jump + flash effect
```

---

## Backend Components

### `agent_session_store.py`

Thread-safe session persistence layer using atomic file writes.

**Key Functions:**
```python
load_session_map() -> Dict[str, Any]
save_session_map(data: Dict[str, Any]) -> None
create_session(session_id, name, agent, cwd, auto, fullAccess) -> Dict
append_message(session_id, message) -> Dict
update_message(session_id, message_id, **updates) -> Dict
get_session(session_id) -> Optional[Dict]
list_sessions() -> List[Dict]
delete_session(session_id) -> bool
update_session_metadata(session_id, **metadata) -> Dict
```

**Storage:**
- File: `~/.codex/agent_sessions/sessions.json`
- Lock: `threading.RLock()` for concurrent access
- Atomic writes: Write to `.tmp` file, then replace

### `agent_routes.py`

REST API for agent session management.

**Endpoints:**
```python
POST   /api/app/file_editor_cm6/agent/sessions          # Create session
GET    /api/app/file_editor_cm6/agent/sessions          # List all
GET    /api/app/file_editor_cm6/agent/session/<id>      # Get full session
DELETE /api/app/file_editor_cm6/agent/session/<id>      # Delete
PATCH  /api/app/file_editor_cm6/agent/session/<id>      # Update metadata
GET    /api/app/file_editor_cm6/agent/shell/status      # MCP server status
GET    /api/app/file_editor_cm6/preferences/get?key=... # Get preference
POST   /api/app/file_editor_cm6/preferences/set         # Set preference
```

### `agent_ws.py`

WebSocket handler for agent communication.

**Route:** `/ws/app/file_editor_cm6/agent`

**Key Responsibilities:**
- Framework shell lifecycle (spawn, reuse, label discovery)
- Message routing via `request_session_map`
- Protocol adaptation via `agent_bridge`
- Incremental message persistence
- Conversation ID tracking and restoration

**Flow:**
```python
Client message arrives
  ↓
Parse session ID from message
  ↓
Store request_id → session_id mapping
  ↓
Convert to MCP tool call via agent_bridge
  ↓
Send to framework shell PTY
  ↓
Read agent responses line-by-line
  ↓
Parse JSON-RPC events
  ↓
Normalize via agent_bridge.parse_agent_output()
  ↓
Persist to agent_session_store
  ↓
Forward to WebSocket client
  ↓
Clean up request mapping on 'final' event
```

### `agent_bridge.py`

Protocol adapter for Codex MCP server.

**Key Classes:**
- `CodexAdapter` - MCP protocol translation
- `_conversations` - Conversation ID storage
- `_last_messages` - Complete message cache for persistence

**Key Methods:**
```python
CodexAdapter.to_agent(normalized, context) -> dict
  # Convert normalized message to MCP tool call

CodexAdapter.from_agent(line, request_id) -> Optional[dict]
  # Parse MCP JSON-RPC response, normalize to unified format

CodexAdapter.store_conversation_id(session_id, conv_id)
  # Track conversation IDs per session

CodexAdapter.get_conversation_id(session_id) -> Optional[str]
  # Retrieve conversation ID for session
```

**Event Normalization:**
```python
# Input: MCP JSON-RPC events
{
  "jsonrpc": "2.0",
  "method": "codex/event",
  "params": {
    "_meta": {"requestId": "..."},
    "id": "...",
    "msg": {"type": "agent_message_delta", "delta": "text"}
  }
}

# Output: Normalized events
{
  "id": "request-id",
  "event": "token",
  "agent": "codex",
  "text": "text"
}
```

### `diff_helper.py`

Git diff parser with caching.

**Key Functions:**
```python
collect_diff(project_root, rel_path) -> dict
  # Returns: {tracked, hunks, added_lines, removed_lines, summary, error}

invalidate_diff_cache(root=None, rel_path=None)
  # Clear cache for project or specific file

_parse_hunk_header(line) -> tuple
  # Extract line numbers from @@ -x,y +a,b @@
```

**Cache:**
- TTL: 5 seconds per file
- Key: `"<project_root>::<rel_path>"`
- Size limit: 512 KB per diff
- Timeout: 10 seconds for git command

### `core_read.py`

File watcher using watchdog library.

**Key Functions:**
```python
start_watcher(project_path) -> str
  # Returns watcher ID

stop_watcher(watcher_id)
  # Clean up observer

emit_file_changed(rel_path)
  # WebSocket: {"type": "file_changed", "path": "..."}

emit_diff_changed(rel_path)
  # WebSocket: {"type": "diff_changed", "path": "..."}
```

**Events:**
- File modified → `emit_file_changed` + `emit_diff_changed`
- Debounced (300ms) to avoid spam
- Ignores git/node_modules/build directories

### `core_write.py`

File write handler with cache invalidation.

**Key Functions:**
```python
write_file(path, content) -> dict
  # Returns: {ok, path, size, sha256}

# After write:
invalidate_diff_cache(project_root, rel_path)
emit_diff_changed(rel_path)
```

---

## Frontend Components

### `agent_drawer.js`

Agent UI controller (display-only, no state mutations).

**Key State:**
```javascript
let activeSessionId = null;
let activeSessionName = 'No Session';
let streamingMessage = null;  // Temporary cache for live tokens
let sharedShell = {
  shell_id: null,
  session_id: null,
  agent: 'codex',
  status: 'Disconnected',
  ws: null,
  connectPromise: null
};
```

**Key Functions:**
```javascript
initAgentDrawer()
  // Initialize drawer, bind events

openDrawer()
  // Open drawer, check for existing shell, restore last session

createSessionFromModal()
  // POST /agent/sessions, switch to new session

switchToSession(sessionId)
  // GET /agent/session/<id>, render messages, save as last active

deleteSession(sessionId)
  // DELETE /agent/session/<id>, clear if active

sendMessage(text)
  // Send via WebSocket with session context

handleAgentMessage(sessionId, msg)
  // Render streaming tokens (display only)

renderMessages(messages)
  // Display full transcript from backend

checkExistingShell()
  // GET /agent/shell/status, update status indicator
```

**Message Rendering:**
```javascript
switch (msg.type) {
  case 'user':
    // Green bubble on right
  case 'assistant':
    // Blue bubble on left
  case 'system':
    // Gray planning indicator
  case 'token':
    // Append to streaming bubble
  case 'error':
    // Red error bubble
  case 'diff':
    // Diff display widget
}
```

### `diff_decorations.js`

CodeMirror 6 decoration controller for inline diffs.

**Key Functions:**
```javascript
createDiffController(statusCallback)
  // Returns: {extension, setContext, setEnabled, refresh, ...}

setContext({path, sha})
  // Set file context for cache key

setEnabled(bool)
  // Toggle diff display

refresh(force=false)
  // Fetch diffs, update decorations

buildDecorations(hunks, doc)
  // Create line highlights and deletion widgets
```

**Decoration Types:**
- `cm-diff-line-added` - Green highlight for additions
- `cm-diff-line-plain` - Transparent border for alignment
- `RemovedLineWidget` - Red block widget for deletions

**Cache:**
- Key: `"<abs_path>::<sha or no-sha>"`
- Invalidated on file save, external change, toggle

### `main.js`

Editor initialization and lifecycle.

**Key Functions:**
```javascript
createView()
  // Initialize CodeMirror view with extensions

openFile(path)
  // Load file, set diff context, refresh

saveFile()
  // POST /write, invalidate cache, refresh diffs

handleWSMessage(data)
  // Route WebSocket events (file_changed, diff_changed)

applyPreferencesFromStore()
  // Load theme, view settings from preferences

bindMenuToggle(element, prefKey, callback)
  // Wire menu toggle to preferences
```

**Extensions:**
```javascript
[
  basicSetup,
  keymap.of(defaultKeyBindings),
  syntaxHighlighting(defaultHighlightStyle),
  theme,
  diffController.extension,  // Inline diffs
  EditorView.lineWrapping,
  EditorState.tabSize.of(2),
  // ... more extensions
]
```

### `terminal.js`

Terminal drawer controller.

**Key Functions:**
```javascript
initTerminal(container)
  // Initialize xterm.js instance

connectTerminal(shellId)
  // Connect WebSocket, replay history

resizeTerminal(cols, rows)
  // POST /terminal/<id>/resize

destroyTerminal()
  // DELETE /terminal/<id>, clean up
```

**Features:**
- History replay (2000 lines)
- Drag-to-resize
- Fullscreen mode
- Session persistence

---

## State Persistence

### Agent Sessions

**File:** `~/.codex/agent_sessions/sessions.json`

**Format:**
```json
{
  "session-<uuid>": {
    "id": "session-<uuid>",
    "name": "Conversation Name",
    "agent": "codex",
    "conversationId": "mcp-conversation-id",
    "shell_id": "fs_timestamp_hash",
    "messages": [...],
    "createdAt": timestamp,
    "cwd": "/path/to/project",
    "auto": bool,
    "fullAccess": bool,
    "version": int
  }
}
```

### App Preferences

**File:** `~/.codex/app_prefs/code_cm6.json`

**Format:**
```json
{
  "theme": "monokai",
  "showInlineDiffs": true,
  "showWhitespace": false,
  "lineWrapping": true,
  "autoSave": false,
  "last_active_session_id": "session-<uuid>",
  "lastOpenedFile": "/path/to/file.py",
  "recentFiles": [...],
  ...
}
```

### Terminal Session

**Stored in:** `history_store.py`

**Key:**
```python
set_terminal_shell_id(shell_id)
get_terminal_shell_id() -> Optional[str]
```

---

## REST & WebSocket API Reference

### Agent API

```
POST   /api/app/file_editor_cm6/agent/sessions
  Body: {name, agent, cwd, auto, fullAccess}
  Response: {ok, data: {session}}

GET    /api/app/file_editor_cm6/agent/sessions
  Response: {ok, data: [session_summaries]}

GET    /api/app/file_editor_cm6/agent/session/<id>
  Response: {ok, data: {session_with_messages}}

DELETE /api/app/file_editor_cm6/agent/session/<id>
  Response: {ok, data: {deleted: id}}

PATCH  /api/app/file_editor_cm6/agent/session/<id>
  Body: {name?, cwd?, auto?, fullAccess?}
  Response: {ok, data: {session}}

GET    /api/app/file_editor_cm6/agent/shell/status
  Response: {ok, data: {shell_id, status, alive, pid} | null}

WS     /ws/app/file_editor_cm6/agent
  Send: {text, session, conversationId?, context?}
  Receive: {event, id, session, text?, ...}
```

### Editor API

```
POST   /api/app/file_editor_cm6/write
  Body: {path, content}
  Response: {ok, path, size, sha256}

GET    /api/app/file_editor_cm6/diff?path=<rel_path>
  Response: {ok, data: {tracked, hunks, added_lines, removed_lines, summary}}

WS     /ws/app/file_editor_cm6/read
  Receive: {type: "file_changed", path} | {type: "diff_changed", path}
```

### Terminal API

```
POST   /api/app/file_editor_cm6/terminal/create
  Body: {cwd?, cols?, rows?}
  Response: {ok, data: {shell_id, pid}}

DELETE /api/app/file_editor_cm6/terminal/<id>
  Response: {ok}

POST   /api/app/file_editor_cm6/terminal/<id>/resize
  Body: {cols, rows}
  Response: {ok}

GET    /api/app/file_editor_cm6/terminal/<id>?logs=true&tail=N
  Response: {ok, data: {shell_id, pid, status, stdout_lines?}}

WS     /ws/app/file_editor_cm6/terminal/<id>
  Send: user input (text)
  Receive: PTY output (text)
```

### Preferences API

```
GET    /api/app/file_editor_cm6/preferences/get?key=<key>
  Response: {ok, data: value}

POST   /api/app/file_editor_cm6/preferences/set
  Body: {key, value}
  Response: {ok, data: {key}}
```

---

## Android Native Selection

Code CM6 exposes Android's native selection handles without giving up CodeMirror's rendering.

### What Happens on Long-Press

1. **Timer on touch start** - `touchstart` starts a 300ms timer
2. **Flip `.cm-content` into `contenteditable`** - Sets:
   - `contenteditable="true"`
   - `-webkit-user-modify: read-write-plaintext-only`
   - `user-select: text`
3. **Focus the CodeMirror surface** - Android shows selection handles

### Handing Control Back

Native selection is only needed while selecting text:
- `pointerdown` and `beforeinput` events call `disableNativeSelection()`
- Removes `contenteditable` and clears CSS overrides
- CodeMirror's input pipeline continues normally

### Why This Works

- **Single surface** - Live CodeMirror markup never hidden
- **Browser cooperation** - Android shows handles when element is focusable and editable
- **Zero visual downgrade** - No text copying or re-rendering needed

---

## Active TODO List

### Completed ✅

- [x] **Real-time inline Git diffs** — WebSocket `diff_changed` events (Oct 28, 2025)
- [x] **Embedded terminal drawer** — xterm.js with PTY streaming (Oct 28, 2025)
- [x] **Backend agent persistence** — 100% backend-driven sessions (Nov 2, 2025)
- [x] **Active session restoration** — Auto-restore on page reload (Nov 2, 2025)
- [x] **Convergent responsive layout** — Desktop/mobile adaptive (Oct 31, 2025)
- [x] **WebSocket proxy architecture** — Dynamic port routing (Oct 28, 2025)
- [x] **Edit tracker** — Monitor agent file modifications (Oct 30, 2025)

### In Progress 🚧

_(None)_

### Backlog 📋

- [ ] **DESTROY select mode** - Complete removal of Android selection mode
- [ ] **Utility drawer (right panel)** – Right-side drawer for future features
- [ ] **Framework-wide WebSocket bus** – Shared multiplexed connection
- [ ] **Symbol navigation** – Jump to definition via LSP
- [ ] **Find/Replace across files** – Cross-file search
- [ ] **Git blame annotations** – Inline author/date information
- [ ] **Syntax error hints** – Real-time linting via LSP
- [ ] **Collaborative editing** – Multi-cursor support

---

**Last Updated:** November 2, 2025
**Document Version:** 2.0 (Post-refactor consolidation)
