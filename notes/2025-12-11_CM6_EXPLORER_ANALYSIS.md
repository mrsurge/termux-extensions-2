# CM6 Explorer & WebSocket Architecture Analysis

**Date:** 2025-12-11  
**Subject:** Comprehensive deep dive into `file_editor_cm6` Explorer, WebSocket, and Rendering architecture.

---

## 1. Overview

The `file_editor_cm6` application uses a **backend-authoritative split architecture**:

- **Backend (Python)**: Single source of truth for file system state, project context, git status, and draft management
- **Frontend (JavaScript)**: Reactive renderer that displays state pushed via WebSocket and forwards user actions back to the backend

This design ensures consistency across multiple connected clients (browser tabs/windows) viewing the same project.

### Key Files

| File | Role |
|------|------|
| `explorer_ws.py` | WebSocket handlers, ConnectionManager, ExplorerDispatcher |
| `explorer_helper.py` | File system operations, git status collection, draft tracking |
| `explorer.js` | Frontend tree rendering, event handling, DOM patching |
| `main.js` | Socket.IO connection setup, global bus wiring |
| `core_read.py` | File watcher (watchdog), change notifications |
| `explorer/search.py` | Search by name, content, and changes |
| `explorer/review.py` | Draft review listing, save, and discard |

---

## 2. WebSocket Infrastructure

Communication uses **Socket.IO** over the NiceGUI WebSocket proxy.

### 2.1 Frontend Connection (`main.js`)

```javascript
// Connection setup (lines 86-147)
function connectExplorerSocket() {
  const socketPath = '/ui/_nicegui_ws/socket.io';
  explorerSocket = io('/explorer', {
    path: socketPath,
    transports: ['websocket'],
    query: { app_id: 'file_editor_cm6' },
  });
}
```

**Global Bus System:**
- `window.__explorerBusSend(type, payload)` - Send messages to backend
- `window.__explorerBusDispatch(type, payload)` - Receive and route incoming events

### 2.2 Backend Components (`explorer_ws.py`)

#### ConnectionManager (lines 76-190)
Manages WebSocket connections grouped by project path:

```python
class ConnectionManager:
    active_connections: Dict[str, List[WebSocket]]  # project_path -> connections
    ws_project_map: Dict[WebSocket, str]            # websocket -> project_path
```

**Key Methods:**
- `accept_and_register(websocket, project_path)` - Register new client
- `disconnect(websocket)` - Clean up on disconnect
- `broadcast(project_path, message)` - Send to all clients in a project
- `send_personal(websocket, message)` - Send to single client

**Lifecycle Management:**
- Starts file watcher on first connection
- Stops watcher when last client disconnects
- Runs heartbeat pulse every 30 seconds

#### ExplorerDispatcher (lines 434-650)
Per-client message handler that routes incoming messages to handler methods:

```python
class ExplorerDispatcher:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.project_root = get_project_root()
        self._tracked_job_ids: set = set()  # For git push/pull/clone progress
```

**Handler Routing:** Message type `explorer:list` → `handle_explorer_list()`

#### ExplorerSocketIONamespace (lines 1122-1153)
Socket.IO namespace adapter that wraps ExplorerDispatcher for Socket.IO protocol:

```python
class ExplorerSocketIONamespace(socketio.AsyncNamespace):
    namespace = '/explorer'
    dispatchers: Dict[str, ExplorerDispatcher] = {}
```

### 2.3 Message Flow

```
Frontend                    Backend
   │                           │
   │── explorer:list ─────────►│ ExplorerDispatcher.handle_explorer_list()
   │                           │
   │◄── explorer:setList ──────│ emit_personal() or broadcast()
   │                           │
```

---

## 3. The Explorer (Directory Tree)

### 3.1 Data Source (`explorer_helper.py`)

#### Core Function: `list_dir(rel)` (lines 94-181)

```python
def list_dir(rel: str = '.') -> dict:
    """
    Returns:
        {
            'cwd': 'relative/path',  # Current directory relative to project
            'entries': [...]          # List of file/folder metadata
        }
    """
```

#### Entry Metadata Structure

Each entry contains:

| Field | Type | Description |
|-------|------|-------------|
| `name` | str | Filename/dirname |
| `rel` | str | Project-relative path |
| `kind` | str | `'file'` or `'dir'` |
| `mtime` | int | Modification timestamp |
| `size` | int | Size in bytes |
| `mode` | str | Octal permissions |
| `ext` | str | File extension |
| `gitStatus` | str | `'modified'`, `'untracked'`, `'staged'`, `'clean'`, etc. |
| `gitFlags` | list | For dirs: `['modified', 'untracked', 'staged']` from descendants |
| `hasDraft` | bool | Has unsaved draft (file) or contains drafts (dir) |
| `isExecutable` | bool | Has execute permission |
| `isSymlink` | bool | Is symbolic link |

