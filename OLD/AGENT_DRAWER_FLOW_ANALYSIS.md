# Agent Drawer Flow Analysis - File Editor CM6 to Codex MCP Agent

**Date:** 2025-11-08  
**Analysis:** Complete entry point to agent interaction flow  
**Focus:** Codex MCP Server interaction (Gemini ACP excluded per instructions)

---

## Executive Summary

**CRITICAL ISSUE FOUND:** The agent drawer flow has a **conversation ID persistence race condition** after the WSGI→ASGI migration. When the worker process restarts, the in-memory conversation ID mapping (`CodexAdapter._conversations`) is lost, but the WebSocket handler attempts to restore it from disk-persisted session data. The restoration logic has ONE critical problem:

**Restoration happens AFTER initial handshake** - the `connected` event is sent before conversation IDs are restored from disk, creating a race condition where users can send messages before the conversation mapping is restored.

**IMPORTANT CONTEXT:** The conversation restoration logic is NOT overcomplicated - it is the ONLY way to maintain conversation context with Codex MCP server. Codex does not persist conversations internally, so the framework must inject full history transcripts into new messages when restoration is needed. This worked flawlessly in the WSGI version but broke during ASGI migration due to worker process restarts losing in-memory state while framework shells survive.

---

## Entry Point Flow

### 1. Framework Launch: `scripts/run_framework.sh`

**Location:** `/scripts/run_framework.sh`

**Process:**
```bash
# 1. Parse command line arguments (--run-local | --broadcast)
# 2. Set TE_RUN_MODE environment variable
# 3. Generate or reuse TE_RUN_ID (unique run identifier)
# 4. Clean up previous framework shell logs (unless preserve flag set)
# 5. Check if supervisor already running
#    - If running, attempt mode switch via HTTP API
#    - If mode switch succeeds, exit (reuse existing instance)
# 6. Start IPC server (Flask-based, separate process)
#    - Host: 127.0.0.1:9123 (configurable via TE_IPC_HOST/TE_IPC_PORT)
#    - Purpose: Synchronous control plane for agent spawning
#    - Process ID stored in ~/.cache/te_framework/ipc.pid
#    - Reuses existing IPC server if already running
# 7. Execute supervisor with remaining arguments
```

**Key Functions:**
- `generate_run_id()` - Python inline script to create unique run ID
- `start_ipc_server()` - Spawns Flask-based IPC microservice
- `cleanup_framework_shell_logs()` - Removes stale logs from previous runs

