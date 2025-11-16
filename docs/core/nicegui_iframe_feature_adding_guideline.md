# NiceGUI Iframe Feature Adding Guideline

**Created:** 2025-11-15 19:06 UTC  
**Status:** Living Document  
**Audience:** Developers extending the vendored NiceGUI CodeMirror 6 editor

---

## Overview

This document provides guidelines for adding features to the NiceGUI CodeMirror 6 editor used in the File Editor CM6 app. The editor runs in an **iframe** (`/nc` endpoint), which creates architectural constraints around state management and communication.

---

## Core Architecture Constraints

### The Iframe Barrier

**The fundamental challenge:** The NiceGUI editor backend and host frontend are **separate execution contexts** that cannot directly communicate:

- **NiceGUI Backend** (`app/apps/file_editor_cm6/nicegui_editor/editor_app.py`)
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

### Pattern 1: Backend → Frontend (Stateless Endpoints)

**Use Case:** Frontend needs to query backend state

**Implementation:**
1. Create stateless endpoint in `editor_app.py`:
```python
@editor_router.get('/some_feature')
def get_feature_state(
    path: str = Query(...),  # Frontend passes context
    project: str = Query(...)
):
    # Don't rely on get_current_file() - it may be stale
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

**Why:** Backend global state (`_current_file_path`) and frontend state (`currentPath`) are separate and can drift out of sync. Always pass explicit context.

### Pattern 2: Backend → Frontend (Real-time Updates)

**Use Case:** Notify frontend immediately when backend state changes

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
  
- [ ] **Implement with explicit state**
  - Pass `path` and `project` to all endpoints
  - Don't rely on global variables syncing
  
- [ ] **Test the iframe boundary**
  - Does it work after page reload?
  - Does it work if frontend state is lost?
  
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

---

_Last Updated: 2025-11-15 19:06 UTC_
