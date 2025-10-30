# Agent Drawer Implementation Documentation

**Last Updated:** 2025-10-30  
**Version:** Current State

---

## Overview

The Agent Drawer is a UI component in the Code CM6 app that provides a chat interface for interacting with AI coding agents (Codex and Gemini). It manages agent sessions, maintains conversation context, handles approvals, and persists state across page refreshes.

---

## Architecture

### Components

1. **Frontend**: `static/js/agent_drawer.js` - UI logic, session management, WebSocket handling
2. **Backend Bridge**: `agent_bridge.py` - Protocol translation between agents and app
3. **WebSocket Handler**: `agent_ws.py` - Real-time communication layer
4. **Routes**: `agent_routes.py` - REST API endpoints
5. **Framework Shells**: Core system for managing agent processes

### Agent Types Supported

- **Codex**: OpenAI's Codex CLI (`codex mcp-server`)
- **Gemini**: Google's Gemini CLI (`gemini --experimental-acp`)

---

## Data Flow

### 1. Session Creation

**Trigger**: User clicks "New Session" button

**Flow**:
```
User clicks button
  → createSession(agent) called
  → Debounce check (isCreatingSession flag)
  → Fetch project root from /api/app/file_editor_cm6/state
  → Create session object with:
      - id: generated UUID
      - agent: 'codex' or 'gemini'
      - messages: []
      - ws: null
      - stats: {status: 'Created', agent}
      - createdAt: timestamp
      - cwd: project root from state
      - conversationId: null (set later)
      - shell_id: null (set on connection)
  → Add to sessions{} object
  → Add to UI list
  → Switch to new session
  → Connect WebSocket
  → Save to disk
```

**Debouncing**:
- `isCreatingSession` flag prevents simultaneous creation
- Set to `true` at start, `false` in finally block
- Returns early if already creating

### 2. WebSocket Connection

**Trigger**: `connectSession(sessionId)` called

**Flow**:
```
connectSession called
  → Close existing WebSocket if open
  → Fetch project root from state if not stored
  → Build WebSocket URL:
      ws://localhost:8080/ws/app/file_editor_cm6/agent
        ?session=<sessionId>
        &agent=<codex|gemini>
        &cwd=<projectRoot>
        &file=<currentFile> (optional)
  → Create WebSocket
  → Set up event handlers (onopen, onmessage, onerror, onclose)
```

**Backend WebSocket Handler** (`agent_ws.py`):
```
WebSocket connection received
  → Parse query params: session_id, agent_type, cwd, file_path
  → Call bridge.get_or_create_agent(session_id, agent_type, cwd)
  → Returns: {id: shell_id, ...}
  → Send 'connected' event to frontend with shell_id
  → Start message loop:
      - Read from WebSocket (frontend messages)
      - Enrich context with cwd and file info
      - Write to agent PTY via bridge
      - Read from agent PTY
      - Normalize agent response
      - Send to WebSocket (frontend)
```

### 3. Agent Process Spawning

**Location**: `agent_bridge.py` → `spawn_agent()`

**Flow**:
```
spawn_agent called
  → Build command:
      - Codex: ['codex', 'mcp-server']
      - Gemini: ['gemini', '--experimental-acp']
  → Call manager.spawn_shell_pty(command, label, cwd)
      → Framework shell manager creates:
          - Shell ID: fs_<timestamp>_<uuid8>
          - Metadata: ~/.cache/te_framework/meta/<id>/meta.json
          - Logs: ~/.cache/te_framework/logs/<id>.stdout.log
          - Process: subprocess.Popen with PTY
  → Store session mapping: _sessions[session_id] = shell_id
  → Return shell metadata to WebSocket handler
```

**Get or Create Logic**:
```python
def get_or_create_agent(session_id, agent_type, cwd):
    shell_id = _sessions.get(session_id)
    if shell_id:
        shell = manager.describe(shell_id)
        if shell and shell.get('alive'):
            return shell  # Reuse existing
    return spawn_agent(agent_type, cwd, session_id)  # Spawn new
```

### 4. Message Sending

**Trigger**: User types message and clicks send

**Flow**:
```
User sends message
  → sendMessage(text) called
  → Create message object:
      {
        id: messageIdCounter++,
        action: 'chat',
        text: text,
        target: agent,
        session: sessionId,
        conversationId: session.conversationId
      }
  → Send via WebSocket
  → Add user bubble to transcript
```

