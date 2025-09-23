# Aria Downloader & Framework Shell Alignment

This note summarizes how the Aria Downloader agent should integrate with the core
framework now that framework shells are available.

## 1. Runtime Assumptions
- `/api/framework_shells` supports spawn/list/terminate actions. Use it to host the
  aria2 daemon without consuming a visible Termux session.
- The agent still owns every file under `app/apps/aria_downloader/`; the framework
  never edits app code on your behalf.
- Default aria2 RPC endpoint remains `http://127.0.0.1:6800/jsonrpc`. Configure
  `ARIA2_RPC_URL` / `ARIA2_RPC_SECRET` inside your app backend as needed.

## 2. Backend Blueprint Expectations
- Implement a `call_rpc` helper in `main.py` using Python stdlib (`urllib.request`).
- Required endpoints: `GET /status`, `GET /downloads`, `POST /add`, `POST /control`.
  Optional stretch: `POST /settings` for advanced aria2 options.
- Responses must follow `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "..." }`.
- Any filesystem interaction (e.g., temp files) must stay beneath the user home dir.

## 3. Using Framework Shells for aria2
1. **Spawn the daemon** (example request):
   ```bash
   curl -X POST http://localhost:8080/api/framework_shells \
     -H 'Content-Type: application/json' \
     -d '{
       "command": ["aria2c", "--enable-rpc", "--rpc-listen-all=false", "--rpc-allow-origin-all"],
       "label": "aria2",
       "cwd": "~/services/aria2"
     }'
   ```
   - If `TE_FRAMEWORK_SHELL_TOKEN` is set, include
     `-H "X-Framework-Key: $TE_FRAMEWORK_SHELL_TOKEN"`.
   - Persist the returned shell `id` (e.g. `fs_...`) if you want to restart/stop it later.

2. **Monitor status**:
   ```bash
   curl http://localhost:8080/api/framework_shells
   curl 'http://localhost:8080/api/framework_shells/<id>?logs=true&tail=200'
   ```

3. **Stop / restart**:
   ```bash
   curl -X POST http://localhost:8080/api/framework_shells/<id>/action \
     -H 'Content-Type: application/json' -d '{"action":"stop"}'
   curl -X POST http://localhost:8080/api/framework_shells/<id>/action \
     -H 'Content-Type: application/json' -d '{"action":"restart"}'
   ```

4. **Remove metadata/logs** when the daemon is no longer needed:
   ```bash
   curl -X DELETE http://localhost:8080/api/framework_shells/<id>
   ```

The aria2 app can call these endpoints directly from its backend (via `requests`
/ `urllib`) or delegate to the front-end with `window.teFetch`. Prefer backend calls
so credentials remain server-side.

## 4. Testing Checklist
1. Ensure `aria2c` is installed.
2. Launch the Flask server: `TE_SESSION_TYPE="framework" python app/main.py`.
3. Spawn an aria2 shell through the new API and confirm it appears in
   `/api/framework_shells` but not in the Sessions extension.
4. Exercise the app endpoints (`/status`, `/downloads`, etc.) against the running
   aria2 daemon. Confirm errors surface with the standard envelope when the daemon
   is offline.

These guidelines keep the Aria Downloader app aligned with the newly implemented
framework shell system.
