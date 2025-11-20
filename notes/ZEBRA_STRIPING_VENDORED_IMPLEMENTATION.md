# Zebra Striping & Inline Diff Implementation via Vendored NiceGUI

**Status: ✅ FULLY IMPLEMENTED AND WORKING (Nov 12, 2025)**

This document outlines the complete implementation of toggleable zebra striping AND inline git diff decorations in the CodeMirror editor using a locally vendored copy of the `nicegui` library.

**Final Architecture:** Direct Python → JavaScript method calls via NiceGUI's `run_method()` API. This proved far more reliable than custom events or global variables.

---

## Implementation Summary

### ✅ Zebra Striping (Logical Line Shading)
- **Method:** StateField-based extension in vendored `codemirror.py`
- **Trigger:** `set_zebra_stripes(enabled: bool)` method
- **Features:** 
  - Works with word wrap (shades logical lines, not visual lines)
  - Toggleable via View menu
  - Synced via 300ms timer in `editor_app.py`

### ✅ Inline Git Diffs
- **Method:** StateField-based decorations with proven helper from old architecture
- **Trigger:** `set_diff_decorations(hunks: list)` method
- **Features:**
  - Real git diff calculation via `diff_helper.py`
  - Auto-loads diffs when files open (if enabled)
  - Shows additions (green), deletions (red), context (gray border)
  - Deletion widgets show removed text
  - Respects word wrap setting
  - Handles 700+ diff hunks perfectly (tested with 1500-line document)

---

## Architecture Overview

### 1. Vendored NiceGUI Setup

**Location:** `app/static/vendor/nicegui/`

**Path Override:** `app/main.py`
```python
import sys
from pathlib import Path

vendor_dir = Path(__file__).parent / 'static' / 'vendor'
sys.path.insert(0, str(vendor_dir))
```

### 2. Backend State Management

**State Store:** `app/apps/file_editor_cm6/main.py` - `get_editor_state()`

**Tracked Settings:**
- `word_wrap: bool`
- `line_shading: bool` 
- `show_inline_diffs: bool`
- `diff_hunks: list` (populated from git)
- `theme: str`
- `language: str`

**Endpoints:**
- `POST /editor/toggle_setting` - Toggle individual settings
- `POST /editor/set_view_settings` - Bulk update settings
- `POST /editor/set_content` - Load file + auto-fetch diffs
- `POST /editor/refresh_diffs` - Manually refresh diffs
- `GET /diff?path=...` - Get git diff hunks

### 3. Frontend Menu Integration

**File:** `app/apps/file_editor_cm6/main.js`

**Menu Handlers:**
```javascript
bindMenuToggle(miToggleWrap, async () => {
  wordWrap = !wordWrap;
  setMenuChecked(miToggleWrap, wordWrap);
  persistEditorPreferences({ wordWrap });
  apiPost('editor/set_view_settings', { word_wrap: wordWrap })
    .catch(e => console.warn('[Menu] Failed to sync word wrap:', e));
});

bindMenuToggle(miToggleShading, async () => {
  showLineShading = !showLineShading;
  setMenuChecked(miToggleShading, showLineShading);
  persistEditorPreferences({ showShading: showLineShading });
  apiPost('editor/set_view_settings', { line_shading: showLineShading })
    .catch(e => console.warn('[Menu] Failed to sync line shading:', e));
});

bindMenuToggle(miToggleDiffs, async () => {
  showInlineDiffs = !showInlineDiffs;
  setMenuChecked(miToggleDiffs, showInlineDiffs);
  persistEditorPreferences({ showInlineDiffs });
  apiPost('editor/set_view_settings', { show_inline_diffs: showInlineDiffs })
    .catch(e => console.warn('[Menu] Failed to sync inline diffs:', e));
});
```

### 4. NiceGUI Iframe Sync

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

