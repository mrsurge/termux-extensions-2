# NiceGUI Iframe Feature Adding Guideline

**Created:** 2025-11-15 19:06 UTC  
**Sthhgatus:** Living Document  
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

### Preference Enforcement & Constructor Props (Theme + Font Scale)

**Current contract (2025-11-20):** The iframe must fail fast unless both the theme and font scale come directly from the disk-backed preference file. There are no defaults or silent fallbacks.

- `_resolve_theme_preference()` and `_resolve_font_scale()` live in `editor_app.py` and must be used **before** creating `ui.codemirror`. They raise immediately with the preference file path when a value is missing/invalid.
- `ui.codemirror(...)` now requires `theme=` and passes `font_scale=`. Example:
  ```python
  editor_prefs = _preferences_store.get_preferences().get('editor', {})
  theme = _resolve_theme_preference(editor_prefs.get('theme'))
  font_scale = _resolve_font_scale(editor_prefs.get('fontScale'))
  editor = ui.codemirror(
      value=initial_content,
      language=initial_language,
      theme=theme,
      line_wrapping=editor_prefs.get('wordWrap'),
      font_scale=font_scale,
  )
  ```
- Vendored `codemirror.py` refuses to initialize without a theme (`ValueError`) and forwards `font_scale` to the Vue component via `_props['fontScale']`.
- Vendored `codemirror.js` declares `theme` as `required: true`, ingests the numeric `fontScale` prop, and applies both **before** instantiating `EditorView`. This eliminates the “flash” of default styling or text size.
- Preference updates (`/editor/update_preference`, `/editor/set_font_scale`) call the same resolver helpers and only persist **after** the live editor successfully applies the change, guaranteeing the on-disk file matches the running state.
- If the preference file cannot be read or the theme/font scale cannot be resolved, let the exception bubble so the iframe returns HTTP 500 and the page refuses to load. Do **not** catch-and-default these errors; the missing preference is a fatal configuration issue by design.

**Implication for new features:** Any additional constructor-only props should follow the same pattern—validate from disk, pass through the Python wrapper, expose as Vue props, and configure CodeMirror **during** editor creation so no fallback state ever renders.

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

## Best Practices for Feature Development

**Added:** 2025-11-17 (Lessons from Explorer Search Implementation)

### **Before You Start**

#### **1. Trace Existing Implementations First** 🔍

Before adding any new file operation, navigation, or UI interaction:

1. Find similar existing feature in codebase
2. Trace the EXACT execution path with line numbers
3. Document the full call chain in your implementation plan
4. Use the SAME functions and helpers

**Example from Explorer Search:**
```
User clicks file in tree
  → onTreeClick() (explorer.js:902)
    → openFileRel(rel, currentProjectPath) (explorer.js:1462)
      → window.appOpenFileRel(rel, projectRoot) (main.js:1989)
        → openFile(absolutePath) (main.js:1303)
```

**Why:** Different code paths have different guarantees. Using wrong path (e.g., `appOpenFile` vs `appOpenFileRel`) bypasses important features like project context resolution.

#### **2. Check for Widget-Specific Extension Hooks** 🪝

**When working with CodeMirror widgets and gutters:**

CodeMirror 6 has specific extension points for attaching gutter markers to widgets. Don't try to hack positioning with CSS or overlays.

**The Problem:**
- Block widgets (like deletion diff widgets) create "phantom" visual lines
- Gutters are line-based - they only render for document lines
- You can't position gutter markers at widget positions using normal methods

**The Solution:**
Custom gutters accept a `widgetMarker` option:

```javascript
CM.gutter({
  class: 'my-custom-gutter',
  markers: view => view.state.field(myGutterField),
  widgetMarker: (view, widget, block) => {
    // Return a GutterMarker if this widget should have one
    if (widget instanceof MyWidgetType) {
      return myMarker;
    }
    return null;
  }
})
```

**Key Points:**
- `widgetMarker` receives `(view, widget, block)` for each widget
- Use `instanceof` to check widget type
- Return a `GutterMarker` instance or `null`
- CM6 handles all positioning automatically
- Works with scroll, word wrap, viewport changes

**Example Use Case:**
Showing "−" markers in diff gutter for deletion widgets that don't correspond to document lines.

**What NOT to do:**
- ❌ Absolute positioning with negative offsets
- ❌ CSS pseudo-elements with negative margins
- ❌ Overlay divs with pixel positioning
- ❌ Fake columns in document flow

