# ASGI Migration Plan: Flask + NiceGUI Unified Host

## Executive Summary

**Goal**: Run Flask (main app + worker orchestration) and NiceGUI apps under a single ASGI server on one port (8088), eliminating WebSocket proxy issues and enabling native WS support.

**Strategy**: Keep Flask as-is (WSGI), wrap it with `WsgiToAsgi`, and mount it alongside NiceGUI/Starlette routes under Uvicorn/Hypercorn.

## Why ASGI?

- **WSGI cannot handle WebSockets natively** - Flask uses WSGI, which is HTTP-only
- **ASGI supports HTTP + WebSockets** - Unified protocol for both
- **NiceGUI is FastAPI/Starlette-based** - Already ASGI-native
- **No Flask rewrite needed** - Flask runs unchanged inside ASGI via adapter

## Current Architecture

```
Flask (WSGI) on port 8088
  ├─ Main app routes (/, /api/*, etc.)
  ├─ Worker proxy (spawns Flask workers on random ports)
  └─ flask-sock WebSockets (limited, WSGI-based)

NiceGUI Worker (separate process)
  └─ Runs on random port, proxied by main Flask
  └─ WebSockets fail due to proxy complications
```

## Target Architecture

```
Uvicorn (ASGI) on port 8088
  ├─ "/" → Flask (wrapped with WsgiToAsgi)
  │   ├─ Main app routes
  │   ├─ Worker orchestration
  │   └─ API endpoints
  │
  ├─ "/ws/*" → Native ASGI WebSocket routes
  │   └─ Message bus, real-time events, etc.
  │
  └─ "/nice_code_cm6" → NiceGUI app (FastAPI/Starlette)
      └─ Native WebSockets (Socket.IO via Engine.IO)
```

## Dependencies

Already installed:
- Flask
- NiceGUI
- requests

Need to verify/add:
- `uvicorn` or `hypercorn` (ASGI server)
- `asgiref` (provides WsgiToAsgi adapter)
- `starlette` (for ASGI routing, may come with NiceGUI)

## Implementation Phases

### Phase 1: ASGI Host Setup (Main App)

**File**: `app/asgi_main.py` (new file)

Create a new ASGI entry point that:
1. Wraps the existing Flask app with `WsgiToAsgi`
2. Creates a Starlette/FastAPI router as the "umbrella"
3. Mounts Flask at `/`
4. Adds placeholder for WebSocket routes at `/ws/*`
5. Returns the combined ASGI app

**Changes to `app/main.py`**:
- No changes needed initially
- Flask app continues to work as-is
- All existing routes, blueprints, extensions stay identical

**New startup script**: `scripts/run_asgi_framework.sh`
- Launches `uvicorn app.asgi_main:asgi_app --port 8088 --host 127.0.0.1`
- Replaces `python -m app.supervisor` for ASGI mode
- Supervisor logic can wrap this or be integrated

### Phase 2: NiceGUI App Integration

**File**: `app/apps/nice_code_cm6/main.py`

Modify NiceGUI app to:
1. Export a Starlette/FastAPI sub-app instead of running standalone
2. Configure `engineio_path` to match the mount point (e.g., `/nice_code_cm6/_nicegui_ws`)
3. Remove `ui.run()` - the ASGI host will serve it

**Changes to `app/asgi_main.py`**:
1. Import the NiceGUI app
2. Mount it at `/nice_code_cm6` using Starlette's `Mount`
3. Configure root_path and Socket.IO paths to match

**Result**: NiceGUI WebSockets work natively, no proxy needed.

### Phase 3: Worker Process Updates

**File**: `app/libs/app_worker.py`

Update worker launcher to:
1. Detect if an app needs ASGI (check for `is_asgi=true` in manifest or module attribute)
2. For ASGI apps: Launch with `uvicorn app.apps.{app_id}.main:asgi_app --port {port}`
3. For Flask apps: Keep existing `python -m app.libs.app_worker` launcher

**File**: `app/libs/app_manager.py`

Update proxy logic:
1. For ASGI apps: Proxy normally (ASGI servers handle WS upgrades)
2. For Socket.IO paths: Add special handling for `/_nicegui_ws/*` or custom `engineio_path`
3. Ensure `Upgrade: websocket` headers pass through

### Phase 4: Supervisor Integration

**File**: `app/supervisor.py`

Update supervisor to:
1. Launch `uvicorn app.asgi_main:asgi_app` instead of `python -m app.main`
2. Keep all existing process management (workers, cleanup, SIGTERM handling)
3. Update signal handling to gracefully shutdown Uvicorn

**File**: `scripts/run_framework.sh`

Update to:
1. Call supervisor with ASGI mode flag
2. Or directly launch Uvicorn with supervisor in background

### Phase 5: WebSocket Migration (Optional)

**Current**: Flask-sock provides `/ws/...` endpoints (WSGI-based, limited)

