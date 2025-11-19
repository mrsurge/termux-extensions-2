# Unified Preference Loading System - Implementation Plan

**Created:** 2025-11-19 20:27 UTC  
**Status:** Ready for Implementation  
**Testing:** Separate team will conduct testing after implementation

---

## Executive Summary

**Problem:** Multiple preference loading paths cause erratic behavior. Frontend caches preferences, backend loads them independently, and different features use inconsistent sync patterns.

**Solution:** Backend becomes the SINGLE source of truth. Preferences are loaded ONCE from disk at page render. Frontend becomes stateless, only displaying what backend tells it.

**Key Principle:** `preferences_store.py` on disk → Backend loads at `/nc` page render → Backend applies to editor → Frontend queries backend for display state only

---

## Architecture Changes

### Current (Broken) Flow
```
preferences_store.py (disk)
    ↓
    ├─→ Frontend loads via /preferences → cachedPreferences variable
    └─→ Backend loads at page render → applies some settings
    
Frontend state variables (showLineNumbers, wordWrap, etc.)
    ↓
Menu toggles may or may not sync to backend
    ↓
State drift occurs
```

### New (Fixed) Flow
```
preferences_store.py (disk) ← SINGLE SOURCE OF TRUTH
    ↓
Backend loads ONCE at /nc page render
    ↓
Backend applies ALL settings to editor
    ↓
Frontend queries backend for menu checkmarks ONLY
    ↓
Menu toggles → Backend updates disk + applies to editor
    ↓
Backend broadcasts state change to frontend
```

---

## Files to Modify

### 1. **app/apps/file_editor_cm6/main.js** (MAJOR CHANGES)

#### Changes Required:

**A. Remove All Preference State Variables (Lines ~100-130)**
```javascript
// DELETE THESE:
let showLineNumbers = true;
let showLineShading = false;
let showIndentGuides = false;
let showSyntaxHighlight = true;
let wordWrap = false;
let autoCloseBrackets = true;
let enableAutocompletion = true;
let autoSaveEnabled = true;
let showInlineDiffs = true;
let colorPickerEnabled = true;
let readOnlyMode = false;
let trackAgentEdits = false;
let currentTheme = 'cm6-dark';
let cachedPreferences = null;

// REPLACE WITH:
// Preferences are managed by backend; frontend displays state only
let editorViewState = null; // Loaded from backend at startup
```

**B. Delete Functions (Remove Entirely)**
```javascript
// DELETE lines 946-1076 (entire section):
function applyPreferencesFromStore(payload) { ... }
async function fetchPreferencesFromServer() { ... }
async function loadPreferences(initialPayload = null) { ... }
async function persistEditorPreferences(partialEditor = null) { ... }
```

**C. Replace with Minimal Query Functions**
```javascript
// ADD after line ~945:
async function fetchEditorState() {
  // Query backend for current editor state (for menu checkmarks only)
  try {
    const resp = await fetch('/api/app/file_editor_cm6/editor/view_state', { cache: 'no-store' });
    const json = await resp.json();
    return json?.data || null;
  } catch (err) {
    console.error('[EditorState] Failed to fetch:', err);
    return null;
  }
}

async function updatePreference(key, value) {
  // Send preference change to backend; backend handles persistence + application
  try {
    const resp = await apiPost('editor/update_preference', { key, value });
    if (resp?.ok) {
      // Backend has updated; refresh menu state
      await refreshMenuState();
    }
    return resp?.ok || false;
  } catch (err) {
    console.error(`[Preference] Failed to update ${key}:`, err);
    return false;
  }
}

async function refreshMenuState() {
  // Query backend for current state and update menu checkmarks
  const state = await fetchEditorState();
  if (!state) return;
  
  editorViewState = state;
  
  // Update all menu checkmarks from backend state
  setMenuChecked(miToggleLines, state.showLineNumbers);
  setMenuChecked(miToggleSyntax, state.showSyntax);
  setMenuChecked(miToggleCloseBrackets, state.autoCloseBrackets);
  setMenuChecked(miToggleAutocomplete, state.autocompletion);
  setMenuChecked(miToggleShading, state.showShading);
  setMenuChecked(miToggleIndentGuides, state.showIndentGuides);
  setMenuChecked(miToggleWrap, state.wordWrap);
  setMenuChecked(miToggleAutosave, state.autoSave);
  setMenuChecked(miToggleDiffs, state.showInlineDiffs);
  setMenuChecked(miToggleColorPicker, state.colorPicker);
  setMenuChecked(miToggleReadonly, state.readOnly);
  setMenuChecked(miTrackEdits, state.trackAgentEdits);
  
  // Update theme menu checkmarks
  themeMenuItems.forEach(item => {
    setMenuChecked(item, item.dataset.theme === state.theme);
  });
}
```

