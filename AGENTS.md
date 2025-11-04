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
- Add `asgi_main.py` (Uvicorn entry) and minimal FastAPI app; mount Flask app under `/` via WSGI middleware so nothing breaks.

2) HTTP proxy + core REST in ASGI
- Implement ASGI-native proxy for `/api/app/<app_id>/<subpath>` using httpx streaming (preserve headers minus hop-by-hop, forward method/body/query, set `X-App-Worker-Port`).
- Port `/api/extensions`, `/api/apps*`, `/api/framework_shells*`, `/api/framework/runtime/*`, `/api/browse`, `/api/bookmarks`, `/api/settings`, `/api/state`, and `/api/app/file_explorer/mkdir` to FastAPI with 1:1 request/response JSON.
- Keep Flask-mounted versions temporarily to compare; guard with feature flag to avoid double-registration.

3) WebSockets in ASGI
- Implement `/ws/app/<app_id>/<route>` proxy in ASGI: accept client WS; connect to worker WS (`ws://127.0.0.1:{port}/ws/<route>?query`) using an async client; forward frames bidirectionally; close both on error.
- Port any direct main-app WS routes (`/ws/<route>`) 1:1 to Starlette.
- Remove flask-sock usage once ASGI WS is verified.

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
- `asgi_main.py` (Uvicorn entry) and FastAPI app scaffolding.
- ASGI routers for ported endpoints; WSGI mount for unported ones.
- ASGI WS proxy (`/ws/app/<id>/*`) and any direct WS routes ported.
- Route-parity and smoke-test scripts with instructions and logs.
- Migration report markdown summarizing endpoint/WS parity and any deviations.

## Implementation notes for the agent
- Keep environment/flags:
  - `TE_RUN_ID`, `TE_FRAMEWORK_SHELL_*`, `TE_NICEGUI_DEBUG(_PORT)`, `TE_MAIN_BASE_URL`.
- Reverse proxy rules:
  - HTTP: `/api/app/<app_id>/<subpath>` → `http://127.0.0.1:{port}/{subpath}` (streaming, preserve query string; strip hop-by-hop headers; set `X-App-Worker-Port`).
  - WS: `/ws/app/<app_id>/<route>` → `ws://127.0.0.1:{port}/ws/<route>` (preserve query string; forward both directions; handle close).
- CORS: localhost single-user; keep permissive defaults or mirror existing behavior.
- Static: preserve `/sw.js` and static MIME types (e.g., `.js`/`.mjs` as application/javascript).
- Error reporting: keep JSON envelopes: `{ ok: False, error: "..." }` where applicable.

## Files of interest (context the agent should read)
- Main app: `app/main.py`, `app/libs/framework_shells.py`, `app/libs/app_manager.py`, `app/extensions/apps/main.py`.
- NiceGUI worker: `app/apps/nicegui_shell/worker.py` (debug ports, TE_MAIN_BASE_URL, picker wiring).
- WebSocket design: `docs/core/websockets.md`.
- Picker: `app/static/js/file_picker.js`, bookmarks at `/api/bookmarks`.
- Repo overview: `README.md`, `REPO_STRUCTURE.md`.

## Success criteria checklist
- [ ] All historical REST URLs respond with the same status codes and JSON fields (sampled) as before.
- [ ] WS proxy works for app workers at unchanged URLs; message protocol unchanged.
- [ ] `/app/<id>` redirect path works; debug port override still respected.
- [ ] Picker operates (bookmarks/browse/mkdir) when worker is launched on a separate port.
- [ ] Route parity report shows no missing endpoints.
- [ ] CI smoke tests (uvicorn + httpx) pass.

## How to run (for the PR container)
- Install deps: `pip install fastapi starlette uvicorn httpx websockets` (+ existing requirements).
- Run ASGI app: `uvicorn asgi_main:app --host 0.0.0.0 --port 8080`.
- Optional: keep `wsgi.py` for legacy Gunicorn; do not remove.

## Out of scope / non-goals
- Visual changes to UI/NiceGUI.
- Rewriting NiceGUI worker; only main app migration.
- Changing public URLs or JSON shapes.

---
This plan preserves reverse proxying, WS variable propagation, and the minimal-frontend goal. Follow invariants strictly; produce a migration report and parity artifacts in the PR.