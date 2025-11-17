# NiceGUI Iframe Feature Adding Guideline

**Created:** 2025-11-15 19:06 UTC  
**Status:** Living Document  
**Audience:** Developers extending the vendored NiceGUI CodeMirror 6 editor

---

## Overview

This document provides guidelines for adding features to the NiceGUI CodeMirror 6 editor used in the File Editor CM6 app. The editor runs in an **iframe** (`/nc` endpoint), which creates architectural constraints around state management and communication.

---

## Core Architecture Constraints

### Architecture Layers (Clarification)

**Important Note:** This document focuses on extending the NiceGUI editor iframe. When we refer to "backend" in this context, we specifically mean the **NiceGUI iframe backend** (`editor_app.py`), NOT the main **Application Backend** (`main.py`, `core_write.py`, `core_read.py`).

**Three distinct layers:**

1. **Application Backend** - Ground truth authority
   - Manages state from disk + local caches (`history_store`, `preferences_store`)
   - Serves `/api/app/file_editor_cm6/read` and `/api/app/file_editor_cm6/write`
   - Source of truth for file operations

2. **Host Frontend** (`main.js`) - Visual representation layer
   - Displays application backend's state
   - Sends user actions to application backend
   - Does NOT hold canonical state

3. **NiceGUI Iframe Backend** (`editor_app.py`) - Editor UI component
   - Python FastAPI endpoints for editor-specific features
   - Has access to `editor` instance (vendored CodeMirror)
   - Tracks editor-specific state in globals (`_current_file_path`, `_active_editor`)
   - Runs in iframe at `/nc`
   - **These globals can drift from application backend state**

### The Iframe Barrier

**The fundamental challenge:** The NiceGUI iframe backend and host frontend are **separate execution contexts** that cannot directly communicate:

- **NiceGUI Iframe Backend** (`app/apps/file_editor_cm6/nicegui_editor/editor_app.py`)
  - Python FastAPI endpoints
  - Has access to `editor` instance (vendored CodeMirror)
  - Tracks state in global variables (`_current_file_path`, `_active_editor`, etc.)
  - Runs in iframe at `/nc`

- **Host Frontend** (`app/apps/file_editor_cm6/main.js`)
  - JavaScript running in parent frame
  - Has its own state (`currentPath`, `lastSha256`, etc.)
  - Cannot access iframe internals
  - Cannot call methods on `editor` instance

**Key Rule:** The iframe cannot directly call functions in the parent frame, and the parent cannot directly access the editor instance in the iframe.

---

## Vendored Module Location

All NiceGUI modifications are made to the **vendored copy**:

```
app/static/vendor/nicegui/elements/codemirror/
├── codemirror.py    # Python API
└── codemirror.js    # Vue component + CodeMirror integration
```

**Do NOT modify:**
- System-installed NiceGUI at `/data/data/com.termux/files/usr/lib/python3.12/site-packages/nicegui/`
- The vendor path is loaded first via `sys.path` override in `main.py`

---

## Communication Patterns

### Pattern 1: Iframe Backend → Frontend (Stateless Endpoints)

**Use Case:** Frontend needs to query NiceGUI iframe backend state

**Note:** This pattern is for **frontend ↔ NiceGUI iframe** communication. For **frontend ↔ application backend**, use standard stateful APIs where the application backend is the authority.

**Implementation:**
1. Create stateless endpoint in `editor_app.py`:
```python
@editor_router.get('/some_feature')
def get_feature_state(
    path: str = Query(...),  # Frontend passes context
    project: str = Query(...)
):
    # Don't rely on get_current_file() - iframe globals may be stale
    # Use parameters passed from frontend
    result = compute_state(path, project)
    return {"ok": True, "data": result}
```

2. Frontend calls endpoint with explicit parameters:
```javascript
const resp = await fetch(
    `/api/app/file_editor_cm6/editor/some_feature?path=${encodeURIComponent(currentPath)}&project=${encodeURIComponent(projectPath)}`,
    { cache: 'no-store' }
);
```

**Why:** NiceGUI iframe global state (`_current_file_path`) and frontend state (`currentPath`) are separate and can drift out of sync. Always pass explicit context to iframe endpoints.

### Pattern 2: Iframe Backend → Frontend (Real-time Updates)

**Use Case:** Notify frontend immediately when NiceGUI iframe state changes

