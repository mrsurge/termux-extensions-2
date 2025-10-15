# Code‑Server Mobile Bridge MVP — Document Mirror & Live Agent Edits (Integrated with Current Implementation)

**Goal:** Mirror the open document from code‑server inside your mobile UI and accept live agent edits back into that same buffer—safely and with minimal moving parts.

---

## 0) What exists today (grounded summary)

- **Code‑OSS Backend Blueprint**
  - Endpoints: `/api/app/code_oss/state` (GET/POST/OPTIONS, ring buffer + summary), `/status`, `/start`, `/stop`, `/fullpage`, `/project`, `/bridge/install`.
  - Keeps a bounded deque of events with incremental `seq`, maintains a summary of: `activeEditor`, `workspaceFolders`, `explorerTree`, `chatProviders`, `state`, `bridgeState/bridgeActivated`, `errors`.
  - Launches code‑server via a wrapper with persisted `user-data` and `extensions` directories.

- **Bridge Web Extension (web host)**
  - Posts batched events (default ~300ms) to a configurable endpoint (defaults to `http://<host>:8080/api/app/code_oss/state`).
  - Emits: `bridgeActivated/bridgeState`, `activeEditor`, `workspaceFolders`, `explorerTree` (root/children), `chatProviders`, and `state`.
  - Provides postMessage handler for shell commands (focus/search/zen/openPath/etc.).
  - **Not yet implemented:** document text/changes output; inbound edit application.

- **UI Wrapper (Launcher Card)**
  - Start/Stop server, Install Bridge, Copy deep-link; opens full-page IDE view.
  - Polls status and shows bridge install state.

- **Shared State Store**
  - Persistent key/value over `/api/state` with an in‑browser cache. Use this for the bridge token and preferences instead of `localStorage`.

---

## 1) MVP in one line
Mirror the active editor’s **text and selection** in a mobile panel, and **apply agent edits** into the IDE buffer with a revision/ack protocol.

---

## 2) Message model (stable minimum)
Every message: `session_id`, `source_id`, `op_id`, `ts`, `doc_id` (URI).

**Outbound (bridge → backend)**
- `hello`: caps + host info.
- `doc_state`: `{ doc_id, rev, text, languageId, eol, dirty }` — on connect and on active‑editor change.
- `doc_changes`: `{ doc_id, base_rev, next_rev, changes:[ { start:{l,c}, end:{l,c}, text } ] }` — debounced 300–500ms.
- `selections`: optional but recommended later.

**Inbound (backend/agent → bridge)**
- `apply_edits`: `{ doc_id, base_rev, edits:[…] }` — single atomic workspace edit.
- `replace_full`: `{ doc_id, base_rev, text }` — fallback when rebase fails.
- Optional: `set_selection`, `save`, `format_document`.

**ACKs (bridge → backend)**
- `ack`: `{ op_id, doc_id, applied_rev }`

**Conflicts**
- Mismatch on `base_rev` ⇒ bridge **nack**; backend rebases using its cached latest; fallback to `replace_full`.

---

## 3) Bridge (web extension) — tasks

1. **Config**: accept `endpoint`, `token`, `flushInterval`, `retryDelay` (via your existing configure flow). Default to the current endpoint if none supplied.
2. **Capture**: wire `workspace.onDidChangeTextDocument`, `window.onDidChangeActiveTextEditor`, `window.onDidChangeTextEditorSelection`.
   - Maintain a **monotonic `rev` per `doc_id`**.
   - Emit `doc_state` on connect/editor switch, `doc_changes` on debounce, and (later) `selections` bursts.
3. **Transport (outbound)**: batch to `/api/app/code_oss/state` as you do now; keep back‑off and retry logic.
4. **Inbound**: poll commands (e.g., `/state?since=<seq>&types=apply_edits,replace_full`), apply via a single workspace edit, then `ack`.
5. **Echo‑suppress**: tag with a stable `source_id` so your backend/clients don’t re‑emit the same change.

*Non‑goals for MVP:* diagnostics, tree/terminal mirroring here; keep the bridge lean.

---

## 4) Backend (blueprint) — tasks

- **Extend `/state`:** keep the ring buffer/summary, but allow filtering by `types=` for the bridge command poll.
- **New `/edits` (POST):** accept `{ doc_id, base_rev, edits[] | text }` from agents/UI; stamp `op_id`; enqueue a command for the bridge and return `{ op_id }`.
- **CORS:** include `Authorization` in `Access-Control-Allow-Headers` so you can auth the bridge/agents.
- **Cache:** store latest full text per `doc_id` to attempt server‑side rebase; on failure use `replace_full`.
- **Security:** bearer token on `/state` and `/edits`; store token via state-store; log errors to a small history exposed to the wrapper.

---

## 5) Wrapper (mobile UI) — tasks

- **Document tab (Monaco)**: initialize from `summary`’s last `doc_state`; then apply `doc_changes` from polling. Optional “apply edit” button for quick agent tests posting to `/edits`.
- **Status/Logs**: tiny console for last N errors/acks from `/state` responses.
- **IDE iframe** remains for full control; the Document tab is the lightweight mirror.

---

## 6) Mobile constraints
- Debounce 300–500 ms; coalesce adjacent edits server‑side before rebroadcasting to the viewer.
- Switch to `replace_full` for large ops (>64 KB) to avoid radio thrash.
- Stream (optional) `visibleRanges` to keep caret on screen in the mirror.

---

## 7) Test plan (MVP)

1) Launch IDE; bridge installs/activates; mobile Document tab shows the open file within one poll.  
2) Type rapidly 10s; `rev` increases strictly; mirror never drifts.  
3) Send an agent edit; it applies atomically in IDE; mirror updates.  
4) Create conflict (type locally), then apply an old‑rev edit; server rebases or falls back to `replace_full`; no desync.  
5) Restart wrapper; summary seeds mirror; stream resumes from cursor.  

---

## 8) Cutline (explicitly out of MVP)
No terminals, debug state, SCM, diagnostics, or server‑pushed sockets yet. Focus on **mirror + apply** only.

---

## 9) File‑by‑file checklist

- **bridge_extension/** (web): add `doc_state`, `doc_changes`, inbound command polling, `rev`, `ack/nack`.
- **app/apps/code_oss/backend.py**: add `/edits`, allow `Authorization` header in CORS, server‑side rebase cache, `types=` filtering for bridge polling.
- **app/apps/code_oss/templates/** & wrapper: add Document tab with Monaco; polling cursor reuse; post edits; mini log pane.
- **docs/**: capture the message model and conflict policy for future contributors.

---

### Appendix — Example payloads

**doc_state**
```json
{ "type":"doc_state", "doc_id":"file:///home/u/app.py", "rev":42, "text":"print('hi')\n", "languageId":"python", "eol":"\n", "dirty":true }
```

**doc_changes**
```json
{ "type":"doc_changes", "doc_id":"file:///home/u/app.py", "base_rev":42, "next_rev":43,
  "changes":[ { "start":{"l":0,"c":0}, "end":{"l":0,"c":0}, "text":"# header\n" } ] }
```

**apply_edits**
```json
{ "type":"apply_edits", "doc_id":"file:///home/u/app.py", "base_rev":43,
  "edits":[ { "start":{"l":1,"c":0}, "end":{"l":1,"c":0}, "text":"print('ok')\n" } ] }
```

**ack**
```json
{ "type":"ack", "op_id":"6d0b…", "doc_id":"file:///home/u/app.py", "applied_rev":44 }
```