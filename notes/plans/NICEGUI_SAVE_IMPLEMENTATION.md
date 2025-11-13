# NiceGUI Editor Save Implementation Plan

**Date:** November 13, 2025  
**Status:** 🟡 In Progress - Phase 1  
**Context:** Completing the CM6 → NiceGUI iframe migration

---

## Current State Analysis

### What's Already Done:
- ✅ Backend `/write` endpoint exists with atomic writes (main.py lines 415-472)
- ✅ `core_write.py` provides `write_full()` with SHA256 conflict detection
- ✅ `core_read.py` provides file watching, debouncing, and save acknowledgement system
- ✅ Menu items and keyboard shortcuts exist (Ctrl+S at line 1539)
- ✅ Autosave infrastructure exists with debounce timer (lines 1256-1273)
- ✅ `doSave()` function exists with conflict resolution (lines 1128-1186)
- ✅ Save WebSocket acknowledgement flow with self-echo suppression

### What's Broken:
- ❌ `getText()` is a stub returning empty string (main.js line 708)
- ❌ `/editor/get_content` endpoint doesn't return actual editor value (main.py lines 337-347)
- ❌ No mechanism to trigger autosave on content changes
- ❌ No way to mark editor as unsaved when content changes in NiceGUI iframe

---

## Implementation Plan

### **Phase 1: Enable Manual Saves (Ctrl+S)** ⬅️ CURRENT PHASE

**Goal:** Make Ctrl+S work to save the current file

**Changes Required:**

**1. Fix `/editor/get_content` endpoint** (`main.py` lines 337-347)
```python
@file_editor_cm6_bp.get('/editor/get_content')
def get_editor_content():
    """Get current editor content"""
    from .nicegui_editor.editor_app import get_active_editor
    
    editor = get_active_editor()
    if not editor:
        return {"ok": False, "error": "Editor not ready"}
    
    return {"ok": True, "content": editor.value}
```

**2. Make `getText()` async and functional** (`main.js` line 708)
```javascript
async function getText() {
    try {
        const result = await apiGet('editor/get_content');
        return result.content || '';
    } catch (e) {
        console.error('Failed to get editor content:', e);
        return '';
    }
}
```

**3. Update `saveFile()` to await getText()** (`main.js` line 1186)
```javascript
async function saveFile() {
  if (!currentPath || !currentPathExists) return saveAsDialog();
  statusEl.textContent = 'Saving...';

  const content = await getText();  // <-- Make async
  const result = await doSave(currentPath, content);
  // ... rest unchanged
}
```

**4. Update `saveAsDialog()` to await getText()** (`main.js` line 1202)
```javascript
async function saveAsDialog() {
  const target = await pickSaveTarget();
  if (!target || !target.path) return;
  if (target.existed && !window.confirm('File exists. Overwrite?')) return;
  statusEl.textContent = 'Saving...';

  const content = await getText();  // <-- Make async
  const targetAbs = toAbsolute(target.path, null, HOME_DIR);
  // ... rest unchanged
}
```

**Files Modified:** 2 files, ~15 lines changed

---

### **Phase 2: Enable Content Change Detection**

**Goal:** Detect when user types in NiceGUI editor to trigger unsaved state & autosave

**The Challenge:** NiceGUI editor is in an iframe. We need bidirectional communication.

**Approach: Polling** (Simple, works immediately)
- Add periodic check comparing `editor.value` hash with `lastSavedContent` hash
- Lightweight, no NiceGUI modifications needed
- 300ms interval is imperceptible

**Changes Required:**

**1. Add polling endpoint** (`main.py`, new endpoint)
```python
@file_editor_cm6_bp.get('/editor/poll_changes')
def poll_editor_changes():
    """Check if editor content differs from last saved"""
    from .nicegui_editor.editor_app import get_active_editor
    
    editor = get_active_editor()
    if not editor:
        return {"ok": False}
    
    # Return hash of content to detect changes without transferring full content
    import hashlib
    content = editor.value or ''
    content_hash = hashlib.sha256(content.encode('utf-8')).hexdigest()
    
    return {"ok": True, "content_hash": content_hash}
```

