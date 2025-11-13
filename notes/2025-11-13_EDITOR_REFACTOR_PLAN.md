# Editor Self-Sufficiency Refactor Plan

**Date:** 2025-11-13  
**Objective:** Make the NiceGUI editor module completely self-contained to fix the "blank editor after disconnect" bug and simplify architecture.

---

## Problem Statement

**Current Issue:**
After extended period away (WebSocket disconnect), the editor displays a blank document even though settings are applied correctly and the last file is known.

**Root Cause:**
1. `editor_app.py` creates blank editor: `ui.codemirror(value='', ...)`
2. `reconnect_timeout=0` prevents WebSocket reconnection (intentional, for settings refresh)
3. When iframe reloads after disconnect, it creates fresh blank editor
4. Host page (`main.js`) doesn't know iframe reloaded, so doesn't call `/editor/set_content` again
5. Result: Blank editor despite backend knowing what file should be open

**Current Architecture Fragility:**
- Editor creation depends on host page coordination
- Two-step process: (1) create blank editor → (2) host tells it what to load
- If coordination breaks (WebSocket disconnect), editor stays blank

---

## Solution Overview

**Make editor_app.py self-sufficient:**
1. **Auto-load last file on page init** - No endpoint needed, just read from history_store
2. **Move all editor-mutating logic into editor_app.py** - Encapsulation
3. **Register endpoints in editor_app.py** - Keep editor logic together
4. **Remove dependency on host coordination** - Editor works independently

**Benefits:**
- ✅ Fixes blank editor bug (auto-loads on every page load)
- ✅ Simpler architecture (no cross-file coordination)
- ✅ Better encapsulation (editor owns its operations)
- ✅ More maintainable (all editor code in one place)

---

## Code to Transfer from main.py to editor_app.py

### Endpoints to Move

All endpoints that directly manipulate the editor should move to `editor_app.py` and use `nicegui.app` for route registration.

#### 1. `/editor/set_content` (Lines 250-346)
**Current:** Called by main.js to load file content  
**After refactor:** Still needed for host page to trigger file open  
**Logic includes:**
- Set editor value, language
- Track current file path and SHA256
- Subscribe to file watcher
- Apply settings (zebra stripes, word wrap, theme, diffs)
- File change callback (re-apply content and diffs on external changes)

**Dependencies:**
- `get_active_editor()` ✓ Already in editor_app.py
- `set_current_file()` ✓ Already in editor_app.py
- `get_project_root()` from `explorer_helper`
- `init_watcher()` from `core_read`
- `subscribe()` from `core_read`
- `_preferences_store` from `main.py`
- `_history_store` from `main.py`
- `_normalize_rel_path()` from `main.py`
- `collect_diff()` from `diff_helper`

#### 2. `/editor/refresh_diffs` (Lines 348-377)
**Current:** Manually refresh git diffs for current file  
**Logic includes:**
- Get active editor
- Load diff hunks for file
- Apply to editor

**Dependencies:**
- `get_active_editor()` ✓
- `_history_store`, `_preferences_store`
- `get_project_root()`, `_normalize_rel_path()`
- `collect_diff()`

#### 3. `/editor/toggle_edit_tracking` (Lines 379-394)
**Current:** Enable/disable agent edit tracking  
**Logic includes:**
- Call `enable_edit_tracking()` or `disable_edit_tracking()`
- Save preference

**Dependencies:**
- `enable_edit_tracking()` ✓ Already in editor_app.py
- `disable_edit_tracking()` ✓ Already in editor_app.py
- `_preferences_store`

#### 4. `/editor/jump_to_line` (Lines 396-471)
**Current:** Jump to line or open file + jump to line  
**Logic includes:**
- Check if different file needs opening
- Load file content, set language
- Track file and subscribe to watcher
- Execute JavaScript to scroll to line

**Dependencies:**
- `get_active_editor()`, `get_current_file()`, `set_current_file()` ✓
- File reading, language detection
- `get_project_root()`, `init_watcher()`, `subscribe()`
- `ui.run_javascript()` for scrolling

