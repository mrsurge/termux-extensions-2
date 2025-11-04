# Core Read/Write Architecture

_Last updated: November 4, 2025_

## Overview

The `core_read.py` and `core_write.py` modules form the **backbone of live file streaming** in Nice Code CM6. Ported directly from the proven `file_editor_cm6` implementation, they provide:

- **Real-time file watching** with subscription-based event delivery
- **Atomic writes** with SHA256-based conflict detection
- **Self-echo suppression** to prevent save flicker
- **Debounced events** to reduce notification storms
- **Edit tracking** for agent/terminal integration

This architecture enables multiple editors (or even external tools) to collaborate on the same file without conflicts or data loss.

## Core Components

| Component | Location | Responsibility |
|-----------|----------|----------------|
| `core_read.py` | `helpers/` | File system watcher, subscription management, event debouncing, self-echo suppression |
| `core_write.py` | `helpers/` | Atomic file writes with temp-file strategy, SHA256 conflict detection |
| `file_watcher.py` | `helpers/` | NiceGUI adapter - bridges watchdog events to NiceGUI timer-based polling |
| `autosave.py` | `helpers/` | Debounced save manager (1.5s delay), conflict handling hooks |
| `edit_tracker.py` | `helpers/` | Monitors terminal/agent shells, extracts modified lines from git diff |
| `diff_helper.py` | `helpers/` | Git diff utilities for extracting line-level changes |

## Architecture Deep Dive

### 1. File Watcher (`core_read.py`)

**Core Concept:** Subscription-based event system where clients subscribe to specific files and receive real-time updates.

**Implementation:**
```python
# Initialize watcher for project
init_watcher(project_root)  # Starts watchdog observer (or polling fallback)

# Subscribe to file changes
token = subscribe(
    path="/abs/path/to/file.py",
    client_id="nicegui-editor-abc123",
    on_event=lambda event: handle_update(event)
)

# Event types received:
# - "replace_full": Initial snapshot or external change (includes content, sha256)
# - "save_ack": Acknowledgment of successful save (includes new metadata)
# - "diff_changed": Git diff state changed
```

**Key Features:**

**Self-Echo Suppression (300ms window):**
- When client saves, it provides `client_id`
- Watcher tracks `(path, client_id)` suppression windows
- File changes within 300ms of save are NOT sent back to that client
- Prevents editor flicker on autosave

**Event Debouncing (150ms):**
- Rapid file changes (e.g., build tools writing multiple times) are batched
- Only final state is delivered after 150ms of silence
- Reduces CPU usage and notification spam

**Thread Safety:**
- Watchdog runs in background thread
- All subscription management protected by locks
- Events queued for main thread delivery

### 2. Atomic Writes (`core_write.py`)

**Core Concept:** Optimistic concurrency control with SHA256-based conflict detection.

**Implementation:**
```python
meta = write_full(
    project_root=Path("/project"),
    path="src/app.py",              # Relative to project root
    content="# updated code",
    base_sha256="abc123..."          # Expected current SHA256 (optional)
)
# Returns: {"sha256": "def456...", "mtime": 1234567890, "size": 42}
```

**Atomic Write Strategy:**
1. Write content to temporary file in same directory
2. `fsync()` the temp file to disk
3. `os.replace()` to atomically swap temp → target
4. `fsync()` the parent directory (ensures rename persisted)
5. Clean up temp file on error

**Why This Works:**
- `os.replace()` is atomic on POSIX systems (Linux, macOS)
- Prevents partial writes if process crashes
- Readers never see half-written files
- Safe for concurrent readers

**Conflict Detection:**
```python
try:
    write_full(project, path, content, base_sha256="old_hash")
except BaseMismatchError as e:
    # File changed since we read it
    current_meta = e.current_meta
    # Show conflict dialog: Keep Mine / Reload
```

### 3. NiceGUI Adapter (`file_watcher.py`)

**Challenge:** Watchdog events arrive on background thread, but NiceGUI must update UI on main thread.

**Solution:** Event queue + timer polling