**Why:** CodeMirror's layout engine handles widget positioning. Fighting it with manual pixel math is fragile and breaks on scroll/wrap.

**References:**
- See `notes/NICEGUI_VENDORING_JOURNEY.md` (2025-11-19 entry on deletion markers)
- CodeMirror docs: `gutterWidgetClass` and custom gutter options

---

#### **3. Identify Correct API Surface** 🎯

**For Vendored Components:**

Check if component is vendored:
```bash
ls app/static/vendor/nicegui/elements/
```

If vendored:
- ❌ **Don't** use `ui.run_javascript()` to bypass vendor
- ✅ **Do** add methods to both `.js` and `.py` vendor files
- ✅ **Do** use `run_method()` for Python → JavaScript calls
- ✅ **Do** document custom methods with date/team/purpose

**Example (jump-to-line, focus-aware):**
```python
# In codemirror.py
def jump_to_line(self, line: int, *, focus: bool = True) -> None:
    """Jump to a specific line in the editor.
    
    Args:
        line: 1-based line number
        focus: Whether to focus the editor after scrolling
    """
    self.run_method('jumpToLine', {"line": line, "focus": focus})
```

```javascript
// In codemirror.js - methods section
jumpToLine(payload) {
  if (!this.editor) {
    console.warn('[CodeMirror] jumpToLine: editor not ready');
    return;
  }

  let shouldFocus = true;
  let input = payload;
  if (payload && typeof payload === 'object') {
    input = payload.line;
    if (Object.prototype.hasOwnProperty.call(payload, 'focus')) {
      shouldFocus = !!payload.focus;
    }
  }

  const line = parseInt(input, 10);
  if (isNaN(line) || line < 1) {
    console.warn('[CodeMirror] jumpToLine: invalid line number', input);
    return;
  }

  const doc = this.editor.state.doc;
  const maxLine = doc.lines;
  const targetLine = Math.max(1, Math.min(line, maxLine));
  const pos = doc.line(targetLine).from;

  this.editor.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });

  if (shouldFocus) {
    this.editor.focus();
  }
}
```

**Why:** Vendored components have their own API surface. Direct DOM access bypasses the vendor's architecture and breaks reliability.

> **Pattern to copy for new features:**  
> For any feature X that needs to “do something in the iframe” (e.g., jump, toggle, highlight):
> 1. Add a `run_method` wrapper in the Python vendor (`.py`) with a clear signature and docstring.
> 2. Implement the corresponding method in the JS vendor (`.js`) and accept a structured payload (object) so you can evolve it (e.g., `{ line, focus }`).
> 3. Keep all low-level DOM/editor logic inside the JS vendor; never reach into iframe DOM from the app backend directly.

#### **4. Verify Backend Response Contracts** 📋

Before using backend response fields:

1. Check endpoint response shape in backend code
2. See which fields existing features use (trace it!)
3. Use relative paths (`.rel`) with project context
4. Don't assume field meanings - verify with existing usage

**Example:**
```python
# Backend returns both:
{
  "path": "/home/user/project/file.py",  # Absolute
  "rel": "src/file.py"                    # Relative to project
}

# Explorer uses .rel - you should too:
window.appOpenFileRel(item.rel, currentProjectPath)  // ✅ Correct
window.appOpenFile(item.path)                        // ❌ Bypasses project context
```

**Why:** Backend returns fields for specific reasons. Using wrong field breaks project-relative resolution.

---

### **During Development**

#### **5. Mobile-First UI Patterns** 📱

**Critical for search/filter interfaces:**

```javascript
// ❌ Bad: Destroys input on every update
function render() {
  overlay.innerHTML = '';  // Input destroyed
  overlay.appendChild(createInput());  // Recreated
  overlay.appendChild(createResults());
}

// ✅ Good: Create structure once, update content only
function render() {
  if (!overlay.querySelector('input')) {
    // First render - create structure
    overlay.appendChild(createInput());
    overlay.appendChild(createResultsContainer());
  }
  // Subsequent renders - update content only
  const results = overlay.querySelector('.results');
  results.innerHTML = newResults;
}
```

**Why:** Mobile browsers close keyboard when input element loses focus. DOM recreation = focus loss = keyboard closes every keystroke.

**Testing:** Use Chrome DevTools mobile emulation or actual mobile device.

