# COMPLETE ASGI MIGRATION PLAN - LEAVE NO STONE UNTURNED

**Date:** November 5, 2025  
**Goal:** Convert the ENTIRE repository to ASGI/FastAPI, removing ALL Flask dependencies

---

## Executive Summary

**Current State:**
- 43 Python files in app/
- 7 files still use Flask
- 4 apps need full Flask → FastAPI migration
- 3 extensions need Flask → FastAPI migration
- 4 anyio.to_thread.run_sync calls with keyword args need fixing

**Target State:**
- 100% FastAPI/ASGI
- Zero Flask imports
- All apps run as isolated FastAPI workers
- All extensions use FastAPI routers

---

## Phase 1: Fix anyio.to_thread.run_sync Keyword Arguments (Already Documented)

**Status:** ✅ Documented in ASGI_MIGRATION_REFACTOR.md

**Files:**
- ✅ app/apps/file_editor_cm6/main.py (DONE)
- ❌ app/apps/file_editor_cm6/terminal_backend.py (2 fixes)
- ❌ app/apps/file_editor_cm6/agent_ws.py (1 fix)
- ❌ app/apps/file_explorer/file_explorer.py (1 fix)

**Action:** Execute ASGI_MIGRATION_REFACTOR.md first

---

## Phase 2: Migrate Flask Apps to FastAPI Workers

### 2.1 archive_manager (app/apps/archive_manager/)

**Current State:**
- File: `backend.py`
- Uses: Flask Blueprint, jsonify, request.get_json, request.args
- Routes: 4 (@route decorators)
  - `/ping` (GET)
  - `/browse` (GET)
  - `/archives/launch` (POST)
  - `/archives/extract` (POST)
- Has manifest with backend_blueprint: "backend.py"

**Migration Steps:**
1. Rename `archive_manager_bp = Blueprint(...)` to `archive_manager_bp = APIRouter()`
2. Replace all `@archive_manager_bp.route('/path', methods=['GET'])` with `@archive_manager_bp.get('/path')`
3. Replace all `@archive_manager_bp.route('/path', methods=['POST'])` with `@archive_manager_bp.post('/path')`
4. Replace `request.args.get('key')` with FastAPI `Query()` dependency or `request.query_params.get('key')`
5. Replace `request.get_json(silent=True) or {}` with FastAPI `Body(...)` dependency
6. Replace `jsonify({...})` with direct dict return
7. Replace `jsonify({...}), status_code` with `JSONResponse(content={...}, status_code=...)`
8. Import changes:
   ```python
   # OLD:
   from flask import Blueprint, jsonify, request
   
   # NEW:
   from fastapi import APIRouter, Request, HTTPException, Query, Body
   from fastapi.responses import JSONResponse
   ```

**Testing:**
- Verify archive browsing works
- Test archive extraction
- Test launch functionality

---

### 2.2 aria_downloader (app/apps/aria_downloader/)

**Current State:**
- File: `main.py`
- Uses: Flask Blueprint, jsonify, request.get_json, request.args
- Routes: 9 (mix of @get/@post decorators - partially migrated?)
- NO manifest.json found - check if this is an active app
- Has aria2 RPC integration

**Investigation Needed:**
1. Check if aria_downloader has a manifest
2. Determine if it runs as a worker or extension
3. If no manifest, decide: delete or create manifest

**Migration Steps** (if keeping):
1. Same pattern as archive_manager
2. Convert all remaining Flask patterns
3. Create manifest.json if missing:
   ```json
   {
     "name": "Aria Downloader",
     "id": "aria_downloader",
     "version": "0.1.0",
     "entrypoints": {
       "backend_blueprint": "main.py"
     }
   }
   ```
4. Replace Blueprint with APIRouter
5. Fix all request/jsonify patterns

**Testing:**
- Test aria2 RPC communication
- Test download management
- Test shell spawning

---

### 2.3 file_editor (app/apps/file_editor/)

**Current State:**
- File: `main.py`
- Uses: Flask Blueprint, jsonify, request.args, request.get_json
- Routes: 3
  - `/` (GET) - status
  - `/read` (GET) - read file
  - `/write` (POST) - write file
- Has manifest.json (check if this is legacy - file_editor_cm6 exists)

**Decision Needed:**
- Is this a legacy app superseded by file_editor_cm6?
- If YES: Delete the entire app
- If NO: Migrate to FastAPI

**Migration Steps** (if keeping):
1. Blueprint → APIRouter
2. `request.args.get('path')` → `path: str = Query(...)`
3. `request.get_json(silent=True)` → `data: dict = Body(...)`
4. `jsonify({...})` → direct dict return
5. Error handling: `jsonify({...}), 400` → `raise HTTPException(status_code=400, detail=...)`

**Testing:**
- Test file reading
- Test file writing
- Verify no regressions vs file_editor_cm6

---

