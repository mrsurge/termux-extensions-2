# Session Draft Feature - Technical Documentation

**Feature:** Automatic persistence of unsaved editor content with crash recovery  
**Status:** Implemented (Phase 1)  
**Version:** 1.0  
**Last Updated:** 2025-11-26

---

## Overview

The session draft feature provides automatic, transparent persistence of unsaved editor content to survive browser refreshes, app crashes, and connection losses. Content is saved to disk continuously during editing and automatically restored when the editor reopens, with differentiation between normal continuation (mid-session) and crash recovery scenarios.

### Key Characteristics

- **Zero-configuration**: No user action required; drafts persist automatically
- **Run-aware**: Distinguishes between same-session continuations and crash recoveries
- **Atomic storage**: Uses sidecar JSON files with atomic write operations
- **Collision-safe**: SHA-256 validation prevents overwriting external changes
- **Watcher-integrated**: External file modifications invalidate stale drafts

---

## Architecture

### Three-State Model

The system operates in three distinct states based on cache presence and run ID matching:

#### State 1: Clean (No Draft)
- **Trigger:** New file opened, successful save, or explicit discard
- **Behavior:** Editor displays disk content, no cache exists
- **Cache Status:** No sidecar file for `(project_path, file_path)` key

#### State 2: Mid-Session (Active Draft)
- **Trigger:** User edits content, cache persists with matching run ID
- **Behavior:** Silent restoration on page reload; editing continues seamlessly
- **Cache Status:** Sidecar exists, `run_id` matches current `TE_RUN_ID`
- **UI Indicator:** None (transparent to user)

#### State 3: Crashed (Stale Draft)
- **Trigger:** Cache found with mismatched run ID (worker restart, app crash)
- **Behavior:** Automatic restoration with notification toast
- **Cache Status:** Sidecar exists, `run_id` differs from current `TE_RUN_ID`
- **UI Indicator:** Orange toast: "Restored unsaved draft" or "Recovered changes from prior crash"

---

## Storage Architecture

### Sidecar File System

Drafts are stored as individual JSON files outside the main history database:

**Location:** `~/.cache/cm6_sessions/<cache_key>.json`

**Cache Key Generation:**
```python
def _normalize_cache_key(project_path: str, file_path: str) -> str:
    norm_project = str(Path(project_path).expanduser().resolve(strict=False))
    norm_file = str(Path(file_path).expanduser().resolve(strict=False))
    combined = f"{norm_project}::{norm_file}"
    return hashlib.sha1(combined.encode('utf-8')).hexdigest()
```

### Sidecar Entry Schema

```json
{
  "content": "... full buffer content ...",
  "content_length": 1234,
  "content_sha256": "abc123...",
  "base_sha256": "def456...",
  "unsaved": true,
  "run_id": "shell-12345-67890",
  "shell_id": "framework-shell-abc",
  "shell_run_id": "run-xyz",
  "launcher_pid": 1001,
  "worker_pid": 5001,
  "updated_at": "2025-11-26T12:34:56.789Z"
}
```

**Field Descriptions:**

- `content`: Full text content of the editor buffer
- `content_sha256`: SHA-256 hash of `content` (current state)
- `base_sha256`: SHA-256 hash of last saved disk version (baseline for collision detection)
- `unsaved`: Boolean flag indicating if content differs from disk
- `run_id`: Framework worker run identifier (`TE_RUN_ID` environment variable)
- `updated_at`: ISO 8601 timestamp of last cache write

### Atomic Write Protocol

Writes use a temp-file-swap pattern to ensure crash-safety:

```python
def _write_sidecar(cache_key: str, entry: Dict) -> None:
    with tempfile.NamedTemporaryFile(
        mode='w',
        dir=self._session_cache_dir,
        delete=False,
        prefix=f"{cache_key}.",
        suffix=".tmp"
    ) as tmp_file:
        tmp_path = Path(tmp_file.name)
        json.dump(entry, tmp_file, ensure_ascii=False, indent=2)
        tmp_file.flush()
        os.fsync(tmp_file.fileno())  # Force kernel write
    
    os.replace(tmp_path, final_path)  # Atomic swap
```

**Why this works:**
1. Write to temporary file in same directory (ensures same filesystem)
2. Force kernel flush with `fsync()` (survives power loss)
3. Atomically replace target file with `os.replace()` (POSIX guarantee)
4. If crash occurs during write, either old file survives or new file is complete

---

## Data Flow

### Persistence Flow (Typing → Disk)

