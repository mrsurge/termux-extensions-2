# file_editor_cm6 — Deep Technical Overview

> **Goal of this doc:** explain how the app runs end‑to‑end, what each part does, and how the framework loads/mounts the app. This reflects the current Stage‑1 design and the present state (including broken bits).

---

## 1) High‑level runtime model
- **Single‑user, localhost.** Exactly one document is considered “open” at a time.
- **Split UI/Backend:**
  - **Frontend (CM6)** renders the editor, manages autosave/manual save, connects one **WebSocket** for live updates, and calls **REST** for writes, preferences, and history.
  - **Backend (Flask + Sock)** exposes a small set of routes under the app prefix, and delegates file I/O to Python helper libraries.
- **Optimistic concurrency:** saves carry a `base.sha256` of the buffer the user edited; if the file changed underneath, the server returns **409 BASE_MISMATCH** so the client can reload and retry once.

---

## 2) App package layout
```
app/apps/file_editor_cm6/
  main.py                 # Flask blueprint + WS + REST routes
  main.js                 # App bootstrap + CM6 wiring (WS + autosave + UI glue)
  manifest.json           # Framework registration metadata
  template.html           # App HTML shell (toolbar, drawer shell, CM6 host)
  core_read.py            # Project watcher + event fan‑out (replace_full, save_ack)
  core_write.py           # Atomic full‑file writes (+ optional base hash check)
  history_store.py        # Per‑project recent files
  preferences_store.py    # Editor prefs (currently: autoSave)
  static/
    js/…                  # Optional helpers (e.g., explorer.js)
    css/…                 # Editor/drawer styles
```

---

## 3) How the framework loads the app
1. **App discovery:** the framework scans `app/apps/*/manifest.json` and registers each app.
2. **Blueprint mount:** `main.py` defines a Flask **Blueprint** (e.g., `file_editor_cm6_bp`) with a URL prefix like `/api/app/file_editor_cm6` (APIs) and `/app/file_editor_cm6` (page).
3. **Template render:** `GET /app/file_editor_cm6` returns `template.html`. That page includes `main.js` (module) and the CM6 assets.
4. **Static mapping:** files under `static/` are served beneath `/apps/file_editor_cm6/static/...` and are referenced from the template.
5. **WS integration:** the framework initializes Sock (Flask‑Sock) so `main.py` can define `@sock.route('/api/app/file_editor_cm6/ws/read')` for the live stream.

Once loaded, the page bootstraps the editor and connects to the backend:
- Fetch **preferences** and hydrate UI (`editor.autoSave`).
- Determine or prompt for **project** (see §7 — currently broken) and render **recent files** for that project.
- **Open a file** (from recent or picker): set CM6 buffer and connect WS.

---

## 4) Backend responsibilities & routes
### 4.1 WebSocket (read‑only)
- **Route:** `GET /api/app/file_editor_cm6/ws/read?path=<rel>&client_id=<id>`
- **Lifecycle:** on connect → ensure watcher is initialized for the current project → **subscribe** to events for `path` → server immediately sends a full snapshot → forward any further events. Incoming client messages are ignored.
- **Events:**
  - `replace_full` `{ path, content, language }` — authoritative file snapshot to apply in the editor.
  - `save_ack` `{ path, op_id, client_id }` — confirmation that the client’s save with `op_id` landed.

### 4.2 Write (autosave & manual)
- **Route:** `POST /api/app/file_editor_cm6/write`
- **Body:** `{ path, content, client_id, op_id, base?:{ sha256 } }`
- **Server:** delegates to `core_write.write_full(root, path, content, base_sha256=…)` (temp → fsync → `os.replace` → fsync dir).
- **Responses:**
  - `200 { ok:true, data:{ mtime, size, sha256 } }` + immediate `save_ack` fan‑out via `core_read.push_save_ack`.
  - `409 { ok:false, error:'BASE_MISMATCH', data:{ current:{ sha256, mtime } } }` if base doesn’t match.

### 4.3 Preferences & History
- **Preferences**: `GET/POST /api/app/file_editor_cm6/preferences` → reads/writes a JSON blob; the app currently uses `editor.autoSave` only.
- **History**: `GET/POST/DELETE /api/app/file_editor_cm6/history…` → CRUD for **per‑project** recent files (see §7 for the broken project scoping).

---