```python
class FileSubscription:
    def start(self):
        # Subscribe to watchdog (background thread)
        self.token = subscribe(path, client_id, self._queue_event)
        
        # Poll queue on main thread (100ms interval)
        self.timer = ui.timer(0.1, self._process_events)
    
    def _queue_event(self, event):
        # Called from watchdog thread - just queue it
        self._event_queue.append(event)
    
    def _process_events(self):
        # Called from NiceGUI main thread - safe to update UI
        while self._event_queue:
            event = self._event_queue.pop(0)
            self.on_update(event)  # -> EditorModule handler
```

### 4. Autosave Manager (`autosave.py`)

**Core Concept:** Debounced writes to avoid hammering disk on every keystroke.

**Flow:**
1. User types → `editor.on_value_change` fires
2. Cancel pending timer (if any)
3. Schedule new save in 1.5 seconds
4. User keeps typing → keep canceling and rescheduling
5. User stops → timer fires → execute save
6. On success → call `push_save_ack()` to notify watcher
7. Watcher broadcasts `save_ack` to other subscribers (but NOT the saver due to suppression)

**Conflict Handling:**
```python
autosave_manager.schedule_save(
    path=rel_path,
    content=editor.value,
    base_sha256=current_sha,  # What we think file contains
    on_success=lambda meta: update_sha(meta),
    on_conflict=lambda meta: show_dialog(meta),
    on_error=lambda err: notify_error(err)
)
```

### 5. Edit Tracker (`edit_tracker.py`)

**Purpose:** Detect when external tools (terminal commands, agent scripts) modify project files.

**How It Works:**
1. Terminal/agent registers shell: `edit_tracker.register_shell_watcher(shell_id, "terminal")`
2. File watcher detects change in project file
3. Edit tracker runs `git diff` to extract modified line numbers
4. Emits `"edit_tracked"` event with `{file, line, shell_type}`
5. Editor receives event → scrolls to line, shows notification

**Current Status:** Infrastructure ready, awaiting terminal/agent module integration.

## Complete Flow Examples

### Flow 1: Opening a File with Live Updates

```
1. User clicks file in explorer
   ├─> ExplorerModule.open_file("src/app.py")
   └─> EditorModule.open_file("src/app.py")

2. Editor loads file
   ├─> project_context.ensure_within_root("src/app.py") → /abs/path/to/src/app.py
   ├─> Read file content
   ├─> Calculate SHA256: "abc123..."
   ├─> Update CodeMirror: editor.value = content
   └─> Store base_sha256 = "abc123..."

3. Initialize watcher (if not already running)
   └─> init_watcher(project_root)

4. Subscribe to file changes
   ├─> FileSubscription.start()
   ├─> subscribe(path, client_id, on_update)
   ├─> Receive initial snapshot: {"type": "replace_full", "sha256": "abc123...", "content": "..."}
   └─> Start 100ms polling timer

5. File is now watched
   └─> External changes will trigger reload
```

### Flow 2: External File Modification (Live Reload)

```
1. User edits file in vim
   └─> File mtime changes on disk

2. Watchdog detects change
   ├─> Debounce: wait 150ms for more changes
   └─> Fire event: {"type": "modified", "path": "/abs/path/to/src/app.py"}

3. core_read handles event
   ├─> Read new file content
   ├─> Calculate new SHA256: "def456..."
   ├─> Check suppression windows (none apply - external change)
   └─> Emit to subscribers: {"type": "replace_full", "sha256": "def456...", "content": "..."}

4. FileSubscription queues event
   └─> Add to _event_queue (from watchdog thread)

5. NiceGUI timer processes queue (main thread)
   ├─> Pop event from queue
   └─> Call EditorModule._handle_file_update(event)

6. Editor checks conflict
   ├─> Is editor dirty? (has unsaved changes)
   │   ├─> YES → Show conflict dialog ("Keep Mine" / "Reload")
   │   └─> NO  → Silent reload: editor.value = new_content, base_sha256 = "def456..."
   └─> User never interrupted (if clean)
```

### Flow 3: Autosave with Conflict Detection