#### Git Status Computation

**Status Priority Order** (line 24-35):
```python
_STATUS_PRIORITY = (
    "conflict", "staged_modified", "deleted", "staged",
    "added", "modified", "renamed", "untracked", "ignored", "clean",
)
```

**Git Code Mapping** (`_map_git_code`, lines 280-304):
- `??` → `untracked`
- `!!` → `ignored`
- `M ` → `modified`
- ` M` → `modified`
- `A ` → `added`
- `MM` → `staged_modified`
- `UU`, `AA` → `conflict`

**Directory Status Derivation** (`_derive_git_status`, lines 306-340):
- Directories inherit status from children
- "Outline statuses" (modified, staged, etc.) give directories `modified` status
- `untracked` children give directories `untracked` status

**Directory Flags** (`_derive_git_flags`, lines 342-380):
- Returns list of all applicable flags for CSS styling
- Enables `fe-dir-has-modified`, `fe-dir-has-staged`, etc. classes

### 3.2 Caching

Two separate caches with short TTLs:

```python
# Git status cache (line 16-17)
_GIT_STATUS_CACHE: Dict[str, dict] = {}
GIT_CACHE_TTL_SECONDS = 6.0

# Draft paths cache (lines 19-21)
_DRAFT_PATHS_CACHE: Dict[str, dict] = {}
DRAFT_CACHE_TTL_SECONDS = 5.0
```

**Cache Invalidation:**
- `mark_git_cache_dirty(project_root)` - After git operations
- `mark_draft_cache_dirty(project_root)` - After draft changes

### 3.3 Frontend Rendering (`explorer.js`)

#### Event Handler: `handleExplorerEvent()` (lines 957-1200)

Routes incoming events to appropriate handlers:

```javascript
switch (type) {
  case 'explorer:setList':      // Directory listing
  case 'explorer:updateGitStatus':  // Git decoration update
  case 'explorer:updateDecorations': // Draft decoration update
  case 'git:status':            // Git summary bar
  case 'project:opened':        // Project switch complete
  // ...
}
```

#### DOM Patching: `renderEntriesInto()` (lines 681-865)

Smart incremental DOM update that preserves tree state:

1. **Index existing nodes** by `data-rel` attribute
2. **Remove obsolete nodes** not in new list
3. **Create or update nodes** - preserves open/closed state of subdirectories
4. **Reorder nodes** if positions changed
5. **Apply CSS classes** for git status and draft indicators

**Key Preservation:** Child `<ul>` elements (expanded subdirectories) are never removed during parent updates.

#### Status Flag Aggregation: `applyAggregatedGitStatusFlags()` (lines 867-955)

Walks up the DOM tree to propagate status indicators to parent directories:

```javascript
// For each node with gitStatus or gitFlags
// Walk up parent directories and add classes:
// - fe-dir-has-modified
// - fe-dir-has-staged
// - fe-dir-has-untracked
// - fe-dir-has-draft
```

This ensures collapsed parent directories show visual indicators for deep children.

### 3.4 Opening Folders

**Flow:**

1. User clicks folder node (`li[data-kind="dir"]`)
2. Frontend checks if already open (`data-open="true"`)
3. If not open:
   - Sets `data-open="true"`
   - Emits `explorer:list` with `{ rel: 'path/to/folder' }`
4. Backend calls `list_dir(rel)` and responds with `explorer:setList`
5. Frontend's `handleExplorerEvent` finds target `<li>` and calls `renderEntriesInto()`

**Collapse Flow:**
- Sets `data-open="false"`
- Removes child `<ul>` from DOM
- Checks if collapsing select-mode directory (auto-disables select mode)

---

## 4. File System Watcher

### 4.1 Watcher Implementation (`core_read.py`)

Uses **watchdog** library with fallback to polling:

```python
class WatchdogHandler(FileSystemEventHandler):
    def on_any_event(self, event):
        # Filter noise (opened/closed events)
        if event.event_type not in ('created', 'modified', 'deleted', 'moved'):
            return
        
        # Handle renames (use dest_path for moved events)
        path = event.dest_path if event.event_type == "moved" else event.src_path
        
        # Apply exclusion patterns
        if any(p in path for p in EXCLUDE_PATTERNS):
            return
        
        # Notify explorer
        notify_explorer_of_change(path, event.event_type)
```

**Exclusion Patterns:**
```python
EXCLUDE_PATTERNS = [".git", "node_modules", "dist", "build", ".venv", "__pycache__"]
```

### 4.2 Explorer Notification (`explorer_ws.py`, lines 244-286)

