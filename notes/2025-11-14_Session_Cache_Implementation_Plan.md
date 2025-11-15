# Session Cache & Crash Recovery Implementation Plan

**Date:** November 14, 2025  
**Author:** Codex (GPT-5)  
**Status:** Ready for Implementation  
**Phase:** 1 (Single Document Session)

---

## Overview

Implement crash-safe session persistence for the NiceGUI CodeMirror 6 editor that guarantees unsaved edits survive browser/app lifecycle events. This plan covers **Phase 1: Single Document Session** with the architecture designed to scale to **Phase 3: Multi-Document Sessions (up to 12 concurrent)**.

---

## Three-State System

### State 1: Fresh (Ready to Edit)
- **Trigger:** New document opened, document saved successfully, or user discards draft
- **Behavior:** Editor is clean, no cached session exists for this document
- **Cache Status:** No entry in `session_cache` for this `(project_path, file_path)` key

### State 2: Mid-Session (Draft In-Flight)
- **Trigger:** User edits content, then leaves page (navigation, refresh, connection loss)
- **Behavior:** On page re-entry, editor content is automatically restored from cache
- **Cache Status:** Entry exists, `run_id` matches current `TE_RUN_ID` → **"Draft Carryover"**
- **No Modal:** Silent restoration, user continues editing

### State 3: Crashed (Post-Crash Recovery)
- **Trigger:** App/worker crash detected (mismatched `run_id` or shell IDs)
- **Behavior:** On page load, crash recovery modal appears offering restoration or discard
- **Cache Status:** Entry exists, `run_id` differs from current `TE_RUN_ID` → **"Crash Recovery"**
- **Modal Required:** User must choose "Restore" or "Discard"

---

## Architecture

### Storage Layer: `HistoryStore` (Extended)

**Location:** `app/apps/file_editor_cm6/history_store.py`

#### New Schema Extension

Add a `session_cache` dictionary to the existing data structure:

```python
self._data: Dict[str, object] = {
    "recent_projects": [],
    "projects": {},
    "active_project": None,
    "session_state": {},
    "session_cache": {},  # NEW: keyed by normalized (project_path, file_path)
}
```

#### Cache Entry Structure

Each `session_cache[cache_key]` contains:

```python
{
    "content": str,              # Full buffer content
    "content_length": int,       # Length in characters
    "content_sha256": str,       # SHA-256 hash of content
    "base_sha256": str,          # SHA-256 of last saved disk version
    "unsaved": bool,             # True if content != disk
    "run_id": str,               # TE_RUN_ID when cached
    "shell_id": str,             # TE_FRAMEWORK_SHELL_ID
    "shell_run_id": str,         # TE_FRAMEWORK_SHELL_RUN_ID
    "launcher_pid": int,         # Launcher process PID
    "worker_pid": int,           # Worker process PID
    "updated_at": str,           # ISO 8601 timestamp
}
```

#### Atomic Sidecar JSON Storage

- **Directory Layout:** Each cache entry is persisted as `~/.cache/cm6_sessions/<cache_key>.json`, where `<cache_key>` is the normalized `project::file` identifier slugged for filesystem safety (e.g., SHA-1 of the raw string + truncated filename). This keeps the JSON audit trail outside the primary `code_oss_history.json`, avoids gigantic monolith files, and makes it trivial to inspect or prune individual drafts.
- **Write Flow:** `upsert_cached_document()` writes to a uniquely named temp file (e.g., `<cache_key>.json.tmp`) created via `NamedTemporaryFile(delete=False)` inside the same directory, dumps the JSON payload, calls `flush(); os.fsync()`, then atomically swaps it into place with `os.replace(tmp_path, final_path)`. This guarantees an all-or-nothing write even if Termux, Python, or the device dies mid-write.
- **Read Flow:** `get_cached_document()` first looks in-memory, then—if missing—checks the sidecar file, loads it, caches it in-memory, and returns it. This hybrid approach ensures RAM copies stay in sync without sacrificing durability.
- **Garbage Collection:** `clear_cached_document()` deletes both the in-memory entry and the sidecar file (ignore if already missing). Future Phases can add TTL-based cleanup or compression.

#### Cache Key Normalization

