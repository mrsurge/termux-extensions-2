### On-Demand App Architecture

The framework has been refactored to support a persistent, on-demand lifecycle for application backends. Instead of being terminated when the user navigates away, each app's backend now runs as a managed framework shell that persists until it is explicitly quit, it is automatically cleaned up, or the main supervisor is shut down.

This provides a more robust user experience, allowing users to switch between apps without losing their state, while still ensuring efficient resource usage.

**Key Components & Flow:**

1.  **App Discovery:** At startup, the main application scans the `app/apps/` directory to discover all available app manifests. This populates the list of apps shown in the "App Launcher" extension, but does not yet run any code.

2.  **On-Demand Launch:** When a user clicks an app icon in the UI:
    a.  The frontend first sends a `POST` request to a new endpoint: `/api/apps/<app_id>/start`.
    b.  This endpoint triggers the `FrameworkShellManager` to spawn a new, dedicated framework shell for that app.

3.  **App Worker Process:**
    *   The new shell executes a generic worker script, `app/libs/app_worker.py`.
    *   The `PYTHONPATH` and `cwd` are explicitly set to ensure the worker can find all necessary modules.
    *   This worker starts a lightweight Flask server on a dynamically assigned port, serving only the requested app's backend blueprint.

4.  **Reverse Proxy:**
    *   A reverse proxy in the main application (`app/main.py`) intercepts all API calls directed at apps (e.g., `/api/app/<app_id>/...`).
    *   It looks up the port assigned to the running app worker and forwards the request, making the distributed architecture seamless to the frontend.

5.  **Process Cleanup (Managed Lifecycle):**
    *   A new shared library, `app/libs/app_lifecycle.py`, now manages the lifecycle of all app workers.
    *   **Manual Cleanup:** Users can explicitly terminate an app using the "Quit" button in the app shell UI.
    *   **Natural Death:**
        *   **Time-based:** A background thread automatically terminates the oldest *unlocked* apps after a configurable duration (e.g., 30 minutes).
        *   **Resource-based:** If the maximum number of app shells is reached, the oldest *unlocked* app is terminated to make room for a new one.
    *   **Locking:** Users can "Lock" an app from the UI to prevent it from being terminated by the natural death lifecycle.
    *   **Supervisor Cleanup:** When the main framework supervisor shuts down, it terminates all running framework shells, including all app workers.