**D. Rewrite All Menu Toggles (Lines 1750-1870)**

Replace ALL toggle handlers with unified pattern:
```javascript
bindMenuToggle(miToggleLines, async () => {
  const success = await updatePreference('showLineNumbers', !(editorViewState?.showLineNumbers));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleSyntax, async () => {
  const success = await updatePreference('showSyntax', !(editorViewState?.showSyntax));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleCloseBrackets, async () => {
  const success = await updatePreference('autoCloseBrackets', !(editorViewState?.autoCloseBrackets));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleAutocomplete, async () => {
  const success = await updatePreference('autocompletion', !(editorViewState?.autocompletion));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleShading, async () => {
  const success = await updatePreference('showShading', !(editorViewState?.showShading));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleIndentGuides, async () => {
  const success = await updatePreference('showIndentGuides', !(editorViewState?.showIndentGuides));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleWrap, async () => {
  const success = await updatePreference('wordWrap', !(editorViewState?.wordWrap));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleAutosave, async () => {
  const success = await updatePreference('autoSave', !(editorViewState?.autoSave));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleDiffs, async () => {
  const success = await updatePreference('showInlineDiffs', !(editorViewState?.showInlineDiffs));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleColorPicker, async () => {
  const success = await updatePreference('colorPicker', !(editorViewState?.colorPicker));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miToggleReadonly, async () => {
  const success = await updatePreference('readOnly', !(editorViewState?.readOnly));
  if (!success) host.toast('Failed to update preference');
});

bindMenuToggle(miTrackEdits, async () => {
  const success = await updatePreference('trackAgentEdits', !(editorViewState?.trackAgentEdits));
  if (!success) host.toast('Failed to update preference');
});
```

**E. Remove Theme Toggle Logic (Lines ~1680-1720)**

Replace complex theme toggle with:
```javascript
bindMenuToggle(themeItem, async () => {
  const newTheme = themeItem.dataset.theme;
  const success = await updatePreference('theme', newTheme);
  if (!success) host.toast('Failed to change theme');
});
```

**F. Remove Font Scale Persistence (Line ~707)**

Replace:
```javascript
await persistEditorPreferences({ fontScale: scale });
```

With:
```javascript
await updatePreference('fontScale', scale);
```

**G. Simplify Initialization (Lines 2080-2120)**

Replace entire initialization block with:
```javascript
// Initialize UI components
initResizeManager();

await initExplorerUI().catch(e => {
  console.error('Failed to initialize explorer UI:', e);
});

branchMenuHandle = initBranchMenu();
agentDrawerHandle = initAgentDrawer();

const serverState = await syncEditorState(true);

// Load menu state from backend (menus only, editor already configured)
await refreshMenuState();
bindThemeMenu();

await fetchPersistedSessionState();
initSessionStateContext(serverState);
queueSessionStateUpdate({ activeProject: serverState?.activeProject || null });

const initialDoc = '';
createView(initialDoc);
lastSavedContent = getText();
markUnsaved(false);
updatePathDisplay();

if (!serverState || !serverState.activeProject || !serverState.activeProjectExists) {
  statusEl.textContent = serverState?.activeProjectMessage || 'Select a project to begin.';
  fileNameEl.textContent = 'No file';
  fileNameEl.title = 'No file';
  filePathEl.textContent = '';
  filePathEl.title = '';
  return;
}

// Open file via URL param or saved state
// ... rest of initialization
```