```
1. User types in editor
   ↓
2. CodeMirror on_change event fires
   ↓
3. editor._cached_content updated
   ↓
4. _schedule_cache_persist() called
   ↓
5. Debounce timer set (1 second)
   ↓
6. _persist_to_cache_debounced() executes
   ↓
7. Collect runtime metadata (run_id, shell_id, etc.)
   ↓
8. HistoryStore.upsert_cached_document()
   ↓
9. Compute content_sha256 and compare to base_sha256
   ↓
10. Write atomic sidecar JSON
   ↓
11. Update in-memory cache
   ↓
12. _broadcast_cache_state() → emitCacheState() → parent frame
```

**Debounce Interval:** 1000ms (1 second)  
**Purpose:** Reduce disk I/O while typing; batch rapid keystrokes

### Restoration Flow (Page Load → Editor)

```
1. editor_page() initializes
   ↓
2. Load last file path from HistoryStore
   ↓
3. Check for cached session:
   HistoryStore.get_cached_document(project_path, file_path)
   ↓
4. If cache exists:
   a. Compare cache.run_id with current TE_RUN_ID
   b. State = 'mid_session' if match, 'crashed' if mismatch
   c. Set initial_content = cache.content
   d. Set initial_sha256 = cache.base_sha256 (NOT content_sha256!)
   ↓
5. Create editor with initial_content
   ↓
6. Set editor._cached_content = initial_content
   ↓
7. Broadcast cache state to parent frame
   ↓
8. If crashed state: show toast notification
```

**Critical Detail:** Restoration uses `base_sha256` (disk version at edit start) not `content_sha256` (draft version). This preserves the baseline for collision detection when user eventually saves.

### Save Flow (Save Button → Clean State)

```
1. User clicks Save (or Ctrl+S)
   ↓
2. POST /write endpoint called
   ↓
3. Validate base_sha256 matches current disk SHA
   ↓
4. If mismatch: return 409 Conflict (external edit detected)
   ↓
5. If match: write_full() performs atomic write
   ↓
6. Clear session cache:
   HistoryStore.clear_cached_document(project_path, path)
   ↓
7. Delete sidecar file
   ↓
8. Remove in-memory cache entry
   ↓
9. Broadcast cache state: state='clean', unsaved=false
   ↓
10. Send save acknowledgement (prevents watcher self-echo)
```

---

## External Change Handling

### Watcher Invalidation

When file watcher detects external modification:

```python
def _apply_watcher_replace(path, content, sha256, project_path):
    # Apply new content to editor
    editor.set_value(content)
    editor._cached_content = content
    set_current_file(path, sha256)
    
    # Check if cached draft exists
    cache_entry = _history_store.get_cached_document(project_path, path)
    if cache_entry:
        cached_sha = cache_entry.get('content_sha256')
        if cached_sha and sha256 and cached_sha != sha256:
            # SHA mismatch: external change invalidates draft
            print(f"[SESSION_CACHE] External edit detected; clearing cached draft")
            _history_store.clear_cached_document(project_path, path)
            external_change = True
    
    # Broadcast clean state
    _broadcast_cache_state(
        project_path, path,
        state='clean',
        unsaved=False,
        reason='watcher_external' if external_change else 'watcher_replace'
    )
```

**Rationale:** External edits (e.g., `git checkout`, vim save, format-on-save) represent canonical truth. Cached drafts based on old content are no longer valid and must be discarded to prevent resurrection of stale state.

---

## Cache State Broadcasting

### Purpose

The parent frame (application shell) needs real-time awareness of draft state to:
- Update filename display (show unsaved indicator)
- Show/hide draft badges
- Track current file path for navigation
- Enable "Discard Draft" UI controls

### Protocol

Backend → NiceGUI iframe → Parent frame via `postMessage`:

```javascript
// In codemirror.js (vendored)
emitCacheState(payload) {
    if (typeof window.parent !== 'undefined' && window.parent !== window) {
        try {
            window.parent.postMessage({
                type: 'cm6-cache-state',
                ...payload
            }, '*');
        } catch (err) {
            console.warn('[CodeMirror] Failed to emit cache state:', err);
        }
    }
}
```

**Payload Structure:**
```json
{
  "type": "cm6-cache-state",
  "path": "/absolute/path/to/file.py",
  "project_path": "/absolute/project/root",
  "relative_path": "src/module/file.py",
  "file_label": "file.py",
  "directory_label": "src/module/file.py",
  "state": "mid_session",
  "unsaved": true,
  "reason": "persist",
  "updated_at": "2025-11-26T12:34:56.789Z",
  "timestamp": 1732627496.789,
  "content_sha256": "abc123...",
  "base_sha256": "def456...",
  "run_id": "shell-12345-67890"
}
```

