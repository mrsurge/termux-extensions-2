# Live View Settings Implementation - Complete Pattern

**Last Updated:** November 12, 2025

## Summary

Live view settings (word wrap, theme, line shading, inline diffs) are applied in the NiceGUI-based CM6 editor using a simple, direct approach: settings are persisted to disk via `PreferencesStore`, and the editor loads them fresh on every page load.

## Architecture Overview

### Storage Layer: PreferencesStore

**File:** `app/apps/file_editor_cm6/preferences_store.py`  
**Location:** `~/.local/share/termux-extensions-2/code_oss_prefs.json`

The preferences store is a thread-safe, disk-backed JSON store with atomic writes. It handles:
- `editor` settings (word wrap, theme, zebra stripes, inline diffs, etc.)
- `ui` settings (assistant collapsed, git indicators)
- `project` settings (last opened file per project)

**Key Properties:**
- Thread-safe with `threading.Lock()`
- Atomic writes via temp file + rename pattern
- Validates updates against default schema
- Merges defaults with stored values on read

### Settings Flow: Two-Step Pattern

When a user changes a setting via the menu bar:

1. **Persist to disk** via `/preferences` endpoint:
   ```javascript
   persistEditorPreferences({ wordWrap: true })
   // → POST /api/app/file_editor_cm6/preferences
   // → Updates PreferencesStore on disk
   ```

2. **Apply immediately** via `/editor/set_view_settings` endpoint:
   ```javascript
   apiPost('editor/set_view_settings', { word_wrap: true })
   // → POST /api/app/file_editor_cm6/editor/set_view_settings
   // → Calls editor.set_line_wrapping(true) immediately
   ```

**Why two calls?**
- Disk persistence and live UI updates are decoupled
- Allows settings to be saved even if editor isn't loaded
- Immediate feedback without waiting for disk I/O

### Page Load Behavior: Fresh State Every Time

**NiceGUI Reconnection Disabled:**
```python
@ui.page('/nc', reconnect_timeout=0)  # Force fresh page load
async def editor_page():
    # Load preferences from disk
    prefs = _preferences_store.get_preferences()
    editor_prefs = prefs.get('editor', {})
    
    # Create editor with current settings
    editor = ui.codemirror(
        theme=editor_prefs.get('theme', 'cm6-dark'),
        line_wrapping=editor_prefs.get('wordWrap', False),
    )
    
    # Apply additional settings
    editor.set_zebra_stripes(editor_prefs.get('showShading', False))
    if editor_prefs.get('showInlineDiffs', False):
        editor.set_diff_decorations([])
```

**Critical Design Decision:**
- `reconnect_timeout=0` disables NiceGUI's client reconnection feature
- Every browser refresh creates a **new** Client instance
- `editor_page()` function **always runs** on every page load
- Settings are **always** read fresh from disk

**Why disable reconnection?**
1. **Prevents stale state** - NiceGUI's reconnection preserves old client state, causing visual thrash when settings change
2. **Matches user intent** - When user refreshes after changing settings, they expect to see the new settings
3. **Simple mental model** - Refresh = fresh load, predictable behavior
4. **Mobile-friendly** - Screen-off/app-switch often disconnects anyway; fresh load is clearer
5. **Aligned with architecture** - Multi-process worker model already handles lifecycle cleanly

### Theme Name Mapping

The frontend uses human-friendly theme IDs that get mapped to NiceGUI theme names:

```javascript
function mapThemeToNiceGUI(themeId) {
  const themeMap = {
    'github-dark': 'githubDark',
    'one-dark': 'oneDark',
    'termux': 'consoleDark',
    'vscode-dark': 'vscodeDark',
    // ... etc
  };
  return themeMap[themeId] || 'oneDark';
}
```

This mapping happens in `main.js` before calling `/editor/set_view_settings`.

---

## File Opening: Re-sync from Disk

When a file is opened via `/editor/set_content` (main.py lines 268-284):

```python
# CRITICAL: Re-sync ALL settings from disk on every file load
# This ensures browser refresh (while worker still running) gets fresh settings
prefs = _preferences_store.get_preferences()
editor_prefs = prefs.get('editor', {})

# Apply settings using vendored CodeMirror API methods
editor.set_zebra_stripes(editor_prefs.get('showShading', False))
editor.set_line_wrapping(editor_prefs.get('wordWrap', False))
editor.set_theme(editor_prefs.get('theme', 'cm6-dark'))
```

**Why re-sync on file open?**
- Defensive: ensures settings are correct even if page didn't fully reload
- Covers edge cases where NiceGUI state might be stale
- Minimal overhead (fast disk read + method calls)

---

## Vendored NiceGUI CodeMirror API

