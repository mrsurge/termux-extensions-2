# Agent Integration Quick Reference

## WebSocket API

### Connection
```javascript
ws = new WebSocket('ws://localhost:8080/ws/app/file_editor_cm6/agent?session=<id>&agent=codex&file=/path/to/file.py')
```

### Send Message (Normalized Format)
```json
{
  "id": "unique-id",
  "action": "chat",
  "text": "Your prompt here",
  "target": "codex",
  "file": "/optional/file/path"
}
```

### Receive Events
```json
{"id": "...", "event": "token", "text": "partial..."}
{"id": "...", "event": "diff", "path": "/file.py", "patch": "@@..."}
{"id": "...", "event": "final", "ok": true, "output": {...}}
{"id": "...", "event": "error", "error": "message"}
```

---

## REST API

### Create Agent
```bash
POST /api/app/file_editor_cm6/agent/create
Content-Type: application/json

{"agent": "codex", "cwd": "/project"}
```

### List Agents
```bash
GET /api/app/file_editor_cm6/agent/list
```

### Get Stats
```bash
GET /api/app/file_editor_cm6/agent/<session_id>
```

### Terminate
```bash
DELETE /api/app/file_editor_cm6/agent/<session_id>
```

---

## Protocol Translation Cheat Sheet

### Codex App-Server

**You send:** `{"id":"1","action":"chat","text":"Hello"}`

**Agent receives:** `{"id":"1","type":"send_user_turn","params":{"items":[{"type":"text","text":"Hello"}]}}`

**Agent sends:** `{"id":"1","event":"token","data":{"text":"Hi"}}`

**You receive:** `{"id":"1","event":"token","text":"Hi","agent":"codex"}`

### Gemini ACP

**You send:** `{"id":"2","action":"chat","text":"Hello"}`

**Agent receives:** `{"jsonrpc":"2.0","id":2,"method":"act","params":{"input":{"type":"text","text":"Hello"}}}`

**Agent sends:** `{"jsonrpc":"2.0","method":"token","params":{"id":2,"text":"Hi"}}`

**You receive:** `{"id":"2","event":"token","text":"Hi","agent":"gemini"}`

---

## Context Enrichment

When you specify a `file` parameter, the bridge automatically includes:

```json
{
  "file_path": "/path/to/file.py",
  "file_content": "...",
  "language": "py",
  "git_status": "modified",
  "cwd": "/project"
}
```

This gets injected into the agent's context before your prompt.

---

## Event Types

| Event | Description | Fields |
|-------|-------------|--------|
| `token` | Streaming text response | `text` |
| `planning` | Agent reasoning step | `summary` |
| `tool_call` | Agent calling a tool | `tool`, `args` |
| `diff` | Code change suggestion | `path`, `patch` |
| `final` | Completion event | `ok`, `output` |
| `error` | Error occurred | `error`, `kind` |
| `progress` | Progress update (Gemini) | `percent` |

---

## Example: Full Chat Flow

```javascript
// 1. Connect
const ws = new WebSocket(
  'ws://localhost:8080/ws/app/file_editor_cm6/agent?agent=codex&file=/app/main.py'
);

// 2. Send prompt
ws.send(JSON.stringify({
  id: '1',
  action: 'chat',
  text: 'Add error handling to this function'
}));

// 3. Receive streaming response
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  if (msg.event === 'token') {
    // Append streaming text
    chatOutput.textContent += msg.text;
  }
  
  if (msg.event === 'diff') {
    // Show code change
    showDiff(msg.path, msg.patch);
  }
  
  if (msg.event === 'final') {
    // Mark complete
    console.log('Done:', msg.output);
  }
};
```

---

## Debugging

### Check Agent Process
```bash
curl http://localhost:8080/api/app/file_editor_cm6/agent/list
```

### View Logs
```bash
# Find shell ID from list endpoint, then:
tail -f ~/.cache/te_framework/logs/<shell_id>.stdout.log
tail -f ~/.cache/te_framework/logs/<shell_id>.stderr.log
```

### Test Agent Binary
```bash
# Codex
echo '{"id":"1","type":"send_user_turn","params":{"items":[{"type":"text","text":"Hello"}]}}' | codex app-server

# Gemini
echo '{"jsonrpc":"2.0","id":1,"method":"act","params":{"input":{"type":"text","text":"Hello"}}}' | gemini --experimental-acp
```

---

## Common Patterns

### Switch Agents
```javascript
// Use Codex for refactoring
ws.send(JSON.stringify({id: '1', action: 'chat', text: 'Refactor this', target: 'codex'}));

// Use Gemini for explanation
ws.send(JSON.stringify({id: '2', action: 'chat', text: 'Explain this', target: 'gemini'}));
```

### Include Custom Context
```javascript
ws.send(JSON.stringify({
  id: '3',
  action: 'chat',
  text: 'Fix this bug',
  file: '/path/to/buggy_file.py',
  context: {
    related_files: ['/tests/test_file.py']
  }
}));
```

### Request Structured Output
```javascript
ws.send(JSON.stringify({
  id: '4',
  action: 'chat',
  text: 'Analyze this code',
  output_schema: {
    type: 'object',
    properties: {
      complexity: {type: 'number'},
      issues: {type: 'array', items: {type: 'string'}}
    }
  }
}));
```

---

**See `agent_integration.md` for complete documentation.**
