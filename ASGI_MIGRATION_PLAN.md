# ASGI Migration Plan (FastAPI/Starlette) for termux-extensions-2

Goal: migrate the main Flask+flask-sock app to an ASGI stack (FastAPI/Starlette on Uvicorn/Hypercorn) without breaking existing frontends. Preserve URLs, message formats, and JSON schemas exactly.

## Non‑negotiable invariants (keep unchanged)
- HTTP URLs and shapes:
  - Keep all public routes exactly as-is (paths, methods, query semantics, JSON envelopes).
  - Examples to preserve: `/`, `/api/extensions`, `/api/apps`, `/api/apps/<id>/start|quit|lock|unlock`, `/api/framework_shells*`, `/api/framework/runtime/*`, `/api/browse`, `/api/bookmarks` (GET/POST/PUT), `/api/settings`, `/api/state`, `/api/app/<app_id>/<subpath>` (HTTP proxy to worker), `/sw.js`, static serving rules.
- WebSocket URLs and protocol:
  - All WebSocket routes remain at the same paths (e.g., `/ws/read`, `/ws/edit_tracker`, `/ws/agent`, `/ws/terminal/<id>`)
  - JSON frame schema must be identical (no changes to message formats)
  - Query parameters and headers must be preserved

## Target architecture
- New ASGI entrypoint (e.g., `asgi_main.py`) with a FastAPI app.
- Mount existing Flask app via `starlette.middleware.wsgi.WSGIMiddleware` initially, so all REST endpoints work day 1.
- Incrementally port REST routes to native FastAPI routers (keep paths/methods/payloads identical). Remove WSGI mounting once parity is achieved.
- Re-implement WS endpoints and the WS proxy in ASGI (Starlette WebSocket or `websockets`), keeping URLs and payloads the same.
- Keep supervisor, framework shells, and app_manager logic; call them from ASGI handlers (sync wrappers allowed via `anyio.to_thread.run_sync`).

## Execution rules (read before starting)
1. **Process files in exact order listed** - Do not skip ahead, do not batch
2. **One file at a time** - Complete and validate each file before moving to next
3. **No assumptions** - If something is unclear, use ONLY what's explicitly in this document
4. **Preserve exact URLs** - Do not rename routes, do not change HTTP methods
5. **Preserve exact JSON** - Do not add fields, do not change key names
6. **Test after each file** - Run route introspection after each migration to verify no regressions
7. **Stop if uncertain** - Do not improvise; document the blocker and halt

## Phased plan (execute in strict order)

1) Migrate app/main.py Flask → FastAPI (skeleton only)
- **Step 2a**: Replace `app = Flask(__name__)` with `app = FastAPI()`
- **Step 2b**: Remove Flask imports (Flask, Blueprint registration helpers); add FastAPI imports
- **Step 2c**: Keep ALL global variables unchanged (RUN_ID, SETTINGS_FILE, loaded_extensions, etc.)
- **Step 2d**: Keep ALL helper functions unchanged (_load_settings, _save_settings, _load_state_store, etc.)
- **Step 2e**: Comment out all Flask route decorators (DO NOT delete them yet)
- **Step 2f**: Comment out `if __name__ == '__main__': app.run(...)` block
- **CHECKPOINT**: Document completion of step 2: FastAPI skeleton in app/main.py
  - Verify changes: `git diff app/libs/bookmarks.py app/main.py`

2) Port app/libs/bookmarks.py (smallest file first)
- **Step 3a**: Open app/libs/bookmarks.py
- **Step 3b**: Replace `Blueprint('bookmarks', __name__)` with `APIRouter()`
- **Step 3c**: Convert routes:
  - `@bookmarks_bp.route('/bookmarks', methods=['GET'])` → `@bookmarks_bp.get('/bookmarks')`
  - `@bookmarks_bp.route('/bookmarks', methods=['POST'])` → `@bookmarks_bp.post('/bookmarks')`
  - `@bookmarks_bp.route('/bookmarks', methods=['PUT'])` → `@bookmarks_bp.put('/bookmarks')`
- **Step 3d**: Replace `request.get_json(silent=True)` with FastAPI `Request` dependency
- **Step 3e**: Replace `jsonify(...)` with direct dict return
- **Step 3f**: In app/main.py, uncomment bookmarks registration, change to: `app.include_router(bookmarks_bp, prefix="/api")`
- **CHECKPOINT**: Document completion of step 3: Migrated app/libs/bookmarks.py to APIRouter
  - Verify changes: `git diff app/libs/framework_shells.py app/main.py`

