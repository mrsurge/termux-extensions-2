# Zebra Striping Implementation via Vendored NiceGUI (Custom Events)

This document outlines the steps to implement toggleable zebra striping in the CodeMirror editor by modifying a locally vendored copy of the `nicegui` library.

**Approach:** This guide uses a robust custom event system to communicate between the Python backend and the JavaScript frontend, avoiding global variables.

---

### Prerequisites

1.  **NiceGUI Vendored:** The `nicegui` Python package has been copied into `app/static/vendor/nicegui/`.
2.  **`zebra_runtime.js`:** The file `app/apps/file_editor_cm6/static/js/zebra_runtime.js` exists and contains the CodeMirror 6 extension definition for zebra striping.

---

### Step 1: Force Python to Use the Vendored NiceGUI

To ensure your application uses the modified local copy instead of the version installed in `site-packages`, you must prepend the vendor directory to Python's system path.

**File to Modify:** `app/main.py` (or your application's main entry point)

**Action:** Add the following lines to the **very top** of the file.

```python
import sys
from pathlib import Path

# Add the vendor directory to the Python path to load our modified NiceGUI
vendor_dir = Path(__file__).parent / 'static' / 'vendor'
sys.path.insert(0, str(vendor_dir))

# ... rest of your app's imports and code
import nicegui
# ...
```

---

### Step 2: Update `zebra_runtime.js` to be Controllable

Modify your existing zebra striping logic to be wrapped in a function that can be called by our modified NiceGUI component. This function will accept the `EditorView` instance and apply the extension.

**File to Modify:** `app/apps/file_editor_cm6/static/js/zebra_runtime.js`

**Action:** Replace the entire content of the file with the following. This code defines the extension and exposes a single function on the `window` object to control it.

```javascript
// zebra_runtime.js
console.log('[ZebraRuntime] Loaded.');

// This function will be called by the modified NiceGUI component
window.applyZebraStripeExtension = async (view, enabled) => {
  if (!view) {
    console.error('[ZebraRuntime] Apply called without an editor view.');
    return;
  }
  console.log(`[ZebraRuntime] Applying zebra stripes: ${enabled}`);

  // Define and install the extension on first run
  if (!window.__zebraCompartment) {
    try {
      const [viewMod, stateMod] = await Promise.all([
        import('https://esm.sh/@codemirror/view@6'),
        import('https://esm.sh/@codemirror/state@6'),
      ]);
      const { EditorView, Decoration, ViewPlugin } = viewMod;
      const { Facet, RangeSetBuilder, StateEffect, Compartment } = stateMod;

      window.__zebraCompartment = new Compartment();

      const baseTheme = EditorView.baseTheme({
        "&light .cm-zebraStripe": { backgroundColor: "rgba(0,0,0,.035)" },
        "&dark .cm-zebraStripe": { backgroundColor: "rgba(255,255,255,.06)" },
      });

      const stepSize = Facet.define({ combine: v => v.length ? v[0] : 2 });
      const stripe = Decoration.line({ attributes: { class: "cm-zebraStripe" } });

      function stripeDeco(v) {
        const step = v.state.facet(stepSize);
        const b = new RangeSetBuilder();
        for (let { from, to } of v.visibleRanges) {
          for (let pos = from; pos <= to;) {
            const line = v.state.doc.lineAt(pos);
            if ((line.number % step) === 0) b.add(line.from, line.from, stripe);
            pos = line.to + 1;
          }
        }
        return b.finish();
      }

      const zebraPlugin = ViewPlugin.fromClass(class {
        constructor(v) { this.decorations = stripeDeco(v); }
        update(u) {
          if (u.docChanged || u.viewportChanged) this.decorations = stripeDeco(u.view);
        }
      }, { decorations: v => v.decorations });

      // Store extensions for later use
      window.__zebraExtensions = [baseTheme, stepSize.of(2), zebraPlugin];
      
      // Install an empty compartment into the editor configuration
      view.dispatch({
        effects: StateEffect.appendConfig.of(window.__zebraCompartment.of([]))
      });
      console.log('[ZebraRuntime] Compartment installed.');

    } catch (e) {
      console.error('[ZebraRuntime] Failed to initialize CM6 modules:', e);
      return;
    }
  }

  // Reconfigure the compartment with the extensions if enabled, or empty if disabled
  const extensions = enabled ? window.__zebraExtensions : [];
  view.dispatch({
    effects: window.__zebraCompartment.reconfigure(extensions)
  });
};
```

---

### Step 3: Modify the Vendored `codemirror.js` to Listen for Events

This is the core change. We will edit the vendored NiceGUI Vue component to listen for a custom event and then call our new `applyZebraStripeExtension` function.

**File to Modify:** `app/static/vendor/nicegui/nicegui/elements/codemirror/codemirror.js`

**Action:** Find the `mounted()` method within the `export default { ... }` block and add the event listener inside it.

```javascript
// Inside app/static/vendor/nicegui/nicegui/elements/codemirror/codemirror.js
// ... (imports and other properties) ...

  mounted() {
    this.initCodemirror();
    
    // --- START OF ADDED CODE ---
    // Listen for our custom event from Python
    document.addEventListener('toggle-zebra', (event) => {
      if (!this.editor) return; // Ignore if editor isn't ready
      
      const enabled = event.detail.enabled;
      
      // Check if our runtime is available
      if (window.applyZebraStripeExtension) {
        // Call the function from zebra_runtime.js, passing our internal editor instance
        window.applyZebraStripeExtension(this.editor, enabled);
      } else {
        console.error('[NiceGUI-CM6] Zebra runtime not found. Was the script loaded?');
      }
    });
    // --- END OF ADDED CODE ---
  },

// ... (rest of the file) ...
```

---

### Step 4: Load `zebra_runtime.js` and Trigger the Event from Python

Finally, update the Python code that manages the editor page to load the runtime script and dispatch the custom event when the state changes.

**File to Modify:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

**Action:**
1.  Add a line to load the `zebra_runtime.js` script into the page.
2.  Modify the `_sync_view_settings` function to dispatch the `toggle-zebra` custom event instead of trying to inject complex JavaScript.

```python
# app/apps/file_editor_cm6/nicegui_editor/editor_app.py
import json
import sys
from nicegui import ui, app as nicegui_app

# ... (get_active_editor function) ...

@ui.page('/nc')
async def editor_page():
    # ... (existing setup code) ...

    # --- ADD THIS LINE ---
    # Load the zebra stripe runtime script. The path is relative to the app's static serving.
    ui.add_body_html('<script src="/apps/file_editor_cm6/static/js/zebra_runtime.js"></script>')
    # --- END OF ADDED CODE ---
    
    # ... (editor definition and other code) ...

            def _sync_view_settings() -> None:
                editor_instance = get_active_editor()
                if not editor_instance or not getattr(editor_instance, 'client', None):
                    return
                
                # ... (word_wrap, theme, language sync logic remains the same) ...

                target_shade = bool(state.get('line_shading', False))
                if target_shade != view_cache['line_shading']:
                    view_cache['line_shading'] = target_shade
                    print(f"[DEBUG] Dispatching toggle-zebra event: {target_shade}", file=sys.stderr)
                    
                    # --- REPLACEMENT CODE ---
                    # Dispatch a simple custom event. The modified codemirror.js will handle it.
                    event_payload = str(target_shade).lower()
                    editor_instance.run_javascript(f'''
                        const event = new CustomEvent('toggle-zebra', {{
                            detail: {{ enabled: {event_payload} }}
                        }});
                        document.dispatchEvent(event);
                    ''')
                    # --- END OF REPLACEMENT CODE ---

            ui.timer(0.3, _sync_view_settings)
```
