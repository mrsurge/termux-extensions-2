# ASGI Migration Testing Plan

This document contains all testing and validation steps to be performed **after** the ASGI migration is complete.

## Pre-migration baseline

### Capture Flask baseline
1. Start current Flask app: `python app/main.py` or `gunicorn -w 2 -k gthread --threads 8 -b 0.0.0.0:8080 wsgi:application`
2. Dump all Flask routes:
   ```bash
   python -c "from app.main import app; import json; routes = [{'path': r.rule, 'methods': list(r.methods)} for r in app.url_map.iter_rules()]; print(json.dumps(routes, indent=2))" > tests/flask_routes_baseline.json
   ```
3. Document WebSocket endpoints manually (Flask doesn't expose sock routes via url_map):
   - `/ws/read` (file_editor_cm6)
   - `/ws/edit_tracker` (file_editor_cm6)
   - `/ws/agent` (file_editor_cm6)
   - `/ws/terminal/<id>` (file_editor_cm6)
   - `/ws/app/<app_id>/<route>` (main app proxy)

## Post-migration validation

### Route parity check
1. Start ASGI app: `uvicorn app.main:app --host 0.0.0.0 --port 8080`
2. Dump all FastAPI routes:
   ```bash
   python -c "from app.main import app; import json; routes = [{'path': r.path, 'methods': list(r.methods)} for r in app.routes]; print(json.dumps(routes, indent=2))" > tests/fastapi_routes.json
   ```
3. Compare route lists (allow ordering differences, ignore OPTIONS/HEAD auto-generation):
   ```bash
   # Manual comparison or script to verify no missing routes
   diff <(jq -S '.' tests/flask_routes_baseline.json) <(jq -S '.' tests/fastapi_routes.json)
   ```

### REST endpoint smoke tests
Start ASGI app and test key endpoints:

```bash
# Core framework
curl http://localhost:8080/api/extensions
curl http://localhost:8080/api/apps
curl http://localhost:8080/api/framework/runtime/metrics
curl http://localhost:8080/api/framework_shells

# Bookmarks
curl http://localhost:8080/api/bookmarks
curl -X POST http://localhost:8080/api/bookmarks -H "Content-Type: application/json" -d '{"name":"test","path":"/tmp"}'

# Browse
curl "http://localhost:8080/api/browse?path=~"

# Settings/State
curl http://localhost:8080/api/settings
curl http://localhost:8080/api/state

# file_editor_cm6 REST
curl "http://localhost:8080/api/app/file_editor_cm6/read?path=/path/to/file"
curl -X POST http://localhost:8080/api/app/file_editor_cm6/write -H "Content-Type: application/json" -d '{"path":"/tmp/test.txt","content":"hello"}'
curl "http://localhost:8080/api/app/file_editor_cm6/diff?path=somefile.py"
curl http://localhost:8080/api/app/file_editor_cm6/state
curl http://localhost:8080/api/app/file_editor_cm6/preferences

# App proxy (if external worker apps exist)
curl http://localhost:8080/api/app/<app_id>/some_endpoint
```

### WebSocket smoke tests

#### Test /ws/read (file watcher)
```bash
# Using wscat (npm install -g wscat)
wscat -c "ws://localhost:8080/ws/read?path=/path/to/file"

# Expected: connection opens, receives file_changed events when file modified
```

#### Test /ws/edit_tracker
```bash
wscat -c "ws://localhost:8080/ws/edit_tracker"

# Expected: connection opens, receives edit events when agent modifies files
```

#### Test /ws/agent
```bash
wscat -c "ws://localhost:8080/ws/agent"

# Send: {"text": "hello", "session": "test-session"}
# Expected: receives agent response events (token, planning, final, etc.)
```

#### Test /ws/terminal/<id>
```bash
# First create a terminal via REST
curl -X POST http://localhost:8080/api/app/file_editor_cm6/terminal/create -H "Content-Type: application/json" -d '{"cwd":"~"}'
# Response: {"ok": true, "data": {"shell_id": "...", "pid": ...}}

# Connect to terminal WebSocket
wscat -c "ws://localhost:8080/ws/terminal/<shell_id>"

# Send: ls -la\n
# Expected: receives PTY output
```

#### Test /ws/app/<app_id>/<route> proxy (if external workers)
```bash
wscat -c "ws://localhost:8080/ws/app/<app_id>/<route>"

# Expected: connection proxied to worker, bidirectional messages work
```

### Browser-based integration tests

1. **Launch file_editor_cm6**:
   - Navigate to `http://localhost:8080/app/file_editor_cm6`
   - Verify app shell loads

2. **Test file operations**:
   - Open a file via explorer
   - Edit content
   - Save (verify write endpoint works)
   - Verify diff display updates

3. **Test terminal drawer**:
   - Open terminal drawer
   - Send commands
   - Verify input/output works via WebSocket

4. **Test agent drawer**:
   - Open agent drawer
   - Send a prompt
   - Verify streaming response via WebSocket
   - Verify session persistence

5. **Test Git features**:
   - Open project with Git repo
   - Verify branch dropdown populates
   - Stage/unstage files
   - Commit changes
   - Verify diff decorations

### Response schema validation

For each endpoint, verify JSON response structure matches Flask baseline:

```python
# Example validation script
import requests
import json

def validate_endpoint(url, expected_keys):
    resp = requests.get(url)
    data = resp.json()
    assert resp.status_code == 200
    assert 'ok' in data
    for key in expected_keys:
        assert key in data.get('data', {}), f"Missing key: {key}"
    print(f"✓ {url}")

# Run for each endpoint
validate_endpoint('http://localhost:8080/api/extensions', ['html', 'card_html'])
validate_endpoint('http://localhost:8080/api/apps', [])  # list of apps
validate_endpoint('http://localhost:8080/api/framework/runtime/metrics', ['run_id', 'uptime_seconds'])
# ... etc
```

### Performance baseline

Compare response times (optional):

```bash
# Flask baseline
ab -n 100 -c 10 http://localhost:8080/api/extensions

# FastAPI after migration
ab -n 100 -c 10 http://localhost:8080/api/extensions

# WebSocket latency (manual timing with wscat)
```

### Error handling validation

Test error conditions:

```bash
# 404 routes
curl http://localhost:8080/nonexistent

# 400 bad requests
curl -X POST http://localhost:8080/api/bookmarks -H "Content-Type: application/json" -d '{}'

# 403 forbidden (if applicable)
curl "http://localhost:8080/api/browse?path=/root"

# 500 internal errors (trigger via malformed data if possible)
```

### Static asset serving

```bash
# Service worker
curl http://localhost:8080/sw.js

# App static files (.js/.mjs with correct MIME)
curl -I http://localhost:8080/apps/file_editor_cm6/main.js
# Verify: Content-Type: application/javascript

# Vendor assets (should not be modified)
curl -I http://localhost:8080/static/vendor/codemirror/codemirror.js
```

## Success criteria

- [ ] All Flask routes present in FastAPI route dump
- [ ] All REST endpoints return 200 with expected JSON structure
- [ ] All WebSocket endpoints accept connections and exchange messages
- [ ] file_editor_cm6 app loads and all features functional (file, diff, terminal, agent)
- [ ] App proxy forwards requests correctly (if external workers exist)
- [ ] Static assets serve with correct MIME types
- [ ] No Python import errors on startup
- [ ] ASGI app starts cleanly: `uvicorn app.main:app --host 0.0.0.0 --port 8080`

## Regression testing checklist

Manual checklist for file_editor_cm6 features:

- [ ] Project open/close
- [ ] File open/edit/save
- [ ] Real-time diff display on save
- [ ] Git branch dropdown
- [ ] Git stage/unstage/commit/push
- [ ] Explorer file tree navigation
- [ ] Terminal drawer open/input/output
- [ ] Agent drawer prompt/streaming response
- [ ] Session restoration after page reload
- [ ] Preferences persistence (theme, view options)
- [ ] Edit tracker notifications

## Troubleshooting

Common issues and fixes:

1. **Import errors on startup**:
   - Verify all Flask imports replaced with FastAPI equivalents
   - Check for missing `from fastapi import ...`

2. **WebSocket connections fail**:
   - Verify `@app.websocket(...)` decorator used (not `@sock.route`)
   - Check `await websocket.accept()` called first
   - Verify async/await throughout WS handler

3. **Route not found**:
   - Check router registration: `app.include_router(...)`
   - Verify path parameters match FastAPI syntax: `{param}` not `<param>`

4. **Streaming response errors**:
   - Verify httpx StreamingResponse used for proxy
   - Check hop-by-hop headers stripped

5. **Sync function blocking**:
   - Wrap sync calls in `await anyio.to_thread.run_sync(...)`
   - Verify no blocking I/O in async context

---

**Last Updated**: 2025-11-05
