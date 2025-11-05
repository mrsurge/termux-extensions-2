# ASGI Migration Plan (FastAPI/Starlette) for termux-extensions-2

Goal: migrate the main Flask+flask-sock app to an ASGI stack (FastAPI/Starlette on Uvicorn/Hypercorn) without breaking existing frontends (NiceGUI workers, browser clients). Preserve URLs, message formats, and the on-demand worker model. Deliver as a PR on a feature branch.

## Non‑negotiable invariants (keep unchanged)
- HTTP URLs and shapes:
  - Keep all public routes exactly as-is (paths, methods, query semantics, JSON envelopes).
  - Examples to preserve: `/`, `/api/extensions`, `/api/apps`, `/api/apps/<id>/start|quit|lock|unlock`, `/api/framework_shells*`, `/api/framework/runtime/*`, `/api/browse`, `/api/bookmarks` (GET/POST/PUT), `/api/settings`, `/api/state`, `/api/app/<app_id>/<subpath>` (HTTP proxy to worker), `/sw.js`, static serving rules.
- WebSocket URLs and protocol:
  - Direct WS (main app): `/ws/<route>`
  - Proxied WS (workers): client connects to `/ws/app/<app_id>/<route>` → proxy to `ws://127.0.0.1:{worker_port}/ws/<route>` (preserve query string and headers). JSON frame schema must be identical.
- On-demand worker model intact: nicegui_shell/worker.py remains; manifests keep `entrypoints.nicegui_shell`.
- Debug ergonomics intact:
  - `TE_NICEGUI_DEBUG=1` → force port 12234 (or `TE_NICEGUI_DEBUG_PORT`) in the NiceGUI worker.
  - `TE_MAIN_BASE_URL` propagated when launching a worker; worker injects a fetch() rewrite so `/api/*` calls target the main app origin.

## Target architecture
- New ASGI entrypoint (e.g., `asgi_main.py`) with a FastAPI app.
- Mount existing Flask app via `starlette.middleware.wsgi.WSGIMiddleware` initially, so all REST endpoints work day 1.
- Incrementally port REST routes to native FastAPI routers (keep paths/methods/payloads identical). Remove WSGI mounting once parity is achieved.
- Re-implement WS endpoints and the WS proxy in ASGI (Starlette WebSocket or `websockets`), keeping URLs and payloads the same.
- Keep supervisor, framework shells, and app_manager logic; call them from ASGI handlers (sync wrappers allowed via `anyio.to_thread.run_sync`).

## Phased plan
1) Branch setup
- Create `asgi-migration` branch from current working branch.
- Replace Flask app in app/main.py with a FastAPI app instance.
- Keep all imports, globals (RUN_ID, settings, framework shells, etc.) unchanged.

2) Core REST + app blueprints in ASGI
- Port main app routes to FastAPI:
  - `/api/extensions`, `/api/apps*`, `/api/framework_shells*`, `/api/framework/runtime/*`, `/api/browse`, `/api/bookmarks`, `/api/settings`, `/api/state`, `/api/app/file_explorer/mkdir`
