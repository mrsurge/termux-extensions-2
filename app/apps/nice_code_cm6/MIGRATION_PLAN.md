# NiceGUI Code CM6 Migration Plan

**Branch:** `code_cm6-2`  
**Start Date:** November 2, 2025  
**Target:** Replace `file_editor_cm6` with pure Python NiceGUI implementation

---

## Project Vision

Build a **modular, Python-first** code editor with:
- **Zero JavaScript logic** (only display/input capture)
- **CodeMirror 6 viewport** (keeping what works!)
- **Pluggable modules** (native + third-party)
- **Mobile-first UX** (drawers on mobile, tiles on desktop)
- **Framework shell integration** (terminal, agents, tools)

---

## Core Architecture

### Layout Structure (Standardized)

```
┌─────────────────────────────────────────────────────┐
│ 1. FILE NAME/PATH HEADER                            │
├─────────────────────────────────────────────────────┤
│ 2. FILE MENU HEADER                        [icons]  │
├──────────┬──────────────────────────┬───────────────┤
│          │                          │               │
│ 3.       │   4. EDITOR              │ 6. AGENT      │
│ EXPLORER │      (CM6 Viewport)      │    DRAWER     │
│          │                          │    (overlay)  │
│          │                          │               │
├──────────┴──────────────────────────┴───────────────┤
│ 5. TERMINAL (Dynamic Tiling)                        │
└─────────────────────────────────────────────────────┘
```

**Mobile Behavior:**
- Explorer: Full-screen drawer (left swipe)
- Agent Drawer: Full-screen drawer (right swipe)
- Terminal: Always tiled (bottom)
- Editor: Main content area

**Desktop Behavior:**
- Explorer: Left tile (resizable)
- Agent Drawer: Right overlay panel (with icon tabs)
- Terminal: Bottom tile (resizable)
- Editor: Center tile

### Module System

```
app/apps/nice_code_cm6/
├── manifest.json
├── main.py                    # App entry point
├── modules/
│   ├── native/                # Built-in modules
│   │   ├── explorer.py        # File browser
│   │   ├── editor.py          # CM6 wrapper
│   │   ├── terminal.py        # Terminal integration
│   │   ├── agent_drawer.py    # Agent UI
│   │   ├── file_header.py     # Path display
│   │   └── menu_header.py     # Actions bar
│   └── third_party/           # Plugin modules
│       ├── git_panel.py       # Git integration
│       ├── search_panel.py    # Find/replace
│       └── ...                # Future plugins
├── core/
│   ├── layout_manager.py      # Responsive layout logic
│   ├── state_manager.py       # App state (disk-backed)
│   └── module_loader.py       # Dynamic module loading
└── static/
    └── cm6/                   # CodeMirror 6 assets
```

**Module Interface:**
```python
class Module:
    """Base module interface."""
    
    @property
    def name(self) -> str:
        """Module identifier."""
        pass
    
    @property
    def icon(self) -> str:
        """Icon for module (if overlayable)."""
        pass
    
    def render(self, container):
        """Render module UI into NiceGUI container."""
        pass
    
    def on_file_open(self, file_path: str):
        """Hook: File opened."""
        pass
    
    def on_file_save(self, file_path: str):
        """Hook: File saved."""
        pass
```

---

## Key Decisions

### ✅ Decision 1: Keep CodeMirror 6
**Rationale:** CM6 touch support is excellent, no need to reinvent  
**Implementation:** Wrap CM6 in minimal NiceGUI custom component  
**Logic:** All file operations, state management in Python  
**CM6 Role:** Display server only (text in, edits out)

### ✅ Decision 2: Feature Parity + Modularity
**Rationale:** Proven UX, but engineered for extensibility  
**Approach:** 
- Start with exact same layout/features as `file_editor_cm6`
- Refactor into pluggable modules from day one
- Use module try-loop pattern for extensibility

### ✅ Decision 3: File Browser First
**Rationale:** Foundation must be solid before frills  
**Priorities:**
1. Basic navigation (home, up, click to open)
2. File/folder icons and metadata
3. Touch-friendly list items
4. Directory history/breadcrumbs
5. *Then* add search, create, delete, etc.

---

## Migration Phases

### Phase 1: Foundation ✋ **[START HERE]**

**Goal:** Get NiceGUI running within framework