```python
def _normalize_cache_key(self, project_path: str, file_path: str) -> str:
    """Generate normalized cache key for session storage."""
    try:
        norm_project = str(Path(project_path).expanduser().resolve(strict=False))
        norm_file = str(Path(file_path).expanduser().resolve(strict=False))
        return f"{norm_project}::{norm_file}"
    except Exception:
        return f"{project_path}::{file_path}"
```

#### New Helper Methods

**1. Get Cached Document**

```python
def get_cached_document(self, project_path: str, file_path: str) -> Optional[Dict[str, object]]:
    """Retrieve cached session for a document."""
    cache_key = self._normalize_cache_key(project_path, file_path)
    with self._lock:
        cache: Dict[str, Dict] = self._data.setdefault("session_cache", {})
        entry = cache.get(cache_key)
        return dict(entry) if entry else None
```

**2. Upsert Cached Document**

```python
def upsert_cached_document(
    self,
    project_path: str,
    file_path: str,
    content: str,
    base_sha256: str,
    run_id: str,
    shell_id: str,
    shell_run_id: str,
    launcher_pid: int,
    worker_pid: int,
) -> Dict[str, object]:
    """Update or insert cached session entry."""
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
    
    with self._lock:
        cache: Dict[str, Dict] = self._data.setdefault("session_cache", {})
        cache[cache_key] = entry
        self._save_locked()
        return dict(entry)
```

**3. Clear Cached Document**

```python
def clear_cached_document(self, project_path: str, file_path: str) -> bool:
    """Remove cached session entry."""
    cache_key = self._normalize_cache_key(project_path, file_path)
    with self._lock:
        cache: Dict[str, Dict] = self._data.setdefault("session_cache", {})
        existed = cache_key in cache
        if existed:
            del cache[cache_key]
            self._save_locked()
        return existed
```

**4. List All Cached Documents (Future: Phase 3)**

```python
def list_cached_documents(self, project_path: Optional[str] = None) -> List[Dict[str, object]]:
    """List all cached sessions, optionally filtered by project."""
    with self._lock:
        cache: Dict[str, Dict] = self._data.get("session_cache", {})
        results = []
        for cache_key, entry in cache.items():
            parts = cache_key.split("::", 1)
            if len(parts) == 2:
                entry_project, entry_file = parts
                if project_path is None or entry_project == project_path:
                    results.append({
                        "project_path": entry_project,
                        "file_path": entry_file,
                        "cache_key": cache_key,
                        **entry
                    })
        return results
```

---

### Backend API Layer: `main.py` (Extended)

**Location:** `app/apps/file_editor_cm6/main.py`

#### Runtime Metadata Helper

Add helper to collect runtime metadata from environment variables:

```python
def _get_runtime_metadata() -> Dict[str, object]:
    """Collect runtime metadata for crash detection."""
    import os
    return {
        "run_id": os.getenv("TE_RUN_ID", "unknown"),
        "shell_id": os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown"),
        "shell_run_id": os.getenv("TE_FRAMEWORK_SHELL_RUN_ID", "unknown"),
        "launcher_pid": int(os.getenv("TE_LAUNCHER_PID", "0")),
        "worker_pid": os.getpid(),
    }
```

#### Update `_build_state_payload` to Include Runtime Metadata

Modify the existing `_build_state_payload()` function (around line 51-100):

```python
def _build_state_payload() -> dict:
    project_path = _history_store.get_active_project()
    # ... existing code ...
    
    editor_prefs = _preferences_store.get_preferences(project_path)
    runtime_meta = _get_runtime_metadata()  # NEW
    
    return {
        "activeProject": project_path,
        "activeProjectLabel": project_label,
        "activeProjectExists": project_exists,
        "activeProjectMessage": project_message,
        "lastFile": last_file,
        "lastFileLabel": last_file_label,
        "lastFileExists": last_file_exists,
        "lastFileMessage": last_file_message,
        "recents": recents,
        "preferences": editor_prefs,
        "runtime": runtime_meta,  # NEW: expose to frontend
    }
```

#### New Endpoint: GET `/session_cache`

