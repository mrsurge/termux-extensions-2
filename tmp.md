# Agent Onboarding Guide - Termux Extensions 2

**Last Updated:** 2025-11-22  
**Purpose:** Quick onboarding for agents working on Termux Extensions 2 framework and apps

---

## Project Overview

**Termux Extensions 2** is a native application platform for Termux that provides mobile-optimized apps with shared infrastructure, process isolation, and multi-device convergence.

### Core Architecture

```
Supervisor (bash)
 ├─ IPC Server (Flask/sync) :9123
 │  └─ Sequential operations, shutdown orchestration
 │
 └─ Framework Main (FastAPI/async) :8088
     ├─ App launcher dashboard
     ├─ WebSocket proxy
     └─ App Workers (isolated subprocesses)
         ├─ file_editor_cm6 (Code CM6 - advanced editor)
         ├─ file_editor (simple text editor)
         └─ [other apps]
```

### Key Principles

1. **Backend as Ground Truth:** All state lives on disk (JSON files), no frontend caching
2. **code-server Pattern:** Disk-backed state, stateless UI clients
3. **Multi-Device Convergence:** Same backend serves desktop + mobile simultaneously
4. **Framework Shells:** Unified process management for terminals, MCP servers, daemons

---

## Critical Infrastructure Components

### 1. Framework Shells (`app/libs/framework_shells.py`)

**What it is:** Process lifecycle manager for all long-lived background processes

**Key Features:**
- PTY support for terminals (type="shell", uses_pty=True)
- STDIO support for daemons (type="shell", uses_pty=False)
- Log capture to `~/.cache/te_framework/logs/`
- Orphan adoption on restart
- Graceful shutdown (SIGTERM → 2s grace → SIGKILL)

**Used by:**
- Terminal drawer in Code CM6 (PTY shell running bash/zsh)
- AI Agent drawer (STDIO shell running MCP server)
- Future: aria2 daemon, archive manager, language servers

**API:**
- `GET /api/framework_shells` - List shells
- `POST /api/framework_shells` - Spawn shell
- `POST /api/framework_shells/<id>/write` - Write to PTY
- `WS /api/framework_shells/<id>/ws` - Bidirectional PTY stream

### 2. IPC Server (`app/ipc/server.py`)

**What it is:** Flask-based synchronous operation server

**Why it exists:** FastAPI/ASGI struggles with sequential blocking operations. IPC provides:
- Sequential task execution (shutdown, agent conversations)
- Blocking I/O allowed (subprocess, file locks)
- Process registry for coordinated shutdown

**Apps can extend via `ipc_stack` modules** in manifest.

### 3. State Stores

**Location:** `~/.cache/termux_extensions/`

**Files:**
- `state_store.json` - Framework-wide state
- `settings.json` - Framework preferences

**Per-App Stores (Code CM6):**
- `~/.local/share/termux-extensions-2/file_editor_cm6/history_store.json` - Recent files, active project
- `~/.local/share/termux-extensions-2/file_editor_cm6/preferences_store.json` - Editor settings per project
- `~/.cache/cm6_sessions/` - Session cache for crash recovery

**CRITICAL:** All state is disk-backed. No localStorage, no browser cache. Clients read from backend on every request.

---

## Code CM6 App Architecture

**Location:** `app/apps/file_editor_cm6/`

### Key Files

```
file_editor_cm6/
├── main.py                 # FastAPI router (file_editor_cm6_bp)
├── manifest.json           # App metadata
├── template.html           # Main UI shell
├── static/
│   ├── editor.js           # CodeMirror 6 integration
│   ├── explorer.js         # File tree + search
│   ├── terminal.js         # Terminal drawer
│   ├── agent.js            # AI agent drawer
│   └── styles.css          # All styles
├── libs/
│   ├── history_store.py    # Recent files, project tracking
│   ├── preferences_store.py # Per-project editor settings
│   ├── session_cache.py    # Crash recovery cache
│   ├── core_read.py        # File reading with metadata
│   ├── core_write.py       # Atomic writes with SHA validation
│   ├── git_utils.py        # Git operations
│   └── diff_utils.py       # Inline diff generation
└── terminal_backend.py     # Terminal drawer backend
```

