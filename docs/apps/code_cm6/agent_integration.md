# Agent Integration — Code CM6

**Last Updated:** October 29, 2025

---

## Overview

The Code CM6 editor integrates AI agent capabilities through a **protocol normalization layer** that supports both **Codex CLI (app-server mode)** and **Gemini CLI (ACP mode)**. The backend handles protocol translation, allowing the frontend to use a single unified API regardless of which agent is active.

### Key Features

- **Unified Frontend API** - Single WebSocket interface for all agents
- **Protocol Translation** - Automatic conversion between Codex and Gemini formats
- **Framework Shell Management** - Leverages existing process lifecycle infrastructure
- **Context Enrichment** - Automatically includes file content, git status, and project info
- **Line-Delimited JSON** - Follows agent CLI specifications exactly
- **Resource Monitoring** - CPU, memory, and uptime stats via framework shells

---

## Architecture

```
Browser (Code CM6)
    ↓ Normalized WebSocket messages
    ↓ {"id":"42","action":"chat","text":"...","target":"codex"}
    ↓
Agent WebSocket Handler (agent_ws.py)
    ↓ Context enrichment (file content, git status)
    ↓
Agent Bridge (agent_bridge.py)
    ↓ Protocol translation
    ├─→ CodexAdapter → {"id":"42","type":"send_user_turn","params":{...}}
    └─→ GeminiAdapter → {"jsonrpc":"2.0","id":42,"method":"act","params":{...}}
    ↓
Framework Shell Manager (PTY)
    ↓ STDIN/STDOUT (line-delimited JSON)
    ↓
Agent Process
    ├─→ codex app-server
    └─→ gemini --experimental-acp
```

---

## Backend Components

### 1. Agent Bridge (`agent_bridge.py`)

Core coordinator that manages agent lifecycle and protocol translation.

#### Classes

**`AgentBridge`**
- Main coordinator using framework shells
- Manages session → shell ID mapping
- Routes messages through protocol adapters
- Provides lifecycle operations (spawn, terminate, stats)

**`CodexAdapter`**
- Translates normalized ↔ Codex app-server format
- Handles `send_user_turn` requests
- Normalizes `token`, `diff`, `tool_call`, `final` events

**`GeminiAdapter`**
- Translates normalized ↔ Gemini ACP (JSON-RPC 2.0) format
- Handles `act` requests with session management
- Normalizes JSON-RPC notifications and responses

#### Key Methods

```python
# Spawn agent process via framework shell
spawn_agent(agent_type: str, cwd: str, session_id: str) -> dict

# Get existing or create new agent
get_or_create_agent(session_id: str, agent_type: str, cwd: str) -> dict

# Write normalized message with protocol translation
write_message(session_id: str, agent_type: str, message: dict, context: dict)

# Parse agent output and normalize to frontend format
parse_agent_output(agent_type: str, line: str) -> dict

# PTY queue management
subscribe_output(session_id: str) -> Queue
unsubscribe_output(session_id: str, queue: Queue)

# Lifecycle operations
terminate_agent(session_id: str)
get_agent_stats(session_id: str) -> dict
list_agents() -> List[dict]
```

#### Context Enrichment

The `enrich_context()` function automatically adds:
- **file_path** - Current file being edited
- **file_content** - Full file contents
- **language** - Detected from file extension
- **git_status** - File's git status (future enhancement)
- **cwd** - Project root directory

---

### 2. WebSocket Handler (`agent_ws.py`)

Bidirectional WebSocket endpoint for real-time agent communication.

#### Endpoint

**`WS /ws/agent`**

Query parameters:
- `session` - Session ID (optional, auto-generated)
- `agent` - Agent type: `codex` or `gemini` (default: `codex`)
- `cwd` - Working directory (optional)
- `file` - Current file path for context (optional)

#### Message Flow

**Inbound (Frontend → Agent):**

```json
{
  "id": "42",
  "action": "chat",
  "text": "Explain this function",
  "target": "codex",
  "file": "/path/to/file.py"
}
```

**Outbound (Agent → Frontend):**

```json
{"id": "42", "event": "token", "text": "partial response..."}
{"id": "42", "event": "diff", "path": "/file.py", "patch": "@@ ..."}
{"id": "42", "event": "final", "ok": true, "output": {...}}
```

#### Implementation Details

1. **Connection Setup**
   - Parse query params (session, agent, cwd, file)
   - Spawn or retrieve existing agent via framework shell
   - Subscribe to agent PTY output queue

2. **Bidirectional Relay**
   - **Agent → Frontend:** Background thread reads PTY output, buffers lines, parses JSON, normalizes, sends to WebSocket
   - **Frontend → Agent:** Main thread receives WebSocket messages, enriches context, translates protocol, writes to PTY

3. **Line Buffering**
   - Accumulates PTY chunks into complete lines
   - Parses each line as JSON
   - Normalizes via protocol adapter
   - Forwards to WebSocket

4. **Error Handling**
   - Invalid JSON from frontend → error event
   - Agent parsing failures → silently skip (log only)
   - Connection drops → clean up subscriptions (keep agent alive)