3) Port app/libs/framework_shells.py
- **Step 4a**: Open app/libs/framework_shells.py
- **Step 4b**: Locate `framework_shells_bp` Blueprint
- **Step 4c**: Convert to APIRouter using same pattern as step 3
- **Step 4d**: Update all `@framework_shells_bp.route(...)` to `@framework_shells_bp.get/post/delete(...)`
- **Step 4e**: Replace Flask request/response helpers with FastAPI equivalents
- **Step 4f**: In app/main.py, change registration to: `app.include_router(framework_shells_bp)`
- **CHECKPOINT**: Document completion of step 4: Migrated app/libs/framework_shells.py to APIRouter
  - Verify changes: `git diff app/libs/jobs.py app/main.py`

4) Port app/libs/jobs.py
- **Repeat step 4 pattern for jobs_bp**
- **CHECKPOINT**: Document completion of step 5: Migrated app/libs/jobs.py to APIRouter
  - Verify changes: `git diff app/extensions/apps/main.py app/main.py`

5) Port app/extensions/apps/main.py
- **Step 6a**: Convert `apps_bp` Blueprint to APIRouter
- **Step 6b**: Migrate all routes (`/api/apps`, `/api/apps/<id>/start`, `/api/apps/<id>/quit`, etc.)
- **Step 6c**: Keep ensure_app_running() calls unchanged (sync wrapper OK)
- **Step 6d**: Keep `/app/<app_id>` route for app shell rendering
- **Step 6e**: Keep `/apps/<path:app_dir>/<path:filename>` static serving route
- **Step 6f**: In app/main.py, change registration to: `app.include_router(apps_bp, url_prefix="")`
- **CHECKPOINT**: Document completion of step 6: Migrated app/extensions/apps/main.py to APIRouter
  - Verify changes: `git diff app/apps/file_editor_cm6/main.py`

6) Port app/apps/file_editor_cm6/main.py (REST only, no WebSockets yet)
- **Step 7a**: Convert `file_editor_cm6_bp` Blueprint to APIRouter
- **Step 7b**: Migrate ALL REST routes (GET /read, POST /write, GET /diff, POST /project/open, etc.)
- **Step 7c**: DO NOT touch WebSocket routes yet (leave @sock.route commented)
- **Step 7d**: Keep all helper imports (_normalize_rel_path, _build_state_payload, etc.) unchanged
- **Step 7e**: Wrap sync operations (write_full, collect_diff) in anyio.to_thread.run_sync if needed
- **CHECKPOINT**: Document completion of step 7: Migrated file_editor_cm6/main.py REST routes to APIRouter
  - Verify changes: `git diff app/apps/file_editor_cm6/main.py`

7) Port file_editor_cm6 WebSocket: /ws/read
- **Step 8a**: Locate `@sock.route('/ws/read')` in file_editor_cm6/main.py
- **Step 8b**: Convert to: `@file_editor_cm6_bp.websocket('/ws/read')` (APIRouter supports websocket decorator)
- **Step 8c**: Change function signature: `async def ws_read(websocket: WebSocket):`
- **Step 8d**: Add at start: `await websocket.accept()`
- **Step 8e**: Replace `path = request.args.get('path')` with `path = websocket.query_params.get('path')`
- **Step 8f**: Replace subscribe callback `lambda event: ws.send(json.dumps(event))` with async queue pattern:
  - Create `asyncio.Queue()`, push events to queue, consume in async loop
- **Step 8g**: Replace `ws.receive()` with `await websocket.receive_text()` or `async for msg in websocket.iter_text()`
- **CHECKPOINT**: Document completion of step 8: Migrated /ws/read to Starlette WebSocket
  - Verify changes: `git diff app/apps/file_editor_cm6/main.py`

8) Port file_editor_cm6 WebSocket: /ws/edit_tracker
- **Repeat step 8 pattern for edit_tracker WebSocket**
- **CHECKPOINT**: Document completion of step 9: Migrated /ws/edit_tracker to Starlette WebSocket
  - Verify changes: `git diff app/apps/file_editor_cm6/agent_ws.py`

9) Port file_editor_cm6 WebSocket: /ws/agent
- **Step 10a**: Locate agent_ws.py and @sock.route('/ws/agent')
- **Step 10b**: Convert to Starlette WebSocket using same pattern
- **Step 10c**: Handle bidirectional streaming (agent events → client, client prompts → agent)
- **Step 10d**: Preserve conversation ID, session restore logic
- **CHECKPOINT**: Document completion of step 10: Migrated /ws/agent to Starlette WebSocket
  - Verify changes: `git diff app/apps/file_editor_cm6/terminal_backend.py`

10) Port file_editor_cm6 WebSocket: /ws/terminal/<id>
- **Step 11a**: Locate terminal_backend.py and terminal WebSocket route
- **Step 11b**: Convert PTY streaming to async (use asyncio subprocess or anyio)
- **CHECKPOINT**: Document completion of step 11: Migrated /ws/terminal/<id> to Starlette WebSocket
  - Verify changes: `git diff app/main.py`

