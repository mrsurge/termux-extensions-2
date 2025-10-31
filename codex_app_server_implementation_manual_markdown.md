# Codex App‑Server — Implementation Manual

> Version: 2025‑10‑31 · Status: **Working draft** (compiled from public CLI docs, changelogs, issues, and code comments). Where exact field names vary across builds, both observed forms are shown.

---

## 1) What the **app‑server** is

**Codex app‑server** is a local process that exposes Codex’s agent over a **newline‑delimited JSON (JSONL)** stream on **stdin/stdout**. You start it from your app and speak a small request/response protocol. Codex streams back structured events (plan, tokens, diffs, tool calls, final results, errors). It is intended for **development/debugging** and is subject to change.

> Launch: `codex app-server`

It differs from **MCP server** mode:

- **Transport**: app‑server ≈ JSONL over stdio; MCP = Model Context Protocol (JSON‑RPC) over stdio/HTTP.
- **Sessioning**: app‑server generally treats **one conversation per process**; MCP allows multi‑conversation via conversationId.
- **Messages**: app‑server has lightweight method names (e.g. `send-user-turn`); MCP uses JSON‑RPC methods like `tools/call`.

---

## 2) Running inside a PTY / terminal

The app‑server speaks **plain JSON lines** on stdout and expects **one JSON object per line** on stdin. It **can** run under a PTY (e.g., if your backend spawns it attached to a pseudo‑terminal) as long as you:

- **Do not** launch the TUI (`codex` with no subcommand). Always use `codex app-server` for protocol I/O.
- **Read line‑by‑line** and parse as JSON. Do not rely on ANSI formatting.
- **Flush** writes to stdin after each line; avoid partial frames.

Minimal examples (bridges):

```ts
// Node.js (TypeScript) – spawn and bridge JSONL
import { spawn } from 'node:child_process';
import * as readline from 'node:readline';

const p = spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = readline.createInterface({ input: p.stdout });

rl.on('line', (line) => {
  try {
    const evt = JSON.parse(line);
    // forward to your WebSocket/SSE/UI
    handleEvent(evt);
  } catch (e) {
    console.error('non-JSON line from codex:', line);
  }
});

function send(obj: unknown) {
  p.stdin.write(JSON.stringify(obj) + '\n');
}

// Example turn
send({
  id: '1',
  type: 'send-user-turn',
  params: {
    model: 'gpt-5-codex',
    effort: 'medium',
    items: [{ type: 'text', text: 'Summarize the repo briefly.' }],
  },
});
```

```python
# Python – bridge JSONL
import json, sys, subprocess

p = subprocess.Popen(
    ['codex', 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
)

for line in p.stdout:  # stream events
    try:
        evt = json.loads(line)
        handle_event(evt)
    except Exception:
        sys.stderr.write(f'non-JSON line: {line}\n')

# Send a turn
req = {
    'id': '1',
    'type': 'send-user-turn',
    'params': {
        'model': 'gpt-5-codex',
        'effort': 'medium',
        'items': [{'type': 'text', 'text': 'What is the plan?'}],
    },
}
print(json.dumps(req), file=p.stdin, flush=True)
```

---

## 3) Request envelope (client → app‑server)

```jsonc
{
  "id": "string",                // required: correlate responses
  "type": "send-user-turn",       // operation name (see list below)
  "params": {                      // type-specific parameters
    "model": "gpt-5-codex",      // model (optional if configured in CLI)
    "effort": "low|medium|high", // reasoning effort preset
    "summary": "(optional) one-line intent",
    "items": [                     // the user turn content
      { "type": "text", "text": "Explain X vs Y" }
    ],
    "cwd": "/path/optional",     // optional working dir context
    "final_output_json_schema": {  // optional JSON Schema for final output shaping
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": { "answer": {"type": "string"} },
      "required": ["answer"]
    }
  },
  "metadata": {                    // optional, passthrough for your app
    "session": "uuid-or-app-session-id"
  }
}
```

**Notes**
- Method name may appear as `send-user-turn` (kebab) in newer builds; some artifacts show `send_user_turn` (snake). Prefer **kebab‑case**.
- `items` can be extended as Codex adds modalities. `text` is sufficient for chat.

