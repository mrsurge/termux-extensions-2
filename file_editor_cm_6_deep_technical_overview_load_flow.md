# file_editor_cm6 — Deep Technical Overview & Load Flow

> This is a **deeper, system‑level** description of how the `file_editor_cm6` app runs today, what components exist, and the exact boot/load flow inside the framework. It reflects the current state (single‑user, localhost) and notes gaps where behavior is incomplete.

---

## A) High‑level topology

```
Browser (CM6 UI)  ⇄  HTTP(S)  ⇄  App Server (Flask)  ⇄  Filesystem
                         │
                         └─ Watcher (core_read) → WS push (replace_full/save_ack)
```

- **Frontend**: CodeMirror 6 editor (`main.js` + `template.html`).
- **Backend**: Flask blueprint in `main.py`, exposing REST + WebSocket routes under the app prefix.
- **Libraries**: `core_read.py` (watcher + event fanout), `core_write.py` (atomic writes), `history_store.py` (per‑project recents), `preferences_store.py` (editor prefs).

---

## B) How the framework discovers & loads the app

1. **Filesystem layout**
   - App root: `app/apps/file_editor_cm6/`
   - Key files: `manifest.json`, `template.html`, `main.py`, `main.js`, plus the Python libs above.

2. **Manifest registration**
   - `manifest.json` declares the app’s **slug/route** and static/template locations. The framework mounts:
     - **Page** at `/app/file_editor_cm6` → returns `template.html`.
     - **Static** at `/apps/file_editor_cm6/...` → serves `main.js`, CSS, and other assets.
     - **API prefix** at `/api/app/file_editor_cm6` → routes provided by `main.py`’s blueprint.

3. **Blueprint mounting**
   - `main.py` defines a Flask **Blueprint** (e.g., `file_editor_cm6_bp`) and registers REST + WebSocket endpoints. The host framework imports `main.py` and attaches the blueprint at `/api/app/file_editor_cm6`.

*(If any of these names differ locally, the framework still follows the same idea: manifest → static + page mount → blueprint under `/api/app/<slug>`.)*

---

## C) Runtime load flow (request → UI ready)

### 1) Page request
- Browser GETs `/app/file_editor_cm6`.
- Server responds with `template.html`. The template includes:
  - The CM6 host element (editor mount).
  - Toolbar + (WIP) drawer shell.
  - `<script type="module" src="/apps/file_editor_cm6/main.js">`.

### 2) Frontend boot (main.js)
1. **State hydration**
   - Generate or restore a stable `clientId` (localStorage).
   - Fetch **preferences** (`GET /api/app/file_editor_cm6/preferences`) and apply `editor.autoSave`.
   - (When implemented) fetch **project/current** → show project label; fetch **history/files** for that project → render Recent Files UI.

2. **Open a document**
   - When a file is selected (Recent item, explorer click, or direct path), the editor sets the CM6 doc contents and then opens the **read WebSocket** to:
     - `GET /api/app/file_editor_cm6/ws/read?path=<rel>&client_id=<uuid>`.
   - Any previous socket is closed (one file open at a time).

3. **Wire editing loops**
   - **Autosave**: on content change, debounce (~1200 ms), then `POST /api/app/file_editor_cm6/write` with `{path, content, client_id, op_id, base:{sha256}}`.
   - **Manual save**: menu/shortcut calls the same `doSave()` as autosave.

4. **Listen for server pushes**
   - WebSocket `message` handler processes **only**:
     - `replace_full`: replace the editor buffer **iff** not mid‑save (or after a short grace interval). Also update the client’s `lastSha256`.
     - `save_ack`: if `op_id` matches the inflight save, mark Saved and clear the inflight flag.

### 3) Backend flow
- **WebSocket /ws/read**
  - On first connect, `main.py` calls `core_read.init_watcher(project_root)` (idempotent).
  - `core_read.subscribe(path, client_id, on_event)` registers a callback that forwards events to the socket. On subscribe (or immediately thereafter) the server sends **one** `replace_full` snapshot of the file.

- **REST /write**
  - `main.py` calls `core_write.write_full(project_root, path, content, base_sha256)`.
  - On success (200), it returns `{mtime,size,sha256}` and invokes `core_read.push_save_ack(path, op_id, client_id, meta)` to immediately notify the UI.
  - On base hash mismatch, it returns **409** with `{ current:{ sha256, mtime } }` (UI can reload/rebase and retry once).