## 5) Python helper libraries
- **`core_write.py`** — atomic full‑file replace with durability; returns `{ mtime, size, sha256 }`. If `base_sha256` is passed and mismatched, raises a typed conflict handled as HTTP 409.
- **`core_read.py`** — initializes a single watcher for the current project and exposes `subscribe/unsubscribe` so the backend can fan‑out `replace_full` snapshots (and `save_ack`). A small per‑path debounce (50–200 ms) is recommended to coalesce tool‑generated bursts.
- **`history_store.py`** — maintains recent files **keyed by project root**. The UI consumes this to populate the Recent menu and (optionally) horizontal recent tabs.
- **`preferences_store.py`** — persists editor preferences; Stage‑1 only uses `editor.autoSave`.

---

## 6) Frontend lifecycle & state
- **Boot:** `main.js` mounts CM6, loads preferences, and initializes UI controls.
- **Open file:** when the user selects a file (recent/picker), the app sets the CM6 doc, **opens WS** to `/ws/read` for that `path`, and saves a stable `clientId` in `localStorage`.
- **Live updates:** on `replace_full`, the app replaces the buffer if not mid‑save (or after a short grace interval) and updates `lastSha256` to avoid 409s on the next autosave.
- **Autosave:** any change schedules a save after ~1200 ms if `autoSave` is on, posting to `/write` with `base.sha256 = lastSha256`.
- **Manual save:** toolbar/shortcut calls the same `doSave()` used by autosave.
- **Indicators:** a “Saving/Saved” affordance is driven by `inflightOpId` and `save_ack`.

---

## 7) Project model & recents (current status: **broken**)
- **Intended:** the app maintains a single **active project root** (a directory). All file operations and history calls resolve **relative to that root**. History is **per‑project**: each project has its own recent list.
- **Today’s issue:** the **Open Project** flow is not reliably setting the project root, so History sees the default root and cannot scope recents. As a result, the Recent Files menu is empty/stale or mixed across projects.
- **Drawer:** the drawer shell exists, but toggle wiring and the placement of the **“Open Project…”** button are inconsistent across template/JS, which contributes to the broken flow.

---

## 8) Sequence (request/response) snapshots
### 8.1 Open → Edit → Autosave (happy path)
1. `GET /app/file_editor_cm6` → template + `main.js`.
2. (User opens file) → UI sets CM6 doc and opens `WS /ws/read?path=…&client_id=…`.
3. Server sends `replace_full` → UI adopts buffer and sets `lastSha256`.
4. User types → after ~1200 ms → `POST /write` (with `base.sha256`).
5. Server writes atomically → `200` + `save_ack` → UI marks Saved.

### 8.2 External edit → Live update
1. File changes on disk (outside the app).
2. Watcher detects and coalesces if needed → pushes `replace_full`.
3. UI replaces buffer and updates `lastSha256`.

### 8.3 Conflict
1. External change occurs between last snapshot and autosave.
2. `POST /write` returns `409 BASE_MISMATCH`.
3. UI reloads latest, rebases once, retries once; on success, proceeds as 8.1‑5.

---

## 9) Known gaps (to be addressed next)
- **Open Project**: add/verify `POST /project/open` and `GET /project/current`; ensure the drawer’s **Open Project** button calls them and reloads the page on success.
- **Per‑project recents:** after the project is set, repopulate Recent menu only from that project’s bucket.
- **Drawer mechanics:** settle on **one** drawer in `template.html`, with canonical IDs and a class‑based toggle (`.drawer-open`) plus backdrop.
- **Noise filtering in watcher:** exclude heavy dirs like `node_modules`, `dist`, `build`, `.venv` to avoid floods.

---

## 10) Extensibility (when core is green)
- **Explorer tree:** small helper pair — `explorer_helper.py` for directory listing and `static/js/explorer.js` for DOM/expand‑collapse.
- **Git add‑on (optional):** thin status/diff endpoint; drawer summary only (non‑blocking).
- **Preferences surface:** expose tab size, soft wrap, and themes through the existing prefs API.

---

## 11) Quick diagnostic checklist
- Page includes **only** `/apps/file_editor_cm6` assets (no Code‑OSS includes).
- Template IDs match what `main.js` expects (drawer buttons, recent menu, labels).
- On file open: WS connects, one `replace_full` arrives, `lastSha256` updates.
- On edit: autosave → 200; UI marks Saved; next autosave uses the returned hash.
- On external change: exactly one snapshot applies; no flicker.
- On project switch: page reloads; recents redraw scoped to that project.