**H. Remove Preference References in createView()**

Find all references to deleted state variables in `createView()` function and replace with backend state queries:
```javascript
// BEFORE:
if (showSyntaxHighlight) { ... }
if (showLineNumbers) { ... }
if (autoCloseBrackets) { ... }

// AFTER:
// These are now handled by backend during set_content
// createView() becomes purely a frontend UI concern
// Remove all preference conditionals from createView()
```

---

### 2. **app/apps/file_editor_cm6/nicegui_editor/editor_app.py** (MAJOR CHANGES)

#### Changes Required:

**A. Add New Endpoint: `/editor/view_state` (After line 700)**

```python
@editor_router.get('/view_state')
async def get_view_state():
    """Return current editor view settings for frontend display (menu checkmarks)."""
    prefs = _preferences_store.get_preferences()
    editor_prefs = prefs.get('editor', {})
    
    # Return current state from disk (single source of truth)
    return {
        "ok": True,
        "data": {
            "showLineNumbers": editor_prefs.get('showLineNumbers', True),
            "showSyntax": editor_prefs.get('showSyntax', True),
            "showShading": editor_prefs.get('showShading', False),
            "wordWrap": editor_prefs.get('wordWrap', False),
            "autoCloseBrackets": editor_prefs.get('autoCloseBrackets', True),
            "autocompletion": editor_prefs.get('autocompletion', True),
            "theme": editor_prefs.get('theme', 'cm6-dark'),
            "autoSave": editor_prefs.get('autoSave', True),
            "showInlineDiffs": editor_prefs.get('showInlineDiffs', True),
            "trackAgentEdits": editor_prefs.get('trackAgentEdits', False),
            "fontScale": editor_prefs.get('fontScale', 0.85),
            "showIndentGuides": editor_prefs.get('showIndentGuides', False),
            "colorPicker": editor_prefs.get('colorPicker', True),
            "readOnly": editor_prefs.get('readOnly', False),
        }
    }
```

**B. Add New Endpoint: `/editor/update_preference` (After view_state)**

```python
@editor_router.post('/update_preference')
async def update_preference(data: dict = Body(...)):
    """
    Update a single preference and apply it to the editor immediately.
    This is the ONLY way frontend should change preferences.
    """
    key = data.get('key')
    value = data.get('value')
    
    if not key:
        raise HTTPException(status_code=400, detail="key is required")
    
    editor = get_active_editor()
    if not editor:
        raise HTTPException(status_code=404, detail="Editor not initialized")
    
    # Validate key is in DEFAULT_EDITOR_PREFS
    from app.apps.file_editor_cm6.preferences_store import DEFAULT_EDITOR_PREFS
    if key not in DEFAULT_EDITOR_PREFS:
        raise HTTPException(status_code=400, detail=f"Invalid preference key: {key}")
    
    # Update disk immediately
    _preferences_store.update_preferences(editor={key: value})
    
    # Apply to editor immediately based on key
    try:
        if key == 'wordWrap':
            editor.set_line_wrapping(bool(value))
        elif key == 'showShading':
            editor.set_zebra_stripes(bool(value))
        elif key == 'showIndentGuides':
            editor.set_indent_guides(bool(value))
        elif key == 'theme':
            editor.set_theme(THEME_MAP.get(value, 'basicDark'))
        elif key == 'fontScale':
            editor.set_font_scale(float(value))
        elif key == 'colorPicker':
            editor.toggle_color_picker(bool(value))
        elif key == 'readOnly':
            editor.set_read_only(bool(value))
        elif key == 'showInlineDiffs':
            if value and get_current_file():
                # Load and apply diffs
                project_path = _history_store.get_active_project() or str(get_project_root())
                if project_path:
                    rel = _normalize_rel_path(Path(project_path).expanduser(), get_current_file())
                    diff_data = collect_diff(Path(project_path).expanduser(), rel)
                    editor.set_diff_decorations(diff_data.get('hunks', []))
            else:
                editor.set_diff_decorations([])
        elif key == 'trackAgentEdits':
            if value:
                enable_edit_tracking()
            else:
                disable_edit_tracking()
        elif key in ['showLineNumbers', 'showSyntax', 'autoCloseBrackets', 'autocompletion', 'autoSave']:
            # These require frontend to rebuild view (legacy behavior)
            # Backend has updated disk; frontend will handle rebuild
            pass
        
        editor.update()
        
        print(f"[PREFERENCE] Updated {key}={value}", file=sys.stderr)
        
        return {"ok": True, "key": key, "value": value}
        
    except Exception as e:
        print(f"[PREFERENCE] Failed to apply {key}={value}: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Failed to apply preference: {e}")
```

