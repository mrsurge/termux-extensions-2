# Application UI Flow Map

This document outlines the visual and logical flow of the application, distinguishing between the core framework UI and the components loaded from extensions.

```
/ - (Launcher - `index.html`)
|
+-- <div id="extensions-container"> (Dynamic cards loaded from `/api/extensions`)
    |
    +-- 🎛️ **Settings App (full page)**
    |   |
    |   +-- Metrics Card (reads `/api/framework/runtime/metrics`)
    |   |   |-- Displays run ID, supervisor/app PIDs, uptime, shell/session counts
    |   +-- Framework Shells Card (calls `/api/framework_shells` + action/delete)
    |   +-- Launcher Ordering Card (loads `/api/extensions`, persists order via `/api/settings`)
    |   +-- Shutdown Card (POST `/api/framework/runtime/shutdown`)
    |
    +-- **Shortcut Wizard Extension**
    |   |
    |   +-- Main Menu View
    |   |   |-- "New Shortcut" -> Editor View (collects metadata, saves via API)
    |   |   +-- "Edit Shortcuts" -> Existing list
    |   |
    |   +-- Editor View (hidden by default)
    |   |   |-- Filename / Command / Arguments inputs
    |   |   +-- "Save Shortcut" -> POST backend
    |   |
    |   +-- Edit List View (hidden by default)
    |       |-- Lists `.sh` files + actions
    |
    +-- **Sessions & Shortcuts Extension**
        |
        +-- Session List Container (populated from `/api/ext/sessions_and_shortcuts/sessions`)
            |
            +-- Session Card
                |
                +-- Menu Actions
                    |-- "Run Shortcut..." (opens modal)
                    |-- "Run Command..." (opens modal)
                    |-- "Kill Session" (API DELETE)

[MODALS] (Exist in main index.html but are triggered by extensions)
|
+-- Command Modal
+-- Shortcut Modal
```
