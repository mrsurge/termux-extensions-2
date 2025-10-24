# Universal WebSocket Port Resolution + Reader Fix (Minimal Edits)

A compact, framework‑wide change set that (1) resolves each worker’s randomized port on the client before opening a WebSocket, and (2) hardens the file‑change delivery path so live updates don’t get dropped due to path string mismatches.

---

## 1) Universal **WebSocket Port Resolution** (works for every app)

### 1.1 Project‑root **`main.py`** — add the worker port as a response header
> File: **`main.py`** (project root)

Append one header on **every** proxied HTTP response. This keeps things universal and app‑agnostic.

```diff
@@
 @app.route('/api/app/<app_id>/<path:subpath>', methods=['GET','POST','PUT','DELETE','PATCH','OPTIONS'])
 def proxy_app_request(app_id, subpath):
     if request.headers.get("Upgrade", "").lower() == "websocket":
         return "", 404
@@
-    return Response(stream_with_context(upstream.iter_content(chunk_size=8192)),
-                    status=upstream.status_code, headers=resp_headers)
+    resp = Response(
+        stream_with_context(upstream.iter_content(chunk_size=8192)),
+        status=upstream.status_code,
+        headers=resp_headers,
+    )
+    # Universal hint for clients: current worker port for this app
+    resp.headers['X-App-Worker-Port'] = str(port)
+    return resp
```

> **Why this works**: the framework already knows which **`port`** it forwarded to. Surfacing it as `X-App-Worker-Port` lets any client determine where to connect for WS without per‑app code.

---

### 1.2 New shared helper (no imports required) — **`app/static/js/ws_port.js`**
> File: **`app/static/js/ws_port.js`** (create this)

Attaches a tiny helper to `window` so existing app scripts can call it without changing module loaders.

```html
<!-- Load once in the base app shell (e.g., app/templates/app_shell.html). Use url_for to respect STATIC_URL and blueprints. -->
<script src="{{ url_for('static', filename='js/ws_port.js') }}"></script>
```

```js
// app/static/js/ws_port.js
(function () {
  async function getWsPort(appId) {
    // Hit any normal HTTP endpoint for the app; the header comes back on all proxied responses.
    const r = await fetch(`/api/app/${encodeURIComponent(appId)}/status`, { cache: 'no-store' });
    const p = r.headers.get('X-App-Worker-Port');
    if (!p) throw new Error('WS port header missing');
    return Number(p);
  }

  async function buildWsUrl(appId, path, clientId) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const port  = await getWsPort(appId);
    return (
      `${proto}//${location.hostname}:${port}/ws/read` +
      `?path=${encodeURIComponent(path)}` +
      `&client_id=${encodeURIComponent(clientId)}`
    );
  }

  // Non‑module attach (no import changes needed in apps)
  window.wsPort = { getWsPort, buildWsUrl };
})();
```

> If your pages are served over **HTTPS**, this helper automatically switches to **`wss:`**. Also note: `X-App-Worker-Port` appears only on **proxied app HTTP responses** (e.g., `/api/app/<app_id>/status`) and **not** on static assets under `/static`. Always fetch a proxied endpoint to read the header.

---

### 1.3 App JS — use the shared helper when constructing the WS URL
> File: **`app/apps/file_editor_cm6/main.js`**

Replace the hardcoded WS URL with a call to the shared helper. The rest of the file stays as‑is.

```diff
@@
-  const wsUrl = `${protocol}//${window.location.host}/ws/app/file_editor_cm6/read?path=${encodeURIComponent(path)}&client_id=${encodeURIComponent(clientId)}`;
+  const appId = 'file_editor_cm6';
+  const wsUrl = await window.wsPort.buildWsUrl(appId, path, clientId);
   ws = new WebSocket(wsUrl);
```

> **Note**: If the function containing this line isn’t already `async`, add `async` to that function and await the call. No other logic needs to change.

---

## 2) **Reader Update Delivery Fix** (normalize paths to prevent dropped events)

Live updates were silently dropped when the subscription key and emitted path strings didn’t match exactly (e.g., absolute vs relative, symlinked vs realpath). Normalize both sides to a canonical absolute path.

### 2.1 **`core_read.py`** — normalize on subscribe and on emit
> File: **`app/apps/file_editor_cm6/core_read.py`** (same dir as that app’s `main.py`)

```diff
@@
-from collections import defaultdict
-from pathlib import Path
+from collections import defaultdict
+from pathlib import Path
@@
-_subscribers = defaultdict(dict)  # key: path string, value: {token: callback}
+_subscribers = defaultdict(dict)  # key: normalized abs path string, value: {token: callback}
+
+def _norm_path(p: str) -> str:
+    """Canonical absolute path used for both subscribe keys and emitted events."""
+    try:
+        return str(Path(p).resolve())  # resolves symlinks when possible
+    except Exception:
+        return str(Path(p).absolute())
@@
-def subscribe(path: str, token: str, on_event):
-    bucket = _subscribers[path]
+def subscribe(path: str, token: str, on_event):
+    key = _norm_path(path)
+    bucket = _subscribers[key]
     bucket[token] = on_event
@@
-def unsubscribe(path: str, token: str):
-    bucket = _subscribers.get(path)
+def unsubscribe(path: str, token: str):
+    key = _norm_path(path)
+    bucket = _subscribers.get(key)
     if not bucket:
         return
     bucket.pop(token, None)
     if not bucket:
-        _subscribers.pop(path, None)
+        _subscribers.pop(key, None)
@@
-def _emit_event(event: dict):
-    path = event.get('path')
-    if not path:
+def _emit_event(event: dict):
+    path = event.get('path')
+    if not path:
         return
-    listeners = _subscribers.get(path)
+    key = _norm_path(path)
+    listeners = _subscribers.get(key)
     if not listeners:
         return
     for cb in list(listeners.values()):
         try:
             cb(event)
         except Exception:
             pass
@@  # wherever you generate the initial snapshot event
-    snapshot = {"type": "replace_full", "path": path, "content": content}
+    norm = _norm_path(path)
+    snapshot = {"type": "replace_full", "path": norm, "content": content}
     _emit_event(snapshot)
```

> **Result**: the subscription map and all emitted events use the same canonical key, so updates arrive even if the original open path was a symlink or differently formatted.

---

### 2.2 Watcher scope reminder (no code change)
The watcher is scheduled at the **current project root**. Make sure the file you open resides under that root; otherwise no FS events are generated for it. If you need cross‑root watching later, add a second `init_watcher()` for that root—out of scope for this minimal patch.

---

## 3) Sanity checks (quick)
- **Port header:** `curl -I http://localhost:PORT/api/app/<app_id>/status | grep X-App-Worker-Port`
- **Client build:** confirm the base shell includes `{{ url_for('static', filename='js/ws_port.js') }}` **before** any per-app script that opens the WebSocket.
- **WS handshake:** `wscat -c ws://127.0.0.1:<WORKER_PORT>/ws/read?path=<file>&client_id=dev`
- **Live update:** edit the file under the selected project root and watch the UI update.

---

## Appendix: Rollback / impact
- All changes are additive and minimal.
- Removing `ws_port.js` or the header reverts clients to the old behavior without touching app workers.