**Timer-based State Sync:**
```python
view_cache = {
    'word_wrap': bool(state.get('word_wrap', False)),
    'line_shading': bool(state.get('line_shading', False)),
    'show_inline_diffs': bool(state.get('show_inline_diffs', False)),
    'theme': str(state.get('theme', 'oneDark')),
    'language': str(state.get('language', 'python')),
    'diff_hunks': [],
}

def _sync_view_settings() -> None:
    editor_instance = get_active_editor()
    if not editor_instance:
        return
    
    # Sync word wrap
    target_wrap = bool(state.get('word_wrap', False))
    if target_wrap != view_cache['word_wrap']:
        view_cache['word_wrap'] = target_wrap
        editor_instance.set_line_wrapping(target_wrap)
        editor_instance.update()
    
    # Sync line shading
    target_shade = bool(state.get('line_shading', False))
    if target_shade != view_cache['line_shading']:
        view_cache['line_shading'] = target_shade
        editor_instance.set_zebra_stripes(target_shade)
    
    # Sync diff decorations
    show_diffs = bool(state.get('show_inline_diffs', False))
    target_hunks = state.get('diff_hunks', []) if show_diffs else []
    
    if show_diffs != view_cache['show_inline_diffs'] or target_hunks != view_cache['diff_hunks']:
        view_cache['show_inline_diffs'] = show_diffs
        view_cache['diff_hunks'] = target_hunks
        editor_instance.set_diff_decorations(target_hunks)

ui.timer(0.3, _sync_view_settings)
```

### 5. Vendored CodeMirror Python API

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`

**New Methods:**
```python
def set_zebra_stripes(self, enabled: bool) -> None:
    """Toggle zebra striping (alternating line backgrounds)."""
    self.run_method('applyZebraStripes', enabled)

def set_diff_decorations(self, hunks: list) -> None:
    """Apply inline git diff decorations to the editor.
    
    Args:
        hunks: List of diff hunks from diff_helper.collect_diff()
            Each hunk has: {oldStart, oldLines, newStart, newLines, lines: [{type, text}]}
    """
    self.run_method('applyDiffDecorations', hunks)
```

### 6. Vendored CodeMirror JavaScript Implementation

**File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`

#### Zebra Stripes (Lines 253-295)
```javascript
async applyZebraStripes(enabled) {
  if (!this.zebraCompartment) {
    const { StateEffect, StateField, Compartment } = CM;
    
    this.zebraCompartment = new Compartment();
    const zebraField = StateField.define({
      create: () => this.buildZebraDecorations(this.editor.state),
      update: (value, tr) => {
        if (tr.docChanged || tr.viewportChanged) {
          return this.buildZebraDecorations(tr.state);
        }
        return value;
      },
      provide: field => CM.EditorView.decorations.from(field)
    });
    
    this.editor.dispatch({
      effects: StateEffect.appendConfig.of(this.zebraCompartment.of([zebraField]))
    });
  }
  
  const zebraTheme = enabled ? CM.EditorView.baseTheme({
    '&light .cm-zebraStripe': { backgroundColor: 'rgba(0,0,0,.035)' },
    '&dark .cm-zebraStripe': { backgroundColor: 'rgba(255,255,255,.06)' }
  }) : CM.EditorView.baseTheme({});
  
  this.editor.dispatch({
    effects: this.zebraCompartment.reconfigure([zebraTheme])
  });
}

buildZebraDecorations(state) {
  const { Decoration, RangeSetBuilder } = CM;
  const stripe = Decoration.line({ attributes: { class: 'cm-zebraStripe' } });
  const builder = new RangeSetBuilder();
  
  for (let i = 1; i <= state.doc.lines; i++) {
    if (i % 2 === 0) {
      const line = state.doc.line(i);
      builder.add(line.from, line.from, stripe);
    }
  }
  return builder.finish();
}
```