**C. Modify `/set_content` Endpoint (Lines 630-650)**

Add comprehensive preference application at file load:
```python
# AFTER line 645 (after subscribe call), ADD:
# Apply ALL preferences from disk to ensure consistency
editor_prefs = _preferences_store.get_preferences().get('editor', {})
editor.set_zebra_stripes(editor_prefs.get('showShading', False))
editor.set_indent_guides(editor_prefs.get('showIndentGuides', False))
editor.set_line_wrapping(editor_prefs.get('wordWrap', False))
editor.set_theme(THEME_MAP.get(editor_prefs.get('theme', 'cm6-dark'), 'basicDark'))
editor.set_font_scale(editor_prefs.get('fontScale', 0.85))
editor.toggle_color_picker(editor_prefs.get('colorPicker', True))
editor.set_read_only(editor_prefs.get('readOnly', False))
editor.update()

print(f"[SET_CONTENT] Applied all preferences from disk", file=sys.stderr)
```

**D. Enhance Page Load (Lines 380-390)**

After line 389 (after setting zebra stripes), add comprehensive settings:
```python
# REPLACE lines 385-391 with:
# Apply ALL preferences from disk (single source of truth)
editor.set_zebra_stripes(editor_prefs.get('showShading', False))
editor.set_font_scale(editor_prefs.get('fontScale', 0.85))
editor.set_indent_guides(editor_prefs.get('showIndentGuides', False))
editor.set_theme(THEME_MAP.get(editor_prefs.get('theme', 'cm6-dark'), 'basicDark'))
editor.set_line_wrapping(editor_prefs.get('wordWrap', False))
editor.toggle_color_picker(editor_prefs.get('colorPicker', True))
editor.set_read_only(editor_prefs.get('readOnly', False))

print(f"[EDITOR_APP] Applied preferences: theme={editor_prefs.get('theme')}, wrap={editor_prefs.get('wordWrap')}, shading={editor_prefs.get('showShading')}, guides={editor_prefs.get('showIndentGuides')}, fontScale={editor_prefs.get('fontScale')}, colorPicker={editor_prefs.get('colorPicker')}, readOnly={editor_prefs.get('readOnly')}", file=sys.stderr)
```

**E. Remove `/set_view_settings` Endpoint (Lines 869-920)**

This endpoint becomes redundant. All preference updates go through `/update_preference`.

```python
# DELETE entire function from line 869 to line 920
# @editor_router.post('/set_view_settings')
# async def set_view_settings(data: dict = Body(...)): ...
```

**F. Remove Color Picker Toggle Endpoint (Find and delete)**

```python
# DELETE wherever it exists:
# @editor_router.post('/color_picker/toggle')
# async def toggle_color_picker(...): ...
```

**G. Remove Read-Only Toggle Endpoint (Find and delete)**

```python
# DELETE wherever it exists:
# @editor_router.post('/read_only/set')
# async def set_read_only(...): ...
```

---

### 3. **app/apps/file_editor_cm6/preferences_store.py** (MINOR CHANGES)

#### Changes Required:

**A. Remove Default Fallback Logic (Line 97)**

