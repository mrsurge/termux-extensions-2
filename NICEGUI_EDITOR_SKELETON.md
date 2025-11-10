# NiceGUI Editor Integration - Initial Skeleton

**Date:** 2025-11-10
**Status:** Skeleton Created ✓

## What Was Done

### 1. Created NiceGUI Editor Sub-App
- **Location:** `app/apps/file_editor_cm6/nicegui_editor/`
- **Files:**
  - `__init__.py` - Package exports
  - `editor_app.py` - Basic NiceGUI editor with postMessage bridge

### 2. Integrated into Main App
- **Modified:** `app/apps/file_editor_cm6/main.py`
  - Imported `create_nicegui_editor_app`
  - Mounted NiceGUI app at `/apps/file_editor_cm6/editor/`

### 3. Replaced CM6 with Iframe
- **Modified:** `app/apps/file_editor_cm6/template.html`
  - Replaced `<div id="cm6-host">` with `<iframe id="editor-frame">`
  - Iframe loads from `/apps/file_editor_cm6/editor/`

### 4. Streamlined Host Bridge
- **Modified:** `app/apps/file_editor_cm6/main.js`
  - Removed CM6 initialization (backed up to `main.js.cm6backup`)
  - Added postMessage bridge for iframe communication
  - Kept essential: explorer, terminal, agent drawer, git menu
  - Simplified to ~270 lines (from 1875)

## Current Skeleton Features

### NiceGUI Editor (Guest)
- Basic textarea placeholder editor
- Header bar with status indicator
- Status bar with file info
- PostMessage listener for:
  - `open_file` - Receive file content
  - `set_theme` - Theme changes
  - `reload_content` - External updates
- PostMessage sender:
  - `editor_ready` - Signals initialization
  - `content_changed` - Unsaved state
  - `save_requested` - User wants to save

### Host App
- Iframe container in editor area
- PostMessage bridge to communicate with editor
- Preserved UI: explorer, terminal, agent, git, menus
- Basic file operations: `openFile()`, `saveFile()`
- Hooks: `window.appOpenFile()` for explorer clicks

## Communication Flow

```
Explorer Click → Host (main.js)
  ↓
  openFile(path)
  ↓
  apiGet('read?path=...') → Backend
  ↓
  sendToEditor('open_file', { path, content, sha256 })
  ↓
  Iframe (NiceGUI) receives message
  ↓
  Updates editor content
  ↓
  User edits → notifyHost('content_changed', { unsaved: true })
  ↓
  Host updates UI (filename indicator)
```

## Next Steps

1. **Test basic load** - Start the app and verify iframe loads
2. **Implement actual editor** - Replace textarea with proper code editor (Monaco/CodeMirror)
3. **Wire up save** - Connect save button/shortcut to postMessage → host → backend
4. **Add theme support** - Pass theme preference from host to iframe
5. **Implement language modes** - Detect file type and set syntax highlighting
6. **Add WebSocket sync** - External file changes → host → iframe reload
7. **Menu integration** - Save/Open/etc menus trigger iframe actions
8. **Keyboard shortcuts** - Propagate Ctrl+S, etc. through iframe
9. **Mobile selection** - Adapt native selection for iframe context

## Files Modified
- ✓ `app/apps/file_editor_cm6/nicegui_editor/__init__.py` (new)
- ✓ `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (new)
- ✓ `app/apps/file_editor_cm6/main.py` (modified)
- ✓ `app/apps/file_editor_cm6/template.html` (modified)
- ✓ `app/apps/file_editor_cm6/main.js` (replaced, backup at main.js.cm6backup)

## Testing
- ✓ Import test passed
- ⏳ Browser test pending
- ⏳ File open/save test pending
- ⏳ Cross-frame communication test pending

---

**Ready for initial browser test!**
