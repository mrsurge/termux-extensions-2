# Draft Diff Engine – Technical Deep Dive

**Date:** 2025-11-28
**Scope:** Inline “draft” diff overlays inside Code CM6

---

## 1. Purpose & Scope
Draft diffs visualize the delta between the NiceGUI iframe buffer (unsaved edits) and the file on disk. They operate alongside Git diffs so users can see three states simultaneously:
- **Disk vs Git HEAD** (red/green) → traditional inline diff controller.
- **Buffer vs Disk** (yellow/blue) → draft diff engine.
- **Draft badge** → indicates whether a sidecar exists for crash recovery.

The design intentionally mirrors `code-server`: only a single document is cached at a time, and draft diffs disappear the moment autosave is enabled.

## 2. Data Flow Overview
1. `_schedule_cache_persist()` (NiceGUI backend) fires when the editor changes and autosave is OFF. It captures `editor._cached_content`, computes a SHA, and stores the buffer via `_history_store.upsert_cached_document(...)`.
2. `_persist_to_cache_debounced()` calls `_get_combined_diffs(project_root, current_file, current_content)`.
3. `_get_combined_diffs()` stitches two streams:
   - Git hunks (based on the active diff base) with `type: 'add' | 'del'`.
   - Draft hunks (from `draft_diff_helper.compute_draft_diff()`) with `type: 'add-draft' | 'del-draft'`.
4. The combined hunk list is pushed into the iframe via `editor.set_diff_decorations(hunks)`.
5. Vendored `codemirror.js` inspects the `type` field when it builds decorations:
   - `add-draft` lines become `.cm-diff-line-added-draft` (blue background + gutter).
   - `del-draft` lines emit a `RemovedLineWidget` with `isDraft=true`, toggling `.cm-diff-line-removed-draft` (yellow) plus matching gutter markers.
6. CSS injected by `editor_app.py` defines the palette. Draft-specific rules come **after** the git rules so the yellow/blue styling wins via cascade order.

## 3. Interaction with Session Cache
- The same persistence loop that writes drafts also feeds the diff engine. This keeps the logic self-consistent: if a draft exists, the badge is red and the yellow/blue overlays update in real time.
- `_broadcast_cache_state()` emits `state='mid_session'` when an unsaved draft is present. The host responds by marking the badge active and toggling discard actions.
- On crash/restore, `refresh_cache_state` replays the cache entry, pushes the draft diffs again, and calls `editor.notify_parent('draft_state', ...)` so the host preserves the indicator even if the outer shell re-rendered.

## 4. Autosave Interaction
- When autosave turns ON, the backend clears the cached document, broadcasts `state='clean'`, and the host hides the draft badge. `_get_combined_diffs()` skips the draft branch entirely (because the “buffer vs disk” delta becomes zero after every autosave tick).
- When autosave turns OFF, the debounced cache writer starts running again. The next edit immediately recreates the draft overlays.

## 5. Watcher & External Edits
- `_apply_watcher_replace()` monitors disk changes. If an external edit occurs while a draft exists, the cache entry is cleared and the host receives a `reason='watcher_external'` payload. Draft diffs disappear, and the user sees the disk content.
- Upcoming hardening (see `notes/2025-11-27_DRAFT_DIFF_JOURNEY.md`) will compare watcher SHAs against the cached `base_sha256` before clearing to avoid wiping a restored draft erroneously.

## 6. Extending the Engine
- All decorations flow through the shared `diffController` state field inside `codemirror.js`. To add new decoration classes (e.g., intra-line highlights) simply emit richer metadata from `_get_combined_diffs()`; the frontend already namespaces draft vs git hunks by type.
- The menu toggles (“Show Git Diffs”, “Show Draft Diffs”) map to preferences stored in `_preferences_store`. Toggling them retriggers `_refresh_active_diffs()` so the iframe always has the latest combined hunk set.

---

Signed: Dex – TE2 Contributor — 2025-11-28T00:00Z