**State Values:**
- `clean`: No unsaved changes, no cache
- `mid_session`: Active draft in same run
- `crashed`: Recovered draft from previous run

**Reason Values:**
- `init`: Editor first load
- `persist`: Debounced cache write
- `restore`: Cache restored on page load
- `discard`: User explicitly discarded draft
- `watcher_replace`: File updated by watcher
- `watcher_external`: External edit cleared draft

---

## API Endpoints

### GET `/session_cache`

Retrieve cached session for a specific file.

**Parameters:**
- `project`: Absolute project root path
- `path`: Absolute file path

**Response (cache exists):**
```json
{
  "ok": true,
  "data": {
    "state": "mid_session",
    "content": "... full content ...",
    "content_sha256": "abc123...",
    "base_sha256": "def456...",
    "unsaved": true,
    "run_id": "shell-12345-67890",
    "updated_at": "2025-11-26T12:34:56.789Z",
    "current_run_id": "shell-12345-67890"
  }
}
```

**Response (no cache):**
```json
{
  "ok": true,
  "data": null
}
```

### DELETE `/session_cache`

Discard cached session for a specific file.

**Parameters:**
- `project`: Absolute project root path
- `path`: Absolute file path

**Response:**
```json
{
  "ok": true,
  "data": {
    "cleared": true
  }
}
```

### POST `/editor/discard_draft`

Discard draft for currently active file in the editor.

**Request Body:**
```json
{
  "path": "/absolute/path/to/file.py"
}
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "cleared": true
  }
}
```

**Side Effects:**
- Deletes sidecar file
- Removes in-memory cache entry
- Broadcasts `state='clean'` to parent frame

---

## Collision Detection

### Base SHA Validation

Every save operation validates the baseline hasn't changed:

```python
def write_file_route(data: dict):
    path = data['path']
    content = data['content']
    client_base_sha = data.get('base_sha256')
    
    # Read current disk file
    current_meta = _get_file_meta(path)
    disk_sha = current_meta['sha256']
    
    # Check if baseline changed
    if client_base_sha and client_base_sha != disk_sha:
        raise BaseMismatchError(
            'File was modified externally. Reload to see changes.',
            disk_content=path.read_text(),
            disk_sha=disk_sha
        )
    
    # Safe to write
    write_full(path, content)
```

**Scenario:** User edits file, external process (git, vim, etc.) modifies disk, user attempts save.

**Outcome:** 409 Conflict error prevents data loss. User must reload to see external changes before saving again.

---

## Performance Characteristics

### Write Frequency

- **Debounce:** 1 second
- **Typical editing:** ~1 write/second during active typing
- **Idle editing:** No writes (timer canceled)
- **Storage overhead:** ~5-10 KB per cached document (1000 lines average)

### Read Frequency

- **Page load:** Once per file open
- **Typical:** 1-2 reads per minute (on browser refresh)

### Disk Impact

**Single document:**
- Write: ~10ms (includes fsync)
- Read: ~5ms (cached by OS)

**12 documents (Phase 3):**
- Total storage: ~60-120 KB
- Negligible impact on modern storage

---

## Implementation Details

### HistoryStore Methods

**File:** `app/apps/file_editor_cm6/history_store.py`

```python
class HistoryStore:
    def get_cached_document(self, project_path: str, file_path: str) -> Optional[Dict]:
        """Retrieve cached session from sidecar file."""
        cache_key = self._normalize_cache_key(project_path, file_path)
        entry = self._read_sidecar(cache_key)
        if entry:
            # Update in-memory copy
            self._data["session_cache"][cache_key] = entry
        return dict(entry) if entry else None
    
    def upsert_cached_document(
        self, project_path: str, file_path: str,
        content: str, base_sha256: str,
        run_id: str, shell_id: str, shell_run_id: str,
        launcher_pid: int, worker_pid: int
    ) -> Dict:
        """Update or insert cached session and write to sidecar."""
        cache_key = self._normalize_cache_key(project_path, file_path)
        content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
        unsaved = (content_sha256 != base_sha256)
        
        entry = {
            "content": content,
            "content_length": len(content),
            "content_sha256": content_sha256,
            "base_sha256": base_sha256,
            "unsaved": unsaved,
            "run_id": run_id,
            "shell_id": shell_id,
            "shell_run_id": shell_run_id,
            "launcher_pid": launcher_pid,
            "worker_pid": worker_pid,
            "updated_at": _utc_timestamp(),
        }
        
        # Atomic write to sidecar
        self._write_sidecar(cache_key, entry)
        self._data["session_cache"][cache_key] = entry
        return dict(entry)
    
    def clear_cached_document(self, project_path: str, file_path: str) -> bool:
        """Remove cached session and sidecar file."""
        cache_key = self._normalize_cache_key(project_path, file_path)
        self._delete_sidecar(cache_key)
        existed = cache_key in self._data["session_cache"]
        if existed:
            del self._data["session_cache"][cache_key]
        return existed
```

