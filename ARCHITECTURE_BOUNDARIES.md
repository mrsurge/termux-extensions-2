# Architecture Boundaries Analysis

**Generated**: 2025-11-23 (from code inspection)
**Purpose**: Identify clean boundaries for extracting core logic into compiled binaries

---

## Current Problem: "Libraries" with HTTP Routes

Your `app/libs/` contains **hybrid modules** that mix:
- ❌ Business logic (should be pure library)
- ❌ HTTP routing (should be in app/main.py or dedicated routers/)
- ❌ Both running in same Python runtime

This makes it impossible to compile the core logic without rewriting FastAPI routes.

---

## The 4 "Libraries" with Routes

### 1. `bookmarks.py` (84 lines)
**What it does**:
- File-based bookmark CRUD (JSON storage)

**HTTP Layer**:
```python
bookmarks_bp = APIRouter(prefix="/api")
@bookmarks_bp.get('/bookmarks')   # Read
@bookmarks_bp.post('/bookmarks')  # Create
@bookmarks_bp.put('/bookmarks')   # Update
```

**Core Logic** (compilable):
- `_ensure_bookmarks_file()` - Create storage file
- `get_bookmarks()` - Read JSON file
- File I/O operations

**Extraction Difficulty**: ⭐ EASY
- Simple CRUD, no complex dependencies
- Could be a tiny Go/Rust binary with JSON I/O

---

### 2. `framework_shells.py` (1,117 lines) ⚠️ CRITICAL
**What it does**:
- Process lifecycle management (spawn/kill/adopt)
- PTY handling for interactive shells
- Log capture and streaming
- WebSocket PTY relay

**HTTP Layer**:
```python
framework_shells_bp = APIRouter()
@framework_shells_bp.get("/api/framework_shells")           # List
@framework_shells_bp.post("/api/framework_shells")          # Spawn
@framework_shells_bp.get("/api/framework_shells/{id}")      # Get
@framework_shells_bp.post("/api/framework_shells/{id}/action")  # Control
@framework_shells_bp.post("/api/framework_shells/{id}/write")   # Write to PTY
@framework_shells_bp.websocket("/api/framework_shells/{id}/ws") # PTY stream
```

**Core Logic** (compilable):
```python
class FrameworkShellManager:
    async def spawn_shell(...)        # Process spawning
    async def stop_shell(...)         # Process termination
    async def write_to_shell(...)     # PTY write
    async def read_logs(...)          # Log tailing
    async def adopt_orphans(...)      # Process adoption
    async def get_stats(...)          # psutil metrics
```

**Key Dependencies**:
- Python: `pty`, `termios`, `fcntl`, `select`, `signal`
- External: `psutil` (optional)
- Filesystem: JSON metadata, log files

**Extraction Difficulty**: ⭐⭐⭐⭐ HARD
- Deep POSIX integration (PTY, signals)
- WebSocket streaming
- Async I/O patterns
- BUT: This is your HOTTEST path (process management core)

**Recommendation**: 
- **Phase 1**: Extract to standalone Python service (remove from libs/)
- **Phase 2**: Rewrite in Go/Rust if performance bottleneck

---

### 3. `git_utils.py` (171 lines)
**What it does**:
- Git CLI wrappers (subprocess)
- Repository status/diff parsing

**HTTP Layer**:
```python
git_utils_bp = APIRouter(prefix="/api")
@git_utils_bp.post('/git/clone')    # Clone repo
@git_utils_bp.get('/git/summary')   # Get status
```

**Core Logic** (compilable):
```python
def clone_repository(url, target_path)
def get_commit_info(project_root, ref='HEAD')
def get_current_branch(project_root)
def is_git_repository(project_root)
def _run_git_optional(project_root, *args)  # subprocess wrapper
```

**Key Dependencies**:
- External: `git` CLI via subprocess
- Parsing: Simple regex/string operations

**Extraction Difficulty**: ⭐⭐ MEDIUM
- Mostly subprocess wrappers
- Could use libgit2 (C library) in Go/Rust
- Or keep as CLI wrapper (simpler)

**Recommendation**: 
- Extract to standalone binary (Go with go-git library)
- Expose as HTTP service or command-line tool

---

### 4. `jobs.py` (424 lines)
**What it does**:
- Background job queue (threading)
- Job handler registry
- Job state tracking

**HTTP Layer**:
```python
jobs_bp = APIRouter(prefix="/api")
@jobs_bp.post("/jobs")              # Create
@jobs_bp.get("/jobs")               # List
@jobs_bp.get("/jobs/{job_id}")      # Get
@jobs_bp.post("/jobs/{job_id}/cancel")  # Cancel
@jobs_bp.delete("/jobs/{job_id}")   # Delete
```