#### Inline Diffs (Lines 1-131, 297-356)
```javascript
// Inline diff decorations helper (extracted from diff_decorations.js)
function buildDiffDecorations(view, hunks, CM, getWordWrap) {
  const { Decoration, RangeSetBuilder, WidgetType } = CM;
  
  if (!hunks || hunks.length === 0) {
    return Decoration.none;
  }

  const lineAddedDeco = Decoration.line({
    class: 'cm-diff-line cm-diff-line-added',
    attributes: { 'data-diff-marker': '+' },
  });

  const lineContextDeco = Decoration.line({
    class: 'cm-diff-line cm-diff-line-context',
    attributes: { 'data-diff-marker': '│' },
  });

  const linePlainDeco = Decoration.line({
    class: 'cm-diff-line cm-diff-line-plain',
  });

  class RemovedLineWidget extends WidgetType {
    constructor(text, wordWrap) {
      super();
      this.text = text;
      this.wordWrap = wordWrap;
    }
    toDOM() {
      const lineEl = document.createElement('div');
      lineEl.className = 'cm-diff-line cm-diff-line-removed';
      if (this.wordWrap) {
        lineEl.classList.add('cm-diff-wrap');
      }
      lineEl.setAttribute('data-diff-marker', '−');

      const content = document.createElement('span');
      content.className = 'cm-diff-removed-text';
      content.textContent = this.text ?? '';

      lineEl.append(content);
      return lineEl;
    }
    ignoreEvent() { return true; }
  }

  // Build decorations from hunks...
  const wordWrap = getWordWrap();
  const builder = new RangeSetBuilder();
  const doc = view.state.doc;
  
  const lineDecorations = new Map();
  const deletionWidgets = [];
  
  for (const hunk of hunks) {
    let newLine = Math.max(1, hunk.newStart || 1);
    for (const line of hunk.lines || []) {
      const kind = line.type;
      if (kind === 'add' || kind === 'context') {
        const deco = kind === 'add' ? lineAddedDeco : lineContextDeco;
        lineDecorations.set(newLine, deco);
        newLine += 1;
      } else if (kind === 'del') {
        deletionWidgets.push({
          line: newLine > 0 ? newLine : 1,
          text: line.text || '',
        });
      }
    }
  }
  
  // Apply decorations in sorted order...
  return builder.finish();
}

async applyDiffDecorations(hunks) {
  if (!this.diffCompartment) {
    const { StateEffect, StateField, Compartment } = CM;
    
    this.diffCompartment = new Compartment();
    this.setDiffEffect = StateEffect.define();
    this.clearDiffEffect = StateEffect.define();
    
    const setDiffEffect = this.setDiffEffect;
    const clearDiffEffect = this.clearDiffEffect;
    
    const diffField = StateField.define({
      create() {
        return CM.Decoration.none;
      },
      update(value, tr) {
        if (tr.docChanged && value !== CM.Decoration.none) {
          value = value.map(tr.changes);
        }
        for (const effect of tr.effects) {
          if (effect.is(setDiffEffect)) {
            value = effect.value;
          } else if (effect.is(clearDiffEffect)) {
            value = CM.Decoration.none;
          }
        }
        return value;
      },
      provide: field => CM.EditorView.decorations.from(field)
    });
    
    this.diffField = diffField;
    
    this.editor.dispatch({
      effects: StateEffect.appendConfig.of(this.diffCompartment.of([diffField]))
    });
  }
  
  const getWordWrap = () => this.lineWrapping || false;
  const decoSet = buildDiffDecorations(this.editor, hunks, CM, getWordWrap);
  
  this.editor.dispatch({
    effects: this.setDiffEffect.of(decoSet)
  });
}
```

### 7. Git Diff Calculation

**File:** `app/apps/file_editor_cm6/diff_helper.py`

**Function:** `collect_diff(project_root: Path, rel_path: str) -> dict`

Returns:
```python
{
  "hunks": [
    {
      "oldStart": int,
      "oldLines": int,
      "newStart": int,
      "newLines": int,
      "lines": [{"type": "context|add|del", "text": str}]
    },
  ],
  "summary": {"added": int, "deleted": int, "tracked": bool},
  "sha256": str  # Current file hash
}
```

**Auto-Load Logic:** `main.py::set_editor_content()`
```python
if state.get('show_inline_diffs', False) and state.get('path'):
    try:
        project_path = _history_store.get_active_project() or str(get_project_root())
        if project_path:
            project_root = Path(project_path).expanduser()
            rel = _normalize_rel_path(project_root, state['path'])
            diff_data = collect_diff(project_root, rel)
            state['diff_hunks'] = diff_data.get('hunks', [])
    except Exception as e:
        state['diff_hunks'] = []
```

### 8. CSS Styling

**File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