#### 5. `/editor/debug/state` (Lines 473-497)
**Current:** Debug endpoint to inspect editor state  
**Logic:** Returns editor value, language, current file, SHA256  

**Dependencies:**
- `get_active_editor()`, `get_current_file()`, `get_current_file_sha256()` ✓

#### 6. `/editor/save` (Lines 500-601)
**Current:** Save current file with conflict detection  
**Logic includes:**
- Get content from editor
- Atomic write with SHA256 check
- Send save acknowledgement
- Invalidate caches
- Recalculate diffs

**Dependencies:**
- `get_active_editor()`, `get_current_file()`, `get_current_file_sha256()`, `set_current_file()` ✓
- `get_project_root()`, `_normalize_rel_path()`
- `init_watcher()`, `write_full()`, `push_save_ack()`, `emit_diff_changed()`
- `mark_git_cache_dirty()`, `invalidate_diff_cache()`, `collect_diff()`
- `_preferences_store`, `BaseMismatchError`

#### 7. `/editor/set_view_settings` (Lines 606-667)
**Current:** Update editor view settings (wrap, theme, diffs, shading)  
**Logic includes:**
- Map frontend keys to preferences keys
- Apply settings to editor immediately
- Save to preferences_store

**Dependencies:**
- `get_active_editor()` ✓
- `_preferences_store`, `_history_store`
- `get_project_root()`, `_normalize_rel_path()`, `collect_diff()`

---

### Helper Functions to Move or Make Accessible

#### Functions Currently in main.py That Editor Needs:

1. **`_normalize_rel_path(project_root, raw_path)`** (Lines 209-224)
   - Validates and normalizes paths relative to project root
   - **Decision:** Move to `explorer_helper.py` as shared utility OR duplicate in editor_app.py

2. **Stores: `_history_store`, `_preferences_store`** (Lines 100-101)
   - **Decision:** Import in editor_app.py from main.py OR initialize in editor_app.py
   - These are module-level singletons, safe to import

3. **Imports from other modules:**
   - `get_project_root()`, `set_project_root()` from `explorer_helper`
   - `init_watcher()`, `subscribe()`, `push_save_ack()`, `emit_diff_changed()` from `core_read`
   - `write_full()`, `BaseMismatchError`, `_get_file_meta()` from `core_write`
   - `invalidate_diff_cache()`, `collect_diff()` from `diff_helper`
   - `mark_git_cache_dirty()` from `explorer_helper`

---

### New Auto-Load Logic for editor_app.py

**On page load (in `editor_page()` function):**

```python
@ui.page('/nc', reconnect_timeout=0)
async def editor_page():
    # Load preferences from disk
    from app.apps.file_editor_cm6.main import _preferences_store, _history_store
    prefs = _preferences_store.get_preferences()
    editor_prefs = prefs.get('editor', {})
    
    # Determine what file to load
    project_path = _history_store.get_active_project()
    last_file = _history_store.get_last_file(project_path) if project_path else None
    
    # Load file content if exists
    initial_content = ''
    initial_language = 'python'
    initial_path = None
    
    if last_file and Path(last_file).is_file():
        try:
            initial_content = Path(last_file).read_text(encoding='utf-8', errors='replace')
            initial_path = last_file
            
            # Detect language
            if last_file.endswith('.py'):
                initial_language = 'python'
            elif last_file.endswith('.js'):
                initial_language = 'javascript'
            elif last_file.endswith('.md'):
                initial_language = 'markdown'
            # ... etc
            
            print(f"[EDITOR_APP] Auto-loaded last file: {last_file}", file=sys.stderr)
        except Exception as e:
            print(f"[EDITOR_APP] Failed to auto-load last file: {e}", file=sys.stderr)
    
    # Create editor with content
    editor = ui.codemirror(
        value=initial_content,  # ← NO LONGER BLANK!
        language=initial_language,
        theme=editor_prefs.get('theme', 'cm6-dark'),
        line_wrapping=editor_prefs.get('wordWrap', False),
    )
    
    # Store global reference
    _active_editor = editor
    set_current_file(initial_path, hashlib.sha256(initial_content.encode()).hexdigest())
    
    # Apply settings
    editor.set_zebra_stripes(editor_prefs.get('showShading', False))
    
    # Load diffs if enabled
    if editor_prefs.get('showInlineDiffs', False) and initial_path:
        # ... load diffs for initial file
    
    # Subscribe to file watcher if file loaded
    if initial_path:
        # ... setup watcher callback
```

