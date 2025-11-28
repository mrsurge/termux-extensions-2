# Autosave Subsystem – Technical Deep Dive

**Date:** 2025-11-28
**Scope:** Code CM6 (NiceGUI iframe + host shell)

---

## 1. Design Goals
- Provide code-server style resiliency: disk is source of truth, single user, no multi-client arbitration.
- Keep editor responsive on both mobile and desktop by avoiding frequent full writes while the user is actively typing.
- Preserve draft/session cache semantics: while autosave is ON the worker should not emit stale sidecar files that would resurrect as drafts later.
- Integrate with the existing UI chrome (status bar, badge, toasts) using the iframe message bus so users see saves happening in real time.

## 2. Architectural Layers
| Layer | Responsibility |
| --- | --- |
| NiceGUI iframe (`editor_app.py`, vendored `codemirror.*`) | Detect CM6 content changes and broadcast `cm6-dirty-state` events immediately; manage cache persistence and combined diff recalculation. |
| Host shell (`main.js`) | React to dirty events, debounce autosave timers, drive `/editor/save` calls, update status text & draft badge. |
| Application backend (`main.py`, `core_write.py`) | Execute the actual atomic write via `/editor/save` (which wraps `_write_editor_buffer_to_disk`) and keep Git/diff caches consistent. |

The iframe and host communicate exclusively through `window.postMessage` (per `docs/core/nicegui_iframe_feature_adding_guideline.md`). Autosave never relies on DOM scraping.

## 3. Event Flow
1. **Text mutation** in CM6 triggers `_on_editor_change`.
2. `_on_editor_change` grabs `editor.value`, caches it as `_cached_content`, and posts `{ type: 'cm6-dirty-state', data: { path, timestamp } }` to the parent.
3. `_on_editor_change` checks the persisted preferences. If `autoSave` is true it bypasses the 1 s session-cache debounce and calls `_persist_to_cache_debounced()` immediately (which now just refreshes diff decorations and emits cache-state telemetry, because cache files are suppressed under autosave). If `autoSave` is false, it schedules the historic 1000 ms timer so draft snapshots continue to exist for crash recovery.
4. The host’s global `message` listener sees the `cm6-dirty-state` payload, verifies that it applies to the active `currentPath`, and flips `markUnsaved(true)`.
5. `markUnsaved(true)` triggers `scheduleAutosave()` when `editorViewState.autoSave` is enabled. The timer uses `AUTOSAVE_ACTIVE_DELAY` (450 ms). When autosave is off the idle delay remains 1200 ms for features that still rely on that timer (e.g., manual saves triggered through UI).
6. After 450 ms of no keyboard input the host calls `/api/app/file_editor_cm6/editor/save`. The backend writes atomically (`write_full()`), emits file watcher notifications, invalidates diff caches, and upserts a clean session-cache entry (with `unsaved=False`).
7. The backend’s `push_save_ack` and `_broadcast_cache_state(..., state='clean', reason='save')` messages flow back through the iframe → host message bus, turning the badge grey and clearing the unsaved flag. The host also updates the status text to “Saved”.

## 4. Session Cache & Draft Interaction
- When autosave is enabled the iframe never writes sidecar files. `_persist_to_cache_debounced()` short-circuits: it broadcasts a lightweight cache-state payload (`reason='autosave_pending' | 'autosave_clean'`) and recomputes combined diffs so the user still sees inline decorations. This keeps the cache directory clean for future “search by unsaved changes”.
- When autosave is disabled the same persistence path writes drafts exactly as before. The host-side autosave timer is inert, but the dirty events still keep the badge accurate.

## 5. Failure Handling
- If `/editor/save` fails, the host logs a warning, leaves the unsaved badge active, and surfaces a toast—autosave will retry on the next keystroke pause.
- The backend still enforces base-SHA collision detection. In the rare case of an external edit between autosave ticks, the user receives the existing conflict dialog.

## 6. Configuration & Extensibility
- Delay constants live in `main.js`: `AUTOSAVE_ACTIVE_DELAY` (currently 450 ms) and `AUTOSAVE_IDLE_DELAY` (1200 ms).
- Everything keys off the persisted preference (`editor.autoSave`). There is no per-tab state, matching the single-document session policy described in `notes/2025-11-27_DRAFT_DIFF_JOURNEY.md`.
- To instrument or visualize autosave, hook more listeners into the existing message bus—no additional REST endpoints are required.

---

Signed: Dex – TE2 Contributor — 2025-11-28T00:00Z