**2. Add polling in main.js** (new code block after line 1273)
```javascript
// Poll editor for changes every 300ms
let lastPolledHash = null;
setInterval(async () => {
    if (!currentPath) return;
    
    try {
        const result = await apiGet('editor/poll_changes');
        if (!result.ok) return;
        
        const currentHash = result.content_hash;
        
        // Initialize on first poll
        if (lastPolledHash === null) {
            lastPolledHash = currentHash;
            return;
        }
        
        // Detect change
        if (currentHash !== lastPolledHash) {
            lastPolledHash = currentHash;
            
            if (!unsaved) {
                markUnsaved(true);
            }
            
            // Trigger autosave debounce
            scheduleAutosave();
        }
    } catch (e) {
        // Silently fail - editor might not be ready yet
    }
}, 300);
```

**Files Modified:** 2 files, ~35 lines added

---

### **Phase 3: Integrate Autosave with Atomic Writes**

**Goal:** Connect existing autosave timer to the write backend

**What Already Works:**
- `scheduleAutosave()` debounces saves (AUTOSAVE_DELAY = 2000ms)
- Backend handles conflicts with SHA256 checks
- `push_save_ack()` prevents self-echo during WebSocket updates
- Self-echo suppression window (300ms) prevents flicker

**Changes Required:**

**1. Reset polling hash after save** (`main.js` in `doSave()` success block)
```javascript
try {
    const result = await apiPost('write', payload);
    lastSha256 = result.sha256 || lastSha256;
    lastSavedContent = content;
    markUnsaved(false);
    
    // Sync hash after save to prevent false change detection
    const pollResult = await apiGet('editor/poll_changes');
    if (pollResult.ok) {
        lastPolledHash = pollResult.content_hash;
    }
    
    return { success: true, result };
```

**Files Modified:** 1 file, ~5 lines added

---

## Summary

**Total Changes:**
- **2 files modified** (`main.py`, `main.js`)
- **~55 lines added/changed** total across all phases

**Migration Benefits:**
- ✅ Preserves all existing atomic write safety (SHA256 conflict detection)
- ✅ Preserves all existing WebSocket self-echo suppression
- ✅ Maintains autosave debouncing (2 second delay)
- ✅ Maintains conflict resolution UX (user prompted on external changes)
- ✅ No breaking changes to existing editor features (zebra stripes, diffs, themes)

**Testing Checklist:**
1. Ctrl+S saves file with current content
2. Typing in editor triggers unsaved indicator
3. Autosave fires 2 seconds after last change
4. External file changes trigger reload (WebSocket still works)
5. SHA256 conflict detection prevents data loss
6. Self-echo suppression prevents flicker on save

---

## Progress Log

### 2025-11-13 07:13 UTC
- Plan documented
- Starting Phase 1: Manual save implementation

### 2025-11-13 07:31 UTC
- **Architecture Change**: Scrapped frontend round-trip approach
- **New Implementation**: Backend-only save architecture
  - Frontend was calling `/editor/get_content` then sending content to `/write`
  - This was unnecessary - backend has direct access to `editor.value`
  
**Changes Made**:
1. Added `_current_file_path` global tracking in `editor_app.py`
2. Added `set_current_file()` and `get_current_file()` helpers
3. Updated `/editor/set_content` to track current file path
4. Created `/editor/debug/state` endpoint for testing (returns editor state, content hash, file path)
5. Created `/editor/save` endpoint that:
   - Gets `editor.value` directly in Python
   - Uses tracked `_current_file_path`
   - Calls `write_full()` with atomic writes & SHA256 conflict detection
   - Handles all WebSocket notifications, cache invalidation, etc.
   
