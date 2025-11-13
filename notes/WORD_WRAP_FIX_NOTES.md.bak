Summary

- Word wrap is now applied live in the NiceGUI-based CM6 editor by keeping a single source of truth for view settings and having the iframe-driven editor sync itself to that state.

Key pieces

- Shared state storage:
  - `get_editor_state()` in `app/apps/file_editor_cm6/main.py` holds editor metadata including `word_wrap`.
  - `/editor/set_view_settings` updates this shared state when the menu bar toggles word wrap.
  - Preferences persist via the existing `PreferencesStore`; no new persistence mechanism was added.

- Host (menu bar) behavior:
  - The menu still calls `/editor/set_view_settings` when the user toggles "Word Wrap".
  - That endpoint updates the in-memory `editor_state['word_wrap']` and the preference file.
  - It no longer tries to push UI changes directly; it just mutates the canonical state.

- NiceGUI iframe behavior:
  - The embedded editor page is defined in `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`.
  - On load, it:
    - Reads `state = get_editor_state()`.
    - Creates the CodeMirror instance via `ui.codemirror(..., line_wrapping=state.get('word_wrap', False))` so initial wrap respects the stored preference.
    - Binds the editor content to this state with `editor.bind_value(state, 'content')`.

- Live synchronization (the crucial part):
  - The iframe keeps a small `view_cache` of the last applied `word_wrap` value.
  - A `ui.timer` callback runs periodically inside the NiceGUI event loop. In each tick it:
    - Reads the current `state.get('word_wrap', False)` from shared storage.
    - If this differs from `view_cache['word_wrap']`, it:
      - Updates the cache.
      - Calls `editor.set_line_wrapping(target_wrap)` followed by `editor.update()`.
  - Because this logic runs client-side (within the NiceGUI page context) and uses NiceGUI’s own `CodeMirror.set_line_wrapping` API plus `update()`, the change is pushed to the browser immediately without a page reload.

Why this works

- Only one source of truth: the shared `editor_state['word_wrap']` and preferences.
- The menu bar only mutates that state via `/editor/set_view_settings`.
- The NiceGUI iframe watches that state and applies `set_line_wrapping` itself inside the correct event loop, using the officially supported NiceGUI API.
- This avoids cross-frame messaging and avoids trying to mutate the editor directly from a FastAPI route context, which had been the source of earlier "no effect until reload" behavior.

Additional notes about this app

- Single-user, same-device model:
  - The architecture assumes a single local user (Termux / localhost). That simplifies many choices: we can safely treat shared module-level state (history, preferences, editor_state) as effectively global without multi-tenant isolation.

- Iframe-based editor shell:
  - The main `file_editor_cm6` UI (menus, explorer, agent, etc.) runs in the host page.
  - The actual CodeMirror editor runs inside a NiceGUI-served iframe (`/api/app/file_editor_cm6/ui/nc`).
  - Both share the same Python process and in-memory stores; communication is done via HTTP routes backed by shared state, not by separate services.

- Explorer -> editor integration:
  - Explorer actions in the host call `window.appOpenFile(...)` / `appOpenFileRel(...)`.
  - These functions use `main.js` to:
    - Read file content via `/read`.
    - Update shared editor state via `/editor/set_content`.
    - Update history via `/state/file_activity`.
  - The iframe binds to this shared state and shows the current file contents.

- State-first design pattern:
  - Many issues (including word wrap) become simpler when the host only updates canonical state via API routes, and the NiceGUI page is responsible for reflecting that state.
  - Directly running JS from FastAPI route handlers into the iframe context proved brittle; confining UI updates to the NiceGUI loop (and having it watch state) is more reliable.

- CM6 customization surface:
  - The app already extends CM6 with:
    - Git diff decorations and inline indicators.
    - Agent integration and edit tracking.
    - Zebra-striping support wired via a small CM6 extension.
  - These customizations live alongside NiceGUI's `ui.codemirror` wrapper, so using the official wrapper APIs (like `set_line_wrapping`) where available keeps things maintainable.

- App worker / routing assumptions:
  - WebSocket and HTTP routing for `file_editor_cm6` are centralized in `app/main.py` and `app/libs/app_worker.py`.
  - Several fallbacks (e.g. defaulting `app_id` to `file_editor_cm6` when WS referer is missing) are intentional and assume this editor is the primary app.

