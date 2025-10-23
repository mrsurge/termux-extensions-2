# Stage-1 Hotfix — Reads & Autosave Bring-up (Full Fix Description)

> Goal: make the current Code-OSS app boot, open one file, autosave reliably, and reflect external edits — **without** touching legacy bridge code and **without** re-adding Git.\
> Scope: `core_read.py`, `core_write.py`, `backend.py`, `static/js/ide_fullpage.js`.

---

## 1) `core_read.py` — Fix watcher wiring + single-file stream

**What’s broken**

- Watchdog symbols are referenced but not imported/guarded.
- Per-file event coalescing is missing (can cause duplicate `replace_full` bursts).
- Self-echo `replace_full` immediately after a save will flicker the editor.

**Change list**

1. **Guarded imports + feature flag**
   - Add a `try/except` import for `FileSystemEventHandler` and `Observer`.
   - Set `_is_watchdog_available: bool`; define no-op fallbacks when not available.
2. **Initialize one watcher**
   - Ensure `init_watcher(project_root)` starts **either** a watchdog observer **or** a 200–300 ms polling loop. Only one per process.
3. **Per-path debounce (50–200 ms)**
   - Before emitting `replace_full`, coalesce bursts for the same `path` into one snapshot.
4. **On subscribe (current file only)**
   - Immediately send a **single** `replace_full` snapshot for the requested `path` (UTF-8 with errors replaced).
   - Include `{"type":"replace_full","path","content","language"}`. (No seq/replay needed in this stage.)
5. **Self-echo suppression**
   - When `push_save_ack(path, op_id, client_id, meta)` is called, keep a short (≈300 ms) suppression window for `replace_full` to the **same** `client_id`/`path`. Other clients still receive snapshots.

**Public functions (unchanged names)**

- `init_watcher(project_root: Path) -> None`
- `subscribe(path: str, client_id: str, on_event: Callable[[dict], None]) -> str`
- `unsubscribe(token: str) -> None`
- `push_save_ack(path: str, op_id: str, client_id: str, meta: dict) -> None`

---

## 2) `core_write.py` — Confirm atomic replace + conflict check

**What’s good**

- Temp write → `fsync(temp)` → `os.replace()` → `fsync(dir)` is correct.
- Returns `{mtime,size,sha256}` which the UI uses for `base.sha256`.

**Change list**

- None required for Stage-1, aside from mirroring the same path-resolution rules you use for **open** to keep behavior consistent.
- Keep the optional `base_sha256` check; return a typed **409** from the route (below) on mismatch.

---

## 3) `backend.py` — Wire one WS route + one REST write route

**What’s broken**

- References to symbols not imported (e.g., `BaseMismatchError`).
- The WS receive loop uses a timeout param that may not exist.
- Post-write Git status thread is referenced but Git isn’t part of Stage-1.

**Change list**

1. **Imports**
   - Add: `from .core_write import BaseMismatchError`
2. **WebSocket (read-only)**
   - Route: `GET /api/app/code_oss/ws/read`
   - Required query params: `path`, `client_id`
   - On connect:
     - Call `init_watcher(project_root)` once.
     - Token = `subscribe(path, client_id, lambda ev: ws.send(json.dumps(ev)))`
     - Enter a simple `while ws.receive() is not None: pass` loop (ignore payloads).
   - On disconnect: `unsubscribe(token)`
3. **Write (autosave/manual save)**
   - Route: `POST /api/app/code_oss/write`
   - Body: `{"path","content","client_id","op_id","base":{"sha256"}}` (base is optional)
   - Call `write_full(...)`.
     - On success: return `{"ok":true,"data":{mtime,size,sha256}}`
     - Then call `push_save_ack(path, op_id, client_id, meta)` **synchronously** (tiny dict from write).
     - **Do not** trigger any Git tasks in Stage-1 (comment out or remove the thread).
     - On conflict: return `409 {"ok":false,"error":"BASE_MISMATCH","data":{"current":{"sha256","mtime"}}}`

---

## 4) `static/js/ide_fullpage.js` — WS connect, autosave, and echo guard

**What’s good**

- Debounced autosave to `/write` (≈1200 ms) is present.
- `save_ack` handling exists.

**Change list**

1. **WS per open file**
   - After `openFileInEditor(path)` sets the document, open a **new** WS to `/api/app/code_oss/ws/read?path=…&client_id=…`; close any existing socket first.
   - `onmessage`:
     - `replace_full`: if not currently saving (no inflight op) **or** a short grace period has elapsed since the last save, update the buffer, clear dirty, and update `lastSha256` (compute locally if server didn’t include it).
     - `save_ack`: if `op_id` matches `inflightOpId`, set “Saved” and clear `inflightOpId`.
2. **Autosave**
   - Keep the debounce (≈1200 ms).
   - POST body includes `client_id`, `op_id`, and `base.sha256` when known.
   - On 200: update `lastSha256`, mark clean, refresh existing inline diffs (if that call is already present).
   - On 409: fetch the latest file, rebase once, retry once; otherwise show a non-blocking conflict banner.
3. **Manual save**
   - Ensure menu and `Ctrl/Cmd+S` call the same `doSave()` used by autosave.
4. **Self-echo guard**
   - After a successful save, ignore any `replace_full` for the same `path` for \~300 ms **or** until `inflightOpId` is cleared; this prevents flicker because Stage-1 `replace_full` carries no `op_id`.

---

---