#### **6. Defensive Programming** 🛡️

Always guard optional fields:

```javascript
// ❌ Crashes if matches undefined
fileResult.matches.forEach(...)
fileResult.matches.length

// ✅ Safe with defaults
const matches = fileResult.matches || [];
matches.forEach(...)
matches.length

// ✅ Also safe with optional chaining
fileResult.matches?.length ?? 0
```

**Apply to:**
- Array fields that might be undefined
- Nested object access
- All async operation results
- User input parsing

**Why:** Production data has edge cases development data doesn't. One guard = one crash prevented.

#### **7. Respect State Hierarchy** 📊

**The Three-Layer Architecture:**

```
Application Backend (Ground Truth)
  ├─ Reads files from disk
  ├─ Manages history/cache
  └─ Source of truth
       ↓
Host Frontend (Orchestrator)
  ├─ Calls openFile() (unified)
  ├─ Tracks currentPath, lastSha256
  └─ Manages WebSocket, diff, session
       ↓
NiceGUI Iframe Backend (Display)
  ├─ Receives already-loaded content
  ├─ Only handles editor UI
  └─ NEVER reads files from disk
```

**Rules:**
- ❌ **Never** load files in NiceGUI iframe backend
- ✅ **Always** use frontend's `openFile()` helper
- ✅ **Always** go through `/api/app/file_editor_cm6/read` endpoint
- ✅ **Always** update history via `/state/file_activity`

**Why:** Multiple sources of truth = state drift bugs. Application backend is the single authority.

---

### **Testing & Verification**

#### **8. UX Consistency Checks** 🎨

Before considering feature complete:

1. List all side effects of similar existing feature
2. Test in parallel: open same file via old feature, then new feature
3. Verify: "Does this feel EXACTLY the same?"

**Common side effects to replicate:**
- Drawer closing on mobile
- Keyboard focus management
- Loading indicators
- Toast notifications
- Browser history updates
- Visual feedback (selection, highlight)

**Example from Explorer Search:**
```javascript
// Explorer tree closes drawer when opening file
const root = document.querySelector('.fe-root');
root?.classList.remove('drawer-open');

// Search must do the same!
```

**Why:** Users learn UI patterns from existing features. Inconsistency causes confusion and "is it broken?" reports.

#### **9. Architecture Compliance Verification** ✅

Before submitting, verify:

- [ ] All file operations go through `/read` endpoint
- [ ] History tracking via `/state/file_activity` works
- [ ] WebSocket connection established
- [ ] Diff decorations work if file modified externally
- [ ] Session persistence works (reload test)
- [ ] No state drift between frontend and iframe
- [ ] Mobile keyboard stays open during typing
- [ ] Drawer/UI behavior matches existing features

**Test procedure:**
1. Open file via new feature
2. Edit and save
3. Close and reopen from history
4. Modify file externally (different editor)
5. Reload page
6. Verify all features still work

**Why:** Architecture guidelines prevent entire classes of bugs. Compliance = confidence.

---

### **Common Pitfalls**

#### **❌ Don't Do This:**

1. Skip tracing existing implementations ("I know how it works")
2. Use `ui.run_javascript()` for vendored components (breaks reliability)
3. Load files in NiceGUI iframe backend (violates single source of truth)
4. Destroy DOM on every render (breaks mobile keyboard)
5. Assume field meanings without checking usage (wrong fields break features)
6. Ignore architecture guidelines "just this once" (technical debt compounds)
7. Test only on desktop (mobile has different UX requirements)
8. Copy absolute paths when relative paths exist (breaks project context)

#### **✅ Do This Instead:**

1. Trace first, implement second (saves debugging time)
2. Add methods to vendored files properly (reliable API)
3. Use unified file opener `openFile()` (architecture compliance)
4. Update content only, preserve structure (mobile-friendly)
5. Use same fields as existing features (proven patterns)
6. Follow architecture patterns religiously (bug prevention)
7. Test on mobile early and often (different constraints)
8. Use relative paths with project context (proper resolution)

---

### **When to Update These Guidelines**

Add new best practices when:
- Bug required architecture change to fix
- Pattern used in 3+ features should be documented
- Mobile/desktop difference caused production issue
- State drift bug occurred
- New vendor component added
- Same mistake made twice

**Process:**
1. Document the lesson learned
2. Explain why the mistake happened
3. Show correct pattern with example
4. Add to this Best Practices section
5. Update relevant checklist items

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