**Backend Processing**:
```
WebSocket receives message
  → Parse JSON
  → Enrich context: {cwd: cwd} + file context
  → bridge.write_message(session_id, agent_type, message, context)
      → Get adapter for agent type
      → adapter.to_agent(message, context)
          → For Codex:
              - First message: tools/call with 'codex' tool
              - Subsequent: tools/call with 'codex-reply' tool
              - Include conversationId if available
              - Include cwd in arguments
  → Write JSON-RPC to agent PTY
```

### 5. Agent Response Handling

**Agent → Backend**:
```
Agent writes to stdout (PTY)
  → WebSocket loop reads line
  → Parse JSON-RPC
  → adapter.from_agent(mcp_msg)
      → Normalize to common format
      → Return event object
  → Send event to frontend via WebSocket
```

**Event Types**:

| Agent Event | Normalized Event | Frontend Action |
|------------|------------------|----------------|
| `session_configured` | `conversation_started` | Store conversationId |
| `task_started` | `system` | Append to terminal section |
| `agent_reasoning_delta` | `system` | Append to terminal section |
| `agent_reasoning_section_break` | `system` | Append newline |
| `agent_message_delta` | `token` | Append to assistant bubble |
| `agent_message` | (ignored) | None - use deltas |
| `exec_approval_request` | (ignored) | None - elicitation is real |
| `elicitation/create` | `elicitation` | Show approval UI |
| `task_complete` | `final` | Finish assistant message |
| `token_count` | (ignored) | None |

### 6. Approval Flow

**Trigger**: Agent needs permission to execute command

**Flow**:
```
Agent sends elicitation/create
  → Backend normalizes to 'elicitation' event:
      {
        event: 'elicitation',
        elicitation_id: <id>,
        message: "Allow Codex to run...",
        command: ['bash', '-lc', '...'],
        cwd: '/path/to/project',
        call_id: <call_id>
      }
  → Frontend receives via WebSocket
  → showApprovalRequest(msg) called
  → Creates approval bubble with:
      - Warning header
      - Reason text
      - Command display
      - CWD display
      - Approve/Deny buttons
```

**User Approves**:
```
User clicks Approve
  → sendApprovalResponse(elicitation_id, true, msg)
  → Build JSON-RPC response:
      {
        jsonrpc: '2.0',
        id: elicitation_id,
        result: {decision: 'approved'}
      }
  → POST to /api/app/file_editor_cm6/agent/send_raw
      {
        session_id: sessionId,
        message: JSON.stringify(response)
      }
  → Backend writes to agent PTY
  → Agent executes command
  → Sends results back
```

**User Denies**:
```
Same as approve but:
  result: {decision: 'denied'}
```

### 7. Session Persistence

**Save to Disk**:
```
saveSessionsToDisk() called (after any session change)
  → Build save object for each session:
      {
        id, agent, messages, createdAt,
        conversationId, cwd, shell_id
      }
  → POST to /api/app/file_editor_cm6/preferences/set
      {
        key: 'agent_sessions',
        value: JSON.stringify(sessions)
      }
  → Stored in: ~/.codex/app_prefs/code_cm6.json
```

**Load from Disk**:
```
loadSessions() called (on drawer first open)
  → GET /api/app/file_editor_cm6/preferences/get?key=agent_sessions
  → Parse JSON
  → For each saved session:
      - Create session object
      - Set ws: null
      - Set stats: {status: 'Restored', agent}
      - Add to sessions{}
      - Add to UI list (not stale)
  → Switch to first session
```

### 8. Session Switching

**Trigger**: User clicks session in list OR page loads restored sessions

**Flow**:
```
switchToSession(sessionId) called [ASYNC]
  → Update activeSessionId
  → Update UI active state
  → Render messages from session.messages[]
  → Update stats display
  → Check if shell is alive:
      IF session.shell_id exists:
        → GET /api/framework_shells/<shell_id>
        → IF shell.alive:
            → Reconnect WebSocket if needed
        → ELSE:
            → Mark session as stale
            → Add stale badge to UI
            → Notify user
      ELSE:
        → Reconnect WebSocket (will create new shell)
```

**Key Point**: This prevents spawning duplicate shells by checking if the existing shell is still alive before reconnecting.

### 9. Session Deletion

**Trigger**: User clicks X button on session

**Flow**:
```
User clicks X
  → deleteSession(sessionId) called
  → IF session.shell_id exists:
      → DELETE /api/framework_shells/<shell_id>?force=1
      → Framework shell manager:
          - Sends SIGTERM to process group
          - Waits for exit or escalates to SIGKILL
          - Removes metadata and logs
  → Close WebSocket
  → Remove from DOM
  → Delete from sessions{}
  → Save to disk
  → Switch to another session or show empty
```

