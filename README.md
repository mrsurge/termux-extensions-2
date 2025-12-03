# Termux Extensions 2

## What TE2 Gives You
<img width="225" height="500" alt="Screenshot_20251124-203443 Termux Extensions" src="https://github.com/user-attachments/assets/32c2031a-bbec-4ad1-87df-4f75911c8c0f" />
<img width="225" height="500" alt="Screenshot_20251124-212029 Termux Extensions" src="https://github.com/user-attachments/assets/70bf817d-ddba-4956-af68-2603d247abce" />
<img width="225" height="500" alt="Screenshot_20251123-233724 Termux Extensions" src="https://github.com/user-attachments/assets/a6315058-aac9-4301-aff8-88ad4de5463a" />
<img width="225" height="500" alt="Screenshot_20251124-091516 Termux Extensions" src="https://github.com/user-attachments/assets/7aa5f90c-4c9b-451a-b6c0-8172bde87fe9" />

An integrated developement environment & complete with
/home/mrsurge/Documents/te-2-cm6-iframe-main/docs/apps/code_cm6/README.md
## IDE (Code-CM6)
(see [/docs/apps/code_cm6/README.md](/docs/apps/code_cm6/README.md))
(im sorry this is AI generated... i dont have the time to create a full feature spec for the ide... maybe you can? anyway... you can read what I have below and if you want to find out more about it you can read the readme in the link)

1. Convergant UI
   -
   - Works with desktop and mobile displays... I have spent many hours making sure it works VERY well on mobile. Im going to include the `GeckoView` based app in the releases soon... so look out for that.
   - The same UI that is in the desktop browser is in the mobile.  Carefully positioned breakpoints make sure of this.  You can host this from your desktop and use it on your mobile/tablet to review and make changes to your desktop repos, and vice versa.
  <img width="1913" height="1014" alt="Screenshot From 2025-11-24 22-22-14" src="https://github.com/user-attachments/assets/80fed2e0-2f2e-462f-969d-bc90b7150316" />


3. Fully `git` integrated
   -
   - You can run on your desktop and mobile seperately and use all the intergrated git featrures to push changes in tandem.
4. Fully Featured
   -
   - Fully integrated project exporer/ agent chat / terminal
   - Terminal included can be used interchangably in desktop or mobile from either. No SSH.  (Keep it on your personal LAN if you run it in this way.)
   - VS Code - Code-OSS Code-Server Feature parity
   - CM6 Backend with all the bells and whistles
   - Feels native on mobile... no selection jank
   - Code completions
   - Syntax Highlighting
   - **Inline Diff Engine**
   - Draft diff overlays (blue/yellow) that track unsaved changes alongside Git diffs
   - Fast autosave loop (≈450 ms debounce) with crash-safe session cache fallback

<img width="225" height="500" alt="Screenshot_20251123-222022 Termux Extensions" src="https://github.com/user-attachments/assets/5e6aef7c-2c11-4ce3-9783-5db505ad66c4" />
<img width="225" height="500" alt="Screenshot_20251124-223352 Termux Extensions" src="https://github.com/user-attachments/assets/8f3ce5fb-7923-46df-9732-73a06d1c7971" />
<img width="225" height="500" alt="Screenshot_20251123-221530 Termux Extensions" src="https://github.com/user-attachments/assets/14752214-3ffd-4a66-a290-7bf36ccc3774" />
<img width="225" height="500" alt="Screenshot_20251124-095030 Termux Extensions" src="https://github.com/user-attachments/assets/9c0f64f6-5cd5-44ee-8d7b-5828293526ce" />


5. Room to grow
   -
   - help me please i have no idea what im doing

## Integrated File Explorer

1. Works remotely
2. Has deep linking with the IDE
3. can open files and archives, extract archives
4. Easier to use than termux
5. Works in termuxes security context or with su...
6. can change file attributes and modes
7. fully featured

## Terminal Emulater....

