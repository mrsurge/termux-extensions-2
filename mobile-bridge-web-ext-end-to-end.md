# Mobile Bridge Web Extension — End‑to‑End Install & Host Setup (code‑server / Code‑OSS)

This gets your **web extension** cleanly packaged, installed **in the Browser host**, and talking to your backend without CORS pain. It also covers the pop‑up vs same‑window note for your full‑page IDE.

---

## 0) Where you are (quick state)
- The extension **activates** and your command handler runs. ✅
- Errors now are about **installation host**, **blocked postMessage**, and **fetch/CORS**.

---

## 1) Package for the Web host (vsce)
Use the maintained CLI and target the the web runtime so the VSIX advertises itself correctly.

```bash
# Use the scoped, up‑to‑date CLI
npx @vscode/vsce --version
npx @vscode/vsce package --target web
# or install globally
npm i -g @vscode/vsce
vsce package --target web
```

**Manifest rules for a pure web extension**
- Keep **`browser`** entry (single JS file).  
- **Do not** include `main`.
- You can omit `extensionKind` entirely (host infers Web from `browser`), or use `["web"]` if your `vsce` supports it.

**Minimal `package.json` (safe across hosts)**
```json
{
  "name": "mobile-bridge",
  "displayName": "Termux Mobile Bridge",
  "version": "0.7.9",
  "engines": { "vscode": "^1.92.0" },
  "browser": "./extension.js",
  "activationEvents": [
    "onStartupFinished",
    "onCommand:mobile-bridge.manualActivate",
    "onView:mobileBridgeControlView"
  ],
  "contributes": {
    "views": {
      "explorer": [
        { "id": "mobileBridgeControlView", "name": "Mobile Bridge Control", "when": "true" }
      ]
    },
    "commands": [
      { "command": "mobile-bridge.manualActivate", "title": "Activate Bridge" }
    ],
    "menus": {
      "view/title": [
        { "command": "mobile-bridge.manualActivate", "when": "view == mobileBridgeControlView", "group": "navigation" }
      ]
    }
  }
}
```

> If an older `vsce` rejects `"web"`, simply **omit `extensionKind`** and package with `--target web`.

---

## 2) Install **in Browser** and remove server copies
Old server/workspace copies can cause the “Install in Browser” prompt.

1) **Fully uninstall** any earlier installs (Browser & Server if listed).  
2) **Open Extensions folder** (command: *Developer: Open Extensions Folder*) and delete any `termux.mobile-bridge-*` remnants.  
3) **Reload window.**  
4) **Install from VSIX…** using the **web‑targeted** VSIX you just built. The banner should say “will be installed in **Browser**”.  
5) **Verify**: *Developer: Show Running Extensions* → your extension is **Active (Web)**.

---

## 3) Replace blocked `postMessage` with HTTP
In a web extension, the extension host runs inside a **web worker**. Direct `postMessage` to the page/parent is blocked. Use **fetch** (or a **webview** if you need UI messaging).

### Diff — remove `postMessage` calls from the worker
```diff
- function postToParent(payload) {
-   self.postMessage(payload); // ❌ blocked in extension host worker
- }
+ async function httpPost(url, body, token) {
+   const res = await fetch(url, {
+     method: 'POST',
+     headers: {
+       'Content-Type': 'application/json',
+       ...(token ? { 'Authorization': `Bearer ${token}` } : {})
+     },
+     body: JSON.stringify(body)
+   });
+   if (!res.ok) throw new Error(`HTTP ${res.status}`);
+   return res.json().catch(() => ({}));
+ }
```

### Diff — wire your activation to use same‑origin endpoint
```diff
- const ENDPOINT = 'http://192.168.1.159:8080/api/app/code_oss/state';
+ const origin = (globalThis.location && globalThis.location.origin) || '';
+ // If you reverse‑proxy the backend under the code‑server origin, use a short path:
+ const ENDPOINT = `${origin}/mirror/api/app/code_oss/state`;

- postToParent({ type: 'bridgeActivated', /* ... */ });
+ await httpPost(ENDPOINT, { type: 'bridgeActivated', ts: Date.now() }, token);
```

> Keep *all* extension‑to‑backend comms over HTTP(S). Use a webview only when you need a DOM and two‑way messaging via `acquireVsCodeApi()`.

---

## 4) Backend wiring — two working topologies

