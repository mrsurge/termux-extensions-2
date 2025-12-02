# Project State Management Architecture

**Date:** 2025-12-02  
**Status:** Proposal / Design Sketch

---

## Problem Statement

Currently the system has:
- One monolithic `history_store.json` tracking all projects
- Session cache sidecars per-file, but no per-project isolation
- No clear "project session boundary" - when you delete and re-clone the same path, stale state persists
- Job events, diff bases, and cached documents from old sessions contaminate new ones

**Result:** After nuking and re-cloning a repo to the same path, the editor assumes "business as usual" and looks for files that don't exist yet, tries to resume stale jobs, etc.

---

## Solution: Per-Project Sidecars with Session Counters

### Core Concept

Each project gets its own sidecar file. The sidecar contains:
- Session counter (incremented on each editor cold boot)
- Project-specific cached documents
- Project-specific diff base
- Project-specific job tracking
- Any other project-scoped state

When `session_count == 1`, we know this is a fresh start and any stale caches should be cleared.

---

## Architecture

### File Structure

```
~/.cache/cm6_editor/
├── master_ledger.json          # Maps project paths → sidecar hashes
└── projects/
    ├── <sha1_hash_1>.json      # Sidecar for /home/user/project-a
    ├── <sha1_hash_2>.json      # Sidecar for /home/user/project-b
    └── ...
```

### Master Ledger Schema

```json
{
  "version": 1,
  "active_project": "/data/data/com.termux/files/home/git-clone/termux-extensions-2",
  "projects": {
    "/data/data/com.termux/files/home/git-clone/termux-extensions-2": {
      "sidecar_hash": "a1b2c3d4e5f6...",
      "last_accessed": "2025-12-02T05:00:00.000Z"
    },
    "/data/data/com.termux/files/home/mrselect": {
      "sidecar_hash": "f6e5d4c3b2a1...",
      "last_accessed": "2025-12-01T22:00:00.000Z"
    }
  }
}
```

### Project Sidecar Schema

```json
{
  "version": 1,
  "project_path": "/data/data/com.termux/files/home/git-clone/termux-extensions-2",
  "session_count": 3,
  "created_at": "2025-12-01T10:00:00.000Z",
  "last_boot_at": "2025-12-02T05:00:00.000Z",
  
  "diff_base": {
    "ref": "HEAD",
    "commit_sha": "e891f27feeb9526b39f7a36ce189d828edcc2c39"
  },
  
  "session_cache": {
    "<file_cache_key>": {
      "content": "...",
      "content_sha256": "...",
      "base_sha256": "...",
      "unsaved": true,
      "run_id": "...",
      "updated_at": "..."
    }
  },
  
  "tracked_jobs": ["job-abc123", "job-def456"],
  
  "recent_files": [
    "src/main.py",
    "README.md"
  ]
}
```

---

## Component Responsibilities

### 1. main.py - The "Clock"

**Role:** Ticks the session counter on every cold boot

**Boot Sequence:**
```
1. Read master_ledger.json
2. Get active_project path
3. Compute sidecar hash for that path
4. Load or create sidecar at ~/.cache/cm6_editor/projects/<hash>.json
5. Increment session_count in sidecar
6. If session_count == 1:
     - This is first boot after project switch
     - Clear any stale session_cache entries
     - Clear tracked_jobs
7. Save sidecar
8. Set module-level _active_project_store = loaded sidecar
9. Continue with normal editor initialization
```

**Key Function:**
```python
def initialize_project_session() -> ProjectSidecar:
    """Called once at editor boot. Returns the active project's sidecar."""
    ledger = load_master_ledger()
    project_path = ledger.get("active_project")
    
    if not project_path:
        # No project selected yet - return empty/default sidecar
        return ProjectSidecar.empty()
    
    sidecar = load_or_create_sidecar(project_path)
    sidecar.increment_session()
    
    if sidecar.session_count == 1:
        # Fresh project switch - clear stale state
        sidecar.clear_session_cache()
        sidecar.clear_tracked_jobs()
    
    sidecar.save()
    return sidecar
```

### 2. explorer (WebSocket handlers) - The "Gatekeeper"

**Role:** Triggers sidecar creation/reset on project switch

**Project Open Flow:**
```
1. User selects "Open Project" or "Clone Repository"
2. Explorer validates target path
3. Explorer calls: reset_project_session(new_project_path)
     - Updates master_ledger.active_project
     - Creates new sidecar (or loads existing)
     - Sets session_count = 0 (so next boot sees 1)
     - Clears all project-specific caches
4. Explorer emits project:opened
5. (Optional) Trigger page reload, or just let main.py pick up on next interaction
```

