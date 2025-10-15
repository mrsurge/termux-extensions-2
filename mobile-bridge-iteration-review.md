# Mobile Bridge Extension — Iteration Review & Patches

## Snapshot of current iteration (auto-detected)

- **uses_postMessage**: False
- **has_fetch_calls**: True
- **command_ids_found**: ['mobile-bridge.manualActivate']
- **has_activate_export**: <re.Match object; span=(10358, 10376), match='exports.activate ='>
- **reads_mb_config**: False
- **endpoint_literal**: None
- **pkg_activationEvents**: ['onStartupFinished', 'onCommand:mobile-bridge.manualActivate', 'onView:mobileBridgeControlView']
- **pkg_browser**: ./extension.js
- **pkg_extensionKind**: ['ui', 'workspace']
- **pkg_engines**: {'vscode': '^1.92.0'}

---

## `package.json` manifest checks

- activationEvents: ['onStartupFinished', 'onCommand:mobile-bridge.manualActivate', 'onView:mobileBridgeControlView']
- `browser` field present ✅
- `extensionKind` is `["ui","workspace"]` → **remove it** or change to `["web","workspace"]` (or omit entirely).

**Packaging**
```bash
npx @vscode/vsce package --target web
```

## VS Code settings (user/workspace)

```jsonc
{
  // Prefer same-origin path if you reverse-proxy backend under the code-server origin
  "mobile-bridge.endpoint": "/mirror/api/app/code_oss/state",
  // Optional bearer token
  "mobile-bridge.token": "DEV-REDACTED",
  // Quiet gallery noise during dev
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false
}
```
## Reverse proxy (example)

```nginx
location /mirror/ {
  proxy_pass http://127.0.0.1:8080/;   # Flask backend
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_http_version 1.1;
}
```
## Debug checklist
- Developer: Show Running Extensions → Active (Web)
- DevTools Network → POSTs to endpoint are 200
- Extension Host Log → no 'postMessage blocked', no CORS errors
- Drawer hydrates after `bridgeActivated` and `explorerTree` events
