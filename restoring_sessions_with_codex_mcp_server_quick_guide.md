# Restoring Sessions with `codex‑mcp‑server` — Quick Guide

Single‑user, localhost, Flask backend, vanilla JS frontend. Goal: regain conversation context after any restart (browser refresh, Flask reload, or MCP server restart).

---

## 0) Terminology
- **conversation_id**: The Codex conversation identifier (returned on first successful turn). Persist this.
- **session**: Your UI/bridge notion (tab/window). Maps to the same `conversation_id` until the user explicitly starts over.
- **bridge**: Your small process that spawns Codex / codex‑mcp‑server and relays JSON (stdio ⇄ WS/SSE/REST).

---

## 1) Minimum data to persist
Store these **per editor workspace**:
- `conversation_id` (string)
- `created_at` (ISO8601)
- `model` (e.g., `gpt‑5‑codex`)
- `sandbox/approval profile` (so you can re‑spawn with identical policy)
- `cwd` (workspace path)
- `title/summary` (first line for display)

Storage options (pick one):
- Local file (JSON) under your user data dir
- SQLite row keyed by `workspace_id`
- Browser `localStorage` **plus** server copy (authoritative)

---

## 2) Lifecycle patterns

### A) First message (no conversation_id yet)
1. Spawn **codex‑mcp‑server** and wait for ready.
2. Send your first user turn.
3. Extract the **`conversation_id`** from the tool’s first response/metadata.
4. Persist the mapping `{ workspace_id → conversation_id }`.

### B) Normal chat (conversation_id known)
- Include `conversation_id` in your bridge’s call to the MCP wrapper on every subsequent turn.

### C) After any restart (browser or backend)
1. Load `{ workspace_id → conversation_id }`.
2. Ensure **exact same policy** as the original spawn (approval/sandbox) when starting the MCP server/agent.
3. Perform a **resume probe**:
   - Send a lightweight “context check” (e.g., ask for the last message or a no‑op info call if the wrapper exposes it), **or** send the next user turn **with** `conversation_id` attached.
4. If the wrapper responds **not found/expired**:
   - Start a **new conversation** and attach a **condensed summary** you’ve stored (or re‑derive from your message log), then persist the new `conversation_id`.

---

## 3) Frontend/Bridge message shapes (minimal)
> All are **single‑line JSON** per message.

### Send turn (new)
```
{"id":"1","action":"chat","text":"Explain X","cwd":"/proj","policy":"workspace-write"}
```

### Send turn (resume)
```
{"id":"2","action":"chat","text":"Continue…","conversation_id":"CONV-1234","cwd":"/proj"}
```

### Bridge → UI streamed events
```
{"id":"2","event":"token","text":"partial…"}
{"id":"2","event":"final","ok":true,"meta":{"conversation_id":"CONV-1234"}}
```

### Error (not found)
```
{"id":"2","event":"error","code":"conversation_not_found","message":"Conversation expired"}
```

---

## 4) Routing logic (pseudo‑flow)
1. **On page load**: query `/state` → `{ conversation_id? }`.
2. **If present**: open WS/SSE stream; send a **resume turn** including `conversation_id`.
3. **If missing/invalid**: start a new turn; on first `final`, persist `conversation_id`.
4. Always treat the **latest `conversation_id` seen on responses** as authoritative (in case the wrapper rotates IDs).

---

## 5) Failure modes & guardrails
- **Process died**: your bridge respawns MCP and retries the last turn **once** with `conversation_id`.
- **Policy drift**: if approval/sandbox differs from original, Codex may alter behavior; always respawn with the same profile.
- **User “New Chat”**: clear `conversation_id` for that workspace and start fresh.
- **Large history**: keep a **client‑side compressed summary** so you can reconstruct context if the wrapper can’t resume.

---

## 6) Quick checklist
- [ ] Persist `conversation_id` as soon as it appears.
- [ ] Tie it to `workspace_id` and `cwd`.
- [ ] Re‑spawn MCP with the same policy.
- [ ] Send next turn with `conversation_id` on reconnect.
- [ ] Fallback: new conversation + summarized history.

---

## 7) Example persistence record (server‑side)
```
{
  "workspace_id": "/home/user/project",
  "conversation_id": "CONV-1234",
  "model": "gpt-5-codex",
  "policy": {"approval": "never", "sandbox": "workspace-write"},
  "cwd": "/home/user/project",
  "created_at": "2025-10-31T10:15:00Z",
  "title": "Refactor router"
}
```

---

## 8) UX nits that reduce friction
- Show a small “resumed from CONV‑####” chip after reconnect.
- Offer a one‑click “Detach & New Chat” that clears the mapping and starts fresh.

---

**Bottom line:** Treat `conversation_id` as the primary key, persist it per workspace, always include it on turns after reconnect, and respawn the MCP server with the same policy profile to avoid drift. If resume fails, seed a new conversation with your stored summary.

