# Explorer Search Fixes - Architecture Compliance

**Author:** Atlas  
**Date:** 2025-11-17 19:20 UTC  
**Status:** Fix Plan - Ready for Implementation

---

## **PROBLEMS IDENTIFIED**

### **Issue 1: Virtual Keyboard Disappearing**
- Entire overlay re-rendered on every keystroke
- Input element destroyed and recreated
- Mobile browser loses focus and closes keyboard

### **Issue 2: Content Search Crash**
- `fileResult.matches` can be undefined
- Accessing `.length` or `.forEach()` on undefined crashes
- Error: "Cannot read properties of undefined (reading 'length')"

### **Issue 3: File Opening Bypasses Unified Flow** 🚨 CRITICAL
- Search results call `window.jumpToFileLine()` directly
- Bypasses `main.js::openFile()` unified opener
- Skips:
  - Application backend `/read` endpoint
  - History tracking via `/state/file_activity`
  - Project context validation
  - WebSocket connection setup
  - Diff controller initialization
  - Session sync

### **Issue 4: `/editor/jump_to_line` Does Too Much** 🚨 CRITICAL
- NiceGUI iframe backend loading files directly from disk
- Should only scroll, not load files
- Violates "Application Backend is Ground Truth" principle
- Creates state drift between frontend and iframe

### **Issue 5: Server 500 Error**
- `/editor/jump_to_line` has many failure points
- No error handling for file load failures
- Complex logic prone to exceptions

---

## **ARCHITECTURE COMPLIANCE**

### **From the Guideline:**

> "Application Backend (main.py, core_read.py, core_write.py) is the ground truth authority. It manages state from disk + local caches."

> "NiceGUI Iframe Backend should only handle editor UI operations."

> "Pattern 1: Stateless Endpoints - Always pass explicit context from frontend, never rely on backend globals."

### **Current (Wrong) Flow:**
```
Search Result Click
  → window.jumpToFileLine(path, line)
    → POST /editor/jump_to_line
      → Reads file from disk ❌
      → Loads in iframe ❌
      → BYPASSES application backend ❌
```

### **Correct Flow:**
```
Search Result Click
  → window.appOpenFile(path)
    → POST /read (application backend)
    → POST /editor/set_content (iframe)
    → POST /state/file_activity (history)
    → openWebSocket(path)
    → diffController.setContext()
    → syncSessionPath()
  → THEN jumpToCurrentFileLine(line)
    → POST /editor/jump_to_line (scroll only)
```

---

## **FIX PLAN**

### **Fix 1: Virtual Keyboard - Incremental Rendering**

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`  
**Function:** `renderSearchOverlay()`  
**Location:** Around line 1540-1650

**Change:** Only re-render results, keep header and input stable.

**Before:**
```javascript
overlay.innerHTML = '';  // Destroys everything
overlay.appendChild(header);
overlay.appendChild(inputContainer);
overlay.appendChild(resultsContainer);
```

**After:**
```javascript
// First render - create structure
if (!overlay.querySelector('.fe-search-header')) {
  overlay.innerHTML = '';
  overlay.appendChild(header);
  overlay.appendChild(inputContainer);
  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'fe-search-results';
  overlay.appendChild(resultsDiv);
}

// Subsequent renders - only update results
const existingResults = overlay.querySelector('.fe-search-results');
if (existingResults) {
  // Build results container content
  if (searchLoading) {
    existingResults.innerHTML = '<div class="fe-search-loading">Searching...</div>';
  } else if (searchError) {
    existingResults.innerHTML = `<div class="fe-search-error">${searchError}</div>`;
  } else if (searchResults) {
    existingResults.innerHTML = '';
    renderSearchResults(existingResults);
  } else if (searchQuery.length > 0 && searchQuery.length < 2) {
    existingResults.innerHTML = '<div class="fe-search-hint">Type at least 2 characters</div>';
  } else {
    existingResults.innerHTML = '';
  }
}