**Testing Required**:
- [ ] Restart worker
- [ ] Open a file in editor
- [ ] Test debug endpoint: `curl http://localhost:8088/apps/file_editor_cm6/editor/debug/state`
- [ ] Verify it returns correct file path, content length, and hash
- [ ] Frontend integration not yet updated (still using old broken flow)
- [ ] Need to update `main.js` to call new `/editor/save` endpoint

**Files Modified**:
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` - Added file path tracking
- `app/apps/file_editor_cm6/main.py` - Added debug endpoint and save endpoint

### 2025-11-13 08:09 UTC
- **Fixed async pollution issue**: Reverted `getText()` to sync stub (legacy code was calling it without await)
- **Updated debug endpoint**: Now returns full `content` field instead of 200-char preview
- **Rewrote `saveFile()`** in main.js to use backend-only `/editor/save` endpoint:
  - No content round-trip
  - Sends `client_id` and `op_id` for WebSocket suppression
  - Sends `base_sha256` for conflict detection
  - Handles 409 conflict with retry prompt
  - Updates `lastSha256` after successful save
  
**Testing Required**:
- [ ] Restart worker
- [ ] Open a file
- [ ] Test debug endpoint: `curl http://localhost:8088/api/app/file_editor_cm6/editor/debug/state`
- [ ] Verify full content is returned
- [ ] Edit file, press Ctrl+S
- [ ] Verify save works correctly
- [ ] Test conflict handling (edit file externally, then save)

**Files Modified**:
- `app/apps/file_editor_cm6/main.js` - Reverted getText() stub, rewrote saveFile()
- `app/apps/file_editor_cm6/main.py` - Updated debug endpoint to return full content

### 2025-11-13 08:20 UTC
- **Fixed SHA256 state tracking**: Backend now tracks SHA256 of loaded/saved content
- **Fixed conflict detection**: Using backend-tracked SHA256 instead of frontend (more reliable)
- **Fixed state sync on save**: Backend updates its SHA256 after successful save
- **Fixed state initialization**: `/editor/set_content` now returns SHA256 so frontend can initialize properly
  
**Changes**:
1. Added `_current_file_sha256` to `editor_app.py` to track file state
2. Modified `set_current_file()` to accept and store SHA256
3. `/editor/set_content` now computes SHA256 of loaded content and returns it
4. `/editor/save` uses backend-tracked SHA256 for conflict detection
5. `/editor/save` updates backend SHA256 after successful save
6. `main.js` `openFile()` now waits for `/editor/set_content` response to get SHA256

**This fixes**:
- ✅ Conflict detection works on first save after page refresh
- ✅ SHA256 state stays in sync between saves
- ✅ No false conflicts due to stale frontend state

**Testing Required**:
- [ ] Restart worker
- [ ] Open file, edit, save - should work
- [ ] Save again immediately - should work (no false conflict)
- [ ] Refresh page, save - should work (SHA256 initialized from backend)
- [ ] Edit file externally, save - should prompt for conflict

**Files Modified**:
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` - Added SHA256 tracking
- `app/apps/file_editor_cm6/main.py` - Updated set_content and save endpoints  
- `app/apps/file_editor_cm6/main.js` - Initialize SHA256 from set_content response




### 2025-11-13 08:25 UTC
- **Added comprehensive debugging** to track down "undefined" toast error
- Added Python print statements throughout /editor/save endpoint
- Added console.log in frontend save flow
- Improved error handling to avoid undefined messages
  
**Debug output shows**:
- Endpoint entry and parameters
- Current file path and SHA256
- Content length
- Write operation status
- Full error details with traceback

**Files Modified**:
- app/apps/file_editor_cm6/main.py - Added debug prints
- app/apps/file_editor_cm6/main.js - Added console logging and better error handling



### 2025-11-13 09:04 UTC
- **Added diff recalculation after save**
- After successful save, if showInlineDiffs is enabled:
  - Recalculate diffs using collect_diff()
  - Apply to editor using editor.set_diff_decorations()
- This refreshes the diff decorations to reflect the saved state

**Files Modified**:
- app/apps/file_editor_cm6/main.py - Added diff recalculation in save endpoint