```python
@file_editor_cm6_bp.get('/session_cache')
def get_session_cache(
    project: str = Query(...),
    path: str = Query(...),
):
    """Retrieve cached session for a document."""
    expanded_project, err = _expand_and_validate_path(project)
    if err:
        raise HTTPException(status_code=403, detail=err)
    
    expanded_path, err = _expand_and_validate_path(path)
    if err:
        raise HTTPException(status_code=403, detail=err)
    
    cached = _history_store.get_cached_document(expanded_project, expanded_path)
    
    if not cached:
        return {"ok": True, "data": None}
    
    # Determine state: crashed vs mid-session
    runtime_meta = _get_runtime_metadata()
    current_run_id = runtime_meta["run_id"]
    cached_run_id = cached.get("run_id", "unknown")
    
    state = "mid_session" if current_run_id == cached_run_id else "crashed"
    
    return {
        "ok": True,
        "data": {
            "state": state,
            "content": cached["content"],
            "content_sha256": cached["content_sha256"],
            "base_sha256": cached["base_sha256"],
            "unsaved": cached["unsaved"],
            "run_id": cached_run_id,
            "updated_at": cached["updated_at"],
            "current_run_id": current_run_id,
        }
    }
```

#### New Endpoint: DELETE `/session_cache`

```python
@file_editor_cm6_bp.delete('/session_cache')
def delete_session_cache(
    project: str = Query(...),
    path: str = Query(...),
):
    """Discard cached session for a document."""
    expanded_project, err = _expand_and_validate_path(project)
    if err:
        raise HTTPException(status_code=403, detail=err)
    
    expanded_path, err = _expand_and_validate_path(path)
    if err:
        raise HTTPException(status_code=403, detail=err)
    
    existed = _history_store.clear_cached_document(expanded_project, expanded_path)
    
    return {
        "ok": True,
        "data": {
            "cleared": existed
        }
    }
```

#### Modify `/write` Route to Purge Cache on Save

Update the existing `/write` route (around line 131-187) to clear cache after successful write:

```python
@file_editor_cm6_bp.post('/write')
async def write_file_route(data: dict = Body(...)):
    path = data.get('path')
    content = data.get('content')
    # ... existing validation and write logic ...
    
    try:
        # ... existing write_full call ...
        file_meta = await anyio.to_thread.run_sync(
            lambda: write_full(project_root, str(rel_path), content, base_sha256=base_sha256)
        )
        
        # NEW: Purge cache entry on successful save
        project_path = _history_store.get_active_project()
        if project_path:
            _history_store.clear_cached_document(project_path, path)
        
        # ... existing push_save_ack, emit_diff_changed, cache invalidation ...
        
        return {
            "ok": True,
            "data": {
                "mtime": file_meta["mtime"],
                "size": file_meta["size"],
                "sha256": file_meta["sha256"]
            }
        }
    except BaseMismatchError as e:
        # ... existing error handling ...
```

---

### NiceGUI Editor Layer: `editor_app.py` (Extended)

**Location:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

#### Debounced Cache Persistence Hook

Add debounced hook to persist buffer on every change:

