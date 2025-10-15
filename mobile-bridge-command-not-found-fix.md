# “command not found” for `mobile-bridge.manualActivate` — Root Cause & Fix Guide

> Symptom: *Error running command mobile-bridge.manualActivate: command 'mobile-bridge.manualActivate' not found.*  
> Meaning: the command handler was **never registered** (extension didn’t activate, or activation crashed). Your UI/menu exists because `package.json` loads, but the **runtime** didn’t run.

---

## 1) High‑probability causes

1. **Activation never triggered**
   - `package.json` only lists `onStartupFinished`. If your extension wasn’t already active, clicking the command does **not** auto‑activate it unless you also declare `onCommand:mobile-bridge.manualActivate`. Similarly, if you contributed a view, add `onView:<viewId>` so opening the view activates the extension.

2. **Web worker load crash (web extension)**
   - `browser: "./extension.js"` loads in a **web worker**. If that bundle contains Node‑only imports (`fs`, `net`, `http`, `child_process`, etc.) or throws at top level, the worker fails and activation never runs.

3. **Engine/host mismatch**
   - `"engines": { "vscode": "^x.y.z" }` must match the *embedded* VS Code version in your host (code‑server/OpenVSCode Server). If it doesn’t, the extension can be installed but rejected/disabled at runtime.

4. **Wrong path / missing bundle**
   - `browser: "./extension.js"` must exist in the final extension folder and be fetchable (200 OK). If it 404s, activation can’t happen.

5. **Command/view ID mismatch**
   - The ID in `contributes.commands[].command` must exactly match the string used in `registerCommand(...)` and your activation event `onCommand:<id>`.

---

## 2) Minimal, safe manifest adjustments (no functional changes)

### ✅ Add deterministic activation events
```diff
 // package.json
 {
   "name": "mobile-bridge",
   "version": "0.0.1",
   "engines": { "vscode": "^1.92.0" },
+  "extensionKind": ["web"],
   "activationEvents": [
-    "onStartupFinished"
+    "onStartupFinished",
+    "onCommand:mobile-bridge.manualActivate",
+    "onView:mobileBridgeControlView"
   ],
   "browser": "./extension.js",
   "contributes": {
     "commands": [
       { "command": "mobile-bridge.manualActivate",
         "title": "Mobile Bridge: Activate" }
     ],
     "views": {
       "explorer": [
         { "id": "mobileBridgeControlView", "name": "Mobile Bridge" }
       ]
     }
   }
 }
```

**Why:** guarantees activation when user **clicks the command** or **opens the view**, even if `onStartupFinished` hasn’t fired yet (or fired earlier and crashed).

### ✅ Optional: temporary force‑activation (debug only)
```diff
- "activationEvents": ["onStartupFinished", "onCommand:mobile-bridge.manualActivate", "onView:mobileBridgeControlView"]
+ "activationEvents": ["*"]
```
If the bundle still doesn’t activate, it’s a **load error** (see §3). Revert this once validated.

---

## 3) Make sure the web bundle can run

- **Browser‑safe only:** no Node core modules in `extension.js`. If you need features later, proxy them over HTTP to your backend.
- **Export shape:** the bundle must export `activate(context)` and `deactivate()` without throwing at top level.
- **One file:** ship a single ESM/UMD file so the web worker loader can import it cleanly.
- **No top‑level await/side‑effects** that depend on DOM/window.

Example (baseline) handler inside `extension.js` (for reference):
```js
import * as vscode from 'vscode';

export function activate(context) {
  const sub = vscode.commands.registerCommand('mobile-bridge.manualActivate', () => {
    vscode.window.showInformationMessage('Mobile Bridge activated.');
    // your real activation logic here
  });
  context.subscriptions.push(sub);
}

export function deactivate() {}
```

---

## 4) Quick verification checklist (5 minutes)

1. **Logs:** View → Output → *Log (Extension Host)* / *Log (Window)* — look for activation errors or worker exceptions.
2. **Network:** Developer Tools → Network — confirm `extension.js` loads (200 OK) and no 404/403.
3. **Force‑activate (once):** set `activationEvents: ["*"]`, reload window; check that your `activate` runs (add a `console.log` or `showInformationMessage`).
4. **Command Palette:** ensure “Mobile Bridge: Activate” appears. Run it; the extension should already be active; the handler should fire.
5. **Show running extensions:** `Developer: Show Running Extensions` — your extension should be listed as *Active (Web)*.

---

## 5) Common gotchas & fixes

- **Command/error still appears after changes** → you’re seeing a cached bundle. **Hard reload** (and clear site data in code‑server), then reload window.
- **“Command not found” persists** → activation still not firing or bundle crash. Add `onCommand:`/`onView:` (as above) and try `["*"]` once.
- **Engine mismatch** → align `engines.vscode` to the host’s version (About dialog) to avoid rejection.
- **CSP/CORS errors** → won’t usually block activation, but they will break network calls from your extension. Fix later; focus on activation first.

---

## 6) If it still fails… three signals to collect

- The **first 50 lines** from *Log (Extension Host)* after a reload.
- The **DevTools console** from the web worker (any red stack traces).
- A **screenshot/snippet** of the **Network** tab showing `extension.js` load result.

Those three will pinpoint whether it’s **no activation**, **load crash**, or **host/engine mismatch**.