```
1. User types in editor
   ├─> editor.on_value_change() fires
   ├─> Mark dirty: _is_dirty = True
   └─> Schedule autosave

2. AutosaveManager debounces
   ├─> Cancel pending timer
   └─> Start new timer: 1.5 seconds

3. User keeps typing
   └─> Timer keeps getting canceled/rescheduled

4. User stops typing → timer fires
   ├─> AutosaveManager._execute_save()
   └─> Call write_full(path, content, base_sha256="abc123...")

5a. Success path
   ├─> Atomic write completes
   ├─> New SHA256: "xyz789..."
   ├─> push_save_ack(path, op_id, client_id, {"sha256": "xyz789..."})
   ├─> Watcher broadcasts to other subscribers (NOT this client - suppression)
   └─> Editor receives save_ack → update base_sha256, mark clean

5b. Conflict path
   ├─> write_full() checks: current SHA256 = "def456..." ≠ "abc123..."
   ├─> Raise BaseMismatchError(current_meta)
   ├─> AutosaveManager calls on_conflict(current_meta)
   ├─> Editor shows conflict dialog
   └─> User chooses: "Keep Mine" (force write) or "Reload" (discard)
```

### Flow 4: Edit Tracker (Terminal Example - Future)

```
1. Terminal module starts
   └─> edit_tracker.register_shell_watcher("term-xyz", "terminal")

2. User runs command in terminal: `echo "fix" >> src/bug.py`
   └─> File watcher detects change

3. edit_tracker.on_file_modified("src/bug.py")
   ├─> Check: are shells registered? YES
   ├─> Run: git diff src/bug.py
   ├─> Parse diff: line 42 modified
   └─> Emit: {"type": "edit_tracked", "file": "src/bug.py", "line": 42}

4. Editor receives event (if edit tracker enabled)
   ├─> Show notification: "Terminal edited line 42"
   ├─> Scroll to line 42
   └─> Highlight line briefly
```

## Design Principles

### 1. **Separation of Concerns**
- `core_read` = watching & broadcasting
- `core_write` = safe persistence
- `file_watcher` = NiceGUI adaptation
- `autosave` = user experience layer
- `edit_tracker` = tool integration

### 2. **Thread Safety**
- Watchdog runs in background thread
- Event queues bridge to main thread
- Locks protect shared state
- No race conditions on file access

### 3. **Optimistic Concurrency**
- Clients assume they can edit freely
- SHA256 hashes detect conflicts
- User resolves conflicts (not automatic merge)

### 4. **Zero Data Loss**
- Atomic writes prevent corruption
- Conflict detection prevents silent overwrites
- Autosave preserves work
- Unsaved changes block silent reloads

### 5. **Performance**
- Debouncing reduces CPU usage
- Polling interval tuned for responsiveness (100ms)
- Self-echo suppression avoids redundant updates
- Exclude patterns skip noise (node_modules, .git, etc.)

## Tuning Parameters

| Setting | Value | Purpose |
|---------|-------|---------|
| Debounce delay | 150ms | File system event batching |
| Suppression window | 300ms | Prevent self-echo after save |
| Autosave delay | 1.5s | Keystroke debouncing |
| Poll interval | 100ms | NiceGUI event queue check |
| Polling fallback | 300ms | When watchdog unavailable |

## Testing the System

**Test 1: Live Reload**
```bash
# Terminal 1: Open app, load file
# Terminal 2: echo "test" >> file.py
# Expected: File reloads in editor instantly
```

**Test 2: Conflict Detection**
```bash
# 1. Open file in editor
# 2. Type something (don't save)
# 3. Edit file externally
# Expected: Conflict dialog appears
```

**Test 3: Autosave**
```bash
# 1. Enable autosave in File menu
# 2. Type something
# 3. Wait 2 seconds
# Expected: "Saved" notification, changes on disk
```

**Test 4: Self-Echo Suppression**
```bash
# 1. Enable autosave
# 2. Type → autosave fires
# Expected: No flicker, editor stays focused
```

## Dependencies

- `watchdog>=3.0.0` - File system monitoring
- `hashlib` (stdlib) - SHA256 hashing
- `tempfile` (stdlib) - Atomic writes
- `threading` (stdlib) - Background watcher
- `pathlib` (stdlib) - Path operations

---

This architecture has been battle-tested in production. Respect the threading model, conflict detection, and atomic write guarantees when making changes. The live streaming system is the heart of the collaborative editing experience.
