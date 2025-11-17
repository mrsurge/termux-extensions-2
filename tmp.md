# CM6 Indentation Guides - Implementation Plan

**Author:** Atlas  
**Date:** 2025-11-17 05:00 UTC  
**Status:** Ready for Implementation (Validated Against Codebase)

---

## Objective

Expose toggleable indentation guide lines in the NiceGUI CM6 iframe editor, respecting the iframe-guideline architecture and existing preference patterns.

---

## Step 1: Vendor the Extension

### Install Package

```bash
cd app/static/vendor/nicegui/elements/codemirror
npm install @replit/codemirror-indentation-markers
```

**Note:** Package is currently at `/data/data/com.termux/files/home/test/codemirror-indentation-markers`

### Add to Bundle Exports

Edit `src/index.mjs` and add:

```javascript
export * from "@replit/codemirror-indentation-markers";
```

Add this line after the existing exports (around line 10).

### Build Bundle

```bash
npm run build
```

This creates updated `dist/` files used by NiceGUI.

### Verify Export

```bash
grep -r "indentationMarkers" dist/
```

Should return matches showing the function is exported.

---

## Step 2: Wire Extension in codemirror.js

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

### Add Import Guard

Add near top of file (around line 6, after search extension guards):

```javascript
const indentationMarkers = typeof CM.indentationMarkers === 'function' ? CM.indentationMarkers : null;
```

### Add Method to Component

Add method to the component (follow pattern of `applyZebraStripes` around line 310):

```javascript
async applyIndentGuides(enabled) {
  // Initialize indent guides compartment on first call
  if (!this.indentCompartment) {
    if (!indentationMarkers) {
      console.warn('[CM6] indentationMarkers not available in bundle');
      return;
    }
    
    const { Compartment, StateEffect } = CM;
    
    this.indentCompartment = new Compartment();
    
    // Extension configuration
    this.indentExtensions = [
      indentationMarkers({
        highlightActiveBlock: false,
        thickness: 1,
        hideFirstIndent: false,
        markerType: 'fullScope'
      })
    ];
    
    // Install empty compartment
    this.editor.dispatch({
      effects: StateEffect.appendConfig.of(this.indentCompartment.of([]))
    });
  }
  
  // Reconfigure compartment
  const extensions = enabled ? this.indentExtensions : [];
  this.editor.dispatch({
    effects: this.indentCompartment.reconfigure(extensions)
  });
},
```

### Expose via Python API

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`

Add method (around line 370, near `set_zebra_stripes`):

```python
def set_indent_guides(self, enabled: bool) -> None:
    """Toggle indentation guide lines."""
    self.run_method('applyIndentGuides', enabled)
```

---

## Step 3: Backend Plumbing

### Add Default Preference

**File:** `app/apps/file_editor_cm6/preferences_store.py`

Add to `DEFAULT_EDITOR_PREFS` (around line 19):

```python
"showIndentGuides": False,
```

### Apply on Editor Creation

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

Add after line 360 (where other editor settings are applied):

```python
editor.set_indent_guides(editor_prefs.get('showIndentGuides', False))
```

Also add around line 541 (in file reload section):

```python
editor.set_indent_guides(editor_prefs.get('showIndentGuides', False))
```

### Add to /set_view_settings Endpoint

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

Add to `/set_view_settings` endpoint (around line 774, after `line_shading`):

```python
if 'indent_guides' in data:
    show_guides = bool(data['indent_guides'])
    editor_updates['showIndentGuides'] = show_guides
    if editor: editor.set_indent_guides(show_guides)
