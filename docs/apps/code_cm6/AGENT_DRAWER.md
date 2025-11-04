# Agent Drawer - Complete Technical Documentation

**Last Updated:** November 2, 2025  
**Version:** 2.0 (Backend-Driven Architecture)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [Storage Architecture](#storage-architecture)
4. [Backend Components](#backend-components)
5. [Frontend Components](#frontend-components)
6. [Message Flow](#message-flow)
7. [Session Management](#session-management)
8. [Conversation Restoration](#conversation-restoration)
9. [Active Session Persistence](#active-session-persistence)
10. [WebSocket Communication](#websocket-communication)
11. [REST API Reference](#rest-api-reference)
12. [UI Components](#ui-components)
13. [Implementation Details](#implementation-details)
14. [Best Practices](#best-practices)

---

## Overview

The Agent Drawer is a backend-driven AI assistant interface integrated into Code CM6. It provides persistent conversation management with Codex MCP server, enabling users to interact with AI agents while maintaining full conversation history across page reloads, server restarts, and browser sessions.

### Key Features

- **Backend-driven persistence** - 100% of session state stored on disk
- **Browser as display layer** - Frontend never mutates state, only renders
- **Conversation restoration** - Automatic recovery after MCP server restarts
- **Active session memory** - Auto-restore last session on page reload
- **Multi-session support** - Switch between multiple conversations seamlessly
- **Streaming responses** - Live token-by-token rendering
- **Framework shell integration** - Single shared MCP server for all sessions

### Design Philosophy

**Backend owns everything.** The browser is a thin display client that:
- Fetches snapshots from backend REST API
- Renders WebSocket streaming events
- Sends user input without local persistence
- Never modifies session data directly

This ensures:
- Browser can close mid-conversation without data loss
- Page refreshes don't lose state
- Multiple tabs can view the same conversation
- All state mutations happen in one place (backend)

---

## Architecture Principles

### 1. Backend Owns All State

**Every piece of agent data lives on the backend:**
- Session metadata (name, creation time, settings)
- Complete message history (user, assistant, system, errors)
- Conversation IDs (MCP server tracking)
- Framework shell IDs (process tracking)
- Active session preference

**Storage locations:**
```
~/.codex/agent_sessions/sessions.json  # All agent sessions
~/.codex/app_prefs/code_cm6.json       # App preferences (separate!)
```

### 2. Frontend is Display-Only

**The browser never:**
- Persists messages to disk
- Modifies session objects
- Tracks conversation state
- Manages conversation IDs

**The browser only:**
- Fetches sessions via REST API
- Renders messages from backend snapshots
- Displays streaming tokens (ephemeral)
- Sends user input via WebSocket

### 3. Single Source of Truth

**All mutations go through Python backend:**
```
User action → REST/WebSocket → Backend
  ↓
Backend mutates state
  ↓
Backend persists to disk
  ↓
Backend sends snapshot to frontend
  ↓
Frontend renders
```

### 4. Browser Can Close Mid-Conversation

**Critical guarantee:**
```
User sends message
  ↓
Agent starts responding
  ↓
User closes browser tab
  ↓
Backend continues processing
  ↓
Backend persists complete response
  ↓
User reopens tab
  ↓
Full conversation restored, including response
```

---

## Storage Architecture

### Agent Sessions File

**Location:** `~/.codex/agent_sessions/sessions.json`

**Purpose:** Stores ALL agent conversations (separate from app preferences)

**Thread Safety:** `threading.RLock()` for concurrent access

**Atomic Writes:** Write to `.tmp` file, then atomic replace

**Format:**
```json
{
  "session-<uuid>": {
    "id": "session-8a3c472b9869",
    "name": "My Conversation",
    "agent": "codex",
    "conversationId": "019a41c9-f224-7911-b2ec-010baba7bafd",
    "shell_id": "fs_1762043953_7cd3f985",
    "messages": [
      {
        "id": "msg-uuid-1",
        "type": "user",
        "text": "Hello, agent!",
        "timestamp": 1762044013.888
      },
      {
        "id": "msg-uuid-2",
        "type": "assistant",
        "text": "Hello! How can I help you today?",
        "timestamp": 1762044017.234
      },
      {
        "id": "msg-uuid-3",
        "type": "system",
        "text": "Planning step: Analyzing request...",
        "timestamp": 1762044016.100
      }
    ],
    "createdAt": 1762044013.749,
    "cwd": "/data/data/com.termux/files/home/project",
    "auto": false,
    "fullAccess": false,
    "version": 4
  }
}
```

**Message Types:**
- `user` - User input
- `assistant` - Agent's final response
- `system` - Planning/reasoning messages
- `error` - Error messages
- `tool_call` - Agent tool invocations
- `diff` - Code diffs

### App Preferences File

**Location:** `~/.codex/app_prefs/code_cm6.json`

**Purpose:** App-wide settings (NOT agent sessions - they're separate now!)

**Contains:**
```json
{
  "theme": "monokai",
  "showInlineDiffs": true,
  "lineWrapping": true,
  "last_active_session_id": "session-8a3c472b9869",
  "lastOpenedFile": "/path/to/file.py",
  ...
}
```

**Why Separate Files?**

Previously, agent sessions were stored inside preferences, causing conflicts:
- High-frequency session updates stomped on preference saves
- Page refresh could load stale preferences
- Race conditions between session/preference writes

**Solution:** Separate files, separate concerns:
- `sessions.json` - Updated on every message (high frequency)
- `code_cm6.json` - Updated on preference changes (low frequency)

---

## Backend Components

### `agent_session_store.py`

Thread-safe persistence layer for agent sessions.

**Key Functions:**

```python
def load_session_map() -> Dict[str, Any]:
    """Load all sessions from ~/.codex/agent_sessions/sessions.json"""
    # Returns: {"session-id": session_object, ...}

def save_session_map(data: Dict[str, Any]) -> None:
    """Atomically write all sessions to disk"""
    # Write to .tmp, then replace original

def create_session(session_id, name, agent, cwd, auto, fullAccess) -> Dict:
    """Create new session with metadata"""
    # Returns: full session object

def append_message(session_id, message) -> Dict:
    """Add message to session, increment version, persist"""
    # Returns: updated session object

def update_message(session_id, message_id, **updates) -> Dict:
    """Update specific message fields"""
    # Returns: updated session object

def get_session(session_id) -> Optional[Dict]:
    """Get full session with all messages"""
    # Returns: session object or None

def list_sessions() -> List[Dict]:
    """Get all sessions without full message history"""
    # Returns: [{"id", "name", "agent", "createdAt", "messageCount"}, ...]

def delete_session(session_id) -> bool:
    """Remove session from disk"""
    # Returns: True if deleted, False if not found

def update_session_metadata(session_id, **metadata) -> Dict:
    """Update session metadata (name, conversationId, shell_id, etc.)"""
    # Returns: updated session object
```

**Thread Safety:**
```python
_session_lock = threading.RLock()

def append_message(session_id, message):
    with _session_lock:
        sessions = load_session_map()
        sessions[session_id]['messages'].append(message)
        sessions[session_id]['version'] += 1
        save_session_map(sessions)
```

**Atomic Writes:**
```python
def save_session_map(data):
    _SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = _SESSIONS_FILE.with_suffix('.tmp')
    payload = json.dumps(data, indent=2)
    tmp_path.write_text(payload, encoding='utf-8')
    tmp_path.replace(_SESSIONS_FILE)  # Atomic on POSIX
```

### `agent_routes.py`

REST API for session management.

**Endpoints:**

```python
@bp.post('/agent/sessions')
def create_session():
    """
    Create new agent session.
    
    Body: {
        "name": "Session Name",
        "agent": "codex",
        "cwd": "/path/to/project",
        "auto": false,
        "fullAccess": false
    }
    
    Response: {
        "ok": true,
        "data": {
            "session": {
                "id": "session-...",
                "name": "Session Name",
                "agent": "codex",
                "messages": [],
                "createdAt": timestamp,
                ...
            }
        }
    }
    """

@bp.get('/agent/sessions')
def list_agent_sessions():
    """
    List all sessions (summary only, no messages).
    
    Response: {
        "ok": true,
        "data": [
            {
                "id": "session-...",
                "name": "Session Name",
                "agent": "codex",
                "createdAt": timestamp,
                "messageCount": 10
            },
            ...
        ]
    }
    """

@bp.get('/agent/session/<session_id>')
def get_session(session_id):
    """
    Get full session with all messages.
    
    Response: {
        "ok": true,
        "data": {
            "id": "session-...",
            "name": "Session Name",
            "agent": "codex",
            "conversationId": "...",
            "shell_id": "fs_...",
            "messages": [
                {"id": "...", "type": "user", "text": "...", "timestamp": ...},
                {"id": "...", "type": "assistant", "text": "...", "timestamp": ...},
                ...
            ],
            "createdAt": timestamp,
            "cwd": "/path",
            "auto": false,
            "fullAccess": false,
            "version": 4
        }
    }
    """

@bp.delete('/agent/session/<session_id>')
def delete_session(session_id):
    """
    Delete session permanently.
    
    Response: {
        "ok": true,
        "data": {
            "deleted": "session-..."
        }
    }
    """

@bp.patch('/agent/session/<session_id>')
def update_session_metadata(session_id):
    """
    Update session metadata.
    
    Body: {
        "name": "New Name",
        "conversationId": "...",
        "shell_id": "...",
        ...
    }
    
    Response: {
        "ok": true,
        "data": {
            "session": {...}
        }
    }
    """

@bp.get('/agent/shell/status')
def get_agent_shell_status():
    """
    Check for active Codex MCP server shell.
    
    Response: {
        "ok": true,
        "data": {
            "shell_id": "fs_...",
            "status": "running",
            "alive": true,
            "pid": 12345
        }
    }
    
    OR (if no shell running):
    
    Response: {
        "ok": true,
        "data": null
    }
    """
```

**Preferences Endpoints:**

```python
@bp.get('/preferences/get')
def preferences_get():
    """
    Get preference value by key.
    
    Query: ?key=last_active_session_id
    
    Response: {
        "ok": true,
        "data": "session-..."
    }
    """

@bp.post('/preferences/set')
def preferences_set():
    """
    Set preference value.
    
    Body: {
        "key": "last_active_session_id",
        "value": "session-..."
    }
    
    Response: {
        "ok": true,
        "data": {
            "key": "last_active_session_id"
        }
    }
    """
```

### `agent_ws.py`

WebSocket handler for agent communication.

**Route:** `/ws/app/file_editor_cm6/agent`

**Key Responsibilities:**
1. Framework shell lifecycle management
2. Message routing via request/session mapping
3. Protocol adaptation via `agent_bridge`
4. Incremental message persistence
5. Conversation ID tracking

**Flow:**

```python
@sock.route('/ws/agent')
def agent_websocket(ws):
    # 1. Receive message from client
    msg = ws.receive()
    # {"text": "Hello", "session": "session-...", "conversationId": "..."}
    
    # 2. Parse session ID
    session_id = msg.get('session')
    
    # 3. Generate request ID
    request_id = str(uuid.uuid4())
    
    # 4. Store request → session mapping
    request_session_map[request_id] = session_id
    
    # 5. Persist user message
    user_msg = {
        'id': f'msg-{uuid.uuid4()}',
        'type': 'user',
        'text': msg['text'],
        'timestamp': time.time()
    }
    append_message(session_id, user_msg)
    
    # 6. Convert to MCP tool call
    mcp_payload = agent_bridge.to_agent(msg, context={
        'session_id': session_id,
        'request_id': request_id
    })
    
    # 7. Send to framework shell PTY
    shell.write_line(json.dumps(mcp_payload))
    
    # 8. Read agent responses
    for line in shell.read_lines():
        # Parse JSON-RPC event
        event = json.loads(line)
        
        # Normalize via agent_bridge
        normalized = agent_bridge.from_agent(line, request_id)
        
        if normalized['event'] == 'token':
            # Stream token to frontend (don't persist yet)
            ws.send(json.dumps({
                'event': 'token',
                'session': session_id,
                'text': normalized['text']
            }))
        
        elif normalized['event'] == 'system':
            # Persist system message
            sys_msg = {
                'id': f'msg-{uuid.uuid4()}',
                'type': 'system',
                'text': normalized['text'],
                'timestamp': time.time()
            }
            append_message(session_id, sys_msg)
            ws.send(json.dumps({
                'event': 'system',
                'session': session_id,
                'text': normalized['text']
            }))
        
        elif normalized['event'] == 'final':
            # Persist complete assistant message
            complete_text = agent_bridge.get_complete_message(request_id)
            assistant_msg = {
                'id': f'msg-{uuid.uuid4()}',
                'type': 'assistant',
                'text': complete_text,
                'timestamp': time.time()
            }
            append_message(session_id, assistant_msg)
            
            # Update conversation ID
            if 'conversationId' in normalized:
                update_session_metadata(
                    session_id,
                    conversationId=normalized['conversationId'],
                    shell_id=shell.id
                )
            
            ws.send(json.dumps({
                'event': 'final',
                'session': session_id,
                'text': complete_text
            }))
            
            # Clean up mapping
            del request_session_map[request_id]
            break
```

**Request/Session Mapping:**

```python
request_session_map = {}  # request_id → session_id

# When user sends message:
request_id = str(uuid.uuid4())
request_session_map[request_id] = session_id

# When agent responds:
session_id = request_session_map[request_id]

# After 'final' event:
del request_session_map[request_id]
```

### `agent_bridge.py`

Protocol adapter for Codex MCP server.

**Purpose:** Convert between normalized messages and MCP JSON-RPC format.

**Key Classes:**

```python
class CodexAdapter:
    _conversations = {}  # session_id → conversationId
    _last_messages = {}  # request_id → complete message text
    
    def to_agent(self, normalized, context):
        """
        Convert normalized message to MCP tool call.
        
        Input: {
            "text": "Hello",
            "session": "session-...",
            "conversationId": "..." (optional)
        }
        
        Output (codex tool - new conversation): {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "id": "request-id",
            "params": {
                "name": "codex",
                "arguments": {
                    "prompt": "Hello",
                    "cwd": "/path/to/project",
                    ...
                }
            }
        }
        
        OR (codex-reply - continue conversation): {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "id": "request-id",
            "params": {
                "name": "codex-reply",
                "arguments": {
                    "conversationId": "...",
                    "prompt": "Hello"
                }
            }
        }
        """
    
    def from_agent(self, line, request_id):
        """
        Parse MCP JSON-RPC event, normalize to unified format.
        
        Input (token event): {
            "jsonrpc": "2.0",
            "method": "codex/event",
            "params": {
                "_meta": {"requestId": "request-id"},
                "id": "event-id",
                "msg": {
                    "type": "agent_message_delta",
                    "delta": "Hello"
                }
            }
        }
        
        Output: {
            "id": "request-id",
            "event": "token",
            "agent": "codex",
            "text": "Hello"
        }
        
        Input (task complete): {
            "jsonrpc": "2.0",
            "method": "codex/event",
            "params": {
                "_meta": {"requestId": "request-id"},
                "id": "event-id",
                "msg": {
                    "type": "task_complete",
                    "conversationId": "..."
                }
            }
        }
        
        Output: {
            "id": "request-id",
            "event": "final",
            "agent": "codex",
            "conversationId": "..."
        }
        """
    
    def store_conversation_id(self, session_id, conversation_id):
        """Track conversation ID for session"""
        self._conversations[session_id] = conversation_id
    
    def get_conversation_id(self, session_id):
        """Get conversation ID for session"""
        return self._conversations.get(session_id)
    
    def store_message_chunk(self, request_id, text):
        """Accumulate message text during streaming"""
        if request_id not in self._last_messages:
            self._last_messages[request_id] = ""
        self._last_messages[request_id] += text
    
    def get_complete_message(self, request_id):
        """Get complete message text after streaming"""
        return self._last_messages.pop(request_id, "")
```

**Event Type Mapping:**

| MCP Event Type | Normalized Event | Action |
|----------------|------------------|--------|
| `agent_message_delta` | `token` | Stream to frontend, accumulate |
| `agent_reasoning_delta` | `system` | Persist + stream |
| `task_complete` | `final` | Persist complete message |
| `error` | `error` | Persist + stream |
| `tool_call` | `tool_call` | Persist + stream |

---

## Frontend Components

### `agent_drawer.js`

Agent UI controller (display-only, no mutations).

**Key State:**

```javascript
let activeSessionId = null;
let activeSessionName = 'No Session';
let streamingMessage = null;  // Temporary cache for live tokens

let sharedShell = {
  shell_id: null,
  session_id: null,
  agent: 'codex',
  status: 'Disconnected',
  ws: null,
  connectPromise: null
};
```

**Key Functions:**

```javascript
function initAgentDrawer() {
  // Initialize drawer UI
  // Bind event listeners
  // Set up WebSocket reconnection
}

async function openDrawer() {
  // Open drawer
  // Check for existing MCP shell
  // Restore last active session
  
  drawer.classList.add('open');
  await checkExistingShell();
}

async function checkExistingShell() {
  // GET /agent/shell/status
  const resp = await fetch('/api/app/file_editor_cm6/agent/shell/status');
  const result = await resp.json();
  
  if (result.ok && result.data) {
    // Shell exists
    sharedShell.shell_id = result.data.shell_id;
    sharedShell.status = 'Available';
    
    updateStats({
      status: 'Available',
      agent: 'codex'
    });
  } else {
    // No shell
    sharedShell.status = 'Disconnected';
    updateStats({
      status: 'Disconnected',
      agent: '—'
    });
  }
  
  // Try to restore last active session
  const prefResp = await fetch('/api/app/file_editor_cm6/preferences/get?key=last_active_session_id');
  const prefResult = await prefResp.json();
  
  if (prefResult.ok && prefResult.data) {
    try {
      await switchToSession(prefResult.data);
    } catch (e) {
      // Session no longer exists - clear preference
      await fetch('/api/app/file_editor_cm6/preferences/set', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          key: 'last_active_session_id',
          value: null
        })
      });
    }
  }
}

async function createSessionFromModal() {
  // Get inputs from modal
  const name = sessionNameInput.value || 'Unnamed Session';
  const cwd = cwdInput.value || '/data/data/com.termux/files/home';
  
  // POST /agent/sessions
  const resp = await fetch('/api/app/file_editor_cm6/agent/sessions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      name,
      agent: 'codex',
      cwd,
      auto: false,
      fullAccess: false
    })
  });
  
  const result = await resp.json();
  if (!result.ok) {
    notify('Failed to create session');
    return;
  }
  
  // Switch to new session
  await switchToSession(result.data.session.id);
  
  // Close modal
  sessionsModal.style.display = 'none';
}

async function switchToSession(sessionId) {
  // GET /agent/session/<id>
  const resp = await fetch(`/api/app/file_editor_cm6/agent/session/${sessionId}`);
  const result = await resp.json();
  
  if (!result.ok) {
    notify('Failed to load session');
    return;
  }
  
  const session = result.data;
  
  // Update active session
  activeSessionId = session.id;
  activeSessionName = session.name || 'Unnamed Session';
  
  // Save as last active session
  await fetch('/api/app/file_editor_cm6/preferences/set', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      key: 'last_active_session_id',
      value: session.id
    })
  });
  
  // Update UI
  updateCurrentSessionCard();
  
  // Render messages from backend
  renderMessages(session.messages || []);
  
  // Update stats
  updateStats({
    status: sharedShell.status,
    agent: session.agent || 'codex',
    conversationId: session.conversationId
  });
}

async function deleteSession(sessionId) {
  // DELETE /agent/session/<id>
  const resp = await fetch(`/api/app/file_editor_cm6/agent/session/${sessionId}`, {
    method: 'DELETE'
  });
  
  const result = await resp.json();
  if (!result.ok) {
    notify('Failed to delete session');
    return;
  }
  
  // If this was the active session, clear UI
  if (sessionId === activeSessionId) {
    activeSessionId = null;
    activeSessionName = 'No Session';
    clearTranscript();
    updateCurrentSessionCard();
    
    // Clear saved preference
    await fetch('/api/app/file_editor_cm6/preferences/set', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        key: 'last_active_session_id',
        value: null
      })
    });
  }
  
  notify('Session deleted');
}

function sendMessage(text) {
  if (!activeSessionId) {
    notify('No active session');
    return;
  }
  
  // Send via WebSocket
  if (!sharedShell.ws || sharedShell.ws.readyState !== WebSocket.OPEN) {
    notify('Not connected');
    return;
  }
  
  sharedShell.ws.send(JSON.stringify({
    text,
    session: activeSessionId,
    conversationId: currentConversationId  // If continuing conversation
  }));
}

function handleAgentMessage(sessionId, msg) {
  // Only process messages for active session
  if (sessionId !== activeSessionId) return;
  
  if (msg.event === 'token') {
    // Append token to streaming bubble
    if (!streamingMessage) {
      streamingMessage = createStreamingBubble();
      transcript.appendChild(streamingMessage);
    }
    streamingMessage.textContent += msg.text;
    
  } else if (msg.event === 'system') {
    // Show system message
    const bubble = createBubble('system', msg.text);
    transcript.appendChild(bubble);
    
  } else if (msg.event === 'final') {
    // Replace streaming bubble with final message
    if (streamingMessage) {
      streamingMessage.remove();
      streamingMessage = null;
    }
    const bubble = createBubble('assistant', msg.text);
    transcript.appendChild(bubble);
    
  } else if (msg.event === 'error') {
    // Show error
    const bubble = createBubble('error', msg.text);
    transcript.appendChild(bubble);
  }
  
  // Auto-scroll
  transcript.scrollTop = transcript.scrollHeight;
}

function renderMessages(messages) {
  // Clear transcript
  clearTranscript();
  
  // Render each message
  for (const msg of messages) {
    const bubble = createBubble(msg.type, msg.text);
    transcript.appendChild(bubble);
  }
  
  // Auto-scroll
  transcript.scrollTop = transcript.scrollHeight;
}

function createBubble(type, text) {
  const bubble = document.createElement('div');
  bubble.className = `agent-transcript__bubble agent-transcript__bubble--${type}`;
  bubble.textContent = text;
  return bubble;
}
```

---

## Message Flow

### Complete Flow Diagram

```
1. User Types Message
   ↓
2. Frontend: sendMessage(text)
   ↓
3. WebSocket: {"text": "...", "session": "session-id"}
   ↓
4. Backend agent_ws.py receives message
   ↓
5. Backend: append_message(session_id, {type: 'user', ...})
   ↓
6. Backend: Persist to ~/.codex/agent_sessions/sessions.json
   ↓
7. Backend: Convert to MCP tool call via agent_bridge
   ↓
8. Backend: Send to framework shell PTY
   ↓
9. Codex MCP Server processes request
   ↓
10. MCP Server streams JSON-RPC events
    ↓
11. Backend reads PTY line-by-line
    ↓
12. Backend parses each event:
    
    If 'agent_message_delta':
      - Normalize to 'token' event
      - Accumulate text in _last_messages
      - Forward to WebSocket → Frontend
      - Frontend appends to streaming bubble
    
    If 'agent_reasoning_delta':
      - Normalize to 'system' event
      - append_message(session_id, {type: 'system', ...})
      - Forward to WebSocket → Frontend
      - Frontend shows system message
    
    If 'task_complete':
      - Get complete message from _last_messages
      - append_message(session_id, {type: 'assistant', text: complete})
      - Update session conversationId and shell_id
      - Normalize to 'final' event
      - Forward to WebSocket → Frontend
      - Frontend replaces streaming bubble with final message
      - Clean up request_session_map
    ↓
13. Frontend displays final transcript
    ↓
14. User refreshes page
    ↓
15. Frontend: openDrawer() → checkExistingShell()
    ↓
16. Frontend: GET /preferences/get?key=last_active_session_id
    ↓
17. Backend returns: "session-id"
    ↓
18. Frontend: switchToSession("session-id")
    ↓
19. Frontend: GET /agent/session/session-id
    ↓
20. Backend returns: full session with all messages
    ↓
21. Frontend: renderMessages(session.messages)
    ↓
22. Full conversation restored!
```

---

## Session Management

### Creating a Session

```javascript
// Frontend
const resp = await fetch('/api/app/file_editor_cm6/agent/sessions', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    name: 'My Conversation',
    agent: 'codex',
    cwd: '/path/to/project',
    auto: false,
    fullAccess: false
  })
});

const result = await resp.json();
// result.data.session = {
//   id: "session-...",
//   name: "My Conversation",
//   agent: "codex",
//   messages: [],
//   createdAt: timestamp,
//   ...
// }
```

```python
# Backend
@bp.post('/agent/sessions')
def create_session():
    data = request.get_json()
    session_id = f"session-{uuid.uuid4().hex[:16]}"
    
    session = agent_session_store.create_session(
        session_id=session_id,
        name=data.get('name'),
        agent=data.get('agent', 'codex'),
        cwd=data.get('cwd'),
        auto=data.get('auto', False),
        fullAccess=data.get('fullAccess', False)
    )
    
    return jsonify({"ok": True, "data": {"session": session}})
```

### Listing Sessions

```javascript
// Frontend
const resp = await fetch('/api/app/file_editor_cm6/agent/sessions');
const result = await resp.json();
// result.data = [
//   {id: "...", name: "...", agent: "...", createdAt: ..., messageCount: 10},
//   {id: "...", name: "...", agent: "...", createdAt: ..., messageCount: 5},
//   ...
// ]
```

```python
# Backend
@bp.get('/agent/sessions')
def list_agent_sessions():
    sessions = agent_session_store.list_sessions()
    # Returns summary without full message history
    return jsonify({"ok": True, "data": sessions})
```

### Switching Sessions

```javascript
// Frontend
async function switchToSession(sessionId) {
  const resp = await fetch(`/api/app/file_editor_cm6/agent/session/${sessionId}`);
  const result = await resp.json();
  
  activeSessionId = result.data.id;
  activeSessionName = result.data.name;
  
  renderMessages(result.data.messages);
  
  // Save as last active
  await fetch('/api/app/file_editor_cm6/preferences/set', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      key: 'last_active_session_id',
      value: sessionId
    })
  });
}
```

### Deleting Sessions

```javascript
// Frontend
async function deleteSession(sessionId) {
  const resp = await fetch(`/api/app/file_editor_cm6/agent/session/${sessionId}`, {
    method: 'DELETE'
  });
  
  if (sessionId === activeSessionId) {
    activeSessionId = null;
    clearTranscript();
    
    // Clear preference
    await fetch('/api/app/file_editor_cm6/preferences/set', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        key: 'last_active_session_id',
        value: null
      })
    });
  }
}
```

---

## Conversation Restoration

When the Codex MCP server restarts, all conversation IDs become invalid. The system handles this automatically.

### The Problem

```
User has active conversation
  ↓
conversationId: "019a41c9-f224-7911-b2ec-010baba7bafd"
shell_id: "fs_1762043953_7cd3f985"
  ↓
Codex MCP server crashes/restarts
  ↓
New shell: "fs_1762055123_9abc1234"
  ↓
Old conversationId no longer valid!
  ↓
If we call codex-reply with old ID → ERROR
```

### The Solution

**Backend detects the mismatch and restores automatically:**

```python
# In agent_ws.py

def handle_user_message(msg):
    session_id = msg['session']
    session = get_session(session_id)
    
    # Check if we need to restore
    current_shell_id = get_current_shell_id()
    stored_shell_id = session.get('shell_id')
    
    if stored_shell_id and stored_shell_id != current_shell_id:
        # MISMATCH! Need to restore conversation
        
        # 1. Extract full conversation history
        history = build_conversation_history(session['messages'])
        
        # 2. Prepend history to new message
        restored_prompt = f"""
[Previous Conversation History]
{history}

[New Message]
{msg['text']}
"""
        
        # 3. Call 'codex' tool (new conversation) with history
        mcp_payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "id": request_id,
            "params": {
                "name": "codex",  # NOT codex-reply!
                "arguments": {
                    "prompt": restored_prompt,
                    "cwd": session['cwd'],
                    ...
                }
            }
        }
        
        # 4. Send to MCP server
        shell.write_line(json.dumps(mcp_payload))
        
        # 5. When response comes back with new conversationId:
        new_conversation_id = response['conversationId']
        
        # 6. Update session
        update_session_metadata(
            session_id,
            conversationId=new_conversation_id,
            shell_id=current_shell_id
        )
        
        # Conversation restored! Future messages will use codex-reply
    else:
        # Normal flow - use codex-reply
        mcp_payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "id": request_id,
            "params": {
                "name": "codex-reply",
                "arguments": {
                    "conversationId": session['conversationId'],
                    "prompt": msg['text']
                }
            }
        }
```

### Three ID Numbers Explained

**1. Internal Session ID (Permanent)**
- Format: `session-8a3c472b9869`
- Stored in: `sessions.json` (key)
- Lifetime: Forever (until user deletes)
- Purpose: User-facing session identifier

**2. Framework Shell ID (Transient)**
- Format: `fs_1762043953_7cd3f985`
- Stored in: session object (`shell_id` field)
- Lifetime: Until shell stops or server restarts
- Purpose: Track which MCP server instance

**3. MCP Conversation ID (Transient)**
- Format: `019a41c9-f224-7911-b2ec-010baba7bafd`
- Stored in: session object (`conversationId` field)
- Lifetime: Until MCP server restarts
- Purpose: Codex's internal conversation tracking

**Restoration Logic:**
```
if session.shell_id != current_shell_id:
  # Shell has changed → conversation ID is invalid
  # Call 'codex' with history to create new conversation
  # Save new conversation ID + shell ID
else:
  # Shell hasn't changed → conversation ID still valid
  # Call 'codex-reply' to continue conversation
```

---

## Active Session Persistence

When you switch to a session, it's saved as `last_active_session_id` in preferences. On page reload, that session is automatically restored.

### Flow

```
1. User switches to session
   ↓
2. switchToSession(sessionId) called
   ↓
3. GET /agent/session/<id> to load messages
   ↓
4. Render messages
   ↓
5. POST /preferences/set
   Body: {
     key: "last_active_session_id",
     value: "session-id"
   }
   ↓
6. Backend saves to ~/.codex/app_prefs/code_cm6.json
   ↓
[User refreshes page]
   ↓
7. openDrawer() called
   ↓
8. checkExistingShell() called
   ↓
9. GET /preferences/get?key=last_active_session_id
   ↓
10. Backend returns: "session-id"
    ↓
11. switchToSession("session-id") automatically
    ↓
12. Session restored!
```

### Edge Cases

**Session was deleted:**
```javascript
try {
  await switchToSession(lastActiveSessionId);
} catch (e) {
  // Session no longer exists (404)
  // Clear the preference
  await fetch('/api/app/file_editor_cm6/preferences/set', {
    method: 'POST',
    body: JSON.stringify({
      key: 'last_active_session_id',
      value: null
    })
  });
}
```

**No last active session:**
```javascript
const prefResult = await fetch('/preferences/get?key=last_active_session_id');
if (!prefResult.ok || !prefResult.data) {
  // No preference set - show "No active session"
  activeSessionId = null;
  activeSessionName = 'No Session';
}
```

---

## WebSocket Communication

### Connection Setup

```javascript
function connectSharedShell() {
  if (sharedShell.ws && sharedShell.ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  
  if (sharedShell.connectPromise) {
    return sharedShell.connectPromise;
  }
  
  sharedShell.connectPromise = new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:8080/ws/app/file_editor_cm6/agent');
    
    ws.onopen = () => {
      sharedShell.ws = ws;
      sharedShell.status = 'Connected';
      updateStats({status: 'Connected', agent: 'codex'});
      resolve();
    };
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const sessionId = msg.session;
      handleAgentMessage(sessionId, msg);
    };
    
    ws.onerror = (error) => {
      sharedShell.status = 'Error';
      reject(error);
    };
    
    ws.onclose = () => {
      sharedShell.ws = null;
      sharedShell.status = 'Disconnected';
      sharedShell.connectPromise = null;
      updateStats({status: 'Disconnected', agent: '—'});
    };
  });
  
  return sharedShell.connectPromise;
}
```

### Sending Messages

```javascript
async function sendMessage(text) {
  if (!activeSessionId) {
    notify('No active session');
    return;
  }
  
  // Ensure connected
  await connectSharedShell();
  
  // Send message
  sharedShell.ws.send(JSON.stringify({
    text,
    session: activeSessionId,
    conversationId: currentConversationId  // Optional
  }));
}
```

### Receiving Events

```javascript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // msg = {
  //   event: 'token' | 'system' | 'final' | 'error',
  //   session: 'session-id',
  //   text: '...',
  //   ...
  // }
  
  handleAgentMessage(msg.session, msg);
};
```

---

## REST API Reference

### Session Endpoints

```
POST   /api/app/file_editor_cm6/agent/sessions
GET    /api/app/file_editor_cm6/agent/sessions
GET    /api/app/file_editor_cm6/agent/session/<id>
DELETE /api/app/file_editor_cm6/agent/session/<id>
PATCH  /api/app/file_editor_cm6/agent/session/<id>
```

### Shell Status

```
GET /api/app/file_editor_cm6/agent/shell/status
```

### Preferences

```
GET  /api/app/file_editor_cm6/preferences/get?key=<key>
POST /api/app/file_editor_cm6/preferences/set
```

### WebSocket

```
WS /ws/app/file_editor_cm6/agent
```

---

## UI Components

### Drawer Layout

```html
<div class="agent-drawer">
  <div class="agent-drawer__header">
    <button id="agent-create-session">New Session</button>
    <button id="agent-list-sessions">Sessions</button>
    <button id="agent-drawer-close">✕</button>
  </div>
  
  <div class="agent-current-session-card">
    <div class="agent-current-session-card__name">
      <span id="agent-session-name">No Session</span>
    </div>
  </div>
  
  <div class="agent-transcript" id="agent-transcript">
    <!-- Messages rendered here -->
  </div>
  
  <div class="agent-input-area">
    <textarea id="agent-input"></textarea>
    <button id="agent-send">Send</button>
  </div>
  
  <footer class="agent-stats">
    <div class="agent-stats__status-dot" id="agent-status-dot"></div>
    <span>Session: <span id="agent-status-text">Disconnected</span></span>
  </footer>
</div>
```

### Message Bubbles

```css
.agent-transcript__bubble {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
  font-size: 0.85rem;
  line-height: 1.5;
}

.agent-transcript__bubble--user {
  background: rgba(37, 214, 158, 0.2);
  border-left: 3px solid rgba(16, 185, 129, 0.8);
}

.agent-transcript__bubble--assistant {
  background: rgba(59, 130, 246, 0.1);
  border-left: 3px solid #3b82f6;
  white-space: pre-wrap;
}

.agent-transcript__bubble--system {
  background: rgba(156, 163, 175, 0.1);
  border-left: 3px solid #9ca3af;
  font-size: 0.85em;
  opacity: 0.8;
}

.agent-transcript__bubble--error {
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid #ef4444;
  color: #fca5a5;
}
```

---

## Implementation Details

### Why Separate Session and Preference Files?

**Problem:**
```
Agent drawer saves messages frequently (on every token)
  ↓
Preferences updated occasionally (theme change, etc.)
  ↓
Both writing to same file: ~/.codex/app_prefs/code_cm6.json
  ↓
Race condition: Session save overwrites preference save
  ↓
User loses theme setting after agent conversation
```

**Solution:**
```
~/.codex/agent_sessions/sessions.json  # High-frequency updates
~/.codex/app_prefs/code_cm6.json       # Low-frequency updates
```

### Why Backend Persistence Instead of Frontend?

**Frontend persistence problems:**
- Browser storage limits (~10MB)
- Lost on cache clear
- No persistence if tab closes mid-conversation
- Race conditions between tabs
- Complex synchronization logic

**Backend persistence benefits:**
- Unlimited disk space
- Survives browser cache clear
- Captures agent responses even if browser closed
- Single source of truth
- Simple frontend (just render what backend says)

### Why Thread Safety Matters

**Scenario:**
```
User 1: Sends message to session A
  ↓ (writes to sessions.json)
User 2: Deletes session B
  ↓ (writes to sessions.json)
Agent: Finishes response for session A
  ↓ (writes to sessions.json)
```

Without `RLock()`:
- Writes could interleave
- File could become corrupted
- Sessions could be lost

With `RLock()`:
```python
with _session_lock:
    sessions = load_session_map()
    sessions[session_id]['messages'].append(message)
    save_session_map(sessions)
```
- Each operation is atomic
- No corruption
- Safe concurrent access

---

## Best Practices

### For Agents Working on This Code

1. **Never add frontend persistence** - Backend owns all state
2. **Never modify session objects in JS** - Frontend is read-only
3. **Always use REST API for mutations** - Create/update/delete via backend
4. **Trust the backend** - Don't validate or cache session data in JS
5. **Keep WebSocket simple** - Just forward events, don't interpret
6. **Separate concerns** - Sessions ≠ Preferences (different files!)
7. **Use atomic writes** - Always write to `.tmp` then replace
8. **Lock mutations** - Use `RLock()` for concurrent access
9. **Normalize events** - Convert MCP format to unified format early
10. **Handle restoration** - Always check shell_id before using conversationId

### For Users

1. **Browser can close anytime** - Agent keeps working, response saved
2. **Refresh works** - Last active session auto-restores
3. **Server restart works** - Conversations automatically restored
4. **Multiple tabs work** - All show same data (backend is truth)
5. **No data loss** - Everything persisted to disk immediately

---

**Last Updated:** November 2, 2025  
**Document Version:** 2.0 (Backend-Driven Architecture)
