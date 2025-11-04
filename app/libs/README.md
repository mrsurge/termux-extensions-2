# `app/libs`

This directory contains shared, core framework libraries that are not specific to any single application or extension. They provide foundational services used throughout the Termux Extensions project.

## Modules

- **`app_lifecycle.py`**: Manages the lifecycle of all running application shells, including tracking their state, enforcing TTL and resource limits, and handling lock states.

- **`app_manager.py`**: Responsible for the on-demand spawning of app worker processes.

- **`app_worker.py`**: A generic script that runs as a dedicated process for each application, hosting the app's specific backend blueprint.

- **`archiver.py` / `archiver_service.py`**: Provides centralized services for archive operations (e.g., extraction) using `libarchive`.

- **`bookmarks.py`**: Manages user-defined file system bookmarks.

- **`framework_shells.py`**: The core service for managing all long-running background processes, including both app workers and persistent services.

- **`jobs.py`**: A lightweight background job registry for short-to-medium duration asynchronous tasks.

- **`optional_import.py`**: A utility for safely importing modules that may not be installed.

- **`shell_groups.py`**: Provides helpers for managing groups of related framework shells.