**Option A: Polling (Simple)**
```javascript
setInterval(async () => {
    const state = await fetch('/api/app/file_editor_cm6/editor/state');
    updateUI(state);
}, 2000);
```

**Pros:** No vendoring changes needed  
**Cons:** 2-second delay, extra network calls

**Option B: postMessage (Recommended)**

In vendored `codemirror.py`:
```python
def notify_parent(self, event_type: str, data: dict):
    """Send message to parent frame."""
    payload = json.dumps({"type": event_type, "data": data})
    self.run_javascript(f"window.parent.postMessage({payload}, '*')")
```

In `main.js`:
```javascript
window.addEventListener('message', (e) => {
    if (e.data.type === 'editor_state_changed') {
        updateUI(e.data.data);
    }
});
```

**Pros:** Real-time, efficient  
**Cons:** Requires vendor changes

**Option C: WebSocket (Complex)**
- Use NiceGUI's built-in WebSocket for server-initiated pushes
- More complex, only needed for server → client without user action

### Pattern 3: Capturing Editor Content

**Problem:** You cannot use `await editor.request_content()` in change handlers - it triggers NiceGUI's outbox flush, causing stale prop updates to be sent to the frontend.

**Solution:** Track content in a variable:

```python
# In editor_app.py
def _on_editor_change(event):
    # editor.value is kept in sync by BindableProperty
    current_content = editor.value or ''
    editor._cached_content = current_content  # Custom attribute
    # Use current_content for your logic
```

**Why:** Using `request_content()` creates an async round-trip that flushes the outbox queue, which can cause cursor jumps and content overwrites.

---

## Vendoring Guidelines

### The Vendoring Discovery

**Historical Context:** Initially, we tried to work *around* NiceGUI's encapsulation using external JavaScript, DOM queries, and `run_javascript()`. All failed because the CodeMirror `EditorView` is trapped inside Vue component scope with no public API.

**The Solution:** Vendor NiceGUI and extend it natively. Instead of hacking around the library, we work *with* it.

### Vendoring Setup

**Installation:**
```bash
pip install --target=app/static/vendor --no-deps nicegui
```

**Why `--no-deps`:** We only vendor NiceGUI itself, not its dependencies. Python loads dependencies from system site-packages (already in requirements.txt).

**Import Path Override:**
In `main.py` (BEFORE any NiceGUI imports):
```python
import sys
from pathlib import Path

# CRITICAL: Setup vendor path BEFORE any imports that might use nicegui
_vendor_path = Path(__file__).parent / 'static' / 'vendor'
sys.path.insert(0, str(_vendor_path))
```

**Verification:**
```python
from nicegui.elements import codemirror
print(codemirror.__file__)  # Should show vendored path, not site-packages
```

### When to Modify Vendored Files

**Modify when:**
- Adding new methods to the editor API (e.g., `set_zebra_stripes()`)
- Fixing bugs in NiceGUI itself
- Adding iframe → parent communication
- Extending CodeMirror functionality

**Don't modify when:**
- You can achieve it via existing API
- It's pure backend logic (use `editor_app.py` instead)
- It's pure frontend logic (use `main.js` instead)

### How to Add a New Editor Method

**The Pattern:** Follow existing NiceGUI methods like `set_line_wrapping()`, `set_theme()`, `set_language()`.

**Step 1:** Add Python method to `codemirror.py`:
```python
def set_feature(self, enabled: bool) -> None:
    """Enable or disable feature."""
    self.run_method('applyFeature', enabled)
```

**Step 2:** Add JavaScript implementation to `codemirror.js`:

Add to `methods: {` section:
```javascript
applyFeature(enabled) {
    if (!this.editor) return;
    
    // Option A: Simple dispatch (no reconfiguration needed)
    this.editor.dispatch({
        effects: someEffect.of(enabled)
    });
    
    // Option B: Reconfigurable extension (like zebra stripes)
    if (!this.featureCompartment) {
        this.featureCompartment = new CM.Compartment();
        // Install compartment on first call
        this.editor.dispatch({
            effects: CM.StateEffect.appendConfig.of(
                this.featureCompartment.of(enabled ? [someExtension] : [])
            )
        });
    } else {
        // Reconfigure on subsequent calls
        this.editor.dispatch({
            effects: this.featureCompartment.reconfigure(
                enabled ? [someExtension] : []
            )
        });
    }
}
```