### Known client request types (as of 2025‑10‑31)

| Type | Purpose |
|---|---|
| `initialize` | Optional handshake. May include client name/version and receive server info. |
| `send-user-turn` | Submit a new user message/turn. Primary operation. |
| `model/list` | Enumerate available models exposed by the app‑server. |
| `conversation/getSummary` | Fetch a compact summary for UI preview/resume pickers. |
| `conversation/resume` | Resume a conversation by id/summary id (server persists/recovers rollout). |
| `cancel` | Best‑effort cancel of an in‑flight turn. |

> Field names/casing can vary slightly between releases; keep your adapter tolerant (normalize on input; generate kebab‑case on output).

---

## 4) Response stream (server → client)

The server writes **one JSON object per line**. Use the incoming `id` to correlate with the originating request.

### Event frames

```jsonc
{ "id": "1", "event": "planning", "data": { "summary": "Open file, diff, patch" } }
{ "id": "1", "event": "token",    "data": { "text": "The approach is …" } }
{ "id": "1", "event": "diff",     "data": { "path": "src/app.py", "patch": "@@ ..." } }
{ "id": "1", "event": "tool_call", "data": { "name": "run", "args": ["pytest", "-q"] } }
{ "id": "1", "event": "final",    "data": { "ok": true, "output": { "answer": "…" } } }
{ "id": "1", "event": "error",    "data": { "kind": "terminal", "message": "bad schema" } }
{ "event": "account/rateLimits/updated", "data": { /* account quota snapshot */ } }
{ "event": "codex/event/raw_item",     "data": { /* low-level item, for diagnostics */ } }
```

> Some builds stream **item** events (`item` / `item.delta`) rather than `token`; treat both as partial text output channels. Always handle **`final`** as the terminal event for a turn. Non‑turn notifications (e.g., `account/rateLimits/updated`) **do not** carry an `id`.

### Final result shaping

If you provided `final_output_json_schema`, Codex attempts to emit a `final` whose `data.output` conforms to your schema. Reject or retry if validation fails in your app.

---

## 5) Conversation resuming

There are two layers:

- **CLI-level resume** (TUI and `codex exec resume ...`): relies on Codex’s stored **rollout** history and a `session_id` managed by the CLI. Use this when you just want Codex to continue a prior run from your scripts.
- **App‑server resume**: server exposes resume primitives (fetch **conversation summary**, resume **from history/rollout** by id). In your app, persist the ids the server surfaces (e.g., summary or rollout identifier) alongside your chat UI state; when reopening, send a `conversation/resume` before your next `send-user-turn`.

**Resume pitfalls**
- The legacy MCP tool did **not** natively resume; app‑server **does**. Keep your adapter paths separate.
- If you swap working directories between sessions, make sure your bridge re‑sets `cwd` or re‑spawns the process to avoid wrong-path file ops.

---

## 6) Error handling & cancellation

- Treat any `event: "error"` as recoverable unless the process exits. Surface the message to the UI and keep listening.
- Provide a `cancel` request to let the user stop a long turn; the server will best‑effort abort and emit a terminal `final`/`error`.
- Watch the child‑process exit code; if it exits, close the client session and allow restart.

---

## 7) Security, sandbox & approvals

- App‑server does **not** enforce a sandbox; Codex’s CLI sandbox policies apply when *Codex itself* runs tools. For external tools you execute in response to `tool_call`, enforce your own approvals.
- In unattended runs, prefer **workspace‑scoped** write permissions over global full access. Keep a clear audit log of requests/events.

---

## 8) Compatibility matrix (MCP vs App‑server)

| Capability | MCP server | App‑server |
|---|---|---|
| Transport | JSON‑RPC (stdio/HTTP) | JSONL (stdio) |
| Multi‑conversation per process | Yes (conversationId) | Typically No (spawn per chat) |
| Resume persisted session | Often No (by default) | **Yes** (resume from rollout/summary) |
| Tools | `tools/call` RPC | Streamed `tool_call` events (plus diffs/commands) |
| Notifications | MCP‑specific | `account/rateLimits/updated`, `codex/event/raw_item`, etc. |

