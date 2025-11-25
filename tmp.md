You don’t need two separate extensions. One minimap extension + a “mode” switch (desktop vs mobile) is enough. The mode just changes how you configure / style the minimap, not which CM6 code you load.

Below is how I’d wire `@replit/codemirror-minimap` into your existing **vendored NiceGUI CM6** pipeline with a `desktop/mobile/off` mode that plays nicely with your architecture.

---

## 1. Vendor the minimap package into your CM6 bundle

Same pattern as your search panel and color picker: add the package, export it from `src/index.mjs`, rebuild.

### 1.1 Install the package

From `app/static/vendor/nicegui/elements/codemirror`:

```bash
cd app/static/vendor/nicegui/elements/codemirror
npm install @replit/codemirror-minimap
```

### 1.2 Export `showMinimap` in the bundle

Edit: `app/static/vendor/nicegui/elements/codemirror/src/index.mjs`

Add:

```javascript
// existing exports...
export * from "@codemirror/view";
export * from "@codemirror/state";
export * from "@codemirror/language";
// ...

// NEW: minimap
export { showMinimap } from "@replit/codemirror-minimap";
```

This makes `showMinimap` available via your global `CM` object in `codemirror.js`, same pattern as `@codemirror/search` and `@uiw/codemirror-extensions-color`.

### 1.3 Rebuild

```bash
npm run build
# comment out terser in rollup config if OOM, like you did before
```

The `dist/index.js` now includes the minimap extension. 

---

## 2. Add a minimap “mode” method in `codemirror.js`

Follow the same **Compartment + method** pattern you already use for indentation guides and zebra stripes.

Edit: `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

Near the top, after you pull CM exports, add a local alias:

```javascript
const showMinimap = CM.showMinimap; // from @replit/codemirror-minimap
```

Then add a Vue method on the component, next to `applyZebraStripes` / `applyIndentGuides`:

```javascript
async applyMinimapMode(mode) {
  // mode: "desktop" | "mobile" | "off"
  if (!this.editor || !showMinimap || typeof showMinimap.compute !== 'function') {
    console.warn('[CodeMirror] minimap not available');
    return;
  }

  if (!this.minimapCompartment) {
    this.minimapCompartment = new CM.Compartment();
    this.minimapMode = 'off';

    // Install empty compartment once
    this.editor.dispatch({
      effects: CM.StateEffect.appendConfig.of(
        this.minimapCompartment.of([])
      ),
    });
  }

  this.minimapMode = mode || 'off';

  let extensions = [];

  if (mode !== 'off') {
    const minimapExt = showMinimap.compute(['doc'], (state) => {
      // We just need to give it a container DOM node and config
      const create = (view) => {
        const dom = document.createElement('div');
        // Base class + mode class; CSS will do the heavy lifting
        dom.className = `cm-minimap-container cm-minimap-${mode}`;
        return { dom };
      };

      // Desktop vs mobile are just different config knobs
      const isMobile = mode === 'mobile';

      return {
        create,
        // VS Code-ish “blocky” look works well in a tiny view
        displayText: 'blocks',
        // For desktop you might prefer "mouse-over", for mobile always-on
        showOverlay: isMobile ? 'always' : 'mouse-over',
        // Leave gutters empty for now; you can feed git info later if you want
        gutters: [],
      };
    });

    extensions = [minimapExt];
  }

  this.editor.dispatch({
    effects: this.minimapCompartment.reconfigure(extensions),
  });
}
```

This is exactly how the official example wires `showMinimap.compute`, just wrapped in a Compartment so you can reconfigure it on the fly. ([GitHub][1])

**Key points:**

* **Single extension**; three modes:

  * `"desktop"` → sidebar-style minimap
  * `"mobile"` → overlay-style minimap
  * `"off"` → no minimap
* Orientation-specific behavior is handled entirely via:

  * The mode string passed in
  * CSS classes on the minimap container

No second “version” of the extension is needed.

---

## 3. Python wrapper in `codemirror.py`

Same pattern as `set_zebra_stripes()` and `set_diff_decorations()`.

Edit: `app/static/vendor/nicegui/elements/codemirror/codemirror.py`

Add:

```python
class CodeMirror(Element):
    # ... existing methods ...

    def set_minimap_mode(self, mode: str) -> None:
        """Set minimap mode: 'desktop', 'mobile', or 'off'."""
        # Defensive normalize
        if mode not in ('desktop', 'mobile', 'off'):
            mode = 'off'
        self.run_method('applyMinimapMode', mode)
