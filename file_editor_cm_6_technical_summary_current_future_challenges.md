# file_editor_cm6 — Technical Summary (Current • Future • Challenges)

> Scope: the **file_editor_cm6** app only. Single‑user, localhost. This document captures how the app operates today (Stage‑1), what we plan next, and the known challenges/quirks to track.

---

## 1) Current architecture (Stage‑1)

### Components
- **Frontend** (`main.js`, `template.html`)
  - CodeMirror 6 editor with Android‑native selection logic.
  - Autosave + manual save UI; WS listener for external changes.
  - Project UI (drawer + recent files) under integration.
- **Backend** (`main.py`)
  - **WebSocket**: read/notify channel for a single open file.
  - **REST write**: atomic full‑file saves (used by autosave & manual save).
  - **Preferences**: minimal API for `editor.autoSave`.
  - **History**: per‑project recent files list.
- **Libraries**
  - `core_read.py`: watches the current project and pushes `replace_full` snapshots.
  - `core_write.py`: atomic write (`fsync(temp) → replace → fsync(dir)`) + optional base hash check.
  - `history_store.py`: per‑project recent file tracking.
  - (Optional helper) `explorer_helper.py`: project root holder + directory listing (WIP).

### Routes & contracts (as implemented)
- **WebSocket** `GET /api/app/file_editor_cm6/ws/read?path=<rel>&client_id=<id>`
  - Server emits JSON events (no inbound commands):
    - `{"type":"replace_full","path","content","language"}`
    - `{"type":"save_ack","path","op_id","client_id"}`
- **Write** `POST /api/app/file_editor_cm6/write`
  - Body: `{ path, content, client_id, op_id, base: { sha256 }? }`
  - 200: `{ ok:true, data:{ mtime, size, sha256 } }`
  - 409: `{ ok:false, error:"BASE_MISMATCH", data:{ current:{ sha256, mtime } } }`
- **Preferences**
  - `GET /api/app/file_editor_cm6/preferences` → `{ ok:true, data:{ editor:{ autoSave } } }`
  - `POST /api/app/file_editor_cm6/preferences` with `{ editor:{ autoSave:boolean } }`
- **History (per project)**
  - `GET /api/app/file_editor_cm6/history?project=<abs-or-key>` → list recent for that project
  - `POST /api/app/file_editor_cm6/history` `{ project, path, action:"add" }`
  - `DELETE /api/app/file_editor_cm6/history?project=…&path=…` `{ action:"remove" }`

### Frontend behavior (state & flow)
- **Open file** → fetch snapshot (on page load or via menu), set CM6 doc, **connect WS** for that `path`.
- **External edits** → watcher emits **one** `replace_full`; UI replaces buffer if not mid‑save and updates `lastSha256`.
- **Autosave** → on local changes, debounce ~1200 ms → POST `/write` with `base.sha256`.
  - On 200: update `lastSha256`, set Saved, optional inline diff refresh.
  - On 409: reload latest, rebase once, retry once; else show non‑blocking conflict banner.
- **Manual save** (menu / ⌘/Ctrl+S) → calls the same `doSave()` path as autosave.
- **Echo guard** → after save, ignore immediate `replace_full` for a short grace interval.

---

## 2) What’s working well now
- Atomic, durable writes with metadata returned to the client.
- Reliable external‑edit detection and single‑snapshot updates via WS.
- Debounced autosave that keeps the document clean without churn.
- Per‑project recents are persisted and available via the history API.
- Template uses CM6 as the primary surface (no Code‑OSS dependency at runtime).

---

## 3) Future plans (near‑term)
1. **Open Project + Drawer (stabilize)**
   - Single source of truth: **one** drawer inside `template.html` with IDs the JS expects; class‑based toggle (`.drawer-open` on root) with backdrop.
   - Move “Open Project…” **into** the drawer header; toolbar has an **Explorer** button that toggles the drawer only.
   - On project switch → **full page reload**; recents menu repopulates for that project.
2. **Explorer tree (collapsible)**
   - New helper pair: `explorer_helper.py` (directory listing) + `static/js/explorer.js` (DOM + expand/collapse + open‑file wiring).
   - Filter obvious noise directories (`node_modules`, `dist`, `build`, `.venv`).
3. **Preferences expansion (optional)**
   - Surface editor options that already exist internally (tab size, soft wrap) through the same prefs API.
4. **Optional Git add‑on (later)**
   - Thin Python wrapper for status/diff; UI summary in the drawer footer (no blocking on saves).

---

## 4) Known challenges & current quirks
- **Drawer markup vs. JS IDs**: mismatches cause the “Open Project” button to jump to the header or the drawer to appear broken; the fix is to ensure **exact** IDs in the template and to avoid DOM reparenting.
- **Double asset loading**: mixing any Code‑OSS assets with file_editor_cm6 will re‑bind controls; remove legacy includes.
- **Self‑echo after save**: if a `replace_full` arrives immediately after `save_ack`, it may flicker; keep a small grace window or only apply snapshots when no save is inflight.
- **FS event bursts**: some tools write‑temp→rename; add a small per‑path debounce (50–200 ms) in the watcher to coalesce to a single snapshot.
- **`lastSha256` upkeep**: always refresh it on inbound snapshots; otherwise the next autosave can 409.
- **Project resolution**: all routes that take a path should resolve relative to the current project root.
- **History UX**: the recents dropdown and the horizontal recent‑tabs row should both reflect the **same** per‑project list.

---

## 5) Data contracts (copy‑paste reference)
- WS events: `replace_full`, `save_ack` (no other types in Stage‑1).
- Write body: `{ path:string, content:string, client_id:string, op_id:string, base?:{ sha256:string } }`.
- Write 200: `{ ok:true, data:{ mtime:number, size:number, sha256:string } }`.
- Write 409: `{ ok:false, error:"BASE_MISMATCH", data:{ current:{ sha256:string, mtime:number } } }`.
- Preferences: `{ editor:{ autoSave:boolean } }`.
- History: per‑project `{ project:string, path:string, action:"add"|"remove" }`.

---

## 6) Acceptance checklist
1. Launch app → pick project → page reloads → recents reflect that project only.
2. Open a file → immediate WS snapshot populates the editor; path label updates.
3. Type → autosave after ~1.2 s; Saved status shows; next autosave uses updated hash.
4. Edit the same file externally → one WS `replace_full`; buffer updates without flicker.
5. Switch project → page reload; recents/menu update, no bleed from previous project.

---

## 7) Roadmap snapshot
- **Now**: finalize drawer DOM + JS ID alignment; move Open Project into drawer; enable backdrop + class toggle.
- **Next**: ship explorer tree (list_dir + expand/collapse, open‑file hook); tighten recents UI.
- **Later**: enrich preferences; optional Git summary; quality‑of‑life polish (quick switcher, “dirty” badges in recents).

