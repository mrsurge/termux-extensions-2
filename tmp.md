# Preference System Implementation

## Goal
Single source of truth for all editor preferences. Backend reads from disk file, no caching, no defaults except when creating the file initially. Frontend is stateless.

---

## Preference File Location
**File:** `~/.local/share/termux-extensions-2/code_oss_prefs.json`

**Structure:**
```json
{
  "editor": {
    "theme": "cm6-dark",
    "wordWrap": false,
    "showShading": false,
    ...
  },
  "ui": {},
  "projects": {}
}
```

---

## History File Location
**File:** `~/.local/share/termux-extensions-2/code_oss_history.json`

Contains: recent projects, recent files per project, active project, last file per project

---

## Session Cache Location
**Directory:** `~/.cache/cm6_sessions/`

Contains: Unsaved editor content for crash recovery

---

## Vendored NiceGUI Files
**Location:** `/data/data/com.termux/files/home/mrselect/app/static/vendor/nicegui/elements/codemirror/`

**Files:**
- `codemirror.py` - Python NiceGUI CodeMirror element
- `codemirror.js` - JavaScript CodeMirror implementation

---

## Implementation Files

### File: `app/apps/file_editor_cm6/preferences_store.py`

**Intent:** Read/write preference file directly from/to disk with no in-memory cache. If file doesn't exist, create it with defaults from `DEFAULT_EDITOR_PREFS`.

**Key changes:**
- Removed `self._data` in-memory cache
- Added `_read_from_disk()` - reads JSON from file every call
- Added `_write_to_disk()` - writes JSON to file atomically
- `get_preferences()` reads from disk every time
- `update_preferences()` reads current state, modifies, writes back
- Raises `RuntimeError` if file can't be created or read

---

### File: `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

**Intent:** Apply preferences from disk when creating editor and when opening files. No fallback defaults in `.get()` calls.

**Key sections:**

**Page load (line ~370-395):**
- Read preferences from disk
- Create editor with `ui.codemirror(theme=THEME_MAP.get(prefs['theme']), line_wrapping=prefs['wordWrap'])`
- Apply runtime-only preferences after creation (zebra stripes, font scale, indent guides, etc.)
- Do NOT re-apply theme or line_wrapping after construction

**File load via set_content (line ~645-655):**
- Apply runtime-only preferences
- Do NOT apply theme or line_wrapping (constructor-only)

**Preference update endpoint (line ~820-875):**
- `/editor/update_preference` - reads from disk, updates key, writes back, returns full state

**View state endpoint (line ~775-795):**
- `/editor/view_state` - reads from disk, returns all preferences for frontend menu checkmarks

**Theme mapping:**
- `THEME_MAP` converts user-facing theme IDs (e.g., 'solarized-dark') to NiceGUI theme names (e.g., 'solarizedDark')

---

### File: `app/static/vendor/nicegui/elements/codemirror/codemirror.py`

**Intent:** Vendored NiceGUI CodeMirror element. Modified to add methods.

**Modifications:**
- Added `toggle_color_picker(enabled: bool)` method
- Modified `set_theme()` to call `self.run_method('setTheme', theme)` (in addition to setting `self._props['theme']`)

---

### File: `app/apps/file_editor_cm6/main.js`

**Intent:** Stateless frontend. Queries backend for preferences, updates menu checkmarks.

**Key changes:**
- Removed all preference state variables (`showLineNumbers`, `wordWrap`, `currentTheme`, etc.)
- Removed `cachedPreferences`
- Removed `applyPreferencesFromStore()`, `loadPreferences()`, etc.
- Added `editorViewState` - holds state from backend for reference only
- Added `fetchEditorState()` - queries `/editor/view_state`
- Added `updatePreference(key, value)` - calls `/editor/update_preference`, receives full state back
- Added `refreshMenuState()` - queries backend and updates all menu checkmarks
- All menu toggles use `updatePreference()` pattern
- Initialization calls `refreshMenuState()` instead of loading preferences

---

## Theme Issue

**Current problem:** Theme specified in preference file not being applied when editor loads.

**What happens:**
1. Preference file has theme (e.g., 'solarized-dark')
2. Backend reads it and maps to NiceGUI theme name (e.g., 'solarizedDark')
3. Editor created with `theme='solarizedDark'` in constructor
4. Wrong theme appears in editor

**No suggestions provided per instructions.**

---

END OF DOCUMENT
