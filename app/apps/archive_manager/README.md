# Archive Manager App

The Archive Manager app provides a touch-friendly interface for browsing the
filesystem and archive contents using the native libarchive library through
Python's `libarchive-c` binding. Supported backend capabilities are browsing,
launcher URL preparation, extraction/verification jobs and ZIP creation/update.

## Requirements
- Native libarchive plus Python `libarchive-c` (declared in TE2 requirements).
  Do not install the unrelated Python distribution named `libarchive` alongside
  it: both provide the same import namespace and can overwrite its files. If
  that collision occurs, remove the conflicting distribution and reinstall
  `libarchive-c` to restore the `file_reader` API.
- All filesystem operations are restricted to the user home directory.

## Backend Endpoints
All endpoints live under `/api/app/archive_manager/` and return the standard
`{ ok: true, data: ... }` success envelope; HTTP errors retain `{ detail: ... }`.
Implemented routes are `/ping`, `/browse`, `/archives/launch`, `/archives/extract`,
`/archives/create` and `/archives/test`. Create defaults to `.zip`; creation and
Add support ZIP only and reject other output formats explicitly. Add rewrites
the ZIP atomically, retaining other members and replacing matching paths. Create
requires explicit overwrite consent for an existing target; cancellation/failure
before commit preserves it. No 7-Zip executable or new dependency is required.

`/jobs` GET/POST and `/jobs/<id>` GET/DELETE plus `/jobs/<id>/cancel` POST are
app-owned admission/status/cancel routes, not framework `/api/jobs`. Archive
Manager and File Explorer use separate `<app-data>/jobs.json` registries and
allowlists. Existing pending/running records become failed after worker restart,
never replayed. Responses are job admission, not operation completion; polling
drives progress and completion UI. Four concurrent jobs per app are allowed;
state writes coalesce rather than creating a thread per progress update.

Extraction uses libarchive and rejects traversal, escaping links and special
files; overwrite policy is rename (default), skip, error or replace. Completed
members can remain after cancellation; extraction is not a whole-directory
transaction. Password-protected extraction is explicitly unsupported. ZIP and
per-file extraction staging uses same-directory temporary files.

This is a bounded current-release compatibility repair. Next-version direction
is to move archive execution/jobs behind the framework pipe, not expand Python
archiving or resurrect the retired global Python framework API.

`backend.py` exports `TE2_ASGI_APP`, composed in `http_app.py` using neutral
`app.libs.te2_asgi` helpers. App-owned msgspec request shapes validate commands;
JSON ingress is bounded to 1 MiB. Filesystem/archive and job-admission work stays
off the ASGI event loop. The ordinary worker serving hook still owns readiness.
There are no Archive Manager FastAPI/Pydantic imports.

### `GET /ping`

Returns `{ ok: true, data: { message: "archive-manager ready" } }`.

### `GET /browse`
List filesystem directories or archive contents.

Query parameters:
- `path` – Filesystem path (accepts `~`). Defaults to `~`.
- `hidden` – `1`/`true` to include dotfiles.
- `archive` – Force archive mode when the path extension is not recognised.
- `internal` – Archive-internal path (e.g. `docs/manual`).

**Example**
```bash
curl '/api/app/archive_manager/browse?path=~/Downloads&hidden=1'
```
```bash
curl '/api/app/archive_manager/browse?path=~/Downloads/data.7z&archive=1&internal=reports'
```

### `POST /archives/extract`
Extract specific entries from an archive.

Body:
```json
{
  "archive_path": "~/Downloads/data.7z",
  "items": ["reports/summary.pdf", "assets"],
  "destination": "~/Documents/reports",
  "options": {}
}
```

An empty `items` list extracts the entire archive. The response is the existing
public `extract_archive` job record, not an extraction-completion signal.
`options` is retained in the job payload for compatibility; the current extraction
handler does not implement the old documented password/overwrite option policies.

### `POST /archives/launch`
Return a launcher URL that opens the Archive Manager focused on a particular archive. Optional fields include `internal` (subpath), `filesystem_path` (last directory to return to), `destination`, and `show_hidden` (boolean).

Body:
```json
{
  "archive_path": "~/Downloads/data.7z",
  "filesystem_path": "~/Downloads",
  "internal": "reports",
  "show_hidden": true
}
```
Response includes `app_url` (e.g. `/app/archive_manager?archive=/.../data.7z&path=~/Downloads`).

## Frontend Highlights
- Shared layout with the file explorer: toolbar actions, breadcrumbs, and card
  grid.
- Supports browsing regular directories and archive contents in the same UI.
- Multi-select with checkboxes for extracting files.
- Dedicated toolbar button exits an open archive back to the last filesystem
  path.
- Recognises query parameters (`?archive=/abs/path&internal=subdir`) so other
  apps can deep-link into specific archives.
- Uses the shared Termux file picker for choosing archive destinations and
  extraction targets.

## Manual Smoke Tests
1. Launch the framework, open the Archive Manager card, and verify the home
   directory listing renders.
2. Open an existing archive. Choose entries and tap
   **Extract Selected**, picking a destination directory to ensure extraction
   succeeds.
3. Exercise the supported APIs with `curl` to confirm browsing/extraction
   admission and error responses.
4. Call `/api/app/archive_manager/archives/launch` to obtain a deep-link URL and
   load it in a browser tab to ensure the app jumps directly into the requested
   archive (then use the **Back to Filesystem** button).

## Validation and activation

Run `ty check app/apps/archive_manager/backend.py app/apps/archive_manager/http_app.py`
and `python -m pytest -q tests/test_archive_manager_asgi.py` with isolated TE2 data
roots so diagnostic imports cannot touch the live job-state file. The tests exercise
real ZIP/libarchive fixtures and extraction handlers without starting shared jobs.
Backend activation is an ordinary Archive Manager worker restart. Frontend source
now lives in `src/` and builds to one minified `main.js` at the existing asset URL;
run `npm run typecheck`, `npm test`, and `npm run build` from this directory.
See [FRONTEND.md](FRONTEND.md) for ownership and publication details. Native
frontend activation requires OTA or matching packaged assets; neither frontend
nor ordinary backend activation requires a Code TE2 mypyc or Cargo rebuild.