// Update mode toggle active state
const nameBtn = overlay.querySelector('.fe-search-mode button:first-child');
const contentBtn = overlay.querySelector('.fe-search-mode button:last-child');
if (nameBtn) nameBtn.className = searchMode === 'name' ? 'active' : '';
if (contentBtn) contentBtn.className = searchMode === 'content' ? 'active' : '';

// Update input value if needed
const input = overlay.querySelector('#fe-search-input');
if (input && input.value !== searchQuery) {
  input.value = searchQuery;
}
```

---

### **Fix 2: Content Search Crash - Defensive Checks**

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`  
**Function:** `renderContentResults()`  
**Location:** Lines 1710-1750

**Change:** Guard against undefined `matches`.

**Before:**
```javascript
fileHeader.textContent = `${fileResult.rel} (${fileResult.matches.length})`;

fileResult.matches.forEach(match => {
```

**After:**
```javascript
const matches = fileResult.matches || [];
fileHeader.textContent = `${fileResult.rel} (${matches.length})`;

matches.forEach(match => {
```

---

### **Fix 3: File Opening - Use Unified Flow**

**File:** `app/apps/file_editor_cm6/static/js/explorer.js`  

#### **3a. Name Mode Results**
**Function:** `renderNameResults()`  
**Location:** Around line 1680

**Before:**
```javascript
row.onclick = () => {
  if (item.type === 'file') {
    openFile(item.path);
    closeSearchOverlay();
  }
};
```

**After:**
```javascript
row.onclick = () => {
  if (item.type === 'file') {
    if (window.appOpenFile) {
      window.appOpenFile(item.path);
      closeSearchOverlay();
    } else {
      toast('File opener not available');
    }
  }
};
```

#### **3b. Content Mode Results**
**Function:** `renderContentResults()`  
**Location:** Around line 1725

**Before:**
```javascript
matchRow.onclick = () => {
  if (window.jumpToFileLine) {
    window.jumpToFileLine(fileResult.path, match.line);
  }
  closeSearchOverlay();
};
```

**After:**
```javascript
matchRow.onclick = async () => {
  if (window.appOpenFile && window.jumpToCurrentFileLine) {
    closeSearchOverlay();
    
    // First: Open file using unified flow
    try {
      await window.appOpenFile(fileResult.path);
      
      // Wait a tick for file to load
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Then: Jump to line
      await window.jumpToCurrentFileLine(match.line);
    } catch (e) {
      toast('Failed to open file: ' + (e?.message || 'unknown error'));
    }
  } else {
    toast('File opener not available');
  }
};
```

#### **3c. Remove Broken jumpToFileLine**
**Location:** Bottom of explorer.js (around line 1750)

**Remove this:**
```javascript
window.jumpToFileLine = async (path, line) => {
  try {
    await fetch('/api/app/file_editor_cm6/editor/jump_to_line', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, line: parseInt(line, 10) })
    });
  } catch (e) {
    toast('Failed to jump: ' + (e?.message || 'unknown error'));
  }
};
```

**Replace with comment:**
```javascript
// Note: File opening from search uses window.appOpenFile (main.js)
// and window.jumpToCurrentFileLine (main.js) for unified flow
```

---

### **Fix 4: Simplify `/editor/jump_to_line` Endpoint**

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`  
**Function:** `jump_to_line()`  
**Location:** Lines 588-631

**Change:** Remove file loading, keep only scroll logic.

**Before:**
```python
@editor_router.post('/jump_to_line')
async def jump_to_line(data: dict = Body(...)):
    target_path, target_line = data.get('path'), data.get('line', 1)
    editor = get_active_editor()
    if not editor: return {"ok": False, "error": "Editor not ready"}
    print(f"[JUMP_TO_LINE] target={target_path!r} line={target_line}", file=sys.stderr)
    
    current_file = get_current_file()
    project_path = _history_store.get_active_project()
    if target_path and target_path != current_file:
        try:
            content = Path(target_path).read_text(encoding='utf-8', errors='replace')
            language = 'python' if target_path.endswith('.py') else 'javascript' if target_path.endswith('.js') else 'markdown' if target_path.endswith('.md') else 'text'
            editor.set_value(content)
            editor.set_language(language)
            content_sha256 = hashlib.sha256(content.encode('utf-8')).hexdigest()
            set_current_file(target_path, content_sha256)
            editor._cached_content = content
            _broadcast_cache_state(...)
            # ... watcher setup ...
        except Exception as e:
            return {"ok": False, "error": str(e)}
            
    ui.run_javascript(f'const view = document.querySelector(".cm-editor")?.cmView.view; if(view) {{ const pos = view.state.doc.line({target_line}).from; view.dispatch({{ selection: {{ anchor: pos }}, scrollIntoView: true }}); }}')
    return {"ok": True, "file": target_path or current_file, "line": target_line}
