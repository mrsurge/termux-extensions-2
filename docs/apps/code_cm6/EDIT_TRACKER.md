# Edit Tracker Feature

**Last Updated:** 2025-10-30

This document describes the **Agent Edit Tracker** feature in Code CM6, which enables real-time visual tracking of file modifications made by agents.

---

## Overview

The Edit Tracker automatically monitors file changes when terminal or agent drawer framework shells are active, and optionally jumps to the modified lines in the editor. This provides real-time visual feedback when external agents (terminal commands) or internal agents (Codex/Gemini) modify files.

---

## Architecture

### Backend (`edit_tracker.py`)

**Core Module:** `app/apps/file_editor_cm6/edit_tracker.py`

**Key Functions:**
- `register_shell_watcher(shell_id, shell_type)` - Register a terminal/agent shell for tracking
- `unregister_shell_watcher(shell_id)` - Unregister a shell
- `on_file_modified(path)` - Triggered by watchdog, extracts line numbers from git diff
- `subscribe(callback)` - Subscribe to edit tracking events
- `get_tracking_status()` - Get current tracking status

**State Tracking:**
- `_active_shells`: Dict of shell_id → shell_type ('terminal' | 'agent')
- `_last_edit`: Most recent edit with path, line, timestamp, hunks
- `_subscribers`: WebSocket callbacks for event streaming

**Integration Points:**
- `terminal_backend.py` - Calls register/unregister in terminal WebSocket handler
- `agent_ws.py` - Calls register/unregister in agent WebSocket handler
- `core_read.py` - Calls `on_file_modified()` after file changes detected
- `main.py` - Provides REST endpoint and WebSocket endpoint

---

### Frontend (`main.js`)

**Key Functions:**
- `connectEditTracker()` - Opens WebSocket connection to `/ws/app/file_editor_cm6/edit_tracker`
- `disconnectEditTracker()` - Closes WebSocket connection
- `handleEditTrackerEvent(data)` - Routes incoming events
- `updateEditTrackerStatus(status)` - Updates status bar indicator
- `autoJumpToEdit(path, line)` - Opens file and scrolls to line
- `flashLine(lineNumber)` - Adds temporary highlight animation

**State:**
- `trackAgentEdits` - Boolean toggle (persisted via preferences)
- `editTrackerWS` - WebSocket connection instance
- `editTrackerStatusEl` - Status bar element showing tracking state

**Events Handled:**
- `tracking_status` - Shell registration/unregistration
- `edit_tracked` - File modification with path + line number

---

## User Interface

### View Menu Toggle

**Location:** View → Track Agent Edits

**Behavior:**
- ☐ Unchecked (default) - Feature disabled, no tracking
- ☑ Checked - Feature enabled, auto-jump active

**Persistence:** Saved via preferences API (`trackAgentEdits` key)

### Status Bar Indicator

**Location:** Right side of top menu bar, next to diff indicator

**Display:**
- Hidden when no shells active
- `🤖 Tracking (N terminal|agent)` when shells present
- Shows count and types of active shells

### Visual Feedback

**Line Flash Effect:**
- Yellow/orange highlight on jumped-to line
- 1-second fade animation
- CSS class: `.cm-edit-flash`
- Uses CodeMirror decoration system

---

## Data Flow

### Shell Registration

```
Terminal/Agent connects
    ↓
edit_tracker.register_shell_watcher(shell_id, type)
    ↓
Emit 'tracking_status' event via WebSocket
    ↓
Frontend updates status bar: "🤖 Tracking"
```

### File Modification

```
Agent modifies file on disk
    ↓
Watchdog detects change
    ↓
core_read._do_handle_fs_event()
    ↓
edit_tracker.on_file_modified(path)
    ↓
diff_helper.collect_diff() → extract line numbers
    ↓
Emit 'edit_tracked' event via WebSocket
    ↓
Frontend: autoJumpToEdit(path, line)
    ↓
Editor scrolls to line + flash highlight
```

---

## REST API

### `GET /api/app/file_editor_cm6/edit_tracker/status`

**Response:**
```json
{
  "ok": true,
  "data": {
    "active": true,
    "shells": [
      {"id": "fs_123_abc", "type": "terminal"},
      {"id": "fs_456_def", "type": "agent"}
    ],
    "last_edit": {
      "path": "/project/src/main.py",
      "rel_path": "src/main.py",
      "line": 42,
      "timestamp": 1698765432.123,
      "hunks_count": 2,
      "added": 3,
      "deleted": 1
    }
  }
}
```

---

## WebSocket API

### `WS /ws/app/file_editor_cm6/edit_tracker`

**Incoming Events:**