11) Port /api/app/<app_id>/<subpath> HTTP proxy route
- **Step 12a**: Locate `@app.route('/api/app/<app_id>/<path:subpath>')` in app/main.py
- **Step 12b**: Convert to FastAPI with httpx streaming (see code example below)
- **Step 12c**: Preserve header forwarding (minus 'host'), query params, streaming response
- **CHECKPOINT**: Document completion of step 12: Migrated /api/app/<id>/<subpath> HTTP proxy to ASGI
  - Verify changes: `git diff app/main.py`

12) Port /ws/app/<app_id>/<route> WebSocket proxy route
- **Step 13a**: Locate `@sock.route('/ws/app/<app_id>/<path:subpath>')` in app/main.py
- **Step 13b**: Convert to Starlette WebSocket proxy (see code example below)
- **Step 13c**: Preserve query string forwarding, bidirectional message relay
- **CHECKPOINT**: Document completion of step 13: Migrated /ws/app/<id>/<route> WebSocket proxy to ASGI
  - Verify changes: `git diff app/main.py`

13) Port remaining main app routes
- **Step 14a**: Migrate routes in app/main.py (`/`, `/api/browse`, `/api/settings`, `/api/state`, `/sw.js`, etc.)
- **Step 14b**: Convert each `@app.route(...)` to `@app.get(...)` or `@app.post(...)`
- **Step 14c**: One route at a time, test after each
- **CHECKPOINT**: Document completion of step 14: Migrated all remaining main app routes to FastAPI
  - Verify changes: `git diff app/main.py requirements.txt`

14) Remove Flask/flask-sock dependencies
- **Step 15a**: Delete all commented Flask code from app/main.py
- **Step 15b**: Remove from requirements.txt: Flask, flask-sock, Werkzeug (if not needed by other deps)
- **Step 15c**: Add to requirements.txt: fastapi, starlette, uvicorn[standard], httpx, websockets
- **Step 15d**: Run: `pip install -r requirements.txt`
- **CHECKPOINT**: Document completion of step 15: Removed Flask dependencies, added ASGI stack
  - Final verification: `git status` and `git diff --stat`

15) Final deliverables
- **Step 16a**: Create migration report: MIGRATION_REPORT.md documenting all changes
- **Step 16b**: List all migrated routes and WebSocket endpoints
- **Step 16c**: Note any deviations or issues encountered
- **CHECKPOINT**: Document completion of step 16: Migration complete with report

## Deliverables
- Migrated app/main.py with FastAPI app instance
- All Flask Blueprints → FastAPI APIRouters:
  - app/extensions/apps/main.py
  - app/apps/file_editor_cm6/main.py
  - app/apps/file_explorer/main.py (if backend exists)
  - app/libs/bookmarks.py
  - app/libs/framework_shells.py (if routes)
  - app/libs/jobs.py
- All flask-sock WebSocket routes → Starlette WebSocket endpoints
- Route-parity report (tests/asgi_routes.json vs baseline)
- Smoke-test results (uvicorn + httpx)
- Migration report markdown summarizing changes, parity, and any deviations
- Updated requirements.txt (remove Flask, flask-sock; add fastapi, starlette, uvicorn, httpx, websockets)

## ASGI equivalents (implementation guide)

### HTTP proxy route (Flask → FastAPI + httpx)
```python
import httpx
from fastapi import Request
from fastapi.responses import StreamingResponse
import anyio

@app.api_route('/api/app/{app_id}/{subpath:path}', methods=['GET','POST','PUT','DELETE','PATCH','OPTIONS'])
async def proxy_app_request(app_id: str, subpath: str, request: Request):
    # Call ensure_app_running (sync, wrap in anyio)
    app_info = await anyio.to_thread.run_sync(ensure_app_running, app_id)
    if not app_info or not app_info.get('port'):
        return JSONResponse({"ok": False, "error": "App has no backend or is not running."}, status_code=404)
    
    port = app_info['port']
    url = f"http://127.0.0.1:{port}/{subpath}"
    
    # Forward headers minus 'host'
    headers = {k: v for k, v in request.headers.items() if k.lower() != 'host'}
    body = await request.body()
    
    async with httpx.AsyncClient() as client:
        resp = await client.request(
            method=request.method,
            url=url,
            params=request.query_params,
            headers=headers,
            content=body,
            timeout=30.0,
        )
    
    # Strip hop-by-hop headers
    excluded = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}
    resp_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded}
    
    return StreamingResponse(
        resp.iter_bytes(chunk_size=10240),
        status_code=resp.status_code,
        headers=resp_headers,
    )
```