```python
import os
from nicegui import ui

# Add near top of file with other globals
_cache_persist_timer = None
_cache_persist_debounce_ms = 1000  # 1 second debounce

def _persist_to_cache_debounced():
    """Debounced cache persistence called on editor change."""
    global _cache_persist_timer
    
    editor = get_active_editor()
    current_file = get_current_file()
    current_sha = get_current_file_sha256()
    
    if not editor or not current_file:
        return
    
    project_path = _history_store.get_active_project()
    if not project_path:
        return
    
    # Get current buffer content
    # Note: NiceGUI's ui.codemirror doesn't expose .value in Python;
    # we'll need to implement a custom method or use run_javascript
    # For now, assume we track content via set_value calls and on_change handler
    
    # Collect runtime metadata
    runtime_meta = {
        "run_id": os.getenv("TE_RUN_ID", "unknown"),
        "shell_id": os.getenv("TE_FRAMEWORK_SHELL_ID", "unknown"),
        "shell_run_id": os.getenv("TE_FRAMEWORK_SHELL_RUN_ID", "unknown"),
        "launcher_pid": int(os.getenv("TE_LAUNCHER_PID", "0")),
        "worker_pid": os.getpid(),
    }
    
    # We need to get the actual content from the editor
    # This requires either:
    # 1. Exposing editor.value as a readable property
    # 2. Adding a custom method to vendored NiceGUI codemirror.py
    # 3. Using a hidden state variable that tracks content
    
    # For now, we'll track it via a global variable updated on changes
    current_content = getattr(editor, '_cached_content', '')
    
    _history_store.upsert_cached_document(
        project_path=project_path,
        file_path=current_file,
        content=current_content,
        base_sha256=current_sha or '',
        run_id=runtime_meta["run_id"],
        shell_id=runtime_meta["shell_id"],
        shell_run_id=runtime_meta["shell_run_id"],
        launcher_pid=runtime_meta["launcher_pid"],
        worker_pid=runtime_meta["worker_pid"],
    )
    
    print(f"[SESSION_CACHE] Persisted draft for {current_file}", file=sys.stderr)

def _schedule_cache_persist():
    """Schedule debounced cache persistence."""
    global _cache_persist_timer
    
    if _cache_persist_timer:
        _cache_persist_timer.cancel()
    
    _cache_persist_timer = ui.timer(
        _cache_persist_debounce_ms / 1000,
        _persist_to_cache_debounced,
        once=True
    )
```

#### Register Change Handler in `editor_page()`

Modify the `editor_page()` function (around line 76-150) to register the cache persist hook:

```python
@ui.page('/nc', reconnect_timeout=3.0)
async def editor_page():
    global _active_editor
    
    # ... existing initialization code ...
    
    # 4. Create Editor with Auto-Loaded Content
    editor = ui.codemirror(
        value=initial_content,
        language=initial_language,
        theme=editor_prefs.get('theme', 'cm6-dark'),
        line_wrapping=editor_prefs.get('wordWrap', False),
    ).style('flex: 1; border: none;').classes('editor-content w-full h-full').props('flat borderless')
    
    # NEW: Track content locally for cache persistence
    editor._cached_content = initial_content
    
    # NEW: Register change handler for cache persistence
    def on_editor_change(e):
        editor._cached_content = e.value
        _schedule_cache_persist()
    
    editor.on_value_change(on_editor_change)
    
    # ... existing settings application, diff loading, watcher subscription ...
```

#### Add Cache Clear Method

Add backend method to clear cache when user discards draft:

```python
@editor_router.post('/discard_draft')
async def discard_draft(data: dict = Body(...)):
    """Discard cached session for current document."""
    path = data.get('path')
    project_path = _history_store.get_active_project()
    
    if not path or not project_path:
        return {"ok": False, "error": "No active document"}
    
    cleared = _history_store.clear_cached_document(project_path, path)
    
    return {"ok": True, "data": {"cleared": cleared}}
```

#### Modify `set_editor_content` to Clear Cache on Document Change

Update the existing `set_editor_content` endpoint (around line 174) to clear cache when switching documents:

```python
@editor_router.post('/set_content')
async def set_editor_content(data: dict = Body(...)):
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready"}
    
    new_path = data.get('path', '')
    old_path = get_current_file()
    project_path = _history_store.get_active_project()
    
    # NEW: Clear cache for old document if switching
    if old_path and old_path != new_path and project_path:
        _history_store.clear_cached_document(project_path, old_path)
    
    content, language = data.get('content', ''), data.get('language', 'python')
    content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
    set_current_file(new_path, content_sha256)
    
    editor.set_value(content)
    editor._cached_content = content  # NEW: Update tracked content
    editor.set_language(language)
    editor.update()
    
    # ... existing watcher subscription, settings application, diff loading ...
```

---

### Frontend Layer: Crash Recovery Modal (Plain JS)

**Location:** `app/static/vendor/nicegui/...` (to be determined during implementation)

This section describes the **host page** (not the iframe) that embeds the NiceGUI editor. The host page is responsible for:
1. Checking cache state on page load
2. Displaying crash recovery modal if needed
3. Calling backend endpoints to restore or discard

#### Modal HTML (Injected via JavaScript)

