# File Editor CM6 — Stage‑1 Integration (Agent Instructions)

> **Mode:** be exact; no creative changes.\
> **Scope:** `app/apps/file_editor_cm6` only. Reuse the Python libs from the Code‑OSS work. Implement **one WebSocket** for reads and **one REST** endpoint for writes/autosave. Do not add Git. Do not touch the file explorer yet.

---

## 0) Paths & naming (use exactly)

- App root: `app/apps/file_editor_cm6/`
- **Existing app files (keep):** `main.py`, `main.js`, `manifest.json`, `template.html`
- **Context files (currently under** `app/apps/file_editor_cm6/code editor source files/` **with ********`old.`******** prefix):**
  - `old.core_read.py`, `old.core_write.py`, `old._preferences_store.py`, `old.history_store.py`

**Action:** Move and rename these into the **app root** (remove the `old.` prefix): **UPDATE** (this has been done already)

- `core_read.py`, `core_write.py`, `_preferences_store.py`, `history_store.py`

Do **not** change directory structure further in this stage.

---

## 1) Python: wire the read/write libs in `main.py`

Add imports at the top of `main.py`:

- `from . import core_read, core_write`
- `from .core_write import BaseMismatchError`
- `from pathlib import Path`

Define a helper to resolve the **project root** (reuse your app’s existing mechanism; fallback to `Path.cwd()` if none is set):

- `_project_root() -> Path`

### 1.1 WebSocket (read) — route MUST be:

`GET /api/app/file_editor_cm6/ws/read`

- Query params required: `path=<relpath>`, `client_id=<string>`
- On connect:
  - `core_read.init_watcher(project_root)` once (idempotent).
  - `token = core_read.subscribe(path, client_id, lambda ev: ws.send(json.dumps(ev)))`
  - Enter a read loop; ignore incoming messages.
- On disconnect: `core_read.unsubscribe(token)`

**Event shapes sent to client (only these):**

- `{"type":"replace_full","path": "...","content": "...","language":"..."}`
- `{"type":"save_ack","path":"...","op_id":"...","client_id":"..."}`

### 1.2 REST write — route MUST be:

`POST /api/app/file_editor_cm6/write`

- Body: `{"path":str,"content":str,"client_id":str,"op_id":str,"base":{"sha256":str}}` (`base` optional)
- On success: `{"ok":true,"data":{"mtime":int,"size":int,"sha256":str}}`
- On conflict: HTTP 409 with `{"ok":false,"error":"BASE_MISMATCH","data":{"current":{"sha256":str,"mtime":int}}}`
- After success: call `core_read.push_save_ack(path, op_id, client_id, meta)` immediately.

> **No Git** in this stage. Do not trigger status/diff. Do not add other routes.

---

## 2) JS (`main.js`) changes — minimal wiring

**State (introduce if missing):**

- `clientId` (stable per tab; store in `localStorage`).
- `lastSha256` (updated on open and successful saves).
- `inflightOpId` (UUID during save).
- `autoSaveEnabled` (hydrate from preferences on load).
- `autoSaveTimer` (debounce handle).

### 2.1 Connect WS on file open

- After the editor loads a file buffer, open **one** WS to `/api/app/file_editor_cm6/ws/read?path=...&client_id=...` and close any previous one.
- Handle messages:
  - `replace_full`: if **not** currently saving (or a 300ms grace has elapsed), replace editor content and update `lastSha256` (compute if not provided).
  - `save_ack`: if `op_id` matches `inflightOpId`, set “Saved” indicator and clear `inflightOpId`.

### 2.2 Autosave (debounced)

- On content change, if `autoSaveEnabled`, debounce **1200 ms** then `POST /api/app/file_editor_cm6/write` with `{path, content, client_id, op_id, base:{sha256:lastSha256}}`.
- On 200: set `lastSha256` from response; mark clean.
- On 409: fetch latest file, rebase once, retry once; otherwise show a non‑blocking conflict banner.

### 2.3 Manual save

- Menu/shortcut must call the **same** `doSave()` used by autosave.

### 2.4 Auto Save toggle

- Use existing UI control. Persist via `POST /api/app/file_editor_cm6/preferences` with `{ "editor": { "autoSave": boolean } }` (see §3). Apply in-memory immediately; if turning ON and dirty, schedule a save.

---

## 3) Preferences (reuse existing store)

Mount a tiny pair of routes in `main.py` forwarding to `_preferences_store.py`:

- `GET /api/app/file_editor_cm6/preferences` → returns the current prefs object.
- `POST /api/app/file_editor_cm6/preferences` with body `{ "editor": { "autoSave": boolean } }` → merges and persists.

Only the `editor.autoSave` key is needed in Stage‑1.

---

##
