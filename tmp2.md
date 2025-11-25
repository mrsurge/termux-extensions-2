Yeah, you absolutely *can* have a singleton preference for “minimap enabled” and then let the layout logic decide **how** it shows up (desktop vs mobile) on each load. That actually fits your architecture really cleanly.

Let me map it onto what you already have and where the hooks go.

---

## 1. Split the concerns: preference vs mode

Think of two layers:

1. **Preference** (stored in your singleton backend config):

   * `minimap_enabled: bool`
   * This is persistent, per-user or global – same place you store indentation, theme, etc.

2. **Mode** (derived at runtime per page load):

   * `'desktop' | 'mobile' | 'off'`
   * Computed as:

     ```text
     if minimap_enabled is False -> "off"
     else:
         if layout == "desktop" -> "desktop"
         if layout == "mobile"  -> "mobile"
     ```

   So the minimap extension only ever sees a **mode string**, not the raw preference. That keeps the CM6 side simple and lets you do orientation tricks without touching the preference model.

On the CM6 side you’re already using Compartments / reconfigure patterns for toggling features, which is exactly how CM6 expects you to do dynamic settings. ([codemirror.net][1])

---

## 2. On page load: compute once, pass down

Startup flow:

1. **Backend** loads user prefs:

   * `prefs.minimap_enabled` (True/False).

2. **Frontend layout** detects “mobile vs desktop”:

   * You already have breakpoints for the overall editor layout.
   * That can be as simple as a `matchMedia('(max-width: Xpx)')` or whatever you’re using now.

3. **Compute mode** in the outer app shell:

   ```js
   const enabled = prefs.minimap_enabled;      // from backend JSON
   const isMobileLayout = detectMobileLayout(); // your existing breakpoint logic

   const mode =
     !enabled ? 'off'
     : isMobileLayout ? 'mobile'
     : 'desktop';
   ```

4. **Call your NiceGUI/CM6 hook once**:

   * e.g. POST `/editor/minimap/mode { mode }`
   * Python endpoint calls `editor.set_minimap_mode(mode)`
   * That runs `applyMinimapMode(mode)` in your vendored `codemirror.js`, which reconfigures the Compartment with `showMinimap` or `[]`.

This is the same pattern CM6 docs and forum posts show for toggling features with Compartments – you’re just driving it from your “code-server style” backend instead of a React component. ([discuss.CodeMirror][2])

---

## 3. When the user toggles the setting: “set content” hook

When the user flips “Minimap on/off” in your UI:

1. Update the singleton preference in the backend:

   * `prefs.minimap_enabled = new_value`
   * Write to whatever config store you’re using now.

2. Recompute the **mode** (no reload needed):

   ```python
   enabled = prefs.minimap_enabled
   layout = current_layout  # you already track this in JS; you can pass it back or re-detect

   if not enabled:
       mode = 'off'
   elif layout == 'mobile':
       mode = 'mobile'
   else:
       mode = 'desktop'
   ```

3. Call the same hook you use at startup:

   * From backend: `editor.set_minimap_mode(mode)`
   * Or from frontend via your “set content”/API pattern:

     * UI toggle → `POST /editor/preferences` (updates store)
     * As part of that endpoint, you also call `editor.set_minimap_mode(mode)`

On the CM side this is just another **reconfigure** effect into the minimap Compartment, exactly like dynamic theme toggling examples. ([codemirror.net][3])

So your “set content hook” is really just “preference changed → recompute mode → call the same minimap setter”.

---

## 4. How it fits your non-standard NiceGUI / vendor setup

Given what you described:

* CM6 is bundled in `nicegui/elements/codemirror`, exposed via `codemirror.js`.
* You already:

  * Strip `ui.codemirror` defaults
  * Inject user prefs on load
  * Control state from Python (file path, content, etc.)

You just add **one more preference-driven feature**:

* Backend:

  * Add `minimap_enabled` to your singleton prefs.
  * Ensure it’s included in the JSON the editor page gets.

* Frontend outer app:

  * Use your existing breakpoint/orientation logic to detect layout.
  * Compute `mode` as above.
  * POST it once on load (and again when layout changes, if you want), which calls `editor.set_minimap_mode(mode)`.

* Vendored CM6 / NiceGUI:

  * Keep a single minimap Compartment + `applyMinimapMode(mode)` function.
  * No need for separate “mobile minimap extension” and “desktop minimap extension”; you just pass a different mode and CSS class.

So: yes, your idea works as-is. You keep the minimap preference as a singleton “on/off” flag, treat mobile/desktop as a *derived* mode at runtime, and your “set content”/preference change hook simply re-runs the same `set_minimap_mode(mode)` pipeline you use on page load.

[1]: https://codemirror.net/examples/config/?utm_source=chatgpt.com "Example: Configuration"
[2]: https://discuss.codemirror.net/t/toggling-extensions/4667?utm_source=chatgpt.com "Toggling Extensions"
[3]: https://codemirror.net/docs/ref/?utm_source=chatgpt.com "Reference Manual"