```html
<div id="crash-modal" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:9999; justify-content:center; align-items:center;">
  <div style="background:#1e293b; border-radius:8px; padding:24px; max-width:480px; box-shadow:0 8px 32px rgba(0,0,0,0.5);">
    <h2 style="margin:0 0 16px; color:#f1f5f9; font-size:20px; font-weight:600;">Unsaved Changes Detected</h2>
    <p id="crash-message" style="margin:0 0 24px; color:#cbd5e1; font-size:14px; line-height:1.6;"></p>
    <div style="display:flex; gap:12px; justify-content:flex-end;">
      <button id="crash-discard" style="padding:8px 16px; background:#475569; color:#f1f5f9; border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:500;">Discard</button>
      <button id="crash-restore" style="padding:8px 16px; background:#3b82f6; color:#ffffff; border:none; border-radius:6px; cursor:pointer; font-size:14px; font-weight:600;">Restore</button>
    </div>
  </div>
</div>
```

#### Modal Logic (Plain JavaScript)

```javascript
// Add this script to the host page that embeds the NiceGUI iframe
// Location: TBD (likely injected via editor_app.py or separate template)

(function() {
  'use strict';
  
  // Configuration
  const CACHE_CHECK_ENDPOINT = '/api/app/file_editor_cm6/session_cache';
  const CACHE_DELETE_ENDPOINT = '/api/app/file_editor_cm6/session_cache';
  
  // Get current project and file from page context
  // This assumes the host page has access to these values
  const PROJECT_PATH = window.EDITOR_PROJECT_PATH || '';
  const FILE_PATH = window.EDITOR_FILE_PATH || '';
  
  async function checkCacheState() {
    if (!PROJECT_PATH || !FILE_PATH) {
      console.log('[CRASH_CHECK] No project/file context, skipping');
      return;
    }
    
    try {
      const url = `${CACHE_CHECK_ENDPOINT}?project=${encodeURIComponent(PROJECT_PATH)}&path=${encodeURIComponent(FILE_PATH)}`;
      const response = await fetch(url);
      const result = await response.json();
      
      if (!result.ok || !result.data) {
        console.log('[CRASH_CHECK] No cached session found');
        return;
      }
      
      const cache = result.data;
      const state = cache.state;
      
      if (state === 'mid_session') {
        // Silent restoration - just load content into editor
        console.log('[CRASH_CHECK] Mid-session detected, restoring silently');
        restoreContentToEditor(cache.content);
      } else if (state === 'crashed') {
        // Show crash recovery modal
        console.log('[CRASH_CHECK] Crash detected, showing recovery modal');
        showCrashModal(cache);
      }
    } catch (err) {
      console.error('[CRASH_CHECK] Failed to check cache state:', err);
    }
  }
  
  function showCrashModal(cache) {
    const modal = document.getElementById('crash-modal');
    if (!modal) {
      console.error('[CRASH_MODAL] Modal element not found');
      return;
    }
    
    const message = document.getElementById('crash-message');
    const updatedAt = new Date(cache.updated_at).toLocaleString();
    message.textContent = `A previous editing session crashed or was interrupted. Your unsaved changes from ${updatedAt} can be restored.`;
    
    modal.style.display = 'flex';
    
    document.getElementById('crash-restore').onclick = async () => {
      console.log('[CRASH_MODAL] User chose to restore');
      restoreContentToEditor(cache.content);
      modal.style.display = 'none';
    };
    
    document.getElementById('crash-discard').onclick = async () => {
      console.log('[CRASH_MODAL] User chose to discard');
      await discardCache();
      modal.style.display = 'none';
    };
  }
  
  function restoreContentToEditor(content) {
    // Call the NiceGUI backend to set editor content
    // This may need to be adjusted based on actual API structure
    fetch('/api/app/file_editor_cm6/editor/set_content', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        path: FILE_PATH,
        content: content,
        language: detectLanguage(FILE_PATH)
      })
    }).then(r => r.json())
      .then(result => {
        if (result.ok) {
          console.log('[CRASH_MODAL] Content restored successfully');
        } else {
          console.error('[CRASH_MODAL] Failed to restore content:', result);
        }
      })
      .catch(err => console.error('[CRASH_MODAL] Restore request failed:', err));
  }
  
  async function discardCache() {
    try {
      const url = `${CACHE_DELETE_ENDPOINT}?project=${encodeURIComponent(PROJECT_PATH)}&path=${encodeURIComponent(FILE_PATH)}`;
      const response = await fetch(url, {method: 'DELETE'});
      const result = await response.json();
      console.log('[CRASH_MODAL] Cache discarded:', result);
    } catch (err) {
      console.error('[CRASH_MODAL] Failed to discard cache:', err);
    }
  }
  
  function detectLanguage(path) {
    if (path.endsWith('.py') || path.endsWith('.pyw')) return 'python';
    if (path.endsWith('.js')) return 'javascript';
    if (path.endsWith('.ts')) return 'typescript';
    if (path.endsWith('.html') || path.endsWith('.htm')) return 'html';
    if (path.endsWith('.css')) return 'css';
    if (path.endsWith('.json') || path.endsWith('.webmanifest')) return 'json';
    if (path.endsWith('.md') || path.endsWith('.mdx')) return 'markdown';
    if (path.endsWith('.sh') || path.endsWith('.bash') || path.endsWith('.zsh')) return 'shell';
    if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
    return 'text';
  }
  
  // Run check on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkCacheState);
  } else {
    checkCacheState();
  }
})();
```