```python
def notify_explorer_of_change(abs_path: str, event_type: str):
    # 1. Find which project owns this path
    for project_path in manager.active_connections.keys():
        if abs_path.startswith(project_path):
            # 2. Calculate parent directory
            rel_path = _get_rel_from_abs(abs_path, project_path)
            parent_rel = _get_parent_rel(rel_path)
            
            # 3. Debounce (250ms)
            # 4. Broadcast explorer:setList for parent directory
            # 5. Schedule git status broadcast (500ms debounce)
```

**Debounce Timers:**
```python
EXPLORER_REFRESH_DEBOUNCE = 0.25  # 250ms for directory refresh
# Git status uses 500ms debounce (line 302)
```

---

## 5. Git Integration

### 5.1 Status Updates

**Triggers:**
- File modification (via watcher)
- Git operations (stage, unstage, commit, etc.)
- Manual refresh request

**Backend Broadcast** (`broadcast_git_status`, lines 558-574):

```python
async def broadcast_git_status(self):
    status = git_get_status(self.project_root)
    await self.broadcast("git:status", {
        "branch": status.branch,
        "detached": status.detached,
        "ahead": status.ahead,
        "behind": status.behind,
        "staged": status.staged,      # List of staged files
        "unstaged": status.unstaged,  # List of modified files
        "untracked": status.untracked # List of untracked files
    })
```

**Decoration Updates** (`broadcast_git_decorations`, lines 576-584):

```python
async def broadcast_git_decorations(self):
    statuses = get_all_git_statuses()  # {rel_path: status}
    await self.broadcast("explorer:updateGitStatus", {"statuses": statuses})
```

### 5.2 Frontend Git Status Handling

**Summary Bar** (`renderGitSummary`, lines 458-508):
```javascript
const counts = `staged ${stagedCount} · changes ${unstagedCount} · untracked ${untrackedCount}`;
gitSummaryEl.textContent = `${bits.join(' ')} · ${counts}`;
```

**Tree Decorations** (`handleExplorerEvent` case `explorer:updateGitStatus`, lines 1058-1146):
- Clears existing git classes
- Applies new `fe-git-{status}` classes to matching nodes
- Propagates `fe-dir-has-*` classes to ancestor directories

---

## 6. Key Workflows

### 6.1 Project Switching

**Request:** `project:open` with `{ path: '/path/to/project' }`

**Backend Handler** (`handle_project_open`, lines 925-947):
```python
async def handle_project_open(self, payload, msg_id):
    # 1. Disconnect from old project group
    manager.disconnect(self.websocket)
    
    # 2. Set new project root
    new_root = set_project_root(path)
    reset_project_session(str(new_root))
    self.project_root = new_root
    
    # 3. Register to new project group
    manager.register_existing(self.websocket, str(new_root))
    
    # 4. Emit confirmation
    await self.emit_personal("project:opened", {"path": str(new_root)})
    
    # 5. Trigger full refresh
    await self.handle_explorer_refresh({}, msg_id)
```

**Frontend Response** (`handleExplorerEvent` case `project:opened`, lines 1148-1178):
- Updates `uiState.projectPath`
- Requests fresh tree (`explorer:list` for `.`)
- Refreshes git status and diff base

### 6.2 File Operations

All file operations follow the pattern:
1. Frontend emits request (e.g., `explorer:createFile`)
2. Backend performs operation via `explorer_helper.py`
3. Backend broadcasts result to all clients
4. Backend broadcasts updated `explorer:setList` for affected directory

**Example: Create File** (lines 718-726):
```python
async def handle_explorer_createFile(self, payload, msg_id):
    res = create_file(payload.get("parent_rel", "."), payload.get("name"))
    await self.broadcast("explorer:created", res)
    parent_list = list_dir(payload.get("parent_rel", "."))
    await self.broadcast("explorer:setList", parent_list)
```

### 6.3 Git Operations with Progress

Long-running git operations (push, pull, clone) use a job system:

```python
async def handle_git_push(self, payload, msg_id):
    job = job_manager.create_job("git_push", {...})
    self._tracked_job_ids.add(job.id)
    await self.emit_personal("git:pushStarted", {"job_id": job.id})
```

Progress updates flow via `job:progress` events handled in the job pump task.

---

## 7. Search & Review

### 7.1 Search Modes (`explorer/search.py`)

| Mode | Handler | Description |
|------|---------|-------------|
| `name` | `search_by_name()` | Glob-based filename search |
| `content` | `search_by_content()` | Ripgrep or Python fallback |
| `changes` | `search_by_changes()` | Git diff against base ref |

**Request:** `search:run` with `{ mode: 'name'|'content'|'changes', query: '...' }`

