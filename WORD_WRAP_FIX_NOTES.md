# Live View Settings Implementation - Complete Pattern

## Summary

Live view settings (word wrap, theme, line shading) are applied in the NiceGUI-based CM6 editor by keeping a single source of truth for view settings and having the iframe-driven editor sync itself to that state.

## Complete Live View Settings Pattern

This pattern is used for **word wrap**, **theme**, and **line shading** settings.

### Shared state storage

- `get_editor_state()` in `app/apps/file_editor_cm6/main.py` holds editor metadata including:
  - `word_wrap` (boolean)
  - `theme` (string, NiceGUI theme name like 'oneDark', 'githubDark', etc.)
  - `line_shading` (boolean) - **Note: trigger works but visual effect not yet implemented**
- `/editor/set_view_settings` updates this shared state when settings change.
- Preferences persist via the existing `PreferencesStore`; no new persistence mechanism was added.

### Host (menu bar) behavior - The Two-Step Pattern

When a user clicks a menu option (e.g., "Word Wrap", "GitHub Dark", etc.), the frontend (`main.js`) follows this pattern:

1. **Update local JS variable** (e.g., `wordWrap = !wordWrap`, `currentTheme = 'github-dark'`)
2. **Persist to disk**: Call `persistEditorPreferences({wordWrap})` or `persistEditorPreferences({theme})` 
   - This hits the `/preferences` endpoint and saves to `PreferencesStore`
3. **Update shared state**: Call `apiPost('editor/set_view_settings', {word_wrap: wordWrap})` or `apiPost('editor/set_view_settings', {theme: mapThemeToNiceGUI(currentTheme)})`
   - This updates the in-memory `editor_state` that the iframe polls

**Critical**: `/editor/set_view_settings` does NOT persist to disk—it only updates the shared state. Persistence is handled separately via `/preferences`.

### Theme name mapping

The frontend uses human-friendly theme IDs (e.g., `'github-dark'`, `'one-dark'`) which are mapped to NiceGUI theme names via `mapThemeToNiceGUI()`:

```javascript
'github-dark' → 'githubDark'
'one-dark' → 'oneDark'
'termux' → 'consoleDark'
'vscode-dark' → 'vscodeDark'
// ... etc
```

This mapping exists in `main.js` and is called before sending to `/editor/set_view_settings`.

### NiceGUI iframe behavior

The embedded editor page is defined in `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`.

**On load**, it:
- Reads `state = get_editor_state()`
- Creates the CodeMirror instance with initial values from state:
  ```python
  ui.codemirror(
      value=state.get('content', ''),
      language=state.get('language', 'python'),
      theme=state.get('theme', 'oneDark'),
      line_wrapping=state.get('word_wrap', False),
  )
  ```
- Binds the editor content to this state with `editor.bind_value(state, 'content')`

### Live synchronization (the crucial part)

The iframe keeps a `view_cache` dictionary tracking the last applied values:

```python
view_cache = {
    'word_wrap': bool(state.get('word_wrap', False)),
    'line_shading': bool(state.get('line_shading', False)),
    'theme': str(state.get('theme', 'oneDark')),
}
```

A `ui.timer(0.3, _sync_view_settings)` callback runs periodically (every 300ms) inside the NiceGUI event loop. In each tick it:

1. **Reads current values** from `state` (the shared `editor_state`)
2. **Compares to cached values**
3. **If changed**, updates the editor:
   - **Word wrap**: `editor.set_line_wrapping(target_wrap)` + `editor.update()`
   - **Theme**: `editor.set_theme(target_theme)` + `editor.update()`
   - **Line shading**: Runs custom JavaScript via `editor.client.run_javascript(...)` to apply CM6 extension

Because this logic runs client-side (within the NiceGUI page context) and uses NiceGUI's official APIs, changes are pushed to the browser immediately without a page reload.

### Why this works

- **Single source of truth**: The shared `editor_state` dict holds the canonical values
- **Separation of concerns**: 
  - Menu bar → persists to disk + updates shared state
  - `/editor/set_view_settings` → only updates shared state (NOT persistence)
  - NiceGUI iframe → polls shared state and applies changes via official APIs
- **Event loop isolation**: Avoids trying to mutate the editor directly from FastAPI route context
- **No cross-frame messaging**: Communication happens via shared Python state, not postMessage

---

## Additional notes about this app

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