---

## Implementation Steps

### Step 1: Extend `HistoryStore` Schema

**File:** `app/apps/file_editor_cm6/history_store.py`

**Changes:**
1. Add `"session_cache": {}` to `self._data` in `__init__` (line ~38)
2. Update `_load()` to include `session_cache` field (line ~58)
3. Add `_normalize_cache_key()` method
4. Add `get_cached_document()` method
5. Add `upsert_cached_document()` method
6. Add `clear_cached_document()` method
7. Add `list_cached_documents()` method (for Phase 3)
8. Import `hashlib` at top of file
9. Add `_session_cache_dir` helper plus `_ensure_cache_dir()` to create `~/.cache/cm6_sessions`
10. Implement atomic sidecar JSON persistence (`_write_sidecar`, `_read_sidecar`, `_delete_sidecar`)

**Estimated Lines Changed:** ~80 lines added

---

### Step 2: Add Runtime Metadata Helper to `main.py`

**File:** `app/apps/file_editor_cm6/main.py`

**Changes:**
1. Add `_get_runtime_metadata()` function after `_get_active_project_root()` (after line ~137)
2. Update `_build_state_payload()` to include `"runtime": runtime_meta` in return dict (line ~100)

**Estimated Lines Changed:** ~15 lines added

---

### Step 3: Add Session Cache Endpoints to `main.py`

**File:** `app/apps/file_editor_cm6/main.py`

**Changes:**
1. Add `GET /session_cache` endpoint (after `/status` endpoint, around line ~217)
2. Add `DELETE /session_cache` endpoint (after GET endpoint)
3. Modify `/write` route to call `_history_store.clear_cached_document()` after successful write (around line ~175)

**Estimated Lines Changed:** ~60 lines added, ~5 lines modified

---

### Step 4: Add Cache Persistence to `editor_app.py`

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

**Changes:**
1. Import `os` at top of file (if not already imported)
2. Add global variables `_cache_persist_timer` and `_cache_persist_debounce_ms` (around line ~30)
3. Add `_persist_to_cache_debounced()` function
4. Add `_schedule_cache_persist()` function
5. In `editor_page()`, add `editor._cached_content = initial_content` after editor creation (around line ~127)
6. In `editor_page()`, add `on_editor_change` handler and register with `editor.on_value_change()` (around line ~128)
7. Add `POST /discard_draft` endpoint
8. Modify `POST /set_content` endpoint to clear cache on document switch (around line ~174)

**Estimated Lines Changed:** ~80 lines added, ~10 lines modified

---

### Step 5: Extend Vendored NiceGUI (Mandatory)

**Files:**  
`app/static/vendor/nicegui/elements/codemirror/codemirror.py`  
`app/static/vendor/nicegui/elements/codemirror/codemirror.js`

**Why mandatory:** Relying on `_cached_content` mirrors risks diverging from the real CM6 buffer whenever backend-side injections (diff preview, restore, formatting) occur. We will therefore harden NiceGUI’s CodeMirror wrapper so the Python backend remains the single source of truth.