---

### 3. REST API (`agent_routes.py`)

HTTP endpoints for agent management.

#### Endpoints

**`POST /api/app/file_editor_cm6/agent/create`**

Create a new agent session.

Request:
```json
{
  "agent": "codex",
  "cwd": "/home/user/project",
  "session": "optional-session-id"
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "session_id": "abc123",
    "shell_id": "fs_...",
    "agent_type": "codex",
    "cwd": "/home/user/project",
    "alive": true
  }
}
```

**`GET /api/app/file_editor_cm6/agent/list`**

List all active agent sessions.

Response:
```json
{
  "ok": true,
  "data": [
    {
      "session_id": "abc123",
      "shell_id": "fs_...",
      "label": "agent-codex-abc123",
      "alive": true,
      "cwd": "/home/user/project",
      "uptime": 123.45
    }
  ]
}
```

**`GET /api/app/file_editor_cm6/agent/<session_id>`**

Get agent statistics.

Response:
```json
{
  "ok": true,
  "data": {
    "session_id": "abc123",
    "alive": true,
    "cpu_percent": 2.5,
    "rss_mb": 45.2,
    "uptime": 123.45,
    "pid": 12345
  }
}
```

**`DELETE /api/app/file_editor_cm6/agent/<session_id>`**

Terminate an agent session.

Response:
```json
{
  "ok": true,
  "data": {"session_id": "abc123"}
}
```

---

## Protocol Translation

### Normalized Frontend Format

**Request:**
```json
{
  "id": "42",
  "action": "chat",
  "text": "User message here",
  "target": "codex",
  "model": "gpt-5-codex",
  "effort": "medium",
  "session": "abc123",
  "file": "/path/to/file.py"
}
```

**Response Events:**
```json
{"id": "42", "event": "token", "text": "partial..."}
{"id": "42", "event": "planning", "summary": "Step 1..."}
{"id": "42", "event": "tool_call", "tool": "fs.read", "args": {...}}
{"id": "42", "event": "diff", "path": "/file.py", "patch": "@@..."}
{"id": "42", "event": "final", "ok": true, "output": {...}}
{"id": "42", "event": "error", "error": "message", "kind": "terminal"}
```

### Codex App-Server Translation

**Frontend → Codex:**

```json
// Frontend
{"id": "42", "action": "chat", "text": "Explain this"}

// Translated to Codex
{
  "id": "42",
  "type": "send_user_turn",
  "params": {
    "model": "gpt-5-codex",
    "effort": "medium",
    "summary": "Explain this",
    "items": [
      {"type": "context", "path": "/file.py", "content": "..."},
      {"type": "text", "text": "Explain this"}
    ],
    "cwd": "/project",
    "metadata": {"session": "abc123"}
  }
}
```

**Codex → Frontend:**

```json
// Codex
{"id": "42", "event": "token", "data": {"text": "partial"}}

// Normalized
{"id": "42", "event": "token", "text": "partial", "agent": "codex"}
```

### Gemini ACP Translation

**Frontend → Gemini:**

```json
// Frontend
{"id": "42", "action": "chat", "text": "Create a handler"}

// Translated to Gemini (JSON-RPC 2.0)
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "act",
  "params": {
    "session": "abc123",
    "input": {
      "type": "text",
      "text": "File: /file.py\nLanguage: python\n\nContent:\n```\n...\n```\n\nCreate a handler"
    },
    "mode": "code"
  }
}
```

**Gemini → Frontend:**

```json
// Gemini
{"jsonrpc": "2.0", "method": "token", "params": {"id": 42, "text": "partial"}}

// Normalized
{"id": "42", "event": "token", "text": "partial", "agent": "gemini"}
```

---

## Framework Shell Integration

Agent processes are managed via **framework shells** (same as terminal implementation):

1. **Spawn:** `spawn_shell_pty(command, label, cwd)` - Creates PTY-backed process
2. **Write:** `write_to_pty(shell_id, data)` - Writes line-delimited JSON to STDIN
3. **Read:** `subscribe_output(shell_id)` - Returns queue for STDOUT/STDERR
4. **Stats:** CPU, RSS, uptime via psutil integration
5. **Lifecycle:** Graceful termination, force kill, restart capabilities
6. **Cleanup:** Supervisor handles shutdown on framework exit

### Benefits

- ✅ Process group management (clean termination)
- ✅ Automatic log capture to disk
- ✅ Resource monitoring (CPU/memory/threads)
- ✅ Visible in Settings app framework shell list
- ✅ Respects `TE_FRAMEWORK_SHELL_MAX` limits
- ✅ Survives Flask reloads (process groups)

---

## Usage Examples

### Frontend WebSocket Connection

```javascript
const ws = new WebSocket(
  'ws://localhost:8080/ws/app/file_editor_cm6/agent?' +
  'session=my-session&agent=codex&cwd=/project&file=/project/main.py'
);

// Send message
ws.send(JSON.stringify({
  id: '1',
  action: 'chat',
  text: 'Explain this function',
  target: 'codex'
}));

// Receive events
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch (msg.event) {
    case 'token':
      appendToChat(msg.text);
      break;
    case 'diff':
      showDiffPreview(msg.path, msg.patch);
      break;
    case 'final':
      markComplete(msg.output);
      break;
    case 'error':
      showError(msg.error);
      break;
  }
};
```