### 2.4 terminal (app/apps/terminal/)

**Current State:**
- File: `backend.py`
- Uses: Flask Blueprint, jsonify, request.get_json, request.args, flask_sock
- Routes: Multiple (check exact count)
- Has WebSocket endpoint: `/ws/terminal/<shell_id>` using flask-sock
- Has manifest with backend_blueprint

**Migration Steps:**
1. Blueprint → APIRouter
2. Convert all REST endpoints (pattern as above)
3. **WebSocket Migration** (CRITICAL):
   ```python
   # OLD (flask-sock):
   @sock.route('/ws/terminal/<shell_id>')
   def terminal_websocket(ws, shell_id):
       # ...
   
   # NEW (FastAPI):
   @terminal_bp.websocket('/ws/terminal/{shell_id}')
   async def terminal_websocket(websocket: WebSocket, shell_id: str):
       await websocket.accept()
       # Convert sync → async patterns
   ```
4. Replace `request.get_json` with `Body(...)`
5. Replace `request.args` with `Query(...)`
6. Handle WebSocket streaming (PTY output)

**Special Considerations:**
- Terminal uses PTY streaming - must test thoroughly
- WebSocket reconnection must work
- History replay must work

**Testing:**
- Create new terminal shell
- Test real-time PTY streaming
- Test terminal resize
- Test terminal history
- Test shell destruction

---

## Phase 3: Migrate Flask Extensions to FastAPI

### 3.1 network_tools (app/extensions/network_tools/)

**Current State:**
- File: `main.py`
- Uses: Flask Blueprint
- Need to audit routes and patterns

**Migration Steps:**
1. Blueprint → APIRouter
2. Follow same patterns as apps
3. Update extension loader if needed

---

### 3.2 process_manager (app/extensions/process_manager/)

**Current State:**
- File: `main.py`
- Uses: Flask Blueprint (`bp = Blueprint(...)`)
- Need to audit routes

**Migration Steps:**
1. Blueprint → APIRouter
2. Fix request/jsonify patterns
3. Test process listing/killing

---

### 3.3 sessions_and_shortcuts (app/extensions/sessions_and_shortcuts/)

**Current State:**
- File: `main.py`
- Uses: Flask Blueprint
- Routes: 5 (@route decorators with methods)
  - `/sessions` (GET)
  - `/shortcuts` (GET)
  - `/sessions/<sid>/command` (POST)
  - `/sessions/<sid>/shortcut` (POST)
  - `/sessions/<sid>` (DELETE)

**Migration Steps:**
1. Blueprint → APIRouter
2. Path params: `<string:sid>` → `{sid: str}`
3. Convert all Flask patterns
4. Test session management

---

## Phase 4: Remove Flask Dependencies

### 4.1 Update requirements.txt / pyproject.toml

**Remove:**
```
Flask
flask-sock
flask-cors (if present)
```

**Keep:**
```
fastapi
uvicorn
starlette
anyio
httpx
websockets
```

### 4.2 Verify No Flask Imports Remain

```bash
grep -r "from flask import\|import flask" app/ --include="*.py"
```

Should return **zero results**.

### 4.3 Update Documentation

- Update README.md
- Update deployment docs
- Update developer docs

---

## Phase 5: Update Worker Loading System

### 5.1 app_worker.py (Already ASGI)

**Current:** ✅ Already loads FastAPI apps
**Action:** No changes needed

### 5.2 Extension Loader

**File:** `app/main.py` (loads extensions)

**Check:** Does it still try to load Flask Blueprints?

**Action:** Audit and update if needed to:
```python
# Ensure all extensions are loaded as FastAPI routers
for ext in extensions:
    if hasattr(ext, 'router'):  # FastAPI pattern
        app.include_router(ext.router, prefix=f"/api/{ext.id}")
```

---

## Phase 6: Testing Matrix

### 6.1 Per-App Testing

| App | Start | Load UI | REST APIs | WebSockets | File Ops |
|-----|-------|---------|-----------|------------|----------|
| file_editor_cm6 | ✅ | ✅ | ✅ | ❌ (writes broken) | ❌ |
| file_explorer | ? | ? | ? | N/A | ? |
| archive_manager | ? | ? | ? | N/A | ? |
| aria_downloader | ? | ? | ? | N/A | ? |
| file_editor (legacy?) | ? | ? | ? | N/A | ? |
| terminal | ? | ? | ? | ❌ (not migrated) | N/A |

### 6.2 Extension Testing

| Extension | Load | Routes | Functionality |
|-----------|------|--------|---------------|
| network_tools | ? | ? | ? |
| process_manager | ? | ? | ? |
| sessions_and_shortcuts | ? | ? | ? |
| apps (extension) | ✅ | ✅ | ✅ |
| framework_shells | ✅ | ✅ | ✅ |
| bookmarks | ✅ | ✅ | ✅ |
| jobs | ✅ | ✅ | ✅ |

