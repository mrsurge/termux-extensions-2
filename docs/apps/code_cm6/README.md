# Code CM6 – Modern Code Editor for Termux

**Code CM6** (internally `file_editor_cm6`) is a full-featured, native code editor built on CodeMirror 6 and packaged as part of the Termux Extensions 2 framework. It delivers a professional development experience optimized for mobile and desktop environments, with advanced Git integration, real-time file watching, embedded terminal access, and AI-powered assistance.

**Key Architecture:** Think code-server, not VS Code Web. The Termux device runs the backend; browsers (local or remote) are stateless views. Changes made anywhere appear everywhere because all clients read from the same disk-backed state.

---

## Core Features

### 1. **CodeMirror 6 Editor**
Modern editing engine with comprehensive language support and real-time syntax highlighting.

- **Vendored CM6 Implementation:** Full control over the editor stack with custom extensions
- **Language Detection:** Automatic language mode switching based on file extension
- **Dynamic Indent Units:** Per-language indent sizing (2-space for JS/HTML/CSS, 4-space for Python/C/Java)
- **Syntax Highlighting:** Real-time tokenization for 50+ languages
- **Multiple Themes:** Monokai, Solarized, Dracula, GitHub, and more with live switching
- **Search & Replace:** Native CM6 search panel with regex support (Ctrl/Cmd+F)
- **CSS Color Picker:** Inline color swatches and editing for CSS color literals via @uiw/codemirror-extensions-color
- **Go To Line:** Jump to specific line number via menu or keyboard shortcut

### 2. **Live Inline Diff Engine**
Real-time visual comparison against any Git ref, powered by a sophisticated diff pipeline.

- **Diff Base Selector:** Compare working tree against HEAD, branches, tags, or any commit
- **Gutter Markers:** Visual indicators ("+", "−", "│") for added, deleted, and modified lines
- **Deletion Widgets:** Inline display of removed content using CM6's widgetMarker architecture
- **WebSocket Sync:** Instant diff updates on external file changes via watchdog/polling watcher
- **Smart Caching:** Three-tier cache (root, path, base) with automatic invalidation on writes
- **Zero-Context Diffs:** Uses `git diff --unified=0` to minimize payload size and maximize performance
- **Draft Overlay:** Optional blue/yellow decorations compare the live buffer against disk so you see unsaved work beside Git hunks without changing modes.

### 3. **Intelligent File Watcher**
Detects external changes and notifies the editor in real-time without polling overhead.

- **Watchdog Integration:** Filesystem event monitoring on supported platforms
- **Fallback Polling:** Graceful degradation to polling-based watcher when watchdog unavailable
- **Debounced Events:** 150ms debounce window prevents notification storms during batch operations
- **Self-Echo Suppression:** 300ms suppression window prevents flicker from own writes
- **Per-File Subscriptions:** Token-based subscription model allows multiple clients per file
- **Collision Detection:** Base SHA validation prevents overwriting concurrent external changes

### 4. **Git Integration**
First-class Git support with branch management, staging, committing, and diff visualization.

- **Status Monitoring:** Real-time working tree status with file-level change tracking
- **Branch Operations:** List, checkout, create, and switch branches via unified menu
- **Staging Controls:** Stage/unstage individual files or all changes with one click
- **Commit Workflow:** Commit message editor with validation and push integration
- **Diff Base Selection:** Choose comparison baseline (HEAD, branches, tags, commits) for all diff views
- **Search by Changes:** Filter project files by git status or diff content with live highlighting
- **Repository Detection:** Automatic Git repo discovery with fallback to plain file browsing
- **Git Init:** Initialize new repositories from non-repo projects
- **Git Integration:** Status indicators, diff view, staging, committing, and branch management.
- **Minimap:** VS Code-style minimap with responsive desktop (sidebar) and mobile (overlay) modes, including git diff markers.

### 5. **Project Explorer**
WebSocket-driven file tree with real-time updates, search, git status badges, and extensive file operations.