---

## 9) Known commands/messages/patterns (consolidated)

> **Requests (client → server)**

- `initialize { client, version }` – optional handshake.
- `send-user-turn { model, effort, items, summary?, cwd?, final_output_json_schema? }` – main turn.
- `model/list {}` – enumerate models.
- `conversation/getSummary { conversationId }` – fetch compact view.
- `conversation/resume { conversationId | summaryId }` – restore context.
- `cancel { id }` – abort in‑flight turn.

> **Events (server → client)**

- `planning { summary }`
- `token { text }` **or** `item { delta: { text }, kind: 'assistant_message' }` (partial output)
- `diff { path, patch }`
- `tool_call { name, args }`
- `final { ok, output }`
- `error { kind, message }`
- `account/rateLimits/updated { ... }` (notification)
- `codex/event/raw_item { ... }` (low‑level)

> **Session utilities**

- CLI `codex resume [--last|SESSION_ID]` – interactive.
- CLI `codex exec resume [--last|SESSION_ID] "follow‑up"` – non‑interactive.

---

## 10) End‑to‑end example (single turn)

**Request**
```json
{"id":"42","type":"send-user-turn","params":{"model":"gpt-5-codex","effort":"medium","items":[{"type":"text","text":"Add a README section listing prerequisites."}],"cwd":"/work/project"}}
```

**Stream (abbrev)**
```json
{"id":"42","event":"planning","data":{"summary":"Open README, edit, write patch"}}
{"id":"42","event":"diff","data":{"path":"README.md","patch":"@@ ..."}}
{"id":"42","event":"final","data":{"ok":true,"output":{"answer":"Added prerequisites section."}}}
```

---

## 11) Integration notes for **code_cm6** (Agent Drawer → app‑server)

> Pattern‑level changes. Adjust names to your repo structure.

### Files to update

1. `app/apps/file_editor_cm6/agent_bridge.py`
2. `app/apps/file_editor_cm6/agent_ws.py`
3. `app/apps/file_editor_cm6/static/js/agent_drawer.js`
4. `docs/apps/code_cm6/README.md`
5. `README.md` (root)
6. `REPO_STRUCTURE.md` (root)
7. `agent/ONBOARDING_CODE_CM6.md`

### Representative diffs

**1) Switch spawn command (MCP → app‑server)**
```diff
--- a/app/apps/file_editor_cm6/agent_bridge.py
+++ b/app/apps/file_editor_cm6/agent_bridge.py
@@
- cmd = ['codex', 'mcp-server']
+ cmd = ['codex', 'app-server']
  proc = subprocess.Popen(cmd, stdin=PIPE, stdout=PIPE, stderr=PIPE, text=True)
```

**2) Replace JSON‑RPC adapter with JSONL adapter**
```diff
--- a/app/apps/file_editor_cm6/agent_bridge.py
+++ b/app/apps/file_editor_cm6/agent_bridge.py
@@
- def to_agent(message):
-     # MCP JSON‑RPC tools/call
-     return {
-         'jsonrpc': '2.0', 'id': message['id'], 'method': 'tools/call',
-         'params': {...}
-     }
+ def to_agent(message):
+     # app‑server JSONL
+     return {
+         'id': message['id'],
+         'type': 'send-user-turn',
+         'params': {
+             'model': message.get('model', 'gpt-5-codex'),
+             'effort': message.get('effort', 'medium'),
+             'items': [{ 'type': 'text', 'text': message['text'] }],
+             'cwd': message.get('cwd')
+         }
+     }
```

**3) Normalize incoming events for UI**
```diff
--- a/app/apps/file_editor_cm6/agent_bridge.py
+++ b/app/apps/file_editor_cm6/agent_bridge.py
@@
- if msg.get('result') and 'message' in msg['result']:
-     yield { 'event': 'token', 'text': msg['result']['message'] }
+ if msg.get('event') in ('token', 'item'):
+     payload = msg.get('data', {})
+     text = payload.get('text') or payload.get('delta', {}).get('text')
+     if text: yield { 'event': 'token', 'text': text }
+ elif msg.get('event') == 'diff':
+     yield { 'event': 'diff', 'path': msg['data']['path'], 'patch': msg['data']['patch'] }
+ elif msg.get('event') == 'tool_call':
+     yield { 'event': 'tool', 'name': msg['data']['name'], 'args': msg['data'].get('args', []) }
+ elif msg.get('event') == 'final':
+     yield { 'event': 'final', 'ok': msg['data'].get('ok', True), 'output': msg['data'].get('output') }
+ elif msg.get('event') == 'error':
+     yield { 'event': 'error', 'message': msg['data'].get('message','') }
```