**Environment Variables Set:**
- `TE_RUN_MODE` - "local" or "broadcast"
- `TE_RUN_ID` - Unique run identifier
- `TE_IPC_PID` - IPC server process ID
- `TE_FRAMEWORK_URL` - Main framework URL (default: http://127.0.0.1:8088)
- `TE_FRAMEWORK_SHELL_TOKEN` - Auth token for internal API calls

---

### 2. Supervisor Process: `app/supervisor.py`

**Location:** `/app/supervisor.py`

**Process:**
```python
# 1. Ensure TE_RUN_ID exists (generate if missing)
# 2. Write run ID to ~/.cache/te_framework/run_id
# 3. Spawn Flask host via subprocess: `python -m app.main [args]`
#    - Uses os.setsid() for process group management
#    - Enables graceful shutdown with SIGTERM/SIGINT handling
# 4. Register signal handlers (SIGTERM, SIGINT)
# 5. Wait for Flask host to exit
# 6. On shutdown:
#    - Kill process group (SIGTERM, then SIGKILL after 10s timeout)
#    - Stop IPC server
#    - Clean up framework shell logs (unless forced shutdown)
#    - Remove run ID file
```

**Key Functions:**
- `run(argv)` - Main supervisor loop
- `_handle_signal()` - Graceful shutdown coordinator
- `_cleanup_shell_logs()` - Log cleanup after normal shutdown
- `_mark_logs_for_preservation()` - Preserve logs on forced shutdown

**Shutdown Sequence:**
1. Receive SIGTERM/SIGINT
2. Send SIGTERM to Flask host process group
3. Schedule force kill after 10 seconds (SIGINT only)
4. Wait for process exit
5. Clean up logs and IPC server
6. Remove run ID marker file

---

### 3. Main Framework Application: `app/main.py`

**Location:** `/app/main.py`

**Process (ASGI Lifespan):**
```python
# STARTUP SEQUENCE:
# 1. Apply settings from disk (~/.cache/termux_extensions/settings.json)
# 2. Load services (scan app/libs/*.py and import all)
# 3. Load extensions from app/extensions/
#    - Scan for manifest.json files
#    - Load backend_blueprint if specified
#    - Register APIRouter instances with FastAPI
# 4. Load apps from app/apps/
#    - Scan for manifest.json files
#    - Store in global loaded_apps list
# 5. Restore running apps (app workers from previous session)
# 6. Start framework shell log monitor (background thread)
# 7. Start lifecycle background tasks

# SHUTDOWN SEQUENCE:
# 1. Shutdown lifecycle apps (managed apps)
# 2. Forcibly kill all framework shells
#    - List all shells via FrameworkShellManager
#    - Remove each shell with force=True
```

**Key Components:**
- **FastAPI app** - ASGI application (migrated from Flask/WSGI)
- **Static file mounting** - Serves frontend assets
- **Extension loading** - Dynamic module loading with error capture
- **App loading** - Manifest-based app discovery
- **Framework shell log monitor** - Background thread that tails shell logs and detects Python tracebacks

**Extension Loading Process:**
1. Scan `app/extensions/` for directories with `manifest.json`
2. Read `backend_blueprint` from manifest
3. Import module using `importlib.util.spec_from_file_location`
4. Find `APIRouter` instance in module
5. Register with FastAPI:
   - Apps extension: No prefix (direct mount)
   - Other extensions: `/api/ext/{ext_name}` prefix

**App Loading Process:**
1. Scan `app/apps/` for directories with `manifest.json`
2. Read manifest and store in `loaded_apps` global
3. Apps register their own blueprints via extension loading
4. App backends are proxied through `/api/app/{app_id}/*` routes

**Critical Routes:**
- `/` - Serves main frontend HTML
- `/api/app/{app_id}/{subpath:path}` - HTTP proxy to app workers
- `/ws/app/{app_id}/{route:path}` - WebSocket proxy to app workers
- `/api/browse` - File system browser
- `/api/settings` - Settings persistence
- `/api/state` - Client state storage
- `/api/framework/runtime/shutdown` - Framework shutdown endpoint

---

### 4. IPC Server: `app/ipc/server.py`

**Location:** `/app/ipc/server.py`

**Process:**
```python
# Flask-based microservice running on separate process
# Port: 9123 (default, configurable via TE_IPC_PORT)
# Purpose: Synchronous control plane for async ASGI framework

# Endpoints:
# - GET  /health - Health check
# - POST /messages - Broadcast message to SSE listeners
# - GET  /stream - SSE stream for real-time events
# - POST /actions/shutdown - Request framework shutdown
# - POST /actions/agent-spawn - Spawn agent shell (LEGACY - NOT USED)

# Design:
# - Flask with threading enabled
# - SSE stream for pub/sub messaging
# - CORS enabled for cross-origin access
```

**Agent Spawning via IPC (LEGACY):**
The `/actions/agent-spawn` endpoint exists but is **NOT USED** by the current implementation. A "rogue agent" attempted to implement conversation loading via IPC but this was rolled back. The current flow spawns agents directly via the ASGI framework's `FrameworkShellManager`.

**IPC Control Module:** `app/ipc/control.py`
- `spawn_agent()` - Synchronous HTTP call to framework's internal agent spawn endpoint
- **Note:** This endpoint `/api/internal/agents/spawn` does NOT exist in current codebase
- **Conclusion:** IPC agent spawning is INCOMPLETE/NON-FUNCTIONAL

---

### 5. File Editor CM6 App: `app/apps/file_editor_cm6/`

**Location:** `/app/apps/file_editor_cm6/`

**Manifest:** `manifest.json`
```json
{
  "name": "Code Viewer (CM6)",
  "id": "file_editor_cm6",
  "entrypoints": {
    "backend_blueprint": "main.py",
    "frontend_template": "template.html",
    "frontend_script": "main.js"
  },
  "fullscreen": true,
  "ipc_modules": [
    "app.apps.file_editor_cm6.ipc_bridge"
  ]
}
```

**Backend Entry:** `main.py`
- Creates `file_editor_cm6_bp` APIRouter
- Includes agent routes via `agent_routes.py`
- Includes terminal routes via `terminal_backend.py`
- Adds WebSocket route `/ws/agent` for agent communication

**Key Modules:**
- `agent_routes.py` - REST API for agent management
- `agent_ws.py` - WebSocket handler for agent communication
- `agent_bridge.py` - Protocol normalization layer
- `agent_session_store.py` - Session persistence
- `agent_preferences.py` - User preferences
- `ipc_bridge.py` - IPC integration (for planned features)

---

### 6. Agent Routes: `agent_routes.py`

**Location:** `/app/apps/file_editor_cm6/agent_routes.py`

**Endpoints:**

#### POST `/agent/create` - Create agent session
```python
# Request: {"agent":"codex","cwd":"/path/to/project","session":"optional-id"}
# Response: {"ok":true,"data":{"session_id":"...","shell_id":"...","agent_type":"codex"}}

# Process:
# 1. Validate agent type (codex | gemini)
# 2. Generate session ID if not provided
# 3. Call bridge.spawn_agent()
# 4. Return shell metadata
```

#### GET `/agent/list` - List active agents
```python
# Response: {"ok":true,"data":[{session_id, shell_id, label, alive, cwd, uptime}]}

# Process:
# 1. Call bridge.list_agents()
# 2. Return array of agent session metadata
```

#### GET `/agent/shell/status` - Check Codex MCP server status
```python
# Response: {"ok":true,"data":{"shell_id":"...","status":"running","alive":true}}

# Process:
# 1. Get FrameworkShellManager
# 2. List all shells
# 3. Find shell with command containing 'codex mcp-server'
# 4. Return shell status if found, null otherwise

# CRITICAL: This is how frontend checks if Codex is running
```

#### GET `/agent/{session_id}` - Get agent stats
```python
# Response: {"ok":true,"data":{session_id, alive, cpu_percent, rss_mb, uptime, pid}}

# Process:
# 1. Call bridge.get_agent_stats(session_id)
# 2. Return process statistics
```

#### DELETE `/agent/{session_id}` - Terminate agent
```python
# Process:
# 1. Call bridge.terminate_agent(session_id)
# 2. Remove shell gracefully
```

#### Session Management Endpoints:
- `GET /agent/sessions` - List saved sessions (from disk)
- `POST /agent/sessions` - Create new session record
- `GET /agent/session/{session_id}` - Get full session with messages
- `DELETE /agent/session/{session_id}` - Delete session
- `POST /agent/session/{session_id}/send` - Send message to agent

---

### 7. Agent WebSocket Handler: `agent_ws.py`

**Location:** `/app/apps/file_editor_cm6/agent_ws.py`

**WebSocket Route:** `/ws/agent`

**Query Parameters:**
- `agent` - Agent type (codex | gemini) - default: codex
- `cwd` - Working directory (optional)
- `file` - Current file path for context (optional)
- `session` - Requested session ID (optional)

**Architecture:** ONE shared shell per agent type
- Multiple UI sessions multiplex via `conversationId` in messages
- Shell labeled as `agent-{type}-shared-c` for discoverability
- Survives worker restarts via label-based shell lookup

**Connection Flow:**
```python
# 1. Accept WebSocket connection
# 2. Parse query parameters (agent, cwd, file, session)
# 3. Find or spawn shared shell:
#    a. Search for existing shell by label "agent-{type}-shared-c"
#    b. If found and running: reuse shell
#    c. If not found: spawn new shared shell
#    d. Store mapping in _shared_shells global registry
# 4. Initialize Codex MCP (ONCE per shell lifetime):
#    - Send JSON-RPC initialize method
#    - Store shell_id in _initialized_shells set
# 5. Subscribe to agent output queue
# 6. Send 'connected' event to frontend with shell metadata
# 7. Start bidirectional forwarding:
#    - Task 1: Agent output → WebSocket (forward_agent_to_ws)
#    - Task 2: WebSocket → Agent (receive and process)
```

**Message Flow: Frontend → Agent**
```python
# 1. Receive JSON message from WebSocket
# 2. Parse message: {id, action, text, conversationId, session, file}
# 3. Normalize conversationId (remove empty/null strings)
# 4. Determine chat_session_id (message.session || requested_session_id || shared_session_id)
# 5. Load saved session from disk (agent_session_store)
# 6. Build history transcript if available
# 7. Determine if conversation restore needed:
#    - Shell ID changed (worker restarted)
#    - No conversation ID stored
#    - Conversation ID not in memory (CodexAdapter._conversations)
# 8. Enrich context (file content, git status if file specified)
# 9. Apply approval policy and sandbox settings (from saved session)
# 10. Update session state in bridge
# 11. Map request ID → chat_session_id (for response routing)
# 12. Persist user message to disk
# 13. Write to agent via bridge.write_message()
```

**Message Flow: Agent → Frontend**
```python
# 1. Read chunks from PTY output queue
# 2. Buffer chunks into complete lines (line_buffer)
# 3. Parse JSON from each line
# 4. Normalize via bridge.parse_agent_output()
# 5. Map request ID back to session ID (via request_session_map)
# 6. Handle special events:
#    - conversation_started: Store conversationId in CodexAdapter._conversations
#    - token: Stream assistant response (not persisted per token)
#    - final: Complete response (persisted to disk)
#    - system: Planning/reasoning messages
#    - error: Error messages
# 7. Persist agent messages to session store
# 8. Send normalized event to WebSocket
# 9. Clean up request map after final/error events
```

**CRITICAL ISSUES FOUND:**

#### Issue 1: Conversation ID Restoration Timing
```python
# BUG: Restoration happens AFTER connected event is sent
# Lines 166-186 in agent_ws.py

existing_shell = await manager.find_shell_by_label(label, status='running')
if existing_shell:
    shell_id = existing_shell.id
    # ... session_id assignment ...
    bridge.attach_session(session_id, shell_id)
    _shared_shells[agent_type] = (session_id, shell_id)
    await _send_connected_event(shell_id, session_id)  # SENT HERE
    connected_sent = True
    
    # FIX 1: Conversation ID restoration happens AFTER handshake
    if requested_session_id:
        from .agent_bridge import CodexAdapter
        saved = get_session(requested_session_id)
        if saved and saved.get('conversationId'):
            CodexAdapter.store_conversation_id(requested_session_id, saved['conversationId'])
            # Restored, but frontend already received 'connected' event

# IMPACT: Frontend thinks it's connected but conversation ID not yet restored
# SOLUTION: Move restoration BEFORE _send_connected_event()
```

#### Issue 2: Request Map Cleanup Sequencing
```python
# Note: This code is actually CORRECT
# Lines 429-431 in agent_ws.py

# Clean up request map AFTER persistence
if normalized.get('event') in ('final', 'error') and request_id is not None:
    async with request_map_lock:
        request_session_map.pop(str(request_id), None)  # CLEANUP

# Persistence happens BEFORE cleanup (lines 374-425)
# This is the correct order: persist first, then cleanup tracking
# Comment is slightly misleading but code is functional
```

#### Issue 3: Conversation Restoration Logic (CRITICAL CONTEXT)
```python
# Lines 507-522 in agent_ws.py
# This logic is NECESSARY - not a bug

if history_transcript:
    if saved_shell and saved_shell != shell_id:
        needs_restore = True  # Shell changed (worker restart)
    elif not stored_conversation:
        needs_restore = True  # No conversation ID
    elif not CodexAdapter._conversations.get(chat_session_id):
        needs_restore = True  # Not in memory after restart

# WHY THIS IS CRITICAL:
# Codex MCP server does NOT persist conversations internally
# The ONLY way to restore context is to inject the full history transcript
# into the next message as if the user is "reminding" the agent
#
# When needs_restore=True:
#   message['text'] = f"{history_transcript}\n\nUser: {user_message}"
#   message['conversationId'] = None  # Start NEW conversation with history
#
# This worked flawlessly in WSGI version (Flask with threading)
# ASGI migration broke this because:
# 1. In-memory CodexAdapter._conversations lost on worker restart
# 2. Restoration happens AFTER handshake (Issue #1)
# 3. Race conditions in async event loop

# The three-condition check is intentional:
# - Condition 1: Shell changed (process restarted)
# - Condition 2: No stored ID (never had conversation)
# - Condition 3: ID lost from memory (worker restart with shell alive)
```

---

### 8. Agent Bridge: `agent_bridge.py`

**Location:** `/app/apps/file_editor_cm6/agent_bridge.py`

**Purpose:** Protocol normalization layer between frontend and agent processes

**Classes:**

#### `CodexAdapter` - Codex MCP Protocol Translation

**State Management:**
- `_conversations` - Dict[session_id, conversation_id] - In-memory mapping
- `_last_messages` - Dict[request_id, message] - Last complete message per request

**Methods:**

##### `to_agent(normalized, context)` - Translate to MCP
```python
# Input: {"id":"42","action":"chat","text":"...","conversationId":"..."}
# Output: JSON-RPC 2.0 tool call

# Logic:
# 1. Check if conversationId provided (session continuation)
# 2. If yes: Use "codex-reply" tool with conversationId
# 3. If no: Use "codex" tool to start new conversation
# 4. Add context enrichment (file content, approval policy, sandbox)
# 5. Return MCP tool call: {jsonrpc:"2.0",method:"tools/call",params:{name,arguments}}
```

##### `from_agent(mcp_msg)` - Translate from MCP
```python
# Input: MCP JSON-RPC response/notification
# Output: Normalized event for frontend

# Event Types:
# - initialized: MCP handshake complete
# - conversation_started: New conversation created (has conversationId)
# - token: Streaming response delta (agent_message_delta)
# - final: Complete response (task_complete with last_agent_message)
# - system: Reasoning/planning/task events
# - elicitation: Approval request (exec_approval_request)
# - progress: Progress updates
# - error: JSON-RPC error

# CRITICAL: conversation_started event contains conversationId
# This must be stored in _conversations for future messages
```

##### `store_conversation_id(session_id, conversation_id)` - Store mapping
```python
# Stores session_id → conversation_id mapping
# Called when conversation_started event received
# Used to route future messages to correct conversation
```

#### `GeminiAdapter` - Gemini ACP Protocol Translation
(Excluded from analysis per instructions - not working/not focus)

#### `AgentBridge` - Main coordination class

**State:**
- `_sessions` - Dict[session_id, shell_id] - Session to shell mapping
- `_session_state` - Dict[session_id, state_dict] - Per-session state
- `_adapters` - Dict[agent_type, AdapterClass] - Protocol adapters

**Methods:**

##### `spawn_agent(agent_type, cwd, session_id)` - Spawn new agent
```python
# Process:
# 1. Validate agent type
# 2. Build command: ['codex', 'mcp-server'] or ['gemini', '--experimental-acp']
# 3. Spawn via FrameworkShellManager.spawn_shell_pty()
#    - Label: "agent-{type}-{suffix}" (suffix: 'shared-c' for shared shells)
#    - PTY mode for bidirectional communication
# 4. Store session_id → shell_id mapping
# 5. Return shell metadata dict
```

##### `write_message(session_id, agent_type, message, context)` - Send to agent
```python
# Process:
# 1. Get shell_id from _sessions mapping
# 2. Get adapter for agent_type
# 3. Retrieve session_state (history, conversation_id, etc.)
# 4. If needs_restore: Inject history transcript and clear conversation_id
# 5. If stored conversation_id: Use it in message
# 6. Translate message via adapter.to_agent()
# 7. Convert to JSON line (JSON + '\n')
# 8. Write to PTY via manager.write_to_pty(shell_id, bytes)

# DEBUG LOGGING:
# - Logs shell_id, message bytes, tool name, conversation_id
# - Preview of payload (first 160 chars)
```

##### `parse_agent_output(agent_type, line)` - Parse agent response
```python
# Process:
# 1. Parse JSON from line
# 2. Get adapter for agent_type
# 3. Call adapter.from_agent()
# 4. Return normalized event dict or None if parse fails
```

##### `subscribe_output(session_id)` - Get output queue
```python
# Returns: AsyncQueue for agent output chunks
# Used by WebSocket handler to receive agent output
```

##### `set_session_state(session_id, state)` - Store session state
```python
# Stores state dict for session:
# - history_instructions: Base instructions for history restore
# - history_transcript: Full transcript for restore
# - needs_restore: Boolean flag
# - approval_policy: Approval mode (never, auto, manual)
# - sandbox: Sandbox mode (workspace-write, danger-full-access)
# - conversation_id: Codex conversation ID
# - shell_id: Current shell ID
```

##### `attach_session(session_id, shell_id)` - Map session to shell
```python
# Creates session_id → shell_id mapping
# Used when reusing existing shell
```

##### `note_conversation(session_id, conversation_id)` - Store conversation
```python
# Updates session_state with conversation_id
# Normalizes conversation_id (removes empty/null values)
```

---

### 9. Framework Shell Manager: `app/libs/framework_shells.py`

**Location:** `/app/libs/framework_shells.py`

**Purpose:** Core PTY and process lifecycle management

**Key Classes:**

#### `ShellRecord` - Shell metadata
```python
@dataclass
class ShellRecord:
    id: str
    command: List[str]
    label: Optional[str]
    cwd: str
    env_overrides: Dict[str, str]
    pid: Optional[int]
    status: str  # 'running' | 'exited'
    created_at: float
    updated_at: float
    autostart: bool
    stdout_log: str
    stderr_log: str
    exit_code: Optional[int]
    run_id: Optional[str]
    launcher_pid: Optional[int]
    adopted: bool
    uses_pty: bool
```

#### `PTYState` - PTY connection state
```python
@dataclass
class PTYState:
    master_fd: int  # PTY master file descriptor
    label: Optional[str]
    shell_id: Optional[str]
    subscribers: List[AsyncQueue[str]]  # Output subscribers
    stop: asyncio.Event  # Stop signal
    reader: Optional[asyncio.Task]  # Background reader task
```

#### `FrameworkShellManager` - Main manager

**Initialization:**
```python
# Directories:
# - base_dir: ~/.cache/te_framework
# - metadata_dir: ~/.cache/te_framework/meta
# - logs_dir: ~/.cache/te_framework/logs
# - sockets_dir: ~/.cache/te_framework/sockets

# Limits:
# - max_app_shells: 5 (app workers)
# - max_service_shells: 5 (background services/agents)

# Startup:
# 1. Create directories
# 2. Set run_id and launcher_pid
# 3. Adopt orphaned shells from previous runs
```

**Methods:**

##### `spawn_shell_pty(command, cwd, env, label, autostart)` - Spawn PTY shell
```python
# Process:
# 1. Acquire lock
# 2. Sweep (clean up dead shells)
# 3. Check if shell with same label exists (reuse if running)
# 4. Check shell count limits (app vs service)
#    - If limit reached: Terminate oldest unlocked app
# 5. Create ShellRecord
# 6. Launch via _launch_pty()
#    - Open PTY (master/slave pair)
#    - Set environment (TERM, TE_TTY, TE_SESSION_TYPE, etc.)
#    - Spawn process with stdin/stdout/stderr → slave_fd
#    - Close slave_fd (process keeps it open)
#    - Create PTYState with master_fd
#    - Start background reader task (_async_reader)
# 7. Store PTYState in _pty dict
# 8. Return ShellRecord

# Background Reader Task:
# - Polls master_fd using select() in executor
# - Reads up to 4096 bytes per iteration
# - Writes to stdout log file
# - Broadcasts to all subscribers (AsyncQueue)
# - Runs until stop event set or PTY closed
```

##### `write_to_pty(shell_id, data)` - Write to PTY
```python
# Process:
# 1. Acquire lock
# 2. Get PTYState from _pty dict
# 3. Convert data to bytes if string
# 4. Write to master_fd using os.write() in executor
# 5. Log debug message with preview

# CRITICAL: This is how messages reach the agent
# Data format: JSON-RPC line (JSON object + '\n')
```

##### `subscribe_output(shell_id)` - Subscribe to output
```python
# Process:
# 1. Acquire lock
# 2. Get PTYState from _pty dict
# 3. Create AsyncQueue
# 4. Add queue to PTYState.subscribers
# 5. Return queue

# Queue receives decoded text chunks from background reader
```

##### `find_shell_by_label(label, status)` - Find shell by label
```python
# Process:
# 1. Acquire lock
# 2. Sweep (clean up dead shells)
# 3. Iterate over shell records
# 4. Match label and optional status
# 5. If status='running': Verify PID alive
# 6. Return first match or None

# CRITICAL: This is how shared shells are discovered across restarts
# Label "agent-codex-shared-c" persists in metadata
```

##### `describe(record, include_logs, tail_lines)` - Get shell details
```python
# Returns dict with:
# - All ShellRecord fields
# - stats: {alive, uptime, cpu_percent, memory_rss, num_threads}
# - logs: {stdout_tail, stderr_tail} (if include_logs=True)

# Process stats via psutil or ps command
```

##### `terminate_shell(shell_id, force, timeout)` - Stop shell
```python
# Process:
# 1. Acquire lock
# 2. Load ShellRecord
# 3. Check if PID alive
# 4. Send SIGKILL (if force) or SIGTERM
# 5. Wait for process exit (up to timeout)
# 6. Send SIGKILL if still alive after timeout
# 7. Collect exit code via waitpid()
# 8. Mark shell as exited
# 9. Stop PTY reader task and close master_fd
# 10. Return updated ShellRecord
```

---

## Complete User Interaction Flow: Opening Agent Drawer

### Step-by-Step Process (Codex MCP)

**1. User opens agent drawer in File Editor CM6 UI**
- Frontend loads `file_editor_cm6` app
- User clicks "Agent" button or opens agent panel

**2. Frontend checks agent status**
```javascript
// GET /api/app/file_editor_cm6/agent/shell/status
// Response: {ok: true, data: {shell_id: "fs_...", status: "running", alive: true}}
```

**3. Frontend establishes WebSocket connection**
```javascript
// WebSocket: /ws/app/file_editor_cm6/ws/agent?agent=codex&cwd=/path&file=/path/file.js
// Query params: {agent: "codex", cwd: "/home/user/project", file: "/home/user/project/index.js"}
```

**4. Backend WebSocket handler (agent_ws.py) processes connection**
```python
# a. Accept WebSocket
# b. Parse query params: agent=codex, cwd=..., file=...
# c. Look for existing shared shell by label "agent-codex-shared-c"
#    - Call manager.find_shell_by_label("agent-codex-shared-c", status="running")
#    - If found: Reuse shell (skip to step e)
#    - If not found: Continue to step d
# d. Spawn new shared shell:
#    - Call bridge.spawn_agent("codex", cwd, session_id)
#    - bridge calls manager.spawn_shell_pty(["codex", "mcp-server"], cwd=..., label="agent-codex-shared-c")
#    - manager creates PTY, spawns process, starts background reader
#    - Returns ShellRecord with shell_id
# e. Initialize Codex MCP (if not already initialized):
#    - Send JSON-RPC initialize method
#    - {"jsonrpc":"2.0","id":"init-mcp","method":"initialize","params":{...}}
#    - Mark shell as initialized in _initialized_shells set
# f. Subscribe to agent output queue:
#    - Call manager.subscribe_output(shell_id)
#    - Returns AsyncQueue for receiving output
# g. Send 'connected' event to frontend:
#    - {"event":"connected","agent":"codex","shell_id":"...","session_id":"..."}
# h. **POTENTIAL BUG**: Conversation ID restoration happens HERE (after connected event)
#    - If saved session exists with conversationId:
#      - Load session from disk
#      - Store conversationId in CodexAdapter._conversations
#    - Frontend already received 'connected' but mapping not restored yet
```

**5. Frontend receives 'connected' event**
```javascript
// Event: {event: "connected", agent: "codex", shell_id: "fs_...", session_id: "..."}
// UI updates: Shows agent as connected
```

**6. User types message in agent drawer**
```javascript
// User input: "Explain this function"
// Frontend sends WebSocket message:
{
  "id": "req-12345",
  "action": "chat",
  "text": "Explain this function",
  "session": "session-abc123",  // Chat session ID (persistent)
  "file": "/home/user/project/index.js"
}
```

**7. Backend WebSocket handler processes message**
```python
# a. Parse JSON from WebSocket
# b. Normalize conversationId (remove empty/null strings)
# c. Determine chat_session_id: message.session || requested_session || shared_session
# d. Load saved session from disk (agent_session_store.get_session)
# e. Check if history restore needed:
#    - saved_shell != current_shell_id (worker restarted)
#    - OR no stored conversationId
#    - OR conversationId not in CodexAdapter._conversations
# f. If needs_restore and has history:
#    - Build history transcript from saved messages
#    - Inject transcript into message text
#    - Clear conversationId (start fresh conversation with history)
# g. If NOT needs_restore:
#    - Use stored conversationId from session
#    - **POTENTIAL BUG**: If conversationId was cleared but should exist, message fails
# h. Enrich context with file content (if file specified):
#    - Read file content
#    - Detect language from extension
#    - Add to context dict
# i. Apply approval policy and sandbox (from saved session)
# j. Set session state in bridge (history, conversation_id, etc.)
# k. Map request ID → chat_session_id (for response routing)
# l. Persist user message to disk
# m. Write to agent via bridge.write_message()
```

**8. AgentBridge.write_message() processes message**
```python
# a. Get shell_id from _sessions mapping
# b. Get CodexAdapter
# c. Check session_state for needs_restore:
#    - If needs_restore with history:
#      - Inject history transcript into message text
#      - Clear conversationId
#      - Set needs_restore = False
# d. Enforce stored conversation_id if available:
#    - If session_state has conversation_id: Use it
#    - Else: Clear conversationId
# e. Translate message via CodexAdapter.to_agent():
#    - If conversationId: Use "codex-reply" tool
#    - Else: Use "codex" tool to start new conversation
#    - Add context (cwd, approval_policy, sandbox, file content)
# f. Convert to JSON line: json.dumps(mcp_msg) + '\n'
# g. Write to PTY: manager.write_to_pty(shell_id, bytes)
```

**9. FrameworkShellManager.write_to_pty() sends to agent**
```python
# a. Acquire lock
# b. Get PTYState for shell_id
# c. Convert data to bytes
# d. Write to master_fd: os.write(master_fd, bytes)
# e. Log debug message with preview
```

**10. Codex MCP server receives message**
```bash
# PTY slave_fd receives JSON line
# Codex parses JSON-RPC tool call
# Codex processes request (sends to Claude API)
# Codex streams response events to stdout
```

**11. FrameworkShellManager background reader receives output**
```python
# a. Background task polls master_fd
# b. Reads chunks (up to 4096 bytes)
# c. Writes to stdout log file
# d. Broadcasts text to all subscribers (AsyncQueue)
```

**12. WebSocket handler receives output from queue**
```python
# a. Get chunk from output_queue (AsyncQueue)
# b. Append to line_buffer
# c. Extract complete lines (split on '\n')
# d. Parse JSON from each line
# e. Normalize via bridge.parse_agent_output()
# f. Map request ID back to chat_session_id (via request_session_map)
# g. Handle special events:
#    - conversation_started: Store conversationId
#      - CodexAdapter.store_conversation_id(chat_session_id, conversationId)
#      - bridge.note_conversation(chat_session_id, conversationId)
#      - **POTENTIAL BUG**: Also persist to disk immediately
#      - **ISSUE**: Don't clean up request_session_map yet (need for 'final' event)
#    - token: Stream to frontend (not persisted)
#    - final: Complete response (persisted to disk with full text)
# h. Persist agent messages to session store (append_message)
# i. Send normalized event to WebSocket
# j. Clean up request_session_map after 'final' or 'error'
```

**13. Frontend receives normalized events**
```javascript
// Event stream:
// 1. {id: "req-12345", event: "conversation_started", conversationId: "conv-xyz"}
// 2. {id: "req-12345", event: "system", text: "[Task started]"}
// 3. {id: "req-12345", event: "token", text: "This function"}
// 4. {id: "req-12345", event: "token", text: " is responsible"}
// 5. {id: "req-12345", event: "token", text: " for..."}
// 6. {id: "req-12345", event: "final", text: "This function is responsible for...", ok: true}

// UI updates:
// - Display streaming tokens in agent bubble
// - Mark conversation as started (conversationId stored)
// - Show final response
```

**14. User sends follow-up message**
```javascript
// Frontend sends WebSocket message:
{
  "id": "req-67890",
  "action": "chat",
  "text": "Can you refactor it?",
  "session": "session-abc123",
  "conversationId": "conv-xyz"  // Reuse conversation
}
```

**15. Backend routes to existing conversation**
```python
# a. Parse message
# b. chat_session_id = "session-abc123"
# c. Load saved session (has conversationId: "conv-xyz")
# d. Check if needs_restore: NO (conversationId exists in memory and on disk)
# e. Use stored conversationId: "conv-xyz"
# f. Translate via CodexAdapter.to_agent():
#    - conversationId present: Use "codex-reply" tool
#    - {"jsonrpc":"2.0","method":"tools/call","params":{"name":"codex-reply","arguments":{"conversationId":"conv-xyz","prompt":"Can you refactor it?"}}}
# g. Write to PTY
# h. Codex continues existing conversation
```

---

## Conversation Restoration Deep Dive

### Why Conversation Restoration is Essential

**Key Fact:** Codex MCP server does NOT persist conversations internally.

**Experimental Alternative:** There is a `codex app-server` mode with native conversation storage, but:
- Doesn't accept standard MCP JSON-RPC requests
- Doesn't support MCP tool lists
- Documentation is minimal and incomplete
- Not production-ready for this use case

**Therefore:** The framework MUST handle conversation restoration entirely.

### How Conversation Restoration Works

**The Strategy:**
When the framework detects that a conversation context has been lost (worker restart, shell restart, or missing conversation ID), it injects the complete history transcript into the next user message, effectively "reminding" the agent of the entire prior conversation.

**Example:**

**User's actual message:**
```
Can you refactor this function?
```

**What gets sent to Codex when restoration needed:**
```
User: Hello, can you help me?
Assistant: Of course! I'd be happy to help. What do you need assistance with?
User: I'm working on a Python function that's too long.
Assistant: I can help you refactor it. Please share the function.
User: [function code here]
Assistant: I see several ways to improve this...

User: Can you refactor this function?
```

The agent receives the full context as if the user pasted the entire conversation history, then asks their new question.

### Three Restoration Triggers

**Condition 1: Shell ID Changed**
```python
if saved_shell and saved_shell != shell_id:
    needs_restore = True
```
- **Scenario:** Agent process was killed and restarted
- **Why:** New shell = new MCP server process = no memory of conversation
- **Action:** Inject full history

**Condition 2: No Stored Conversation ID**
```python
elif not stored_conversation:
    needs_restore = True
```
- **Scenario:** Session exists but no conversation started yet (first message)
- **Why:** No conversation to restore, but history exists from previous attempts
- **Action:** Inject history to start fresh conversation with context

**Condition 3: Not In Memory**
```python
elif not CodexAdapter._conversations.get(chat_session_id):
    needs_restore = True
```
- **Scenario:** Worker process restarted (uvicorn reload) but shell survived
- **Why:** In-memory mapping lost, but shell + conversation still alive
- **Action:** Inject history to re-establish context
- **Note:** This is the ASGI-specific condition that wasn't needed in WSGI

### Why WSGI Didn't Have This Problem

**WSGI (Flask) Architecture:**
- Single worker process (typically)
- Worker stays alive across requests
- `CodexAdapter._conversations` dict persists in memory
- Minimal need for restoration from disk

**ASGI (Uvicorn) Architecture:**
- Multiple worker processes
- Workers restart on code changes
- Each worker has its own memory space
- In-memory dicts lost on worker restart
- Framework shells managed separately, can outlive workers
- **Result:** More frequent restoration needed

### What Breaks After ASGI Migration

**The Race Condition:**
```python
# Current flow (BROKEN):
1. Frontend connects via WebSocket
2. Backend finds existing shell (still alive after worker restart)
3. Backend sends 'connected' event to frontend
4. ❌ Frontend can send message immediately
5. Backend restores conversation ID from disk (TOO LATE)
6. ❌ Message sent without conversation context
7. ❌ New conversation started instead of continuing existing one
```

**The Fix:**
```python
# Fixed flow:
1. Frontend connects via WebSocket
2. Backend finds existing shell
3. Backend restores conversation ID from disk (BEFORE handshake)
4. Backend sends 'connected' event to frontend
5. ✅ Frontend sends message
6. ✅ Backend has conversation context ready
7. ✅ Message routed to correct conversation
```

### Why All Three Conditions Are Not Redundant

**Claim:** "Condition 3 is redundant with Condition 2"

**Reality:** They handle different scenarios:

**Condition 2:** `not stored_conversation`
- Session file has `conversationId: null` or field missing
- Never started a conversation
- Or conversation was explicitly cleared

**Condition 3:** `not in memory`
- Session file has `conversationId: "conv-abc123"`
- Conversation ID is stored and valid
- But worker restarted, so in-memory mapping is empty
- Shell is still alive with active conversation

**Example Scenario:**
```
1. Start conversation: conversationId = "conv-abc123"
2. Save to disk: {conversationId: "conv-abc123", shell_id: "fs_xxx"}
3. Continue conversation: All messages use "conv-abc123"
4. Uvicorn worker restarts (code change, memory limit, etc.)
5. In-memory: CodexAdapter._conversations = {} (empty)
6. On disk: conversationId = "conv-abc123" (still there)
7. Shell: Still alive with PID, conversation still active
8. User sends message:
   - Condition 2 fails: stored_conversation = "conv-abc123" (exists)
   - Condition 3 triggers: not in CodexAdapter._conversations (lost)
   - needs_restore = True
   - History injected, conversation re-established
```

Without Condition 3, the framework would try to use `conversationId: "conv-abc123"` but the shell doesn't recognize it (memory lost), causing the agent to return an error or start a new conversation without context.

---

## Issues Found and Root Cause Analysis

### Issue 1: Conversation ID Restoration Race Condition

**Location:** `app/apps/file_editor_cm6/agent_ws.py` lines 166-186

**Problem:**
The `connected` event is sent to the frontend BEFORE the conversation ID is restored from disk when reusing an existing shell. This creates a window where:
1. Frontend thinks agent is connected
2. User sends message immediately
3. Backend hasn't restored conversationId yet
4. Message routed as NEW conversation instead of continuing existing one

**Root Cause:**
After the WSGI→ASGI migration, the worker process can restart while keeping the agent shell alive (via framework shell persistence). The in-memory `CodexAdapter._conversations` mapping is lost, but the conversation metadata is persisted on disk. The restoration code was added as "FIX 1" but placed AFTER the handshake event.

**Impact:**
- User loses conversation context on worker restart
- New conversation started instead of continuing existing one
- History transcript not injected (though it should be per needs_restore logic)

**Fix Required:**
Move conversation ID restoration BEFORE sending the `connected` event:

```python
# BEFORE (current code):
await _send_connected_event(shell_id, session_id)
connected_sent = True
# FIX 1: Restore conversation ID mapping
if requested_session_id:
    from .agent_bridge import CodexAdapter
    saved = get_session(requested_session_id)
    if saved and saved.get('conversationId'):
        CodexAdapter.store_conversation_id(requested_session_id, saved['conversationId'])

# AFTER (fixed code):
# Restore conversation ID mapping FIRST
if requested_session_id:
    from .agent_bridge import CodexAdapter
    saved = get_session(requested_session_id)
    if saved and saved.get('conversationId'):
        CodexAdapter.store_conversation_id(requested_session_id, saved['conversationId'])
        print(f"[Agent WS] Restored conversation ID {saved['conversationId'][:8]}... for session {requested_session_id}")
# THEN send handshake
await _send_connected_event(shell_id, session_id)
connected_sent = True
```

---

### Issue 2: Conversation Restoration Is Essential (NOT A BUG)

**Location:** `app/apps/file_editor_cm6/agent_ws.py` lines 507-522

**CLARIFICATION - This is NOT a bug. This is the ONLY way to restore conversations.**

**Context:**
Codex MCP server does NOT have built-in conversation persistence. There is an experimental "codex app-server" mode with native conversation storage, but:
- It doesn't accept standard MCP JSON-RPC requests
- It doesn't support tool lists
- Documentation is minimal
- Not production-ready

**Therefore:** The ONLY way to restore a conversation after worker/server restart is to inject the complete history transcript into the next user message, making it appear as if the user is "reminding" the agent of the previous conversation.

**The Three-Condition Logic:**
```python
if history_transcript:
    if saved_shell and saved_shell != shell_id:
        needs_restore = True  # Shell changed - process restarted
    elif not stored_conversation:
        needs_restore = True  # No conversation ID - never started
    elif not CodexAdapter._conversations.get(chat_session_id):
        needs_restore = True  # Not in memory - worker restarted but shell alive
```

**Why All Three Conditions Are Necessary:**

1. **Shell ID changed:** The agent process was killed and restarted. MCP conversation is gone.
2. **No stored conversation ID:** This session never had a conversation started (first message).
3. **Not in memory:** Worker process restarted (ASGI/uvicorn reload) but the framework shell survived. The in-memory `CodexAdapter._conversations` dict was lost, but the shell and its conversation are still alive.

**What Happens When needs_restore=True:**
```python
# Inject full history as if user is reminding the agent
message['text'] = f"{history_transcript}\n\nUser: {actual_user_message}"
message['conversationId'] = None  # Force NEW conversation with history context
```

**This Worked Flawlessly in WSGI:**
- Flask with threading kept the worker process alive
- `CodexAdapter._conversations` mapping persisted across requests
- Minimal need for restoration from disk

**This Broke During ASGI Migration:**
- Uvicorn worker processes restart during code reloads
- Framework shells survive (managed separately)
- In-memory conversation mappings lost
- Restoration needed but happens AFTER handshake (Issue #1)

---

### Issue 3: Comment Clarity on Request Map Cleanup

**Location:** `app/apps/file_editor_cm6/agent_ws.py` line 429

**Problem:**
Comment says "Clean up request map AFTER persistence" but the code is actually correct - cleanup happens after persistence. This misleading comment wastes developer time.

**Current Code:**
```python
# Persist agent messages to session (lines 374-425)
try:
    if event_type == 'token':
        pass  # Skip persistence for tokens
    elif event_type == 'final':
        append_message(session_key, {...})  # PERSISTED
except Exception as e:
    print(f"Failed to persist: {e}")

# Clean up request map AFTER persistence
if normalized.get('event') in ('final', 'error') and request_id is not None:
    async with request_map_lock:
        request_session_map.pop(str(request_id), None)  # CLEANUP
```

**Root Cause:**
The code is correct, but the comment placement and wording are confusing. Readers might think cleanup happens before persistence due to comment proximity.

**Impact:**
- Developer confusion
- Time wasted verifying correctness
- No functional bug (code works as intended)

**Fix Required:**
Improve comment clarity:

```python
# Persist message to disk before cleaning up request tracking
try:
    if event_type == 'final':
        append_message(session_key, {...})
except Exception as e:
    print(f"Failed to persist: {e}")

# Now safe to remove request tracking (persistence complete)
if normalized.get('event') in ('final', 'error') and request_id is not None:
    async with request_map_lock:
        request_session_map.pop(str(request_id), None)
```

---

### Issue 4: Conversation ID Normalization Inconsistency

**Location:** Multiple locations

**Problem:**
Conversation IDs are normalized in multiple places using different logic, creating potential for edge cases where valid IDs are incorrectly cleared.

**Normalization Points:**
1. `agent_ws.py` line 492: `_normalize_conversation_id()` on incoming message
2. `agent_ws.py` line 543: Envelope assignment after history restore logic
3. `agent_bridge.py` line 21: `_normalize_conversation_id()` in AgentBridge
4. `agent_bridge.py` line 691: Normalization in `set_session_state()`
5. `agent_bridge.py` line 698: Normalization in `note_conversation()`

**Root Cause:**
After the ASGI migration, conversation IDs started coming from multiple sources (frontend, disk, memory). Each source has slightly different formats (string, None, "null", "undefined"). The normalization function was added to handle this, but it's called inconsistently.

**Impact:**
- Valid conversation IDs might be cleared in some code paths
- Edge cases where empty string "" is treated as valid
- Debugging difficulty (which normalization point caused the issue?)

**Fix Required:**
Centralize normalization in a single place:

```python
# In agent_bridge.py:
def _normalize_conversation_id(value):
    """Normalize conversation IDs from any source. Returns None for invalid values."""
    if value is None:
        return None
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed or trimmed.lower() in {'null', 'none', 'undefined', 'false'}:
            return None
        return trimmed
    return None

# In agent_ws.py, normalize ONCE on message arrival:
conversation_id = _normalize_conversation_id(message.get('conversationId'))
message['conversationId'] = conversation_id  # Store normalized value

# All subsequent code uses message['conversationId'] without re-normalizing
```

---

### Issue 5: IPC Agent Spawning Non-Functional

**Location:** `app/ipc/server.py` and `app/ipc/control.py`

**Problem:**
The IPC server has an `/actions/agent-spawn` endpoint that attempts to spawn agents via a framework endpoint `/api/internal/agents/spawn`, but this endpoint doesn't exist in the current codebase.

**Code:**
```python
# app/ipc/control.py line 32:
url = f"{FRAMEWORK_URL}/api/internal/agents/spawn"
resp = requests.post(url, json=payload, headers=_auth_headers(), timeout=15.0)
```

**Root Cause:**
A "rogue agent" attempted to implement the IPC-based conversation loading protocol outlined in `ipcproposal.plan`. This plan involved:
1. IPC server handling conversation loading/spawning logistics
2. Framework registering IPC stacks via manifest
3. Synchronous control flow for agent lifecycle

This was partially implemented but then rolled back when the team decided not to use IPC for agent spawning. However, the IPC server code was left in place.

**Impact:**
- Non-functional code in codebase
- Potential confusion for developers
- No actual bug (code path never executed)

**Fix Required:**
Two options:
1. Remove IPC agent spawning code entirely
2. Implement `/api/internal/agents/spawn` endpoint in main.py if IPC spawning is desired

**Recommendation:** Remove IPC agent spawning. The current direct spawning via `FrameworkShellManager` is simpler and works correctly. The IPC server should remain for its other functions (SSE streaming, shutdown control) but agent spawning should stay in the ASGI framework.

---

## Extension System Role in Agent Drawer Flow

### Extension Loading (main.py)

**When:** Framework startup (lifespan.startup)

**Process:**
1. Scan `app/extensions/` for directories with `manifest.json`
2. Load `backend_blueprint` modules
3. Register APIRouter instances with FastAPI
4. Extensions registered with prefix `/api/ext/{ext_name}` (except 'apps' extension)

**Agent-Related Extensions:**
- **apps extension:** Provides app management APIs (start, stop, list apps)
  - No prefix (direct mount)
  - Not directly involved in agent drawer flow

### App Loading (main.py)

**When:** Framework startup (lifespan.startup)

**Process:**
1. Scan `app/apps/` for directories with `manifest.json`
2. Load manifest metadata into `loaded_apps` global
3. App backend blueprints auto-registered via extensions mechanism
4. App manifests specify:
   - `backend_blueprint` - Python module to load
   - `ipc_modules` - IPC bridge modules (optional, for planned features)
   - `fullscreen` - UI layout hint

**File Editor CM6 App:**
- `backend_blueprint: "main.py"` - Loads APIRouter with agent routes
- `ipc_modules: ["app.apps.file_editor_cm6.ipc_bridge"]` - Planned feature (not used)
- Blueprint registered at `/api/app/file_editor_cm6/*` via proxy

### App Proxy System (main.py)

**HTTP Proxy:** `/api/app/{app_id}/{subpath:path}`
- Routes HTTP requests to app worker process
- Looks up running app in `running_apps` registry
- Forwards request to `http://127.0.0.1:{port}/{subpath}`
- Returns 503 if app not running

**WebSocket Proxy:** `/ws/app/{app_id}/{route:path}`
- Routes WebSocket connections to app worker process
- Establishes bidirectional forwarding:
  - Client → Worker: Forward all text messages
  - Worker → Client: Forward all responses
- Handles connection cleanup on disconnect

**Agent WebSocket Route:**
- App route: `/ws/agent` in file_editor_cm6 blueprint
- Full path: `/ws/app/file_editor_cm6/ws/agent` (via proxy)
- Direct handler: `agent_websocket()` in `agent_ws.py`
- **NO proxying** - handled directly by app blueprint

**Why no proxying for agent WebSocket?**
The agent WebSocket is NOT proxied to a separate worker process. The `file_editor_cm6` app blueprint is loaded directly into the main framework process, so the agent WebSocket handler runs in the same process as the framework. This is different from app workers that run as separate processes.

---

## Summary of Critical Findings

### Working Components
✅ Framework entry point flow (run_framework.sh → supervisor → main.py)  
✅ IPC server startup and management  
✅ Extension and app loading system  
✅ Framework shell PTY management  
✅ Agent spawning via FrameworkShellManager  
✅ Shared shell architecture (one shell per agent type)  
✅ Codex MCP protocol translation  
✅ Message persistence to disk  
✅ WebSocket bidirectional forwarding  

### Broken/Problematic Components
❌ Conversation ID restoration timing (Issue #1) - **CRITICAL**  
⚠️ IPC agent spawning non-functional (Issue #4)  
⚠️ Comment clarity on request map cleanup (Issue #3)  
⚠️ Conversation ID normalization inconsistency (Issue #5)  

**Note on Conversation Restoration Logic:**
The three-condition restore logic is NOT a bug - it is essential and intentional. Codex MCP does not persist conversations, so history transcript injection is the ONLY way to restore context after restarts.  

### Recommended Fixes Priority

**Critical Priority:**
1. Fix conversation ID restoration timing (Issue #1)
   - Move restoration before `connected` event
   - Test with worker restart scenario
   - **This is the PRIMARY bug** causing conversation loss

**Medium Priority:**
2. Centralize conversation ID normalization (Issue #5)
   - Single normalization function
   - Call once on message arrival
   
3. Improve comment clarity (Issue #3)
   - Update confusing comments
   - Document conversation restoration flow

**Low Priority:**
4. Clean up IPC agent spawning code (Issue #4)
   - Remove non-functional endpoints
   - Document IPC server actual purpose

**DO NOT "FIX":**
- The three-condition needs_restore logic - This is intentional and necessary
- The history transcript injection - This is the ONLY way to restore Codex conversations

---

## Testing Recommendations

### Test Scenarios for Issue #1 (Conversation Restoration)

1. **Worker restart with active conversation:**
   - Start conversation with agent
   - Restart ASGI worker (simulate deployment)
   - Send follow-up message
   - **Expected:** Conversation continues with same conversationId
   - **Current bug:** New conversation started

2. **Multiple sessions on same shell:**
   - Open agent drawer in two browser tabs
   - Start conversation in tab 1
   - Refresh tab 2
   - Send message in tab 2
   - **Expected:** Tab 2 shows own conversation history
   - **Verify:** Conversation IDs don't mix

3. **Conversation restoration with history:**
   - Start conversation with multiple exchanges
   - Close agent drawer
   - Reopen agent drawer
   - **Expected:** Conversation ID restored, new messages routed correctly
   - **Verify:** No duplicate history injection

### Test Scenarios for Issue #2 (Restore Logic)

**Note:** These tests verify the restoration logic works as designed, NOT to simplify it.

1. **Shell change scenario:**
   - Start conversation
   - Force shell restart (kill process)
   - Send new message
   - **Expected:** History transcript injected, new conversation started with context
   - **Verify:** needs_restore triggered correctly, condition 1

2. **Missing conversation ID:**
   - Manually edit session file to remove conversationId
   - Load session
   - Send message
   - **Expected:** History transcript injected
   - **Verify:** needs_restore triggered, condition 2

3. **Worker restart with shell alive:**
   - Start conversation
   - Restart uvicorn worker (not shell)
   - Send message
   - **Expected:** History transcript injected (in-memory mapping lost)
   - **Verify:** needs_restore triggered, condition 3

4. **Normal continuation:**
   - Start conversation
   - Send follow-up without any interruption
   - **Expected:** needs_restore = False, conversationId used
   - **Verify:** No history injection, conversation continues normally

---

## Architecture Recommendations

### 1. Conversation State Management

**Current:** In-memory mapping + disk persistence + reconstruction logic

**Recommendation:** Add state synchronization layer:
```python
class ConversationStateManager:
    """Centralized conversation state with sync to disk."""
    
    def __init__(self):
        self._memory = {}  # In-memory cache
        self._disk = agent_session_store  # Disk persistence
    
    def get_conversation_id(self, session_id: str) -> Optional[str]:
        """Get conversation ID with automatic fallback to disk."""
        # Check memory first
        if session_id in self._memory:
            return self._memory[session_id]
        
        # Fallback to disk
        saved = self._disk.get_session(session_id)
        if saved and saved.get('conversationId'):
            conv_id = saved['conversationId']
            self._memory[session_id] = conv_id
            return conv_id
        
        return None
    
    def set_conversation_id(self, session_id: str, conversation_id: str):
        """Store conversation ID in memory and disk atomically."""
        self._memory[session_id] = conversation_id
        self._disk.update_session_metadata(session_id, conversationId=conversation_id)
```

### 2. Shell Lifecycle Events

**Current:** Manual check + restoration logic in WebSocket handler

**Recommendation:** Add shell lifecycle events:
```python
class ShellLifecycleObserver:
    """Observer pattern for shell lifecycle events."""
    
    def on_shell_spawned(self, shell_id: str, label: str):
        """Called when new shell spawned."""
        pass
    
    def on_shell_reused(self, shell_id: str, label: str):
        """Called when existing shell reused."""
        # Trigger conversation state restoration here
        pass
    
    def on_shell_terminated(self, shell_id: str):
        """Called when shell terminated."""
        # Clear conversation state mappings here
        pass
```

### 3. Request Correlation

**Current:** Manual mapping dict with manual cleanup

**Recommendation:** Use asyncio context variables:
```python
import contextvars

request_context = contextvars.ContextVar('request_context')

async def send_message(...):
    ctx = {'request_id': msg_id, 'session_id': chat_session_id}
    request_context.set(ctx)
    # ... send message ...

async def receive_response(...):
    ctx = request_context.get(None)
    if ctx:
        session_id = ctx['session_id']
        # ... route response ...
```

---

## Glossary

- **Framework Shell:** Background process managed by FrameworkShellManager (PTY-based)
- **App Worker:** Separate Python process running app backend (HTTP-based)
- **Agent:** LLM process (Codex MCP or Gemini ACP) running in framework shell
- **Session:** Persistent conversation container (saved to disk)
- **Conversation:** Active exchange with LLM (identified by conversationId)
- **Shell ID:** Unique identifier for framework shell (e.g., "fs_1234567890_abcd1234")
- **Session ID:** Unique identifier for agent session (e.g., "session-abc123")
- **Conversation ID:** Unique identifier for Codex conversation (e.g., "conv-xyz789")
- **Shared Shell:** Single agent process multiplexing multiple UI sessions
- **PTY:** Pseudo-terminal for bidirectional process communication
- **MCP:** Model Context Protocol (JSON-RPC 2.0 based, used by Codex)
- **ACP:** Agent Communication Protocol (JSON-RPC based, used by Gemini)

---

## Document Version

**Version:** 1.1  
**Last Updated:** 2025-11-08  
**Analysis Scope:** Entry point to agent interaction, Codex MCP focus  
**Lines Analyzed:** ~3,000 lines across 6 files  
**Issues Found:** 4 (1 critical, 3 medium)  
**Clarifications:** Conversation restoration logic is intentional, not a bug