- **WebSocket Architecture:** Real-time bidirectional communication via Socket.IO protocol
- **Live Status Updates:** Git and draft status propagate instantly to all ancestor directories
- **Card-Based Layout:** Modern card design with icons, labels, and inline menus
- **Lazy Loading:** Efficient rendering of large directory trees
- **Search Modes:** Search by filename, file content (ripgrep/fallback), or git changes
- **Search by Changes:** Filter files by git status with inline diff viewing and live highlighting
- **Git Status Badges:** Visual indicators for modified, added, untracked files
- **Draft Indicators:** Yellow accent on files/directories with unsaved drafts
- **Context Menus:** File/folder operations (rename, delete, copy, move, create, make executable)
- **Select Mode:** Batch operations on multiple files (copy, move, delete, stage/unstage)
- **Recent Files:** Quick access to recently opened files with project-scoped history
- **Active File Marker:** Highlights the currently opened file in the tree; explorer menu action “Scroll to opened file” jumps to it.
- **Sticky Scopes (Monaco-ish):** Open directories dock into a stacked “scope” header while scrolling, with push-up/pull-down animation; tap a sticky scope to collapse it (⋮ menu still works).
- **Responsive Layout:** Mobile-friendly drawer with swipe gestures and keyboard navigation
- **Git Actions:** Init repo, stage/unstage, restore file, branch operations directly from explorer
- **New Project Creation:** Create new projects with optional Git initialization
- **File Watcher Integration:** External filesystem changes automatically notify connected clients

### 6. **Multi-Project Session Management**
Two-tier state architecture ensures complete project isolation with seamless multi-device convergence.

- **HistoryStore + ProjectSidecar:** Global ledger (HistoryStore) delegates per-project data to isolated JSON sidecars (`~/.cache/cm6_editor/projects/<sha1>.json`).
- **Per-Project Isolation:** Each project maintains its own recent files, scroll positions, diff base, and unsaved drafts—completely independent from other projects.
- **Draft Retention on Switch:** Switching projects does NOT clear drafts. Each project's unsaved work persists in its sidecar until explicitly discarded.
- **Scroll Position Persistence:** Per-file scroll positions are stored in the sidecar's `recent_files` entries and restored when reopening files.
- **Projects Modal:** File menu "Projects..." option provides project management with soft reset (clear drafts/MRU) and hard delete (remove from history) actions.
- **Lazy Migration:** Legacy per-project data in history.json seamlessly migrates to sidecars on first access.

### 7. **Draft Session Workflow**
Persistent, disk-backed drafts bring code-server resilience to a single-document UX.

- **Sidecar Persistence:** Unsaved buffers are stored in `ProjectSidecar.session_cache` (per-project) with base/content hashes so drafts survive reloads, crashes, or worker restarts.
- **Explorer Accents:** Tree nodes receive yellow right-edge accents the moment a draft exists; the metadata is streamed from the same sidecars so badges survive tree refreshes.
- **Review Tab:** The explorer search overlay now includes a "Review" mode that lists every draft, renders blue/yellow hunks, and lets you jump to any change - or save/discard files in bulk - without leaving the drawer.
- **Autosave Interop:** Enabling autosave flushes the current draft, performs an immediate disk write, and suppresses new sidecars until autosave is disabled again.
- **Unified Diff Colors:** Git (green/red) and draft (blue/yellow) decorations coexist across gutters, minimap, and inline widgets so you can distinguish disk vs. unsaved changes at a glance.

### 8. **Embedded Terminal**
Full xterm.js terminal with PTY streaming, persistent sessions, and project-aware CWD.
Full xterm.js terminal with PTY streaming, persistent sessions, and project-aware CWD.

- **Framework Shells Integration:** Terminal runs as a framework shell (type="shell", uses_pty=True)
- **PTY Streaming:** WebSocket-based PTY communication via framework shell manager
- **Session Persistence:** Terminal shell ID persisted across page reloads
- **Lifecycle Management:** Coordinated shutdown, log capture, orphan adoption on restart
- **CWD Synchronization:** Terminal inherits project root on open/switch
- **Resize Handling:** Automatic terminal resize on drawer/window size changes
- **Shell Selection:** Configurable shell (bash, zsh, fish) via framework preferences
- **Shared Resource:** Multiple apps can connect to same terminal via label-based discovery