### Backend Architecture

**Three-tier model:**
1. **FastAPI Endpoints** (`main.py`) - HTTP/WebSocket routes
2. **Service Layer** (`libs/*`) - Business logic, state management
3. **External Tools** - Git, ripgrep, watchdog

**API Endpoints:**
- `/` - Status
- `/read` - Read file with metadata (SHA, size, modified time)
- `/write` - Atomic write with conflict detection
- `/project/open` - Open/switch projects
- `/explorer/list` - Directory listing with git status
- `/explorer/search` - Search by filename, content, or git changes
- `/git/*` - Git operations (status, diff, commit, branch, etc.)
- `/terminal/*` - Terminal drawer management
- `/agent/*` - AI agent integration

### Frontend Architecture

**Modular ES6:**
- `editor.js` - CodeMirror 6 instance, extensions
- `explorer.js` - File tree, search modes, context menus
- `terminal.js` - xterm.js integration, PTY streaming
- `agent.js` - MCP server communication

**WebSocket Channels:**
- `/ws/app/file_editor_cm6/read` - File change notifications
- `/api/framework_shells/<id>/ws` - Terminal PTY stream

---

## Current Issues to Fix

### 1. Blank File Glitch (High Priority)

**Symptom:** When opening a blank file, UI glitches out

**Suspected Cause:** Edit caching (session cache) not handling empty files correctly

**Files to Check:**
- `app/apps/file_editor_cm6/libs/session_cache.py` - Cache creation/load for empty files
- `app/apps/file_editor_cm6/static/editor.js` - Editor initialization with empty content
- `app/apps/file_editor_cm6/main.py` - `/read` endpoint returning proper metadata for empty files

**Debug Steps:**
1. Check browser console for errors when opening empty file
2. Verify `/read` endpoint returns `{"ok": True, "data": {"content": "", "path": "...", "sha256": "..."}}`
3. Check if session cache tries to load non-existent cache for new files
4. Verify CodeMirror initializes with empty string

### 2. Link to External File Explorer

**What's needed:** Add menu item to explorer "..." (three-dot) menu that links to external file browser

**Location:** `app/apps/file_editor_cm6/static/explorer.js`

**Context Menu Function:** Look for `showContextMenu()` or similar

**What to add:**
```javascript
{
  label: 'Open in File Explorer',
  action: async () => {
    // Call framework API to launch file_explorer app with current directory
    await fetch('/api/app/file_explorer/open', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: currentPath})
    });
  }
}
```

**Note:** External file explorer app exists at `app/apps/file_explorer/` but needs to be linked

### 3. Select Mode CSS Issue (Medium Priority)

**Symptom:** When select mode is enabled on expanded card, text shrinks and truncates

**Location:** `app/apps/file_editor_cm6/static/styles.css`

**Problem:** Checkboxes appear but card content doesn't flex correctly to accommodate them

**Debug:**
1. Find `.fe-explorer-card` or similar class
2. Check for `.select-mode` modifier class
3. Look for flex/grid layout that doesn't account for checkbox width

**Likely Fix:**
```css
/* Current (probably): */
.fe-explorer-card.expanded .card-content {
  width: 100%; /* Doesn't account for checkbox */
}

/* Fix (probably): */
.fe-explorer-card.expanded.select-mode .card-content {
  width: calc(100% - 40px); /* Account for checkbox width */
}
```

---

## File Paths Reference

**Framework Root:** `/data/data/com.termux/files/home/mrselect/`

**Cache/State Locations:**
- `~/.cache/te_framework/` - Framework shell logs, metadata
- `~/.cache/te_framework/logs/` - Active shell logs
- `~/.cache/te_framework/preserved_logs/` - Archived logs (>7 days deleted)
- `~/.cache/termux_extensions/` - Framework state/settings
- `~/.local/share/termux-extensions-2/file_editor_cm6/` - Code CM6 stores
- `~/.cache/cm6_sessions/` - Session cache

**Important Scripts:**
- `scripts/run_framework.sh` - Supervisor entrypoint
- `scripts/bootstrap_termux.sh` - Termux setup