**Key Change:** Editor loads with content on page init, not blank!

---

## Route Registration Approach

### Option A: Use nicegui.app directly

```python
# In editor_app.py
from nicegui import app as nicegui_app

@nicegui_app.post('/editor/set_content')
async def set_content(data: dict = Body(...)):
    editor = get_active_editor()
    # ... logic
```

**URL:** `/api/app/file_editor_cm6/ui/editor/set_content`  
**Note:** Routes are under `/ui/` because NiceGUI is mounted at `/ui`

### Option B: Create router and include in main.py

```python
# In editor_app.py
from fastapi import APIRouter

editor_router = APIRouter(prefix='/editor')

@editor_router.post('/set_content')
async def set_content(data: dict = Body(...)):
    # ... logic

# In main.py
from .nicegui_editor.editor_app import editor_router
file_editor_cm6_bp.include_router(editor_router)
```

**URL:** `/api/app/file_editor_cm6/editor/set_content` (same as current)

**Recommendation:** **Option B** - Keeps URLs consistent, easier migration for main.js

---

## Frontend Changes Required

### Update main.js

**Current behavior:**
```javascript
// main.js
openFile(path) {
    const content = await readFile(path);
    await fetch('/api/app/file_editor_cm6/editor/set_content', {
        method: 'POST',
        body: JSON.stringify({ content, path, language })
    });
}
```

**No change needed if using Option B for routes!**

The only difference is that the endpoint now lives in `editor_app.py` instead of `main.py`, but the URL remains the same.

### Handle iframe reload (optional)

If we want to notify host page when iframe reloads:

```javascript
// In editor_app.py, add JavaScript to iframe
ui.add_head_html('''
<script>
  window.addEventListener('load', () => {
    // Notify parent that iframe loaded
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'editor-loaded' }, '*');
    }
  });
</script>
''')

// In main.js (host page)
window.addEventListener('message', (event) => {
  if (event.data.type === 'editor-loaded') {
    console.log('[MAIN] Editor iframe reloaded');
    // Could re-sync state here if needed
  }
});
```

**But this is optional** - auto-loading makes it unnecessary!

---

## Migration Steps

### Phase 1: Preparation
1. ✅ Create this plan document
2. Review all dependencies and imports needed in editor_app.py
3. Decide on shared utility location for `_normalize_rel_path()`
4. Create backup of current working state

### Phase 2: Move Stores and Utilities
1. Move or make accessible: `_history_store`, `_preferences_store`
2. Move or make accessible: `_normalize_rel_path()`
3. Import necessary helpers from other modules

### Phase 3: Implement Auto-Load
1. Add auto-load logic to `editor_page()` in editor_app.py
2. Test: Refresh page should load last file automatically
3. Test: WebSocket disconnect + reconnect should load last file

### Phase 4: Move Endpoints (One at a Time)
1. Create `editor_router = APIRouter()` in editor_app.py
2. Move `/editor/set_content` → Test thoroughly
3. Move `/editor/refresh_diffs` → Test
4. Move `/editor/save` → Test
5. Move `/editor/jump_to_line` → Test
6. Move `/editor/set_view_settings` → Test
7. Move `/editor/toggle_edit_tracking` → Test
8. Move `/editor/debug/state` → Test

### Phase 5: Cleanup
1. Remove moved endpoints from main.py
2. Remove unused imports in main.py
3. Update any documentation

### Phase 6: Testing
1. Test file opening from explorer
2. Test save operation
3. Test diff loading/refreshing
4. Test settings changes (theme, wrap, etc.)
5. Test WebSocket disconnect/reconnect (should auto-load last file)
6. Test page refresh (should load last file)
7. Test agent jump-to-line functionality