### WebSocket proxy route (flask-sock → Starlette + websockets)
```python
from starlette.websockets import WebSocket, WebSocketDisconnect
import websockets
import asyncio

@app.websocket('/ws/app/{app_id}/{route:path}')
async def proxy_app_websocket(websocket: WebSocket, app_id: str, route: str):
    await websocket.accept()
    
    # Call ensure_app_running (sync)
    app_info = await anyio.to_thread.run_sync(ensure_app_running, app_id)
    if not app_info or not app_info.get('port'):
        await websocket.close()
        return
    
    port = app_info['port']
    query = websocket.scope['query_string'].decode('utf-8')
    worker_url = f"ws://127.0.0.1:{port}/ws/{route}"
    if query:
        worker_url += f"?{query}"
    
    try:
        async with websockets.connect(worker_url) as worker_ws:
            async def forward_client_to_worker():
                try:
                    async for msg in websocket.iter_text():
                        await worker_ws.send(msg)
                except WebSocketDisconnect:
                    pass
            
            async def forward_worker_to_client():
                try:
                    async for msg in worker_ws:
                        await websocket.send_text(msg)
                except:
                    pass
            
            await asyncio.gather(
                forward_client_to_worker(),
                forward_worker_to_client(),
                return_exceptions=True,
            )
    except Exception:
        await websocket.close()
```

### In-process WebSocket (flask-sock → Starlette)
```python
# Flask-sock version:
@sock.route('/ws/read')
def ws_read(ws):
    path = request.args.get('path')
    # ... subscribe, send events via ws.send(json.dumps(event)) ...

# ASGI equivalent:
@app.websocket('/ws/read')
async def asgi_ws_read(websocket: WebSocket):
    await websocket.accept()
    path = websocket.query_params.get('path')
    # ... subscribe, send events via await websocket.send_text(json.dumps(event)) ...
    # Use asyncio.Queue or anyio for pub/sub if needed
```

## Implementation notes for the agent
- Keep environment/flags:
  - `TE_RUN_ID`, `TE_FRAMEWORK_SHELL_*` (framework shell management)
- CORS: localhost single-user; keep permissive defaults or mirror existing behavior
- Static: preserve `/sw.js` and static MIME types (e.g., `.js`/`.mjs` as application/javascript)
- Error reporting: keep JSON envelopes: `{"ok": False, "error": "..."}` where applicable

## Files requiring migration (must read and port)
- **app/main.py**: Flask app → FastAPI app; port all main routes, blueprint/router loading, sock → Starlette WS
- **app/extensions/apps/main.py**: Flask Blueprint → FastAPI APIRouter
- **app/apps/file_editor_cm6/main.py**: Flask Blueprint + flask-sock routes → FastAPI APIRouter + Starlette WebSocket
- **app/apps/file_explorer/main.py** (if exists): Flask Blueprint → FastAPI APIRouter
- **app/libs/bookmarks.py**: Flask Blueprint → FastAPI APIRouter
- **app/libs/framework_shells.py**: Flask Blueprint → FastAPI APIRouter (if routes exist)
- **app/libs/jobs.py**: Flask Blueprint → FastAPI APIRouter

## Files of interest (context)
- WebSocket design: `docs/core/websockets.md`
- Picker: `app/static/js/file_picker.js`, bookmarks at `/api/bookmarks`
- Repo overview: `README.md`, `REPO_STRUCTURE.md`

## What NOT to do (critical)
- **DO NOT** batch-migrate files (one at a time only)
- **DO NOT** rename routes or change HTTP methods
- **DO NOT** add new fields to JSON responses
- **DO NOT** change WebSocket message formats
- **DO NOT** modify app/static/vendor/ (out of scope)
- **DO NOT** touch frontend JavaScript files
- **DO NOT** improvise or assume—follow the plan exactly

## Git validation commands (allowed for verification only)
You may use ONLY these read-only git commands to verify your changes:
- `git status` - Check which files have been modified
- `git diff` - View changes against the last commit
- `git diff <file>` - View changes to a specific file
- `git diff --stat` - Summary of changed files

**PROHIBITED git commands** (never use these):
- `git add`, `git commit`, `git push`, `git pull`
- `git checkout`, `git switch`, `git branch`
- `git reset`, `git revert`, `git cherry-pick`
- `git merge`, `git rebase`, `git stash`
- Any command that modifies the git state

## Testing note
**DO NOT run any tests during migration.** Testing will be handled by a separate process after the migration is complete.

## How to run after migration
- Install deps: `pip install fastapi starlette uvicorn httpx websockets` (+ existing requirements)
- Run ASGI app: `uvicorn app.main:app --host 0.0.0.0 --port 8088`
- Entry point is app/main.py (migrated Flask → FastAPI in-place)

---
This plan preserves reverse proxying, WS variable propagation, and the minimal-frontend goal. Follow invariants strictly; produce a migration report documenting all changes.