**Key Function (in explorer_ws.py or stores.py):**
```python
def reset_project_session(new_project_path: str) -> None:
    """Called when user explicitly switches projects."""
    ledger = load_master_ledger()
    
    # Update active project
    ledger["active_project"] = new_project_path
    
    # Get or create sidecar for new project
    sidecar = load_or_create_sidecar(new_project_path)
    
    # Reset session count to 0 - next boot will see 1 and know it's fresh
    sidecar.session_count = 0
    sidecar.clear_session_cache()
    sidecar.clear_tracked_jobs()
    sidecar.save()
    
    save_master_ledger(ledger)
    
    # Update module-level reference
    global _active_project_store
    _active_project_store = sidecar
```

### 3. Other Components - Just Use get_project_store()

**Pattern:**
```python
from app.apps.file_editor_cm6.stores import get_project_store

def some_function():
    store = get_project_store()
    
    # Read/write project-specific state
    diff_base = store.get_diff_base()
    store.set_diff_base("HEAD")
    
    cached = store.get_cached_document(file_path)
    store.upsert_cached_document(file_path, content, ...)
```

Components don't need to know about:
- Which project is active
- Where the sidecar lives
- Session counting logic

They just call `get_project_store()` and trust it returns the right thing.

---

## State Transitions

### Normal Editor Boot (Same Project)
```
session_count: 5 → 6
Action: Just increment, keep all caches
```

### Project Switch via Explorer
```
Old project session_count: 6 (unchanged)
New project session_count: 0 → (next boot) 1
Action: Clear caches, start fresh
```

### Delete + Re-clone Same Path
```
Before delete: session_count = 5
After clone: session_count reset to 0 by explorer
Next boot: session_count = 1, caches cleared
```

### Crash Recovery
```
session_count: 5 → 6 (still increments)
Session cache has run_id mismatch → show "recovered from crash" toast
No cache clearing needed - same project, just crashed
```

---

## Migration Path

### Phase 1: Introduce ProjectSidecar class
- Create new `ProjectSidecar` class alongside existing `HistoryStore`
- Implement basic load/save/increment
- Keep existing HistoryStore working

### Phase 2: Wire main.py boot sequence
- Add `initialize_project_session()` call at boot
- Set up `get_project_store()` getter
- Existing code still uses HistoryStore

### Phase 3: Migrate session_cache to sidecar
- Move `get_cached_document`, `upsert_cached_document`, `clear_cached_document` to ProjectSidecar
- Update callers to use `get_project_store().get_cached_document(...)`
- Remove from HistoryStore

### Phase 4: Migrate diff_base to sidecar
- Move `get_diff_base`, `set_diff_base` to ProjectSidecar
- Update callers

### Phase 5: Migrate job tracking to sidecar
- Track job IDs per-project
- Clear on project switch

### Phase 6: Wire explorer project switch
- Add `reset_project_session()` calls to open/create/clone flows
- Test full cycle: open → edit → switch → re-open

---

## Open Questions

1. **Sidecar hash collision?** SHA1 of project path should be unique enough, but worth considering.

2. **Orphaned sidecars?** If user deletes a project folder, sidecar remains. Cleanup strategy?
   - Option A: Lazy cleanup on ledger read (prune entries where path doesn't exist)
   - Option B: Manual "clear all caches" button
   - Option C: Don't worry about it (disk is cheap)

3. **Multi-window?** If two browser tabs have the same project open, they share the sidecar. Session count increments twice. Is that a problem?
   - Probably fine - both tabs see session_count > 1, neither clears cache

4. **Master ledger corruption?** If ledger is corrupted, we lose the project → sidecar mapping.
   - Mitigation: Sidecar contains `project_path`, so we could rebuild ledger by scanning sidecars

---

## Summary

| Component | Role | Reads | Writes |
|-----------|------|-------|--------|
| main.py | Tick session counter on boot | master_ledger, sidecar | sidecar |
| explorer | Trigger project switch, reset session | master_ledger | master_ledger, sidecar |
| editor_app | Read/write session cache | sidecar | sidecar |
| git_helper | Read/write diff base | sidecar | sidecar |
| job handlers | Track jobs per-project | sidecar | sidecar |

**Key Insight:** The session counter lives in the sidecar, travels with the project. `session_count == 1` means "first boot after switch, clear stale state."

**Delete the sidecar = nuclear option.** Everything about that project is gone, clean slate guaranteed.