**Location:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`

**Custom Methods:**
```python
def set_line_wrapping(self, value: bool) -> None:
    """Sets whether line wrapping is enabled."""
    self._props['lineWrapping'] = value

def set_theme(self, theme: SUPPORTED_THEMES) -> None:
    """Sets the theme of the editor."""
    self._props['theme'] = theme

def set_zebra_stripes(self, enabled: bool) -> None:
    """Toggles logical-line zebra striping."""
    self.run_method('applyZebraStripes', enabled)

def set_diff_decorations(self, hunks: list) -> None:
    """Apply inline git diff decorations."""
    self.run_method('applyDiffDecorations', hunks)
```

**CRITICAL:** Vendored CodeMirror uses `._props` internally, **NOT** `.options`.
- ❌ `editor.options['lineWrapping'] = value` → AttributeError
- ✅ `editor.set_line_wrapping(value)` → Works correctly

---

## Bug History & Lessons Learned

### Bug #1: editor.options API Mismatch (Nov 12, 2025)

**Symptom:** 500 error when opening files after browser refresh

**Root Cause:**
```python
# BROKEN (old code):
editor.options['lineWrapping'] = word_wrap  # ❌ .options doesn't exist

# FIXED:
editor.set_line_wrapping(word_wrap)  # ✅ Uses vendored API
```

**Why it failed:**
- Vendored `CodeMirror` uses `._props` dict, not `.options`
- Inconsistent API usage between endpoints
- Crash prevented ALL settings from being applied

**Fix:** Use `set_line_wrapping()`, `set_theme()`, `set_zebra_stripes()` consistently everywhere.

### Bug #2: NiceGUI Client Reconnection (Nov 12, 2025)

**Symptom:** Settings changed, persisted to disk, but old settings displayed after browser refresh

**Root Cause:**
- NiceGUI's default `reconnect_timeout` preserves client state across refreshes
- Browser refresh → NiceGUI reconnects to existing client from worker start
- `editor_page()` doesn't re-run on reconnect, old editor instance persists
- Settings on disk were correct, but editor wasn't reloaded

**Fix:** Set `reconnect_timeout=0` to force fresh page load every time

---

## Why This Works

**Single source of truth:** PreferencesStore on disk holds canonical values

**Separation of concerns:**
- Menu bar → persists to disk + applies immediately
- `/preferences` → handles long-term storage
- `/editor/set_view_settings` → handles immediate UI updates  
- Page load → reads fresh from disk, no caching

**No polling/timers needed:** Settings are applied:
1. Immediately when changed (via endpoint method calls)
2. On page load (from disk)
3. On file open (defensive re-sync)

**Predictable lifecycle:** With `reconnect_timeout=0`:
- Browser refresh = new Client = fresh state
- No hidden state preservation
- Settings always match disk

---

## Additional Notes About This App

### Single-user, same-device model

The architecture assumes a single local user (Termux / localhost). That simplifies many choices: we can safely treat shared module-level state (history, preferences, editor_state) as effectively global without multi-tenant isolation.

### Iframe-based editor shell

- The main `file_editor_cm6` UI (menus, explorer, agent, etc.) runs in the host page.
- The actual CodeMirror editor runs inside a NiceGUI-served iframe (`/api/app/file_editor_cm6/ui/nc`).
- Both share the same Python process and in-memory stores; communication is done via HTTP routes backed by shared state, not by separate services.

### Explorer -> editor integration

- Explorer actions in the host call `window.appOpenFile(...)` / `appOpenFileRel(...)`.
- These functions use `main.js` to:
  - Read file content via `/read`.
  - Update shared editor state via `/editor/set_content`.
  - Update history via `/state/file_activity`.
- The iframe binds to this shared state and shows the current file contents.

### State-first design pattern

Many issues (including word wrap and theme) become simpler when the host only updates canonical state via API routes, and the NiceGUI page is responsible for reflecting that state. Directly running JS from FastAPI route handlers into the iframe context proved brittle; confining UI updates to the NiceGUI loop (and having it watch state) is more reliable.

### CM6 customization surface

The app already extends CM6 with:
- Git diff decorations and inline indicators.
- Agent integration and edit tracking.
- Zebra-striping support wired via a small CM6 extension.

These customizations live alongside NiceGUI's `ui.codemirror` wrapper, so using the official wrapper APIs (like `set_line_wrapping`, `set_theme`) where available keeps things maintainable.

### App worker / routing assumptions

WebSocket and HTTP routing for `file_editor_cm6` are centralized in `app/main.py` and `app/libs/app_worker.py`. Several fallbacks (e.g. defaulting `app_id` to `file_editor_cm6` when WS referer is missing) are intentional and assume this editor is the primary app.