1. kinda redundant, but allows unlimited shells in mobile enviroment
2. in ADDITITON to the shell that is included with the ide

## AI GENERATED READ ME!!

**`termux-extensions-2`** is an application platform for Termux that provides mobile-optimized apps with shared infrastructure, process isolation, and multi-device convergence. It runs as a local FastAPI/IPC hybrid server presenting a unified launcher and app container.

The platform delivers functionality through isolated "apps" that leverage framework services (process management, terminal shells, state persistence) to provide rich, touch-friendly experiences on Android devices.

---
## Quick Start

- Ok im back

**Bootstrap (Fresh install will not work if you are using a shell other than bash, a simple `bash` command can fix this)**

### Ubuntu:

```bash
sudo apt update ; sudo apt upgrade -y ; sudo apt install git -y
git clone https://github.com/mrsurge/termux-extensions-2.git
cd termux-extensions-2
sudo apt install python3-venv
python3 -m venv te-venv
source te-venv/bin/activate
pip install -r requirements.txt
./scripts/run_framework.sh
```
**Subsequent runs:**
```bash
source te-venv/bin/activate
./scripts/run_framework.sh
```
### Termux: <--- this is why were all here folks
```bash
pkg upgrade -y ; apt install git -y
git clone https://github.com/mrsurge/termux-extensions-2.git
cd termux-extensions-2
pip install -r requirements.txt
./scripts/run_framework.sh
```
**Subsequent runs:**
```bash
./scripts/run_framework.sh
```
**For all platforms**
-
## Network Security & IP Filtering

By default, the framework is **locked down to localhost only**. To allow external connections, use the `--broadcast` flag with specific filters.

### Usage Examples

**1. Allow specific devices (Recommended)**
Restrict access to specific IP addresses.
```bash
./scripts/run_framework.sh --broadcast 192.168.1.50 192.168.1.51
```

**2. Allow entire Wi-Fi network**
Automatically calculates the subnet for `wlan0` (e.g., `192.168.1.0/24`) and allows all devices on it.
```bash
./scripts/run_framework.sh --broadcast wlan0
```
*Note: Interfaces with `/32` masks (like Tailscale) are ignored for subnet calculation to prevent accidental exposure. You must add their specific IPs manually.*

**3. Allow specific subnets**
Manually whitelist a CIDR range.
```bash
./scripts/run_framework.sh --broadcast 10.0.0.0/24
```

**4. Allow ALL connections (Insecure)**
Disable all IP filtering. Not recommended.
```bash
./scripts/run_framework.sh --broadcast all
```

**5. Localhost Only (Default)**
Running without arguments denies all external connections.
```bash
./scripts/run_framework.sh
```

Browse to `http://localhost:8088` (or `http://<device-ip>:8088` from another device on LAN).

## Back to AI Generated Read-Me 

## Architecture Overview

### Three-Layer System

```dsnt_rndr_rt_on_github_4_sum_reason
┌─────────────────────────────────────────┐
│  Supervisor (bash)                      │
│  - Signal handling (SIGTERM/SIGINT)     │
│  - Spawns framework + IPC               │
│  - Orchestrates shutdown                │
└─────┬────────────────────┬──────────────┘
      │                    │
┌─────▼──────────┐   ┌─────▼─────────────┐
│ IPC Server     │   │ Framework (Main)  │
│ (Flask/sync)   │◄──┤ (FastAPI/async)   │
│ :9123          │   │ :8088             │
│                │   │                   │
│ - Process reg  │   │ - App launcher    │
│ - Shutdown seq │   │ - WebSocket proxy │
│ - Shell mgmt   │   │ - Static serving  │
└────────────────┘   └────┬──────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    ┌────▼─────┐    ┌─────▼────┐    ┌──────▼───┐
    │ Worker 1 │    │ Worker 2 │    │ Worker 3 │
    │ Code CM6 │    │ File Exp │    │ Terminal │
    │ :5001    │    │ :5002    │    │ :5003    │
    └──────────┘    └──────────┘    └──────────┘

```
### Key Components