---

## Dead Code to Remove

After migration, the following in `main.py` will be unused:

### Endpoints (Lines 250-667)
- `/editor/set_content`
- `/editor/refresh_diffs`
- `/editor/toggle_edit_tracking`
- `/editor/jump_to_line`
- `/editor/debug/state`
- `/editor/save`
- `/editor/set_view_settings`

### Imports That May Become Unused
Check if these are used elsewhere in main.py:
- `from .nicegui_editor.editor_app import get_active_editor, set_current_file, get_current_file, get_current_file_sha256`
- `from .nicegui_editor.editor_app import enable_edit_tracking, disable_edit_tracking`

If not used elsewhere, remove them.

---

## Functions/Logic Inventory

### Functions in main.py (Lines 1-920)

**Keep in main.py (non-editor):**
- `/` (status root)
- `/status`
- `/read` (generic file reading)
- `/state` (project state)
- `/preferences` GET/POST
- `/write` (generic file writing)
- `/project/*` (project management)
- `/recent_projects`
- `/set_active_project`
- `/dir_list`
- `/git/*` (git operations)
- `/state/file_activity` (history tracking)
- All git helper endpoints

**Move to editor_app.py:**
- ✅ All `/editor/*` endpoints (see list above)

**Shared Utilities:**
- `_normalize_rel_path()` - Could move to `explorer_helper.py`
- `_build_state_payload()` - Keep in main.py (used by `/state`)
- `_expand_and_validate_path()` - Keep in main.py (used by `/read`, `/write`)
- `_ensure_project_root_synced()` - Keep in main.py
- `_get_active_project_root()` - Keep in main.py
- `_status_to_payload()` - Keep in main.py (git operations)

**Module-level State:**
- `_history_store` - Import in both main.py and editor_app.py
- `_preferences_store` - Import in both main.py and editor_app.py

---

## Risk Assessment

### Low Risk
- Auto-loading file on page init (new logic, doesn't affect existing)
- Moving endpoints (same logic, different file)
- Using editor_router in editor_app.py (standard FastAPI pattern)

### Medium Risk
- Import dependencies (ensure all needed imports available)
- Store access (verify singleton behavior works across imports)

### High Risk
- File watcher subscriptions (ensure callbacks work correctly)
- WebSocket behavior with `reconnect_timeout=0` (already tested)

### Mitigation
- Move one endpoint at a time
- Test each move thoroughly before proceeding
- Keep git history clean for easy rollback
- Test on actual Android device (WebSocket disconnect scenario)

---

## Success Criteria

✅ **Bug Fixed:** After WebSocket disconnect/reconnect, editor displays last opened file  
✅ **Auto-load Works:** Page refresh loads last file automatically  
✅ **Settings Persist:** Theme, wrap, diffs, shading all apply correctly  
✅ **All Operations Work:** Open, save, jump-to-line, refresh-diffs, settings changes  
✅ **No Regressions:** Explorer, git, terminal, agent still work  
✅ **Cleaner Code:** All editor logic in editor_app.py, main.py only has non-editor routes  

---

## Questions to Resolve Before Starting

1. **Where should `_normalize_rel_path()` live?**
   - Option A: Move to `explorer_helper.py` (shared utility)
   - Option B: Duplicate in editor_app.py (self-contained)
   - **Recommendation:** Move to explorer_helper.py

2. **How to handle stores?**
   - Option A: Initialize in both main.py and editor_app.py (separate instances - BAD)
   - Option B: Initialize in main.py, import from main.py in editor_app.py (singleton - GOOD)
   - **Recommendation:** Option B

3. **Should we use `nicegui.app` or `APIRouter`?**
   - **Recommendation:** `APIRouter` (keeps URLs consistent, easier migration)

4. **Should we add iframe reload notification to host?**
   - **Recommendation:** Not necessary if auto-load works correctly

---

**Status:** Plan complete, ready for review and approval before implementation  
**Next Step:** Review plan, answer questions, then begin Phase 1
