# Codex `app-server` + TE2 + `framework-shells` (integration notes)

Timestamp: 2025-12-19

## Goal
Replace (or complement) the current “agent drawer” with a pluggable “mini app” that talks to Codex CLI’s `codex app-server`, while using `framework-shells` as the lifecycle + sandbox foundation.

This aims to provide:
- A stable, reconnectable long-lived agent session on mobile (background/app switching).
- A UI that can render streaming deltas (messages/tool output/diffs) and handle approval gates.
- A path to “Codex as a service” inside TE2, without TE2 taking on agent business logic.

## State policy (updated)
- Treat the **app-server as SSOT** for conversational state and recovery, mirroring the real Codex CLI behavior.
- Assume **sessions are recoverable** across UI refreshes and app restarts (thread persistence + `thread/list`/`thread/resume`).
- TE2 should only persist *minimal* “where was I” routing state (which project is active; which thread to resume) rather than duplicating Codex’s storage.

## What we know (schema + official README)
Sources:
- Local schema bundle: `/data/data/com.termux/files/home/my-schema/codex_app_server_protocol.schemas.json`
- Official README snapshot: `notes/plans/app-server_plan/app-server_full_readme.md`

### Protocol (confirmed)
- Bidirectional streaming **JSONL over stdio**.
- JSON-RPC 2.0 semantics, but the `"jsonrpc":"2.0"` header is omitted.
- Hard handshake requirement:
  - Client sends `initialize` request once.
  - Client then emits an `initialized` notification.
  - Any other request before this is rejected; repeat `initialize` is rejected.

### Transport shape (schema)
Message envelope is JSON-RPC-ish:
- Requests: object with `id`, `method`, `params`
- Notifications: object with `method`, `params`
- Responses: object with `id`, `result`

Schema names:
- `JSONRPCRequest`, `JSONRPCNotification`, `JSONRPCResponse`, `JSONRPCError`
- `JSONRPCMessage` is a union of the above.

### Server → client (high-level)
Two “channels” show up in schema:

1) `ServerNotification` (26 methods): higher-level lifecycle + streaming updates (turn started/completed, diff updated, item started/completed, oauth completed, token usage updates, etc.).

2) `EventMsg` (51 variants): more granular streaming/event payloads, including:
- `agent_message_delta`, `exec_command_output_delta`, `plan_update`, `turn_diff`, `terminal_interaction`
- approval prompts (`exec_approval_request`, `apply_patch_approval_request`)
- `mcp_*` tool lifecycle (`mcp_tool_call_begin/end`, `mcp_startup_*`, `mcp_list_tools_response`)

### Server → client approval requests
`ServerRequest` has 4 methods:
- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `applyPatchApproval`
- `execCommandApproval`

Implication: any UI/client needs an approval UX + persistence/retry story.

### Items / event ordering (confirmed)
Per-turn lifecycle:
- `turn/started` → `item/started` → zero+ deltas → `item/completed` → `turn/completed`
- Token usage can stream separately via `thread/tokenUsage/updated`.
- `turn/diff/updated` is an aggregated unified diff snapshot emitted after file changes.
- `turn/plan/updated` streams the model plan as `{ step, status }` entries.

Approvals (high-level ordering):
- `item/started` (pending `commandExecution`/`fileChange` item) →
  approval request (`item/commandExecution/requestApproval` or `item/fileChange/requestApproval`) →
  client response `{ decision: "accept" | "decline", ... }` →
  `item/completed` finalizes status (`completed|failed|declined`).

### Persistence / history (confirmed)
- Threads are persisted as **JSONL** “rollout files” on disk.
- `thread/list` provides cursor pagination for rendering history.
- `thread/archive` moves a thread’s rollout file into an archived sessions directory.