**Documentation:**
- `README.md` - Platform overview
- `docs/apps/code_cm6/README.md` - Code CM6 feature overview
- `docs/apps/code_cm6/TECHNICAL.md` - Code CM6 architecture deep dive
- `docs/core/framework_shells.md` - Framework Shells documentation
- `docs/core/nicegui_iframe_feature_adding_guideline.md` - Adding features guide

---

## Development Workflow

### Starting Framework

```bash
./scripts/run_framework.sh
# or
./scripts/run_framework.sh --run-local  # localhost only
```

### Testing Changes

1. Make code changes
2. Restart framework (Ctrl+C, then rerun script)
3. Hard refresh browser (Ctrl+Shift+R)
4. Check browser console for errors

### Common Debugging

**Backend errors:**
- Check terminal output where framework is running
- Check `~/.cache/te_framework/logs/` for shell logs

**Frontend errors:**
- Open browser DevTools console
- Check Network tab for failed requests
- Check WebSocket connections

**State issues:**
- Delete state files and restart framework
- Check JSON files are valid (not corrupted)

---

## Important Patterns

### 1. Atomic File Writes

```python
# ALWAYS use core_write for file operations
from app.apps.file_editor_cm6.libs.core_write import write_full

result = write_full(
    file_path=path,
    new_text=content,
    base_sha=expected_sha  # For conflict detection
)
```

### 2. Reading with Metadata

```python
from app.apps.file_editor_cm6.libs.core_read import read_full

result = read_full(file_path)
# Returns: {
#   'content': str,
#   'sha256': str,
#   'size': int,
#   'modified': float
# }
```

### 3. Framework Shell Usage

```python
# Terminal drawer
from app.libs.framework_shells import get_framework_shell_manager

manager = await get_framework_shell_manager()
shell = await manager.spawn_shell_pty(
    command=['bash'],
    label='code-editor-terminal',
    cwd=project_root
)
# Store shell.id in history_store
```

### 4. WebSocket Patterns

```javascript
// File watcher
const ws = new WebSocket('ws://localhost:8088/ws/app/file_editor_cm6/read');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'file_changed') {
    reloadFile(msg.path);
  }
};
```

---

## What NOT to Do

❌ **Don't use localStorage** - State must be disk-backed  
❌ **Don't cache state in frontend** - Backend is source of truth  
❌ **Don't modify styles without consent** - User hasn't approved aesthetic changes  
❌ **Don't use `subprocess.Popen` directly** - Use Framework Shells  
❌ **Don't write files without conflict detection** - Use `core_write.write_full()`  
❌ **Don't assume Flask** - Main app is FastAPI, IPC is Flask  
❌ **Don't spawn orphan processes** - Register with IPC or use Framework Shells  

---

## Key Takeaways

1. **This is a platform, not just an app** - Multiple apps share infrastructure
2. **Backend is ground truth** - No frontend caching, disk-backed state only
3. **Framework Shells manages processes** - Don't spawn processes manually
4. **IPC handles sequential operations** - Use for blocking tasks
5. **Multi-device convergence works** - Desktop and mobile see same state
6. **GeckoView APK provides better mobile UX** - Coming soon to main branch

---

## Quick Reference: Where Things Live

**Add new app:** `app/apps/<app_name>/` + `manifest.json`  
**Modify Code CM6 UI:** `app/apps/file_editor_cm6/static/`  
**Modify Code CM6 backend:** `app/apps/file_editor_cm6/main.py` or `libs/`  
**Framework shell management:** `app/libs/framework_shells.py`  
**State persistence:** `app/libs/state_store.py`  
**App worker spawning:** `app/libs/app_worker.py`  
**IPC server:** `app/ipc/server.py`  
**Supervisor:** `app/supervisor.py`  
**Main framework:** `app/main.py`  

---

## Next Steps for New Agent

1. Read this document completely
2. Check browser console when reproducing blank file glitch
3. Review `session_cache.py` for empty file handling
4. Test opening blank files with different extensions
5. Report findings before making changes

Good luck! 🚀
