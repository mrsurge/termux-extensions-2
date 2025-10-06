/ - (Launcher - `index.html`)
|
+-- <div id="extensions-container"> (Dynamic cards loaded from `/api/extensions`)
    |
    +-- **App Launcher Extension**
    |   |
    |   +-- App Grid (populated from `/api/apps`)
    |       |
    |       +-- App Icon Click
    |           |-- POST /api/apps/<app_id>/start (spawns worker shell)
    |           +-- Navigate to /app/<app_id>
    |
    +-- 🎛️ **Settings App (full page)**
    |   |
    |   +-- Metrics Card (reads `/api/framework/runtime/metrics`)
    |   |   |-- Displays run ID, supervisor/app PIDs, uptime, shell/session counts
    |   +-- Framework Shells Card (calls `/api/framework_shells` + action/delete)
    |   |   |-- App workers will appear here as `app-worker:<app_id>`
    |   +-- Launcher Ordering Card (loads `/api/extensions`, persists order via `/api/settings`)
    |   +-- Shutdown Card (POST `/api/framework/runtime/shutdown`)
    |
    +-- **Shortcut Wizard Extension**
    |   |
    |   +-- ... (existing flow)
    |
    +-- **Sessions & Shortcuts Extension**
        |
        +-- ... (existing flow)

[MODALS] (Exist in main index.html but are triggered by extensions)
|
+-- Command Modal
+-- Shortcut Modal