**Changes:**
1. Add a native `on_change` hook inside `codemirror.js` that forwards every document mutation to Python via NiceGUI’s event bus (`ui.run_javascript` bridge). Include debounce guards on the JS side so we do not spam the backend faster than 60 Hz.
2. Expose `get_value()` / `set_value()` helpers plus a `value` property on the Python wrapper so `HistoryStore` persistence code can always request the authoritative buffer text without guessing.
3. Provide `request_content()` RPC that NiceGUI can call synchronously when persisting: Python asks JS for the current doc, JS responds through `ui.run_javascript` callback, and we resolve the awaitable before writing the sidecar JSON.
4. Emit a structured event payload containing `content`, `cursor`, `selection`, and a `change_id`. Even if we only store `content` in Phase 1, Phase 3’s multi-document UX can reuse the same event data for richer state restores.

**Estimated Lines Changed:** ~60-90 lines (combined Python + JS) because we are adding the new bridge, not just toggling an existing handler.

---

### Step 6: Wire Crash & Save Modals Into Host Shell

**Files:**  
`app/apps/file_editor_cm6/main.js` (entry)  
`app/apps/file_editor_cm6/crash_report.js` (new)  
`app/apps/file_editor_cm6/save_warning.js` (new)

**Definitive Placement:** The host shell already boots the NiceGUI iframe via `main.js`, so we’ll import both modal controllers there. `main.js` remains the only file that touches DOM elements outside the iframe—keeping persistence logic backend/NiceGUI-only while still letting the shell provide chrome-level UX.

**Crash Report Modal (`crash_report.js`):**
1. Fetch `/session_cache` on load and whenever the backend signals a “document-ready” event.
2. Render the crash modal overlay exactly once per stale entry (state === `crashed`). Auto-hide for `mid_session`.
3. Provide “Restore” (POST `/nicegui/editor/restore_draft`) and “Discard” (DELETE `/session_cache`) controls. Because persistence is backend-driven, JS just calls the endpoints and relays toast notifications.

**Save Warning Modal (`save_warning.js`):**
1. Hooks only two triggers as requested: (a) the global **Quit** button in the shell chrome and (b) the “Close” menu option. Document-switch warnings are deferred until Phase 3 (multi-doc / Save-All flow). Mention this explicitly in file header comments.
2. Uses the same modal scaffolding but surfaces the session cache metadata to warn users before they tear down the runtime.
3. When the user confirms “Discard & Quit” we call the backend `discard_draft` endpoint, then proceed with the quit/close action; “Cancel” simply closes the modal.

**Estimated Lines Changed:** ~150 lines (shared modal template + two JS modules + an import stanza in `main.js`).

---

## Testing Strategy

### Unit Tests

**Test `HistoryStore` cache methods:**
- Cache key normalization
- Upsert with various metadata combinations
- Get returns correct entry
- Clear removes entry
- Multiple entries don't interfere

**Test runtime metadata collection:**
- Verify environment variables are read correctly
- Handle missing variables gracefully

### Integration Tests

**Test cache persistence flow:**
1. Open document, make edits, leave page
2. Return to page, verify mid-session restoration (no modal)
3. Verify cache cleared after save

**Test crash recovery flow:**
1. Simulate crash (change `TE_RUN_ID` environment variable)
2. Return to page, verify modal appears
3. Test "Restore" button → content loaded
4. Test "Discard" button → cache cleared, fresh state

**Test document switching:**
1. Open document A, make edits
2. Switch to document B (with warning)
3. Verify cache for A is cleared (or preserved based on Phase 3 design)

---

## Phase 2 & 3 Preview

### Phase 2: Multi-Document Cache (Up to 12 Sessions)

**Changes:**
- Modify `clear_cached_document()` logic to NOT clear on document switch
- Add "Save All" button that iterates through all cached documents
- Add "Discard All" button that clears all cache entries
- Add UI indicator showing number of unsaved documents

**Estimated Additional Lines:** ~150 lines

### Phase 3: Cache Management UI