**Future**: Replace with native ASGI WebSocket routes in `app/asgi_main.py`
- More reliable
- Better performance
- Standard ASGI interface

**Not required for Phase 1-4** - can be done incrementally.

## File Changes Summary

### New Files
- `app/asgi_main.py` - ASGI umbrella app
- `scripts/run_asgi_framework.sh` - ASGI launcher

### Modified Files
- `app/apps/nice_code_cm6/main.py` - Export ASGI app instead of running standalone
- `app/libs/app_worker.py` - Add ASGI worker launcher
- `app/libs/app_manager.py` - Update proxy for ASGI/WS
- `app/supervisor.py` - Launch Uvicorn instead of Flask
- `scripts/run_framework.sh` - Call ASGI launcher
- `requirements.txt` - Add uvicorn, asgiref (if missing)

### Unchanged Files
- `app/main.py` - Flask app stays identical
- All extensions, blueprints, libs - No changes needed
- Existing Flask workers - Keep working as-is

## Testing Plan

### Step 1: Test ASGI Wrapper
- Create `app/asgi_main.py` with Flask mounted at `/`
- Launch with `uvicorn app.asgi_main:asgi_app --port 8088`
- Verify all existing Flask routes work (/, /api/*, etc.)

### Step 2: Test NiceGUI Mount
- Modify `nice_code_cm6/main.py` to export sub-app
- Mount at `/nice_code_cm6` in ASGI host
- Verify UI loads, buttons work, Socket.IO connects

### Step 3: Test Worker Proxy
- Launch a Flask worker via app_manager
- Verify proxy still works for Flask workers
- Launch NiceGUI worker, verify WebSockets work

### Step 4: Test Supervisor
- Update supervisor to launch Uvicorn
- Verify process lifecycle (startup, shutdown, cleanup)
- Test SIGTERM, framework shell cleanup

## Migration Risks & Mitigations

### Risk: Flask middleware incompatibility with ASGI wrapper
- **Mitigation**: WsgiToAsgi is battle-tested, minimal risk
- **Fallback**: Run Flask and NiceGUI on separate ports (current state)

### Risk: Socket.IO path confusion (NiceGUI uses `/_nicegui_ws/socket.io/`)
- **Mitigation**: Configure `engineio_path` explicitly when mounting
- **Test**: Inspect browser DevTools network tab for 400s on WS upgrade

### Risk: Supervisor cleanup breaks with Uvicorn
- **Mitigation**: Uvicorn supports graceful shutdown via SIGTERM
- **Test**: `kill -TERM <pid>` and verify all children cleaned up

### Risk: Existing Flask-sock WebSockets break
- **Mitigation**: Flask-sock should still work inside ASGI wrapper (WSGI passthrough)
- **Fallback**: Migrate to native ASGI WebSockets incrementally

## Success Criteria

1. ✅ Flask app serves all existing routes under Uvicorn
2. ✅ NiceGUI app loads and UI elements respond (buttons, etc.)
3. ✅ NiceGUI WebSockets connect without 400 errors
4. ✅ Flask workers spawn and proxy correctly
5. ✅ Supervisor starts/stops cleanly, no orphaned processes
6. ✅ No changes needed to existing Flask code (blueprints, extensions)

## Timeline Estimate

- **Phase 1** (ASGI host): 1-2 hours
- **Phase 2** (NiceGUI mount): 1-2 hours
- **Phase 3** (Worker updates): 2-3 hours
- **Phase 4** (Supervisor): 1-2 hours
- **Phase 5** (WS migration): Optional, 3-5 hours

**Total**: 5-9 hours of focused work (can be split across sessions)

## References

- [ASGI Specification](https://asgi.readthedocs.io/en/latest/specs/www.html) - HTTP & WebSocket support
- [Flask ASGI Deployment](https://flask.palletsprojects.com/en/stable/deploying/asgi/) - Official Flask ASGI guide
- [NiceGUI Docs](https://nicegui.io/documentation) - Pages & routing
- [Starlette Routing](https://starlette.dev/routing/) - Mounting sub-apps
- [Python Engine.IO](https://python-engineio.readthedocs.io/en/stable/api.html) - Socket.IO path configuration
- [FastAPI Sub-Applications](https://fastapi.tiangolo.com/advanced/sub-applications/) - Mount patterns

## Next Steps

1. **User approval** of this plan
2. **Phase 1**: Create `app/asgi_main.py` with Flask wrapped
3. **Test**: Verify existing Flask routes work under Uvicorn
4. **Phase 2**: Mount NiceGUI at `/nice_code_cm6`
5. **Test**: Verify WebSockets connect (no 400s)
6. Proceed to Phase 3-4 as needed

---

**NOTE**: This plan prioritizes **minimal changes** to existing code. Flask stays Flask, workers stay workers. We're just changing the "front door" from WSGI to ASGI to unlock native WebSocket support.
