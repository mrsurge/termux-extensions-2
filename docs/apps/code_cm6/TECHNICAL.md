# Code CM6 – Technical Deep Dive

**Architecture Philosophy:** Code CM6 implements the code-server pattern - disk-backed state with ephemeral UI clients. Multiple devices (desktop, mobile, vim) converge on the same backend without sync logic.

**Document Version:** 1.1  
**Last Updated:** 2025-12-01  
**Target Audience:** Framework contributors, extension developers, and technical users

This document provides a comprehensive technical overview of Code CM6's internal architecture, focusing on the frameworks, patterns, and implementation details that make the editor function.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
   - [Framework Context: Termux Extensions 2](#10-framework-context-termux-extensions-2)
   - [High-Level Component Model](#11-high-level-component-model)
   - [Design Principles](#12-design-principles)
   - [Technology Stack](#13-technology-stack)
2. [Backend Stack](#2-backend-stack)
3. [Frontend Architecture](#3-frontend-architecture)
4. [CodeMirror 6 Integration](#4-codemirror-6-integration)
5. [File Watcher System](#5-file-watcher-system)
6. [Inline Diff Pipeline](#6-inline-diff-pipeline)
7. [Git Integration](#7-git-integration)
8. [Explorer System](#8-explorer-system)
   - [Framework Shells: The Foundation](#85-framework-shells-the-foundation)
9. [Terminal Integration](#9-terminal-integration)
10. [AI Agent Bridge](#10-ai-agent-bridge)
11. [State Management](#11-state-management)
12. [WebSocket Architecture](#12-websocket-architecture)
13. [Session Cache](#13-session-cache)
14. [IPC Protocol](#14-ipc-protocol)
15. [Performance Optimizations](#15-performance-optimizations)
16. [Jump-To-Line Pipeline](#16-jump-to-line-pipeline)

---

## 1. Architecture Overview

### 1.0 Framework Context: Termux Extensions 2

Code CM6 is one application within the **Termux Extensions 2** framework - a complete application platform for Termux that manages multiple apps with process isolation, shared services, and unified UI.

#### Framework Startup Flow

```
1. scripts/run_framework.sh
   ↓ Spawns IPC server (process registry)
   ↓ exec python -m app.supervisor

2. app/supervisor.py
   ↓ Spawns python -m app.main (framework)
   ↓ Registers signal handlers for shutdown

3. app/main.py (FastAPI)
   ↓ Loads services (app/libs/)
   ↓ Loads extensions (app/extensions/)
   ↓ Scans app manifests (app/apps/*/manifest.json)
   ↓ Starts uvicorn on 0.0.0.0:8088

4. User visits http://localhost:8088
   ↓ Served app/templates/app_shell.html
   ↓ Shows app launcher (dashboard)

5. User clicks "Code CM6" app card
   ↓ JavaScript: appLauncher.openApp('file_editor_cm6')
   ↓ POST /api/launch?app_id=file_editor_cm6

6. app/libs/app_manager.py
   ↓ ensure_app_running('file_editor_cm6')
   ↓ Finds free port (e.g., 5001)
   ↓ Spawns app worker subprocess

7. app/libs/app_worker.py
   ↓ Creates FastAPI app
   ↓ Imports app/apps/file_editor_cm6/main.py
   ↓ Mounts file_editor_cm6_bp router
   ↓ Calls NICEGUI_INIT_HOOK(app) if present
   ↓ Starts uvicorn on 127.0.0.1:5001

8. Framework proxies app worker
   ↓ GET /app/file_editor_cm6 → proxy to 127.0.0.1:5001
   ↓ Injects app HTML into #app-container in app_shell.html
```

#### The App Shell Container

The framework serves `app/templates/app_shell.html` which provides:
- **#app-container** div where app HTML is injected
- Toolbar with app title, back button, settings
- Common UI chrome (modals, notifications)
- Shared JavaScript for app lifecycle

When Code CM6 loads, its `template.html` is fetched and injected into `#app-container`:

```html
<!-- app/templates/app_shell.html (Framework) -->
<div class="app-shell">
    <div class="app-toolbar">
        <button id="back-btn">←</button>
        <span class="app-title">Code CM6</span>
    </div>
    <div id="app-container">
        <!-- Code CM6's template.html injected here -->
        <div class="fe-root">
            <div class="fe-editor-container">
                <iframe src="/api/app/file_editor_cm6/ui/nc">
                    <!-- NiceGUI CodeMirror 6 -->
                </iframe>
            </div>
        </div>
    </div>
</div>
```

#### Process Architecture

```
supervisor (PID 1000)
 └─ framework (PID 1001) - app/main.py on :8088
     ├─ ipc_server (PID 999) - app/ipc/server.py on :9123
     ├─ worker: file_editor_cm6 (PID 1010) - on :5001
     ├─ worker: file_explorer (PID 1011) - on :5002
     └─ worker: terminal (PID 1012) - on :5003
```

Each app worker:
- Runs in isolated subprocess
- Has own port (framework proxies requests)
- Registers with IPC server for lifecycle management
- Can be stopped/restarted independently

#### Shared Services

The framework provides shared infrastructure:
- **IPC Server** (`app/ipc/server.py`) - Process registry, orchestrated shutdown
- **Shell Manager** (`app/libs/framework_shells.py`) - Unified PTY management
- **State Store** (`~/.cache/termux_extensions/state_store.json`) - Cross-app state
- **Settings** (`~/.cache/termux_extensions/settings.json`) - Framework preferences
- **WebSocket Multiplexing** - Routes messages to correct app worker

Code CM6 uses:
- Shell Manager for terminal drawer (PTY streaming)
- IPC server for process registration
- State store for cross-app session state (future: recent files across apps)

#### Convergence Across Apps

Because the framework is single-instance (one backend on device), all apps share:
- Same filesystem
- Same git repositories  
- Same shell sessions
- Same state stores

Example: File Explorer and Code CM6 both operate on the same project directory. Edit in Code CM6 → File Explorer sees changes instantly via shared file watcher infrastructure.

---

### 1.1 High-Level Component Model

Code CM6 follows a **three-tier architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Client)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  main.js     │  │ explorer.js  │  │ terminal.js  │       │
│  │  (App Shell) │  │  (Drawer)    │  │  (xterm.js)  │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         │                 │                 │               │
│  ┌──────▼─────────────────▼─────────────────▼─────────┐     │
│  │         NiceGUI Iframe (CodeMirror 6)              │     │
│  │  ┌──────────────┐  ┌─────────────────────────┐     │     │
│  │  │ editor_app.py│  │ codemirror.js/.py       │     │     │
│  │  └──────────────┘  └─────────────────────────┘     │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket + REST
┌─────────────────────▼───────────────────────────────────────┐
│             FastAPI Backend (Python)                        │
│  ┌───────────┐ ┌────────────┐ ┌────────────┐ ┌──────────┐   │
│  │  main.py  │ │ core_read  │ │ core_write │ │ git_     │   │
│  │ (Router)  │ │ (Watcher)  │ │ (Writer)   │ │ helper   │   │
│  └─────┬─────┘ └──────┬─────┘ └──────┬─────┘ └────┬─────┘   │
│        │              │              │            │         │
│  ┌─────▼──────────────▼──────────────▼────────────▼──────┐  │
│  │          Shared State & Persistence Layer             │  │
│  │  HistoryStore │ PreferencesStore │ EditTracker        │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                      │ File System / Git CLI
┌─────────────────────▼───────────────────────────────────────┐
│                   Operating System                          │
│     Filesystem │ Git │ PTY │ Watchdog                       │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Design Principles

1. **Backend as Ground Truth:** All authoritative state lives in Python (file contents, git status, preferences)
2. **Stateless Endpoints:** REST/WebSocket endpoints read from disk every time; no frontend state caching
3. **NiceGUI Iframe as Ephemeral Client:** The iframe maintains its own UI state (by design), but initializes from disk on load. Changes update both disk (persistent) and iframe (ephemeral) simultaneously. On refresh, iframe rebuilds from disk - no sync logic needed.
4. **Progressive Enhancement:** Core features work without Git, watchdog, or ripgrep (graceful degradation)
5. **Mobile-First Responsive:** Touch, keyboard, and mouse input all supported with adaptive layouts
6. **code-server Pattern:** Like code-server, settings.json on disk is the single source of truth. No localStorage, no browser caching. NiceGUI iframe state is ephemeral - it initializes from disk on load, can be updated mid-flight, and is discarded on refresh.

### 1.3 Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Backend Runtime** | Python 3.9+ | Async I/O, subprocess management, state persistence |
| **Web Framework** | FastAPI | REST routes, WebSocket support, dependency injection |
| **Editor Framework** | NiceGUI | CodeMirror 6 wrapper with Python API |
| **Frontend** | Vanilla JS (ES6) | No frameworks; direct DOM manipulation for performance |
| **Terminal** | xterm.js | VT100 emulation in browser |
| **File Watching** | watchdog (fallback: polling) | Filesystem event monitoring |
| **Search** | ripgrep (fallback: Python) | High-speed content search |
| **Version Control** | Git CLI | All git operations via subprocess |
| **State Storage** | JSON files | Preferences, history, session cache |

---

## 2. Backend Stack

### 2.1 FastAPI Application Structure

**File:** `app/apps/file_editor_cm6/main.py` (650+ lines)

The main router provides **30+ REST endpoints** organized by feature:

```python
# Project Management
POST /project/open         # Open existing directory as project
POST /project/create       # Create new project (via file picker)
GET  /project/current      # Get active project root

# File Operations  
GET  /read                 # Read file contents + metadata
POST /write                # Write file with collision detection
GET  /session/cache        # Retrieve unsaved draft
DELETE /session/cache      # Discard draft

# Explorer
GET  /explorer/tree        # List directory with git status
GET  /explorer/search      # Search by name/content/changes

# Git Operations
GET  /git/status          # Working tree status
GET  /git/branches        # List local/remote branches
POST /git/checkout        # Switch branch
POST /git/create_branch   # Create new branch
GET  /git/diff_base       # Get comparison baseline
POST /git/diff_base       # Set comparison baseline
POST /git/stage_all       # Stage all changes
POST /git/unstage_all     # Unstage all changes
POST /git/commit          # Commit with message
# Note: push/pull/clone now use Job Registry via WebSocket (see Section 8.7)

# WebSocket
WS   /ws/read             # File change notifications
WS   /ws/agent            # AI agent communication
WS   /ws/terminal         # PTY streaming
WS   /ws/explorer         # Explorer tree + git operations
```

### 2.2 Dependency Injection Pattern

FastAPI's DI system provides clean access to shared resources:

```python
from fastapi import Depends

def get_history_store():
    return _shared_history_store

@app.get('/project/current')
def project_current(history: HistoryStore = Depends(get_history_store)):
    project_path = history.get_active_project()
    return {"project_path": str(project_path)}
```

This pattern:
- Simplifies testing (inject mocks)
- Enables request-scoped resources
- Avoids global state mutation

### 2.3 Module Organization

```
app/apps/file_editor_cm6/
├── main.py                    # FastAPI router + endpoints
├── core_read.py               # File watcher + WebSocket notifications
├── core_write.py              # Write handler + collision detection
├── diff_helper.py             # Git diff parsing + caching
├── git_helper.py              # Git CLI wrappers + data models
├── explorer_helper.py         # Directory tree generation
├── edit_tracker.py            # Live edit tracking for diffs
├── history_store.py           # Recent files + project persistence
├── preferences_store.py       # User preferences (themes, font scale)
├── terminal_backend.py        # Terminal REST + WebSocket routes
├── terminal_shell.py          # Framework shell adapter
├── agent_ws.py                # AI agent WebSocket handler
├── agent_bridge.py            # OpenAI/Gemini adapters
├── agent_bridge_mcp.py        # MCP protocol adapter
├── agent_routes.py            # Agent REST endpoints
├── agent_session_store.py     # Conversation persistence
├── conversation_store.py      # Transcript storage
├── conversation_utils.py      # Message formatting helpers
└── stores.py                  # Singleton store instances
```

---

## 3. Frontend Architecture

### 3.1 Application Shell (`main.js`)

**File:** `app/apps/file_editor_cm6/main.js` (2100+ lines)

The main JavaScript file orchestrates:
- **WebSocket lifecycle** (reconnect logic, message routing)
- **Menu system** (File/Edit/View/Editor menus with keyboard shortcuts)
- **State synchronization** (current file, project root, preferences)
- **Drawer management** (explorer, terminal, agent)
- **Toast notifications** (success/error messages)

Key patterns:

```javascript
// Element references (fail-fast if missing)
const miSave = requireEl('#mi-save');
const miFind = requireEl('#mi-find');

// Menu binding with keyboard support
bindMenuToggle(miToggleWrap, async () => {
  wordWrap = !wordWrap;
  setMenuChecked(miToggleWrap, wordWrap);
  persistEditorPreferences({ wordWrap });
  apiPost('editor/set_view_settings', { word_wrap: wordWrap });
});

// API abstraction
async function apiPost(endpoint, data) {
  const response = await fetch(`/api/app/file_editor_cm6/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
```

### 3.2 Explorer Drawer (`static/js/explorer.js`)

**File:** `app/apps/file_editor_cm6/static/js/explorer.js` (84000+ characters, 2500+ lines)

Implements:
- **File tree rendering** with lazy expansion
- **Search UI** (by name, content, changes)
- **Git status badges** (M/A/D/U indicators)
- **Context menus** (rename, delete, copy, move, create)
- **Diff base selector** (dropdown with commit info)
- **"Search by Changes"** view with inline filtering

Architecture:
```javascript
// State management
let cachedTreeData = null;
let lastChangesData = null;
let currentSearchMode = 'name';

// Rendering pipeline
function renderTree(data) {
  const container = document.getElementById('fe-tree-container');
  container.innerHTML = '';  // Clear
  data.forEach(entry => {
    const card = createFileCard(entry);  // Build DOM
    container.appendChild(card);
  });
}

// Event delegation for performance
treeContainer.addEventListener('click', (e) => {
  const card = e.target.closest('.fe-entry-card');
  if (card) handleCardClick(card, e);
});
```

### 3.3 Terminal Drawer (`static/js/terminal.js`)

**File:** `app/apps/file_editor_cm6/static/js/terminal.js` (13000+ characters)

Wraps **xterm.js** with PTY WebSocket streaming:

```javascript
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  theme: { background: '#1e1e1e' }
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal-container'));

// PTY WebSocket
const ws = new WebSocket('ws://localhost:5000/api/app/file_editor_cm6/ws/terminal');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'output') term.write(msg.data);
};

// User input → PTY
term.onData((data) => {
  ws.send(JSON.stringify({ type: 'input', data }));
});
```

### 3.4 Iframe Message Bus

The iframe cannot access the host DOM directly, so real-time features use a `window.postMessage` bridge exposed by the vendored `codemirror.py::notify_parent()` helper. Core events:

| Message | Direction | Purpose |
| --- | --- | --- |
| `cm6-cache-state` | iframe → host | Session cache telemetry (state, unsaved flag, SHA). Drives the draft badge and host-side `markUnsaved()` bookkeeping. |
| `draft_state` | iframe → host | Force-enables the draft badge after crash restores so late “clean” events cannot clear it accidentally. |
| `cm6-dirty-state` | iframe → host | Fires immediately on each text mutation; lets the host start the autosave debounce without waiting for the cache snapshot. |
| `notification` | iframe → host | Reroutes NiceGUI toasts to the shared host toast stack for consistent styling. |

Adding a new message only requires calling `editor.notify_parent(type, data)` inside `editor_app.py`; the host listens once via `window.addEventListener('message', …)` in `main.js`.

---

## 4. CodeMirror 6 Integration

### 4.1 NiceGUI Vendoring

Code CM6 uses a **vendored NiceGUI** build to enable custom extensions:

```
app/static/vendor/nicegui/elements/codemirror/
├── package.json           # npm dependencies
├── src/
│   └── index.mjs          # Export CM6 modules
├── dist/
│   ├── index.js           # Bundled JS (webpack/rollup)
│   └── codemirror.css     # CM6 styles
├── codemirror.js          # Browser-side CM6 wrapper
└── codemirror.py          # Python API for iframe control
```

**Build process:**
```bash
cd app/static/vendor/nicegui/elements/codemirror
npm install
npm run build  # Bundles src/index.mjs → dist/index.js
```

### 4.2 Custom Extensions

#### 4.2.1 Indentation Guides

**Implementation:** `codemirror.js` lines 311-344

```javascript
const indentationMarkers = CM.indentationMarkers;

async applyIndentGuides(enabled) {
  if (!this.indentCompartment) {
    this.indentCompartment = new CM.Compartment();
    this.indentExtensions = [
      indentationMarkers({
        highlightActiveBlock: true,
        thickness: 0.5,
        colors: {
          light: '#8B7355',  // Darker tan for inactive
          dark: '#8B7355',
          activeLight: '#A0826D',  // Medium tan for active block
          activeDark: '#A0826D'
        }
      })
    ];
    // Install empty compartment
    this.editor.dispatch({
      effects: CM.StateEffect.appendConfig.of(
        this.indentCompartment.of([])
      )
    });
  }
  // Reconfigure on toggle
  this.editor.dispatch({
    effects: this.indentCompartment.reconfigure(
      enabled ? this.indentExtensions : []
    )
  });
}
```

**Key pattern:** Lazy **Compartment** initialization allows dynamic reconfiguration without recreating the entire editor.

#### 4.2.2 Zebra Striping

**Implementation:** Similar compartment pattern with `ViewPlugin`:

```javascript
this.zebraCompartment = new CM.Compartment();
this.zebraExtensions = [
  CM.ViewPlugin.fromClass(class {
    update(update) {
      // Apply alternating background colors to lines
    }
  }, { decorations: v => v.decorations })
];
```

#### 4.2.3 Inline Diff Decorations

**File:** `static/js/diff_decorations.js` (10500+ characters)

Uses **CM6 Gutter API** + **WidgetMarker** for deletion widgets:

```javascript
import { gutter, GutterMarker } from '@codemirror/view';

const diffGutter = gutter({
  class: 'cm-diff-gutter',
  markers: (view) => {
    const builder = new RangeSetBuilder();
    for (let { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        let line = view.state.doc.lineAt(pos);
        const marker = getDiffMarkerForLine(line.number);
        if (marker) builder.add(line.from, line.from, marker);
        pos = line.to + 1;
      }
    }
    return builder.finish();
  },
  widgetMarker: (view, widget, block) => {
    // Display deleted lines as inline widgets
    if (widget.type === 'deletion') {
      return new DeletionMarker(widget.lines);
    }
    return null;
  }
});
```

### 4.3 Dynamic Language Detection

**File:** `codemirror.js` lines 260-315

Maps file extensions → CM6 language modes:

```javascript
const LANGUAGE_INDENT_MAP = {
  javascript: { mode: 'javascript', indent: 2 },
  typescript: { mode: 'typescript', indent: 2 },
  python: { mode: 'python', indent: 4 },
  html: { mode: 'html', indent: 2 },
  css: { mode: 'css', indent: 2 },
  // ... 40+ more languages
};

async setLanguage(ext) {
  const config = LANGUAGE_INDENT_MAP[ext] || { mode: 'text', indent: 4 };
  
  // Reconfigure language mode
  this.editor.dispatch({
    effects: this.languageCompartment.reconfigure(
      CM[config.mode] ? [CM[config.mode]()] : []
    )
  });
  
  // Reconfigure indent unit
  this.editor.dispatch({
    effects: this.indentUnitCompartment.reconfigure(
      CM.indentUnit.of(' '.repeat(config.indent))
    )
  });
}
```

This ensures:
- JavaScript/TypeScript/HTML use **2-space indents**
- Python/C/Java use **4-space indents**
- Indentation guides align correctly with actual indentation

---

## 5. File Watcher System

### 5.1 Dual Implementation Strategy

**File:** `app/apps/file_editor_cm6/core_read.py` (500+ lines)

Code CM6 supports **two watcher backends**:

1. **Watchdog** (preferred): Native filesystem events via OS hooks
2. **Polling** (fallback): Periodic stat() checks when watchdog unavailable

```python
if _is_watchdog_available:
    observer = Observer()
    handler = WatchdogHandler()
    observer.schedule(handler, str(project_root), recursive=True)
    observer.start()
else:
    watcher = PollingWatcher(project_root, interval=1.0)
    watcher.start()
```

### 5.2 Event Debouncing

**Problem:** Rapid file changes (e.g., `git checkout`) generate event storms

**Solution:** 150ms debounce window

```python
DEBOUNCE_DELAY = 0.15  # seconds

def _debounce_event(path: str, event: dict):
    # Cancel existing timer for this path
    if path in _debounce_timers:
        _debounce_timers[path].cancel()
    
    # Store latest event
    _debounced_events[path] = event
    
    # Schedule notification after delay
    timer = Timer(DEBOUNCE_DELAY, lambda: _flush_event(path))
    _debounce_timers[path] = timer
    timer.start()

def _flush_event(path: str):
    event = _debounced_events.pop(path, None)
    if event:
        _notify_subscribers(path, event)
```

### 5.3 Self-Echo Suppression

**Problem:** Watcher notifies editor of changes *it* just saved (flicker)

**Solution:** 300ms suppression window keyed by (path, client_id)

```python
SUPPRESSION_WINDOW = 0.3  # seconds
_suppression_windows: Dict[tuple, float] = {}

def push_save_ack(path: str, client_id: str):
    """Called after successful write to suppress echo."""
    key = (path, client_id)
    _suppression_windows[key] = time.time() + SUPPRESSION_WINDOW

def _should_suppress(path: str, client_id: str) -> bool:
    key = (path, client_id)
    expiry = _suppression_windows.get(key, 0)
    if time.time() < expiry:
        return True  # Still in suppression window
    else:
        _suppression_windows.pop(key, None)  # Cleanup
        return False
```

### 5.4 WebSocket Notification

**Endpoint:** `WS /ws/read`

Clients subscribe with a token:

```python
# Client → Server
{"action": "subscribe", "path": "/project/file.py", "token": "abc123"}

# Server → Client (on change)
{
  "path": "/project/file.py",
  "base_sha": "a1b2c3d4",
  "new_content": "...",
  "diff_hunks": [...]
}
```

Token-based subscriptions allow:
- Multiple clients per file
- Targeted notifications (only subscribers notified)
- Client-specific suppression (only suppress for saving client)

---

## 6. Inline Diff Pipeline

### 6.1 Architecture

```
┌──────────────┐
│ User Action  │  (File open, edit, base change, external modification)
└──────┬───────┘
       │
┌──────▼────────────────────────────────────────────────────┐
│ Backend: collect_diff(root, path, base_ref)              │
│ ┌────────────────────────────────────────────────────┐   │
│ │ 1. Check cache: _DIFF_CACHE[(root, path, base)]   │   │
│ │ 2. If miss: Run git diff --unified=0 <base> -- <path>│
│ │ 3. Parse unified diff → structured hunks           │   │
│ │ 4. Store in cache with expiry                      │   │
│ │ 5. Return { hunks: [...], cache_hit: bool }       │   │
│ └────────────────────────────────────────────────────┘   │
└──────┬────────────────────────────────────────────────────┘
       │ JSON payload
┌──────▼────────────────────────────────────────────────────┐
│ Frontend: diff_decorations.js                            │
│ ┌────────────────────────────────────────────────────┐   │
│ │ 1. Receive hunks array                             │   │
│ │ 2. Build CM6 RangeSet for gutter markers          │   │
│ │ 3. Build CM6 Widgets for deleted lines            │   │
│ │ 4. Dispatch StateEffect to update decorations     │   │
│ └────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### 6.2 Git Diff Execution

**File:** `app/apps/file_editor_cm6/diff_helper.py` (400+ lines)

```python
def collect_diff(project_root: Path, file_path: Path, base_ref: str = 'HEAD') -> dict:
    cache_key = (str(project_root), str(file_path), base_ref)
    
    # Check cache
    if cache_key in _DIFF_CACHE:
        entry = _DIFF_CACHE[cache_key]
        if time.time() < entry.expiry:
            return {"hunks": entry.hunks, "base_ref": base_ref}
    
    # Run git diff
    result = subprocess.run(
        ['git', 'diff', '--unified=0', base_ref, '--', str(file_path)],
        cwd=project_root,
        capture_output=True,
        text=True
    )
    
    # Parse unified diff format
    hunks = []
    for line in result.stdout.split('\n'):
        if line.startswith('@@'):
            # @@ -10,3 +10,5 @@ → oldStart=10, oldCount=3, newStart=10, newCount=5
            match = re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', line)
            hunks.append({
                'oldStart': int(match.group(1)),
                'oldCount': int(match.group(2) or 1),
                'newStart': int(match.group(3)),
                'newCount': int(match.group(4) or 1),
                'lines': []  # Populated below
            })
        elif line.startswith('-'):
            hunks[-1]['lines'].append({'type': 'deletion', 'text': line[1:]})
        elif line.startswith('+'):
            hunks[-1]['lines'].append({'type': 'addition', 'text': line[1:]})
    
    # Cache result
    _DIFF_CACHE[cache_key] = DiffCacheEntry(hunks, time.time() + CACHE_TTL)
    
    return {"hunks": hunks, "base_ref": base_ref}
```

**Why `--unified=0`?**
- Only returns changed lines (no surrounding context)
- Minimal payload size
- Faster parsing
- We don't need context for inline decorations

### 6.3 Cache Invalidation

Cache is invalidated on:
1. **File write:** `write_full()` calls `invalidate_diff_cache(root, path)`
2. **Diff base change:** Selector POST clears all cached variants for project
3. **TTL expiry:** 60-second cache lifetime for stale prevention

```python
def invalidate_diff_cache(project_root: Path, file_path: Path):
    # Remove ALL cached diffs for this file (all base refs)
    keys_to_remove = [k for k in _DIFF_CACHE if k[0] == str(project_root) and k[1] == str(file_path)]
    for key in keys_to_remove:
        _DIFF_CACHE.pop(key, None)
```

### 6.4 Draft Diff Overlay

Alongside Git diffs, the editor renders **draft** overlays that compare the iframe buffer against the on-disk file. The Python helper `_get_combined_diffs(project_root, file_path, current_content)` stitches both sources:

1. Git hunks (respecting the selected base reference) with `type: 'add' | 'del'`.
2. Draft hunks computed by `draft_diff_helper.compute_draft_diff()` with `type: 'add-draft' | 'del-draft'`.

The combined list is sent via `editor.set_diff_decorations(hunks)`. Vendored `codemirror.js` inspects the `type` flag so draft additions render as blue blocks and draft deletions as yellow “removed line” widgets. Because everything flows through the same decoration pipeline, Git and draft overlays coexist on the same buffer without mode switches.

Draft hunks are only generated when autosave is OFF. Enabling autosave clears session caches, suppresses draft diff computation, and falls back to pure Git decorations (the disk now matches the buffer on every autosave tick).

### 6.4 CM6 Decoration Application

**File:** `static/js/diff_decorations.js`

```javascript
function applyDiffDecorations(view, hunks) {
  const gutterMarkers = [];
  const deletionWidgets = [];
  
  for (const hunk of hunks) {
    // Gutter markers for added/modified lines
    if (hunk.newCount > 0) {
      for (let i = 0; i < hunk.newCount; i++) {
        const lineNum = hunk.newStart + i;
        const pos = view.state.doc.line(lineNum).from;
        gutterMarkers.push(new AdditionMarker().range(pos));
      }
    }
    
    // Deletion widgets (inline display of removed content)
    if (hunk.oldCount > 0 && hunk.newCount === 0) {
      const insertPos = hunk.newStart > 0 
        ? view.state.doc.line(hunk.newStart).to 
        : 0;
      deletionWidgets.push(new DeletionWidget(hunk.lines).range(insertPos));
    }
  }
  
  // Dispatch decorations
  view.dispatch({
    effects: [
      setGutterMarkersEffect.of(RangeSet.of(gutterMarkers)),
      setWidgetsEffect.of(RangeSet.of(deletionWidgets))
    ]
  });
}
```

---

## 7. Git Integration

### 7.1 CLI Wrapper Architecture

**File:** `app/apps/file_editor_cm6/git_helper.py` (800+ lines)

All Git operations use **subprocess** with structured error handling:

```python
class GitError(RuntimeError):
    def __init__(self, message: str, stdout: str = '', stderr: str = ''):
        super().__init__(message)
        self.stdout = stdout
        self.stderr = stderr

def _run_git(args: list, cwd: Path, check=True) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(
            ['git'] + args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=30
        )
        if check and result.returncode != 0:
            raise GitError(
                f'Git command failed: {" ".join(args)}',
                stdout=result.stdout,
                stderr=result.stderr
            )
        return result
    except subprocess.TimeoutExpired:
        raise GitError(f'Git command timed out: {" ".join(args)}')
```

### 7.2 Status Parsing

**Dual strategy** for diff base HEAD vs. other refs:

```python
def get_worktree_changes(repo_root: Path, base_ref: str = 'HEAD') -> list:
    if base_ref == 'HEAD':
        # Use porcelain status (faster, handles untracked files)
        result = _run_git(['status', '--porcelain'], cwd=repo_root)
        entries = []
        for line in result.stdout.split('\n'):
            if not line: continue
            status = line[:2]
            path = line[3:]
            entries.append(GitChangeEntry(path, _parse_status_code(status)))
        return entries
    else:
        # Use git diff + ls-files for arbitrary refs
        diff_result = _run_git(
            ['diff', '--name-status', base_ref],
            cwd=repo_root
        )
        # Parse diff output (M file.py, A newfile.py, D deleted.py)
        entries = [parse_diff_line(line) for line in diff_result.stdout.split('\n')]
        
        # Add untracked files (not in diff)
        untracked = _run_git(
            ['ls-files', '--others', '--exclude-standard'],
            cwd=repo_root
        )
        entries.extend([GitChangeEntry(path, '?') for path in untracked.stdout.split('\n')])
        
        return entries
```

### 7.3 Diff Base Persistence

**File:** `app/apps/file_editor_cm6/history_store.py`

```python
class HistoryStore:
    def set_diff_base(self, project: Path, ref: str):
        project = self._normalize_project_path(project)
        self._ensure_project_exists(project)
        self._data['projects'][project]['diff_base'] = ref
        self._save()
    
    def get_diff_base(self, project: Path) -> str:
        project = self._normalize_project_path(project)
        return self._data['projects'].get(project, {}).get('diff_base', 'HEAD')
```

**Normalization** prevents cache misses from symlinks/relative paths:

```python
def _normalize_project_path(self, project: Path) -> str:
    # Resolve symlinks and make absolute
    resolved = project.resolve()
    return str(resolved)
```

---

## 8. Explorer System

The explorer underwent a major architectural refactor from REST/fetch to WebSocket-driven communication (December 2025). The previous REST-based approach required polling for updates; the new architecture enables real-time bidirectional communication.

### 8.0 Architecture Overview

**Previous Architecture (Deprecated):**
- REST endpoints for all explorer operations (`GET /explorer/tree`, `POST /explorer/create`, etc.)
- Frontend polled for git status updates
- No live notification of external file changes
- Draft status computed only on tree render

**Current Architecture (WebSocket-Driven):**

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Client)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              explorer.js (2800+ lines)                │   │
│  │  - WebSocket message handlers                         │   │
│  │  - Path-based status propagation                      │   │
│  │  - DOM-efficient updates (no full tree rebuild)       │   │
│  └──────────────────────┬───────────────────────────────┘   │
└─────────────────────────┼───────────────────────────────────┘
                          │ WebSocket (explorer_ws)
┌─────────────────────────▼───────────────────────────────────┐
│             FastAPI Backend (Python)                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           explorer_ws.py (700+ lines)                  │  │
│  │  - ConnectionManager (project-based tracking)          │  │
│  │  - Message dispatcher (explorer:*, git:*, search:*)    │  │
│  │  - Broadcast helpers (git status, draft decorations)   │  │
│  │  - File watcher integration                            │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │        explorer_helper.py / git_helper.py              │  │
│  │  - list_dir() with git flags + draft status            │  │
│  │  - Draft cache (5s TTL)                                │  │
│  │  - Git status cache (6s TTL)                           │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 8.1 WebSocket Protocol

**Connection Lifecycle:**
1. Client connects to `/ws/explorer`
2. Server registers connection with `ConnectionManager` keyed by project path
3. Server sends initial state: `project:setActive`, `explorer:setList`, `git:status`
4. Bidirectional messages flow until disconnect

**Message Types:**

| Direction | Event | Purpose |
|-----------|-------|---------|
| **Client → Server** | `explorer:list` | Request directory listing |
| | `explorer:createFile` | Create new file |
| | `explorer:createDir` | Create new directory |
| | `explorer:rename` | Rename file/directory |
| | `explorer:delete` | Delete file/directory |
| | `git:stage` | Stage files |
| | `git:unstage` | Unstage files |
| | `git:commit` | Commit with message |
| | `search:run` | Execute search |
| | `review:save` | Save draft files |
| | `review:discard` | Discard drafts |
| **Server → Client** | `explorer:setList` | Directory contents |
| | `explorer:updateDecorations` | Draft status update |
| | `explorer:updateGitStatus` | Git status update |
| | `git:status` | Full git status |
| | `git:diffBaseSet` | Diff base changed |
| | `search:setResults` | Search results |
| | `review:setEntries` | Draft file list |

### 8.2 ConnectionManager

**File:** `app/apps/file_editor_cm6/explorer_ws.py`

```python
class ConnectionManager:
    def __init__(self):
        # Map: project_path -> List[WebSocket]
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Map: websocket -> project_path (for cleanup)
        self.ws_project_map: Dict[WebSocket, str] = {}

    async def broadcast(self, project_path: str, message: Dict[str, Any]):
        """Send message to all clients connected to a specific project."""
        if project_path in self.active_connections:
            text = json.dumps(message)
            for connection in self.active_connections[project_path]:
                await connection.send_text(text)

    def has_connections(self, project_path: str) -> bool:
        return len(self.active_connections.get(project_path, [])) > 0
```

### 8.3 File Watcher Integration

The file watcher (`core_read.py`) notifies the explorer of external changes:

```python
def notify_explorer_of_change(abs_path: str, event_type: str):
    """Called by file watcher on create/modify/delete."""
    # 1. Refresh parent directory listing (debounced 250ms)
    _schedule_directory_refresh(project_path, parent_rel)
    
    # 2. Broadcast git status update (debounced 500ms)
    _schedule_git_status_broadcast(project_path)
```

This ensures:
- Directory listings update when files are created/deleted externally
- Git status propagates to all ancestor directories even when collapsed

### 8.4 Status Propagation

**Problem:** Collapsed directories don't have children in DOM, so status can't propagate via DOM traversal.

**Solution:** Path-based computation in both backend and frontend.

**Backend (`explorer_helper.py`):**
```python
# For directories: compute gitFlags from all descendants
git_flags = _derive_git_flags(rel_path, kind, status_map)
# Returns: ['modified', 'staged', 'untracked'] etc.

# For directories: check if any draft path starts with this dir
has_draft = any(d.startswith(prefix) for d in draft_rel_paths)
```

**Frontend (`explorer.js`):**
```javascript
// Compute ancestor directories from file paths
Object.entries(statuses).forEach(([rel, status]) => {
  const parts = rel.split('/');
  for (let i = 1; i < parts.length; i++) {
    const dirRel = parts.slice(0, i).join('/');
    if (OUTLINE_STATUSES.has(status)) {
      modifiedDirs.add(dirRel);
    }
  }
});

// Apply to DOM nodes that exist
modifiedDirs.forEach((dirRel) => {
  const li = root.querySelector(`li[data-rel="${dirRel}"]`);
  if (li) li.classList.add('fe-dir-has-modified');
});
```

### 8.5 Draft State Notifications

When draft state changes (file edited/saved/discarded), the explorer updates live:

```python
def notify_draft_state_changed(project_path: str):
    """Called after upsert_cached_document or clear_cached_document."""
    # Normalize path to match connection registration
    normalized_path = str(Path(project_path).resolve())
    
    # Invalidate cache
    mark_draft_cache_dirty(Path(project_path))
    
    # Schedule debounced broadcast (500ms)
    # Broadcasts explorer:updateDecorations with current draft state
```

**Frontend handler:**
```javascript
case 'explorer:updateDecorations': {
  // Step 1: Clear ALL draft flags
  root.querySelectorAll('li.fe-tree-node').forEach((li) => {
    li.classList.remove('fe-draft', 'fe-dir-has-draft');
  });
  
  // Step 2: Apply to files in DOM
  // Step 3: Compute ancestors from paths
  // Step 4: Apply fe-dir-has-draft to ancestors
  // Step 5: Mark root if any drafts exist
}
```

### 8.6 Tree Generation

**File:** `app/apps/file_editor_cm6/explorer_helper.py`

```python
def list_dir(rel: str = '.') -> dict:
    root = get_project_root()
    draft_rel_paths = _collect_project_draft_rel_paths(root)  # Cached 5s
    status_map = _get_git_status_snapshot(root)  # Cached 6s
    
    entries = []
    with os.scandir(base) as it:
        for e in it:
            rel_path = str((base / e.name).relative_to(root))
            kind = 'dir' if e.is_dir() else 'file'
            
            entries.append({
                'name': e.name,
                'rel': rel_path,
                'kind': kind,
                'gitStatus': _derive_git_status(rel_path, kind, status_map),
                'gitFlags': _derive_git_flags(rel_path, kind, status_map),
                'hasDraft': has_draft,  # For files or dirs with draft descendants
                # ... other metadata
            })
    
    return {'cwd': cwd, 'entries': entries}
```

### 8.7 Search Implementation

**Search Modes:**
1. **By Name:** Filename pattern matching
2. **By Content:** ripgrep or Python fallback
3. **By Changes:** Git diff with inline hunks
4. **Review:** Draft files with diff preview

**Search by Changes** fetches full diff data once, then filters client-side:

```javascript
function applyChangesFilter(query) {
  const regex = new RegExp(query, 'i');
  const filtered = lastChangesData.changes.map(change => {
    const filenameMatch = regex.test(change.rel);
    const matchingHunks = change.hunks.filter(hunk =>
      hunk.lines.some(line => regex.test(line.text))
    );
    
    if (filenameMatch || matchingHunks.length > 0) {
      return { ...change, hunks: matchingHunks.length > 0 ? matchingHunks : change.hunks };
    }
    return null;
  }).filter(Boolean);
  
  renderChangesList(filtered, query);
}
```

### 8.8 Hunk Header Formatting

Diff hunks display human-readable line ranges instead of git notation:

```javascript
function formatHunkHeader(hunk) {
  if (hunk.newLines === 1) {
    return `Line ${hunk.newStart}`;
  }
  return `Lines ${hunk.newStart}–${hunk.newStart + hunk.newLines - 1}`;
}
// "Lines 42–50" instead of "@@ -40,5 +42,9 @@"
```

---

---

## 8.5. Framework Shells: The Foundation

Before diving into terminal and agent integration, it's critical to understand **Framework Shells** - the process management layer that makes Code CM6's terminal drawer and AI agent possible.

### What Framework Shells Is

Framework Shells (`app/libs/framework_shells.py`) is a unified process lifecycle manager for **all long-lived background processes** in Termux Extensions 2. It provides:

**Core Capabilities:**
- PTY support for interactive shells (terminal emulation)
- STDIO support for daemons (MCP servers, aria2, etc.)
- Log capture to `~/.cache/te_framework/logs/`
- Orphan adoption on framework restart
- Graceful shutdown (SIGTERM → 2s grace → SIGKILL)
- Resource monitoring (CPU, memory, threads via psutil)
- Label-based discovery for shared services

### Shell Types

**Type 1: PTY Shells** (`uses_pty=True`)
- Interactive terminals (bash, zsh, fish)
- Full ANSI escape code support
- WebSocket streaming to xterm.js
- Resize handling (SIGWINCH)

Example: Code CM6 terminal drawer spawns:
```python
shell = await manager.spawn_shell_pty(
    command=['bash'],
    label='code-editor-terminal',
    cwd=project_root
)
# Returns shell_id → stored in HistoryStore
# WebSocket connects to /api/framework_shells/<id>/ws
```

**Type 2: STDIO Shells** (`uses_pty=False`)
- Service daemons (MCP servers, aria2, language servers)
- JSON-RPC over stdin/stdout
- No terminal emulation needed

Example: Code CM6 agent drawer spawns:
```python
shell = await manager.spawn_shell(
    command=['codex', 'mcp-server'],
    label='codex mcp-server',
    uses_pty=False
)
# Multiple conversations multiplex through this one shell
# Backend writes JSON-RPC to shell.stdin
# Backend reads JSON-RPC from shell.stdout
```

### Why Code CM6 Needs Framework Shells

**Without Framework Shells (naive approach):**
```python
# Terminal drawer
self.terminal = subprocess.Popen(['bash'], ...)
# Orphaned on crash, no logs, no monitoring, no adoption

# Agent MCP server
self.mcp_server = subprocess.Popen(['codex', 'mcp-server'], ...)
# Each conversation spawns new server? Shared server requires manual registry?
# No lifecycle management, no log capture
```

**With Framework Shells:**
```python
# Terminal drawer
shell_id = history_store.get_terminal_shell_id()
if not shell_id:
    shell = await manager.spawn_shell_pty(['bash'], label='code-editor-terminal')
    history_store.set_terminal_shell_id(shell.id)

# Logged, monitored, adopted on restart, gracefully terminated

# Agent MCP server
shell = find_shell_by_label('codex mcp-server') or \
       await manager.spawn_shell(['codex', 'mcp-server'], label='codex mcp-server')
       
# Single shared server for all conversations
# Label-based discovery, logged, monitored
```

### Lifecycle Management

**Startup (Framework Boot):**
1. Framework Shells scans `~/.cache/te_framework/meta/*.json`
2. Checks if PIDs from previous run still alive
3. Adopts living processes, marks dead ones as exited
4. Archives old logs to `preserved_logs/`

**Shutdown (Ctrl+C):**
1. IPC server receives shutdown request
2. Calls `ProcessRegistry.shutdown_all()`
3. Framework Shells terminates each shell:
   - Send SIGTERM to process group
   - Poll 2 seconds for clean exit
   - If still alive: SIGKILL (force kill)
   - Track force-killed shells → logs preserved
4. Logs moved to `preserved_logs/logs_{timestamp}/`
5. Old archives (>7 days) deleted on next boot

### Label-Based Discovery

Multiple apps can share shells:

```python
# File Manager wants aria2 daemon
aria2 = find_shell_by_label('aria2-rpc')
if not aria2:
    aria2 = spawn_shell(['aria2c', '--enable-rpc'], label='aria2-rpc')

# Download Manager also wants aria2
aria2 = find_shell_by_label('aria2-rpc')  # Finds existing shell
# Both apps use same daemon
```

### Integration Points in Code CM6

**Terminal Drawer:**
- Calls `/api/framework_shells/spawn_pty` (via terminal_backend.py)
- Stores shell_id in HistoryStore
- Connects WebSocket to `/api/framework_shells/<id>/ws`
- xterm.js renders PTY output, sends input back

**AI Agent Drawer:**
- Checks for `label='codex mcp-server'` shell
- Spawns if missing (STDIO shell, no PTY)
- Writes JSON-RPC requests to shell.stdin
- Reads JSON-RPC responses from shell.stdout
- All conversations share single MCP server instance

---

### 8.9 Git Push/Pull/Clone with Progress

Git push, pull, and clone operations use the **Job Registry** for background execution with real-time progress reporting via WebSocket.

**Why Job Registry instead of direct CLI:**
- GitPython provides structured progress callbacks (phase, percentage, message)
- No parsing of command-line progress output (escape sequences, etc.)
- Jobs are cancelable and recoverable across reconnects
- Progress UI is decoupled from the operation itself

**Architecture:**

```
Frontend                    Backend (Worker)                  Job System
─────────────────────────────────────────────────────────────────────────
Click Push
    │
    ▼
__explorerBusSend('git:push')
    │
    ▼
              handle_git_push()
                    │
                    ▼
              job_manager.create_job("git_push", {...})
              _tracked_job_ids.add(job.id)
                    │
                    ▼
              emit "git:pushStarted"  ─────────────▶  showGitProgressBar(0)
                    │
                    │                 job_git_push() runs in thread
                    │                       │
                    │                       ▼
                    │                 GitPython RemoteProgress
                    │                       │
                    │                       ▼
                    │                 ctx.set_progress(pct, detail)
                    │                       │
                    │                       ▼
                    │                 job_manager.notify_job_update()
                    │                       │
                    ◀───────────────────────┘
              _pump_job_events()
                    │
                    ▼
              emit "job:progress"  ─────────────▶  showGitProgressBar(pct)
                    │
                    │                 (on completion)
                    │                       │
                    ▼                       ▼
              emit "job:progress"  ─────────────▶  hideGitProgressBar()
              status="succeeded"                   toast("Pushed to origin")
                                                   refresh git:status
```

**Files Involved:**

| File | Purpose |
|------|---------|
| `app/libs/git_service.py` | GitPython wrappers + `@register_job_handler` |
| `app/libs/jobs.py` | Job Registry (shared framework service) |
| `explorer_ws.py` | WS handlers + job event bridge |
| `explorer.js` | Progress bar UI + event handlers |

**Job Handlers:**

```python
# app/libs/git_service.py

@register_job_handler("git_push")
def job_git_push(ctx: JobContext, params: Dict[str, Any]) -> None:
    repo_path = params.get("repo_path")
    remote = params.get("remote", "origin")
    
    def on_event(ev):
        ctx.check_cancelled()
        if "error" in ev:
            raise RuntimeError(ev["error"])
        pct = ev.get("pct", 0)
        phase = ev.get("phase", "working")
        ctx.set_progress(completed=pct, total=100, detail=phase)
    
    result = git_push_with_progress(repo_path, on_event, remote)
    if not result.get("success"):
        raise RuntimeError(result.get("error", "Push failed"))
    ctx.finish(message=f"Pushed to {remote}")

# Similar handlers: git_pull, git_clone
```

**Job Event Bridge:**

The `ExplorerDispatcher` tracks job IDs it creates and forwards only those events:

```python
class ExplorerDispatcher:
    def __init__(self, websocket):
        self._tracked_job_ids: set = set()  # Jobs we started
        self._job_queue: Queue = None
        self._job_pump_task: Task = None
    
    async def handle_git_push(self, payload, msg_id):
        job = job_manager.create_job("git_push", {...})
        self._tracked_job_ids.add(job.id)  # Track it
        await self.emit_personal("git:pushStarted", {"job_id": job.id})
    
    async def _pump_job_events(self):
        while True:
            payload = await asyncio.to_thread(self._job_queue.get, timeout=0.5)
            for job_data in payload.get("jobs", []):
                if job_data["id"] in self._tracked_job_ids:
                    await self.emit_personal("job:progress", job_data)
                    if job_data["status"] in ("succeeded", "failed", "cancelled"):
                        self._tracked_job_ids.discard(job_data["id"])
```

**Frontend Progress UI:**

```javascript
// Ephemeral progress bar at top of git footer
function showGitProgressBar(pct, detail) {
  progressBarEl.style.opacity = '1';
  progressBarEl.style.height = '3px';
  progressBarEl.style.width = `${pct}%`;
  progressTextEl.textContent = detail;
}

function hideGitProgressBar() {
  // Fade out, then reset dimensions
  progressBarEl.style.opacity = '0';
  setTimeout(() => {
    progressBarEl.style.width = '0';
    progressBarEl.style.height = '0';
  }, 300);
}

// Git status flash on change
function renderGitSummary() {
  // ... compute counts ...
  if (countsChanged) {
    gitSummaryEl.style.color = '#60a5fa';  // Flash blue
    setTimeout(() => gitSummaryEl.style.color = '', 400);
  }
}
```

**Important:** The `git_service.py` module must be imported in the **worker process** to register the job handlers. This is done via:

```python
# explorer_ws.py
import app.libs.git_service  # noqa: F401 - registers handlers
```

---

## 9. Terminal Integration

### 9.1 Framework Shell Manager

Code CM6 delegates PTY management to **Termux Extensions 2 Framework Shell Manager**:

```
┌──────────────────────────────────────────────────────────┐
│ Terminal Drawer (xterm.js)                               │
└───────────────┬──────────────────────────────────────────┘
                │ WebSocket: /ws/terminal
┌───────────────▼──────────────────────────────────────────┐
│ terminal_backend.py (Code CM6)                           │
│  - Session lifecycle (create, destroy, resize)           │
│  - CWD synchronization with project root                 │
│  - Orphan cleanup (remove stale sessions)                │
└───────────────┬──────────────────────────────────────────┘
                │ IPC calls
┌───────────────▼──────────────────────────────────────────┐
│ framework_shells.py (Framework)                          │
│  - PTY spawning (pty.fork)                               │
│  - Output streaming (async read loop)                    │
│  - Session registry (shells dict)                        │
└───────────────┬──────────────────────────────────────────┘
                │ PTY
┌───────────────▼──────────────────────────────────────────┐
│ Shell Process (bash/zsh/fish)                            │
└──────────────────────────────────────────────────────────┘
```

### 9.2 Session Persistence

**File:** `app/apps/file_editor_cm6/terminal_backend.py`

```python
@terminal_router.get('/terminal/shell-id')
async def get_terminal_shell_id():
    history_store = get_history_store()
    mgr = await get_manager()
    
    # Get stored shell ID
    shell_id = history_store.get_terminal_shell_id()
    
    # Clean up orphans (other shells with same label)
    shells = await mgr.list_shells()
    orphans = [s for s in shells if s.label == 'code-editor-terminal' and s.id != shell_id]
    for orphan in orphans:
        await mgr.terminate_shell(orphan.id)
    
    # Verify stored shell still exists
    if shell_id:
        rec = await mgr.get_shell(shell_id)
        if not rec or rec.status != 'running':
            # Stale ID - clear it
            history_store.set_terminal_shell_id(None)
            shell_id = None
    
    return {'shellId': shell_id}
```

### 9.3 CWD Synchronization

When project changes, terminal CWD must update:

```python
@app.post('/project/open')
async def project_open(data: dict):
    project_path = Path(data['path'])
    
    # Update project root
    set_project_root(project_path)
    _history_store.set_active_project(project_path)
    
    # Notify terminal to change CWD
    # (Frontend listens for project-change event and sends `cd <path>`)
    
    return {'success': True}
```

**Frontend:**
```javascript
socket.on('project-changed', async (data) => {
  // Send cd command to terminal
  if (terminalShellId) {
    terminalWs.send(JSON.stringify({
      type: 'input',
      data: `cd ${data.projectRoot}\n`
    }));
  }
});
```

---

## 10. AI Agent Bridge

### 10.1 Multi-Adapter Architecture

**File:** `app/apps/file_editor_cm6/agent_bridge.py` (800+ lines)

Supports **three AI backends**:
1. **OpenAI Codex** (GPT-4, GPT-3.5)
2. **Google Gemini** (Gemini Pro, Gemini Ultra)
3. **MCP Protocol** (Model Context Protocol for local/custom models)

```python
class AgentBridge:
    def __init__(self, model: str, api_key: str):
        if model.startswith('gpt-'):
            self.adapter = CodexAdapter(model, api_key)
        elif model.startswith('gemini-'):
            self.adapter = GeminiAdapter(model, api_key)
        else:
            raise ValueError(f'Unknown model: {model}')
    
    async def send_message(self, messages: list) -> AsyncIterator[str]:
        async for chunk in self.adapter.stream(messages):
            yield chunk
```

### 10.2 IPC Protocol

**File:** `app/apps/file_editor_cm6/ipc_stack/protocol.py`

Agents can request file operations via **IPC messages**:

```python
# Agent → App
{
  "type": "ipc_request",
  "operation": "read_file",
  "params": {"path": "/project/file.py"}
}

# App → Agent
{
  "type": "ipc_response",
  "operation": "read_file",
  "success": true,
  "data": {"content": "...", "encoding": "utf-8"}
}
```

**Handler** (`ipc_stack/agent_handler.py`):

```python
async def handle_ipc_request(request: dict) -> dict:
    operation = request['operation']
    params = request['params']
    
    if operation == 'read_file':
        path = Path(params['path'])
        content = path.read_text()
        return {'success': True, 'data': {'content': content}}
    
    elif operation == 'write_file':
        path = Path(params['path'])
        content = params['content']
        path.write_text(content)
        return {'success': True}
    
    else:
        return {'success': False, 'error': f'Unknown operation: {operation}'}
```

### 10.3 Conversation Persistence

**File:** `app/apps/file_editor_cm6/conversation_store.py`

Conversations stored as JSON files:

```python
class ConversationStore:
    def save_conversation(self, conv_id: str, messages: list):
        path = self.conv_dir / f'{conv_id}.json'
        path.write_text(json.dumps({
            'id': conv_id,
            'created': time.time(),
            'messages': messages
        }, indent=2))
    
    def load_conversation(self, conv_id: str) -> Optional[dict]:
        path = self.conv_dir / f'{conv_id}.json'
        if not path.exists():
            return None
        return json.loads(path.read_text())
```

---

## 11. State Management

### 11.1 Persistence Stores

Code CM6 uses three JSON-based stores for durable state:

#### 11.1.1 HistoryStore

**File:** `~/.local/share/termux-extensions-2/code_oss_history.json`  
**Class:** `app/apps/file_editor_cm6/history_store.py`

Stores:
- Active project path
- Recent files per project (LRU list)
- Terminal shell ID per project
- Diff base ref per project

**Schema:**
```json
{
  "active_project": "/path/to/project",
  "recent_projects": ["/path/to/project1", "/path/to/project2"],
  "projects": {
    "/path/to/project": {
      "recent_files": ["file1.py", "file2.js"],
      "diff_base": "HEAD",
      "terminal_shell_id": "abc123"
    }
  },
  "session_state": {},
  "session_cache": {}
}
```

#### 11.1.2 PreferencesStore

**File:** `~/.local/share/termux-extensions-2/code_oss_prefs.json`  
**Class:** `app/apps/file_editor_cm6/preferences_store.py`

Stores:
- Editor preferences (theme, font scale, word wrap, etc.)
- UI preferences (assistant collapsed, git indicators)
- Per-project preferences (last opened file)

**Key Feature:** NO in-memory cache - disk is always authority. Reads directly from disk on every request to ensure convergence across multiple clients.

**Schema:**
```json
{
  "editor": {
    "theme": "cm6-dark",
    "fontScale": 0.85,
    "wordWrap": false,
    "showIndentGuides": false,
    "showLineShading": false,
    "showInlineDiffs": true,
    "colorPicker": true
  },
  "ui": {
    "assistantCollapsed": true,
    "gitIndicators": true
  },
  "projects": {}
}
```

#### 11.1.3 Session Cache

**Directory:** `~/.cache/cm6_sessions/`  
**Managed by:** `HistoryStore._session_cache_dir`

Stores per-file crash recovery data:
- Unsaved editor content
- Base SHA (for collision detection)
- Timestamp

**File naming:** `~/.cache/cm6_sessions/<hash>.json` where hash is derived from file path

**Schema:**
```json
{
  "content": "...",
  "base_sha256": "a1b2c3d4",
  "timestamp": 1700000000
}
```

**Purpose:** Crash recovery when autosave is OFF. When the user enables autosave the iframe stops writing sidecars altogether (the buffer hits disk every ~450 ms), so the cache directory stays empty until autosave is disabled again.

### 11.2 Store Lifecycle & Convergence

The store architecture is designed for **zero-drift multi-client convergence**:

```python
# Initialization (app startup)
_history_store = HistoryStore()  # ~/.local/share/termux-extensions-2/code_oss_history.json
_preferences_store = PreferencesStore()  # ~/.local/share/termux-extensions-2/code_oss_prefs.json

# Read (always from disk - no cache)
project = _history_store.get_active_project()
theme = _preferences_store.get_preference('editor', 'theme', 'cm6-dark')

# Write (atomic with lock)
_history_store.add_recent_file(project, 'file.py')
_preferences_store.update_preferences(editor={'theme': 'monokai'})

# Persistence handled automatically in setters via _save()
```

**Why No Cache?**

The PreferencesStore intentionally has **NO in-memory cache**. Every read goes to disk. This ensures:

1. **Multi-Device Convergence:** Desktop and mobile always read the same state
2. **Real-Time Sync:** Change on desktop → mobile sees it on next read (sub-second)
3. **Zero Drift:** No stale cache to invalidate or synchronize
4. **Crash Resilience:** Preferences always reflect last write, even after crashes

**Performance:** Reading from disk is fast enough (~1-5ms) that caching provides no benefit, and the architectural simplicity is worth the microsecond cost.

**Framework Integration:**

Code CM6 stores live in `~/.local/share/termux-extensions-2/` alongside other framework app data. The framework itself maintains:
- `~/.cache/termux_extensions/state_store.json` - Cross-app state
- `~/.cache/termux_extensions/settings.json` - Framework settings
- `~/.cache/te_framework/` - Logs, PIDs, run metadata

---

## 11.5. Multi-Device Convergence Architecture

### The Convergence Model

Code CM6 implements **real-time multi-device convergence** - multiple clients (desktop browser, mobile browser, external editors) operate on the same backend simultaneously with live synchronization.

**Key Use Case:** Termux running on phone (static IP `192.168.1.100:8088`), desktop browser connected remotely. Edit on desktop → changes appear instantly on phone. Edit in vim on phone → both browsers update in real-time.

### How It Works

```
Desktop Browser (192.168.1.100:8088)
         ↓ HTTP + WebSocket
    [Framework on Termux Device]
         ↑ HTTP + WebSocket
Mobile Browser (localhost:8088)
         ↑ File Watcher
    [External Editor: vim/nano]
```

All clients share:
- Same `HistoryStore` (recent files, active project)
- Same `PreferencesStore` (theme, settings)
- Same file watcher subscriptions
- Same session cache

### Zero-Cache Design

**No frontend state caching.** Every read goes to the Application Backend which reads from disk:

```javascript
// Frontend: NO state caching
async function openFile(path) {
  // Always fetch from backend (which reads disk)
  const response = await fetch(`/api/app/file_editor_cm6/read?path=${path}`);
  const data = await response.json();
  
  // Display in editor
  editor.setContent(data.content);
  currentSHA = data.sha256;  // Only SHA for collision detection
}
```

**Backend: Always read from disk**

```python
@app.get('/read')
def read_file(path: str):
    # Read from disk (NO cache)
    content = Path(path).read_text()
    sha256 = hashlib.sha256(content.encode()).hexdigest()
    
    return {"content": content, "sha256": sha256}
```

### Live Update Flow

**Scenario:** User types on desktop while file is open on mobile

1. **Desktop types:** Character entered in editor
2. **Desktop debounces:** Wait 1s for typing pause
3. **Desktop saves:** `POST /write` with new content + base SHA
4. **Backend writes:** Atomic write to disk
5. **File watcher detects:** External modification event
6. **WebSocket broadcast:** All subscribed clients notified
7. **Mobile receives:** WebSocket message with new content
8. **Mobile updates:** Editor content refreshed (preserving cursor if not editing)

**Result:** Sub-second latency across network. Feels local.

### Collision Prevention

**Base SHA Validation** prevents conflicts:

```python
def write_full(path, content, base_sha256):
    current = _get_file_meta(path)
    
    if base_sha256 and base_sha256 != current['sha256']:
        # File changed since client loaded it
        raise BaseMismatchError("File modified externally")
    
    # Atomic write
    temp = path.with_suffix('.tmp')
    temp.write_text(content)
    os.replace(temp, path)  # Atomic
```

**Last write wins.** If two clients write simultaneously:
1. First write succeeds
2. Second write gets 409 Conflict
3. Second client refetches content
4. User manually resolves or re-saves

No CRDT. No OT. Just atomic writes with SHA validation.

### Performance Characteristics

| Operation | Local | Remote (LAN) | Remote (WAN) |
|-----------|-------|--------------|--------------|
| Open file | ~50ms | ~100ms | ~200-500ms |
| Save file | ~30ms | ~80ms | ~150-400ms |
| Live update notification | ~10ms | ~50ms | ~100-300ms |
| Read preferences | ~5ms | ~20ms | ~50-150ms |

**Why so fast?**
- No sync protocol overhead (just HTTP/WebSocket)
- No cache invalidation (there is no cache)
- No conflict resolution algorithm (SHA validation is O(1))
- Backend on device is single source of truth

### Framework Integration

The Termux Extensions 2 framework provides the infrastructure:

1. **Process Management:** IPC server tracks all worker processes
2. **WebSocket Multiplexing:** Routes updates to correct subscribers
3. **Shell Manager:** Provides PTY streaming for terminal drawer
4. **Stateless Endpoints:** Forces disk reads for convergence

Code CM6 is just one app using this platform. Other apps (file explorer, terminal) follow the same pattern.

---

## 12. WebSocket Architecture

### 12.1 Multiplexed WebSocket Routing

Code CM6 uses **three WebSocket endpoints**:

1. **`/ws/read`** — File change notifications
2. **`/ws/agent`** — AI agent streaming
3. **`/ws/terminal`** — PTY I/O

Each WebSocket has dedicated handler with connection lifecycle:

```python
@app.websocket('/ws/read')
async def ws_read(websocket: WebSocket):
    await websocket.accept()
    
    # Generate client ID
    client_id = str(uuid.uuid4())
    
    # Message loop
    try:
        while True:
            message = await websocket.receive_json()
            
            if message['action'] == 'subscribe':
                token = subscribe(message['path'], lambda event: 
                    asyncio.create_task(websocket.send_json(event))
                )
                await websocket.send_json({'token': token})
            
            elif message['action'] == 'unsubscribe':
                unsubscribe(message['token'])
    
    except WebSocketDisconnect:
        # Cleanup subscriptions for this client
        cleanup_client_subscriptions(client_id)
```

### 12.2 Reconnection Logic

**File:** `static/js/reconnecting_websocket.js` (5900+ characters)

Wraps native WebSocket with exponential backoff:

```javascript
class ReconnectingWebSocket {
  constructor(url, protocols, options) {
    this.url = url;
    this.reconnectInterval = options.reconnectInterval || 1000;
    this.maxReconnectInterval = options.maxReconnectInterval || 30000;
    this.reconnectDecay = options.reconnectDecay || 1.5;
    
    this.connect();
  }
  
  connect() {
    this.ws = new WebSocket(this.url);
    
    this.ws.onopen = (e) => {
      this.reconnectInterval = 1000;  // Reset backoff
      this.onopen && this.onopen(e);
    };
    
    this.ws.onclose = (e) => {
      this.onclose && this.onclose(e);
      
      // Exponential backoff
      setTimeout(() => this.connect(), this.reconnectInterval);
      this.reconnectInterval = Math.min(
        this.reconnectInterval * this.reconnectDecay,
        this.maxReconnectInterval
      );
    };
  }
  
  send(data) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      // Queue or drop message
      console.warn('WebSocket not open, dropping message');
    }
  }
}
```

---

## 13. Session Cache

### 13.1 Architecture

Session cache captures **drafts** when autosave is disabled:

```
User types in editor
       ↓
Debounced snapshot (1s delay)
       ↓
POST /session/cache with {path, content, base_sha}
       ↓
Backend writes to ~/.cache/cm6_sessions/<hash>.json
       ↓
Draft badge appears in explorer
```

When autosave is ON the debounce path short-circuits (no sidecars are written, only cache-state telemetry is broadcast). This keeps the cache directory clean while still providing the draft badge/diff overlays whenever autosave is OFF.

### 13.2 Collision Detection

**Problem:** Prevent overwriting newer disk content with stale cache

**Solution:** Base SHA validation

```python
@app.post('/write')
async def write_file_route(data: dict):
    path = Path(data['path'])
    content = data['content']
    client_base_sha = data.get('base_sha')
    
    # Get current disk SHA
    current_meta = _get_file_meta(path)
    disk_sha = current_meta['sha']
    
    # Collision check
    if client_base_sha and client_base_sha != disk_sha:
        raise BaseMismatchError(
            'File was modified externally. Reload to see changes.',
            disk_content=path.read_text(),
            disk_sha=disk_sha
        )
    
    # Write if safe
    write_full(path, content)
    return {'success': True, 'new_sha': _get_file_meta(path)['sha']}
```

### 13.3 Cache Cleanup

**Manual discard:**
```python
@app.delete('/session/cache')
def delete_session_cache(path: str):
    cache_path = _get_cache_path(path)
    if cache_path.exists():
        cache_path.unlink()
    return {'success': True}
```

**Watcher invalidation:**
```python
def _notify_subscribers(path: str, event: dict):
    # Clear session cache on external modification
    _delete_session_cache(path)
    
    # Notify subscribed clients
    for callback in _subscribers.get(path, {}).values():
        callback(event)
```

### 13.4 Cold Start / Page Load Flow

On page load, the editor restores state from the SSOT without redundant file operations:

1. **Backend Initialization (`editor_app.py:editor_page`):**
   - Reads `lastFile` from `_history_store.get_last_file()`
   - Checks for cached draft via `_history_store.get_cached_document()`
   - Creates NiceGUI editor with content already loaded (draft or disk)
   - Applies diff decorations immediately
   - Subscribes to file watcher

2. **Host Sync (`main.js:main`):**
   - Fetches `/state` endpoint which returns `lastFile`, `lastFileSha256`, etc.
   - **Does NOT call `openFile()`** - just syncs bookkeeping variables
   - Updates `currentPath`, `lastSha256`, `currentModeLanguage`
   - Opens WebSocket for file watching
   - Only calls `openFile()` if URL parameter requests a DIFFERENT file

3. **Cache State Broadcast:**
   - Backend broadcasts `cm6-cache-state` with `reason: 'restore'` for drafts
   - Host receives and updates draft indicator accordingly

**Key Insight:** Both host and iframe read from the same SSOT, so they arrive at the same answer without synchronization. The host trusts the backend's state and doesn't re-issue commands.

### 13.5 File Watcher Integration

The file watcher (`core_read.py`) monitors open files and broadcasts changes:

- **Ignored Events:** If a watcher event's SHA matches the draft's `base_sha256`, the event is ignored (prevents self-echo)
- **Content Replacement:** Only applied when external changes are detected
- **Diff Recalculation:** Only triggered if `_apply_watcher_replace()` actually applied content

```python
was_applied = _apply_watcher_replace(path, content, sha256, project_path)
if was_applied and showInlineDiffs:
    editor.set_diff_decorations(hunks)  # Only if content changed
```

### 13.6 Explorer + Review UI

* **Server Metadata (`explorer_helper.list_dir`):** Directory listings now include `hasDraft` by reading `HistoryStore.list_project_drafts`. Tree nodes receive `.fe-draft` classes during render—no polling required.
* **Review Overlay (`static/js/explorer.js:2894-3109`):** The “Review” search tab scans `/review/list`, renders inline draft hunks, and attaches `data-line` attributes to headers/rows. Clicking a hunk calls `openFileAndMaybeJump(rel, line)`, mirroring the existing “Search by Changes” UX.
* **Bulk Ops:** `/review/save` reuses `_write_editor_buffer_to_disk` and emits save acks/diff invalidations so git status, diff cache, and explorer badges stay consistent after batch writes.

### 13.7 Draft Diff Rendering + Minimap

* **Diff Tags:** Draft hunks are tagged as `add-draft` / `del-draft`; CodeMirror decorations emit `diffKind: 'insert-draft' | 'delete-draft'`.
* **Gutters:** `DeletedLineNumberMarker` and `MinusDraftGutterMarker` switch to yellow classes when `isDraft` is true, while git deletions keep the legacy red palette.
* **Minimap (`codemirror.js:300-344`, `applyMinimapMode`):** The minimap scans the diff field and builds color buckets per diffKind—green/red for git, blue/yellow for drafts—so the tiny view mirrors the main gutter.
* **Autosave Behavior:** When autosave is ON, `_persist_to_cache_debounced()` skips sidecar writes but still emits a `mid_session` cache state until the disk write succeeds. Draft diffs are suppressed during autosave to prevent duplicate highlights.

---

## 14. IPC Protocol

### 14.1 Message Format

**Requests:**
```json
{
  "type": "ipc_request",
  "request_id": "uuid",
  "operation": "read_file",
  "params": {"path": "/project/file.py"}
}
```

**Responses:**
```json
{
  "type": "ipc_response",
  "request_id": "uuid",
  "success": true,
  "data": {"content": "..."}
}
```

### 14.2 Operation Handlers

**File:** `ipc_stack/agent_handler.py`

```python
async def handle_read_file(params: dict) -> dict:
    path = Path(params['path'])
    if not path.exists():
        return {'success': False, 'error': 'File not found'}
    
    content = path.read_text()
    return {'success': True, 'data': {'content': content}}

async def handle_write_file(params: dict) -> dict:
    path = Path(params['path'])
    content = params['content']
    
    # Use core_write for collision detection
    write_full(path, content)
    
    return {'success': True}

async def handle_list_dir(params: dict) -> dict:
    path = Path(params['path'])
    entries = [str(p.name) for p in path.iterdir()]
    return {'success': True, 'data': {'entries': entries}}
```

### 14.3 Conversation Context

Agent receives context on every request:

```python
{
  "context": {
    "current_file": "/project/main.py",
    "project_root": "/project",
    "selection": {"start": 10, "end": 25},
    "cursor_line": 15
  }
}
```

This enables context-aware responses:
- "Fix this function" → Agent knows which function (from selection)
- "Add a test" → Agent knows project structure (from project_root)
- "Explain this line" → Agent knows cursor position

---

## 15. Performance Optimizations

### 15.1 Lazy Rendering

**Explorer tree:**
- Render only visible entries (viewport-based virtualization planned)
- Lazy load children on expand (not all at once)
- Debounce search input (300ms delay)

**Search results:**
- Limit to first 500 matches
- Render incrementally (batch of 50)
- Cancel pending renders on new search

### 15.2 Diff Caching

**Three-tier cache key:**
- Project root (allow multiple projects)
- File path (per-file granularity)
- Base ref (HEAD vs. branches)

**Cache hits:**
- Inline diff load: ~5ms (cached) vs. ~100ms (git diff)
- Explorer status badges: ~10ms (cached) vs. ~200ms (git status)

**TTL:** 60 seconds (balance freshness vs. performance)

### 15.3 Debounced Operations

| Operation | Debounce | Reason |
|-----------|----------|--------|
| File watcher events | 150ms | Batch rapid changes (git checkout) |
| Session cache writes | 1000ms | Reduce disk I/O on typing |
| Explorer search input | 300ms | Wait for user to finish typing |
| Window resize | 100ms | Throttle layout recalculations |

### 15.4 WebSocket Batching

File watcher can batch notifications:

```python
# Instead of sending 10 separate messages:
for path in changed_paths:
    await websocket.send_json({'path': path, ...})

# Send one batch:
await websocket.send_json({
    'type': 'batch',
    'events': [{'path': p, ...} for p in changed_paths]
})
```

---

## 16. Jump-To-Line Pipeline

The jump-to-line mechanism is used by multiple features:

- Explorer search overlay:
  - **By Contents** (content search)
  - **By Changes** (git diffs)
  - **Review Edits** (draft diff review)
- Editor menu:
  - **Go To Line…**

The pipeline is structured to respect the three-layer architecture (app backend → host → NiceGUI iframe) and to give callers explicit control over whether the editor should grab focus (important for mobile keyboard behavior).

### 16.1 Host-Side Entry Point (`jumpToCurrentFileLine`)

- **File:** `app/apps/file_editor_cm6/main.js`
- **Function:** `jumpToCurrentFileLine(line, options)`

Responsibilities:

- Validate:
  - Ensure `window.currentPath` is set (a file is open).
  - Parse and validate the target `line` (must be ≥ 1).
- Build payload:
  - `{ line: <int>, focus?: <bool> }`
- Call:
  - `POST /api/app/file_editor_cm6/editor/jump_to_line`

Focus control:

- `options.focus` is optional; if provided, it is forwarded as `focus` in the payload.
- If omitted, the backend treats `focus` as `True` (backwards compatible).

Usage patterns:

- Editor menu “Go To Line…” calls `jumpToCurrentFileLine(line)` with no options:
  - Expected to **focus** the editor and show the virtual keyboard.
- Search/Review actions use `jumpToCurrentFileLine(line, { focus: false })` via `openFileAndMaybeJump`:
  - Expected to **scroll only** without forcing focus.

### 16.2 Explorer Integration (`openFileAndMaybeJump`)

- **File:** `app/apps/file_editor_cm6/static/js/explorer.js`
- **Function:** `openFileAndMaybeJump(rel, lineNumber, jumpOptions)`

Responsibilities:

1. Open the file using the unified project-aware path:
   - `window.appOpenFileRel(rel, currentProjectPath)`
2. On mobile, close the drawer after opening:
   - `closeDrawerIfMobile()`
3. Expand the explorer tree to reveal the file:
   - `expandDirectory(treeElement, dirPath)`
4. If a target `lineNumber` is provided:
   - Wait a short delay (to allow the iframe/editor to render).
   - Call `window.jumpToCurrentFileLine(lineNumber, jumpOptions)`.

Key call sites:

- Search by Changes:
  - `openFileAndMaybeJump(change.rel, firstDiffLine(change), { focus: false })`
- Review Edits:
  - Group click and file title click both use `{ focus: false }`.

### 16.3 NiceGUI Iframe Backend (`/editor/jump_to_line`)

- **File:** `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- **Endpoint:** `POST /editor/jump_to_line`

Responsibilities:

- Resolve the active editor instance.
- Validate `line` (coerce to `int`, reject invalid values).
- Interpret `focus`:
  - `focus is None` → `should_focus = True`.
  - Otherwise, `should_focus = bool(focus)`.
- Call the vendored CodeMirror wrapper:

```python
editor.jump_to_line(target_line, focus=should_focus)
```

Return payload (for debugging / tooling):

- `{ "ok": True, "line": <int>, "focus": <bool> }`

### 16.4 Vendored CodeMirror Wrapper (Python)

- **File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.py`
- **Method:** `CodeMirrorEditor.jump_to_line`

Responsibilities:

- Provide a stable Python API over the vendored JS method.
- Bridge `line` and `focus` arguments into a JS payload:

```python
def jump_to_line(self, line: int, *, focus: bool = True) -> None:
    self.run_method('jumpToLine', {"line": line, "focus": focus})
```

### 16.5 Vendored CodeMirror Implementation (JS)

- **File:** `app/static/vendor/nicegui/elements/codemirror/codemirror.js`
- **Method:** `jumpToLine(payload)`

Responsibilities:

- Accept either:
  - A raw line number, or
  - An object `{ line, focus }`.
- Compute the target position:
  - Clamp line to `[1, doc.lines]`.
  - Resolve `doc.line(targetLine).from`.
- Dispatch a CM6 update:

```js
this.editor.dispatch({
  selection: { anchor: pos },
  scrollIntoView: true
});
```

- Decide focus:
  - Default `shouldFocus = true`.
  - If `payload.focus` is present, use that boolean.
  - Only call `this.editor.focus()` when `shouldFocus` is true.

### 16.6 Design Notes & Guidelines

- **Respect the state hierarchy:**
  - The host (main.js) remains responsible for current file context and path tracking.
  - The NiceGUI iframe backend only scrolls within the currently loaded document.
- **Focus is an explicit concern:**
  - Features must decide whether they intend to grab focus and show the keyboard.
  - The focus flag is the single point of truth; avoid ad-hoc `focus()` calls.
- **Extending to new features:**
  - New “jump-like” features (e.g., “Jump to Definition”) should:
    - Use `openFileAndMaybeJump` if they need to switch files.
    - Call `jumpToCurrentFileLine(line, { focus: true/false })` based on UX needs.
    - Avoid direct DOM manipulation in the iframe; always go through `/editor/jump_to_line`.

---

## Appendix: File Structure Summary

```
app/apps/file_editor_cm6/
├── Backend (Python)
│   ├── main.py                    # FastAPI router (650 lines)
│   ├── core_read.py               # File watcher (500 lines)
│   ├── core_write.py              # Write handler (300 lines)
│   ├── diff_helper.py             # Diff caching (400 lines)
│   ├── git_helper.py              # Git CLI wrappers (800 lines)
│   ├── explorer_helper.py         # Tree generation (500 lines)
│   ├── edit_tracker.py            # Live edits (200 lines)
│   ├── history_store.py           # Recent files (300 lines)
│   ├── preferences_store.py       # User prefs (200 lines)
│   ├── terminal_backend.py        # Terminal routes (400 lines)
│   ├── terminal_shell.py          # Shell adapter (200 lines)
│   ├── agent_ws.py                # Agent WebSocket (300 lines)
│   ├── agent_bridge.py            # AI adapters (800 lines)
│   ├── agent_routes.py            # Agent REST (300 lines)
│   └── stores.py                  # Store singletons (50 lines)
│
├── Frontend (JavaScript)
│   ├── main.js                    # App shell (2100 lines)
│   ├── template.html              # HTML layout (1600 lines)
│   └── static/js/
│       ├── explorer.js            # File tree (2500 lines)
│       ├── explorer.css           # Drawer styles (600 lines)
│       ├── terminal.js            # xterm.js wrapper (400 lines)
│       ├── diff_decorations.js    # CM6 diffs (350 lines)
│       ├── agent_drawer.js        # AI UI (1400 lines)
│       └── reconnecting_websocket.js (200 lines)
│
├── NiceGUI Editor (Vendored)
│   └── nicegui_editor/
│       └── editor_app.py          # CM6 Python API (800 lines)
│
└── IPC Stack
    └── ipc_stack/
        ├── protocol.py            # Message format (100 lines)
        ├── agent_handler.py       # Operation handlers (400 lines)
        └── conversation.py        # Context management (200 lines)

Total: ~7000 lines Python, ~8000 lines JavaScript
```

---

## Conclusion

Code CM6 is a **production-grade code editor** built with modern web technologies and designed for extensibility. Its architecture demonstrates:

1. **Clean separation of concerns** (backend state, frontend presentation, iframe isolation)
2. **Performance-first design** (caching, debouncing, lazy rendering)
3. **Progressive enhancement** (graceful degradation when optional tools unavailable)
4. **Mobile-first responsive** (touch, keyboard, adaptive layouts)
5. **Framework integration** (leverages Termux Extensions 2 infrastructure)

The codebase is structured for **contribution**: modular stores, clear APIs, comprehensive documentation, and well-tested patterns. Whether extending Git features, adding CM6 extensions, or integrating new AI models, the architecture provides clean extension points without requiring deep framework knowledge.

---

**Next Steps for Contributors:**

1. Read `docs/core/nicegui_iframe_feature_adding_guideline.md` for adding features
2. Review `notes/2025-11-17_LESSONS_LEARNED.md` for implementation patterns
3. Explore `notes/` directory for feature-specific deep dives
4. Check `notes/2025-11-16_Short_Term_File_Editor_TODO.md` for active work
5. Join development discussions on GitHub Issues

**Technical Support:**

For questions about architecture, implementation details, or contribution:
- GitHub Issues: https://github.com/yourusername/termux-extensions-2/issues
- Documentation: `/docs` directory in repository
- Code examples: Implementation notes in `/notes` directory

---

## 16. Color Picker Extension

### 16.1 @uiw Integration

**Status:** ✅ Completed 2025-11-19

**Package:** `@uiw/codemirror-extensions-color@^4.25.3`

---

## 17. Minimap Extension

### 17.1 Architecture

**Status:** ✅ Completed 2025-11-24

The minimap implementation uses a **responsive hybrid architecture** that adapts to device constraints while maintaining a unified codebase.

**Component Stack:**
1. **Vendor Layer:** `@replit/codemirror-minimap` bundled into `nicegui-codemirror`.
2. **Wrapper Layer (`codemirror.js`):**
   - Watches `showMinimap` prop (user preference).
   - Watches `window.matchMedia` (device capabilities).
   - Computes mode: `desktop` (sidebar), `mobile` (overlay), or `off`.
   - Uses a **Compartment** to hot-swap configuration without re-initializing.
3. **Presentation Layer (`editor_app.py` CSS):**
   - **Desktop:** `position: fixed`, opaque background, pushes editor content via padding.
   - **Mobile:** `position: fixed`, transparent overlay, fades in on scroll activity.

### 17.2 Diff Integration

The minimap is deeply integrated with the **Inline Diff Pipeline** (Section 6). It visualizes git changes by scanning the existing diff decorations.

**Data Flow:**
1. `buildDiffDecorations` tags editor decorations with metadata:
   ```javascript
   Decoration.line({ diffKind: 'insert' })
   Decoration.widget({ diffKind: 'delete' })
   ```
2. `diffMinimapGuttersFromDecorations` scans the active `DecorationSet`.
3. Minimap `compute` function receives `diffField` as a dependency.
4. Markers are rendered into the minimap gutter using the extension's API.

This ensures the minimap is always in sync with the editor's inline diffs with zero additional network overhead (reuses existing diff data).

The CSS color picker extension was vendored following the same pattern as indentation guides:

**Installation:**
```bash
cd app/static/vendor/nicegui/elements/codemirror
npm install --save @uiw/codemirror-extensions-color
npm run build
```

**Export** (`src/index.mjs`):
```javascript
export { color } from '@uiw/codemirror-extensions-color';
```

**Integration** (`codemirror.js`):
```javascript
const colorPicker = typeof CM.color === 'function' ? CM.color : null;

// In setupExtensions()
if (colorPicker) {
  extensions.push(colorPicker());
}
```

### 16.2 Features

- **Inline Color Swatches:** Visual color preview next to color literals
- **Color Picker UI:** Click swatch to open color picker dialog
- **Format Support:** hex, rgb, rgba, hsl, hsla, named colors
- **Live Preview:** Updates code as color is adjusted

### 16.3 Architecture Notes

Unlike toggleable features (zebra stripes, indentation guides), the color picker is **always active** - it automatically detects CSS color values in the document and adds the UI elements. No compartment or toggle required.

---

## 17. Search by Changes Implementation

### 17.1 Architecture

**File:** `app/apps/file_editor_cm6/main.py` (endpoint: `/explorer/search?mode=changes`)

Three-layer implementation:

1. **Backend:** Fetches git worktree changes against stored diff base
2. **Transport:** Sends full change list + diffs to frontend once
3. **Frontend:** Client-side filtering for instant search experience

### 17.2 Backend Logic

```python
def _search_by_changes(project_root: Path) -> dict:
    base_ref = _history_store.get_diff_base(project_root)
    changes = get_worktree_changes(project_root, base_ref)
    
    results = []
    for change in changes[:CHANGE_RESULT_LIMIT]:
        file_path = project_root / change.path
        diff_data = collect_diff(project_root, file_path, base_ref)
        
        results.append({
            'rel': change.path,
            'status': change.status,
            'statusText': STATUS_TEXT_MAP[change.status],
            'hunks': diff_data['hunks']  # Full unified diff
        })
    
    return {
        'mode': 'changes',
        'base_ref': base_ref,
        'changes': results,
        'truncated': len(changes) > CHANGE_RESULT_LIMIT
    }
```

### 17.3 Client-Side Filtering

**File:** `static/js/explorer.js`

Three filter modes:

1. **Standard:** Filename OR Content match → shows full file context
2. **Filename Only:** Only filename matches → ignores content
3. **Hunks Only:** Only content matches → shows only matching hunks per file

```javascript
function applyChangesFilter(query, filterMode) {
  if (!query) {
    renderChangesList(lastChangesData.changes);
    return;
  }
  
  const regex = new RegExp(query, 'i');
  
  const filtered = lastChangesData.changes.map(change => {
    const filenameMatch = regex.test(change.rel);
    const matchingHunks = change.hunks.filter(hunk =>
      hunk.lines.some(line => regex.test(line.text))
    );
    
    if (filterMode === 'filename' && !filenameMatch) return null;
    if (filterMode === 'hunks' && matchingHunks.length === 0) return null;
    if (filterMode === 'standard' && !filenameMatch && matchingHunks.length === 0) return null;
    
    return {
      ...change,
      hunks: filterMode === 'hunks' ? matchingHunks : change.hunks
    };
  }).filter(Boolean);
  
  renderChangesList(filtered, query);
}
```

### 17.4 Highlighting

Two distinct highlighting styles:

```css
/* Filenames: Dark text on light background */
.fe-highlight-file {
  color: #0f172a;
  background-color: #e2e8f0;
  padding: 0 2px;
  border-radius: 2px;
}

/* Diff content: White text on semi-transparent gray */
.fe-highlight-text {
  color: #ffffff;
  background-color: rgba(148, 163, 184, 0.18);
  padding: 0 2px;
  border-radius: 2px;
}
```

---

## 18. Explorer Rewrite (Card-Based UI)

### 18.1 Timeline

**Date:** 2025-11-16  
**Checkpoints:** A (Visual redesign), B (Select mode + batch ops), C (Git integration)

### 18.2 Key Changes

**Before:**
- Simple list with text labels
- Limited context menu
- No batch operations

**After:**
- Card-based layout with 4-column grid (twisty, icon, label, menu)
- Persistent context menus per card
- Select mode with checkboxes
- Batch operations (copy, move, delete, stage, unstage)
- Git actions (init, restore, stage/unstage)
- Solid backgrounds with mobile-optimized tap handling

### 18.3 Technical Improvements

**CSS Architecture:**
```css
/* Card grid */
.fe-entry-card {
  display: grid;
  grid-template-columns: 20px 24px 1fr auto;
  gap: 8px;
  padding: 8px;
  background: var(--explorer-card-bg);
}

/* Select mode checkbox (hidden by default) */
.fe-entry-checkbox {
  display: none;
}

.fe-tree-select-mode .fe-entry-checkbox {
  display: block;
}
```

**Menu Positioning:**
```javascript
function showCardMenu(button, entry) {
  const menu = document.getElementById('fe-card-menu');
  const rect = button.getBoundingClientRect();
  
  // Position to left of button (prevents mobile overflow)
  menu.style.left = `${rect.left - menu.offsetWidth}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  
  // Clamp to viewport
  const menuRect = menu.getBoundingClientRect();
  if (menuRect.left < 0) {
    menu.style.left = '8px';
  }
  if (menuRect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - menuRect.width - 8}px`;
  }
}
```

---

## 19. Performance Benchmarks

### 19.1 Diff Pipeline

| Operation | Uncached | Cached | Cache Hit Rate |
|-----------|----------|--------|----------------|
| Inline diff (single file) | ~100ms | ~5ms | ~95% |
| Explorer status badges | ~200ms | ~10ms | ~90% |
| Search by changes (50 files) | ~2000ms | ~50ms | ~85% |

### 19.2 File Operations

| Operation | Latency | Notes |
|-----------|---------|-------|
| Open file (local) | ~50ms | Read + parse + SHA |
| Save file (local) | ~30ms | Write + invalidate cache |
| File watcher notification | ~10ms | Debounced, batched |
| Explorer tree render (100 items) | ~100ms | DOM generation |

### 19.3 WebSocket Overhead

| Message Type | Size | Frequency | Bandwidth |
|--------------|------|-----------|-----------|
| Diff update | ~5KB | On change | <1KB/s avg |
| File change notification | ~500B | Debounced | <100B/s avg |
| Terminal output | Variable | Real-time | 1-10KB/s |
| Agent streaming | ~100B/chunk | Real-time | 1-5KB/s |

---

## 20. Lessons Learned & Best Practices

### 20.1 From Implementation Notes

**From NICEGUI_VENDORING_JOURNEY.md:**
1. **Vendor when you need control** - Don't fight libraries, extend them properly
2. **Follow existing patterns** - Study vendored code before adding features
3. **Read the docs thoroughly** - Official APIs often exist for "hard" problems
4. **Don't fight the architecture** - Complex hacks mean you're missing something

**From 2025-11-17_LESSONS_LEARNED.md:**
1. **Trace existing code paths FIRST** - 15 min invested = 30 min saved
2. **Vendored code requires vendored APIs** - Don't bypass with raw JS
3. **Mobile is different** - Test early, preserve DOM elements for keyboard
4. **Single source of truth** - Application backend reads, iframe displays
5. **Architecture guidelines prevent bugs** - Not bureaucracy

**From 2025-11-19 (Deletion Markers):**
1. **Check for widget-specific hooks** - CM6 has different facets for different contexts
2. **Test with external knowledge** - Fresh perspectives reveal obvious solutions
3. **If you're doing pixel math, you're wrong** - Use official APIs

### 20.2 Common Pitfalls

**DON'T:**
- Access iframe internals from parent frame (impossible)
- Cache frontend state when backend is source of truth (breaks convergence)
- Use sub-0.5px thickness on Chromium (rendering bugs)
- Destroy DOM on every update (mobile keyboard closes)
- Bypass vendored APIs with `run_javascript()` (wrong scope)
- Apply settings without persisting (refresh loses state)
- Assume `reconnect_timeout=0` is always good (causes thrash)
- Mix absolute and relative paths (cache misses from path mismatch)

**DO:**
- Read backend state on every request (stateless endpoints)
- Add methods to vendored `.py` and `.js` files (proper extension)
- Use Compartments for toggleable CM6 features (official pattern)
- Test on mobile early and often (different behavior)
- Normalize paths before using as cache keys (symlinks, relative)
- Document edge cases in implementation notes (help future self)
- Follow the NiceGUI iframe guideline (architecture compliance)
- Update TODO with completion dates (roadmap stays current)

---

## Appendix B: Completed Features Timeline

| Date | Feature | Lines Changed | Time Invested |
|------|---------|---------------|---------------|
| 2025-11-12 | NiceGUI Vendoring Infrastructure | ~200 | 6 hours |
| 2025-11-13 | Editor Self-Sufficiency Refactor | ~150 | 3 hours |
| 2025-11-14 | Session Cache Implementation | ~300 | 4 hours |
| 2025-11-16 | CM6 Search Integration | ~100 | 1 hour |
| 2025-11-16 | Explorer Rewrite (A/B/C) | ~2000 | 8 hours |
| 2025-11-16 | Terminal CWD Fix | ~50 | 30 minutes |
| 2025-11-17 | Font Scale Controls | ~200 | 2 hours |
| 2025-11-17 | Indentation Guides | ~150 | 90 minutes |
| 2025-11-17 | Permission Preservation | ~50 | 30 minutes |
| 2025-11-17 | Explorer Search | ~300 | 50 minutes |
| 2025-11-19 | Go To Line | ~30 | 10 minutes |
| 2025-11-19 | Deletion Markers (widgetMarker) | ~50 | 4 hours (exploration) |
| 2025-11-19 | CSS Color Picker | ~30 | 20 minutes |
| 2025-11-20 | Terminal Root & Cleanup | ~100 | 1 hour |
| 2025-11-21 | Diff Base Architecture | ~200 | 3 hours |
| 2025-11-21 | Search by Changes | ~400 | 4 hours |

**Total:** ~4400 lines changed, ~42 hours development time over 10 days

---

**Document Complete**  
**Version:** 1.2  
**Last Updated:** 2025-12-01  
**Next Review:** When major features added or architecture changes

---

## Changelog

### v1.2 (2025-12-01)
- **Section 8 rewritten:** Complete explorer architecture documentation reflecting WebSocket refactor
- Added ConnectionManager, message protocol, status propagation, and file watcher integration
- Documented draft notification flow and hunk header formatting

### v1.1 (2025-11-24)
- Added minimap extension documentation (Section 17)
- Added color picker extension details (Section 16)

### v1.0 (2025-11-21)
- Initial technical documentation