**Changes:**
- Add sidebar showing all cached sessions with file names and timestamps
- Add per-document "Restore" / "Discard" buttons
- Add auto-cleanup of stale cache entries (e.g., >7 days old)
- Add cache size limits (e.g., max 10MB per entry)

**Estimated Additional Lines:** ~250 lines

---

## Migration & Rollback

### Migration (Schema Update)

The `session_cache` field is automatically added to existing `code_oss_history.json` files on first write. No manual migration required.

### Rollback

If issues arise, the feature can be disabled by:
1. Comment out cache persistence calls in `editor_app.py`
2. Remove modal from host page
3. Cache entries remain in JSON but are never read/written

---

## Performance Considerations

### Write Frequency

- Debounced to 1 second (1000ms)
- Typical editing session: ~1 write per second during active typing
- Storage overhead: ~5-10KB per cached document

### Read Frequency

- Once per page load
- Typical: 1-2 times per minute (assuming occasional page refreshes)

### Storage Impact

- Single document: ~5-10KB (1000 lines avg)
- 12 documents (Phase 3): ~60-120KB
- Negligible impact on disk I/O

---

## Security Considerations

### Path Validation

- All paths validated via `_expand_and_validate_path()`
- Paths restricted to user's home directory
- Cache keys normalized to prevent path traversal attacks

### Crash Detection

- Uses environment variables controlled by framework
- No user input affects crash detection logic
- Cannot be spoofed via frontend

---

## Known Limitations

### Single Worker Assumption

Current implementation assumes a single worker process. If multiple workers serve the same project:
- Cache writes from different workers may race
- Solution: Add worker ID to cache key (Phase 2)

### Large Files

Files >1MB may cause slow cache writes. Consider:
- Add content length limit (e.g., 1MB max)
- Skip caching for files exceeding limit
- Display warning to user

### Binary Files

Current implementation assumes UTF-8 text. Binary files will fail to cache. Consider:
- Check file type before caching
- Skip non-text files

---

## Success Metrics

### Phase 1 Complete When:

1. ✅ Single document cache persists across page refresh
2. ✅ Mid-session restoration works without modal
3. ✅ Crash recovery modal appears on run_id mismatch
4. ✅ Cache cleared after successful save
5. ✅ Cache cleared when user discards via modal

### Phase 3 Complete When:

1. ✅ Up to 12 documents cached simultaneously
2. ✅ "Save All" / "Discard All" functional
3. ✅ UI shows list of unsaved documents
4. ✅ Per-document restore/discard buttons work

---

## Dependencies

### Python Packages

- `hashlib` (stdlib)
- `pathlib` (stdlib)
- `threading` (stdlib)
- `json` (stdlib)
- `os` (stdlib)

### JavaScript Libraries

None - plain vanilla JavaScript for modal

### NiceGUI API Requirements

- `ui.codemirror.on_value_change()` event handler
- `ui.codemirror.set_value()` method
- `ui.timer()` for debouncing

---

## Appendix: File Structure

```
app/apps/file_editor_cm6/
├── history_store.py          # MODIFIED: add session_cache methods
├── main.py                   # MODIFIED: add endpoints, update /write
├── nicegui_editor/
│   └── editor_app.py         # MODIFIED: add cache persistence hooks
├── static/
│   └── vendor/
│       └── nicegui/
│           └── elements/
│               └── codemirror/
│                   ├── codemirror.py    # OPTIONAL: add get_value()
│                   └── codemirror.js    # OPTIONAL: bridge for get_value()
└── template.html             # NEW or MODIFIED: add crash modal
```

---

## Implementation Timeline

### Day 1: Storage & Backend (4-6 hours)
- Step 1: Extend `HistoryStore`
- Step 2: Add runtime metadata helper
- Step 3: Add session cache endpoints
- Unit tests for storage layer

### Day 2: Editor Integration (4-6 hours)
- Step 4: Add cache persistence to editor
- Step 5: Extend vendored NiceGUI (if needed)
- Integration tests for persistence

### Day 3: Frontend & Testing (4-6 hours)
- Step 6: Add crash recovery modal
- End-to-end testing
- Bug fixes and refinement

**Total Estimated Time:** 12-18 hours for Phase 1

---

_End of Implementation Plan_
