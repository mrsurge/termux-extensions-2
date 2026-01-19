# Cross‑Message Agent Workflow

This doc tracks the “when needed” multi‑agent workflow for TE2 / `file_editor_cm6`, including conversation IDs and how to message agents via MCP.

## Agents + Conversation IDs

| Role | Pseudonym | Conversation ID |
|---|---|---|
| Orchestrator (you’re talking to) | `vectorArc` | `f8d5ddb8c0e34d329da6eca9f5138cd3` |
| Specialist: `persistence-drafts` | (TBD) | `813c7c8657d24f0d872c95262b53108e` |

Notes:
- The `persistence-drafts specialist` entry was provided twice; it’s treated as a single agent.

## Responsibilities (by boundary)

### Orchestrator (`vectorArc`)
Owns cross‑domain coordination, interface contracts, and final integration decisions.

Primary surfaces:
- SSOT contracts: active file, autosave vs drafts, broadcast rules, “author cursor must not be clobbered”
- Interface shapes: explorer bus event names/payloads, host↔iframe postMessage shapes, sidecar schema expectations

Key paths (common touchpoints):
- `app/apps/file_editor_cm6/main.js` (host shell; bridge events, drawers, menus, editor iframe messaging)
- `app/apps/file_editor_cm6/static/js/explorer.js` (explorer UI; consumes bus events like `draft:content`, `autosave:content`)
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` (NiceGUI editor backend; persistence + broadcasts)
- `app/static/vendor/nicegui/elements/codemirror/codemirror.js` (iframe CM6 behaviors; mirror apply; emits `cm6-cache-state`)

### Specialist: `persistence-drafts`
Owns correctness + performance around persistence, drafts/autosave state machine, and sidecar flows.

Primary surfaces:
- Draft sidecars / history store interactions
- Autosave write flows + live propagation
- Cache-state payload composition, debouncing, and “who gets updated when”
- Watching strategies (watchdog vs polling) and no‑blocking invariants

Key paths:
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`
- `app/apps/file_editor_cm6/core_read.py`
- `app/apps/file_editor_cm6/core_write.py`
- `app/apps/file_editor_cm6/history_store/` (if present; history + sidecar logic)
- `docs/apps/code_cm6/TECHNICAL.md`

## When to enlist the specialist

Use `persistence-drafts` when issues involve any of:
- delayed or inconsistent SSOT propagation (e.g., settings taking ~20s to show on other clients)
- draft/autosave correctness, cache invalidation, debouncing, race conditions
- watcher behavior and unexpected directory scans
- “cursor jump” regressions caused by destructive re-application of content

## MCP: How to message an agent

### Send a message (fire-and-forget)
Use `functions.mcp__agent-pty-blocks__agent_send_message` with:
- `conversation_id`: the target agent’s conversation ID (table above)
- `reply_to`: your current conversation ID (so they can reply back here)
- `repo`: the repo root they should assume
- `pseudonym`: who you are sending as (e.g., `vectorArc`)
- `model`: the model string you want them to use
- `subject`: short topic line
- `message`: the actual instructions + context

Minimal payload shape:
```json
{
  "conversation_id": "813c7c8657d24f0d872c95262b53108e",
  "reply_to": "f8d5ddb8c0e34d329da6eca9f5138cd3",
  "repo": "/data/data/com.termux/files/home/mrselect5",
  "pseudonym": "vectorArc",
  "model": "gpt-5.2",
  "subject": "Investigate SSOT settings delay (~20s)",
  "message": "Please locate the delay source for SSOT preference propagation (likely debounce/timer). Focus on editor_app.py cache-state emission paths + update_preference; propose minimal fix."
}
```

### Send + await reply
Use `functions.mcp__agent-pty-blocks__agent_send_message_await` to send the message and block until the agent replies (or times out). Set `timeout_ms` as needed.

### Read the agent log (optional)
If coordinating multiple agents, use:
- `functions.mcp__agent-pty-blocks__agent_log_inbox` (quick preview)
- `functions.mcp__agent-pty-blocks__agent_log_read` (full text for recent messages)