### 10. Stale Session Cleanup

**Trigger**: User clicks refresh button

**Flow**:
```
refreshBtn clicked
  → cleanupStaleSessions() called
  → Find all .agent-session-list__item--stale
  → For each:
      - Delete from sessions{}
      - Remove from DOM
  → Save to disk
  → Show empty if no sessions left
```

---

## State Management

### Session Object Structure

```javascript
{
  id: 'session-<timestamp>-<random>',
  agent: 'codex' | 'gemini',
  messages: [
    {type: 'user', text: '...'},
    {type: 'token', text: '...', agent: 'codex'},
    {type: 'system', text: '...'},
    {type: 'approval', elicitation_id: 0, command: [...], ...},
    {type: 'diff', path: '...', patch: '...'},
    {type: 'final', output: {...}}
  ],
  ws: WebSocket | null,
  stats: {status: 'Created'|'Connected'|'Restored'|'Stale', agent: '...'},
  createdAt: 1698765432000,
  cwd: '/data/data/com.termux/files/home/te-git-diffs',
  conversationId: '019a3269-df7d-7142-bbd0-4d98607b603e',
  shell_id: 'fs_1761782378_5fcc4c0b'
}
```

### Global State

```javascript
let isOpen = false;                    // Drawer open/closed
let isFullscreen = false;              // Fullscreen mode
let ws = null;                         // (Unused - sessions have own ws)
let messageIdCounter = 0;              // Message ID generator
let currentAssistantBubble = null;     // Active message bubble
let currentPlanningSection = null;     // Active planning/system section
let sessions = {};                     // sessionId → session object
let activeSessionId = null;            // Currently active session
let isCreatingSession = false;         // Debounce flag
```

---

## Protocol Translation

### Codex Adapter

**to_agent()**: Converts normalized message to Codex MCP format

```javascript
// First message (no conversationId)
{
  jsonrpc: '2.0',
  id: <msg_id>,
  method: 'tools/call',
  params: {
    name: 'codex',
    arguments: {
      prompt: <text>,
      cwd: <project_root>,
      files: [{path: '...', content: '...'}]  // if file context
    }
  }
}

// Subsequent messages (with conversationId)
{
  jsonrpc: '2.0',
  id: <msg_id>,
  method: 'tools/call',
  params: {
    name: 'codex-reply',
    arguments: {
      conversationId: <id>,
      prompt: <text>
    }
  }
}
```

**from_agent()**: Converts Codex events to normalized format

```python
# Example: agent_message_delta → token
{
  'id': str(request_id),
  'event': 'token',
  'agent': 'codex',
  'text': msg_data.get('delta', '')
}

# Example: elicitation/create → elicitation
{
  'id': str(elicitation_id),
  'event': 'elicitation',
  'agent': 'codex',
  'elicitation_id': mcp_msg.get('id'),
  'message': params.get('message'),
  'command': params.get('codex_command'),
  'cwd': params.get('codex_cwd')
}
```

### Gemini Adapter

(Similar structure - uses ACP protocol instead of MCP)

---

## Message Display

### Rendering Logic

**renderMessages(messages)**: Replays entire conversation

```javascript
For each message in messages:
  CASE 'user':
    → Create user bubble
  CASE 'token':
    → Append to assistant bubble (create if needed)
  CASE 'system':
    → Create terminal-style section
  CASE 'approval':
    → Recreate approval UI (disabled if already answered)
  CASE 'diff':
    → Create diff display with apply button
```

### Live Streaming

**appendAssistantToken(text)**:
- Creates bubble if none exists
- Appends text to bubble.textContent
- Finishes planning section if active

**appendSystemToken(text)**:
- Creates planning section if none exists
- Appends to .agent-transcript__planning-text
- Terminal style: monospace, gray, gear icon

**showApprovalRequest(msg)**:
- Creates bubble with warning header
- Displays command, CWD, reason
- Adds approve/deny buttons
- Buttons disabled after click

### Styling

**User messages**: Green border, light background
**Assistant messages**: Blue border, pre-wrap text
**System messages**: Terminal style, monospace, gear icon
**Approval requests**: Orange border, warning badge
**Errors**: Red border

---

## API Endpoints Used