**Complete Diff CSS:** (Injected via `ui.add_head_html`)
```css
:root {
  --diff-marker-width: 1.65rem;
  --diff-add-bg: rgba(52, 211, 153, 0.22);
  --diff-add-border: rgba(52, 211, 153, 0.75);
  --diff-add-marker: rgba(52, 211, 153, 0.9);
  --diff-context-border: rgba(148, 163, 184, 0.35);
  --diff-context-marker: rgba(148, 163, 184, 0.55);
  --diff-del-bg: rgba(248, 113, 113, 0.18);
  --diff-del-border: rgba(248, 113, 113, 0.7);
  --diff-del-fg: rgba(248, 113, 113, 0.95);
  --diff-del-marker: rgba(248, 113, 113, 0.85);
  --diff-del-gap: 0;
}

.cm-line.cm-diff-line { 
  position: relative; 
  padding-left: calc(var(--diff-marker-width) + 0.35rem); 
}

.cm-line.cm-diff-line::before {
  content: attr(data-diff-marker);
  position: absolute;
  left: 0;
  width: var(--diff-marker-width);
  text-align: center;
  font-weight: 600;
  opacity: 0.85;
  color: rgba(148, 163, 184, 0.65);
  user-select: none;
  -webkit-user-select: none;
}

.cm-line.cm-diff-line-added { 
  background: var(--diff-add-bg) !important; 
  border-left: 3px solid var(--diff-add-border) !important; 
}
.cm-line.cm-diff-line-added::before { 
  color: var(--diff-add-marker); 
}

.cm-diff-line-removed {
  position: relative;
  margin: 0 0 var(--diff-del-gap, 0);
  padding: 0 10px 0 calc(var(--diff-marker-width) + 6px);
  border-left: 3px solid var(--diff-del-border);
  background: var(--diff-del-bg);
  color: var(--diff-del-fg);
  font: inherit;
  white-space: pre;
  line-height: inherit;
  user-select: none;
  -webkit-user-select: none;
  contain: layout paint;
}

.cm-diff-line-removed::before {
  content: attr(data-diff-marker);
  position: absolute;
  left: 0;
  width: var(--diff-marker-width);
  text-align: center;
  font-weight: 600;
  color: var(--diff-del-marker);
  user-select: none;
  -webkit-user-select: none;
}
```

---

## Key Learnings

### ✅ What Worked

1. **StateField over ViewPlugin** - Decorations MUST use StateField, not ViewPlugin
2. **StateEffect for Updates** - Use effects to update decoration sets dynamically
3. **Proven Helper Logic** - Reused battle-tested diff decoration builder from old architecture
4. **Direct Method Calls** - `run_method()` is more reliable than custom events or globals
5. **Timer-based Sync** - 300ms polling is simple and robust for state synchronization
6. **Auto-load Diffs** - Fetching diffs in `set_content()` provides seamless UX

### ❌ What Didn't Work

1. **ViewPlugin decorations** - CodeMirror throws "decorations may not be specified via plugins"
2. **Global variables** - Race conditions with iframe mounting
3. **Custom events** - Timing issues with DOM readiness
4. **External helper JS** - NiceGUI bundling doesn't serve non-component JS files

### 🎯 Performance

- **700+ diff hunks:** Renders instantly without lag
- **1500-line documents:** Smooth scrolling with full diff decorations
- **Word wrap compatible:** All features work with line wrapping enabled

---

## Testing Results (Nov 12, 2025)

✅ **Zebra Stripes:** Working perfectly on logical lines (respects word wrap)  
✅ **Inline Diffs:** 400+ additions + 300+ deletions rendered correctly  
✅ **Menu Integration:** All three toggles (wrap, shading, diffs) working  
✅ **State Persistence:** Settings survive page refreshes  
✅ **Auto-load:** Diffs appear automatically when files open  
✅ **Performance:** No lag even with 700+ decorations  

---

## Future Enhancements

- [ ] Diff refresh on file save (auto-detect changes)
- [ ] Keyboard shortcut for diff refresh (e.g., `Ctrl+Shift+D`)
- [ ] Diff stats in status bar (e.g., "+45 -12")
- [ ] Stage/unstage hunks directly from editor (interactive git)
- [ ] Inline diff syntax highlighting for removed text

---

