# Agent Task: Fix App Proxy Connection Errors

## Issue
The file_editor_cm6 app (also known as "Code CM6") is failing to load in the ASGI-migrated framework. The proxy is attempting to connect to the app's worker process but failing with connection errors.

## Error Symptoms
```
INFO: 127.0.0.1:47672 - "GET /api/app/file_editor_cm6/state HTTP/1.1" 500 Internal Server Error
ERROR: Exception in ASGI application
httpcore.ConnectError: All connection attempts failed
```

The app shell loads (GET /app/file_editor_cm6 returns 200), but all proxied requests to the app's endpoints fail with connection errors.

## Root Cause
The ASGI proxy handler in `app/main.py` (the `proxy_app_request` function around line 811) is attempting to forward requests to app worker processes, but the connection is failing. This suggests:

1. The app worker may not be starting correctly
2. The port/host configuration may be incorrect
3. The proxy URL construction may be wrong

## Files to Investigate
- `app/main.py` - The proxy_app_request function
- `app/libs/app_manager.py` - The ensure_app_running function
- `app/libs/app_worker.py` - Worker process management
- `app/apps/file_editor_cm6/main.py` - The app being proxied

## App Architecture Context
Per the documentation in `docs/apps/code_cm6/CODE_CM6_COMPLETE.md`:
- file_editor_cm6 runs as a separate Flask worker process
- The main framework proxies HTTP and WebSocket requests to this worker
- The worker exposes REST endpoints like /state, /read, /write, /git/branches
- The worker also has WebSocket endpoints at /ws/read, /ws/edit_tracker, /ws/agent, /ws/terminal/<id>

## Requirements
1. Fix the proxy connection so requests to `/api/app/file_editor_cm6/*` successfully forward to the app worker
2. Ensure the app worker process starts correctly under ASGI
3. Preserve the exact proxy behavior from the Flask version
4. DO NOT modify or read anything related to "nice_code_cm6" - that app has been removed
5. Focus ONLY on file_editor_cm6 (Code CM6)

## Testing
After fixing:
1. Start the framework with `scripts/run_framework.sh`
2. Open the file_editor_cm6 app from the UI
3. Verify GET /api/app/file_editor_cm6/state returns 200 (not 500)
4. Verify the app UI loads and functions

## Notes
- The framework is running under ASGI (FastAPI/Uvicorn)
- The migration from Flask to FastAPI has been partially completed
- The main server starts and serves the UI correctly
- Only the app proxying is broken