## Preference Store Integration

**Added:** 2025-11-19 05:05 UTC (Lessons from Color Picker & Read-Only Mode Implementation)

### Overview

User preferences (theme, line numbers, word wrap, etc.) are managed by `preferences_store.py` and must persist across sessions. When adding toggleable features, you MUST register them in the preference store.

### Architecture

**Preference Flow:**
```
Frontend Toggle → persistEditorPreferences() → POST /preferences (main.py) 
                                              ↓
                                     preferences_store.py
                                              ↓
                                    Saved to disk JSON
                                              ↓
                              On load: GET /preferences (main.py)
                                              ↓
                          loadPreferences() → applyPreferencesFromStore()
                                              ↓
                               Menu checkmarks + Backend calls
```

### Required Steps for Toggleable Features

#### 1. Add to Default Preferences Schema

**File:** `app/apps/file_editor_cm6/preferences_store.py`

```python
DEFAULT_EDITOR_PREFS: Dict[str, Any] = {
    # ... existing preferences ...
    "colorPicker": True,   # Your new preference
    "readOnly": False,     # Another example
}
```

**⚠️ Critical:** If you don't add your key here, it will be **silently ignored** when saved!

#### 2. Add State Variable in Frontend

**File:** `app/apps/file_editor_cm6/main.js`

```javascript
// Global state variables
let colorPickerEnabled = true;   // Match DEFAULT_EDITOR_PREFS default
let readOnlyMode = false;
```

#### 3. Load from Preferences on Startup

**File:** `app/apps/file_editor_cm6/main.js` → `applyPreferencesFromStore()`

```javascript
function applyPreferencesFromStore(editorPrefs) {
  // ... existing preferences ...
  colorPickerEnabled = !!editorPrefs.colorPicker;  // Load your preference
  readOnlyMode = !!editorPrefs.readOnly;
}
```

#### 4. Update Menu Checkmarks

**File:** `app/apps/file_editor_cm6/main.js` → `applyMenuState()`

```javascript
function applyMenuState() {
  // ... existing menu items ...
  setMenuChecked(miToggleColorPicker, colorPickerEnabled);
  setMenuChecked(miToggleReadonly, readOnlyMode);
}
```

#### 5. Apply on Preferences Load

**File:** `app/apps/file_editor_cm6/main.js` → `loadPreferences()`

```javascript
async function loadPreferences(initialPayload = null) {
  const payload = initialPayload || await fetchPreferencesFromServer();
  applyPreferencesFromStore(payload);
  
  // Apply your feature state to the editor
  if (colorPickerEnabled) {
    apiPost('editor/color_picker/toggle', { enabled: true })
      .catch(e => console.warn('[Prefs] Failed to enable color picker:', e));
  }
}
```

#### 6. Persist When Toggled

**File:** `app/apps/file_editor_cm6/main.js` → Menu event handler

```javascript
bindMenuToggle(miToggleColorPicker, async () => {
  colorPickerEnabled = !colorPickerEnabled;
  setMenuChecked(miToggleColorPicker, colorPickerEnabled);
  persistEditorPreferences({ colorPicker: colorPickerEnabled });  // Save to disk
  
  // Apply to editor
  await apiPost('editor/color_picker/toggle', { enabled: colorPickerEnabled });
});
```

### Common Mistakes

#### ❌ Mistake 1: Not Adding to DEFAULT_EDITOR_PREFS

```python
# preferences_store.py - Missing your key!
DEFAULT_EDITOR_PREFS: Dict[str, Any] = {
    "theme": "cm6-dark",
    # colorPicker NOT listed = silently ignored when saved!
}
```

**Result:** Preference saves but doesn't persist across sessions.

#### ❌ Mistake 2: Wrong Default Value

```python
# preferences_store.py
"colorPicker": False,   # Store says OFF

# main.js
let colorPickerEnabled = true;   # Variable says ON
```

**Result:** Mismatch causes feature to reset unexpectedly on refresh.

#### ❌ Mistake 3: Not Applying on Load

```javascript
// loadPreferences() only sets the variable but never calls the backend
colorPickerEnabled = !!editorPrefs.colorPicker;  // ✅ Variable updated
// ❌ Missing: apiPost('editor/color_picker/toggle', ...)
```

**Result:** Menu checkbox is correct but feature doesn't actually activate.

