# Multi-Project Session Management Implementation

**Date:** 2025-12-02 to 2025-12-03  
**Context:** Code CM6 (`file_editor_cm6`)  
**Status:** Complete — PR merged to main

This document consolidates the planning, discussion, and implementation notes for the multi-project session management refactor.

---

## Table of Contents

1. [Initial Plan (tmp20)](#1-initial-plan)
2. [Atlas Response & Discussion (tmp21)](#2-atlas-response--discussion)
3. [Revised Plan v2 (tmp22)](#3-revised-plan-v2)
4. [Implementation Notes Part 1 (tmp23)](#4-implementation-notes-part-1)
5. [Implementation Notes Part 2 (tmp24)](#5-implementation-notes-part-2)
6. [Finalization Plan & Status (tmp25)](#6-finalization-plan--status)

---

# 1. Initial Plan

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

---

# 2. Atlas Response & Discussion

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

---

# 3. Revised Plan v2

# Project Session Management — Final Implementation Plan

**Date:** 2025-12-02T05:50Z  
**Status:** Approved for Implementation  
**Contributors:** VectorArc, Atlas

---

## Problem Statement

When a project is deleted and re-cloned to the same path, stale session caches, diff bases, and job tracking from the old project contaminate the new one. There is no "project session boundary" — the editor assumes continuity when there is none.

---

## Solution: Per-Project Sidecars with Session Counters

Each project gets a dedicated sidecar file. A session counter detects fresh starts and triggers cache cleanup.

---

## Architecture

### File Structure

```
~/.cache/cm6_editor/
└── projects/
    ├── <sha1_hash_1>.json      # Sidecar for /home/user/project-a
    ├── <sha1_hash_2>.json      # Sidecar for /home/user/project-b
    └── ...
```

**No master ledger.** The existing `history_store.json` remains the source of truth for `active_project` and `recent_projects`. Sidecar path is derived deterministically: `sha1(project_path)` → filename.

### Sidecar Schema

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

### What Lives Where

| Data | Location | Reason |
|------|----------|--------|
| `active_project` | `history_store.json` | Global singleton, drives PTY/agent lifecycle |
| `recent_projects` | `history_store.json` | Cross-project, needed for project picker |
| `terminal_shell_id` | `history_store.json` | Runtime state, not editor state |
| `session_count` | Project sidecar | Per-project session boundary |
| `session_cache` | Project sidecar | Per-project drafts |
| `diff_base` | Project sidecar | Per-project comparison ref |
| `tracked_jobs` | Project sidecar | Per-project in-flight ops |
| `recent_files` | Project sidecar | Per-project MRU |

---

## Component Responsibilities

### 1. `main.py` — The Clock

**Role:** Increment session counter on every cold boot.

```python
def initialize_project_session() -> Optional[ProjectSidecar]:
    """Called once at editor boot. Returns the active project's sidecar."""
    project_path = _history_store.get_active_project()
    
    if not project_path or not Path(project_path).exists():
        return None
    
    sidecar = ProjectSidecar.load_or_create(project_path)
    sidecar.increment_session()
    
    if sidecar.session_count == 1:
        # Fresh project switch — clear stale state
        sidecar.clear_session_cache()
        sidecar.clear_tracked_jobs()
    
    sidecar.save()
    return sidecar
```

### 2. Explorer (WebSocket Handlers) — The Gatekeeper

**Role:** Reset session counter on explicit project switch.

```python
def reset_project_session(new_project_path: str) -> None:
    """Called when user explicitly switches projects."""
    # Update active project in master store
    _history_store.set_active_project(new_project_path)
    
    # Get or create sidecar for new project
    sidecar = ProjectSidecar.load_or_create(new_project_path)
    
    # Reset session count — next boot will see 1 and know it's fresh
    sidecar.session_count = 0
    sidecar.clear_session_cache()
    sidecar.clear_tracked_jobs()
    sidecar.save()
    
    # Update module-level reference
    global _active_project_sidecar
    _active_project_sidecar = sidecar
```

### 3. All Other Components — Use `get_project_sidecar()`

```python
from app.apps.file_editor_cm6.stores import get_project_sidecar

def some_function():
    sidecar = get_project_sidecar()
    if not sidecar:
        return  # No project active
    
    # Read/write project-specific state
    diff_base = sidecar.get_diff_base()
    sidecar.set_diff_base("HEAD~5")
    
    cached = sidecar.get_cached_document(file_path)
    sidecar.upsert_cached_document(file_path, content, ...)
```

---

## State Transitions

| Scenario | session_count | Action |
|----------|---------------|--------|
| Normal editor boot (same project) | 5 → 6 | Increment only, keep caches |
| Project switch via explorer | New project: 0 → (next boot) 1 | Clear caches on boot |
| Delete + re-clone same path | Reset to 0 by explorer | Clear caches on boot |
| Crash recovery | 5 → 6 | Keep caches, detect via `run_id` mismatch |

---

## Manual Reset: "Clear Project State"

**Location:** Edit menu  
**Guard:** Confirmation dialog

```
┌─────────────────────────────────────────┐
│  Clear Project State?                   │
│                                         │
│  This will discard:                     │
│  • Unsaved drafts                       │
│  • Diff base setting                    │
│  • Recent files list                    │
│  • Pending job tracking                 │
│                                         │
│  The project itself is not affected.    │
│                                         │
│         [Cancel]    [Clear State]       │
└─────────────────────────────────────────┘
```

**Implementation:**

```python
def clear_project_state(project_path: str) -> bool:
    """Delete the project sidecar entirely."""
    sidecar_path = ProjectSidecar.get_sidecar_path(project_path)
    if sidecar_path.exists():
        sidecar_path.unlink()
        return True
    return False
```

After clearing, next boot creates a fresh sidecar with `session_count = 1`.

---

## Orphan Cleanup

**When:** On startup, before loading active project sidecar.

**Logic:**
```python
def cleanup_orphaned_sidecars():
    """Remove sidecars for projects that no longer exist."""
    sidecar_dir = Path.home() / ".cache" / "cm6_editor" / "projects"
    if not sidecar_dir.exists():
        return
    
    for sidecar_file in sidecar_dir.glob("*.json"):
        try:
            data = json.loads(sidecar_file.read_text())
            project_path = data.get("project_path")
            if project_path and not Path(project_path).exists():
                sidecar_file.unlink()
        except Exception:
            pass  # Corrupt sidecar, leave it
```

---

## Migration Plan

### Phase 1: Create `ProjectSidecar` Class

**File:** `app/apps/file_editor_cm6/project_sidecar.py`

```python
class ProjectSidecar:
    VERSION = 1
    
    def __init__(self, project_path: str):
        self.project_path = str(Path(project_path).resolve())
        self._path = self.get_sidecar_path(self.project_path)
        self._data = self._default_data()
        self._load()
    
    @staticmethod
    def get_sidecar_path(project_path: str) -> Path:
        normalized = str(Path(project_path).resolve())
        hash_key = hashlib.sha1(normalized.encode()).hexdigest()
        return Path.home() / ".cache" / "cm6_editor" / "projects" / f"{hash_key}.json"
    
    @classmethod
    def load_or_create(cls, project_path: str) -> "ProjectSidecar":
        return cls(project_path)
    
    def _default_data(self) -> dict:
        return {
            "version": self.VERSION,
            "project_path": self.project_path,
            "session_count": 0,
            "created_at": _utc_timestamp(),
            "last_boot_at": None,
            "diff_base": {"ref": "HEAD", "commit_sha": None},
            "session_cache": {},
            "tracked_jobs": [],
            "recent_files": [],
        }
    
    def increment_session(self):
        self._data["session_count"] += 1
        self._data["last_boot_at"] = _utc_timestamp()
    
    @property
    def session_count(self) -> int:
        return self._data["session_count"]
    
    @session_count.setter
    def session_count(self, value: int):
        self._data["session_count"] = value
    
    def clear_session_cache(self):
        self._data["session_cache"] = {}
    
    def clear_tracked_jobs(self):
        self._data["tracked_jobs"] = []
    
    def save(self):
        # Atomic write with temp file
        ...
    
    def _load(self):
        # Load from disk if exists
        ...
```

### Phase 2: Wire Boot Sequence

**File:** `app/apps/file_editor_cm6/main.py`

- Call `cleanup_orphaned_sidecars()` on module load
- Call `initialize_project_session()` on module load
- Expose `get_project_sidecar()` in `stores.py`

### Phase 3: Migrate Session Cache + Job Tracking

- Move `get_cached_document`, `upsert_cached_document`, `clear_cached_document` to `ProjectSidecar`
- Move `tracked_jobs` logic from `ExplorerDispatcher` to sidecar
- Update callers to use `get_project_sidecar()`
- Remove old methods from `HistoryStore`

### Phase 4: Migrate Diff Base + Recent Files

- Move `get_diff_base`, `set_diff_base` to `ProjectSidecar`
- Move `recent_files` (per-project) to sidecar
- Keep `recent_projects` (global) in `HistoryStore`
- Update callers

### Phase 5: Wire Explorer Project Switch + UI

- Add `reset_project_session()` calls to open/create/clone flows in `explorer_ws.py`
- Add "Clear Project State" menu item in Edit menu
- Add confirmation dialog
- Test full cycle: open → edit → switch → re-open → manual clear

---

## Summary

| Component | Reads | Writes |
|-----------|-------|--------|
| `main.py` | `history_store`, sidecar | sidecar |
| `explorer_ws.py` | `history_store` | `history_store`, sidecar |
| `editor_app.py` | sidecar | sidecar |
| `git_helper.py` / `diff_helper.py` | sidecar | sidecar |
| Job handlers | sidecar | sidecar |

**Key Insight:** `session_count == 1` means "first boot after switch, clear stale state."

**Nuclear Option:** Delete sidecar file = guaranteed clean slate.

---

*Atlas — TE2 Contributor*  
*2025-12-02T05:50Z*

---

# 4. Implementation Notes Part 1

# Project Session Sidecars — Implementation Report (Phase 1–2.5)

**Date:** 2025-12-02  
**Scope:** Code CM6 (file_editor_cm6)  
**Status:** In Progress (Session sidecars + debug tooling landed)

---

## 1. Per-Project Sidecar Infrastructure

**File:** `app/apps/file_editor_cm6/project_sidecar.py`

- Implemented `ProjectSidecar` as the canonical per-project state container:
  - Stored under `~/.cache/cm6_editor/projects/<sha1(project_path)>.json`.
  - Normalizes project paths (`Path(...).expanduser().resolve(strict=False)`).
  - Schema fields:
    - `version`, `project_path`, `session_count`, `created_at`, `last_boot_at`
    - `diff_base`: `{ref, commit_sha}` (ref is authoritative; metadata is best-effort)
    - `session_cache`: map of file cache key → draft entry
    - `tracked_jobs`: job IDs associated with this project
    - `recent_files`: reserved for future MRU migration
- In-memory singleton cache:
  - `ProjectSidecar._instances: Dict[normalized_path, ProjectSidecar]`
  - `load_or_create(project_path)` reuses instances per normalized path.
- API surface:
  - Session counter:
    - `increment_session()` updates `session_count` and `last_boot_at`.
    - `session_count` is now **informational only** (no clearing keyed off its value).
  - Diff base:
    - `get_diff_base() -> str`
    - `set_diff_base(ref: Optional[str]) -> str`
  - Session cache:
    - `get_cached_document(file_path)`
    - `upsert_cached_document(file_path, content, base_sha256, run_id, shell_id, shell_run_id, launcher_pid, worker_pid)`
    - `clear_cached_document(file_path)`
    - `list_project_drafts()`
    - `clear_session_cache()`
  - Job tracking:
    - `add_tracked_job(job_id)`
    - `remove_tracked_job(job_id)`
    - `clear_tracked_jobs()`

**Rationale:** All per-project *ephemeral* state (drafts, diff base, tracked jobs) must live in one place keyed purely by `project_path`, decoupled from the global history ledger. This avoids cross-project contamination when paths are reused.

---

## 2. HistoryStore Integration (Session Cache + Diff Base)

**File:** `app/apps/file_editor_cm6/history_store.py`

- Session cache API (`HistoryStore`) now delegates to `ProjectSidecar`:
  - `get_cached_document(project_path, file_path)` → `ProjectSidecar.get_cached_document`.
  - `upsert_cached_document(...)`:
    - Logs a debug line with both base and content SHA.
    - Forwards to `ProjectSidecar.upsert_cached_document(...)` and `sidecar.save()`.
    - Falls back to an in-memory entry only if sidecar IO fails (edge case).
  - `clear_cached_document(project_path, file_path)`:
    - Uses `ProjectSidecar.clear_cached_document` and saves sidecar when it returns `True`.
  - `list_project_drafts(project_path)`:
    - Returns `ProjectSidecar.list_project_drafts()` (sidecar is SSOT for drafts).
  - `list_cached_documents(project_path)`:
    - Thin wrapper which currently returns `list_project_drafts(project_path)`.
- Diff base:
  - `set_diff_base(project_path, ref)`:
    - Writes the value into the project’s sidecar via `sidecar.set_diff_base(ref)` + `sidecar.save()`.
    - Also mirrors the value back into `history_store.json` for compatibility.
  - `get_diff_base(project_path)`:
    - Prefers sidecar’s `get_diff_base()`; logs a `(sidecar)` trace.
    - Falls back to `projects[project]["diff_base"]` if sidecar load fails; logs `(history)`.

**Result:** All existing callers (`/session_cache` API, NiceGUI editor, review overlays, explorer decorations, diff base controls) continue using `_history_store`, but the underlying persistence is per-project sidecars.

---

## 3. Session Counters & Boot Lifecycle

**File:** `app/apps/file_editor_cm6/main.py`

- `initialize_project_session()`:
  - Called once on worker import.
  - Behavior *after fix*:
    - Reads `active_project` from `_history_store`.
    - If the project exists, loads `ProjectSidecar`, calls `increment_session()`, and `save()`.
    - **Does NOT clear** `session_cache` or `tracked_jobs`.
  - Docstring explicitly warns:
    - Clearing per-project state is the responsibility of explorer-side `reset_project_session`.
    - A plain worker restart for the same project must *not* wipe drafts.
- Module-import side effects:
  - `_ensure_project_root_synced()` keeps in-memory explorer root in sync with stored `active_project`.
  - `cleanup_orphaned_sidecars()` removes any sidecars whose `project_path` no longer exists on disk.
  - `initialize_project_session()` runs once and stores the sidecar in `_active_project_sidecar` for potential future use/telemetry.

**Bug fixed:** Previously, we cleared `session_cache` and `tracked_jobs` when `session_count == 1` on boot. Combined with `reset_project_session` initializing the counter to `0`, this caused drafts written *after* a project switch (while the counter was still 0) to be wiped on the next worker restart. That logic has been removed; session counters are now informational only.

---

## 4. Explorer Project Switch Gatekeeper

**File:** `app/apps/file_editor_cm6/explorer_ws.py`

- New helper: `reset_project_session(new_project_path: str)`:
  - Normalizes the path.
  - Updates `_history_store.set_active_project(normalized_path)` (SSOT for active project).
  - Loads the project’s `ProjectSidecar`.
  - Clears:
    - `session_cache` (drafts)
    - `tracked_jobs`
  - Resets `diff_base` to `"HEAD"`.
  - Saves the sidecar.
  - **Does not** touch `session_count` (see §3).
- Wired into project flows:
  - `handle_project_open`:
    - After `set_project_root(path)`, calls `reset_project_session(str(new_root))`.
  - `handle_project_create`:
    - Delegates to `handle_project_open` with the new path (inherits the reset behavior).
  - `handle_git_clone`:
    - After creating the target directory and `set_project_root(str(target))`, calls `reset_project_session(str(new_root))`.
- Job tracking:
  - When creating git jobs (push, pull, clone), we:
    - Track job ID in `ExplorerDispatcher._tracked_job_ids`.
    - Also add the job ID to the project’s sidecar via `add_tracked_job(job.id)` + `save()`.
  - When a job completes in `_pump_job_events`, we:
    - Remove it from `_tracked_job_ids`.
    - Remove it from the sidecar with `remove_tracked_job(job_id)` + `save()`.

**Effect:** Explicit project changes (open/create/clone) now deterministically clear per-project editor state at the moment of switch. Worker restarts simply bump `session_count`, with no clearing side effects.

---

## 5. Debug: Projects & Sidecars API

**File:** `app/apps/file_editor_cm6/main.py`

### 5.1. List Endpoint

- `GET /api/app/file_editor_cm6/debug/projects`
- Response:
  ```json
  {
    "ok": true,
    "data": [
      {
        "path": "/abs/project/path",
        "label": "project-name",
        "opened_at": "2025-12-02T05:00:00Z",
        "sidecar_path": "/home/.../.cache/cm6_editor/projects/<hash>.json",
        "sidecar_exists": true,
        "session_count": 3,
        "last_boot_at": "2025-12-02T05:50:00Z"
      },
      ...
    ]
  }
  ```
- Implementation:
  - Uses `_history_store.list_projects()` as the source of truth for recent projects.
  - For each entry:
    - Computes sidecar path via `ProjectSidecar.get_sidecar_path(project_path)`.
    - Checks existence and, if present, loads the sidecar to read `session_count` and `last_boot_at`.

### 5.2. Delete Endpoint

- `DELETE /api/app/file_editor_cm6/debug/projects`
- Request body:
  ```json
  { "path": "/abs/project/path" }
  ```
- Behavior:
  - Calls `_history_store.remove_project(path)`:
    - Removes the project from `projects[...]`.
    - Removes it from `recent_projects`.
    - Clears `active_project` if it matches.
  - Attempts to delete the corresponding sidecar file:
    - `ProjectSidecar.get_sidecar_path(path).unlink()` if it exists.
    - Sidecar deletion failures are non-fatal.
  - Response:
    ```json
    {
      "ok": true,
      "data": {
        "removed": true,
        "sidecar_deleted": true
      }
    }
    ```

**Purpose:** Debug-only tool to inspect and surgically clean up history + sidecar state without touching actual project folders.

---

## 6. Debug UI: Projects & Sidecars Modal

**Files:**
- `app/apps/file_editor_cm6/template.html`
- `app/apps/file_editor_cm6/main.js`

### 6.1. File Menu Entry

- Under the “File” menu:
  - New item: `Debug: Projects & Sidecars…` (`#mi-debug-projects`).
- Wiring:
  - `const miDebugProjects = requireEl('#mi-debug-projects');`
  - `bindMenuToggle(miDebugProjects, () => { showProjectsDebugModal(); });`

### 6.2. Modal Layout

- Modal constructed lazily in JS (`ensureProjectsDebugModal()`):
  - Root: `<div id="fe-projects-debug-modal" class="fe-modal">…</div>`
  - Card: `.fe-modal-card` (max-width: 640px).
  - Scrollable body: `.fe-modal-body` with:
    - Vertical scroll (`overflow-y: auto`).
    - Horizontal scroll disabled (`overflow-x: hidden`).
  - Content container: `#fe-projects-debug-content`.

- CSS additions in `template.html`:
  - `.fe-modal-body { padding: 16px 20px; overflow-y: auto; overflow-x: hidden; }`
  - Row/grid:
    - `.fe-projects-debug-row`:
      - `display: grid; grid-template-columns: minmax(0,1fr) auto;`
      - Thin right column for actions.
    - `.fe-projects-debug-info`:
      - Left cell, contains both project and sidecar text.
    - `.fe-projects-debug-title`:
      - Bold, word-break enabled.
    - `.fe-projects-debug-meta`:
      - Smaller, muted text, word-break enabled.
    - `.fe-projects-debug-trash`:
      - Right cell, flex container for the trash button.
    - `.fe-projects-debug-trash button`:
      - Small `fe-btn`, red (`#ef4444`), narrow padding.

### 6.3. Behavior

- `showProjectsDebugModal()`:
  - Ensures the modal exists.
  - Shows it (`.fe-modal.show`) and calls `loadProjectsDebugContent()`.
- `loadProjectsDebugContent()`:
  - Calls `GET /debug/projects`.
  - If empty, shows “No recent projects recorded.”
  - Otherwise, renders one grid row per project:
    - Left cell:
      - `label — path`
      - `Sidecar: <path> (exists/missing, session_count=…, last_boot_at=…)`
    - Right cell:
      - Red trash button (`🗑`).
  - Clicking the trash:
    - Shows a `window.confirm()` with the project path.
    - If confirmed:
      - Calls `DELETE /debug/projects` with `{path}`.
      - On success, re-invokes `loadProjectsDebugContent()` to refresh.
      - On error, shows a simple `window.alert(...)`.

**Usage:** This is purely a developer/debug surface for inspecting and cleaning up the `_history_store` + sidecar mapping, especially during iteration on the project-session model.

---

## 7. Known Behavior & Remaining Work

- **Current behavior:**
  - Drafts:
    - Persist to per-project sidecars via `HistoryStore.upsert_cached_document`.
    - Survive worker restarts for the same active project.
    - Are cleared only on explicit project switches (`reset_project_session`) or when the debug delete endpoint is used.
  - Diff base:
    - Stored per project in sidecars; mirrored in `history_store.json`.
    - Reset to `HEAD` on project switch.
  - Jobs:
    - Tracked per explorer instance in-memory and mirrored in sidecars for future use/inspection.
  - Session counters:
    - Increment on every worker boot for the active project; used for telemetry/debugging only.

  - **Remaining / future work (not yet implemented):**
  - UI “Clear Project State” action in the menus (manual nuclear option).
  - Optional migration of per-project MRU (`recent_files`) into `ProjectSidecar.recent_files`.
  - Additional debug views (e.g., per-project draft listing via the sidecar instead of scanning disk).

---

## 8. Progress Update — Explorer/Editor Sync & Soft Reset (2025-12-02, later)

### 8.1. Project-Opened Sync Between Explorer, Host, and Iframe

**Files:**
- `app/apps/file_editor_cm6/static/js/explorer.js`
- `app/apps/file_editor_cm6/main.js`
- `app/apps/file_editor_cm6/nicegui_editor/editor_app.py`

- **Explorer → Host hook:**
  - `explorer.js` handles `project:opened` (from `explorer_ws`):
    - Updates `uiState.projectPath`.
    - Refreshes tree and git status.
    - Calls `window.__cm6HandleProjectOpened(payload.path)` if present.

- **Host handler (`__cm6HandleProjectOpened`):**
  - Implemented in `main.js`:
    - Clears host-side editor state (currentPath, diff controller context, WebSocket, unsaved flag, toolbar labels).
    - Calls `syncEditorState(true)` to pull a fresh `/state` snapshot for the new active project.
    - Reloads the NiceGUI iframe (`editor_frame`) so `editor_page()` runs in the context of the new project.

- **Iframe reload semantics (null document):**
  - `editor_app.editor_page()` reads:
    - `project_path = _history_store.get_active_project()`
    - `last_file = _history_store.get_last_file(project_path)`
  - If `last_file` is missing or invalid:
    - `initial_path = None`, `initial_content = ''`.
    - No watcher subscription is created.
    - No session cache writes happen.
    - No MRU updates happen.
    - This is explicitly documented as the **“null document”** / blank state for a project.

**Result:**  
Switching projects via explorer now reliably:
1. Clears per-project sidecar state (`reset_project_session`).
2. Emits `project:opened`.
3. Causes the host to clear its editor state and reload the iframe.
4. Leads `editor_page()` to open either the last real file for that project or a clean null document when there is none.

### 8.2. Active Project Highlighting and Soft Reset in Debug Modal

**Files:**
- `app/apps/file_editor_cm6/main.py`
- `app/apps/file_editor_cm6/history_store.py`
- `app/apps/file_editor_cm6/template.html`
- `app/apps/file_editor_cm6/main.js`

- **Active project flag in `/debug/projects`:**
  - `debug_projects()` now adds `is_active` per entry:
    - `path == _history_store.get_active_project()`.
  - Frontend sorts projects so the active project is listed first.
  - Active row gets `.fe-projects-debug-row--active` styling (blue-tinted highlight).

- **Soft reset vs hard delete in `DELETE /debug/projects`:**
  - New helper `HistoryStore.reset_project_history(project_path)`:
    - Clears `files[]`, `last_file`, sets `diff_base = "HEAD"`, removes `origin`.
    - Keeps `recent_projects` and `active_project` intact.
  - `debug_delete_project` semantics:
    - If project is **active**:
      - Calls `reset_project_history(path)`.
      - Loads its sidecar, then:
        - `clear_session_cache()`
        - `clear_tracked_jobs()`
        - `set_diff_base("HEAD")`
        - `save()`
      - Returns `history_reset=True`, `removed=False`, `sidecar_deleted=False`, `is_active=True`.
      - I.e., **soft nuke**: wipes MRU + drafts + diff base, but keeps project known and sidecar file intact.
    - If project is **not active**:
      - Calls `_history_store.remove_project(path)` (removes from `projects` + `recent_projects`, clears `active_project` if needed).
      - Deletes the project’s sidecar file if it exists.
      - Returns `removed=True`, `sidecar_deleted=True`, `history_reset=False`, `is_active=False` (hard delete).

- **Debug modal interactions:**
  - Each row:
    - Left cell (info): project label/path + sidecar info.
    - Right cell: red trash button.
  - For non-active projects:
    - Clicking the left cell acts as a “quick open project”:
      - Confirms unsaved-change warning.
      - Sends `project:open` via `window.__explorerBusSend`, then hides the modal.
      - Reuses the standard project switch pipeline.
  - For the active project:
    - Info cell is inert (no click handler).
    - Trash button triggers the **soft reset** described above.
    - After a successful soft reset:
      - Frontend calls `window.__cm6HandleProjectOpened(path)` directly:
        - Clears host editor state.
        - Reloads the iframe.
      - `editor_page()` reloads into the **null document** state for the same active project (no `last_file`, no drafts).

**Result:**  
Soft-resetting the currently active project via the debug modal now behaves like “just opened a new project”:
- Per-project drafts, MRU, and diff base are wiped.
- The project remains selected and in recents.
- The host + iframe editor re-synchronize into a clean blank buffer tied to that project.

---

**Summary:**  
The Code CM6 editor now uses per-project sidecars as the SSOT for project-scoped state (drafts, diff base, tracked jobs), with explicit clearing on project switches and a read-only debug UI to introspect and surgically reset history + sidecars. Session counters remain in place for diagnostics but no longer trigger state clearing, preventing accidental draft loss on worker restarts. 

---

# 5. Implementation Notes Part 2

# Project Session Management — Phase 4+ Plan (Editor Sync & Recents)

**Date:** 2025-12-02  
**Context:** Code CM6 (file_editor_cm6)  
**Status:** Planning (no implementation in this file)

This document refines the remaining phases after the initial `ProjectSidecar` rollout, with a focus on keeping the NiceGUI editor iframe (`editor_app.py`) synchronized with project state and gradually migrating per-project MRU data.

---

## Recap: What’s Already Landed

Short version of completed work (see `tmp22.md` and `tmp23.md` for details):

1. **ProjectSidecar** (`project_sidecar.py`)
   - Per-project JSON sidecar: drafts (`session_cache`), `diff_base`, `tracked_jobs`, and telemetry (`session_count`, `last_boot_at`).
2. **Boot Lifecycle**
   - `initialize_project_session()` bumps `session_count` on worker start; no longer clears any state.
3. **Session Cache Migration**
   - `HistoryStore` now delegates draft persistence to `ProjectSidecar`.
4. **Diff Base Migration**
   - Diff base is stored in sidecars and mirrored into `history_store.json`.
5. **Explorer Project Switch Gatekeeper**
   - `reset_project_session()` (in `explorer_ws.py`) clears drafts + tracked jobs + diff base on explicit project switches (open/create/clone).
6. **Debug Tooling**
   - `/debug/projects` APIs + File menu modal show recent projects and their sidecars, with a debug-only “delete entry + sidecar” action.

The next steps tighten editor synchronization and finish the MRU/diff base migration story.

---

## Phase 4 — Per-Project Recents & Last-File Semantics

### 4.1. Clarify Source of Truth for “Last Opened File”

**Goal:** Make it explicit where “last opened file” for a project lives, and keep `editor_app.py` and the host (`main.js` + explorer) aligned.

Planned approach:

- Keep `HistoryStore.projects[project]["last_file"]` as the primary SSOT for now:
  - Used by `/state` and `editor_app` on cold start.
  - Updated via existing `record_file_activity` flows.
- Optionally mirror `last_file` into `ProjectSidecar.recent_files` in a later sub-phase, but do not change behavior until that win is clear.

Deliverables:

- Audit all `record_file_activity`, `set_last_file`, `get_last_file`, and `/history/files` usages.
- Document explicitly (in code comments) that:
  - `HistoryStore` drives the “last file” UX.
  - `ProjectSidecar` may eventually mirror MRU for faster per-project analytics/debugging, but is not yet the SSOT.

### 4.2. Define “Null Document” / Blank Buffer Semantics

**Problem:** When a project is opened and no real file has been opened yet (or last_file is missing), the iframe still needs a clean, well-defined editor state.

Plan:

- Define a **virtual null document** concept for the editor:
  - Not a real file path on disk.
  - Not stored in MRU or recent files lists.
  - Only used inside `editor_app.py` to produce a “blank document” state.
- Storage:
  - The presence of a null document does **not** need to be persisted as a path.
  - Logic can be:
    - If `last_file` is missing or invalid, the editor treats this as “open blank buffer”.

Deliverables:

- Add a clear code-level comment in `editor_app.py` describing the null document behavior.
- Ensure watchers, git diff, and session cache do **not** attempt to attach to the null document:
  - No watcher subscription.
  - No session sidecar writes for null.
  - No MRU updates.

### 4.3. Host ↔ Editor Sync on Project Switch

**Goal:** When a project changes, the iframe should consistently show the right document for that project.

High-level behavior:

1. **Explorer triggers switch**:
   - `reset_project_session(new_project_path)` clears per-project drafts/tracked jobs/diff base.
   - `explorer_ws` broadcasts `project:opened` with `{path}`.
2. **Host (`main.js`) reacts**:
   - On `project:opened`, after refreshing explorer + git, call a new helper:
     - e.g. `syncEditorToProject()` or `openProjectBootFile()`.
   - That helper:
     - Fetches `/state` (or a new lightweight `/state/project` endpoint) to get:
       - `activeProject`
       - `lastFile` (+ existence info)
     - Decides what to open:
       - If `lastFile` exists and is inside `activeProject` → open that file.
       - Else → instruct editor to open a blank/null document.
3. **Editor (`editor_app.py`) responds**:
   - Expose a small, explicit API for the host:
     - e.g. `POST /editor/open_boot_file` with `{ "path": "/abs/file" }` or `{ "path": null }`.
   - Implementation:
     - If `path` is a real file:
       - Use existing logic to load from disk or draft sidecar.
       - Ensure `record_file_activity`/`last_file` remains in sync.
     - If `path` is null/omitted:
       - Initialize a blank buffer (null document).
       - No MRU update, no watcher, no session cache.

Constraints:

- Project switches must remain idempotent:
  - Receiving `project:opened` twice for the same path should not corrupt MRU or sidecar state.
- Project switch must not clear drafts in **other** projects; only the active project’s sidecar is touched.

Deliverables:

- New host-side helper in `main.js` that reacts to `project:opened` and calls the proper editor endpoint.
- New endpoint in `editor_app.py` (or reuse of a safe existing “open file” endpoint) to enact the requested boot file.
- Comments tying this behavior back to the sidecar clearing in `reset_project_session`.

---

## Phase 5 — Manual “Clear Project State” UI

(Already sketched in `tmp22.md`, reiterated here for completeness.)

### 5.1. Backend

- Implement a `clear_project_state` helper (likely in `project_sidecar.py` or a thin wrapper in `main.py`):
  - Deletes the project’s sidecar file entirely.
  - Optionally wipes project-specific entries in `HistoryStore` (MRU, diff base) if we want a full reset.

### 5.2. UI

- Add a menu item (most likely under **Edit** or **File**) called “Clear Project State…”.
- Modal:
  - Lists exactly what will be discarded:
    - Unsaved drafts
    - Diff base setting
    - Recent files list
    - Tracked jobs
  - Clearly states that the actual project directory is not touched.
- On confirm:
  - Calls the backend `clear_project_state` endpoint.
  - Triggers:
    - Explorer refresh (to remove draft badges).
    - Editor sync to null document / safe default.

---

## Phase 6 — Optional: MRU in Sidecar & Deeper Analytics

This is more speculative and can be postponed until core behavior is stable.

Ideas:

- Move per-project MRU from `HistoryStore.projects[project].files` into `ProjectSidecar.recent_files` and keep `HistoryStore` as a lightweight index:
  - `recent_projects` stays in `HistoryStore`.
  - Actual MRU for each project lives in the sidecar for that project.
- Build additional debug views off sidecars:
  - Per-project draft lists.
  - Per-project job history.
  - “Stale sidecar” detection when `session_count` grows unexpectedly without recent activity.

---

## Ordering / Priority Notes

- The next **high-value** user-facing step is **Phase 4.3**:
  - Wiring `project:opened` → host → `editor_app` so the iframe always lands on a sensible document (last real file or blank) after project switches.
  - This makes the app feel coherent and avoids “wrong-file-open” confusion when switching projects.
- Phase 4.2 (null document semantics) is a prerequisite for 4.3.
- MRU migration (Phase 6) can wait until the core behavior feels rock solid.

Implementation should follow this order:

1. Document and enforce null document behavior in `editor_app.py` (Phase 4.2).
2. Wire project-open synchronization between explorer and editor (Phase 4.3).
3. Add the manual “Clear Project State” UI (Phase 5).
4. Revisit MRU migration to sidecars (Phase 6) once everything is stable. 


---

# 6. Finalization Plan & Status

# Project Session Management — Finalization Plan (Phase 4–6)

**Date:** 2025-12-02  
**Context:** Code CM6 (`file_editor_cm6`)  
**Goal:** Finish migrating all per-project state into sidecars and tidy the UI/behavior around project state, drafts, and MRU.

This plan assumes everything described in `tmp22.md`, `tmp23.md`, and `tmp24.md` is in place and working (per-project sidecars, project switch gatekeeping, debug modal, editor sync, null document semantics).

---

## Guiding Principles

1. **One SSOT per project.**  
   For each project path, there should be a single, obvious source of truth for:
   - Drafts
   - MRU / recent files + `last_file`
   - Diff base
   - Tracked jobs

2. **Minimal magic in HistoryStore.**  
   `HistoryStore` remains the global ledger of:
   - Active project
   - Recent projects list (project picker)
   But all *per-project* detail should come from the sidecar.

3. **Explorer + Editor stay in lockstep.**  
   - Project switches and state resets must always pass through the same well-defined paths.
   - The iframe editor (`editor_app.py`) and host (`main.js`) must always derive state from the same project/sidecar view.

4. **Debug modal becomes a formal “Project Manager”.**  
   - It’s no longer “debug-only”; it’s the unified entry point for:
     - Seeing all known projects.
     - Quickly switching projects.
     - Resetting the current project’s state.
   - The word “debug” can disappear from the UI, but sidecar paths remain visible for observability.

---

## Phase 4 — Clean Up “Clear State” Semantics and Review UI

### 4.1. Formalize the “Projects & Sidecars” Modal as “Projects” Manager

**Goal:** Make the existing modal feel intentional and user-facing, while still exposing sidecar tech details for power users.

Steps:

1. **Rename labels in the UI (no behavior change):**
   - Button text:
     - `Debug: Projects & Sidecars…` → `Projects…` (or `Manage Projects…`).
   - Modal title:
     - `Recent Projects & Sidecars (Debug)` → `Projects`.
   - Row contents:
     - Keep `Sidecar: <path> (...)` line, but you may soften the wording:
       - e.g., `State file: <path> (exists, session_count=..., last_boot_at=...)`.

2. **Keep behavior identical:**
   - Active project:
     - Highlighted row.
     - Trash = soft reset (history + drafts + diff base).
     - No row click; you’re already in that project.
   - Other projects:
     - Row click = open via `project:open`.
     - Trash = hard delete from history + sidecar removal.

3. **Documentation:**
   - Add a short block to `TECHNICAL.md` under “Session Cache” / “Projects” explaining:
     - The Projects modal is the primary way to inspect and manage known projects.
     - Sidecar path is shown for inspection; deleting or resetting a project affects that file.

### 4.2. Review Overlay: “Check All” and Nuke Drafts

**Goal:** Give users a clean way to bulk discard drafts via the existing Review overlay, rather than relying on the Projects modal for day-to-day draft cleanup.

Steps:

1. **UI changes in `explorer.js` (Review tab):**
   - Add a “Select All” or “Check All” control to the Review tab:
     - When clicked, it selects all draft entries in the review list.
   - Ensure it’s easy to unselect (e.g., toggles or a separate “Clear Selection”).

2. **Backend is already ready:**
   - `/review/discard` supports a list of `files` (relative paths).
   - It calls `discard_reviews(project_root, files)` which:
     - Calls `_history_store.clear_cached_document(...)` per file.
     - Calls `handle_external_discard` to reset active editor content if needed.

3. **Behavior:**
   - User goes to Review tab.
   - Clicks “Check All”.
   - Clicks “Discard”:
     - All draft entries for that project are cleared (file-by-file).
     - Explorer draft badges update via existing notifications.
   - This becomes the everyday path for “nuke all drafts,” leaving the Projects modal for project-level lifecycle.

---

## Phase 5 — MRU/Recents Migration into Sidecars

**Goal:** Move per-project MRU and `last_file` from `HistoryStore` into `ProjectSidecar`, making the sidecar the SSOT for all project-scoped state.

### 5.1. Extend ProjectSidecar Schema for Recents

**File:** `project_sidecar.py`

Already present:
- `recent_files: []` (currently unused)

Planned shape:

```json
"recent_files": [
  {
    "path": "/abs/path/to/file",
    "label": "relative/or/basename",
    "opened_at": "2025-12-02T12:34:56.789Z"
  },
  ...
]
```

Additional field:

```json
"last_file": "/abs/path/to/last/file/or/null"
```

Changes:

- Add accessors to `ProjectSidecar`:
  - `record_file_activity(file_path: str) -> dict`:
    - Updates `last_file`.
    - Inserts/bumps entry in `recent_files` (LRU, capped size).
  - `get_last_file() -> Optional[str]`
  - `list_recent_files() -> List[dict]`
  - `clear_recent_files()` (used by soft reset).

### 5.2. Wire HistoryStore’s MRU APIs to Sidecar

**File:** `history_store.py`

Current MRU logic:
- `record_file_activity(project_path, file_path)`:
  - Mutates `projects[project]["files"]` and `["last_file"]`.
- `get_last_file(project_path)`.
- `list_files(project_path)`.
- `clear_all_files(project_path)`.

Planned changes:

1. **Delegate to ProjectSidecar while keeping a compatibility shadow:**
   - `record_file_activity(project_path, file_path)`:
     - Normalizes paths.
     - Calls `ProjectSidecar.load_or_create(project).record_file_activity(file_path)` and saves.
     - Optionally updates a minimal `projects[project]["files"]` and `["last_file"]` for backward compatibility (or just uses sidecar for all reads if no old callers depend on the in-file copy).

   - `get_last_file(project_path)`:
     - Calls `ProjectSidecar.load_or_create(project).get_last_file()` as SSOT.
     - Falls back to legacy `projects[project]["last_file"]` only if sidecar missing (e.g., first run).

   - `list_files(project_path)`:
     - Calls `sidecar.list_recent_files()` and maps to the existing `{path, label, opened_at}` shape.

   - `clear_all_files(project_path)`:
     - Calls `sidecar.clear_recent_files()` and `sidecar.save()`.
     - Clears legacy `projects[project]["files"]` and `["last_file"]` for consistency.

2. **Migration / Compat layer:**
   - On first `ProjectSidecar.load_or_create(project)`:
     - If `recent_files` is empty but `HistoryStore.projects[project]["files"]` has entries:
       - Seed `recent_files` from those entries.
       - Set `last_file` from `projects[project]["last_file"]`.
     - This allows a one-time lazy migration without separate migration scripts.

3. **Update call sites:**
   - `editor_app.editor_page()`:
     - Already uses `_history_store.get_last_file(project_path)`; this will now read from sidecar via the delegated method.
   - `/history/files` endpoint in `main.py`:
     - Continues to call `_history_store.list_files(project_root)`, which now surfaces `sidecar.recent_files`.

**Outcome:**  
All per-project MRU data lives in the sidecar, with HistoryStore acting as a thin delegator + global project list. Projects can be fully “picked up and understood” via the sidecar and a single HistoryStore entry.

---

## Phase 6 — Multi-Project Draft Retention Policy

**Goal:** Allow drafts to persist across projects without surprise nukes, while retaining explicit controls to clear them when the user intends to.

### 6.1. Clarify When Drafts *Should* Be Cleared

Current clearing points:
- `reset_project_session(new_project_path)` (on project open/create/clone):
  - Clears `session_cache` + `tracked_jobs` and resets `diff_base` for the new project.
- Soft reset via Projects modal (active project trash):
  - Uses `reset_project_history` + `sidecar.clear_session_cache()` + `clear_tracked_jobs()` + `set_diff_base("HEAD")`.
- Hard delete via Projects modal (non-active):
  - Deletes sidecar file altogether.

Desired end state:
- **Project switches do NOT automatically clear drafts** for the target project.
- Drafts are only cleared:
  - On explicit user commands:
    - Soft reset (Projects modal on current project).
    - Hard delete (Projects modal on other projects).
    - Review tab “Discard” / “Check All + Discard” for that project.

### 6.2. Adjust `reset_project_session` Semantics

**File:** `explorer_ws.py`

Planned change:

- `reset_project_session(new_project_path)` currently:
  - Sets active project.
  - Clears `session_cache` and `tracked_jobs`.
  - Resets `diff_base` to `HEAD`.
  - Saves sidecar.

- New behavior:
  - Set active project as now.
  - **Do not** clear `session_cache` and `tracked_jobs` here.
  - Optionally keep resetting `diff_base` to `HEAD` on project switches, or leave `diff_base` untouched and let users manage it explicitly.

Consequence:
- Project switches are “non-destructive” with respect to drafts; drafts persist in each project’s sidecar.
- Users can still:
  - Use Review tab to discard drafts for the current project.
  - Use Projects modal to soft-reset or hard-delete as needed.

### 6.3. Communicate and Expose Draft State

Optional, but recommended for clarity:

- In the Projects modal:
  - Add a hint if a project has active drafts:
    - e.g., `Sidecar: ... (exists, drafts=3, session_count=5, last_boot_at=...)`.
  - This can be derived from:
    - `len(sidecar.session_cache)` or a computed property like `sidecar.list_project_drafts()`.

**Outcome:**  
Once `reset_project_session` stops clearing `session_cache` by default, we effectively have multi-project session drafting: each project keeps its drafts until the user explicitly clears them via Review or the Projects modal, and the sidecar is the sole SSOT for those drafts.

---

## Phase 7 — Final Clean-Up & Documentation

### 7.1. Remove Dead/Legacy Session Cache Paths

- The old `~/.cache/cm6_sessions` mechanism in `HistoryStore` (if still present) can be:
  - Clearly marked as legacy and left for a migration period, or
  - Fully removed once we are confident everything uses sidecar-based `session_cache`.

### 7.2. Documentation Updates

**Files:**
- `docs/apps/code_cm6/TECHNICAL.md`
- `tmp22.md`, `tmp23.md`, `tmp24.md`, `tmp25.md` (internal notes)

Update TECHNICAL.md to:
- Reflect that:
  - Drafts, diff base, tracked jobs, **and MRU** are all per-project and live in sidecars.
  - HistoryStore is just the global ledger: active project and recent project list.
- Include a short section on:
  - Projects modal behavior (open, soft reset, hard delete).
  - Null document semantics after soft resets and on projects with no last file.

### 7.3. Sanity/Regression Pass

Final checks across scenarios:

1. Single project, no drafts:
   - Open/close files, restart worker.
   - MRU and last file restore correctly.
2. Single project with drafts:
   - Drafts survive worker restarts.
   - Review tab shows/clears them correctly.
3. Multiple projects with drafts:
   - Switch projects; drafts remain per project when switching back.
   - Projects modal shows them, soft reset of one project does not affect others.
4. Soft reset of active project:
   - MRU, diff base, drafts cleared for that project.
   - Editor lands in null document state.
5. Hard delete of non-active project:
   - Project disappears from recents and Projects modal.
   - Its sidecar is removed.

When these are all verified, Code CM6’s per-project session management can be considered fully migrated and finalized. 


---

## Implementation Status — 2025-12-03

### Completed (Phases 4–6)

All phases implemented and tested:

**Phase 4.1 — Projects Modal Rename:**
- Menu item: `Debug: Projects & Sidecars…` → `Projects…`
- Modal title: `Recent Projects & Sidecars (Debug)` → `Projects`
- Row metadata: `Sidecar:` → `State:`
- Trash button tooltip now context-aware (active vs non-active project)
- Draft count now displayed in modal rows

**Phase 4.2 — Review Overlay Select All:**
- Added "Select All" / "Clear Selection" toggle button to Review toolbar
- Added `data-rel` attribute to checkboxes for programmatic selection
- Improved confirmation dialog text

**Phase 5 — MRU Migration to Sidecar:**
- `ProjectSidecar.record_file_activity()` now stores `scroll_line` per file
- `ProjectSidecar.get_file_scroll_line()` / `update_file_scroll_line()` added
- `HistoryStore` delegates all MRU operations to sidecar (SSOT)
- Lazy migration seeds sidecar from legacy history.json on first access
- `HistoryStore.reset_project_history()` now clears sidecar recent files

**Phase 6 — Multi-Project Draft Retention:**
- `reset_project_session()` NO LONGER clears `session_cache` or `tracked_jobs`
- Drafts persist per-project across project switches
- Only cleared via explicit user action (Review discard, Projects modal)

### Bug Fixes (Post-Implementation)

**Recents Dropdown Not Populating:**
- Added `window.__cm6RefreshRecents(state)` function to populate dropdown from `state.recents`
- Added `broadcastRecentsUpdate(serverState)` call on initial page load
- Fixed per-file scroll position restore when clicking recent file

**Project Switch UI Stale Data:**
- Added `broadcastRecentsUpdate(newState)` to `handleProjectOpened()`
- Added `branchMenuHandle.refresh()` call on project switch
- Added `initDiffBaseFromBackend()` to `project:opened` handler in explorer.js
- All UI components now refresh from backend SSOT on project switch

### Per-File Scroll Position:
- `POST /state/file_scroll` endpoint added for debounced scroll saves
- `scroll_line` persisted in sidecar `recent_files` entries
- `editor_app.py` reads scroll line from sidecar on page load (falls back to session state)
- Scroll position saved on scroll events and restored on file open

### Documentation Updated

- `docs/core/2025-12-03_code_cm6_feature_adding_guidelines.md` — Renamed, added state management section
- `docs/apps/code_cm6/TECHNICAL.md` — Section 11 rewritten with two-tier architecture
- `docs/apps/code_cm6/README.md` — Added Multi-Project Session Management section
- `app/apps/file_editor_cm6/README.md` — Copy of docs README
- `README.md` — Updated with changelog entry

### Branch Status

PR merged to main. All changes live.

---

*Signed: Atlas — TE2 Team*  
*Date: 2025-12-03 03:30 UTC*
