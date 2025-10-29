# JSON Patterns & Schemas — Codex App‑Server and Gemini ACP

> Canonical, line‑delimited JSON envelopes for bridging **STDIN/STDOUT** to **WS/SSE/REST**. Keep payloads single‑line JSON per message. Replace placeholders with your values.

---

## 0) Conventions
- All examples are **single‑line JSON** (no pretty print).  
- `id`: string or number, unique per request.  
- `session`: string that your Bridge assigns to multiplex multiple editor tabs.  
- `when`: ISO‑8601 UTC timestamp for logging.

---

## 1) Transport Envelopes (Bridge‑side)
### WebSocket (UI → Bridge)
```
{"id":"42","target":"codex","type":"send_user_turn","params":{…},"session":"abc"}
```
### WebSocket (Bridge → UI)
```
{"id":"42","event":"token","data":{"text":"partial…"},"session":"abc","when":"2025-10-21T03:21:00Z"}
```
### SSE frame (Bridge → UI)
```
event: message\ndata: {"id":"42","event":"progress","data":{"pct":18},"session":"abc"}\n\n
```
### REST request (UI → Bridge)
```
POST /agent/send {"id":"42","target":"gemini","method":"act","params":{…},"session":"abc"}
```
### REST chunked response (Bridge → UI)
```
{"id":"42","event":"start","session":"abc"}\n{"id":"42","event":"token","data":{"text":"partial"}}\n{"id":"42","event":"final","data":{…}}
```

---

## 2) Codex App‑Server — Core Messages
### 2.1 Initialize (optional)
```
{"id":"1","type":"initialize","params":{"client":"your-app","version":"1.0.0"}}
```
### 2.2 Send User Turn
```
{"id":"2","type":"send_user_turn","params":{"model":"gpt-5-codex","effort":"medium","summary":"one-line intent","items":[{"type":"text","text":"Explain the diff between A and B"}],"cwd":"/repo/path","final_output_json_schema":{"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"]},"metadata":{"session":"abc"}}}
```
**Notes:**
- `items`: minimally support `{ "type":"text","text":"…" }`.  
- `cwd`: optional working directory.  
- `final_output_json_schema`: optional JSON Schema to shape the terminal output.

### 2.3 Model List
```
{"id":"3","type":"model/list","params":{}}
```
**Response example**
```
{"id":"3","type":"result","result":{"models":[{"id":"gpt-5-codex","display":"GPT‑5 Codex"},{"id":"gpt-5-codex-pro"}]}}
```

### 2.4 Streamed Events (examples)
```
{"id":"2","event":"planning","data":{"summary":"Plan step 1…"}}
{"id":"2","event":"token","data":{"text":"partial token"}}
{"id":"2","event":"diff","data":{"path":"/a/b.py","patch":"@@ …"}}
{"id":"2","event":"tool_call","data":{"name":"fs.read","args":{"path":"/a/b.py"}}}
{"id":"2","event":"final","data":{"ok":true,"output":{"answer":"…"}}}
```

### 2.5 Errors
```
{"id":"2","event":"error","data":{"kind":"terminal","message":"Rate limit"}}
```

---

## 3) Gemini CLI — ACP Messages
### 3.1 Initialize / Capabilities
```
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"client":"your-app","version":"1.0.0"}}
```
**Capabilities response (example)**
```
{"jsonrpc":"2.0","id":1,"result":{"capabilities":{"streaming":true,"edits":true,"plans":true}}}
```

### 3.2 Open Session (optional)
```
{"jsonrpc":"2.0","id":2,"method":"session/open","params":{"session":"abc","buffers":[]}}
```

### 3.3 Act / Run (chat or task)
```
{"jsonrpc":"2.0","id":3,"method":"act","params":{"session":"abc","input":{"type":"text","text":"Create a POST /users handler"},"mode":"code"}}
```

### 3.4 Streamed Notifications (server → client)
```
{"jsonrpc":"2.0","method":"progress","params":{"id":3,"pct":10}}
{"jsonrpc":"2.0","method":"token","params":{"id":3,"text":"partial"}}
{"jsonrpc":"2.0","method":"edit","params":{"id":3,"path":"/api/users.js","patch":"@@ …"}}
{"jsonrpc":"2.0","method":"final","params":{"id":3,"ok":true,"output":{"summary":"…"}}}
```

### 3.5 JSON‑RPC Error
```
{"jsonrpc":"2.0","id":3,"error":{"code":-32000,"message":"Model unavailable","data":{"hint":"try gemini-2.5-pro"}}}
```

---

## 4) Bridge Control Messages (optional)
### 4.1 Ping / Pong
```
{"id":"ping-1","type":"ping"}
{"id":"ping-1","type":"pong"}
```

### 4.2 Cancel
```
{"id":"cancel-42","type":"cancel","params":{"targetId":"42"}}
```

---

## 5) Mapping Reference
- **WS:** send/receive the envelopes as WS text frames.  
- **SSE:** wrap each outbound JSON line with `event: message` + `data: <json>`.  
- **REST:** accept a JSON body (UI → Bridge); reply either as chunked JSON lines (streaming) or as a final assembled JSON with an array of events.

---

## 6) Minimal JSON Schemas (Bridge‑side)
### 6.1 Outbound request (generic)
```
{"type":"object","properties":{"id":{},"target":{"type":"string","enum":["codex","gemini"]},"type":{"type":"string"},"method":{"type":"string"},"params":{"type":"object"},"session":{"type":"string"}},"required":["id","target"],"additionalProperties":true}
```

### 6.2 Inbound event (generic)
```
{"type":"object","properties":{"id":{},"event":{"type":"string"},"data":{"type":"object"},"session":{"type":"string"}},"required":["id","event"],"additionalProperties":true}
```

---

**Keep payloads single‑line and correlate by `id` (and `session` if you multiplex). These patterns are intentionally minimal to remain forward‑compatible.**