#### ❌ Mistake 4: Not Using persistEditorPreferences()

```javascript
bindMenuToggle(miToggleColorPicker, async () => {
  colorPickerEnabled = !colorPickerEnabled;
  // ❌ Missing: persistEditorPreferences({ colorPicker: colorPickerEnabled });
  await apiPost('editor/color_picker/toggle', { enabled: colorPickerEnabled });
});
```

**Result:** Toggle works during session but resets on page reload.

### Testing Checklist

1. ✅ Toggle feature ON → verify menu checkmark
2. ✅ Toggle feature OFF → verify menu checkmark clears
3. ✅ Refresh page → verify feature state persists
4. ✅ Toggle ON → refresh → verify still ON
5. ✅ Check `~/.local/share/termux-extensions-2/preferences_{project_slug}.json`
6. ✅ Verify your key is present in the JSON file
7. ✅ Open DevTools Console → check for preference-related errors

### Example: Complete Implementation

See the Color Picker feature implementation in commits from 2025-11-19:
- `preferences_store.py`: Added `"colorPicker": True` to defaults
- `main.js`: State variable, load, apply, persist
- `codemirror.js`: Toggle method
- `codemirror.py`: Python wrapper
- `editor_app.py`: Backend endpoint

---

## Related Documentation

- **Session Cache Implementation:** `notes/2025-11-14_Session_Cache_Implementation_Plan.md`
- **Vendoring Journey:** `notes/NICEGUI_VENDORING_JOURNEY.md`
- **WebSocket Architecture:** `docs/core/websockets.md`
- **Search Integration Logs:** `notes/2025-11-16_CONSOLIDATED_SEARCH_LOG.md`
- **Explorer Search Implementation:** `notes/2025-11-17_EXPLORER_SEARCH_FIXES.md`

---

_Last Updated: 2025-11-19 05:05 UTC - Added Preference Store Integration section with complete guide for toggleable feature persistence_

---

# Adding Preference-Managed Editor Features

**Added:** 2025-11-19 21:51 UTC  
**Context:** Unified Preference System Implementation

---

## How to Add a New Toggleable Preference

### Step 1: Add to Preference Schema
**File:** `preferences_store.py`
```python
DEFAULT_EDITOR_PREFS: Dict[str, Any] = {
    "yourFeature": False,  # Add your feature with default value
}
```

### Step 2: Add Vendored Method (if needed)
**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
```python
def set_your_feature(self, enabled: bool) -> None:
    """Toggle your feature."""
    self.run_method('applyYourFeature', enabled)
```

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
```javascript
applyYourFeature(enabled) {
  if (!this.editor) return;
  // Implementation here
}
```

### Step 3: Backend Integration
**File:** `editor_app.py`

Add to `_get_view_state_dict()`:
```python
return {
    # ...
    "yourFeature": editor_prefs.get('yourFeature', False),
}
```

Add to `update_preference()`:
```python
elif key == 'yourFeature':
    editor.set_your_feature(bool(value))
```

Add to page load (~line 390):
```python
editor.set_your_feature(editor_prefs.get('yourFeature', False))
```

Add to file load (~line 640):
```python
editor.set_your_feature(editor_prefs.get('yourFeature', False))
```

### Step 4: Frontend Toggle
**File:** `main.js`
```javascript
bindMenuToggle(miYourFeature, async () => {
  const success = await updatePreference('yourFeature', !(editorViewState?.yourFeature));
  if (!success) host.toast('Failed to update preference');
});
```

---

## Key Principles

1. **Backend is Authority**: preferences_store.py on disk is single source of truth
2. **Stateless Frontend**: Never create preference variables in frontend
3. **Unified Pattern**: All toggles use `updatePreference(key, value)`
4. **Constructor vs Runtime**:
   - Constructor params (theme, line_wrapping): Set ONLY in constructor
   - Runtime params (zebra stripes, font scale): Set after creation
5. **Single Update**: Call `editor.update()` once after all settings

---

## Common Patterns

### Pattern: Simple Toggle
```python
elif key == 'readOnly':
    editor.set_read_only(bool(value))
```

### Pattern: Toggle with Side Effect
```python
elif key == 'wordWrap':
    editor.set_line_wrapping(bool(value))
    # Refresh diffs if showing (widgets need re-render)
    if value and get_current_file():
        current_prefs = _preferences_store.get_preferences().get('editor', {})
        if current_prefs.get('showInlineDiffs', False):
            # Refresh diffs...
```

