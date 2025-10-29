# Codex App‑Server & Gemini ACP — Integration Manual (WS / SSE / REST)

**Scope:** Wiring guide to embed **Codex CLI (app‑server mode)** and **Gemini CLI (`--experimental-acp`)** into a Flask‑based editor that speaks **WebSocket (WS)**, **Server‑Sent Events (SSE)**, and **REST**. Focus: process lifecycle, transports, message envelopes, and bridging patterns. No backend how‑to beyond I/O contracts.

---

## 1) Terms & Roles
- **Editor (your app):** Browser UI ⇄ Flask backend.
- **Bridge:** A thin service you run alongside Flask that spawns the CLI process and relays bytes/messages (stdio ⇄ WS/SSE/REST). Can be the same Flask process or a sibling.
- **Agent process:**
  - **Codex CLI** in **app‑server** mode.
  - **Gemini CLI** in **ACP** mode.

---

## 2) Process Lifecycle
### Start
- **Codex (app‑server):** launch the `codex` binary with the `app-server` subcommand. The process exposes a **line‑delimited JSON** API over **STDIN/STDOUT** (primary transport). Keep the process long‑lived per project/workspace.
- **Gemini (ACP):** launch `gemini --experimental-acp`. It speaks **ACP** over **STDIN/STDOUT** using **JSON‑RPC 2.0** style envelopes. Keep long‑lived.

### Health & Supervision
- The Bridge maintains the child process, restarts on exit, and tags each logical conversation with an internal session id.
- Detect liveness via periodic `ping`/`getCapabilities` (ACP) or a no‑op/`status` (Codex app‑server) request.

---

## 3) Transports You Offer to the Browser
### A) WebSocket (recommended for interactive runs)
- **Inbound (UI → Bridge):** JSON messages; Bridge forwards to agent **STDIN** (one JSON per line).  
- **Outbound (Bridge → UI):** Stream each agent **STDOUT** line as a WS text message.

### B) Server‑Sent Events (SSE) for output; REST for input
- **Inbound:** UI sends REST POSTs to your Bridge (e.g., `/agent/send`). Bridge writes to agent **STDIN**.  
- **Outbound:** Bridge exposes `/agent/stream` as `text/event-stream`; each agent **STDOUT** line is emitted as an `event: message\ndata: <json>\n\n` frame.

### C) Pure REST (request/long‑poll)
- **Inbound:** POST one request at a time.  
- **Outbound:** keep the HTTP connection open and stream chunked JSON lines (if your stack supports it). Otherwise poll for accumulated events by id.

**Framing rule:** both agents expect **one JSON document per line** on STDIN; they produce **one JSON document per line** on STDOUT. Do not send pretty‑printed (multi‑line) JSON.

---

## 4) Message Envelope & Routing (Conceptual)
- **Envelope:** use JSON‑RPC‑like structure consistently: `{ "id": <number|string>, "method"|"type": <string>, "params"?: <object> }`.
- **Correlation:** your Bridge should map every outbound request `id` to zero‑N inbound responses/events referring to that `id` (directly or via a session/turn id inside the payload). Buffer partials; surface to UI as you receive.
- **Backpressure:** if WS/SSE consumer lags, queue with caps; drop or compress (coalesce token deltas) when over limit.

---

## 5) Codex CLI — App‑Server Mode
### Launch
- Command: `codex app-server` (foreground, stdio protocol). Provide any auth/config via env vars or config files.

### Core Operations (wire intent)
- **Turn submission** — create/continue a conversation/turn with fields like `model`, `summary`, `effort`, `items` (e.g., a text message), optional `cwd`, and optional `final_output_json_schema` (to request strongly‑typed final output).  
- **Model discovery** — list available models (use to avoid hard‑coding).  
- **Rate‑limit read** — fetch effective limits/quota (optional).  
- **Events** — streamed: planning, tool calls, diffs/edits, token deltas, final result, errors.

### Flow (typical)
1. Bridge sends **initialize/hello** (optional; version probing).  
2. Bridge sends **turn** request with a unique `id`.  
3. App‑server streams **progress events** (same or related `id`).  
4. App‑server emits **final** (terminal event) → Bridge completes the client request.

### Error Semantics
- Non‑terminal errors arrive as events with severity and diagnostic text. Terminal errors arrive as a final error object linked to the initiating `id`.

---

## 6) Gemini CLI — ACP Mode (`--experimental-acp`)
### Launch
- Command: `gemini --experimental-acp` (foreground, stdio JSON‑RPC over ACP).

### Lifecycle (ACP)
1. **initialize / getCapabilities** exchange.  
2. **openSession / attachBuffers** (editor state, optional).  
3. **act/run** style commands (ask, plan, edit, apply).  
4. **streamed events**: planning, thoughts, suggestions, code edits/patches, tokens, final.

### Buffer & Edit Semantics
- ACP supports sending current buffers (paths + contents or references) and receiving edits as patches/diffs. Your Bridge may forward only high‑level chat if you’re not syncing files.

### Error Semantics
- JSON‑RPC `error` object with `code`, `message`, optional `data`.

---

## 7) Mapping to Your Endpoints
### WebSocket
- **WS inbound**: `{ id, target: "codex"|"gemini", method/type, params }` → serialize compact JSON → write to child **STDIN** with trailing `\n`.  
- **WS outbound**: read a line from **STDOUT** → validate as JSON → emit to the same WS client (or broadcast per session key).

### SSE + REST
- **REST POST /agent/send**: body is the JSON envelope → write to **STDIN**.  
- **SSE GET /agent/stream?session=…**: for each **STDOUT** line that matches the session, emit `event: message` with `data: <the line>`.

### Pure REST
- **POST** starts a turn; keep the connection open and stream each **STDOUT** line as chunked JSON until a terminal event is observed (then close). If your stack doesn’t support streaming, return a `202` with a ticket and provide `/agent/events?ticket=…` for polling.

---

## 8) Validation, Timeouts, Retries
- **Validation:** reject any message that isn’t single‑line JSON; verify required fields per protocol (see the companion JSON Patterns doc).  
- **Timeouts:** per request and per idle session; send a synthetic terminal event before killing the child.  
- **Retries:** idempotent reads (model list); **do not** blindly retry mutating turns.

---

## 9) Logging & Observability
- Log raw line I/O (stdout/stderr) with session/id tags.  
- Surface latency per stage (queued → sent → first byte → final).  
- Redact secrets from params.

---

## 10) Security Posture
- The Bridge is the sole owner of the agent process.  
- Enforce an allowlist of methods.  
- Bound output rate to protect WS/SSE clients.

---

## 11) Minimal Non‑Goals
- No editor UX, no Python/JS library choices.  
- No file sync specifics; treat buffers as opaque payloads passed via params when needed.

---

## 12) Quick Capability Matrix
| Capability | Codex app‑server | Gemini ACP |
|---|---|---|
| Transport to Bridge | STDIN/STDOUT lines | STDIN/STDOUT JSON‑RPC |
| Turn request | Yes (model/effort/summary/items/schema) | Yes (ACP act/run) |
| Model list | Yes | Via capabilities / model selection |
| Streaming tokens | Yes (events) | Yes (events) |
| Edits/patches | Yes (events) | Yes (edits) |
| Tooling attach | Outside of this mode (MCP) | Via MCP (separate), not ACP core |
| Error envelope | Terminal vs non‑terminal events | JSON‑RPC error object |

---

**Use this manual with the companion "JSON Patterns & Schemas" document for exact envelopes.**