**Supervisor** (`scripts/run_framework.sh` → `app/supervisor.py`)
- Generates unique `TE_RUN_ID` for each boot
- Spawns IPC server and framework main process
- Handles SIGTERM/SIGINT for graceful shutdown
- Cleans up logs from force-killed shells (>7 days removed)

**IPC Server** (`app/ipc/server.py`)
- Flask-based synchronous operation server
- Process registry for all framework/worker/shell PIDs
- Handles blocking operations (shutdown, sequential tasks)
- Apps can extend via `ipc_stack` modules in manifests

**Framework Main** (`app/main.py`)
- FastAPI-based async web server
- Serves app launcher dashboard (`app_shell.html`)
- Proxies requests to app workers by port
- WebSocket multiplexing for real-time updates

**App Workers** (`app/libs/app_worker.py`)
- Isolated subprocesses per app (own Python interpreter)
- Dynamic port assignment (5001+)
- Registered with IPC for lifecycle tracking
- Spawn on-demand when user clicks app card

**Framework Shells** (`app/libs/framework_shells.py`)
- Unified process management for long-lived services
- PTY support for interactive terminals
- Log capture to `~/.cache/te_framework/logs/`
- Adoption of orphaned processes on restart
- Resource monitoring (CPU, memory, threads via psutil)

---

## Shutdown Lifecycle

When user presses Ctrl+C or sends SIGTERM to supervisor:

1. **Supervisor receives signal** → Sets `shutting_down = True`
2. **IPC orchestrated shutdown** → `POST http://127.0.0.1:9123/actions/shutdown`
3. **Process registry termination** → `ProcessRegistry.shutdown_all()`:
   - **Phase 1**: Terminate workers (type="worker") and shells (type="shell")
     - Send SIGTERM to process group
     - Poll for 2 seconds (check `/proc/{pid}/stat`)
     - If still alive: Send SIGKILL (force kill)
     - Track force-killed shells → logs preserved
   - **Phase 2**: Terminate framework (type="framework")
4. **Supervisor cleanup**:
   - Kill IPC server (SIGTERM to `TE_IPC_PID`)
   - Delete `~/.cache/te_framework/run_id`
   - Exit with framework's exit code

**Log Management:**
- Clean exits: Logs left in `~/.cache/te_framework/logs/`
- Force-killed: Logs archived to `~/.cache/te_framework/preserved_logs/logs_{timestamp}/`
- On next boot: Previous logs archived, old archives (>7 days) deleted

---

## Multi-Device Convergence

The platform implements the **code-server pattern** - disk-backed state with stateless UI clients:

**Single Backend, Multiple Clients:**
- Desktop browser at `http://192.168.1.100:8088`
- Mobile browser at `http://localhost:8088`
- Both see same state (files, preferences, terminals)

**How It Works:**
1. All state lives in JSON files on disk
2. Clients read from backend on every request (no frontend cache)
3. File watcher broadcasts changes via WebSocket
4. Edits from any client appear instantly on all others

**Example Flow:**
```
Desktop: Types in Code CM6 editor
  ↓
Backend: Saves to disk (atomic write with SHA validation)
  ↓
File Watcher: Detects change
  ↓
WebSocket: Broadcasts to all subscribers
  ↓
Mobile: Updates editor content in real-time
```

No CRDT, no OT, no sync protocol. Just **last write wins** with SHA-based conflict detection.

---

## Key Features

### Platform Infrastructure
- **On-Demand App Workers:** Apps spawn in isolated processes, exit when idle
- **IPC Server:** Synchronous operation layer for blocking tasks, sequential operations
- **Framework Shells:** Unified management for background services (terminals, MCP servers, aria2, etc.)
- **Process Adoption:** Orphaned processes reclaimed on restart
- **Coordinated Shutdown:** Sequential termination prevents orphans
- **Log Persistence:** All shell output captured with automatic archival and cleanup

