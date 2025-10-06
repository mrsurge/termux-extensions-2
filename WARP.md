### On-Demand App Architecture

The framework has been refactored to support on-demand loading of application backends. Instead of being loaded into the main server process at startup, each app's backend is now launched in its own isolated, monitored process only when a user clicks on the app icon.

This provides significant benefits in resource efficiency, stability, and process isolation, allowing for per-app resource monitoring.

**Key Components & Flow:**

1.  **App Discovery:** At startup, the main application still scans the `app/apps/` directory to discover all available app manifests. This populates the list of apps shown in the "App Launcher" extension, but does not yet run any code.

2.  **On-Demand Launch:** When a user clicks an app icon in the UI:
    a.  The frontend first sends a `POST` request to a new endpoint: `/api/apps/<app_id>/start`.
    b.  This endpoint triggers the `FrameworkShellManager` to spawn a new, dedicated framework shell for that app.

3.  **App Worker Process:**
    *   The new shell executes a generic worker script, `app/app_worker.py`, using a direct `python` command (e.g., `python /path/to/app/app_worker.py ...`).
    *   The `PYTHONPATH` and `cwd` are explicitly set to ensure the worker can find all necessary modules.
    *   This worker starts a lightweight Flask server on a dynamically assigned port, serving only the requested app's backend blueprint.

4.  **Reverse Proxy:**
    *   A reverse proxy in the main application (`app/main.py`) intercepts all API calls directed at apps (e.g., `/api/app/<app_id>/...`).
    *   It looks up the port assigned to the running app worker and forwards the request, making the distributed architecture seamless to the frontend.

5.  **Process Cleanup:**
    *   The `FrameworkShellManager` has been updated to use `os.killpg` instead of `os.kill`. This ensures that when a shell is terminated (either manually or via the supervisor), the signal is sent to the entire process group, cleanly terminating the worker and any of its children to prevent orphans.
    *   Furthermore, when an app's browser tab is closed, a `pagehide` event now triggers an API call to terminate the app's specific process group, automatically freeing up its resources.

This new architecture makes the framework more scalable and robust, laying the groundwork for more complex applications in the future.