# Agent Self-Onboarding & Survival Guide: Termux Extensions 2

**Last Updated:** 2025-11-21
**Purpose:** Critical knowledge transfer for future agents (and memory-wiped selves) to modify this codebase safely and effectively.

---

## 1. The Prime Directive: Workflow

**Violating this causes immediate failure.**
1.  **One Issue at a Time:** Never batch unrelated tasks. Fix one thing, verify it, get approval, move to the next.
2.  **Plan First:** Propose a specific, file-level plan. Wait for "Go".
3.  **Verify:** Do not claim a fix until you have verified the logic. "Edits made" != "Fixed".

---

## 2. Architecture: The "Hybrid" Model

This is **NOT** a standard FastAPI app. It is a hybrid system designed for Termux.

### The Three Layers
1.  **Supervisor (Bash/Python):** Manages the lifecycle. **DO NOT TOUCH** unless fixing startup/shutdown signals.
2.  **IPC Server (Flask - Sync):** Handles blocking ops (shutdown, process registry).
3.  **Framework Main (FastAPI - Async):** The web server. Handles UI, WebSockets, and Proxies.

### The "Auto-Loading" Trap (app/libs)
The framework automatically imports modules in `app/libs/` via `load_services()` in `app/main.py`.
*   **Mechanism:** It iterates `dir(module)` and registers **ANY** `APIRouter` instance it finds.
*   **CRITICAL RULE:** You **MUST** define `prefix="/api"` in the `APIRouter` constructor within the lib file.
    *   *Correct:* `bp = APIRouter(prefix="/api")` -> Routes avail at `/api/route`
    *   *Wrong:* `bp = APIRouter()` -> Routes avail at `/route` (Pollutes root namespace, likely 404s if frontend expects `/api`)
*   **Do NOT** manually `include_router` in `app/main.py` for these libs. It causes duplication or conflicts.

### Deep Linking & App Launching
*   **Mechanism:** Apps are spawned on demand. You cannot just link to `/app/my_app`.
*   **The "Launch" API:** Use `POST /api/apps/{app_id}/open`.
    *   It calls `ensure_app_running` (starts the worker).
    *   It returns a URL with your params: `/app/file_explorer?path=...`
*   **Frontend Responsibility:** The target app (e.g., `main.js`) must explicitly parse `window.location.search` to handle these parameters. It does not happen by magic.

---

## 3. Frontend "Gotchas" (The Silent Killers)

### DOM Caching & "CreateRoot"
The framework is a Single Page Application (SPA) in disguise.
*   **The Trap:** Components like `file_picker.js` often check `if (document.getElementById('root')) return;`.
*   **The Consequence:** If you update the HTML `TEMPLATE` string in JS, **it will NOT apply** if the user has visited the page before (because the old DOM node persists).
*   **The Fix:** Implement **DOM Repair Logic**. Check for your new element inside the existing root. If missing, inject it dynamically.
    ```javascript
    // BAD: Assuming template update works
    // GOOD:
    const header = root.querySelector('.header');
    if (!header.querySelector('.my-new-btn')) {
        const btn = document.createElement('button');
        // ... configure and append ...
    }
    ```

### Shared UI Components
*   **File Picker:** `window.teFilePicker`. It returns **Absolute Paths**.
*   **Git Awareness:** The file picker now has a "Git Awareness" mode using `/api/git/summary` (from `app/libs/git_utils.py`).

---

## 4. Debugging Protocol

1.  **404 on API Call?**
    *   Did you set `prefix="/api"` in the python file?
    *   Did `load_services` actually find the router? (It ignores `_` prefixed variables).
2.  **UI Element Missing?**
    *   Is the DOM cached? (See "DOM Caching" above).
    *   Did the API call fail silently? (Check `catch` blocks).
3.  **ImportError / NameError?**
    *   `load_services` only registers *Routes*. It does not import classes into `main.py`'s namespace. You must manually `from app.libs.x import Y` if you use the class in `main.py`.

---

## 5. Critical File Locations

*   **`app/main.py`**: The brain. `load_services` lives here.
*   **`app/libs/`**: Shared backend logic. Auto-loaded.
*   **`app/extensions/apps/main.py`**: Handles app lifecycle (`/api/apps/...`).
*   **`app/static/js/file_picker.js`**: The shared file picker source.

**Good luck. You'll need it.**