**Step 3:** Call from backend:
```python
editor = get_active_editor()
editor.set_feature(True)
```

### Real Examples from This Project

**Example: Zebra Stripes** (Simple line decoration)
```javascript
// In codemirror.js
applyZebraStripes(enabled) {
    if (!this.editor) return;
    
    if (!this.zebraCompartment) {
        this.zebraCompartment = new CM.Compartment();
        this.editor.dispatch({
            effects: CM.StateEffect.appendConfig.of(
                this.zebraCompartment.of(enabled ? [zebraField] : [])
            )
        });
    } else {
        this.editor.dispatch({
            effects: this.zebraCompartment.reconfigure(
                enabled ? [zebraField] : []
            )
        });
    }
}
```

**Example: Inline Diffs** (Complex decorations with external data)
```javascript
// In codemirror.js
applyDiffDecorations(hunks) {
    if (!this.editor) return;
    
    const decorations = buildDiffDecorations(this.editor, hunks, CM, () => this.lineWrapping);
    
    if (!this.diffField) {
        // Create StateField to hold decorations
        this.diffField = CM.StateField.define({
            create() { return CM.Decoration.none; },
            update(value, tr) {
                if (tr.docChanged) value = value.map(tr.changes);
                for (const effect of tr.effects) {
                    if (effect.is(setDiffEffect)) value = effect.value;
                }
                return value;
            },
            provide: field => CM.EditorView.decorations.from(field)
        });
        // Install field
    }
    
    // Apply decorations
    this.editor.dispatch({
        effects: this.setDiffEffect.of(decorations)
    });
}
```

### Lessons Learned from Vendoring

1. **Vendoring is necessary** - You cannot extend NiceGUI externally; the Vue component scope is sealed
2. **Follow existing patterns** - Study how `set_line_wrapping()`, `set_theme()` work
3. **Use Compartments for toggleable features** - They allow clean reconfiguration without recreating the editor
4. **StateFields for decorations** - Complex rendering needs StateField + Effects pattern
5. **Read the vendored code** - Understanding NiceGUI's architecture is essential
6. **Test with reconnection** - Ensure features survive page refresh and WebSocket reconnects

---

## Common Pitfalls

### Pitfall 1: Trusting Global State

**❌ Wrong:**
```python
@editor_router.post('/save')
def save():
    current_file = get_current_file()  # May be None!
    # ...
```

**✅ Correct:**
```python
@editor_router.post('/save')
def save(data: dict = Body(...)):
    current_file = data.get('path') or get_current_file()
    if not current_file:
        return {"ok": False, "error": "No file specified"}
    # ...
```

### Pitfall 2: Using request_content() in Change Handlers

**❌ Wrong:**
```python
async def _persist_cache():
    content = await editor.request_content()  # Triggers outbox flush!
```

**✅ Correct:**
```python
def _persist_cache():
    content = editor.value or ''  # Synchronous, no flush
```

**Why this matters:** `request_content()` calls `run_method()` which calls `enqueue_message()`, triggering NiceGUI's outbox loop to flush ALL pending updates. If any stale prop updates are queued, they'll be sent to the frontend, potentially causing cursor jumps or content overwrites.

### Pitfall 3: Prop Update Loops

**❌ Wrong:**
```python
def _handle_change(self, e: GenericEventArguments) -> None:
    self._value = e.args['value']
    self._props['value'] = self._value  # Queues prop update
    self.update()  # Sends update to frontend → frontend updates → loop
```

**✅ Correct:**
```python
def _handle_change(self, e: GenericEventArguments) -> None:
    self.value = e.args['value']  # Use BindableProperty setter
    # Let _send_update_on_value_change control whether updates are sent
```

**Why this matters:** Setting `self.value` uses the BindableProperty setter which automatically calls `_handle_value_change()` and respects the `_send_update_on_value_change` flag. Manual prop manipulation bypasses this logic.

### Pitfall 4: File Watcher Overwrites

**Problem:** When you subscribe to the file watcher, it immediately sends a snapshot with disk content, overwriting cached edits.