### Editor Integration

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

**On Editor Change:**
```python
def _on_editor_change(event):
    value = editor.value or ''
    editor._cached_content = value
    _schedule_cache_persist()

def _schedule_cache_persist():
    global _cache_persist_timer
    if _cache_persist_timer:
        _cache_persist_timer.cancel()
    _cache_persist_timer = ui.timer(1.0, _persist_to_cache_debounced, once=True)
```

**On Page Load:**
```python
# Check for cached session
cached_entry = _history_store.get_cached_document(project_path, initial_path)
if cached_entry and isinstance(cached_entry.get('content'), str):
    runtime_meta = _get_runtime_metadata()
    cached_run = cached_entry.get('run_id', 'unknown')
    restored_state = 'mid_session' if cached_run == runtime_meta['run_id'] else 'crashed'
    
    # Restore content
    initial_content = cached_entry['content']
    initial_sha256 = cached_entry['base_sha256']  # NOT content_sha256!
    
    # Show notification
    if restored_state == 'crashed':
        ui.notify('Recovered changes from prior crash', color='orange')
```

---

## Security Considerations

### Path Validation

All paths validated via `_expand_and_validate_path()`:
- Restricted to user home directory
- Prevents path traversal attacks
- Rejects symbolic links escaping sandbox

### Cache Key Normalization

Paths resolved to absolute canonical form before hashing:
- Handles relative paths, `~`, symlinks
- Prevents cache misses from path variations
- Consistent across sessions and devices

### Crash Detection

Run ID from environment variables controlled by framework:
- No user input affects crash detection
- Cannot be spoofed via frontend
- Secure baseline for state determination

---

## Known Limitations

### Single Worker Assumption

Current implementation assumes single worker process per project:
- Multiple workers may race on cache writes
- **Future Solution (Phase 2):** Include worker ID in cache key

### Large Files

Files >1MB may cause slow cache writes:
- No current limit enforced
- **Future Solution:** Add content length cap (skip caching for large files)

### Binary Files

UTF-8 encoding assumed:
- Binary files will fail to cache (encoding error)
- **Future Solution:** Check MIME type before caching

---

## Future Enhancements

### Phase 2: Multi-Document Sessions

- Support up to 12 concurrent cached files per project
- "Save All" button to persist all drafts at once
- "Discard All" for bulk cleanup
- UI indicator showing number of unsaved documents

### Phase 3: Cache Management UI

- Sidebar showing all cached sessions with timestamps
- Per-document restore/discard buttons
- Auto-cleanup of stale entries (>7 days old)
- Cache size limits (max 10MB per entry)
- Compression for large files

---

## Debugging

### Log Output

Enable session cache debugging:

```python
# In editor_app.py
print(f"[SESSION_CACHE] Persisted draft for {current_file}", file=sys.stderr)
print(f"[SESSION_CACHE] External edit detected; clearing cached draft", file=sys.stderr)
```

### Cache Inspection

View cached drafts:
```bash
ls -lh ~/.cache/cm6_sessions/
cat ~/.cache/cm6_sessions/<cache_key>.json | jq .
```

### State Verification

Check in-memory cache:
```python
from app.apps.file_editor_cm6.stores import _history_store
cache = _history_store._data.get("session_cache", {})
print(f"Cached entries: {len(cache)}")
for key, entry in cache.items():
    print(f"  {entry.get('updated_at')}: {entry.get('content_length')} chars")
```

---

## Related Documentation

- Implementation Plan: `notes/2025-11-14_Session_Cache_Implementation_Plan.md`
- Technical Architecture: `docs/apps/code_cm6/TECHNICAL.md`
- Framework Shells: Section 8.5 in TECHNICAL.md
- File Watcher System: Section 5 in TECHNICAL.md

---

**Document Version:** 1.0  
**Author:** GitHub Copilot (Documentation Agent)  
**Date:** 2025-11-26