**Response:** `search:setResults` with mode-specific payload

### 7.2 Review System (`explorer/review.py`)

Lists files with unsaved drafts and allows bulk save/discard:

**Request:** `review:list` with `{ lightweight: bool }`

**Response:** `review:setEntries` with:
```python
{
    "entries": [
        {
            "path": "/abs/path",
            "rel": "relative/path",
            "has_draft": True,
            "timestamp": "...",
            "hunks": [...]  # If not lightweight
        }
    ]
}
```

**Actions:**
- `review:save` - Write selected drafts to disk
- `review:discard` - Clear selected drafts from cache

---

## 8. Draft Management

### 8.1 Draft Detection

Drafts are stored in `HistoryStore` (project sidecar) and tracked per-file:

```python
def _collect_project_draft_rel_paths(project_root: Path) -> set[str]:
    """Returns set of relative paths that have drafts."""
    drafts = _history_store.list_project_drafts(str(project_root))
    return {draft['file_path'] for draft in drafts}
```

### 8.2 Draft Decorations

**Backend Broadcast** (`_broadcast_draft_decorations`, lines 324-335):
```python
async def _broadcast_draft_decorations(project_path: str):
    reviews = await review.list_reviews(Path(project_path), lightweight=True)
    draft_decorations = {r["rel"]: {"hasDraft": True} for r in reviews if r.get("has_draft")}
    await manager.broadcast(project_path, {
        "type": "explorer:updateDecorations",
        "payload": {"drafts": draft_decorations}
    })
```

**Frontend Handling** (`handleExplorerEvent` case `explorer:updateDecorations`, lines 1019-1055):
- Clears `fe-draft` and `fe-dir-has-draft` classes
- Applies to matching nodes
- Propagates to ancestor directories via path computation

### 8.3 Draft State Change Notification

```python
def notify_draft_state_changed(project_path: str):
    """Called when draft state changes. Debounced at 500ms."""
    mark_draft_cache_dirty(Path(project_path))
    # Schedule broadcast of updated decorations
```

---

## 9. Batch Operations (Select Mode)

### 9.1 Frontend State

```javascript
let selectModeDir = null;           // Directory in select mode
const selectedEntries = new Set();  // Selected item paths
```

### 9.2 Actions

When select mode is enabled on a directory:
- Checkboxes appear on all direct children
- Context menu changes to batch operations:
  - `batchCopy` → `explorer:batchCopy`
  - `batchMove` → `explorer:batchMove`
  - `batchDelete` → `explorer:batchDelete`
  - `batchStage` → `git:stage` with paths array
  - `batchUnstage` → `git:unstage` with paths array

---

## 10. Event Reference

### Frontend → Backend

| Event | Payload | Description |
|-------|---------|-------------|
| `explorer:list` | `{rel}` | Request directory listing |
| `explorer:refresh` | `{}` | Full tree refresh |
| `explorer:createFile` | `{parent_rel, name}` | Create file |
| `explorer:createDir` | `{parent_rel, name}` | Create directory |
| `explorer:rename` | `{rel, new_name}` | Rename entry |
| `explorer:delete` | `{rel}` | Delete entry |
| `explorer:batchDelete` | `{rels}` | Delete multiple |
| `explorer:copy` | `{rel, dest_path}` | Copy entry |
| `explorer:move` | `{rel, dest_path}` | Move entry |
| `project:open` | `{path}` | Switch project |
| `git:stage` | `{paths}` | Stage files |
| `git:unstage` | `{paths}` | Unstage files |
| `git:commit` | `{message, amend}` | Commit changes |
| `git:push` | `{remote, branch}` | Push (job-based) |
| `git:pull` | `{remote, branch}` | Pull (job-based) |
| `search:run` | `{mode, query}` | Execute search |
| `review:list` | `{lightweight}` | List drafts |
| `review:save` | `{files}` | Save drafts |
| `review:discard` | `{files}` | Discard drafts |

### Backend → Frontend

| Event | Payload | Description |
|-------|---------|-------------|
| `explorer:setList` | `{cwd, entries}` | Directory listing |
| `explorer:updateGitStatus` | `{statuses}` | Git decorations |
| `explorer:updateDecorations` | `{drafts}` | Draft decorations |
| `git:status` | `{branch, staged, ...}` | Git summary |
| `git:diffBaseSet` | `{ref, refresh}` | Diff base changed |
| `project:opened` | `{path}` | Project switch complete |
| `project:setActive` | `{path}` | Active project info |
| `search:setResults` | `{mode, results, ...}` | Search results |
| `review:setEntries` | `{entries}` | Draft list |
| `job:progress` | `{id, status, progress}` | Job progress |
| `pulse` | `{}` | Heartbeat |