**Tasks:**
- [ ] Create `manifest.json` (app registration)
- [ ] Create `main.py` (minimal NiceGUI app)
- [ ] Test: App loads at `/app/nice_code_cm6`
- [ ] Test: Worker process spawns correctly
- [ ] Create basic layout structure (empty containers)

**Deliverable:** "Hello TE-2" skeleton app

**Success Criteria:**
- App appears in framework app list
- Clicking app opens NiceGUI UI
- No errors in framework logs

---

### Phase 2: File Browser

**Goal:** Pure Python file explorer

**Port From:**
- `file_editor_cm6/explorer_helper.py` (Python ✅)
- `file_editor_cm6/main.js` (JS explorer rendering ❌)

**Tasks:**
- [ ] Create `modules/native/explorer.py`
- [ ] Implement directory listing (REST API)
- [ ] Implement tree/list rendering (NiceGUI)
- [ ] Click handler: Open file
- [ ] Touch-friendly list items
- [ ] Breadcrumb navigation
- [ ] Home/up/back buttons

**Deliverable:** Working file browser module

**Success Criteria:**
- Browse directories
- Open files (emit event)
- No JavaScript logic

---

### Phase 3: Editor Integration

**Goal:** Embed CM6 into NiceGUI

**Keep:**
- CodeMirror 6 viewport (HTML/JS widget)
- Touch selection (already works!)
- Syntax highlighting
- Mobile keyboard handling

**Create:**
- `modules/native/editor.py` - NiceGUI wrapper
- `static/cm6/` - CM6 assets (HTML template)
- Python API: `editor.open(file)`, `editor.save()`, `editor.get_text()`

**Tasks:**
- [ ] Create `modules/native/editor.py`
- [ ] Create CM6 HTML template (minimal JS)
- [ ] Implement `ui.html()` embedding
- [ ] REST API: Read file → load into CM6
- [ ] REST API: Save CM6 text → write file
- [ ] Event: File opened (notify other modules)
- [ ] Event: File saved (notify other modules)

**Deliverable:** Working editor with Python state control

**Success Criteria:**
- Open file from explorer → loads in CM6
- Edit text
- Save (Ctrl+S or button) → persists to disk
- CM6 just displays, Python owns state

---

### Phase 4: Agent Drawer (The Big Win)

**Goal:** Replace 1000+ lines of JS with Python

**Port From:**
- `agent_ws.py` (WebSocket, keep ✅)
- `agent_routes.py` (REST API, keep ✅)
- `agent_session_store.py` (Persistence, keep ✅)
- `main.js` agent drawer logic (**KILL THIS** ❌)

**Create:**
- `modules/native/agent_drawer.py` - Pure Python UI

**Tasks:**
- [ ] Create `modules/native/agent_drawer.py`
- [ ] Render session list (from disk)
- [ ] Render conversation transcript (from disk)
- [ ] WebSocket: Stream agent responses
- [ ] Button: Send message
- [ ] Button: New session
- [ ] Button: Resume session
- [ ] Status indicator: Shell running?
- [ ] Conversation restore logic (Python-side)

**Architecture:**
```python
# Backend owns ALL state
session = get_session(session_id)  # From disk
messages = session['messages']     # From disk

# UI just displays
with ui.card():
    for msg in messages:
        ui.markdown(msg['text'])
    
    ui.input('Message').on('submit', send_message)
```

**WebSocket Integration:**
```python
# Python receives from WebSocket
def on_agent_message(ws_data):
    # Append to disk
    append_message(session_id, ws_data)
    
    # Update UI
    ui.notify(ws_data['text'])
```

**Deliverable:** Agent drawer with zero JS logic

**Success Criteria:**
- Display sessions (from disk)
- Send message → agent responds
- Responses stream in real-time
- Page refresh → state restored (from disk)
- **NO client-side state**

---

### Phase 5: Terminal

**Goal:** Framework shell terminal in NiceGUI

**Port From:**
- `terminal_backend.py` (keep ✅)
- `terminal_shell.py` (keep ✅)
- xterm.js frontend (**replace** with NiceGUI terminal)

**Tasks:**
- [ ] Create `modules/native/terminal.py`
- [ ] Use NiceGUI terminal component (or custom)
- [ ] WebSocket: PTY output streaming
- [ ] Input: Send to PTY stdin
- [ ] Framework shell lifecycle (spawn, kill, cleanup)