```python
# BEFORE (line 97):
def get_preferences(self, project_path: Optional[str] = None) -> Dict[str, Any]:
    with self._lock:
        editor = {**DEFAULT_EDITOR_PREFS, **(self._data.get("editor") or {})}
        ui = {**DEFAULT_UI_PREFS, **(self._data.get("ui") or {})}

# AFTER:
def get_preferences(self, project_path: Optional[str] = None) -> Dict[str, Any]:
    with self._lock:
        # Return ONLY what's on disk; no defaults merged
        # If preference missing, backend will use vendored codemirror defaults
        editor = self._data.get("editor") or {}
        ui = self._data.get("ui") or {}
```

**RATIONALE:** User explicitly requested "I don't even want the default preferences to ever be loaded." The vendored codemirror.py has its own defaults for each setting method (e.g., `set_line_wrapping(False)` has a default). Let those be the source of defaults, not Python constants.

**ALTERNATIVE (if above breaks things):** Keep defaults but add a flag:
```python
def get_preferences(self, project_path: Optional[str] = None, apply_defaults: bool = True) -> Dict[str, Any]:
    with self._lock:
        if apply_defaults:
            editor = {**DEFAULT_EDITOR_PREFS, **(self._data.get("editor") or {})}
            ui = {**DEFAULT_UI_PREFS, **(self._data.get("ui") or {})}
        else:
            editor = self._data.get("editor") or {}
            ui = self._data.get("ui") or {}
```

Then backend calls `get_preferences(apply_defaults=False)` to get pure disk state.

---

### 4. **app/apps/file_editor_cm6/main.py** (REMOVE ENDPOINT)

#### Changes Required:

**A. Delete `/preferences` Endpoint (Find and delete entirely)**

This endpoint is no longer needed; frontend doesn't cache preferences.

```python
# FIND and DELETE:
@app_router.get('/preferences')
async def get_preferences(...): ...

@app_router.post('/preferences')
async def update_preferences(...): ...
```

---

### 5. **app/static/vendor/nicegui/elements/codemirror/codemirror.py** (ADD METHOD)

#### Changes Required:

**A. Add `toggle_color_picker` Method (After line 377)**

```python
def toggle_color_picker(self, enabled: bool) -> None:
    """Toggle CSS color picker extension."""
    self.run_method('applyColorPicker', enabled)
```

**RATIONALE:** Ensure all preferences have dedicated methods for clean application.

---

## Critical Implementation Notes

### 1. **Document Cache vs Preference Cache**

