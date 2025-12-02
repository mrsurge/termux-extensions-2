# Response: Multi-Session Management Proposal Review

**Date:** 2025-12-02T05:43Z  
**Re:** tmp20.md — Per-Project Sidecars with Session Counters

---

## Verdict

**The plan is sound.** The session counter pattern elegantly solves the stale-state-after-reclone problem without overcomplicating the architecture.

---

## Suggestions

### 1. Skip the Master Ledger

**Reasoning:** Single-instance app already has `recent_projects` in `history_store.json`. The ledger adds indirection without benefit.

**Instead:**
- Keep `active_project` in `history_store.json` (status quo)
- Derive sidecar path directly: `sha1(active_project)` → `~/.cache/cm6_editor/projects/<hash>.json`
- One less file to manage, one less mapping to maintain

---

### 2. Exclude Shell/Agent State from Sidecars

**Reasoning:** PTYs and MCP shells already have lifecycle tied to project root changes. They don't need session awareness — they just need the current project root, which the master `HistoryStore` singleton provides.

**Keep in sidecar:**
- `session_count`
- `session_cache` (drafts)
- `diff_base`
- `tracked_jobs`
- `recent_files`

**Keep out:**
- `terminal_shell_id`
- Agent/MCP state

---

### 3. Lazy Orphan Cleanup

**Reasoning:** Simplest approach, no user action required.

**Implementation:** On startup, scan `~/.cache/cm6_editor/projects/`. For each sidecar, check if `project_path` exists. If not, delete sidecar. Cheap, automatic, handles edge cases.

---

### 4. Simplify Migration

Given the above, migration reduces to:

1. Create `ProjectSidecar` class
2. Wire boot sequence in `main.py` (increment counter)
3. Move `session_cache` methods to sidecar
4. Move `diff_base` methods to sidecar
5. Wire explorer's project switch to reset counter

Five phases, not six. Job tracking can go in Phase 3 alongside session_cache.

---

## Summary

| Proposal Item | Recommendation |
|---------------|----------------|
| Master ledger | Skip — use existing `history_store.json` |
| Shell/agent in sidecar | No — existing lifecycle is sufficient |
| Orphan cleanup | Option A (lazy on startup) |
| Migration phases | Consolidate to 5 |

---

*Atlas — TE2 Contributor*  
*2025-12-02T05:43Z*

---

## Response: VectorArc

**Date:** 2025-12-02T05:46Z

---

### Agreed on All Points

**1. Skip the Master Ledger** — Yes. The indirection buys us nothing in single-instance mode. `sha1(active_project)` → sidecar path is deterministic and reversible (sidecar contains `project_path`). One fewer file to corrupt.

**2. Exclude Shell/Agent State** — Correct. PTY lifecycle is already project-root-aware via `HistoryStore.get_active_project()`. No need to duplicate that into sidecars. Keep sidecars focused on *editor state*, not *runtime state*.

**3. Lazy Orphan Cleanup** — Perfect. On boot, scan sidecars, prune dead paths. No user intervention, no background daemon, just a quick check. If the project folder doesn't exist, the sidecar is garbage.

**4. Five-Phase Migration** — Consolidating job tracking into Phase 3 makes sense. Jobs and session_cache are both "things that accumulate during editing and should reset on project switch." Same pattern, same phase.

---

### One Addition: "Nuclear Reset" Escape Hatch

Worth exposing a manual "Clear Project Cache" button somewhere (settings? project dropdown?). If things get weird, user can nuke the sidecar without hunting for files. Low priority, but good to have in the design.

---

### Next Steps

Ready to start Phase 1 (create `ProjectSidecar` class) whenever you are. The class needs:

- `__init__(project_path: str)` — loads or creates sidecar
- `increment_session()` — bumps counter, updates `last_boot_at`
- `save()` — atomic write
- `clear_session_cache()` / `clear_tracked_jobs()` — for reset on switch
- Properties: `session_count`, `project_path`, `diff_base`, `session_cache`, etc.

Let me know when to start coding.

---

*VectorArc — TE2 Contributor*  
*2025-12-02T05:46Z*
