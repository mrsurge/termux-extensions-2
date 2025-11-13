# ASGI Migration - Supplementary Work Required

**Date**: 2025-11-05  
**Status**: Initial agent migration incomplete - 2 files missed

---

## CRITICAL: What NOT to Do

**DO NOT run any of the following commands:**
- `pip install`, `pip uninstall`, `pip freeze` - NO package installation/modification
- `git add`, `git commit`, `git push`, `git checkout`, `git reset`, `git restore` - NO git state changes
- `uvicorn`, `python app/main.py` - NO application startup
- `curl`, `wget`, `httpx` - NO HTTP requests or testing
- `pytest`, `unittest`, ANY testing commands - NO testing whatsoever

**You may ONLY:**
- Edit Python files
- Use `git diff` and `git status` to view changes (read-only)

---

## Overview

The automated agent migration completed 90% of the Flask → FastAPI/ASGI conversion but **missed 2 critical files** with a total of **22 REST endpoints**. These files must be manually migrated before the application will function.

---

## Files Requiring Manual Migration

### 1. app/apps/file_editor_cm6/agent_routes.py

**Status**: Still using Flask - NOT migrated  
**Impact**: Agent drawer completely broken  
**Routes affected**: 11 REST endpoints

#### Current State
```python
from flask import jsonify, request

# Blueprint still Flask
bp = Blueprint(...)

# All routes still Flask syntax
@bp.post('/agent/create')
@bp.get('/agent/list')
@bp.get('/agent/<session_id>')
@bp.post('/agent/send_raw')
@bp.get('/preferences/get')
@bp.post('/preferences/set')
@bp.get('/agent/sessions')
@bp.get('/agent/session/<session_id>')
@bp.post('/agent/sessions')
@bp.post('/agent/session/<session_id>/send')
@bp.get('/agent/shell/status')
```

#### Required Changes

**Step 1**: Update imports
```python
# Remove
from flask import jsonify, request

# Add
from fastapi import APIRouter, Request, HTTPException, Body, Query
from fastapi.responses import JSONResponse
```

**Step 2**: Convert Blueprint to APIRouter
```python
# Remove
bp = Blueprint('agent', __name__)

# Add
bp = APIRouter()
```

**Step 3**: Convert route decorators
```python
# Flask style
@bp.post('/agent/create')
def create_agent():
    data = request.get_json()
    return jsonify({"ok": True, "data": result})

# FastAPI style
@bp.post('/agent/create')
async def create_agent(request: Request):
    data = await request.json()
    return {"ok": True, "data": result}
```

**Step 4**: Convert path parameters
```python
# Flask style
@bp.get('/agent/<session_id>')
def get_agent(session_id):
    ...

# FastAPI style
@bp.get('/agent/{session_id}')
async def get_agent(session_id: str):
    ...
```

**Step 5**: Remove all `jsonify()` calls
```python
# Flask
return jsonify({"ok": True, "data": x})

# FastAPI (direct dict return)
return {"ok": True, "data": x}
```

**Step 6**: Update request body handling
```python
# Flask
data = request.get_json(silent=True)

# FastAPI
data = await request.json()
# OR use Pydantic models
```

**Step 7**: Wrap sync operations if needed
```python
# If calling blocking I/O
import anyio
result = await anyio.to_thread.run_sync(blocking_function, arg1, arg2)
```

**Step 8**: Re-enable registration in main.py
```python
# Currently commented out in file_editor_cm6/main.py:
# register_agent_routes(file_editor_cm6_bp)

# Uncomment and verify it includes the router
from .agent_routes import bp as agent_routes_bp
file_editor_cm6_bp.include_router(agent_routes_bp)
```

---

### 2. app/apps/file_explorer/file_explorer.py

**Status**: Still using Flask - NOT migrated  
**Impact**: File explorer completely broken  
**Routes affected**: 11 REST endpoints

