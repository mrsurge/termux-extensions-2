# Fixing “command not found” for `mobile-bridge.manualActivate` — Web Extension Activation Guide

> **Symptom**  
> *Error running command mobile-bridge.manualActivate: command 'mobile-bridge.manualActivate' not found.*  
> **Meaning**: the command handler was **never registered** (the extension didn’t activate, or activation crashed). Your UI/menu exists because `package.json` loaded, but the **runtime** didn’t run.

---

## What’s in your manifest that matters

- You’re shipping a **web**-style extension via `"browser": "./extension.js"`.  
- You already have the right activation hooks:  
  - `onStartupFinished`  
  - **`onCommand:mobile-bridge.manualActivate`**  
  - **`onView:mobileBridgeControlView`**  
- **But** `extensionKind` is set to `["ui","workspace"]` (desktop/Electron hints). For web hosts (code-server/OpenVSCode Server), that can stop the host from loading your web worker. Prefer `["web"]`.

---

## 3‑step triage (do these in order)

### 1) Make the host pick the web worker
Change the kind to web (manifest‑only; no code change):

```diff
- "extensionKind": ["ui", "workspace"]
+ "extensionKind": ["web"]
```

Why: on web hosts, the extension must be recognized as runnable in the **web worker**. Desktop hints can result in “installed but never activates.”

### 2) Prove activation actually runs
Temporarily force activation (debug only), reload, and see if the error disappears:

```diff
- "activationEvents": [
-   "onStartupFinished",
-   "onCommand:mobile-bridge.manualActivate",
-   "onView:mobileBridgeControlView"
- ]
+ "activationEvents": ["*"]
```

- If the command **works** with `["*"]`, your earlier activation timing was the issue (less likely, since you already have `onCommand:`/`onView:`).  
- If the error **persists**, your **web worker is crashing or `extension.js` isn’t loading**. Go to Step 3.  
*(After the test, restore the real activation events.)*

### 3) Catch the real failure
Open **Developer Tools → Console** and **Output → “Log (Extension Host)”** right after a reload. Look for:

- **404 / failed to load** for `extension.js` (wrong path/name/case).
- **Top‑level crash**: common causes:
  - Node‑only imports in a web extension (`fs`, `net`, `http`, `child_process`, etc.).
  - Shipping raw **ESM** that the VS Code web loader can’t import (worker expects AMD/UMD or something it can eval).
  - Missing exports (`activate`, `deactivate`) or throwing during module eval.

UI still renders (from `package.json`), but the runtime never starts—thus “command not found.”

---

## Likeliest root causes in your setup

1) **Wrong host hint** — `extensionKind` should be `["web"]`.  
2) **Worker load crash** — any Node import or top‑level error kills activation.  
3) **Engines mismatch** — ensure the host’s VS Code version satisfies your `"engines.vscode"` (e.g., `^1.92.0`).

---

## Minimal manifest that’s safest for the web (diff)

```diff
 {
   "name": "mobile-bridge",
   "displayName": "Termux Mobile Bridge",
   "version": "0.7.6",
   "engines": { "vscode": "^1.92.0" },
-  "extensionKind": ["ui", "workspace"],
+  "extensionKind": ["web"],
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

---

## Baseline `extension.js` shape (for sanity)

```js
import * as vscode from 'vscode';

export function activate(context) {
  // Prove activation
  console.log('[mobile-bridge] activate() ran');

  const sub = vscode.commands.registerCommand('mobile-bridge.manualActivate', () => {
    vscode.window.showInformationMessage('Mobile Bridge activated.');
    // real activation logic here
  });
  context.subscriptions.push(sub);
}

export function deactivate() {
  console.log('[mobile-bridge] deactivate()');
}
```

**Rules for web builds:**
- No Node core modules (`fs`, `net`, `http`, `child_process`, etc.).
- Export `activate` and `deactivate`.
- Prefer a single browser‑friendly bundle (AMD/UMD/loader‑compatible). Avoid top‑level await/DOM‑only APIs in the worker.

---

## Quick verification checklist (5 minutes)

1. **Running Extensions:** `Developer: Show Running Extensions` → your extension should be **Active (Web)**.  
2. **Network tab:** `extension.js` is fetched (200 OK).  
3. **Logs:**  
   - *Log (Extension Host)* → activation messages or errors.  
   - DevTools **Console** → worker exceptions.  
4. **Force‑activate (once):** set `activationEvents: ["*"]`, reload; verify your `activate` runs (toast/console), then revert.  
5. **Command Palette:** “Activate Bridge” shows; clicking it triggers your handler (no “command not found”).

---

## If it still says “command not found”
At that point it’s almost certainly a **worker load** problem. Fix the first error you see in the **Extension Host Log** or **DevTools console** (that will point to the exact line/module that’s failing).