- Port app blueprints to FastAPI APIRouter:
  - **file_editor_cm6**: Convert app/apps/file_editor_cm6/main.py Flask Blueprint → FastAPI APIRouter; preserve all route paths, methods, JSON schemas
  - **file_explorer**: Convert app/apps/file_explorer/*.py Flask Blueprint → FastAPI APIRouter (if backend exists)
  - **extensions/apps**: Convert app/extensions/apps/main.py Flask Blueprint → FastAPI APIRouter
- Blueprint → APIRouter conversion:
  - `Blueprint('name', __name__)` → `APIRouter()`
  - `@bp.route('/path')` → `@router.get('/path')` or `@router.post('/path')`
  - `request.get_json()` → FastAPI `Request` param or Pydantic models
  - `jsonify(...)` → return dict (FastAPI auto-serializes)
  - Keep route registration logic in app/main.py: scan manifests, import modules, include routers via `app.include_router(router)`

3) WebSockets in ASGI
- Port file_editor_cm6 WebSockets to Starlette:
  - `@sock.route('/ws/read')` → `@app.websocket('/ws/read')` (or `@router.websocket('/ws/read')` if using APIRouter)
  - Replace `ws.send(json.dumps(...))` with `await websocket.send_text(json.dumps(...))`
  - Replace `ws.receive()` with `await websocket.receive_text()` or `async for msg in websocket.iter_text()`
  - Handle async pub/sub (file watcher, edit tracker) via `asyncio.Queue` or `anyio` primitives
- Port any main-app direct WS routes (`/ws/<route>`) 1:1 to Starlette.
- Implement `/ws/app/<app_id>/<route>` proxy if external workers exist (not currently in scope).
- Remove flask-sock dependency once all WS endpoints are ported.

4) NiceGUI worker integration (unchanged behavior)
- Keep `app/apps/nicegui_shell/worker.py` logic intact; respect `TE_NICEGUI_DEBUG(_PORT)` and keep `/te-js/file_picker.js` serving and `TE_MAIN_BASE_URL` fetch rewrite.
- Ensure the main app sets `TE_MAIN_BASE_URL` when launching a debug worker via extensions/apps main routes (already handled today).

5) Guardrails & tests (what to run in the PR container)
- Route parity dump:
  - Script A: introspect current Flask app routes (path, methods) and save to `tests/baseline_routes.json`.
  - Script B: introspect ASGI app routes and save to `tests/asgi_routes.json`.
  - Compare; must match (allow ordering differences). For mounted WSGI phase, both should match immediately; after ports, match must remain.
- Sample response parity:
  - For a fixed set of endpoints (GET `/api/extensions`, `/api/apps`, `/api/framework/runtime/metrics`, `/api/browse?path=~`), assert JSON shape keys exist and HTTP status codes match.
- Proxy smoke tests:
  - Launch a NiceGUI worker with `TE_NICEGUI_DEBUG=1` (port 12234) for the code app; hit `/app/<id>` to confirm redirect works; validate that the worker fetch rewrite (`TE_MAIN_BASE_URL`) allows picker calls to `/api/bookmarks` and `/api/browse` through the main app.
  - Exercise `/api/app/<id>/...` HTTP proxy: GET a known asset through proxy and compare sizes.
- WS proxy parity:
  - If a simple echo WS exists, connect via `/ws/app/<id>/<route>` and exchange frames.
  - Otherwise, implement a minimal WS echo handler under ASGI temporarily for CI and remove post-merge.

6) Deliverables in PR
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

### HTTP reverse proxy → ASGI (httpx + StreamingResponse)
```python
import httpx
from fastapi import Request, Response
from fastapi.responses import StreamingResponse

@app.api_route('/api/app/{app_id}/{subpath:path}', methods=['GET','POST','PUT','DELETE','PATCH','OPTIONS'])
async def asgi_proxy_app_request(app_id: str, subpath: str, request: Request):
    # Call ensure_app_running (sync, wrap in anyio.to_thread.run_sync if needed)
    app_info = ensure_app_running(app_id)
    if not app_info or not app_info.get('port'):
        return JSONResponse({"ok": False, "error": "..."}, status_code=404)
    
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
    resp_headers['X-App-Worker-Port'] = str(port)
    
    return StreamingResponse(
        resp.iter_bytes(chunk_size=10240),
        status_code=resp.status_code,
        headers=resp_headers,
    )
```

### WebSocket reverse proxy → ASGI (Starlette WebSocket + websockets)
```python
from starlette.websockets import WebSocket, WebSocketDisconnect
import websockets

@app.websocket('/ws/app/{app_id}/{route:path}')
async def asgi_proxy_app_websocket(websocket: WebSocket, app_id: str, route: str):
    await websocket.accept()
    
    # Call ensure_app_running (sync)
    app_info = ensure_app_running(app_id)
    if not app_info or not app_info.get('port'):
        await websocket.close()
        return
    
    port = app_info['port']
    query = websocket.scope['query_string'].decode('utf-8')
    worker_url = f"ws://127.0.0.1:{port}/ws/{route}"
    if query:
        worker_url += f"?{query}"
    
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
        
        import asyncio
        await asyncio.gather(
            forward_client_to_worker(),
            forward_worker_to_client(),
            return_exceptions=True,
        )
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
  - `TE_RUN_ID`, `TE_FRAMEWORK_SHELL_*`, `TE_NICEGUI_DEBUG(_PORT)`, `TE_MAIN_BASE_URL`.
- Reverse proxy rules:
  - HTTP: `/api/app/<app_id>/<subpath>` → `http://127.0.0.1:{port}/{subpath}` (streaming, preserve query string; strip hop-by-hop headers; set `X-App-Worker-Port`).
  - WS: `/ws/app/<app_id>/<route>` → `ws://127.0.0.1:{port}/ws/<route>` (preserve query string; forward both directions; handle close).
- CORS: localhost single-user; keep permissive defaults or mirror existing behavior.
- Static: preserve `/sw.js` and static MIME types (e.g., `.js`/`.mjs` as application/javascript).
- Error reporting: keep JSON envelopes: `{ ok: False, error: "..." }` where applicable.

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

## Success criteria checklist
- [ ] All historical REST URLs respond with the same status codes and JSON fields (sampled) as before.
- [ ] WS proxy works for app workers at unchanged URLs; message protocol unchanged.
- [ ] `/app/<id>` redirect path works; debug port override still respected.
- [ ] Picker operates (bookmarks/browse/mkdir) when worker is launched on a separate port.
- [ ] Route parity report shows no missing endpoints.
- [ ] CI smoke tests (uvicorn + httpx) pass.

## How to run (for the PR container)
- Install deps: `pip install fastapi starlette uvicorn httpx websockets` (+ existing requirements).
- Run ASGI app: `uvicorn app.main:app --host 0.0.0.0 --port 8080` (or via scripts/run_framework.sh if updated to use uvicorn).
- Entry point is app/main.py (migrate Flask → FastAPI in-place).

---
This plan preserves reverse proxying, WS variable propagation, and the minimal-frontend goal. Follow invariants strictly; produce a migration report and parity artifacts in the PR.