#### `tracking_status`
Sent when shells register/unregister or on initial connection.
```json
{
  "event": "tracking_status",
  "active": true,
  "shells": [{"id": "...", "type": "terminal"}],
  "last_edit": null
}
```

#### `edit_tracked`
Sent when a file is modified by an agent.
```json
{
  "event": "edit_tracked",
  "path": "/project/file.py",
  "rel_path": "file.py",
  "line": 15,
  "timestamp": 1698765432.123,
  "hunks_count": 1,
  "added": 2,
  "deleted": 0
}
```

---

## Implementation Details

### Line Number Extraction

Uses existing `diff_helper.collect_diff()` to parse git hunks:
- For additions: Uses `newStart` (first added line)
- For deletions: Uses `newStart` (line after deletion)
- Falls back to line 1 if no hunks available

### Debouncing

Inherits 150ms debounce from `core_read.py` watchdog system. No additional debouncing needed.

### Project Root Tracking

Edit tracker maintains reference to project root via `set_project_root()`:
- Called on module initialization
- Updated when project is opened via `/project/open`
- Required to convert absolute paths to relative for git

### Performance

**Impact:**
- Minimal - only active when shells present
- Leverages existing watchdog infrastructure
- Git diff already cached (5s TTL)
- WebSocket event overhead negligible

**Resource Usage:**
- One WebSocket connection per frontend instance
- ~200 bytes per tracking event
- No persistent background processes

---

## Testing Checklist

**Backend:**
- ✓ Module imports without errors
- ✓ `register_shell_watcher()` updates active shells
- ✓ `unregister_shell_watcher()` cleans up
- ✓ `get_tracking_status()` returns correct state

**Frontend:**
- [ ] Menu toggle appears in View menu
- [ ] Checkmark toggles on click
- [ ] Preference persists across page refresh
- [ ] WebSocket connects when enabled
- [ ] Status bar shows "🤖 Tracking" when shells active
- [ ] File opens on modification
- [ ] Editor scrolls to correct line
- [ ] Flash highlight animates correctly

**Integration:**
- [ ] Terminal shell registration triggers status update
- [ ] Agent shell registration triggers status update
- [ ] File modification by external tool triggers auto-jump
- [ ] File modification by Codex/Gemini triggers auto-jump
- [ ] Multiple shells tracked correctly
- [ ] Shell disconnect cleans up tracking

---

## Troubleshooting

**Tracking not activating:**
- Check that terminal or agent drawer shell is connected
- Verify WebSocket connection in browser console: `[EditTracker] Connected`
- Check backend logs for registration calls

**Auto-jump not working:**
- Ensure "Track Agent Edits" is checked in View menu
- Verify file is inside active project root
- Check that file is git-tracked (untracked files won't emit diffs)
- Look for `[EditTracker] Auto-jump failed` errors in console

**Status indicator not showing:**
- Verify shells are registered: `GET /api/app/file_editor_cm6/edit_tracker/status`
- Check that `editTrackerStatusEl` exists in DOM
- Ensure WebSocket is receiving `tracking_status` events

**Flash effect not visible:**
- Check that `.cm-edit-flash` CSS is loaded
- Verify CodeMirror decoration system is working
- Look for animation in browser DevTools (may be quick)

---

## Future Enhancements

1. **Configurable Auto-Jump:**
   - Option to open file but not scroll (less intrusive)
   - Delay/debounce before jumping (avoid rapid jumps)

2. **Multi-Line Highlighting:**
   - Highlight all changed lines in a hunk, not just first
   - Different colors for additions vs deletions

3. **Notification System:**
   - Toast notification when file modified
   - Option to review changes before jumping

4. **Filter by Shell Type:**
   - Only track terminal shells
   - Only track agent shells
   - Per-agent filtering (Codex only, Gemini only)

5. **Edit History:**
   - List of recent edits in sidebar
   - Click to jump to any previous edit
   - Export edit log for debugging

---

## Files Modified

**New Files:**
- `app/apps/file_editor_cm6/edit_tracker.py` (253 lines)

**Modified Files:**
- `app/apps/file_editor_cm6/terminal_backend.py` (+4 lines)
- `app/apps/file_editor_cm6/agent_ws.py` (+4 lines)
- `app/apps/file_editor_cm6/core_read.py` (+3 lines)
- `app/apps/file_editor_cm6/main.py` (+76 lines)
- `app/apps/file_editor_cm6/main.js` (+145 lines)
- `app/apps/file_editor_cm6/template.html` (+15 lines)
- `app/apps/file_editor_cm6/preferences_store.py` (+1 line)

**Total:** +501 lines added

---

**End of Documentation**