### A) **Same‑origin reverse proxy** (recommended)
Expose your Flask backend **under the code‑server origin** so CORS disappears. Example NGINX:
```nginx
# code-server served at https://ide.example.com/
server {
  server_name ide.example.com;
  location / {
    proxy_pass http://127.0.0.1:8081;   # code-server
    proxy_set_header Host $host;
    proxy_http_version 1.1;
  }
  # Mirror API under same origin
  location /mirror/ {
    proxy_pass http://127.0.0.1:8080/;  # your Flask backend
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
  }
}
```
Extension builds URLs as `${location.origin}/mirror/api/app/code_oss/...` → **no CORS**.

### B) **Cross‑origin with CORS** (dev acceptable)
Enable CORS on Flask so the extension can call `http://localhost:8080` from the code‑server page (e.g., `http://localhost:57523`).
```python
# Flask example
from flask import Flask, request, make_response
app = Flask(__name__)

@app.after_request
def add_cors(resp):
    resp.headers['Access-Control-Allow-Origin'] = 'http://localhost:57523'  # code-server origin
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return resp

@app.route('/api/app/code_oss/state', methods=['OPTIONS'])
def preflight_state():
    return ('', 204)
```
Also ensure the backend binds `0.0.0.0` if you’re accessing it from another device.

> **Mixed content**: if code‑server is `https://…`, don’t fetch `http://…`.

---

## 5) Full‑page IDE & pop‑up behavior
Your IDE page is at: `http://localhost:8080/api/app/code_oss/fullpage`.

- A **new window** is not inherently a problem; what matters is the **origin** your extension runs under (the code‑server origin).
- For simplicity and consistent cookies/headers, you can load in the **same window** instead of a pop‑up.

**Diff — replace `window.open` with same‑window navigation**
```diff
- window.open('/api/app/code_oss/fullpage', '_blank', 'noopener');
+ window.location.assign('/api/app/code_oss/fullpage');
```
If you reverse‑proxy code‑server beneath that route, keep origins aligned (see §4A).

---

## 6) Quiet the gallery noise (optional)
The Open‑VSX JSON/HTML errors are just update checks. During dev:
```json
"extensions.autoUpdate": false,
"extensions.autoCheckUpdates": false
```

---

## 7) Five‑minute green‑path checklist
1) Re‑package: `npx @vscode/vsce package --target web` (bump version).  
2) Uninstall all previous copies; delete leftovers from the extensions folder; reload.  
3) Install from VSIX; confirm the banner says **Browser**; reload.  
4) *Developer: Show Running Extensions* → **Active (Web)**.  
5) Click **Activate Bridge** → no `postMessage blocked`; Network shows 200s to your endpoint.  
6) If you see `Failed to fetch`: fix origin (proxy) or CORS headers.

---

## 8) Troubleshooting map
- **“Install in Browser” keeps showing** → a server/workspace copy still installed. Uninstall that copy, reload, then install the web‑targeted VSIX.  
- **`'postMessage' has been blocked`** → remove window/parent messaging in the worker; use `fetch` or a webview.  
- **`TypeError: Failed to fetch`** → CORS, mixed content, or unreachable endpoint; fix per §4.  
- **`Can't install … not compatible`** → package with `--target web` or add `"extensionKind": ["web","workspace"]`.  
- **`TreeError [DebugRepl]`** → benign workbench noise.

---

## 9) Baseline `extension.js` (activation & command)
```js
import * as vscode from 'vscode';

export function activate(context) {
  console.log('[mobile-bridge] activate()');
  const origin = (globalThis.location && globalThis.location.origin) || '';
  const ENDPOINT = `${origin}/mirror/api/app/code_oss/state`;

  async function httpPost(url, body, token) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  }

  const sub = vscode.commands.registerCommand('mobile-bridge.manualActivate', async () => {
    vscode.window.showInformationMessage('Mobile Bridge is activating!');
    await httpPost(ENDPOINT, { type: 'bridgeActivated', ts: Date.now() });
  });
  context.subscriptions.push(sub);
}

export function deactivate() {
  console.log('[mobile-bridge] deactivate()');
}
```

---

### You’re done
Once the host shows **Active (Web)** and your network calls return 200, the rest is backend logic. If anything still complains, grab the first error line from **Log (Extension Host)** or DevTools **Console** and we’ll pinpoint it.