```

**After:**
```python
@editor_router.post('/jump_to_line')
async def jump_to_line(data: dict = Body(...)):
    """Jump to a line in the currently loaded file. Does NOT load new files."""
    target_line = data.get('line', 1)
    editor = get_active_editor()
    if not editor: 
        return {"ok": False, "error": "Editor not ready"}
    
    print(f"[JUMP_TO_LINE] Scrolling to line {target_line}", file=sys.stderr)
    
    # Only scroll - assume file is already loaded by frontend via openFile()
    ui.run_javascript(f'''
        const view = document.querySelector(".cm-editor")?.cmView.view;
        if (view) {{
            const line = Math.max(1, Math.min({target_line}, view.state.doc.lines));
            const pos = view.state.doc.line(line).from;
            view.dispatch({{
                selection: {{ anchor: pos }},
                scrollIntoView: true
            }});
            view.focus();
        }}
    ''')
    
    return {"ok": True, "line": target_line}
```

---

### **Fix 5: Ensure Helper Functions Exist**

**File:** `app/apps/file_editor_cm6/main.js`  
**Location:** After line 1600, before bindMenuToggle calls

**Verify these exist (should be from previous implementation):**

```javascript
// Helper: Jump to line in current file
async function jumpToCurrentFileLine(line) {
  const path = window.currentPath;
  if (!path) {
    toast('No file currently open');
    return;
  }
  
  try {
    await apiPost('editor/jump_to_line', { line: parseInt(line, 10) });
  } catch (e) {
    toast('Failed to jump: ' + (e?.message || 'unknown error'));
  }
}
```

**Make sure it's exposed on window:**

```javascript
// Expose for search overlay
window.jumpToCurrentFileLine = jumpToCurrentFileLine;
```

---

## **TESTING CHECKLIST**

### **Virtual Keyboard Fix**
- [ ] Type in search input on mobile
- [ ] Keyboard stays visible while results update
- [ ] Can continue typing without re-focusing

### **Content Search Fix**
- [ ] Content search doesn't crash
- [ ] Results display correctly
- [ ] Match counts show correctly

### **File Opening Fix**
- [ ] Name search: Click file → opens correctly
- [ ] Content search: Click match → file opens, scrolls to line
- [ ] Opened files appear in recents
- [ ] File history tracked correctly
- [ ] WebSocket connection established
- [ ] Diff decorations work
- [ ] Save functionality works
- [ ] currentPath updated correctly

### **Jump to Line Fix**
- [ ] Go To Line menu works
- [ ] Content search line jump works
- [ ] Scrolls to correct line
- [ ] No 500 errors in server logs
- [ ] Editor gets focus after jump

### **Integration**
- [ ] Search → open file → edit → save → close → reopen from recents
- [ ] Verify file appears in history
- [ ] Verify project context maintained
- [ ] No state drift between frontend and iframe

---

## **IMPLEMENTATION ORDER**

1. ✅ Fix 5 first - Ensure helpers exist in main.js
2. ✅ Fix 4 - Simplify `/editor/jump_to_line` (backend)
3. ✅ Fix 1 - Virtual keyboard (explorer.js)
4. ✅ Fix 2 - Defensive checks (explorer.js)
5. ✅ Fix 3 - Use unified flow (explorer.js)
6. ✅ Test all scenarios

---

**PLAN STATUS: READY TO EXECUTE**

_Atlas • 2025-11-17 19:20 UTC_