```

---

## Step 4: Frontend UI

### Add Menu Item

**File:** `app/apps/file_editor_cm6/template.html`

Add to View menu dropdown (after line 1363, after "Line Shading"):

```html
<div class="fe-dd-item" id="mi-toggle-indent-guides" data-checkable="true" role="menuitemcheckbox" aria-checked="false" tabindex="0"><span>Indentation Guides</span></div>
```

### Add State Variable

**File:** `app/apps/file_editor_cm6/main.js`

Add state variable (around line 200-250 with other state vars):

```javascript
let showIndentGuides = false;
```

### Add Menu Element Reference

**File:** `app/apps/file_editor_cm6/main.js`

Add after line 339 (with other menu element references):

```javascript
const miToggleIndentGuides = requireEl('#mi-toggle-indent-guides');
```

### Bind Menu Toggle

**File:** `app/apps/file_editor_cm6/main.js`

Add binding (with other `bindMenuToggle` calls, after shading toggle):

```javascript
bindMenuToggle(miToggleIndentGuides, async () => {
  showIndentGuides = !showIndentGuides;
  setMenuChecked(miToggleIndentGuides, showIndentGuides);
  persistEditorPreferences({ showIndentGuides: showIndentGuides });
  apiPost('editor/set_view_settings', { indent_guides: showIndentGuides })
    .catch(e => console.warn('[Menu] Failed to sync indent guides:', e));
});
```

### Initialize from Preferences

**File:** `app/apps/file_editor_cm6/main.js`

Find where preferences are loaded (search for `showLineShading = ` initialization) and add:

```javascript
showIndentGuides = editorPrefs.showIndentGuides ?? false;
```

Then in `applyMenuState()` function, add:

```javascript
setMenuChecked(miToggleIndentGuides, showIndentGuides);
```

---

## Step 5: Validation & Testing

### Test Checklist

- [ ] Extension loads without errors (check browser console)
- [ ] Menu item appears in View menu
- [ ] Toggle works immediately (guides appear/disappear)
- [ ] Preference persists across page reloads
- [ ] Works with Python files (space indents)
- [ ] Works with JavaScript files (tab indents)
- [ ] Works with Markdown files
- [ ] Doesn't interfere with zebra stripes when both enabled
- [ ] Doesn't interfere with inline diffs when both enabled
- [ ] Respects word wrap (guides don't break layout)

### Graceful Degradation

If bundle export fails or extension is missing:
- Console warning logged
- Feature silently disabled
- No UI errors
- Menu toggle still appears but does nothing

---

## Notes

### Theming

The `@replit/codemirror-indentation-markers` extension includes built-in theming via `EditorView.baseTheme()`. It automatically adapts to light/dark themes using CSS variables:

- `--indent-marker-bg-color`
- `--indent-marker-active-bg-color`

**No custom CSS needed** - the extension handles styling internally.

### Configuration Options

Available configuration (from package source):

```typescript
{
  hideFirstIndent?: boolean;        // Hide guides at column 0
  highlightActiveBlock?: boolean;    // Highlight current block
  thickness?: number;                // Line thickness in px
  activeThickness?: number;          // Active line thickness
  colors?: {                         // Custom colors
    light?: string;
    dark?: string;
    activeLight?: string;
    activeDark?: string;
  };
  markerType?: 'fullScope' | 'codeOnly';  // Render mode
}
```

Current plan uses conservative defaults:
- `highlightActiveBlock: false` - Keep it simple initially
- `thickness: 1` - Subtle guides
- `markerType: 'fullScope'` - Show guides for entire scope

These can be adjusted based on user feedback.

### Architecture Compliance

This implementation:
- ✅ Respects iframe isolation (no cross-boundary hacks)
- ✅ Follows stateless endpoint pattern for iframe communication
- ✅ Uses established Compartment pattern for toggleable extensions
- ✅ Matches existing zebra stripes and diff decorations patterns
- ✅ Persists preferences via application backend (ground truth)
- ✅ Frontend reflects backend state (visual representation layer)

---

## Implementation Order

Execute in this exact order:

1. **Vendor extension** (Step 1) - Ensures bundle has required exports
2. **Wire in codemirror.js** (Step 2) - Makes feature available to Python API
3. **Backend plumbing** (Step 3) - Enables preference storage and endpoints
4. **Frontend UI** (Step 4) - Exposes toggle to user
5. **Test** (Step 5) - Verify everything works

Do not skip steps or change order - each depends on the previous.

---

**Plan validated against:**
- `runtime_paths/framework_startup_to_file_editor_cm6.md`
- `docs/core/nicegui_iframe_feature_adding_guideline.md`
- Actual codebase inspection (verified patterns exist and match)

**Ready for implementation.**

---

_Atlas • 2025-11-17 05:00 UTC_