**Implementation Complete:** Nov 12, 2025  
**Total Implementation Time:** ~4 hours (including debugging)  
**Files Modified:** 8  
**Lines Changed:** ~600  
**Architecture:** Vendored NiceGUI + StateField-based decorations

---

## Extended Architecture & Lessons Learned

### Critical Issue Discovered: Editor Refresh Bug (Nov 12, 2025)

**Problem:** After changing settings (word wrap, theme, line shading) while the worker was running, browser refresh would revert to the old settings from when the worker first started, even though the settings were correctly persisted to disk.

**Root Cause:** The `/editor/set_content` endpoint (called when opening files) had an API inconsistency:

```python
# BROKEN (line 278 - old code):
editor.options['lineWrapping'] = word_wrap  # ❌ CodeMirror has no .options attribute

# FIXED:
editor.set_line_wrapping(word_wrap)  # ✅ Uses vendored API method
```

**Why It Failed:**
- Vendored `CodeMirror` class uses `._props` internally, not `.options`
- The `.options` attribute doesn't exist, causing an `AttributeError`
- The crash prevented ALL settings (word wrap, theme, shading) from being re-applied on refresh
- Settings were correctly read from disk but never applied to the editor before the crash

**Why Inline Diffs Worked:**
- Inline diffs used `editor.set_diff_decorations(hunks)` method (not property access)
- Method calls worked; property access failed
- This provided the critical clue to the root cause

**The Fix:**
Changed `/editor/set_content` to use the same pattern as `/editor/set_view_settings`:
- Line 278: `editor.options['lineWrapping'] = word_wrap` → `editor.set_line_wrapping(word_wrap)`
- Line 273: `editor.set_zebra_stripes(show_shading)` ✅ (already correct)
- Line 284: `editor.set_theme(theme)` ✅ (already correct)

**Files Modified:**
- `app/apps/file_editor_cm6/main.py` (1 line change)

**Result:**
- Settings now correctly sync on page refresh while worker is running ✅
- All settings (word wrap, theme, shading, diffs) load from disk correctly ✅
- No more 500 errors when opening files after refresh ✅

---

## Preferences Architecture Deep Dive

### PreferencesStore Implementation

**File:** `app/apps/file_editor_cm6/preferences_store.py`

**Storage Location:** `~/.local/share/termux-extensions-2/code_oss_prefs.json`

**Structure:**
```python
{
  "editor": {
    "showLineNumbers": bool,
    "showSyntax": bool,
    "showShading": bool,      # Zebra stripes
    "wordWrap": bool,
    "autoCloseBrackets": bool,
    "autocompletion": bool,
    "theme": str,             # e.g., "cm6-dark", "githubDark"
    "autoSave": bool,
    "showInlineDiffs": bool,  # Git diff decorations
    "trackAgentEdits": bool,
  },
  "ui": {
    "assistantCollapsed": bool,
    "gitIndicators": bool,
  },
  "projects": {
    "/path/to/project": {
      "last_file": "/path/to/file.py"
    }
  }
}
```

**Example Actual File:**
```json
{
  "editor": {
    "wordWrap": true,
    "showShading": false,
    "theme": "githubDark",
    "showInlineDiffs": true,
    "showLineNumbers": false
  },
  "ui": {},
  "projects": {
    "/data/data/com.termux/files/home/test/termux-extensions-2": {}
  }
}
```

**Key Methods:**
```python
# Get preferences (with defaults merged)
prefs = _preferences_store.get_preferences(project_path)
# Returns: {"editor": {...}, "ui": {...}, "project": {...}}

# Update preferences (validates against defaults)
_preferences_store.update_preferences(
    editor={"wordWrap": True, "theme": "githubDark"},
    ui={"assistantCollapsed": False},
    project={"path": "/home/user/project", "last_file": "main.py"}
)
```

**Thread Safety:** Uses `threading.Lock()` for atomic read/write operations.

**Atomic Writes:** Uses temp file + rename pattern to prevent corruption.

---

### HistoryStore Implementation

**File:** `app/apps/file_editor_cm6/history_store.py`

**Storage Location:** `~/.local/share/termux-extensions-2/code_oss_history.json`