### 8. **AI Agent Drawer**
Integrated AI assistant for code editing, debugging, and file operations.

- **MCP Server Integration:** Runs Codex MCP server as framework shell (type="shell", uses_pty=False)
- **Multi-Model Support:** OpenAI Codex, Google Gemini, or MCP protocol agents
- **Single Shell, Multiple Sessions:** All conversations multiplex through one shared MCP server shell
- **Conversation Persistence:** Session storage with transcript export/import
- **Crash Recovery:** Conversations restored automatically if MCP shell dies
- **Context Awareness:** Agent receives current file path, selection, and project structure
- **Streaming Responses:** Real-time response rendering via WebSocket
- **File Operations:** Agent can read/write files via IPC bridge with user confirmation
- **Mobile Optimized:** Full-screen transcript mode with adaptive keyboard handling

### 8. **Editor Preferences**
Disk-backed preferences with instant application and persistence across sessions.

- **Font Scaling:** Three-tier presets (Small 85%, Medium 100%, Large 115%) for editor and chrome
- **Indentation Guides:** Toggleable visual indent markers with active block highlighting (0.5px tan lines)
- **Line Shading:** Zebra striping (logical-line aware) for improved readability in long files
- **Word Wrap:** Toggle soft wrap with preserved indentation
- **Inline Diffs:** Show/hide live diff decorations without switching views
- **Autosave Toggle:** Modal-protected switch that enables the accelerated autosave loop (≈450 ms debounce) and pauses draft caching while it is active.

### 9. **Session Cache**
Preserves unsaved work across reloads and crashes with automatic cleanup.

- **Auto-Caching:** Snapshots editor state on every change (debounced) while autosave is OFF; autosave suppresses sidecars to avoid phantom restores.
- **Collision Guards:** Base SHA validation prevents overwriting newer disk content
- **Manual Discard:** UI affordance to delete cached drafts and reload from disk
- **Watcher Integration:** Cache invalidation on external file modifications
- **Draft Indicators:** Visual badge showing unsaved changes in file tree
- **Crash Recovery:** Automatic restoration of unsaved work after unexpected termination

### 10. **Responsive Layout**
Adaptive UI that works seamlessly across phones, tablets, and desktop browsers.

- **Mobile-First Drawers:** Full-screen overlays on mobile, side panels on desktop
- **Touch Gestures:** Swipe to open/close drawers, tap-highlight disabled for clean mobile UX
- **Keyboard Shortcuts:** Full keyboard navigation with standard IDE shortcuts (Ctrl/Cmd+S, Ctrl/Cmd+F, etc.)
- **Adaptive Menus:** Dropdowns intelligently position based on viewport size (upward pop for bottom menus)
- **Font Scale Sync:** Chrome and editor scale together for consistent density

---

## Framework Shells: The Process Management Layer

Code CM6 relies on **Framework Shells** - the platform's unified process management system for all long-lived background processes.

### What Framework Shells Provides

**For Terminal Drawer:**
- Spawns bash/zsh as PTY shell (type="shell", uses_pty=True)
- WebSocket streams PTY output to xterm.js
- Logs all terminal output to `~/.cache/te_framework/logs/`
- Graceful shutdown on app exit, orphan adoption on restart

**For AI Agent (MCP Server):**
- Spawns Codex MCP server as STDIO shell (type="shell", uses_pty=False)
- Multiple conversations share single MCP server instance
- Label-based discovery: `find_shell_by_label('codex mcp-server')`
- Auto-restart if shell dies, conversation restored from backend storage

**Key Benefits:**
- **No Orphans:** All shells terminated on framework shutdown (SIGTERM → 2s grace → SIGKILL)
- **Crash Recovery:** Shells from previous run adopted if PIDs still alive
- **Unified Logging:** stdout/stderr captured to framework logs directory
- **Resource Monitoring:** CPU, memory, thread counts available via API
- **Shared Services:** Apps discover and share shells by label (aria2, MCP servers, etc.)

Without Framework Shells, Code CM6 would need custom process management for terminals and MCP servers, leading to orphaned processes, no log capture, and lifecycle chaos.