**4) Frontend: remove conversationId coupling**
```diff
--- a/app/apps/file_editor_cm6/static/js/agent_drawer.js
+++ b/app/apps/file_editor_cm6/static/js/agent_drawer.js
@@
- // wait for MCP "conversation_started" to get conversationId
- ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.method==='conversation_started') setConvId(m.result.id) }
+ // app‑server streams events immediately; no conversationId
+ ws.onmessage = (ev) => handleAgentEvent(JSON.parse(ev.data))
@@
- send({ id: nextId(), method: 'tools/call', params: {/* ... */} })
+ send({ id: nextId(), type: 'send-user-turn', params: { items:[{type:'text', text: input.value}], model: currentModel, effort } })
```

**5) Docs updates (root & code_cm6)**
```diff
--- a/README.md
+++ b/README.md
@@
- Backend agent: Codex (MCP server)
+ Backend agent: Codex (app‑server)
@@
- Protocol: MCP JSON‑RPC over stdio
+ Protocol: JSONL over stdio (app‑server). See docs/apps/code_cm6/README.md.
```

```diff
--- a/agent/ONBOARDING_CODE_CM6.md
+++ b/agent/ONBOARDING_CODE_CM6.md
@@
- Start the agent backend with: `codex mcp-server`
+ Start the agent backend with: `codex app-server`
@@
- Messages are JSON‑RPC (tools/call, etc.)
+ Messages are JSONL frames (`send-user-turn`, streamed events `token|diff|tool_call|final`).
```

---

## 12) Testing checklist

- Spawn app‑server, send a trivial turn, assert receipt of `planning` → `token|item` → `final` in order.
- Verify `model/list` returns at least one entry and switching model works.
- Validate schema‑shaped final output with a deliberate `final_output_json_schema`.
- Resume flow: persist summary/ids, kill/restart backend, call `conversation/resume`, continue successfully.
- Ensure UI no longer depends on MCP conversation IDs; sessions map 1:1 to child processes.

---

## 13) Troubleshooting

- **Raw JSON showing in your terminal UI**: you likely launched the interactive CLI instead of app‑server. Use `codex app-server` and consume JSON lines.
- **No session resume in non‑interactive mode**: prefer `codex exec resume ...` or call the app‑server resume endpoints; `codex proto` historically lacked resume flags in some builds.
- **File ops occur in wrong directory**: ensure you pass `cwd` per turn or re‑spawn with correct working directory.

---

## Appendix A — Type sketches (non‑authoritative)

```ts
// Request
interface SendUserTurn {
  id: string;
  type: 'send-user-turn';
  params: {
    model?: string;
    effort?: 'low'|'medium'|'high';
    summary?: string;
    items: Array<{ type: 'text'; text: string }>;
    cwd?: string;
    final_output_json_schema?: object;
  };
  metadata?: Record<string, unknown>;
}

// Events
interface PlanningEvt { id?: string; event: 'planning'; data: { summary: string } }
interface TokenEvt    { id?: string; event: 'token'|'item'; data: { text?: string; delta?: { text?: string } } }
interface DiffEvt     { id?: string; event: 'diff'; data: { path: string; patch: string } }
interface ToolEvt     { id?: string; event: 'tool_call'; data: { name: string; args?: unknown } }
interface FinalEvt    { id?: string; event: 'final'; data: { ok: boolean; output?: unknown } }
interface ErrorEvt    { id?: string; event: 'error'; data: { kind?: string; message: string } }
interface RateEvt     { event: 'account/rateLimits/updated'; data: unknown }
interface RawItemEvt  { event: 'codex/event/raw_item'; data: unknown }
```