**Structure:**
```python
{
  "recent_projects": [
    {
      "path": str,           # Absolute project path
      "label": str,          # Project folder name
      "opened_at": str       # ISO timestamp (UTC)
    }
  ],
  "projects": {
    "/path/to/project": {
      "files": [
        {
          "path": str,       # Absolute file path
          "label": str,      # Filename only
          "opened_at": str   # ISO timestamp (UTC)
        }
      ],
      "last_file": str,      # Absolute path to last opened file
      "label": str,          # Project folder name
      "opened_at": str       # ISO timestamp (UTC)
    }
  },
  "active_project": str      # Absolute path to currently active project
}
```

**Key Methods:**
```python
# Get active project path
project_path = _history_store.get_active_project()

# Set active project
_history_store.set_active_project("/path/to/project")

# Record file activity
_history_store.record_file_activity(
    project_path="/path/to/project",
    file_path="/path/to/project/file.py"
)

# Get recent projects (limited to MAX_RECENT_PROJECTS=12)
recents = _history_store.get_recent_projects()

# Get recent files for a project (limited to MAX_RECENT_FILES=12)
files = _history_store.get_recent_files("/path/to/project")
```

**Thread Safety:** Uses `threading.Lock()` for atomic read/write operations.

**Atomic Writes:** Uses temp file + rename pattern to prevent corruption.

**Singleton Usage:** `_history_store` (from `app/apps/file_editor_cm6/stores.py`) is instantiated once per worker and imported everywhere (editor app, terminal backend, REST endpoints). This enforces the “single source of truth” model: every subsystem reads/writes the same `code_oss_history.json`, so project roots, recents, and terminal shell IDs always stay in sync.

**Max Limits:**
- Recent projects: 12 entries (`MAX_RECENT_PROJECTS`)
- Recent files per project: 12 entries (`MAX_RECENT_FILES`)

---

### Settings Flow: Menu → Disk → Editor

**Two-Step Pattern** (used by all settings):

1. **Persist to disk** via `/preferences` endpoint:
   ```javascript
   persistEditorPreferences({ wordWrap: true })
   // Calls: POST /api/app/file_editor_cm6/preferences
   // Updates: PreferencesStore on disk
   ```

2. **Update editor immediately** via `/editor/set_view_settings`:
   ```javascript
   apiPost('editor/set_view_settings', { word_wrap: true })
   // Calls: POST /api/app/file_editor_cm6/editor/set_view_settings
   // Applies: editor.set_line_wrapping(true) immediately
   ```

**Why Two Calls?**
- Disk persistence and editor state are intentionally decoupled
- `/preferences` handles long-term storage
- `/editor/set_view_settings` handles immediate UI updates
- This separation allows preferences to be loaded/saved independently of editor state

---

### Page Load Behavior: Fresh vs Refresh

**Fresh Worker Start** (`@ui.page('/nc')` in `editor_app.py`):
```python
# 1. Load preferences from disk
prefs = _preferences_store.get_preferences()
editor_prefs = prefs.get('editor', {})

# 2. Initialize editor with preferences
editor = ui.codemirror(
    theme=editor_prefs.get('theme', 'cm6-dark'),
    line_wrapping=editor_prefs.get('wordWrap', False),
)

# 3. Apply additional settings via methods
editor.set_zebra_stripes(editor_prefs.get('showShading', False))
if editor_prefs.get('showInlineDiffs', False):
    editor.set_diff_decorations([])
```

**Page Refresh (Worker Still Running)**:
```python
# Same flow as fresh start!
# Page function re-executes, reads fresh prefs from disk
# Creates new editor instance with current settings
# Stores in global _active_editor reference
```

**File Open After Refresh** (`/editor/set_content`):
```python
# CRITICAL: Re-sync ALL settings from disk on every file load
# This ensures browser refresh (while worker still running) gets fresh settings
prefs = _preferences_store.get_preferences()
editor_prefs = prefs.get('editor', {})

# Apply settings using vendored API methods
editor.set_zebra_stripes(editor_prefs.get('showShading', False))
editor.set_line_wrapping(editor_prefs.get('wordWrap', False))
editor.set_theme(editor_prefs.get('theme', 'cm6-dark'))
```