#### Current State
```python
from flask import Blueprint, jsonify, request

file_explorer_bp = Blueprint("file_explorer_app", __name__)

# All routes still Flask syntax
@file_explorer_bp.route('/list', methods=['GET'])
@file_explorer_bp.route('/mkdir', methods=['POST'])
@file_explorer_bp.route('/delete', methods=['POST'])
@file_explorer_bp.route('/rename', methods=['POST'])
@file_explorer_bp.route('/copy', methods=['POST'])
@file_explorer_bp.route('/move', methods=['POST'])
@file_explorer_bp.route('/resolve_symlink', methods=['GET'])
@file_explorer_bp.route('/properties', methods=['GET'])
@file_explorer_bp.route('/chmod', methods=['POST'])
@file_explorer_bp.route('/extract', methods=['POST'])
@file_explorer_bp.route('/chown', methods=['POST'])
```

#### Required Changes

**Step 1**: Update imports
```python
# Remove
from flask import Blueprint, jsonify, request

# Add
from fastapi import APIRouter, Request, HTTPException, Body, Query
from fastapi.responses import JSONResponse
```

**Step 2**: Convert Blueprint to APIRouter
```python
# Remove
file_explorer_bp = Blueprint("file_explorer_app", __name__)

# Add
file_explorer_bp = APIRouter()
```

**Step 3**: Convert route decorators
```python
# Flask style
@file_explorer_bp.route('/list', methods=['GET'])
def list_directory():
    path = request.args.get('path')
    return jsonify({"ok": True, "data": result})

# FastAPI style
@file_explorer_bp.get('/list')
async def list_directory(path: str = Query(...)):
    return {"ok": True, "data": result}
```

**Step 4**: Convert POST body handling
```python
# Flask style
@file_explorer_bp.route('/mkdir', methods=['POST'])
def make_directory():
    data = request.get_json()
    path = data.get('path')
    name = data.get('name')

# FastAPI style
@file_explorer_bp.post('/mkdir')
async def make_directory(request: Request):
    data = await request.json()
    path = data.get('path')
    name = data.get('name')
```

**Step 5**: Remove all `jsonify()` calls

**Step 6**: Wrap sync file operations
```python
import anyio
# Wrap os.makedirs, os.remove, shutil operations
result = await anyio.to_thread.run_sync(os.makedirs, path, exist_ok=True)
```

**Step 7**: Verify registration in main.py
```python
# Check that file_explorer is registered
# Should be included via app.include_router or similar
```

---

## Migration Checklist

### agent_routes.py
- [ ] Update imports (Flask → FastAPI)
- [ ] Convert Blueprint → APIRouter
- [ ] Convert all 11 route decorators
- [ ] Update path parameters (`<id>` → `{id}`)
- [ ] Remove `jsonify()` calls
- [ ] Update `request.get_json()` → `await request.json()`
- [ ] Wrap sync operations in `anyio.to_thread.run_sync`
- [ ] Re-enable registration in file_editor_cm6/main.py


### file_explorer.py
- [ ] Update imports (Flask → FastAPI)
- [ ] Convert Blueprint → APIRouter
- [ ] Convert all 11 route decorators
- [ ] Update query params to use `Query(...)`
- [ ] Remove `jsonify()` calls
- [ ] Update `request.get_json()` → `await request.json()`
- [ ] Wrap file I/O in `anyio.to_thread.run_sync`
- [ ] Verify registration in main.py


---

## Why These Were Missed

1. **agent_routes.py**: Agent likely didn't scan for `register_agent_routes()` call in main.py (it was a function call, not direct import)

2. **file_explorer.py**: File explorer wasn't explicitly called out in the step-by-step plan beyond "if backend exists"

---

## Estimated Time

- **agent_routes.py**: 30-45 minutes
- **file_explorer.py**: 30-45 minutes

- **Total**: 60-90 minutes

---

## Next Steps

1. Manually migrate agent_routes.py following the pattern above
2. Manually migrate file_explorer.py following the pattern above
3. Run `git diff` to verify changes
4. Document completion - DO NOT test, DO NOT install packages, DO NOT commit

---

**Last Updated**: 2025-11-05