### Framework Shells (Core)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/framework_shells` | List all shells |
| POST | `/api/framework_shells` | Spawn new shell |
| GET | `/api/framework_shells/<id>` | Get shell details |
| DELETE | `/api/framework_shells/<id>?force=1` | Terminate and remove shell |

### App-Specific

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/app/file_editor_cm6/state` | Get project root and active file |
| GET | `/api/app/file_editor_cm6/preferences/get?key=agent_sessions` | Load sessions from disk |
| POST | `/api/app/file_editor_cm6/preferences/set` | Save sessions to disk |
| POST | `/api/app/file_editor_cm6/agent/send_raw` | Send raw JSON to agent PTY |

### WebSocket

| Endpoint | Purpose |
|----------|---------|
| `ws://host/ws/app/file_editor_cm6/agent?session=X&agent=Y&cwd=Z` | Real-time agent communication |

---

## Edge Cases & Gotchas

### 1. Duplicate Shell Creation

**Problem**: Clicking "New Session" multiple times rapidly created multiple shells.

**Solution**: `isCreatingSession` debounce flag prevents simultaneous creation.

### 2. Orphaned Shells on Page Refresh

**Problem**: Navigating away and back spawned new shells for restored sessions.

**Solution**: `switchToSession()` checks if shell is alive via framework API before reconnecting.

### 3. Approvals Going to Wrong Session

**Problem**: Multiple sessions could have approval responses go to wrong agent.

**Solution**: Each approval includes `elicitation_id` and is sent to specific session via `/agent/send_raw` with `session_id`.

### 4. Lost Conversation Context

**Problem**: Context lost on page refresh.

**Solution**: Store and restore `conversationId` from disk. Backend uses `codex-reply` tool with stored ID.

### 5. Wrong Working Directory

**Problem**: Agent using home directory instead of project root.

**Solution**: 
- Fetch project root from `/api/app/file_editor_cm6/state` (state.activeProject)
- Store in session.cwd
- Pass as query param to WebSocket
- Backend includes in context for all messages

### 6. Approval Format

**Problem**: Codex rejecting approvals with "unknown variant" error.

**Solution**: Must use `{decision: 'approved'}` not `{decision: 'allow'}`.

### 7. Shell Termination

**Problem**: Deleting session left orphaned processes.

**Solution**: Use framework shell API (`DELETE /api/framework_shells/<id>?force=1`) which sends SIGTERM to process group.

---

## Conversation Context Storage

### Codex Conversation Management

**First Message**:
- Uses `codex` tool
- Creates new conversation
- Codex returns `session_configured` event with `session_id`
- Frontend stores as `conversationId`

**Subsequent Messages**:
- Uses `codex-reply` tool
- Includes stored `conversationId`
- Codex maintains full context in `~/.codex/sessions/<date>/<uuid>.jsonl`

**Persistence**:
- `conversationId` saved to disk with session
- Loaded on page refresh
- Passed in every message to maintain context

---

## Current Known Issues

1. **None reported** - Implementation appears stable after fixes.

---

## Future Enhancements

Potential improvements (not implemented):

1. **Auto-save on interval** - Currently saves only on explicit changes
2. **Session export/import** - Save conversation history to file
3. **Multi-agent conversations** - Switch agents mid-conversation
4. **Diff application** - Actually apply code diffs from agent
5. **Session naming** - Let user rename sessions
6. **Session search** - Search through conversation history
7. **Streaming optimization** - Batch tokens to reduce DOM updates
8. **Approval presets** - "Always approve for this session" option
9. **Session templates** - Pre-configured agent settings
10. **Activity indicator** - Show when agent is thinking/working

---

## Files Modified/Created

### Created
- `agent_bridge.py` - Protocol translation layer
- `agent_ws.py` - WebSocket handler
- `agent_routes.py` - REST endpoints
- `static/js/agent_drawer.js` - Frontend logic

### Modified
- `template.html` - Added agent drawer HTML and CSS
- `main.py` - Registered agent blueprint

---

## Testing Checklist

- [ ] Create new Codex session
- [ ] Create new Gemini session
- [ ] Send message and receive response
- [ ] Approve command execution
- [ ] Deny command execution
- [ ] Delete session (verify shell terminates)
- [ ] Refresh page (verify sessions restore)
- [ ] Navigate away and back (verify no duplicate shells)
- [ ] Send multiple messages in same session (verify context maintained)
- [ ] Clean up stale sessions
- [ ] Switch between multiple sessions
- [ ] Check framework shells console (verify proper cleanup)

---

**End of Documentation**