**Solution:** Skip the first snapshot when cache is restored:
```python
first_snapshot_seen = False
cached_was_restored = True  # Set when cache restore happens

def on_file_change(event):
    nonlocal first_snapshot_seen
    if event.get('type') == 'replace_full':
        if not first_snapshot_seen and cached_was_restored:
            first_snapshot_seen = True
            return  # Skip initial snapshot
        # Handle subsequent snapshots normally
```

### Pitfall 5: Working Around Instead of With NiceGUI

**❌ Wrong Approaches:**
- Trying to access EditorView via DOM queries (`document.querySelector('.cm-editor').cmView`)
- External JavaScript files trying to find the editor instance
- `run_javascript()` attempting to access component scope
- MutationObservers waiting for editor to become available

**✅ Correct Approach:**
- Vendor NiceGUI and extend it natively
- Add methods to the Vue component directly
- Use `run_method()` to call component methods from Python
- Follow existing patterns like `set_line_wrapping()`

**Why this matters:** The EditorView is intentionally encapsulated inside Vue component scope. There is no public API to access it externally. Any attempt to work around this is fragile and will break. Vendoring is the only reliable solution.

### Pitfall 6: Incorrect SHA Tracking on Cache Restore

**❌ Wrong:**
```python
initial_sha256 = cached_entry.get('content_sha256')  # SHA of unsaved edits
```

**✅ Correct:**
```python
initial_sha256 = cached_entry.get('base_sha256')  # SHA of file on disk
```

**Why this matters:** When saving, the system needs to compare against the original file SHA (base), not the draft content SHA. Using the wrong SHA causes 409 Conflict errors on save.

---

## Feature Implementation Checklist

When adding a new feature:

- [ ] **Identify the communication pattern needed**
  - Backend-only? → No vendoring needed
  - Backend → Frontend query? → Add stateless endpoint
  - Real-time updates? → Use postMessage or polling
  
- [ ] **Determine if vendoring is required**
  - Does it need to extend the editor API?
  - Does it need CodeMirror internals?
  - Is it a new CodeMirror package? → Requires bundle rebuild
  
- [ ] **Check if bundle rebuild needed**
  - New CodeMirror package? → Yes, rebuild
  - Just using existing CM primitives? → No, write directly in codemirror.js
  
- [ ] **If rebuilding bundle:**
  - [ ] Work in correct directory (`app/static/vendor/nicegui/elements/codemirror`)
  - [ ] Install new package via npm
  - [ ] Add export to `src/index.mjs`
  - [ ] Run `npm run build`
  - [ ] Comment out terser if build fails
  - [ ] Verify exports with `grep -r "functionName" dist/`
  
- [ ] **Implement with explicit state**
  - Pass `path` and `project` to all endpoints
  - Don't rely on global variables syncing
  
- [ ] **Add defensive checks**
  - Check if imports are available before using
  - Check if editor exists before calling methods
  - Handle null/undefined gracefully
  
- [ ] **Test the complete chain**
  - Frontend calls backend? → Check endpoint exists
  - Backend calls Python method? → Check method exists
  - Python calls Vue method? → Check codemirror.js has it
  - Vue uses CM function? → Check bundle exports it
  
- [ ] **Test the iframe boundary**
  - Does it work after page reload?
  - Does it work if frontend state is lost?
  - Does it work after WebSocket reconnect?
  
- [ ] **Document state assumptions**
  - What state must be in sync?
  - How does it recover from desync?

---

## Examples from This Project

### Example 1: Session Cache

**Goal:** Persist unsaved edits across page reloads

**Approach:**
- Cache writes: Pure backend (`editor_app.py` + `history_store.py`)
- Cache reads: Backend restores on page load
- Frontend queries status: Stateless endpoint (`/editor/cache_state`)

**Key Decision:** No real-time sync needed; polling acceptable for UI indicators

### Example 2: Zebra Stripes

**Goal:** Toggle alternating line backgrounds

**Approach:**
- Added `set_zebra_stripes()` to vendored `codemirror.py`
- Added `applyZebraStripes()` to vendored `codemirror.js`
- Backend calls method when preference changes

**Key Decision:** No frontend involvement needed; pure editor feature

### Example 3: Inline Diffs

**Goal:** Show git diffs as decorations in editor

**Approach:**
- Backend calculates diffs (`diff_helper.py`)
- Added `set_diff_decorations()` to vendored `codemirror.py`
- Added `applyDiffDecorations()` to vendored `codemirror.js`

