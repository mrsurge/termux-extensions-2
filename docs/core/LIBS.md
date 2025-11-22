# Framework Shared Libraries

The `app/libs/` directory contains shared Python modules that provide core functionality accessible to both the framework and individual applications.

## Automatic Loading & Router Registration

The framework automatically scans and imports all modules in `app/libs/` during startup.

### How it works

1.  **Scanning:** The `load_services()` function in `app/main.py` iterates through all `.py` files in `app/libs/`.
2.  **Importing:** Each module is imported.
3.  **Router Registration:** If the module defines an `APIRouter` instance named `bp` or `router`, it is automatically registered with the main FastAPI application.

### Creating a New Library

To create a new shared library (e.g., `my_utils.py`):

1.  Create the file: `app/libs/my_utils.py`
2.  Define your router with a prefix:
    ```python
    from fastapi import APIRouter

    # IMPORTANT: Define the prefix here.
    # The router will be mounted at this path.
    bp = APIRouter(prefix="/api/my_utils")

    @bp.get("/status")
    def get_status():
        return {"ok": True}
    ```
3.  **Done!** The framework will automatically serve `GET /api/my_utils/status`.

## Existing Libraries

*   **`app_manager.py`**: Manages app worker processes.
*   **`app_lifecycle.py`**: Handles startup/shutdown tasks and app state tracking.
*   **`app_worker.py`**: The entry point for spawned app processes.
*   **`bookmarks.py`**: Provides the `/api/bookmarks` endpoints.
*   **`framework_shells.py`**: Manages background shells (terminals, daemons).
*   **`jobs.py`**: Provides the `/api/jobs` background task system.
*   **`git_utils.py`**: Shared Git operations and `/api/git/summary` endpoint.