### User-Facing Features
- **Web-Based UI:** Clean, touch-optimized interface in browser
- **App Launcher:** Dashboard with app cards, metadata, and quick launch
- **Multi-Device Access:** Same backend serves desktop and mobile simultaneously
- **PWA Install:** Add to home screen for full-screen app experience
- **Real-Time Updates:** WebSocket-based live updates across all clients
- **State Persistence:** Settings, preferences, and session state survive restarts
- **Deep Linking:** Centralized mechanism for apps to launch other apps with context (see [docs/core/DEEPLINKING.md](docs/core/DEEPLINKING.md))

### Bundled Apps
- **Code CM6:** Full CodeMirror 6 editor with Git integration, terminal drawer, AI agent support
- **Terminal:** Multi-session PTY terminal with xterm.js (planned)
- **File Explorer:** Native file browser with git status badges (exists, needs linking)
- **Settings:** Runtime diagnostics, framework shell management, shutdown controls

---

**4. Test graceful shutdown:**
- Press `Ctrl+C` in supervisor window
- Watch sequential termination log
- Verify no orphaned processes: `ps aux | grep python`

**5. Test log archival:**
- Force-kill a framework shell: `kill -9 <pid>`
- Restart supervisor
- Check `~/.cache/te_framework/preserved_logs/` for archived logs

---

## Mobile Access

### Browser Access (PWA)

On mobile browsers (Chrome, Edge, Firefox):

1. Open `http://localhost:8088` or `http://<device-ip>:8088`
2. Browser menu → "Install app" or "Add to Home screen"
3. Launch from home screen icon for full-screen experience

**Notes:**
- Service worker and manifest included
- Localhost treated as secure context (no HTTPS needed)
- Remove old version before reinstalling after updates

### Native GeckoView App (Recommended)