**Key Decision:** Diffs recalculated on file change and save; no real-time updates needed

### Example 4: Search Panel (Complex Extension)

**Goal:** Add Ctrl+F search functionality using CodeMirror's native search extension

**Challenge:** The `@codemirror/search` package was not included in the vendored NiceGUI bundle

**Approach:**
1. **Add dependency to bundle:**
   ```bash
   cd app/static/vendor/nicegui/elements/codemirror
   npm install @codemirror/search
   ```

2. **Export search in bundle:**
   ```javascript
   // src/index.mjs
   export * from "@codemirror/search";
   ```

3. **Rebuild bundle (without minification if OOM issues):**
   ```javascript
   // rollup.config.mjs
   plugins: [
     nodeResolve(),
     // terser(), // Comment out if build fails with OOM
   ],
   ```

4. **Add Vue method to codemirror.js:**
   ```javascript
   openSearchPanelFromServer() {
     if (!this.editor || typeof openSearchPanel !== 'function') return;
     try {
       openSearchPanel(this.editor);
     } catch (err) {
       console.warn('[CodeMirror] Failed to open search panel:', err);
     }
   }
   ```

5. **Add Python wrapper to codemirror.py:**
   ```python
   def open_search_panel(self) -> None:
       """Open the CodeMirror search panel."""
       self.run_method('openSearchPanelFromServer')
   ```

6. **Add backend endpoint to editor_app.py:**
   ```python
   @app.post('/editor/search/open')
   async def editor_search_open(data: dict = Body(...)):
       """Open the CodeMirror search panel."""
       editor = _editor_instance
       if not editor:
           raise HTTPException(status_code=404, detail="Editor not initialized")
       try:
           editor.open_search_panel()
           return {"ok": True}
       except Exception as e:
           raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")
   ```

7. **Frontend already wired up in main.js:**
   ```javascript
   // Ctrl+F handler
   async function triggerEditorSearchPanel() {
     const result = await apiPost('editor/search/open', {
       path: currentPath,
       project: cachedProjectRoot
     });
     if (!result?.ok) {
       host.toast(result?.error || 'Search unavailable');
     }
   }
   ```

**Lessons Learned:**

1. **Missing Package = Silent Failure**
   - The code checked `if (searchExtension)` so missing package didn't error
   - It just silently did nothing - confusing to debug
   - Always verify bundle exports match what you're trying to import

2. **Bundle Rebuild Can Fail**
   - On resource-constrained devices (Android/Termux), terser minification can fail
   - Not always OOM - could be terser bugs with specific code
   - Solution: Disable minification for development (unminified works fine)
   - For production: Minify on more powerful machine or use lighter minifier

3. **Complete Chain Required**
   - Frontend → Backend endpoint → Python method → Vue method → CodeMirror
   - Missing ANY link = feature doesn't work
   - Test each layer independently:
     - Does bundle have the code? `grep -r "openSearchPanel" dist/`
     - Does Python method exist? Check codemirror.py
     - Does endpoint exist? Check editor_app.py
     - Does frontend call it? Check main.js

4. **Defensive Coding Essential**
   ```javascript
   // Always check if imports are available
   const searchExtension = typeof CM.search === 'function' ? CM.search : null;
   
   // Always check if editor exists
   if (!this.editor || typeof openSearchPanel !== 'function') return;
   
   // Always handle extensions conditionally
   if (searchExtension) extensions.push(searchExtension());
   ```

5. **Bundle Rebuild Process**
   ```bash
   # Always work in the nicegui codemirror directory
   cd app/static/vendor/nicegui/elements/codemirror
   
   # Install new packages
   npm install @codemirror/search
   
   # Add to exports
   echo 'export * from "@codemirror/search";' >> src/index.mjs
   
   # Rebuild (comment out terser in rollup.config.mjs if it fails)
   npm run build
   
   # Verify
   grep -r "openSearchPanel" dist/
   ```

**Key Decision:** Complex CodeMirror extensions (search, autocomplete, linting) require bundle rebuilds. Simple decorations (zebra stripes, diffs) can be written directly in codemirror.js using CM primitives.

---

## Bundle Management

### When to Rebuild the Bundle

**Rebuild Required:**
- Adding new CodeMirror packages (e.g., `@codemirror/search`, `@codemirror/lint`)
- Updating CodeMirror core version
- Adding language modes not in bundle
- Fixing bugs in vendored NiceGUI code

