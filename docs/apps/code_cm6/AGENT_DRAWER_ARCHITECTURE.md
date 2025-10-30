# Agent Drawer Architecture

**Last Updated:** 2025-10-30

This document describes the architecture of the agent drawer in the Code CM6 app, including the shared shell pattern, session management, and approval settings.

---

## Overview

The agent drawer provides an interface for interacting with AI coding agents (Codex, Gemini) through a chat-like interface. It implements a **shared shell architecture** where multiple UI sessions multiplex through a single framework shell process.

---

## Architecture Principles

### 1. Shared Shell Pattern

**ONE framework shell per agent type** - Multiple UI sessions share a single `codex mcp-server` process.

```
┌─────────────────────────────────────────┐
│ Frontend: Multiple UI Sessions                 │
│  - Session 1: "Bug fix"                        │
│  - Session 2: "Add feature"                    │
│  - Session 3: "Refactor code"                  │
└─────────────────────────────────────────┘
                 ↓ (multiplexed)
┌─────────────────────────────────────────┐
│ Backend: ONE Framework Shell                   │
│  Shell: codex mcp-server                       │
│  Session ID: shared-codex-abc123               │
└─────────────────────────────────────────┘
                 ↓ (conversationId routing)
┌─────────────────────────────────────────┐
│ Codex CLI: Multiple Conversations              │
│  - conversationId: uuid-1                      │
│  - conversationId: uuid-2                      │
│  - conversationId: uuid-3                      │
│  Storage: ~/.codex/sessions/                   │
└─────────────────────────────────────────┘
```

### 2. Three-Layer Session Model

**Layer 1: UI Sessions** (Frontend)
- Custom named sessions in the drawer
- Each tracks: name, conversationId, messages[], approval settings
- Persisted to: `~/.codex/app_prefs/code_cm6.json` via preferences API

**Layer 2: Framework Shell** (Process Management)
- Single shell process: `['codex', 'mcp-server']`
- Managed by framework_shells supervisor
- Cleaned up on framework exit

**Layer 3: Codex Conversations** (Codex CLI)
- Persisted by Codex CLI independently
- Stored in: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- Can be resumed across shell restarts using conversationId

---

## No Auto-Spawn Policy

### Rule: Shells NEVER auto-spawn without explicit user action

**Violations prevented:**
- ❌ Opening the drawer
- ❌ Switching sessions
- ❌ Page refresh / app navigation
- ❌ Loading saved sessions

**Allowed triggers (deterministic user actions):**
- ✅ User clicks "Send" button (auto-spawns if needed)
- ✅ User clicks "New Session" → modal → "Create Session"
- ✅ User clicks refresh button to manually reconnect

### Implementation Details

**Frontend (`agent_drawer.js`):**
- `openDrawer()` - Loads UI only, no connections
- `switchToSession()` - Updates UI only, no connections
- `loadSessions()` - Restores from disk, checks shell alive, but doesn't reconnect
- `sendMessage()` - **Calls `connectSharedShell()` if not connected** ← deterministic

**Backend (`agent_ws.py`):**
- WebSocket handler creates/reuses shared shell on connection
- Uses global `_shared_shells` registry: `{ 'codex': (session_id, shell_id) }`
- Checks if shell alive before reusing

---

## Session Creation Flow

### User Flow
1. User clicks "New Session" button
2. Modal appears with configuration form
3. User configures:
   - Session name (optional)
   - Agent type (Codex/Gemini)
   - Auto-approve safe commands (checkbox)
   - Full system access (checkbox, disabled unless auto is checked)
4. User clicks "Create Session"
5. Modal closes, session created with settings
6. Session appears in list with custom name

### What Happens
```javascript
// Session object created
{
  id: 'session-123',
  name: 'Bug fix for login',
  conversationId: null,  // Set when first message sent
  messages: [],
  createdAt: timestamp,
  cwd: '/project',
  agent: 'codex',
  auto: true,
  fullAccess: false
}
```

### First Message Sent
When user sends first message in a new session:
1. Check if shared shell connected (if not, spawn it)
2. Include approval settings in message context:
   ```javascript
   message.context = {
     approval_policy: 'on-request',
     sandbox: session.fullAccess ? 'danger-full-access' : 'workspace-write',
     cwd: session.cwd
   }
   ```
3. Backend translates to Codex MCP tool call:
   ```json
   {
     "method": "tools/call",
     "params": {
       "name": "codex",
       "arguments": {
         "prompt": "user's message",
         "approval-policy": "on-request",
         "sandbox": "workspace-write",
         "cwd": "/project"
       }
     }
   }
   ```
4. Codex starts conversation and returns `conversationId`
5. Frontend stores `conversationId` in session

### Subsequent Messages
```json
{
  "method": "tools/call",
  "params": {
    "name": "codex-reply",
    "arguments": {
      "conversationId": "abc-123",
      "prompt": "next message"
    }
  }
}
```

---

## Approval Settings

### Background: Codex MCP Limitations

The Codex MCP server does **NOT** support `--yolo` mode (which bypasses all approvals). That feature exists in the CLI but not in the MCP server.

