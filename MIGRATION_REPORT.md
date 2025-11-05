# ASGI Migration Report

## Migrated Routes

**`app/main.py`**
- `GET /`
- `GET /api/browse`
- `GET /api/settings`
- `POST /api/settings`
- `GET /api/state`
- `POST /api/state`
- `DELETE /api/state`
- `GET /sw.js`
- `GET /api/app/{app_id}/{subpath:path}`
- `POST /api/app/{app_id}/{subpath:path}`
- `PUT /api/app/{app_id}/{subpath:path}`
- `DELETE /api/app/{app_id}/{subpath:path}`
- `PATCH /api/app/{app_id}/{subpath:path}`
- `OPTIONS /api/app/{app_id}/{subpath:path}`

**`app/libs/bookmarks.py`**
- `GET /api/bookmarks`
- `POST /api/bookmarks`
- `PUT /api/bookmarks`

**`app/libs/framework_shells.py`**
- `GET /api/framework_shells`
- `POST /api/framework_shells`
- `GET /api/framework_shells/{shell_id}`
- `DELETE /api/framework_shells/{shell_id}`
- `POST /api/framework_shells/{shell_id}/action`
- `POST /api/framework_shells/terminate_group`

**`app/libs/jobs.py`**
- `POST /api/jobs`
- `GET /api/jobs`
- `GET /api/jobs/{job_id}`
- `POST /api/jobs/{job_id}/cancel`
- `DELETE /api/jobs/{job_id}`
- `GET /api/jobs/events`

**`app/extensions/apps/main.py`**
- `POST /api/apps/{app_id}/start`
- `POST /api/apps/{app_id}/quit`
- `POST /api/apps/{app_id}/lock`
- `POST /api/apps/{app_id}/unlock`
- `GET /api/apps/running`
- `GET /api/apps`
- `GET /app/{app_id}`
- `GET /apps/{app_dir}/{filename:path}`

**`app/apps/file_editor_cm6/main.py`**
- `GET /`
- `GET /status`
- `GET /read`
- `POST /write`
- `POST /project/open`
- `GET /project/current`
- `GET /git/branches`
- `POST /git/checkout`
- `POST /git/branch`
- `GET /git/status`
- `POST /git/stage_all`
- `POST /git/unstage_all`
- `POST /git/commit`
- `POST /git/push`
- `POST /git/pull`
- `GET /state`
- `GET /preferences`
- `POST /preferences`
- `POST /state/file_activity`
- `GET /diff`
- `GET /explorer/list`
- `GET /history/files`
- `POST /history/touch`
- `DELETE /history/file`
- `DELETE /history/files/all`
- `GET /terminal/shell-id`
- `POST /terminal/shell-id`
- `GET /edit_tracker/status`

**`app/apps/file_editor_cm6/terminal_backend.py`**
- `POST /terminal/create`
- `DELETE /terminal/{shell_id}`
- `POST /terminal/{shell_id}/resize`
- `GET /terminal/{shell_id}`

## Migrated WebSocket Endpoints

**`app/main.py`**
- `/ws/app/{app_id}/{route:path}`

**`app/apps/file_editor_cm6/main.py`**
- `/ws/read`
- `/ws/edit_tracker`
- `/ws/agent`

**`app/apps/file_editor_cm6/terminal_backend.py`**
- `/ws/terminal/{shell_id}`## Notes and Deviations

- The repository was already in a partially migrated state. Many of the files that were supposed to be migrated were already partially or fully migrated.
- The `_manager` function in `app/libs/framework_shells.py` was refactored to use a FastAPI dependency pattern instead of relying on the `request` object. This was not explicitly mentioned in the migration plan, but it was necessary to remove the dependency on the `request` object.
- The `app/extensions/apps/main.py` file was refactored to use a global `loaded_apps` variable instead of `request.app.state.LOADED_APPS`. This was necessary to remove the dependency on the `request` object.
- The `app/apps/file_editor_cm6/terminal_backend.py` file was not explicitly mentioned in the migration plan for the REST endpoints, but it was necessary to refactor it to remove the dependency on the `request` object.