**Rebuild NOT Required:**
- Simple decorations using CM primitives (like zebra stripes)
- Backend-only changes
- Frontend chrome changes (main.js)
- Python endpoint changes

### Bundle Rebuild Process

**Location:** Always work in the vendored NiceGUI codemirror directory:
```bash
cd app/static/vendor/nicegui/elements/codemirror
```

**Steps:**

1. **Install new package:**
   ```bash
   npm install @codemirror/package-name
   ```

2. **Add to bundle exports:**
   ```bash
   # Edit src/index.mjs, add:
   export * from "@codemirror/package-name";
   ```

3. **Build:**
   ```bash
   npm run build
   ```

4. **Verify:**
   ```bash
   # Check that new exports are in dist/
   grep -r "functionName" dist/
   ```

### Handling Build Failures

**Symptom:** `npm run build` fails with "Unexpected early exit" during terser minification

**Not always OOM:** Could be terser bugs, code structure issues, or actual resource limits

**Solution:** Disable minification for development

**File:** `rollup.config.mjs`
```javascript
plugins: [
  nodeResolve(),
  // terser(), // COMMENTED OUT - build fails with minification
],
```

**Trade-offs:**
- ✅ Unminified bundle works perfectly
- ✅ Easier to debug (readable code)
- ❌ Larger file size (~2-3x)
- ❌ Slightly slower initial load

**For production:** Minify on a more powerful machine, or accept the larger bundle size

### Verifying Bundle Exports

After rebuild, verify exports are available:

**Check files:**
```bash
cd app/static/vendor/nicegui/elements/codemirror
ls -lh dist/*.js | head
# Should see recent timestamps
```

**Check content:**
```bash
# Search for your function
grep -r "openSearchPanel" dist/

# Should return matches in index.js or other dist files
```

**Check in browser console:**
```javascript
// After editor loads, check imports
console.log(typeof CM.search);           // 'function' if available
console.log(typeof CM.openSearchPanel);  // 'function' if available
```

### Common Bundle Issues

**Issue 1: Old bundle cached**
- **Symptom:** Changes not appearing after rebuild
- **Solution:** Hard refresh browser (Ctrl+Shift+R), restart app worker

**Issue 2: Wrong directory**
- **Symptom:** `npm install` fails with "Cannot find module"
- **Solution:** Make sure you're in `app/static/vendor/nicegui/elements/codemirror`, not `app/static/vendor/codemirror.3`

**Issue 3: Import namespace wrong**
- **Symptom:** `TypeError: CM.functionName is not a function`
- **Solution:** Check correct namespace - might be `CM.search.functionName` not `CM.functionName`

**Issue 4: Extensions not loading**
- **Symptom:** Feature doesn't work, no errors in console
- **Solution:** Check conditional guards in codemirror.js - they might be silently skipping:
  ```javascript
  if (searchExtension) extensions.push(searchExtension());
  // If searchExtension is null, this silently does nothing
  ```

---

## Debugging Tips

### Check State Sync

Add logging to both sides:

**Backend:**
```python
print(f"[BACKEND] _current_file_path={_current_file_path}", file=sys.stderr)
```

**Frontend:**
```javascript
console.log('[FRONTEND] currentPath=', currentPath);
```

Compare logs to identify where state diverges.

### Test Reload Behavior

Always test:
1. Load file normally
2. Make edits
3. Reload page (simulates crash/disconnect)
4. Verify state is correct

This catches issues with state not persisting or restoring correctly.

### Monitor WebSocket

Check browser DevTools → Network → WS to see NiceGUI messages:
- `update` messages = prop updates being sent
- Unexpected updates = possible loop or flush issue

---

## Related Documentation

- **Session Cache Implementation:** `notes/2025-11-14_Session_Cache_Implementation_Plan.md`
- **Vendoring Journey:** `notes/NICEGUI_VENDORING_JOURNEY.md`
- **WebSocket Architecture:** `docs/core/websockets.md`
- **Search Integration Logs:** `notes/2025-11-16_CONSOLIDATED_SEARCH_LOG.md`

---

_Last Updated: 2025-11-17 04:42 UTC - Clarified three-layer architecture (Application Backend vs NiceGUI Iframe Backend vs Frontend)_