### 6.3 Integration Testing

- [ ] All apps start successfully
- [ ] All extensions load without errors
- [ ] WebSocket proxying works (main → worker)
- [ ] Worker processes spawn correctly
- [ ] Worker processes terminate cleanly (Issue 2 fixed)
- [ ] No Flask import errors
- [ ] Framework starts with no warnings

---

## Phase 7: Cleanup and Optimization

### 7.1 Remove Dead Code

**Files to potentially delete:**
- `app/apps/file_editor/` (if superseded by file_editor_cm6)
- Any Flask compatibility wrappers
- Unused Flask middleware

### 7.2 Consolidate Patterns

**Create helper functions for common patterns:**
```python
# app/libs/asgi_helpers.py

from fastapi import HTTPException
from typing import Any, Dict

def success_response(data: Any, status_code: int = 200) -> Dict:
    """Standard success response"""
    return {"ok": True, "data": data}

def error_response(message: str, status_code: int = 400):
    """Standard error response"""
    raise HTTPException(status_code=status_code, detail=message)
```

### 7.3 Update Coding Standards

**Document new patterns:**
- Always use APIRouter (not Blueprint)
- Always use FastAPI dependencies (not Flask request)
- Always return dicts (not jsonify)
- Always use HTTPException (not jsonify + status code)

---

## Execution Order

**DO NOT PARALLELIZE - Execute in strict sequence:**

1. ✅ Fix Issue 2 (worker cleanup) - DONE
2. ✅ Fix file_editor_cm6 imports - DONE  
3. ✅ Fix write endpoint keyword arg - DONE
4. ❌ Execute ASGI_MIGRATION_REFACTOR.md (Phase 1)
5. ❌ Migrate archive_manager (Phase 2.1)
6. ❌ Investigate + migrate/delete aria_downloader (Phase 2.2)
7. ❌ Investigate + migrate/delete file_editor (Phase 2.3)
8. ❌ Migrate terminal app (Phase 2.4) - COMPLEX
9. ❌ Migrate network_tools extension (Phase 3.1)
10. ❌ Migrate process_manager extension (Phase 3.2)
11. ❌ Migrate sessions_and_shortcuts extension (Phase 3.3)
12. ❌ Remove Flask from dependencies (Phase 4)
13. ❌ Full integration testing (Phase 6)
14. ❌ Cleanup dead code (Phase 7)

---

## Risk Assessment

### High Risk (Must Test Thoroughly)
- **terminal app WebSocket migration** - PTY streaming is complex
- **Worker spawning changes** - Could break all apps
- **Extension loading** - Could break framework startup

### Medium Risk
- **archive_manager** - File operations must be atomic
- **aria_downloader** - RPC communication must stay stable

### Low Risk
- **network_tools** - Simple utility routes
- **process_manager** - Process listing is read-only
- **sessions_and_shortcuts** - Session management is stateless

---

## Success Criteria

### Must Have (Blocking)
- ✅ Zero Flask imports in codebase
- ✅ All apps start successfully
- ✅ All WebSockets work (terminal, file_editor_cm6)
- ✅ File operations work (read, write, mkdir, delete)
- ✅ Worker processes spawn and terminate cleanly

### Should Have (Important)
- ✅ All extensions load
- ✅ No deprecation warnings
- ✅ Performance equal to or better than Flask

### Nice to Have (Optional)
- ✅ Code cleanup complete
- ✅ Documentation updated
- ✅ Helper library created

---

## Rollback Plan

If migration fails:
1. Revert to last known-good commit
2. Document failure reason
3. Create GitHub issue with details
4. Incremental migration instead of big-bang

**Git Strategy:**
- Commit after each app migration
- Tag stable states
- Keep Flask version in separate branch as backup

---

## Estimated Effort

| Phase | Effort | Risk |
|-------|--------|------|
| Phase 1 (run_sync fixes) | 30 min | Low |
| Phase 2.1 (archive_manager) | 2 hours | Medium |
| Phase 2.2 (aria_downloader) | 3 hours | Medium |
| Phase 2.3 (file_editor) | 1 hour or DELETE | Low |
| Phase 2.4 (terminal) | 4 hours | **HIGH** |
| Phase 3 (extensions) | 3 hours | Medium |
| Phase 4 (cleanup) | 1 hour | Low |
| Phase 5 (testing) | 4 hours | High |
| **TOTAL** | **18-20 hours** | |

---

## Next Actions

1. **User approval of this plan**
2. Create git branch: `feature/complete-asgi-migration`
3. Execute Phase 1 (run_sync fixes)
4. Test thoroughly
5. Proceed to Phase 2.1 (archive_manager)

**STOP AND CONFIRM BEFORE EACH PHASE**

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-05 19:49 UTC  
**Status:** AWAITING APPROVAL
