# Archive Manager App

The Archive Manager app provides a touch-friendly interface for browsing the
filesystem and archive contents using the Termux `7zz` binary. The backend also
exposes endpoints other apps can reuse for compression and extraction tasks.

## Requirements
- Termux package `p7zip` (provides the `7zz` executable) must be installed and
  on the `PATH`.
- All filesystem operations are restricted to the user home directory.

## Backend Endpoints
All endpoints live under `/api/app/archive_manager/` and return the standard
`{ ok, data | error }` envelope.

### `GET /browse`
List filesystem directories or archive contents.

Query parameters:
- `path` – Filesystem path (accepts `~`). Required.
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

### `POST /archives/create`
Create a new archive (or append to an existing one).

Body:
```json
{
  "archive_path": "~/backups/project.7z",
  "sources": ["~/project/src", "~/project/README.md"],
  "options": {
    "format": "7z",
    "compression_level": 7,
    "solid": true,
    "password": null
  }
}
```

### `POST /archives/extract`
Extract specific entries from an archive.

Body:
```json
{
  "archive_path": "~/Downloads/data.7z",
  "items": ["reports/summary.pdf", "assets"],
  "destination": "~/Documents/reports",
  "options": {
    "overwrite": "rename",
    "password": null,
    "preserve_paths": true
  }
}
```

### `POST /archives/expand`
Extract the entire archive into a target directory (wrapper around `/archives/extract` with an empty item list).

Body:
```json
{
  "archive_path": "~/Downloads/data.7z",
  "destination": "~/Documents/data-unpacked",
  "options": {
    "overwrite": "overwrite",
    "password": null
  }
}
```

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

### `POST /archives/test`
Run `7zz t` to verify archive integrity.

Body:
```json
{
  "archive_path": "~/Downloads/data.7z",
  "options": { "password": null }
}
```

## Frontend Highlights
- Shared layout with the file explorer: toolbar actions, breadcrumbs, and card
  grid.
- Supports browsing regular directories and archive contents in the same UI.
- Multi-select with checkboxes for creating archives or extracting files.
- Dedicated toolbar button exits an open archive back to the last filesystem
  path.
- Recognises query parameters (`?archive=/abs/path&internal=subdir`) so other
  apps can deep-link into specific archives.
- Uses the shared Termux file picker for choosing archive destinations and
  extraction targets.

## Manual Smoke Tests
1. Launch the framework, open the Archive Manager card, and verify the home
   directory listing renders.
2. Select a few files/directories and tap **New Archive**. Save the archive via
   the picker and confirm it appears in the listing.
3. Select the newly created archive and open it. Choose entries and tap
   **Extract Selected**, picking a destination directory to ensure extraction
   succeeds.
4. Use **Add to Archive** to append additional files to an existing archive.
5. Exercise the public APIs with `curl` to confirm other apps can automate
   compression/extraction using the same endpoints.
6. Call `/api/app/archive_manager/archives/launch` to obtain a deep-link URL and
   load it in a browser tab to ensure the app jumps directly into the requested
   archive (then use the **Back to Filesystem** button).