A native Android APK wrapper using GeckoView (Firefox's rendering engine) provides superior mobile experience:

- **Better text selection:** Firefox selection behavior works properly across line breaks (Chrome mobile has known selection issues)
- **Native feel:** Full-screen app without browser chrome
- **Proper touch handling:** Optimized for code editing on mobile devices
- **Custom context menus:** Non-intrusive menus that don't block content during selection

The APK is a thin wrapper that connects to the framework backend running in Termux - all app logic remains in Python/JavaScript.

**Status:** Under development, will be merged to main branch soon.

---

## Code CM6 Editor

One of the flagship bundled apps is **Code CM6**, a full-featured mobile code editor built on CodeMirror 6:

**Key Features:**
- Real-time file change notifications via WebSocket
- Live inline Git diffs with automatic refresh
- Embedded terminal drawer with PTY streaming
- Project-based file management with explorer drawer
- Disk-backed preferences (themes, word wrap, font scale)
- Multi-device convergence (edit on desktop, see on mobile instantly)
- Session cache for crash recovery

The editor demonstrates the platform's convergence capabilities - multiple browsers editing the same files simultaneously with sub-second sync latency.

---

## Framework Shells in Detail

Framework shells provide lifecycle management for any long-lived process:

**Shell Types:**
- **PTY shells** (`uses_pty=True`): Interactive terminals with full ANSI support
- **STDIO shells** (`uses_pty=False`): Daemons, servers, background services

**Use Cases:**
- Terminal sessions in app drawers
- MCP servers for AI agent communication
- Aria2 RPC daemon for download management
- Archive extraction/compression services
- Language servers (LSP)
- Custom chatbots or agents

**Management:**
- Label-based discovery (multiple apps can share one shell)
- Automatic log capture and rotation
- Health monitoring (CPU, memory, threads via psutil)
- Graceful termination with force-kill fallback
- Orphan adoption on framework restart

**API:**
- `GET /api/framework_shells` - List all shells with stats
- `POST /api/framework_shells` - Spawn new shell
- `POST /api/framework_shells/<id>/action` - Stop/kill/restart
- `POST /api/framework_shells/<id>/write` - Write to PTY (interactive shells)
- `WS /api/framework_shells/<id>/ws` - Bidirectional PTY stream

---

## State Persistence

Frontend state that survives browser reloads uses the shared state store:

**Storage:**
- Location: `~/.cache/termux_extensions/state_store.json`
- Thread-safe atomic writes
- Accessible via `window.teState` helper

**JavaScript API:**
```javascript
// Read state
const theme = window.teState.get('theme', 'dark');

// Write state
await window.teState.set('theme', 'monokai');

// Delete key
await window.teState.delete('theme');
```

**Python API:**
```python
from app.libs.state_store import get_state, set_state, delete_state

theme = get_state('theme', default='dark')
set_state('theme', 'monokai')
delete_state('theme')
```

---

## Development Notes

**Repository Structure:**
```
termux-extensions-2/
├── scripts/                  # Startup scripts, bootstrap helpers
├── app/
│   ├── main.py              # FastAPI framework entrypoint
│   ├── supervisor.py        # Process supervisor
│   ├── ipc/                 # IPC server (Flask/sync)
│   ├── libs/                # Shared libraries
│   │   ├── app_worker.py    # App worker spawner
│   │   ├── framework_shells.py  # Shell manager
│   │   └── state_store.py   # Persistent state
│   ├── templates/           # HTML templates
│   │   └── app_shell.html   # App container UI
│   ├── apps/                # Bundled applications
│   │   ├── file_editor_cm6/ # Code CM6 editor
│   │   └── ...
│   └── static/              # Static assets, vendored libs
├── docs/                    # Documentation
├── requirements.txt         # Python dependencies
└── README.md                # This file
```

**Adding New Apps:**

1. Create app directory: `app/apps/my_app/`
2. Add `manifest.json`:
   ```json
   {
     "id": "my_app",
     "name": "My App",
     "backend_module": "app.apps.my_app.main",
     "icon": "📦"
   }
   ```
3. Create `main.py` with FastAPI router:
   ```python
   from fastapi import APIRouter
   my_app_bp = APIRouter()
   
   @my_app_bp.get('/hello')
   def hello():
       return {"message": "Hello from My App"}
   ```
4. Restart framework - app appears in launcher

---

## Platform Architecture Details

**Why IPC Server Exists:**

FastAPI/ASGI excels at async web requests but struggles with sequential blocking operations. The IPC server provides:
- Synchronous operation runtime (Flask)
- Sequential task execution (shutdown, agent conversations)
- Blocking I/O allowed (subprocess, file locks)
- Isolated from async event loop

Apps can extend IPC via `ipc_stack` modules declared in manifest, enabling custom orchestration without async complexity.

**Why Framework Shells Exist:**

Without unified process management:
- Apps spawn own terminals → orphans on crash
- Each app runs own MCP server → resource waste
- No log capture → debugging blind
- No adoption → restart loses state

With framework shells:
- One PTY manager for all terminals
- Shared MCP servers (labeled, discoverable)
- Unified logging with archival
- Orphan adoption on restart
- Coordinated shutdown prevents leaks

---

## License

GPL-3.0 (see gpl-3.0.md in repository root)

## Contributing

email me?
xrsurge@gmail.com

## Credits

Built with: FastAPI, Flask, CodeMirror 6, xterm.js, NiceGUI (vendored), and many other open source projects.

---

**Last Updated:** December 3, 2025

**2025-12-03:** Multi-project session management with per-project sidecar storage, draft retention across project switches, per-file scroll position persistence. — *Atlas, TE2 Team*

More screens:
<img width="1913" height="1014" alt="Screenshot From 2025-11-25 17-20-52" src="https://github.com/user-attachments/assets/d3f40310-6a13-4bd5-8032-a21c240675fc" />
<img width="1913" height="1014" alt="Screenshot From 2025-11-25 17-17-25" src="https://github.com/user-attachments/assets/acbcea7e-4663-48d2-b7a9-b84173b26ae1" />