---

## Technical Highlights

### Architecture
- **Backend:** Python/FastAPI with async/await and WebSocket support
- **Frontend:** Vanilla JavaScript with modular ES6 architecture
- **Editor Engine:** Vendored CodeMirror 6 with custom extensions and compartments
- **State Management:** JSON-based persistence stores (history, preferences, session cache)
- **IPC Protocol:** Custom agent bridge for AI model integration (OpenAI, Gemini, MCP)

### Performance
- **Lazy Rendering:** File tree and search results virtualized for large projects
- **Diff Caching:** Three-tier cache prevents redundant git operations
- **Debounced Writes:** Session cache and watcher notifications batched to reduce I/O
- **Zero-Context Diffs:** Minimal git diff payload (`--unified=0`) for inline decorations
- **Compartment Reconfiguration:** CM6 compartments enable instant theme/extension toggling without editor recreation

### Extensibility
- **Modular Stores:** HistoryStore, PreferencesStore, and SessionStore provide clean persistence APIs
- **Router Architecture:** FastAPI blueprints allow feature isolation and testing
- **Custom CM6 Extensions:** Indentation guides, zebra striping, color picker, and diff decorations built as vendored extensions
- **Framework Integration:** Uses Termux Extensions 2 shell manager for PTY, file picker, and inter-app communication

### Standards Compliance
- **ARIA Semantics:** Menu items, checkboxes, and drawers use proper ARIA roles and states
- **Keyboard Navigation:** Full tab-order and keyboard shortcuts for accessibility
- **Progressive Enhancement:** Graceful fallback when Git, watchdog, or ripgrep unavailable
- **Mobile Web Standards:** Touch events, viewport meta, and responsive CSS for PWA-grade mobile experience

---

## Development Roadmap

### Recently Completed (Last 10 Days)
- ✅ **CSS Color Picker** (2025-11-19): Vendored @uiw/codemirror-extensions-color for inline CSS color swatches and editing
- ✅ **Search by Changes** (2025-11-21): Full implementation with filtering, highlighting, and diff base selection
- ✅ **Deletion Markers in Diff Gutter** (2025-11-19): Proper "−" markers for deleted lines using CM6 widgetMarker API
- ✅ **Indentation Guides** (2025-11-17): Toggleable 0.5px tan guides with active block highlighting and dynamic per-language indent units
- ✅ **Font Scale Controls** (2025-11-17): Three-tier presets with synchronized editor/chrome scaling
- ✅ **CM6 Search Integration** (2025-11-16): Native search panel with keyboard shortcuts
- ✅ **Explorer Rewrite** (2025-11-16): Complete card-based layout with context menus, select mode, batch operations
- ✅ **Explorer Search** (2025-11-17): Filename, content (ripgrep/fallback), and changes search modes
- ✅ **Permission Preservation** (2025-11-17): Executable bit preservation on file save
- ✅ **Go To Line** (2025-11-19): Menu item wired to backend endpoint
- ✅ **Terminal CWD Fix** (2025-11-16): Project-aware terminal directory synchronization
- ✅ **Diff Base Selection** (2025-11-21): Compare against any Git ref with persistent state
- ✅ **Session Cache** (2025-11-14): Auto-save with collision detection and crash recovery
- ✅ **Word Wrap Fix**: Preserved indentation and proper logical line handling
- ✅ **NiceGUI Vendoring Infrastructure** (2025-11-12): Complete vendor setup with sys.path override

### Active Development
- 🚧 **Git Clone Workflow:** New Project modal with Git clone option (URL + target directory)
- 🚧 **Autosave Backend:** Optional autosave with configurable intervals (frontend exists, needs backend integration)

### Planned Enhancements
- (Done) **Remote Branch Checkout:** Extend branch menu to list and checkout remote branches
- (Done) **Agent Drawer Mobile UX:** Fix transcript/chat layout on mobile browsers
- 📋 **Git Jobs Progress:** Framework jobs library integration for long-running git operations
- (Done) **External File Explorer:** "Open in external explorer" action for directories
- (Done) **Copy From/Move From:** Additional batch operations in explorer context menus