**Available approval policies:**
- `untrusted` - Always ask (default)
- `on-failure` - Auto-approve, ask if fails
- `on-request` - **Auto-approve safe ops (diffs), ask for shell commands**
- `never` - Never ask (too permissive - won't even write files!)

**The limitation:** Shell commands ALWAYS require approval in MCP mode.

### UI Configuration

**Checkbox 1: "Auto-approve safe commands"**
- Sets: `approval-policy: 'on-request'`
- Sets: `sandbox: 'workspace-write'`
- Behavior: Auto-approves diffs/patches, asks for shell commands
- Sandbox: Limited to workspace directory

**Checkbox 2: "Full system access"** (disabled unless Auto is checked)
- Sets: `approval-policy: 'on-request'` (same as Auto)
- Sets: `sandbox: 'danger-full-access'`
- Behavior: Auto-approves diffs/patches, asks for shell commands
- Sandbox: **Full system access when commands are approved**

### Key Insight

**You cannot bypass shell command approval in Codex MCP.** The `sandbox` parameter only controls what the commands can access once you approve them.

For true YOLO mode, you'd need:
- Codex CLI directly (not MCP server)
- Codex "app-server" (newer architecture, TBD)

---

## State Persistence

### What Gets Saved

**Shell State** (`codex_shell_state` preference)
```json
{
  "shell_id": "fs_1234567890_abcd1234",
  "session_id": "shared-codex-abc123"
}
```

**UI Sessions** (`agent_sessions` preference)
```json
{
  "session-1": {
    "id": "session-1",
    "name": "Bug fix for login",
    "conversationId": "uuid-from-codex",
    "messages": [...],
    "createdAt": timestamp,
    "cwd": "/project",
    "agent": "codex",
    "auto": true,
    "fullAccess": false
  }
}
```

### On Page Refresh

1. Load `codex_shell_state` from preferences
2. Check if `shell_id` is still alive via framework API
3. If alive: Mark as 'Disconnected' (can reconnect manually)
4. If dead: Shell state cleared
5. Load `agent_sessions` from preferences
6. Restore UI sessions with all settings
7. Display in session list
8. **Don't auto-connect** - wait for user action

---

## Message Flow

### Frontend → Backend → Codex

```
User types message
    ↓
sendMessage() checks if shell connected
    ↓
If not connected: await connectSharedShell()
    ↓
connectSharedShell() opens WebSocket
    ↓
WebSocket /ws/agent?agent=codex&cwd=/project
    ↓
Backend: agent_ws.py
    ↓
Get or create shared shell from _shared_shells
    ↓
Send 'connected' event with shell_id, session_id
    ↓
Frontend stores shell metadata
    ↓
sendMessage() builds message with context
    ↓
Send via sharedShell.ws
    ↓
Backend: agent_bridge.py
    ↓
CodexAdapter.to_agent() translates to MCP
    ↓
Write JSON-RPC to framework shell PTY
    ↓
codex mcp-server receives tool call
    ↓
Codex processes and streams response
```

### Codex → Backend → Frontend

```
Codex writes JSON-RPC to stdout
    ↓
Framework shell PTY captures output
    ↓
Backend: Output queue subscribers notified
    ↓
WebSocket forward thread reads queue
    ↓
CodexAdapter.from_agent() normalizes
    ↓
Send normalized event via WebSocket
    ↓
Frontend: sharedShell.ws.onmessage
    ↓
handleAgentMessage() routes to active session
    ↓
Append to transcript
    ↓
Store in session.messages[]
    ↓
Save to disk
```

---

## UI Components

### Session List
- Displays all UI sessions
- Custom names or fallback to "agent - time"
- Click to switch (UI only, no reconnect)
- Delete button (doesn't kill shared shell)
- Active session highlighted (no border)

### Session Configuration Modal
- Appears when "New Session" clicked
- Session name input
- Agent type selector
- Auto-approve checkbox
- Full access checkbox (conditional)
- Cancel / Create buttons

### Message Composer
- Text area for input
- Attach file context checkbox
- Send button (triggers auto-spawn if needed)
- Ctrl/Cmd+Enter shortcut

### Transcript
- User messages (blue bubble)
- Assistant messages (gray bubble, streaming)
- System/planning messages (terminal style, gear icon)
- Approval requests (special UI with Approve/Deny)
- Diff previews
- Error messages

---

## Files

**Frontend:**
- `static/js/agent_drawer.js` - Main drawer logic (958 lines)
- Handles: modal, sessions, shell, messages, approvals

**Backend:**
- `agent_ws.py` - WebSocket endpoint, shared shell management
- `agent_bridge.py` - Protocol translation (MCP/ACP)
- `agent_routes.py` - REST endpoints (send_raw for approvals)

**UI:**
- `template.html` - Drawer HTML, session modal, CSS

---

## Known Limitations

1. **Shell commands always require approval** - MCP server limitation
2. **No YOLO mode** - Use CLI or wait for app-server support
3. **One agent type at a time** - Can't mix Codex + Gemini in same shell
4. **Gemini support incomplete** - Focus has been on Codex MCP
5. **Approval settings only apply at conversation start** - Can't change mid-conversation

---

## Future Enhancements

1. **Codex App Server Integration** - Will enable true YOLO mode
2. **Per-agent shared shells** - Run Codex + Gemini simultaneously
3. **Session reconnection** - Resume conversations after shell dies
4. **Approval policy override** - Change settings mid-conversation
5. **Session templates** - Save approval presets for quick creation

---

## Troubleshooting

**"Agent not connected" on send:**
- Expected on first message - shell auto-spawns
- If persists, check framework_shells API

**Multiple shells running:**
- Check `/api/framework_shells` for duplicates
- Should only see one `agent-codex-*` shell
- If multiple, terminate extras manually

**Approval settings not working:**
- Only applied on first message (new conversation)
- Check browser console for message.context
- Verify conversationId is null when sending

**Stale sessions after restart:**
- Framework cleans shells on exit (expected)
- Sessions restored from disk but disconnected
- Click refresh or send message to reconnect

---

## Best Practices

1. **Name your sessions** - Makes them easier to identify
2. **Use auto-approve for safe work** - Reduces approval fatigue
3. **Only use full access when needed** - Security principle
4. **Delete unused sessions** - Keeps list clean
5. **Don't rely on approvals for security** - They're a convenience feature

---

**End of Documentation**