```

Now the NiceGUI side has a clean API like your other editor features.

---

## 4. Backend endpoint to drive the mode

Pattern: like your search panel example – endpoint in `editor_app.py` that calls the Python wrapper. 

Edit: `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

Somewhere near the other `/editor/...` routes:

```python
from fastapi import Body, HTTPException

# Assume you already have a way to get the current editor instance
# (you use this for zebra stripes, diffs, etc.)
# e.g. _editor_instance / get_editor_instance()

@app.post('/editor/minimap/mode')
async def editor_minimap_mode(data: dict = Body(...)):
    """Set the minimap mode for the current editor."""
    mode = data.get('mode', 'off')
    editor = _editor_instance  # or get_editor_instance()
    if not editor:
        raise HTTPException(status_code=404, detail='Editor not initialized')
    try:
        editor.set_minimap_mode(mode)
        return {'ok': True, 'mode': mode}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Failed to set minimap mode: {e}')
```

No disk persistence here – this is a **pure view concern**, unlike your preferences store. That keeps it consistent with your “backend as ground truth, frontend ephemeral” design.

---

## 5. Hook it to your breakpoints in `main.js`

Your outer app shell already has breakpoint logic for “mobile” vs “desktop” layout. You just need to mirror that into a minimap mode call, using your existing `apiPost()` helper.

Edit: `app/apps/file_editor_cm6/main.js`

Add something like:

```javascript
let lastMinimapMode = null;

function detectMinimapMode() {
  // Use the same breakpoint you use for your mobile layout
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  return isMobile ? 'mobile' : 'desktop';
}

async function syncMinimapMode() {
  const mode = detectMinimapMode();
  if (mode === lastMinimapMode) return;
  lastMinimapMode = mode;

  try {
    await apiPost('editor/minimap/mode', {
      mode,
      // optional, if you want path/project for logging or future use:
      path: currentPath || null,
      project: cachedProjectRoot || null,
    });
  } catch (err) {
    console.warn('[Code CM6] Failed to set minimap mode:', err);
  }
}

// On initial load
window.addEventListener('load', () => {
  syncMinimapMode();
});

// On resize / orientation change
window.addEventListener('resize', debounce(syncMinimapMode, 250));
window.matchMedia('(orientation: portrait)').addEventListener('change', syncMinimapMode);
```

This keeps the **decision** about “mobile vs desktop” in the outer app (where your breakpoints already live), and the **implementation** of the minimap entirely inside the vendored CM6 component.

---

## 6. CSS: make desktop vs mobile behave differently

Last piece: mode-specific styling. You’ve already done this kind of thing for diff gutter and indentation guides by adding CSS in the NiceGUI editor template.

Wherever you define CM6-specific CSS for Code CM6 (often in the `editor_app.py` template or a linked stylesheet), add:

```css
/* Base minimap container */
.cm-editor .cm-minimap-container {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  pointer-events: auto;
  z-index: 5;        /* Above code, below overlays */
}

/* Desktop: classic slim sidebar scrollbar */
.cm-editor .cm-minimap-desktop {
  width: 0.9rem;     /* Adjust to taste */
  opacity: 0.9;
}

/* Mobile: semi-transparent overlay “preview” on the right */
.cm-editor .cm-minimap-mobile {
  width: 30%;        /* Take a chunk of the right side */
  opacity: 0.35;
  pointer-events: none;  /* Let touches go through to the main editor */
}

/* You can also hide desktop style when really narrow, if you ever send mode=desktop on a phone */
@media (max-width: 600px) {
  .cm-editor .cm-minimap-desktop {
    display: none;
  }
}
```

Because the minimap DOM node gets both `cm-minimap-container` and `cm-minimap-${mode}`, swapping mode is just a class change via the extension reconfigure.

---

## 7. How this fits your architecture (and answers your question)

* You **do not** need separate “mobile minimap” and “desktop minimap” extensions.
* You **do** need:

  * One vendored CM extension (`showMinimap`) wired via `src/index.mjs` → `CM.showMinimap`
  * One Vue method `applyMinimapMode(mode)` using a Compartment
  * One Python wrapper `set_minimap_mode(mode)`
  * One endpoint `/editor/minimap/mode`
  * A tiny bit of breakpoint wiring in `main.js` + some CSS

That’s exactly the same pattern you already use for zebra stripes, diff decorations, indentation guides, and the search panel: new CM package → export through bundle → JS method on component → Python wrapper → endpoint → front-end call.

So you weren’t overcomplicating it – you just don’t need to fork the extension; you only need a **mode switch** on top of the single minimap extension.

[1]: https://github.com/replit/codemirror-minimap?utm_source=chatgpt.com "Minimap extension for Codemirror 6"