### Create Agent via REST

```javascript
const response = await fetch('/api/app/file_editor_cm6/agent/create', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    agent: 'codex',
    cwd: '/home/user/project'
  })
});

const {data} = await response.json();
console.log('Agent spawned:', data.session_id);
```

### Switch Agents Mid-Session

```javascript
// Start with Codex
ws.send(JSON.stringify({
  id: '1',
  action: 'chat',
  text: 'Refactor this',
  target: 'codex'
}));

// Switch to Gemini for next message
ws.send(JSON.stringify({
  id: '2',
  action: 'chat',
  text: 'Now explain it',
  target: 'gemini'
}));
```

---

## Installation Requirements

### Codex CLI

```bash
# Install Codex CLI (exact installation varies by platform)
# Ensure 'codex' binary is on PATH
codex --version

# Test app-server mode
codex app-server
```

### Gemini CLI

```bash
# Install Gemini CLI
# Ensure 'gemini' binary is on PATH
gemini --version

# Test ACP mode
gemini --experimental-acp
```

### Framework Dependencies

Already included in Code CM6:
- ✅ Flask-Sock (WebSocket support)
- ✅ Framework Shell Manager
- ✅ PTY infrastructure
- ✅ psutil (resource monitoring)

---

## Testing Checklist

### Backend Tests

- [ ] Spawn Codex agent via REST API
- [ ] Spawn Gemini agent via REST API
- [ ] List active agents
- [ ] Get agent stats (CPU, memory, uptime)
- [ ] Terminate agent session
- [ ] WebSocket connection with Codex
- [ ] WebSocket connection with Gemini
- [ ] Send chat message to Codex
- [ ] Send chat message to Gemini
- [ ] Context enrichment (file content included)
- [ ] Protocol translation (Codex format)
- [ ] Protocol translation (Gemini format)
- [ ] Line buffering and JSON parsing
- [ ] Agent process survives WebSocket disconnect
- [ ] Multiple concurrent agents
- [ ] Framework shell limit enforcement

### Integration Tests

- [ ] Agent visible in Settings app
- [ ] Resource stats update in real-time
- [ ] Graceful shutdown via supervisor
- [ ] Logs captured to disk
- [ ] Process group termination (no orphans)

---

## Troubleshooting

### Agent Not Spawning

**Symptoms:** REST API returns error or WebSocket fails

**Checks:**
1. Verify `codex` or `gemini` binary is on PATH
2. Check framework shell limit (`TE_FRAMEWORK_SHELL_MAX`)
3. Review logs: `~/.cache/te_framework/logs/<shell_id>.stderr.log`
4. Ensure working directory exists and is readable

### Messages Not Reaching Agent

**Symptoms:** WebSocket sends but no response

**Checks:**
1. Verify agent process is alive (check Settings app)
2. Review PTY stdout logs
3. Check JSON formatting (must be single-line)
4. Verify protocol adapter is translating correctly
5. Enable debug logging in `agent_bridge.py`

### Invalid JSON Responses

**Symptoms:** Frontend receives unparseable messages

**Checks:**
1. Agent CLI version compatibility
2. Check for stderr mixed into stdout (PTY issue)
3. Verify line buffering is working (check for partial lines)
4. Review raw PTY output in logs

---

## Future Enhancements

- [ ] **Session persistence** - Save/restore agent conversations
- [ ] **Multi-file context** - Include related files automatically
- [ ] **Tool call execution** - Auto-approve safe operations
- [ ] **Diff preview UI** - Visual diff before applying
- [ ] **Rate limiting** - Prevent API quota exhaustion
- [ ] **Token usage tracking** - Monitor costs per session
- [ ] **Agent switching UI** - Dropdown to select active agent
- [ ] **Custom system prompts** - Per-project agent instructions
- [ ] **MCP tool integration** - Connect to Model Context Protocol servers

---

## File Reference

**Backend Files:**
- `app/apps/file_editor_cm6/agent_bridge.py` - Core bridge and protocol adapters
- `app/apps/file_editor_cm6/agent_ws.py` - WebSocket endpoint
- `app/apps/file_editor_cm6/agent_routes.py` - REST API endpoints
- `app/apps/file_editor_cm6/main.py` - Blueprint registration

**Dependencies:**
- `app/libs/framework_shells.py` - Process lifecycle management
- `app/apps/file_editor_cm6/terminal_backend.py` - Reference implementation

**Documentation:**
- `docs/apps/code_cm6/agent_integration.md` - This document
- `docs/core/framework_shells.md` - Framework shell architecture
- `codex_app_server_gemini_acp_integration_manual_ws_sse_rest.md` - Protocol specs
- `json_patterns_schemas_codex_app_server_and_gemini_acp.md` - Message schemas

---

**End of Documentation**