**Core Logic** (compilable):
```python
class JobQueue:
    def submit_job(...)
    def cancel_job(...)
    def get_job_status(...)
    def _worker_thread(...)  # Threading worker

def register_job_handler(job_type)  # Handler registry
```

**Key Dependencies**:
- Python: `threading`, `queue`
- No external deps

**Extraction Difficulty**: ⭐⭐⭐ MEDIUM-HARD
- Threading model (Go goroutines would be cleaner)
- Handler registry pattern
- State persistence

**Recommendation**:
- Could use Go channels + goroutines
- Or existing queue systems (Redis, RabbitMQ)

---

## Pure Libraries (No Routes) ✅

These are already clean:

| File | Lines | Purpose | Compilable? |
|------|-------|---------|-------------|
| `app_manager.py` | 323 | App worker lifecycle | Yes (Go/Rust) |
| `app_lifecycle.py` | 168 | Background task coordination | Yes |
| `app_worker.py` | ? | Worker process spawner | Yes (like framework_shells) |
| `archiver.py` | 110 | Archive operations wrapper | Yes (uses libarchive) |
| `archiver_service.py` | 118 | Archive service layer | Yes |
| `asgi_helpers.py` | ? | ASGI utilities | No (FastAPI-specific) |
| `shell_groups.py` | ? | Shell grouping logic | Yes |

---

## Proposed Refactoring Strategy

### Option A: Move Routes to `app/routes/` (Python Only)

**Structure**:
```
app/
├── main.py                    # FastAPI app + lifespan
├── routes/                    # NEW: All HTTP handlers
│   ├── bookmarks.py          # Router only
│   ├── framework_shells.py   # Router only  
│   ├── git.py                # Router only
│   └── jobs.py               # Router only
├── services/                  # NEW: Core business logic (pure Python)
│   ├── bookmarks.py          # CRUD logic
│   ├── shell_manager.py      # FrameworkShellManager class
│   ├── git.py                # Git operations
│   └── job_queue.py          # Job queue logic
└── libs/                      # Keep for utilities
    ├── app_manager.py
    └── ...
```

**Pros**:
- ✅ Clear separation of concerns
- ✅ Can compile `services/` independently later
- ✅ No API changes

**Cons**:
- ❌ Still Python (slow for process management)

---

### Option B: Extract to Binaries (Gradual Migration)

**Phase 1: Critical Path** (framework_shells)
```
termux-extensions-2/
├── bin/                       # NEW: Compiled binaries
│   └── shell-manager         # Go/Rust binary for process management
├── app/
│   ├── main.py
│   ├── routes/
│   │   └── framework_shells.py   # Calls bin/shell-manager via IPC/HTTP
│   └── services/
│       └── shell_manager_client.py  # Client wrapper
```

**IPC Options**:
1. **HTTP** - shell-manager runs as microservice on localhost:9999
2. **Unix Socket** - shell-manager listens on `/tmp/shell-manager.sock`
3. **stdin/stdout** - shell-manager as CLI tool (JSON RPC over pipes)

**Phase 2: Other Services**
- Git operations → libgit2-based binary
- Job queue → Go service with channels
- Bookmarks → Keep in Python (not performance-critical)

---

## Recommendation: Start Here

### Immediate Action (No Compilation):
1. **Move routes to `app/routes/`**
   - Keeps all HTTP logic in one place
   - No functional changes
   - Easy to test

2. **Create `app/services/`**
   - Extract core classes (FrameworkShellManager, JobQueue, etc.)
   - Make them route-agnostic
   - Add direct function-call interfaces

3. **Verify with tests**
   - Framework still works
   - No performance regression

### Future (If Performance Needed):
- Profile to find bottlenecks
- Extract hottest path to Go/Rust
- Start with `framework_shells` (most complex, most critical)

---

## Questions for You:

1. **Do you have performance issues now?**
   - If not, maybe just reorganize (Option A)
   - If yes, which operations are slow?

2. **What's your comfort level with Go/Rust?**
   - If low, stick with Python reorganization
   - If high, go straight to Option B

3. **Are you willing to maintain IPC layer?**
   - HTTP microservices add network overhead
   - Unix sockets are fast but OS-specific
   - Subprocess calling adds complexity

4. **Which operation is the bottleneck?**
   - Process spawning? → Compile framework_shells
   - Git operations? → Use libgit2
   - Job queue? → Use Redis/existing solution

---

**My gut feeling**: Your architecture is already pretty good. The mixing of routes and logic is a code org issue, not a runtime issue. Unless you're hitting performance walls, I'd suggest:

1. Reorganize to `routes/` + `services/` (1 day of work)
2. Run it for a month
3. Profile to find real bottlenecks
4. Then decide what to compile

What do you think?