### Client → server requests (examples)
`ClientRequest` is a `oneOf[...]` union (44 methods). Notable families:
- Session/thread/turn lifecycle: `initialize`, `thread/start`, `turn/start`, `turn/abort`, `thread/compact`, etc.
- Command execution: `command/exec`
- Config: `config/read`, `config/value/write`, `config/batchWrite`
- Review: `review/start`, `review/stop` (and related)
- MCP server lifecycle: `mcpServers/list`, oauth login handshake methods, etc.

## Why this pairs well with `framework-shells`
`framework-shells` already solves the painful stuff on mobile:
- start/stop/reconnect for long-lived subprocesses
- optional sandbox policies per “shell”
- stream I/O and events over WS to the browser

The Codex app-server can be “just another managed process”:
- TE2 owns lifecycle and transport.
- Codex app-server owns agent logic + tool protocol.

## Proposed architecture (minimal, practical)

### 0) Two run modes (stand-alone vs app-extension)
Both modes share the same “core bridge” (stdio JSON-RPC, event stream, approval UX), but differ in how project + preferences SSOT is provided.

1) **stand-alone**
   - Runs as its own TE2 “app worker” (same pattern as `file_editor_cm6`).
   - Owns its own minimal “project picker” / “recent projects” UX (or reads from adapters).

2) **app-extension**
   - Hosted inside another app (initial target: Code CM6) via iframe (or future in-drawer embed).
   - Host app provides/overrides “active project” and other routing via an adapter (flag-controlled).

### A) TE2 runs `codex app-server` under `framework-shells`
- Start command: `codex app-server` (plus env/config for storage/auth).
- Treat it as a long-lived process keyed by “workspace/project”.
- Prefer **pipes/stdin+stdout** (not PTY/dtach):
  - JSONL framing is much safer over pipes than a PTY (no tty line discipline surprises).
  - dtach is great for interactive shells, but is unnecessary for a structured stdio protocol.

### A2) SSOT adapters (project + preferences)
Match the existing Code CM6 pattern:
- Project SSOT: project-scoped history (analogous to `_history_store`).
- Global prefs SSOT: global preferences (analogous to `_preferences_store`).

Implementation idea:
- Define two thin interfaces (Python protocols) that can be backed by:
  - Code CM6 stores (direct import/use) when embedded, or
  - stand-alone on-disk stores when running as its own app worker.
- Add a flag (env var or app config) selecting adapter mode:
  - “use local stores” vs “defer to host-provided project routing”.

### B) A small “bridge” inside TE2
Purpose: translate between:
- browser UI (WS/SSE/HTTP) ↔ TE2 backend ↔ Codex app-server (stdio JSONL)

Responsibilities:
- Maintain a per-client JSON-RPC request `id` counter and response routing.
- Forward server notifications/events to the browser as-is (avoid “smart” frontend).
- Persist minimal state server-side for reconnect:
  - last known thread id / active turn id
  - last “active view” (e.g., which thread the user is watching)
  - buffered tail of recent events (so reconnect doesn’t look empty)
  - optional: map “active thread” ↔ “active project” (so reveal/restore feels natural)

Non-goals:
- No agent logic in TE2.
- No frontend state machine beyond display + input capture.

### C2) Entry points / embedding strategy
Keep a “drop-in shim” for host apps:
- `app.py` (or similar): exported `router` + `init(app, adapters, config)` for embedding in another FastAPI app.
- `main.py`: stand-alone worker launcher + minimal pages (project picker, auth bootstrap page).

### D) Auth bootstrap (minimal)
If `account/read` indicates “no auth present” and `requiresOpenaiAuth: true`:
- Show a minimal front page offering:
  - API key login (`account/login/start` with `{ type: "apiKey" }`)
  - ChatGPT login (`account/login/start` with `{ type: "chatgpt" }`) and instructions to open `authUrl`
  - Optional: base URL / provider configuration if applicable

### C) UI options
Two reasonable UI strategies:

1) **FastHTML mini-app**
   - Server-rendered UI with HTMX for incremental updates.
   - Still uses a WS (or SSE) for streaming deltas.
   - Good fit for “mini app inside TE2” without pulling in heavy JS frameworks.

