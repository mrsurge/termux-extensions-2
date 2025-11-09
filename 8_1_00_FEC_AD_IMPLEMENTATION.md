# 8_1_00_FEC_AD – Implementation Alignment Analysis

> **Status:** Gap analysis vs. 8_0_30_FEC_AD architecture (2025-11-08)

---

## Executive Summary

The current codebase already implements most of the Socket.IO-based architecture, but a few critical behaviors still diverge from the canonical `docs/apps/code_cm6/AGENT_DRAWER.md` flow. The remaining work falls into three buckets:

1. **Backend parity fixes** – make IPC and legacy WebSocket handlers treat system messages, transcripts, and context flags identically.  
2. **Single transcript builder** – both transport paths must rely on the same `build_transcript()` helper so restoration logic never diverges.  
3. **Socket.IO client visibility** – surface clear diagnostics when the CDN-hosted Socket.IO client fails to load so operators can troubleshoot quickly.

---

## 1. Component-Level Findings

### 1.1 Socket.IO Agent Namespace (`app/apps/file_editor_cm6/ipc_stack/agent_handler.py`)

| Area | Status | Details / Required Change |
|------|--------|---------------------------|
| Shell lifecycle | ✅ | Uses `/api/internal/shells/*` exactly as required. |
| Request/session map | ✅ | Maintains `_state_lock` maps and emits events with explicit `session`. |
| System persistence | ⚠️ | Persists only when `normalized.get("complete")` is true. **Action:** persist every system chunk (matching doc). |
| Transcript restore | ⚠️ | Prepends transcript text but does not set `context["base_instructions"]`. **Action:** when `needs_restore=True`, add `base_instructions` to context before calling `CodexAdapter.to_agent`. |
| Transcript builder | ⚠️ | Uses `build_transcript()` from IPC stack; legacy handler uses a different helper. **Action:** expose this helper for both paths to avoid divergent behavior. |

### 1.2 Legacy WebSocket Handler (`app/apps/file_editor_cm6/agent_ws.py`)

| Area | Status | Details / Required Change |
|------|--------|---------------------------|
| System persistence | ⚠️ | Same conditional persistence issue as IPC handler. **Action:** persist every system message. |
| Transcript builder | ⚠️ | Uses `_build_history_payload()` inline. **Action:** import the shared `build_transcript()` helper. |
| `base_instructions` | ❌ | Does not set `base_instructions` in context when restoring. **Action:** mirror the IPC logic. |

### 1.3 Frontend Drawer (`app/apps/file_editor_cm6/static/js/agent_drawer.js`)

| Area | Status | Details / Required Change |
|------|--------|---------------------------|
| Transport default | ✅ | `connectSharedShell()` already uses Socket.IO as the primary transport. |
| Client availability | ⚠️ | Socket.IO client is loaded lazily from a CDN; if that request fails the drawer can’t connect. **Action:** keep the CDN loader but add explicit logging/toasts so the failure is obvious and documented. |
| Session rendering | ✅ | Reads messages exclusively from backend REST APIs. |

### 1.4 Shared Utilities

- `CodexAdapter` already emits `system` events for `agent_reasoning` and `task_started`, so no change needed.  
- `agent_session_store` fully matches the desired persistence semantics.

---

## 2. Gap-to-Fix Mapping

| # | Gap | Impact | Required Work |
|---|-----|--------|---------------|
| 1 | Conditional system persistence | Backend transcripts miss reasoning blocks, violating “backend owns everything”. | Remove the `normalized.get("complete")` guard in both IPC and WebSocket handlers so every `system` event is appended before emit. |
| 2 | Missing `base_instructions` during restore | Restored conversations may lose context cues expected by Codex. | When `needs_restore=True`, set `context["base_instructions"] = base_instr` alongside the transcript injection in both handlers. |
| 3 | Divergent transcript helpers | Restoration logic may drift if two helpers evolve differently. | Replace `_build_history_payload()` with the IPC `build_transcript()` helper (exported to a shared module) so both paths format history identically. |
| 4 | Socket.IO client availability | Drawer fails outright if CDN script doesn’t load. | Improve telemetry and user guidance around the CDN dependency (e.g., descriptive toast, console error) so troubleshooting is straightforward. |

---

## 3. Recommended Implementation Plan

1. **Unify transcript helper**  
   - Move `build_transcript()` into a shared module (e.g., `app/apps/file_editor_cm6/conversation_utils.py`).  
   - Import it from both `ipc_stack/agent_handler.py` and `agent_ws.py`.

2. **Persist every system message**  
   - In both handlers, append `type="system"` entries regardless of the `complete` flag; if the backend wants to collapse events later, it can do so after persistence.

3. **Inject base instructions**  
   - During `needs_restore`, set `context["base_instructions"]` from the helper’s return value before calling `CodexAdapter.to_agent`.

4. **Document/monitor Socket.IO client dependency**  
   - Keep the current CDN loader but add explicit logging/toasts (e.g., “Socket.IO client download failed”) so the dependency is well understood and easy to diagnose.

---

## 4. Validation Checklist

After making the changes above:

- [ ] Start the framework, open the drawer, and confirm Socket.IO connects (or that CDN failures produce the new diagnostics).  
- [ ] Send a prompt, then inspect `~/.codex/agent_sessions/sessions.json` to ensure every reasoning block is persisted as `type: "system"`.  
- [ ] Force a shell restart (kill the Codex shell), send another prompt, and verify the transcript injection uses the shared format and sets `base_instructions`.  
- [ ] Confirm the WebSocket fallback (if still enabled for diagnostics) behaves identically by manually visiting `/ws/app/file_editor_cm6/agent` through the proxy.

---

## 5. Conclusion

The overall architecture is solid: Socket.IO is already the production transport, backend APIs own shell lifecycle, and the session store captures authoritative state. The remaining work is surgical—ensure both transport paths use identical transcript/persistence logic and make the Socket.IO CDN dependency transparent/observable so operators can spot issues immediately. Completing those tasks will align the live implementation fully with `8_0_30_FEC_AD` and the canonical documentation.