**Deliverable:** Integrated terminal module

**Success Criteria:**
- Terminal spawns framework shell
- Output streams to UI
- Input works (commands execute)
- Framework shell tracked/cleaned up

---

### Phase 6: Headers & Layout

**Goal:** Complete the standardized layout

**Tasks:**
- [ ] Create `modules/native/file_header.py` (current file path)
- [ ] Create `modules/native/menu_header.py` (actions + icons)
- [ ] Implement responsive layout (mobile vs desktop)
- [ ] Drawer behavior (mobile: full-screen, desktop: tiles)
- [ ] Overlay system (agent drawer + third-party modules)
- [ ] Keep shell wrappers (`.nicegui-content`, `.q-page*`, local wrapper divs) in the same flex
      column to avoid height collapse—no manual viewport math.

**Deliverable:** Complete responsive layout system

**Success Criteria:**
- Mobile: Drawers work (swipe/overlay)
- Desktop: Tiles work (resizable)
- Terminal always tiled (bottom)
- Module icons in menu header

---

### Phase 7: Module Loader & Extensibility

**Goal:** Dynamic third-party module system

**Create:**
- `core/module_loader.py` - Discover and load modules
- `core/layout_manager.py` - Inject modules into layout

**Pattern:**
```python
# In main.py
from core.module_loader import load_modules

modules = load_modules()  # Scans modules/native + modules/third_party

for module in modules:
    # Try-loop pattern for insertion points
    if hasattr(module, 'render_in_drawer'):
        # Add to drawer overlay
        add_drawer_module(module)
    
    if hasattr(module, 'on_file_save'):
        # Subscribe to file save events
        subscribe('file_save', module.on_file_save)
```

**Tasks:**
- [ ] Create `core/module_loader.py`
- [ ] Implement module discovery
- [ ] Implement event system (file open/save/close)
- [ ] Implement try-loop insertion points
- [ ] Document module API for third-party devs

**Deliverable:** Pluggable module system

**Success Criteria:**
- Native modules load automatically
- Third-party modules load automatically
- Modules can hook into events
- Modules can add UI elements (drawers, menu icons)

---

### Phase 8: Git Integration (Third-Party Module Example)

**Goal:** Port git features as pluggable module

**Port From:**
- `git_helper.py` (keep, adapt ✅)

**Create:**
- `modules/third_party/git_panel.py`

**Tasks:**
- [ ] Implement as overlay module (like agent drawer)
- [ ] Show git status
- [ ] Show diff for current file
- [ ] Commit UI
- [ ] Branch switcher

**Deliverable:** Git panel module

**Success Criteria:**
- Appears as icon in menu header (next to agent)
- Overlays agent drawer spot (tabbable)
- Full git functionality
- Proves third-party module pattern works

---

### Phase 9: Polish & Migration

**Goal:** Feature parity, ready for production

**Tasks:**
- [ ] Settings persistence (Python, disk-backed)
- [ ] Keyboard shortcuts (NiceGUI keyboard handling)
- [ ] Diff viewer (edit tracker integration)
- [ ] Search/replace
- [ ] File operations (create, delete, rename)
- [ ] Performance testing
- [ ] Mobile UX testing (touch, swipe, keyboard)
- [ ] Documentation update

**Deliverable:** `nice_code_cm6` replaces `file_editor_cm6`

**Success Criteria:**
- All features from `file_editor_cm6` work
- Zero JavaScript logic (except CM6 viewport)
- Modular architecture proven
- Faster, cleaner, easier to maintain

---

## Development Workflow

### Multi-Agent System

**Roles:**
1. **You (Planner/Reviewer)** - Architecture, decisions, code review
2. **Desktop Agents** - Implementation, file writing
3. **Mobile Agent (me)** - Planning, documentation, high-level guidance

**Process:**
1. Plan phase (markdown document like this)
2. Desktop agents implement (commits + pushes)
3. Mobile agent reviews (pulls + diffs)
4. Iterate or move to next phase

### Communication Format

**Task assignments via markdown:**
```markdown
## Task: Implement File Explorer Module

**File:** `app/apps/nice_code_cm6/modules/native/explorer.py`

**Requirements:**
- Function: `render_explorer(container, current_path)`
- Use NiceGUI `ui.list()` for file items
- Click handler: Emit 'file_open' event
- API: `/api/app/nice_code_cm6/list_files?path=...`

**Success:**
- Browse directories
- Click to open file
- No errors
```