**DO NOT CONFUSE:**
- **Document cache** (lines 340-360 in editor_app.py) = Restores unsaved edits when user returns
- **Preference cache** (cachedPreferences in main.js) = Frontend caching of preferences (THIS IS WHAT WE'RE REMOVING)

**Document cache MUST remain untouched.** It's managed by `history_store.py` and handles crash recovery.

### 2. **Initial Page Load Sequence**

**New guaranteed order:**
1. Frontend requests `/nc` page
2. Backend renders page, loads preferences from disk ONCE
3. Backend creates editor with ALL preferences applied
4. Page loads in browser
5. Frontend queries `/editor/view_state` for menu checkmarks only
6. User clicks menu → `/editor/update_preference` → disk + editor updated
7. Backend broadcasts state change (optional enhancement)

### 3. **Fallback Elimination**

**What gets removed:**
- ✅ `cachedPreferences` variable in main.js
- ✅ `applyPreferencesFromStore()` function
- ✅ `fetchPreferencesFromServer()` function
- ✅ `loadPreferences()` function
- ✅ `persistEditorPreferences()` function
- ✅ All frontend preference state variables
- ✅ `/preferences` endpoint in main.py
- ✅ Default merging in preferences_store.py (optional, see note)

**What remains:**
- ✅ `preferences_store.py` file on disk (THE source of truth)
- ✅ `history_store.py` file on disk (document cache, unrelated to preferences)
- ✅ Backend preference loading at page render
- ✅ Backend preference methods (set_zebra_stripes, etc.)

### 4. **Testing Checklist**

For separate testing team:

- [ ] Fresh page load applies all preferences correctly
- [ ] Toggle each menu item updates editor immediately
- [ ] Page refresh preserves all preference changes
- [ ] Theme changes work and persist
- [ ] Font scale changes work and persist
- [ ] Document cache still works (unsaved edits preserved)
- [ ] Crash recovery still works (draft restored after shutdown)
- [ ] No console errors about missing preference variables
- [ ] Menu checkmarks always match editor behavior
- [ ] Multiple rapid toggles don't cause state drift
- [ ] Preferences persist across worker restarts
- [ ] Opening different files doesn't reset preferences
- [ ] Color picker toggle works correctly
- [ ] Read-only mode toggle works correctly
- [ ] Inline diffs toggle loads/clears decorations

### 5. **Migration Path**

**Order of implementation:**
1. Create new endpoints in editor_app.py (`/view_state`, `/update_preference`)
2. Add `toggle_color_picker()` method to codemirror.py
3. Modify main.js (remove cache, add query functions, rewrite toggles)
4. Remove old endpoints (`/preferences`, `/set_view_settings`, etc.)
5. Test thoroughly with checklist above
6. (Optional) Remove default merging from preferences_store.py

**Rollback plan:**
If issues arise, git revert the main.js changes first (largest risk surface area).

---

## Summary

**Single Source of Truth:** `preferences_store.py` file on disk

**Authority Flow:** Disk → Backend loads → Backend applies → Frontend displays

**No Caching:** Frontend never caches preferences, only queries for display

**No Fallbacks:** No default preference merging (optional), no cached preference variables, no multiple load paths

**Unified Pattern:** All menu toggles use identical pattern: `updatePreference()` → backend updates disk + applies → frontend refreshes menu

**Result:** Deterministic preference behavior, no state drift, preferences always match between menu and editor.

---

**Implementation Time Estimate:** 4-6 hours  
**Risk Level:** Medium (large refactor but clear path)  
**Testing Required:** Full regression suite (see checklist)


---

## Verification Report - 2025-11-19

**Reviewer:** Jimmy
**Time:** 21:45 UTC

### Critical Issue: Agent Drawer Breakage

The plan instructs to **delete** the `/preferences` endpoints in `main.py` (Step 4).

My verification of `app/apps/file_editor_cm6/static/js/agent_drawer.js` confirms that the Agent Drawer **explicitly uses** these endpoints to persist its state, specifically the `last_active_session_id`.

**Code Reference:**
```javascript
// agent_drawer.js lines 234 & 884
const prefResp = await fetch('/api/app/file_editor_cm6/preferences/get?key=last_active_session_id');
// ...
await fetch('/api/app/file_editor_cm6/preferences/set', { ... });
```

**Impact:**
If the `/preferences` endpoints are deleted as planned, the Agent Drawer will lose its ability to remember the last active session, degrading the user experience.

**Recommendation:**
**DO NOT** delete the generic `/preferences` endpoints in `main.py`. They must be preserved for the Agent Drawer and other potential consumers. Instead, simply stop using them in `main.js` (the editor frontend) as planned.

### Optimization: Round Trip Reduction

The current plan involves a two-step process for every preference toggle:
1.  `POST /editor/update_preference` (Update backend)
2.  `GET /editor/view_state` (Fetch new state to update UI)

This results in two network round trips for every user action, which may feel sluggish.

**Recommendation:**
Modify the `/editor/update_preference` endpoint to return the full updated `view_state` in its response. This allows the frontend to update the UI immediately in a single round trip.

### Modified Plan Excerpt (Recommended)

**Step 4 (Corrected):**
> **SKIP** deleting `/preferences` in `main.py`. Leave it intact for legacy/agent support.

**Step 2B (Optimized):**
> Update `/editor/update_preference` to return the full state dictionary in `data`, identical to `/editor/view_state`.

---
*Signed: Jimmy*