---

## D) Library responsibilities

### `core_write.py` — atomic, durable full‑file save
- **Algorithm**: write to temp → `fsync(temp)` → `os.replace(temp, target)` → `fsync(dir)`.
- **Optional concurrency hint**: if `base_sha256` is provided and doesn’t match the target’s current hash, the write is rejected (conflict path) so the client can reload/rebase.
- **Return**: `{mtime, size, sha256}` of the resulting file.

### `core_read.py` — project watcher + push events
- **Watcher**: on first use, starts Watchdog (or a polling fallback) rooted at the **current project**.
- **Events**: coalesces bursts and emits a single `replace_full` snapshot for a changed file; can also emit `save_ack` (from `push_save_ack` calls after writes).
- **Subscription**: per open file (`path`, `client_id`), delivering only the event shapes the UI consumes.

### `history_store.py` — per‑project recents
- Maintains a mapping of **project → [recent files]**, stored on disk.
- Exposed by `main.py` via `/history/*` routes. UI reads the list to populate the Recent menu and records openings/closures.

### `preferences_store.py` — editor prefs
- Minimal key today: `editor.autoSave` (boolean). Read on boot; persist on toggle.

---

## E) Data contracts (canonical)

**WebSocket events**
```json
{"type":"replace_full","path":"<rel>","content":"<text>","language":"<id>"}
{"type":"save_ack","path":"<rel>","op_id":"<uuid>","client_id":"<uuid>"}
```

**Write request/response**
```json
// Request (POST /write)
{"path":"<rel>","content":"<text>","client_id":"<uuid>","op_id":"<uuid>","base":{"sha256":"<hex>"}}

// 200 OK
{"ok":true,"data":{"mtime":1730,"size":1234,"sha256":"<hex>"}}

// 409 Conflict (base mismatch)
{"ok":false,"error":"BASE_MISMATCH","data":{"current":{"sha256":"<hex>","mtime":1729}}}
```

---

## F) Current gaps (must‑fix next)

1. **Open Project is not functional** → the app cannot reliably set the active project root; all history/picker logic degrades to the default root.
2. **Per‑project recents do not persist** → because the project cannot be set, all `/history/*` calls are keyed to the wrong root.
3. **Drawer mechanics are inconsistent** → the drawer exists, but IDs/toggles differ between `template.html` and JS; the “Open Project…” button sometimes ends up in the header.
4. **Explorer tree is not wired** → the collapsible listing is planned, not active.

---

## G) Performance & UX notes

- **One WS per open file** keeps resource usage small and avoids multi‑tab state.
- **Debounce** (50–200 ms) in the watcher is recommended to coalesce tool‑generated bursts (write→rename), reducing redundant snapshots.
- **Echo guard** after save avoids flicker when the watcher reports our own write immediately.

---

## H) Extensibility points

- **Project services**: add `project/open`, `project/current` endpoints and a tiny helper to persist the chosen root; reload page on success.
- **Explorer helper**: small Python module to list directories with basic metadata (kind, size, mtime). JS module renders a collapsible tree; node click calls the existing `openFile` hook.
- **Git (later)**: thin wrapper emitting a compact status summary for the drawer footer; strictly additive to the current autosave path.

---

## I) End‑to‑end sequence (happy path)

```
[1] GET /app/file_editor_cm6  →  template.html + main.js
[2] main.js boots → fetch prefs → (project label) → render UI
[3] User opens a file → CM6 sets buffer → open WS /ws/read?path=…&client_id=…
[4] core_read sends snapshot (replace_full)
[5] User types → debounce → POST /write {path, content, base.sha256}
[6] core_write atomic replace → return meta → core_read.push_save_ack(...)
[7] UI marks Saved; next autosave uses returned sha256
[8] External edit happens → core_read emits replace_full → UI updates buffer
```

---

## J) Minimal acceptance (what “green” looks like)

1. Choose project → page reload shows that path; Recent menu lists only that project’s items.
2. Open a file → immediate WS snapshot populates CM6.
3. Type → autosave 200; Saved indicator; no flicker.
4. External change → single snapshot updates editor.

---

If you want this broken down into a one‑pager for contributors (with just the routes, events, and boot steps), I can produce that too.

