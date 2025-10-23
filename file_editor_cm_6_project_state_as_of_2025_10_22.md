# file_editor_cm6 — Project State (as of 2025‑10‑22)

> Single‑user, localhost. This doc is an **accurate status** of the current app. It replaces prior summaries.

---

## 1) What’s working **now**

- **Editor core:** CodeMirror 6 with Android‑native selection works; file loads render correctly.
- **Reads (live updates):** WebSocket stream pushes `replace_full` snapshots on external edits; editor updates without reload when not mid‑save.
- **Writes:** REST `/write` path performs **atomic** full‑file saves (temp → fsync → replace → fsync dir) and returns `{mtime,size,sha256}`.
- **Autosave:** Debounced (~1200ms) autosave posts to `/write`; on 200 the editor marks clean and updates its base hash.
- **Manual save:** Menu/shortcut calls the same save pipeline as autosave.
- **Preferences:** `editor.autoSave` is read/written and respected at runtime.

---

## 2) What is **broken** (confirmed)

- **Open Project flow is not functional.** The UI cannot reliably set the active project; in practice the app stays on the default root, so project switching doesn’t work.
- **Per‑project recents do NOT persist.** Because the project cannot be set, all history calls resolve to the default root. The Recent Files menu shows empty/stale/mixed entries instead of a project‑scoped list.
- **Drawer mechanics are unstable.** The drawer exists, but the toggle wiring and "Open Project…" placement are inconsistent across files; the button ends up in the header in some builds, and the drawer open/close class/backdrop aren’t applied consistently.
- **Template/JS ID drift.** The IDs expected by the JS (drawer, buttons, recent menu) are not 1:1 with the current `template.html`, so event handlers bind incorrectly or not at all.

*(Summary: editor + save loop works; project UX is broken, which breaks per‑project recents.)*

---

## 3) Current design shape (Stage‑1)

- **Frontend:**
  - `template.html` provides the CM6 host, a toolbar, and a drawer shell.
  - `main.js` handles editor boot, autosave, manual save, and the WS listener for `replace_full`/`save_ack`.
- **Backend:**
  - WebSocket `/ws/read` (read‑only, single file) — emits `replace_full` and `save_ack`.
  - REST `/write` (atomic saves) — returns `{mtime,size,sha256}`; on success triggers `save_ack`.
  - Preferences and History endpoints exist; History expects a valid **current project** to scope recents.
- **Libs:**
  - `core_read.py` (watcher + fanout; per‑path debounce recommended).
  - `core_write.py` (atomic write + optional base hash check).
  - `history_store.py` (per‑project recent files list).

---

## 4) Near‑term plan (only the essentials)

1) **Fix Open Project** (single route + one UI hook)
   - Ensure `POST /project/open` sets the app’s project root and `GET /project/current` reports it.
   - One button **inside the drawer header** invokes the open‑project flow and **reloads** the page on success.

2) **Align drawer IDs and toggle**
   - Single drawer in `template.html` with canonical IDs; JS toggles a single class on the root (e.g., `.drawer-open`) and uses a backdrop click to close.

3) **Scope recents by project**
   - After Open Project succeeds, repopulate the Recent Files menu from History for that project only. Close (×) removes just that project’s entry.

*(No Git, no file explorer listing beyond the drawer shell until the above is green.)*

---

## 5) Known risks / caveats

- **FS event bursts** can still cause multiple `replace_full` messages without a small debounce in the watcher.
- **Post‑save echo** can cause flicker if a snapshot arrives immediately after `save_ack`; keep a short grace window in the UI.
- **Path resolution** must stay relative to the active project once that exists.

---

## 6) Acceptance checks (for the next green build)

1) Choose project → page reload → project label shows the chosen path.
2) Open a file → single WS snapshot populates CM6; path label updates.
3) Type → autosave returns 200; Saved indicator updates; next autosave uses the returned hash.
4) Edit externally → one `replace_full` updates the buffer without flicker.
5) Recent Files menu shows entries for **this project only**; remove (×) updates immediately.

