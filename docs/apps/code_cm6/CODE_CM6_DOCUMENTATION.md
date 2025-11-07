# Code CM6 — Complete Technical Documentation

**Last updated**: October 29, 2025

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
   - [WebSocket Infrastructure](#websocket-infrastructure)
   - [Real-Time Inline Diffs](#real-time-inline-diffs)
   - [Embedded Terminal Drawer](#embedded-terminal-drawer)
   - [File Watcher Pipeline](#file-watcher-pipeline)
3. [Feature Catalog](#feature-catalog)
4. [Backend Components](#backend-components)
5. [Frontend Components](#frontend-components)
6. [REST & WebSocket API Reference](#rest--websocket-api-reference)
7. [State Persistence](#state-persistence)
8. [Implementation Details](#implementation-details)
9. [Known Issues & Roadmap](#known-issues--roadmap)

---

## Overview

The `file_editor_cm6` app is a full-featured CodeMirror 6 editor bundled with Termux Extensions 2. It provides a native-feeling code editing experience optimized for mobile devices, with real-time file synchronization, live Git diffs, and an embedded terminal drawer.

**Key Design Principles**:
- **Mobile-first**: Android long-press selection, touch-friendly UI, PWA installable
- **Real-time**: WebSocket-driven file changes, diff updates, and terminal streaming
- **Persistent**: Disk-backed project state, terminal session recovery, preference storage
- **Isolated**: Runs in its own framework worker process for stability
- **Git-aware**: Built-in branch controls, footer staging/commit/push helpers, and backend Git status APIs

---

## Architecture

### WebSocket Infrastructure

The editor uses a unified WebSocket proxy architecture:

```
Client Browser
  ↓
ws://localhost:8088/ws/app/file_editor_cm6/read
  ↓
Main App (proxy)
  ↓ (discovers port via X-App-Worker-Port header)
ws://localhost:<dynamic>/ws/read
  ↓
file_editor_cm6 Worker (flask-sock)
  ↓
core_read.py / terminal_backend.py
```

**Key Benefits**:
- Workers bind to dynamic ports without client knowledge
- Main app handles connection lifecycle and error recovery
- Session isolation between multiple app instances
- Bidirectional proxying with `simple-websocket.WSClient`

### Real-Time Inline Diffs

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

**Trigger Points**:
1. External file modifications detected by watchdog/polling
2. Successful saves via `/write` endpoint
3. Manual "Show Inline Diffs" toggle
4. File open/reload operations

**Performance**:
- Backend caches results for 5 seconds per file
- Frontend caches by file path + SHA256
- Diffs > 512 KB are skipped
- Debounced watcher events (300ms)

### Embedded Terminal Drawer

Slide-up terminal with session persistence and history replay:

```
User: Ctrl/Cmd+` or View → Toggle Terminal
  ↓
Check Disk: GET /terminal/shell-id
  ↓
Shell Exists & Running?
  ├─ YES → Reconnect Flow
  │    ↓
  │   GET /terminal/<id>?logs=true&tail=2000
  │    ↓
  │   Replay 2000 lines of stdout in xterm
  │    ↓
  │   Connect: ws://.../ws/terminal/<id>
  │    ↓
  │   Live PTY streaming resumes
  │
  └─ NO → New Shell Flow
       ↓
      Clean up orphaned shells (label='code-editor-terminal')
       ↓
      POST /terminal/create
       ↓
      Save ID: POST /terminal/shell-id
       ↓
      Connect: ws://.../ws/terminal/<id>
       ↓
      Fresh PTY session
```

**UI Controls**:
- **Collapse (▼)**: Hides drawer, shell stays alive
- **Fullscreen (⛶)**: Expands to `calc(100vh - 80px)`
- **Drag header**: Manual resize (min 100px, max viewport-40px)
- **Destroy (✕)**: Terminates shell permanently, clears saved ID

**Technical Details**:
- Default height: 340px
- xterm.js with FitAddon for responsive sizing
- PTY resize on fit operations (sends cols/rows to backend)
- Framework shells with stdout persistence to `~/.cache/te_framework/logs/`
- History preserved via `splitlines(keepends=True)` to maintain line terminators

### File Watcher Pipeline

Robust file change detection with automatic restart:

```python
# core_read.py
init_watcher(project_root)
  ↓
watchdog observer OR polling fallback
  ↓
debounce(300ms) → prevent self-echo
  ↓
normalize path with _norm_path()
  ↓
emit events to WebSocket clients:
  - replace_full: {content, language, sha256}
  - diff_changed: {path}
  ↓
project root changed?
  ↓
tear down watcher, restart with new root
```

**Features**:
- Normalizes all paths to absolute POSIX format
- Prevents echoing saves back to the author (client_id tracking)
- Debounces rapid file changes
- Automatic watcher restart on project change
- Graceful degradation to polling if watchdog unavailable

---

## Feature Catalog

### Core Editing
- ✅ CodeMirror 6 with syntax highlighting
- ✅ Android long-press → native selection surface
- ✅ Autosave (1.2s debounce)
- ✅ Conflict detection (SHA256-based)
- ✅ Themes: Dark, One Dark, Termux
- ✅ Word wrap, line numbers, line shading toggles

### Real-Time Collaboration
- ✅ WebSocket file change notifications
- ✅ Save acknowledgments (prevent echo)
- ✅ Diff change events (instant refresh)
- ✅ Multiple client support

### Git Integration
- ✅ Inline diff decorations (additions/deletions)
- ✅ Git badges in the explorer tree (modified / staged / untracked / executable)
- ✅ Branch dropdown in the menubar (lists current branch, checkout existing, create new)
- ✅ Explorer footer with Stage/Unstage/Commit/Push/Pull actions and live status summary
- ✅ Backend Git API (`/git/status`, `/git/stage_all`, `/git/unstage_all`, `/git/commit`, `/git/push`, `/git/pull`) powered by `git_helper.py`
- ✅ Zero-context diff parsing with 5-second caching to keep inline decorations fresh

### Project Management
- ✅ Project root selection via file picker
- ✅ Recent projects list (max 12)
- ✅ Per-project recent files (max 12)
- ✅ Missing file detection
- ✅ Disk-backed state (`~/.local/share/termux-extensions-2/code_oss_history.json`)

### Terminal Integration
- ✅ Embedded xterm.js terminal
- ✅ PTY-backed framework shells
- ✅ Session persistence across reloads
- ✅ 2000-line history replay
- ✅ Fullscreen mode
- ✅ Drag-to-resize
- ✅ Keyboard shortcut (Ctrl/Cmd+`)

### Mobile Optimizations
- ✅ Touch-friendly UI scaling
- ✅ Wide scrollbar (29px) for easy dragging
- ✅ PWA installable
- ✅ Long-press selection mode
- ✅ Responsive layout

---

## Backend Components

### `main.py` — Flask Blueprint
**Location**: `app/apps/file_editor_cm6/main.py`

**Responsibilities**:
- Registers REST endpoints and WebSocket routes
- Initializes `flask-sock` for WebSocket support
- Syncs project root from history store on boot
- Orchestrates file I/O, diff generation, terminal management
- Exposes Git REST API (`/git/status`, `/git/stage_all`, `/git/unstage_all`, `/git/commit`, `/git/push`, `/git/pull`)
- Emits WebSocket events via `core_read` and `core_write`

**Key Functions**:
- `_ensure_project_root_synced()`: Reconciles disk state with runtime state
- `_normalize_rel_path()`: Validates paths within project root
- REST route handlers for read/write/diff/explorer/history/terminal

### `core_read.py` — File Watcher
**Location**: `app/apps/file_editor_cm6/core_read.py`

**Responsibilities**:
- Detects file modifications via watchdog or polling
- Debounces events (300ms)
- Emits `replace_full` and `diff_changed` WebSocket events
- Prevents self-echo using client_id tracking
- Manages watcher lifecycle (start/stop/restart)

**Key Functions**:
- `init_watcher(root)`: Starts watchdog observer
- `subscribe(abs_path, ws, client_id)`: Registers WebSocket client
- `emit_diff_changed(rel_path)`: Triggers diff refresh event
- `push_save_ack(abs_path, client_id)`: Prevents save echo

**Event Types**:
```python
{"type": "replace_full", "path": "...", "content": "...", "language": "...", "sha256": "..."}
{"type": "diff_changed", "path": "..."}
```

### `core_write.py` — Write Handler
**Location**: `app/apps/file_editor_cm6/core_write.py`

**Responsibilities**:
- Writes files with SHA256 conflict detection
- Validates paths within project root
- Emits `diff_changed` event after successful writes
- Returns new SHA256 for frontend tracking

**Key Functions**:
- `write_full(abs_path, content, base_sha256=None)`: Atomic write with verification
- Raises `BaseMismatchError` if SHA256 doesn't match

### `diff_helper.py` — Git Diff Parser
**Location**: `app/apps/file_editor_cm6/diff_helper.py`

**Responsibilities**:
- Runs `git diff --unified=0`
- Parses unified diff format into line ranges
- Caches results for 5 seconds
- Validates file is tracked by git

**Key Functions**:
- `collect_diff(project_root, rel_path)`: Main entry point
- `invalidate_diff_cache(root=None, rel_path=None)`: Cache management
- `_parse_hunk_header()`: Extracts line ranges from `@@` markers
- `_is_git_repo()`: Checks for `.git` directory

**Cache Keys**: `"<root>::<rel_path>"`

**Output Format**:
```python
{
    "tracked": True,
    "added_lines": [[10, 12], [20, 20]],  # ranges
    "removed_lines": [[15, 17]],
    "summary": {"added": 3, "removed": 3}
}
```

### `git_helper.py` — Git Command Toolkit
**Location**: `app/apps/file_editor_cm6/git_helper.py`

**Responsibilities**:
- Validates repositories (including brand-new repos without commits)
- Lists, creates, and checks out branches
- Produces status snapshots (branch, ahead/behind, staged/unstaged/untracked)
- Implements stage/unstage/commit/push/pull helpers consumed by REST endpoints

**Key Functions**:
- `list_branches(project_root)` → `GitBranches`
- `get_status(project_root)` → `GitStatus`
- `stage_all(...)`, `unstage_all(...)` (falls back to `git rm --cached` when no commits exist)
- `commit_changes(...)`, `push_changes(...)`, `pull_changes(...)`

**Consumers**: Git REST endpoints in `main.py` and the explorer footer UI.

### `history_store.py` — State Persistence
**Location**: `app/apps/file_editor_cm6/history_store.py`

**Responsibilities**:
- Persists project/file history to JSON
- Thread-safe with locking
- Normalizes paths to user home directory
- Manages terminal shell ID

**Storage Location**: `~/.local/share/termux-extensions-2/code_oss_history.json`

**Key Methods**:
- `touch_project(path)`: Updates recent projects list
- `touch_file(project, file)`: Updates recent files for project
- `set_active_project(path)`: Sets current project
- `set_terminal_shell_id(id)`: Saves terminal session ID
- `get_terminal_shell_id()`: Retrieves terminal session ID

**Data Structure**:
```json
{
  "active_project": "/home/user/myproject",
  "recent_projects": [...],
  "projects": {
    "/home/user/myproject": {
      "label": "myproject",
      "opened_at": "2025-10-28T12:00:00Z",
      "last_file": "/home/user/myproject/main.py",
      "files": [...]
    }
  },
  "terminal_shell_id": "fs_1234567890_abc123"
}
```

### `terminal_backend.py` — Terminal API
**Location**: `app/apps/file_editor_cm6/terminal_backend.py`

**Responsibilities**:
- Registers terminal REST and WebSocket routes
- Manages PTY lifecycle via framework shells
- Streams bidirectional terminal I/O
- Supports log tail retrieval with configurable line count

**Key Functions**:
- `register_terminal_routes(bp, sock)`: Wires up all endpoints
- `terminal_create()`: Spawns new PTY shell
- `terminal_destroy()`: Terminates shell
- `terminal_resize()`: Resizes PTY dimensions
- `terminal_ws()`: WebSocket handler for PTY streaming

**WebSocket Flow**:
```python
# Subscribe to PTY output queue
output_queue = mgr.subscribe_output(shell_id)

# Thread: Forward PTY → WebSocket
while not stop:
    chunk = output_queue.get()
    ws.send(chunk)

# Main loop: Forward WebSocket → PTY
while not stop:
    msg = ws.receive()
    mgr.write_to_pty(shell_id, msg)
```

### `terminal_shell.py` — Shell Manager
**Location**: `app/apps/file_editor_cm6/terminal_shell.py`

**Responsibilities**:
- Wraps framework_shells API
- Spawns PTY shells labeled `code-editor-terminal`
- Provides convenience methods for shell operations

**Key Functions**:
- `create_editor_shell(cwd=None)`: Spawns bash -l -i with PTY
- `destroy_editor_shell(id)`: Terminates and removes shell
- `resize_editor_shell(id, cols, rows)`: Resizes PTY
- `get_shell_info(id)`: Returns shell metadata

### `preferences_store.py` — User Preferences
**Location**: `app/apps/file_editor_cm6/preferences_store.py`

**Responsibilities**:
- Manages editor preferences (theme, view options)
- Disk-backed JSON storage
- Thread-safe operations

**Default Preferences**:
```python
{
    "theme": "cm6-dark",
    "showLineNumbers": False,
    "lineShading": False,
    "syntaxHighlighting": True,
    "wordWrap": False,
    "autosave": True,
    "showInlineDiffs": True
}
```

---

## Frontend Components

### `main.js` — Editor Controller
**Location**: `app/apps/file_editor_cm6/main.js`

**Responsibilities**:
- Boots CodeMirror 6 instance
- Manages WebSocket connections
- Handles file operations (open/save/close)
- Wires keyboard shortcuts and menu items
- Initializes diff controller and terminal drawer

**Key Lifecycle**:
```javascript
async function main() {
  // 1. Initialize explorer UI
  await initExplorerUI();
  
  // 2. Load preferences
  await loadPreferences();
  
  // 3. Fetch server state
  const state = await syncEditorState();
  
  // 4. Reopen last file if exists
  if (state.lastFile && exists) {
    await openFile(state.lastFile);
  }
  
  // 5. Initialize diff controller
  diffController = createDiffController({...});
  
  // 6. Initialize terminal drawer
  terminal = createTerminalDrawer({...});
  
  // 7. Wire menus and shortcuts
  bindMenus();
}
```

**Event Handlers**:
- Ctrl/Cmd+S: Save file
- Ctrl/Cmd+N: New file
- Ctrl/Cmd+O: Open file
- Ctrl/Cmd+`: Toggle terminal
- Long-press: Enter selection mode

### `diff_decorations.js` — Diff Controller
**Location**: `app/apps/file_editor_cm6/static/js/diff_decorations.js`

**Responsibilities**:
- Manages diff decoration lifecycle
- Listens for `diff_changed` WebSocket events
- Applies CodeMirror decorations (line highlights + widgets)
- Caches results per file+SHA256

**Decoration Types**:
```javascript
// Added line
Decoration.line({class: 'cm-diff-line cm-diff-line-added'})

// Removed line widget
Decoration.widget({
  widget: new RemovedLineWidget(text),
  side: -1  // appears before anchor line
})

// Plain line (alignment)
Decoration.line({class: 'cm-diff-line cm-diff-line-plain'})
```

**Key Algorithm**:
```javascript
buildDecorations(hunks, doc):
  1. Parse hunks into lineDecorations Map
  2. Collect deletionWidgets array
  3. Sort deletionWidgets by line number
  4. For each line 1..N:
     - Add deletion widgets before/at this line
     - Add plain decoration (alignment)
     - Add specific decoration if diff exists
  5. Add remaining deletion widgets after last line
  6. Return RangeSet
```

**Cache Strategy**:
- Key: `"<abs_path>::<sha256 or 'no-sha'>"`
- TTL: Until file changes or SHA256 changes
- Invalidation: `diff_changed` event, file save, project change

### `terminal.js` — Terminal Drawer Controller
**Location**: `app/apps/file_editor_cm6/static/js/terminal.js`

**Responsibilities**:
- Manages xterm.js instance lifecycle
- Handles WebSocket PTY connection
- Implements session persistence logic
- Provides UI controls (collapse/fullscreen/resize/destroy)

**Key Features**:
- Lazy loads xterm.js + FitAddon on first open
- Preloads 2000 lines of stdout history before WebSocket connect
- Reconnects to saved shell if still running
- Cleans up orphaned shells on startup
- Supports drag-to-resize via header bar

**Lifecycle Methods**:
```javascript
open():
  - Show drawer (transform: translateY(0))
  - Create xterm instance if first time
  - Get or create shell (check disk state)
  - Connect WebSocket + preload history
  - Fit terminal dimensions
  - Send resize to backend

close():
  - Hide drawer (transform: translateY(100%))
  - Keep shell & WebSocket alive

destroy():
  - Close drawer
  - Dispose xterm instance
  - Close WebSocket
  - DELETE /terminal/<id>
  - Clear saved shell ID
```

**History Replay**:
```javascript
// Before connecting WebSocket
const res = await fetch(`/terminal/${id}?logs=true&tail=2000`);
const lines = res.data.logs.stdout_tail;
term.write(lines.join(''));  // Lines already have terminators
```

### `explorer.js` — File Explorer Drawer
**Location**: `app/apps/file_editor_cm6/static/js/explorer.js`

**Responsibilities**:
- Renders project tree with git status
- Manages recent files list
- Handles file/folder selection
- Displays missing file indicators
- Hosts the Git footer (Stage/Unstage/Commit/Push/Pull controls) and keeps the summary in sync with backend status

**Git Status Indicators**:
- Modified: Yellow/orange tint
- Untracked: Gray/muted
- Staged: Green tint
- Executable: Bold green text
- Directory: Bold blue text

**Recent Files**:
- Shows `(missing)` for deleted files
- Click to open (if exists) or show error
- Remove button to clean up list

### `git_menu.js` — Branch Menu Controller
**Location**: `app/apps/file_editor_cm6/static/js/git_menu.js`

**Responsibilities**:
- Fetches `/git/branches` to populate the branch dropdown
- Calls `/git/checkout` and `/git/branch` to switch or create branches
- Updates the menubar label to reflect the active branch
- Emits toasts on success/failure; defers all heavy lifting to the backend

---

## REST & WebSocket API Reference

### File Operations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/app/file_editor_cm6/status` | Health probe |
| `GET` | `/api/app/file_editor_cm6/state` | Returns `{activeProject, lastFile, recents, ...}` |
| `POST` | `/api/app/file_editor_cm6/state/file_activity` | Records file activity |
| `POST` | `/api/app/file_editor_cm6/project/open` | Sets active project |
| `GET` | `/api/app/file_editor_cm6/project/current` | Gets current project |
| `GET` | `/api/app/file_editor_cm6/read?path=<abs>` | Reads file, returns `{content, sha256}` |
| `POST` | `/api/app/file_editor_cm6/write` | Writes file with conflict detection |
| `GET` | `/api/app/file_editor_cm6/diff?path=<abs>` | Gets git diff hunks |

### Explorer & History

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/app/file_editor_cm6/explorer/list?dir=<rel>` | Lists directory contents |
| `GET` | `/api/app/file_editor_cm6/history/files` | Gets recent files for project |
| `DELETE` | `/api/app/file_editor_cm6/history/file?path=<abs>` | Removes file from recents |

### Git Operations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/app/file_editor_cm6/git/branches` | Lists branches and current HEAD |
| `POST` | `/api/app/file_editor_cm6/git/branch` | Creates and checks out a new branch |
| `POST` | `/api/app/file_editor_cm6/git/checkout` | Checks out an existing branch |
| `GET` | `/api/app/file_editor_cm6/git/status` | Returns git summary (ahead/behind/staged/etc.) |
| `POST` | `/api/app/file_editor_cm6/git/stage_all` | Stages all tracked/untracked changes |
| `POST` | `/api/app/file_editor_cm6/git/unstage_all` | Clears the index (falls back to `git rm --cached` when no commits) |
| `POST` | `/api/app/file_editor_cm6/git/commit` | Commits staged changes (`{message, amend?}`) |
| `POST` | `/api/app/file_editor_cm6/git/push` | Pushes to remote (optional `{remote, branch, force}`) |
| `POST` | `/api/app/file_editor_cm6/git/pull` | Pulls from remote (optional `{remote, branch, rebase}`) |

### Terminal Operations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/app/file_editor_cm6/terminal/shell-id` | Gets saved shell ID |
| `POST` | `/api/app/file_editor_cm6/terminal/shell-id` | Saves shell ID (or `null` to clear) |
| `POST` | `/api/app/file_editor_cm6/terminal/create` | Spawns new PTY shell |
| `DELETE` | `/api/app/file_editor_cm6/terminal/<id>` | Terminates shell |
| `POST` | `/api/app/file_editor_cm6/terminal/<id>/resize` | Resizes PTY (JSON: `{cols, rows}`) |
| `GET` | `/api/app/file_editor_cm6/terminal/<id>?logs=true&tail=N` | Gets shell info + stdout tail |

### WebSocket Events

#### `/ws/app/file_editor_cm6/read?path=<abs>&client_id=<id>`

**Sent by Server**:
```json
{
  "type": "replace_full",
  "path": "/absolute/path/to/file.txt",
  "content": "...",
  "language": "python",
  "sha256": "abc123..."
}

{
  "type": "save_ack",
  "path": "/absolute/path/to/file.txt",
  "sha256": "def456..."
}

{
  "type": "diff_changed",
  "path": "/absolute/path/to/file.txt"
}
```

#### `/ws/app/file_editor_cm6/terminal/<id>`

**Bidirectional**:
- Server → Client: Raw PTY output (ANSI escape codes, text)
- Client → Server: User input (keyboard, special sequences)

---

## State Persistence

### History Store Schema

**File**: `~/.local/share/termux-extensions-2/code_oss_history.json`

```json
{
  "active_project": "/home/user/projects/myapp",
  "terminal_shell_id": "fs_1234567890_abc123",
  "recent_projects": [
    {
      "path": "/home/user/projects/myapp",
      "label": "myapp",
      "opened_at": "2025-10-28T12:00:00Z"
    }
  ],
  "projects": {
    "/home/user/projects/myapp": {
      "label": "myapp",
      "opened_at": "2025-10-28T12:00:00Z",
      "last_file": "/home/user/projects/myapp/main.py",
      "files": [
        {
          "path": "/home/user/projects/myapp/main.py",
          "label": "main.py",
          "opened_at": "2025-10-28T12:05:00Z"
        }
      ]
    }
  }
}
```

### Preferences Schema

**File**: `~/.local/share/termux-extensions-2/code_oss_preferences.json`

```json
{
  "theme": "cm6-dark",
  "showLineNumbers": false,
  "lineShading": false,
  "syntaxHighlighting": true,
  "wordWrap": false,
  "autosave": true,
  "showInlineDiffs": true
}
```

### Framework Shell Logs

**Directory**: `~/.cache/te_framework/logs/`

**Files**:
- `<shell_id>.stdout.log` - Terminal output
- `<shell_id>.stderr.log` - Error output

**Format**: Raw bytes, line-delimited, preserves ANSI escape codes

---

## Implementation Details

### Diff Decoration Alignment Fix

**Problem**: Python indentation appeared misaligned because plain lines had no left padding while diff lines had 3px border.

**Solution**: Apply `.cm-diff-line-plain` decoration to ALL lines when diffs enabled:
```css
.cm-line.cm-diff-line-plain {
  border-left: 3px solid transparent;
}
```

**Result**: All lines have consistent 4-space equivalent padding via transparent border.

### Terminal History Whitespace Fix

**Problem**: Extra blank lines appeared when replaying terminal history.

**Root Cause**: `framework_shells._read_log_tail()` used `splitlines()` which removed line terminators, then frontend added them back with `join('\n')`.

**Solution**: 
```python
# framework_shells.py
return data.splitlines(keepends=True)[-lines:]

# terminal.js
term.write(lines.join(''));  // No extra newlines
```

### WebSocket Proxy Implementation

**Main App** (`app/main.py`):
```python
@sock.route('/ws/app/<app_name>/<path:ws_path>')
def proxy_app_websocket(ws, app_name, ws_path):
    # Discover worker port
    port = _app_worker_ports.get(app_name)
    worker_url = f"ws://localhost:{port}/ws/{ws_path}?{request.query_string}"
    
    # Connect to worker
    worker_ws = WSClient.connect(worker_url)
    
    # Bidirectional forwarding
    threading.Thread(target=lambda: forward(worker_ws, ws)).start()
    threading.Thread(target=lambda: forward(ws, worker_ws)).start()
```

**Benefits**:
- Clients connect to stable URL
- Workers bind to dynamic ports
- Clean separation of concerns
- Automatic error handling and cleanup

### Framework Shell PTY Lifecycle

```
POST /terminal/create
  ↓
framework_shells.spawn_shell_pty(['bash', '-l', '-i'])
  ↓
Creates PTY with pty.openpty()
  ↓
Forks process, child becomes session leader
  ↓
Spawns bash in child process
  ↓
Parent monitors, logs stdout/stderr
  ↓
Returns ShellRecord with ID
  ↓
WebSocket clients subscribe to output queue
  ↓
Terminal sends input via write_to_pty()
  ↓
DELETE /terminal/<id>
  ↓
Sends SIGTERM, waits, SIGKILL if needed
  ↓
Removes from registry
```

---

## Known Issues & Roadmap

### Current Limitations

1. **Terminal History Artifacts**: Multi-line prompts may show whitespace issues due to how logs are split into lines
2. **Diff Cache Tuning**: 5-second cache may be too aggressive for rapid git operations
3. **Large Diff Performance**: Diffs > 512 KB are skipped; could stream incrementally
4. **Watcher Reliability**: Polling fallback slower than watchdog; consider inotify on Linux
5. **Error Recovery**: WebSocket disconnects require manual page reload; need auto-reconnect

### Completed Features (October 28, 2025)

- ✅ Real-time inline Git diffs via WebSocket
- ✅ Embedded terminal drawer with PTY streaming
- ✅ Session persistence across reloads
- ✅ Terminal history replay (2000 lines)
- ✅ Diff decoration alignment fix
- ✅ Orphaned shell cleanup
- ✅ WebSocket proxy architecture
- ✅ Framework shell log preservation fix

### Roadmap (Future)

- [ ] **Select Mode Removal**: Eliminate Android selection mode entirely
- [ ] **Utility Drawer**: Right-side drawer for terminal + agent output
- [ ] **WebSocket Bus**: Shared multiplexed connection for all apps
- [ ] **Collaborative Editing**: Multi-cursor support via WebSocket
- [ ] **Syntax Error Hints**: Inline linting via LSP
- [ ] **Find/Replace**: Cross-file search with git grep
- [ ] **Git Blame**: Inline author/date annotations
- [ ] **Symbol Navigation**: Jump to definition via language server

---

## Change Log

### October 28, 2025
- Added real-time inline diff updates via WebSocket `diff_changed` events
- Implemented embedded terminal drawer with xterm.js + framework shells
- Added terminal session persistence and 2000-line history replay
- Fixed diff decoration alignment with transparent border trick
- Fixed terminal history whitespace by preserving line terminators
- Implemented WebSocket proxy architecture in main app
- Added orphaned shell cleanup on terminal drawer open
- Updated framework_shells to use `splitlines(keepends=True)`

### October 29, 2025
- Added menubar branch dropdown backed by `/git/branches`, `/git/checkout`, `/git/branch`
- Implemented explorer Git footer with Stage/Unstage/Commit/Push/Pull controls
- Expanded `git_helper.py` with status/stage/commit/push/pull helpers that work on fresh repos
- Introduced Git REST API surface (`/git/status`, `/git/stage_all`, `/git/unstage_all`, `/git/commit`, `/git/push`, `/git/pull`)
- Updated documentation & TODO checklist to reflect Git bootstrap progress

### October 27, 2025
- Fixed diff decoration Python indentation alignment
- Added deletion widget positioning algorithm
- Improved CodeMirror decoration ordering

### October 26, 2025
- Initial inline diff implementation
- Added diff_helper with git diff parsing
- Created diff_decorations CodeMirror extension
- Integrated with View menu toggle

---

**Document Version**: 2.0  
**Maintained By**: Termux Extensions Development Team  
**Last Reviewed**: October 28, 2025