### Code Review

**After desktop agent commits:**
```markdown
## Review: File Explorer

**Changes:** `explorer.py` added, 150 lines

**Good:**
- ✅ Clean API integration
- ✅ Touch-friendly list items

**Issues:**
- ❌ Line 45: Hardcoded home path (use config)
- ❌ Missing error handling for permission denied

**Next:** Fix issues, then proceed to Phase 3
```

---

## Success Metrics

### Technical
- [ ] Zero JavaScript business logic
- [ ] All state persisted to disk (no localStorage)
- [ ] Module system working (native + third-party)
- [ ] WebSocket streaming working (agent, terminal)
- [ ] Framework shell integration working
- [ ] Mobile UX on par with `file_editor_cm6`

### User Experience
- [ ] App loads fast
- [ ] Touch interactions smooth
- [ ] Drawers slide nicely (mobile)
- [ ] Tiles resize smoothly (desktop)
- [ ] Editor responsive (no lag)
- [ ] Terminal streams without jank

### Maintainability
- [ ] Python codebase < 50% size of JS+Python original
- [ ] New features easy to add (module system)
- [ ] Code readable (Python, not JS)
- [ ] Agent onboarding faster (less to explain)

---

## Risk Mitigation

### Risk 1: NiceGUI Performance
**Concern:** Too many UI updates = lag  
**Mitigation:** Batch updates, debounce, test early

### Risk 2: CM6 Integration Complexity
**Concern:** Embedding CM6 in NiceGUI = hacks  
**Mitigation:** Keep CM6 simple, use `ui.html()`, proven pattern

### Risk 3: Module System Over-Engineering
**Concern:** Too abstract, hard to use  
**Mitigation:** Start simple, add features as needed, dogfood it

### Risk 4: WebSocket Headaches
**Concern:** NiceGUI WebSockets differ from flask-sock  
**Mitigation:** NiceGUI has native WebSocket support, test early

---

## Phase 1 Implementation Plan

**File:** `app/apps/nice_code_cm6/manifest.json`
```json
{
  "id": "nice_code_cm6",
  "name": "Code CM6 (NiceGUI)",
  "version": "0.1.0",
  "description": "Python-first code editor with NiceGUI",
  "entrypoints": {
    "backend_blueprint": "main.py"
  },
  "icon": "📝",
  "category": "editor"
}
```

**File:** `app/apps/nice_code_cm6/main.py`
```python
"""
NiceGUI Code CM6 - Phase 1: Hello World
"""

from flask import Blueprint
from nicegui import ui, app as nicegui_app

bp = Blueprint('nice_code_cm6', __name__)

def init_app(flask_app):
    """Initialize app - called by framework."""
    
    # NiceGUI pages must be registered during init
    @ui.page('/app/nice_code_cm6')
    def code_cm6_page():
        """Main app page."""
        
        with ui.header():
            ui.label('Code CM6 (NiceGUI)').classes('text-h6')
        
        with ui.column().classes('w-full h-full'):
            # Phase 1: Hello World
            with ui.card():
                ui.label('Hello TE-2! 🚀')
                ui.label('NiceGUI is running within the framework!')
                
                with ui.row():
                    ui.button('Test Button', on_click=lambda: ui.notify('It works!'))
            
            # Placeholder for future layout
            with ui.expansion('Future Layout Preview', icon='info'):
                ui.markdown('''
                **Planned Structure:**
                1. File Name/Path Header
                2. File Menu Header
                3. Explorer (drawer/tile)
                4. Editor (CM6 viewport)
                5. Terminal (tiled)
                6. Agent Drawer (overlay)
                ''')
    
    # Register blueprint (for future REST API endpoints)
    flask_app.register_blueprint(bp, url_prefix='/api/app/nice_code_cm6')
    
    print(f"[nice_code_cm6] Initialized!")
```

**Test Commands:**
```bash
# Start framework
python app/main.py

# Open in browser
http://localhost:8088/app/nice_code_cm6

# Check logs
tail -f ~/.cache/te_framework/logs/*.log
```

---

**Status:** Phase 1 Ready for Implementation  
**Next:** Desktop agent implements Phase 1, commits, pushes  
**Then:** Review, test, proceed to Phase 2