2) **Plain TE2 templated page + minimal JS**
   - Probably fastest initial integration; keep the UI mostly declarative.
   - JS only for:
     - opening WS
     - writing event stream to DOM
     - sending user actions back as JSON-RPC requests

### E) Hints protocol (optional, but likely useful)
Add two “hint” layers that are **JSON-only** and safe to ignore:

1) **UI hints** (client rendering only)
   - How to present deltas and approvals (colors, badges, “edited/removed” cues).
   - Example: annotate item rendering with extra strings (labels) without changing Codex semantics.

2) **Server hints** (how the host wants Codex driven)
   - Default sandboxPolicy / approvalPolicy overrides (per project or per session).
   - Comments/mentions mapping (if TE2 wants special handling for @mentions or review targets).
   - “Reveal to file” or “open diff view” affordances surfaced as capability flags.

## Message flow sketch

### Startup
1. Browser loads Codex mini-app page.
2. Browser opens WS to TE2 endpoint (e.g. `/ws/codex_app_server/{project_id}`).
3. TE2 ensures `codex app-server` process exists (launch/reattach).
4. TE2 sends `initialize` JSON-RPC request to app-server (if needed).
5. TE2 sends `initialized` JSON-RPC notification to app-server.
6. TE2 forwards notifications/events to browser.

### Running a turn
1. Browser sends JSON-RPC request: `turn/start` (or related) via TE2 WS.
2. TE2 writes the request to app-server.
3. App-server emits:
   - `turn/started`, item lifecycle notifications
   - streaming deltas (`agent_message_delta`, `exec_command_output_delta`, `turn_diff`, etc.)
4. Browser renders stream.

### Approval gate
1. App-server emits one of the `ServerRequest` approval methods.
2. Browser renders an “approve/deny” modal.
3. Browser sends approval response back to TE2 → app-server.

### Reconnect
1. Browser reconnects WS.
2. TE2 replays last N buffered events + current thread summary.
3. User can continue without refreshing the whole page.

## Security / sandbox notes
- The app-server protocol clearly anticipates approvals for exec and patch/file operations.
- TE2 should be able to set a default sandbox policy for the app-server shell (and/or per `command/exec` if the protocol supports it).
- Keep the “approval UX” server-owned (TE2) so it remains consistent with TE2’s security posture.

## Implementation plan (smallest working slice)
1. Add a new TE2 “app” page for Codex app-server UI (basic event log + input box).
2. Add TE2 backend bridge:
   - create/attach app-server process in `framework-shells` (pipes, not PTY)
   - JSONL reader loop: parse one JSON object per line, route to subscribers
   - WS endpoint: forward JSON-RPC in/out
3. Implement handshake: `initialize` request + `initialized` notify.
4. Implement `thread/start`, `thread/resume`, `thread/list`, `turn/start`, `turn/interrupt`, `command/exec`.
5. Add approval prompt UI for `item/commandExecution/requestApproval` first; then `item/fileChange/requestApproval`.
6. Add reconnect buffering (ring buffer of last N events) + “resume view” semantics.
7. Expand UI: diff view from `turn/diff/updated`, plan view from `turn/plan/updated`, history view from `thread/list`, MCP status/auth panels.
8. Add auth UI: `account/read`, `account/login/start/cancel`, `account/logout`, rate-limit display.

## Open questions (need quick validation)
1. Where should TE2 scope Codex’s on-disk rollout storage: global per-user, or per-project/worktree?
2. Adapter contract: which fields must the “project SSOT” provide (active project, recent projects, last thread id per project)?
3. Default thread selection: last-used thread per project, or “always new unless user picks from history”?
4. Mobile auth flows: best UX for ChatGPT login callback (new tab vs in-app webview vs external browser)?
5. Hints protocol: which hints belong to UI-only vs server-driving policy, and how to version them?