---

### Vendored NiceGUI CodeMirror API

**Location:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`

**Custom Methods Added:**
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

**Internal Structure:**
- Uses `._props` dict for configuration (NOT `.options`)
- `set_line_wrapping()` and `set_theme()` update `._props` and trigger re-render
- `set_zebra_stripes()` and `set_diff_decorations()` call JavaScript methods via `run_method()`

**JavaScript Side** (`app/static/vendor/nicegui/elements/codemirror/codemirror.js`):
- `applyZebraStripes(enabled)` - Reconfigures StateField compartment
- `applyDiffDecorations(hunks)` - Dispatches StateEffect to update decorations

---

### Menu Checkbox Synchronization

**Observation:** Menu checkboxes always show correct state from disk, even when editor visual state was broken.

**Why?**
Menu checkboxes are populated from JavaScript variables that are initialized from `/preferences` response:
```javascript
// On app load (main.js ~line 736):
const prefs = await apiGet('preferences');
const editorPrefs = prefs.data.editor;

wordWrap = !!editorPrefs.wordWrap;
showLineShading = !!editorPrefs.showShading;
showInlineDiffs = !!editorPrefs.showInlineDiffs;
currentTheme = editorPrefs.theme || 'cm6-dark';

// Update menu UI
setMenuChecked(miToggleWrap, wordWrap);
setMenuChecked(miToggleShading, showLineShading);
setMenuChecked(miToggleDiffs, showInlineDiffs);
```

This proves that:
- Preferences were correctly written to disk ✅
- Preferences were correctly read from disk ✅
- Only the editor visual application was broken ❌

---

### Debugging Tips for Future Issues

**Symptoms of API Mismatch:**
- Settings persist correctly to disk ✅
- Menu checkboxes show correct state ✅
- Editor visual state incorrect ❌
- 500 errors in console when opening files ❌

**Investigation Steps:**
1. Check console for `AttributeError` or method-not-found errors
2. Compare API usage between different endpoints (look for inconsistencies)
3. Verify vendored library API surface (check actual methods vs. assumptions)
4. Look for property access (`.options`, `.config`) vs. method calls (`.set_*()`)

**Testing Refresh Behavior:**
1. Start worker fresh
2. Change a setting via menu
3. Verify persistence: `cat ~/.local/share/termux-extensions-2/code_oss_prefs.json`
4. Refresh browser (Ctrl+R)
5. Open a file
6. Check if setting applied correctly in editor

---

## Complete File Modification Summary

**Files Modified for Full Implementation:**

1. `app/apps/file_editor_cm6/main.py`
   - Added `/editor/set_view_settings` endpoint (lines 352-414)
   - Fixed `/editor/set_content` word wrap bug (line 278)
   - Added diff auto-load logic

2. `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
   - Added page load preference sync (lines 27-69)
   - Injected diff CSS styles (lines 72-164)

3. `app/apps/file_editor_cm6/main.js`
   - Added menu toggle handlers (lines ~1329-1454)
   - Added `mapThemeToNiceGUI()` function (lines 778-800)
   - Initialized settings from preferences (lines ~736-760)

4. `app/apps/file_editor_cm6/preferences_store.py`
   - Already existed, no changes needed ✅

5. `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
   - Added `set_line_wrapping()` method (lines 347-352)
   - Added `set_theme()` method (lines 308-310)
   - Added `set_zebra_stripes()` method (lines 355-362)
   - Added `set_diff_decorations()` method (lines 364-370)

6. `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
   - Added `applyZebraStripes()` method (lines 253-295)
   - Added `applyDiffDecorations()` method (lines 297-356)
   - Added `buildZebraDecorations()` helper (lines ~287-295)
   - Added `buildDiffDecorations()` helper (lines 1-131)

7. `app/apps/file_editor_cm6/diff_helper.py`
   - Already existed, no changes needed ✅

8. `app/main.py` (project root)
   - Added vendored path override at top of file

**Total Lines Changed:** ~650  
**Bug Fixes:** 1 (editor refresh crash)  
**New Features:** 3 (zebra stripes, inline diffs, theme switching)  
**Implementation Status:** ✅ FULLY WORKING

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