---

## Platform: Termux Extensions 2

Code CM6 is one of several bundled apps in the **Termux Extensions 2** framework, a modular application platform for Termux that provides:

- **Application Launcher:** Dashboard UI for discovering and launching installed apps
- **Process Management:** Supervisor architecture with isolated app workers and graceful shutdown
- **IPC Server:** Central process registry for lifecycle orchestration
- **Framework Shell Manager:** Unified PTY management with persistent shell sessions
- **Shared State Store:** Cross-app session state and preferences persistence
- **App Discovery:** Manifest-based app registration with icon, description, and entrypoints
- **WebSocket Multiplexing:** Routes messages to correct app worker via proxy
- **Unified UI Shell:** `app_shell.html` provides common toolbar, modals, and app container

### How Apps Work

```
User clicks "Code CM6" card in launcher
  ↓
Framework spawns app worker subprocess (file_editor_cm6)
  ↓
Worker starts on isolated port (e.g., :5001)
  ↓
Framework proxies /app/file_editor_cm6 → :5001
  ↓
App HTML injected into #app-container
  ↓
User interacts with app (NiceGUI iframe, drawers, etc.)
  ↓
App uses framework services (shell manager, IPC, state store)
```

This architecture allows Code CM6 to integrate seamlessly with other framework apps (File Explorer, Terminal, Distro Manager) while maintaining:
- **Clean isolation:** Each app in separate subprocess
- **Shared infrastructure:** PTY sessions, file watchers, git operations
- **Independent lifecycle:** Apps can crash/restart without affecting framework
- **Convergence:** All apps operate on same disk-backed state

### Other Framework Apps

- **File Explorer:** Native file browser with git integration (already built, needs linking to Code CM6)
- **Terminal:** Standalone PTY sessions (Code CM6's terminal drawer uses this)
- **Distro Manager:** Manage proot distros (planned)
- **Settings:** Framework-wide preferences (planned)

---

## Getting Started

### Prerequisites
- Termux (Android) or compatible Linux environment
- Python 3.9+ with pip
- Git (optional but recommended)
- Node.js 16+ (for building vendored assets)

### Installation
```bash
# Clone the framework
git clone https://github.com/yourusername/termux-extensions-2
cd termux-extensions-2

# Install dependencies
pip install -r requirements.txt

# Run the framework
./scripts/run_framework.sh
```
(Its a little more complicated than this... View the project Readme )
### Usage
1. Open browser to `http://localhost:8088`
2. Click "Code CM6" from the apps menu
3. Use "New Project" to open a directory or "Recent Files" to resume work
4. Edit files, stage changes, commit, and push—all from the integrated interface

---

## Contributing

Code CM6 is designed for extension and contribution. Key areas for involvement:

- **Language Support:** Add new CM6 language modes or enhance existing syntax highlighting
- **Editor Extensions:** Build custom CM6 extensions (linters, formatters, snippets)
- **Git Features:** Extend git integration (rebase, merge, stash, cherry-pick)
- **Agent Adapters:** Implement new AI model bridges (Claude, Llama, local models)
- **Mobile UX:** Improve touch gestures, keyboard handling, and responsive layouts
- **Performance:** Optimize diff caching, file watching, or large file handling

Documentation for contributors:
- `docs/core/nicegui_iframe_feature_adding_guideline.md` – Adding NiceGUI features (1520 lines)
- `notes/2025-11-17_LESSONS_LEARNED.md` – Best practices from recent implementations
- `notes/REPO_STRUCTURE.md` – Directory layout and file organization

---

## License
GPL-3.0 (see `gpl-3.0.md` in repository root)

## Author
mrSurge (Termux Extensions 2 Team)

## Development Stats
- **Total Implementation:** ~4400 lines changed over 10 days (Nov 12-21, 2025)
- **Time Invested:** ~42 hours of focused development
- **Major Features Shipped:** 15+ complete features with documentation

## Links
- Repository: https://github.com/mrsurge/termux-extensions-2
- Documentation: `/docs` directory in repository
- Issue Tracker: GitHub Issues
- Changelog: `CHANGELOG_*.md` in repository root