### Pattern: Toggle with Data Loading
```python
elif key == 'showInlineDiffs':
    if value and get_current_file():
        # Load and display diffs
        diff_data = collect_diff(...)
        editor.set_diff_decorations(diff_data.get('hunks', []))
    else:
        # Clear diffs
        editor.set_diff_decorations([])
```

---

## Testing Checklist

- [ ] Default added to `DEFAULT_EDITOR_PREFS`
- [ ] Case added to `update_preference`
- [ ] Added to `_get_view_state_dict`
- [ ] Applied at page load
- [ ] Applied at file load
- [ ] Frontend uses `updatePreference()` pattern
- [ ] Toggle ON works
- [ ] Toggle OFF works
- [ ] Persists across page refresh
- [ ] No console errors

---

## Common Mistakes

❌ **Not adding to DEFAULT_EDITOR_PREFS** → Preference won't persist  
❌ **Setting constructor params twice** → Visual thrashing  
❌ **Creating frontend state variables** → State drift  
❌ **Custom toggle logic** → Inconsistent behavior  
❌ **Forgetting page/file load** → Only works after manual toggle  

---

## Architecture Flow

```
User clicks toggle
  ↓
updatePreference('key', value)
  ↓  
POST /editor/update_preference
  ↓
Backend:
  1. Updates disk (preferences_store.py)
  2. Applies to editor
  3. Returns full state
  ↓
Frontend:
  1. Receives state
  2. Updates menu checkmarks
  3. Stores in editorViewState
```

---

_Last Updated: 2025-11-24 22:15 UTC - Added Minimap Example and New Lessons Learned_

### Example 5: Minimap (Responsive & Interactive)

**Goal:** Add a VS Code-style minimap that adapts to mobile/desktop and shows git diff markers.

**Challenges:**
1.  **Responsiveness:** Needs to be a sidebar on desktop but an overlay on mobile.
2.  **Integration:** Needs to visualize data from another extension (Inline Diffs).
3.  **Persistence:** Preference must load instantly without flicker.

**Approach:**
1.  **Vendor Package:** Added `@replit/codemirror-minimap` to bundle.
2.  **Self-Contained Layout Logic:**
    - Instead of `main.js` telling the editor "be mobile", the editor component (`codemirror.js`) watches `window.matchMedia` itself.
    - It combines `props.showMinimap` (preference) AND layout state to determine mode (`desktop`, `mobile`, `off`).
3.  **Compartment Reconfiguration:** Used a `Compartment` to swap the extension configuration dynamically without destroying editor state.
4.  **Cross-Extension Dependency:**
    - Minimap needs to know where diffs are.
    - We passed `this.diffField` (created by the diff extension) into the minimap's `compute` dependency array.
    - We forced a minimap update (`updateMinimapState`) whenever diffs changed.

**Key Decision:** Moving layout logic *into* the component prevented "prop drilling" and race conditions between the parent frame and iframe layout states.

## Lessons Learned: Component Autonomy

**Added:** 2025-11-24

### Lesson 1: Self-Contained Responsive Logic

**Context:** The minimap needs to change modes (sidebar vs overlay) based on screen width.
**Old Pattern:** `main.js` detects resize → sends mode to backend → backend calls component.
**Problem:** Latency, potential state drift, complex coordination.
**Better Pattern:** Component (`codemirror.js`) watches `window.matchMedia` directly.
**Why:** The view component is the best place for view-specific layout logic. It reacts instantly to resize events without round-tripping to the backend.

### Lesson 2: Computed Extension Dependencies

**Context:** Minimap needs to visualize git diffs, which are stored in a separate CM6 StateField (`diffField`).
**Problem:** `showMinimap.compute(['doc'], ...)` doesn't update when `diffField` changes.
**Solution:** Dynamically construct dependency array: `['doc', this.diffField]`.
**Why:** CM6 extensions need explicit dependencies to trigger re-computation. If you consume external data (like a StateField), you must declare it.

### Lesson 3: Forcing Updates via Props

**Context:** When the backend loads new diffs, the minimap needs to refresh immediately.
**Solution:** Call `updateMinimapState()` (reconfigure) explicitly after setting diff decorations.
**Why:** Changing one part of the editor state (diff field) doesn't automatically trigger reconfiguration of unrelated extensions (minimap) unless explicitly linked or forced.
