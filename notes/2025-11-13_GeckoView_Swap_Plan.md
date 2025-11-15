# GeckoView Swap Implementation Plan

**Date:** November 13, 2025  
**Author:** Codex (GPT-5)  
**Status:** In Progress

---

## Goals

1. Replace the current Android `WebView` container with a GeckoView-based activity that loads the Termux framework UI at `http://127.0.0.1:8088`.
2. Support parallel builds (WebView vs. GeckoView) so they can be installed side by side using different `sharedUserId` values.
3. Preserve the existing JavaScript bridge surface (`window.Android.*`) to avoid frontend changes.

---

## Phased Approach

### Phase 1 – Baseline & Build Plumbing
- [ ] Confirm existing Gradle setup, repositories, and custom `aapt` wiring in `android/build.gradle.kts` and `android/app/build.gradle.kts`.
- [ ] Capture current manifest attributes and `NativeBridge` APIs for reference.
- [ ] Introduce product flavors (`webview`, `gecko`) in the app module with unique `applicationIdSuffix` and manifest placeholders for `sharedUserId`.

### Phase 2 – Gecko Dependencies & Layout
- [ ] Add GeckoView dependency (release channel) and required repositories.
- [ ] Create/adjust layout resource to host `GeckoView` (replace or conditionally inflate instead of `WebView`).
- [ ] Provide flavor-specific Kotlin source sets if necessary (`src/gecko/java/...`).

### Phase 3 – Runtime & Session Wiring
- [ ] Implement `GeckoRuntimeProvider` singleton to init the runtime once.
- [ ] Update `MainActivity` (Gecko flavor) to:
  - Instantiate a `GeckoSession`.
  - Attach delegates for progress/navigation/console logging.
  - Load `http://127.0.0.1:8088`.
- [ ] Mirror existing lifecycle handling (back button, destruction) with Gecko equivalents.

### Phase 4 – JavaScript Bridge Parity
- [ ] Recreate `window.Android.*` APIs using Gecko’s messaging system (e.g., `GeckoSession.ContentDelegate` or injected JS script).
- [ ] Ensure bridge calls still invoke `NativeBridge.kt` methods.
- [ ] Add instrumentation/logging to validate message delivery in both directions.

### Phase 5 – Shared User ID Experiment
- [ ] Add flavor-specific manifest overlay to set a new `android:sharedUserId` for the Gecko build.
- [ ] Verify install coexistence (two APKs) and confirm both can reach the Termux backend simultaneously.

### Phase 6 – Validation & Cleanup
- [ ] Extend `scripts/build_android.sh` (or add a new script) to accept a `--flavor` flag and run Gradle for each target.
- [ ] Smoke-test WebSocket stability (background/foreground) and bridge calls on real device.
- [ ] Document findings; remove redundant WebView code only after Gecko build is proven stable.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Gecko runtime adds ~50–60 MB to APK | Use release channel artifact, enable R8/proguard trimming after basic integration |
| JS bridge regressions | Add integration tests/logging; keep WebView flavor intact for rollback |
| Flavor-specific manifest drift | Centralize shared entries via `main/AndroidManifest.xml` and only override deltas in flavor manifests |

---

## Immediate Next Actions

1. Implement product flavors and Gecko dependency scaffolding in Gradle.
2. Add skeleton `GeckoRuntimeProvider` + flavor-specific `MainActivity` stub that simply loads the framework URL.
3. Validate that the Gecko flavor builds and launches (even without bridge parity) before tackling the messaging layer.

---

## Implementation Notes (Progress Log)

- **Nov 13:** Gecko flavor boots successfully; runtime created via `GeckoRuntimeProvider`. Default text zoom set to 80% (`fontSizeFactor = 0.8`) with automatic font adjustment disabled to match the former WebView `textZoom = 80` behavior.
- **Nov 13 (later):** Vendored CodeMirror now exposes `set_font_scale`, allowing runtime font-size tuning from NiceGUI (currently defaulted to 85% inside `editor_app.py`). Toolbar tweaks keep Recents + path on one row.
- **Status:** Font scaling controls still behave inconsistently in Gecko; deprioritized until after session-state work.

### Wishlist / Next Steps

1. **Editor font menu:** expose Small / Medium / Large presets hooked into `set_font_scale` and persist to `preferences_store`.
2. **Session state awareness:** capture current file, scroll position, and unsaved edits so NiceGUI can restore instantly when Gecko reconnects. (In progress.)
3. **Document cache:** keep an on-disk per-project cache (maybe sqlite or JSON) for fast reopen + offline fallback.
4. **Crash/WebSocket recovery:** detect disconnects, queue unsent edits, and replay once the bridge reconnects; surface state in UI.

### Crash-Safe Session Cache Plan (Detail Level: 11/10)

**Objective:** Guarantee that unsaved edits survive regardless of browser/app lifecycle events. Requirements include:

1. Persist the *entire* working buffer (not diffs) plus forensic metadata (framework run ID, shell ID, launcher PID, worker PID, timestamps, SHA chain) on every significant text mutation.
2. Restore cached edits automatically whenever the editor is rehydrated, unless the user explicitly discards the draft.
3. Detect “crash” vs “clean exit” by comparing cached metadata with current runtime metadata (`TE_RUN_ID`, `TE_FRAMEWORK_SHELL_*`), so the UI can differentiate “recovered from crash” vs “draft carried over”.
4. Provide explicit controls to discard/reset cached drafts and to purge them once the file saves cleanly.

**Implementation Blueprint**

| Layer | Responsibilities | Artifacts |
|-------|------------------|-----------|
| Storage (`HistoryStore`) | Maintain `session_cache` dict keyed by normalized `project_path` + `file_path`. Each entry stores `{content, content_length, content_sha256, base_sha256, unsaved, run_id, shell_id, shell_run_id, launcher_pid, worker_pid, updated_at}`. | `app/apps/file_editor_cm6/history_store.py` |
| Backend API | `GET /session_cache?project=&path=` returns cached entry; `DELETE /session_cache` purges entry; existing `/session_state` continues to track high-level telemetry. Writes happen server-side via NiceGUI, not via browser JS. | `app/apps/file_editor_cm6/main.py` |
| NiceGUI layer (`editor_app.py`) | After every `ui.codemirror` change, debounce and call `_history_store.upsert_cached_document(...)`. Include runtime metadata from env (`TE_RUN_ID`, `TE_FRAMEWORK_SHELL_*`, worker PID). On successful save (write endpoint), backend clears cache entry. | `app/apps/file_editor_cm6/nicegui_editor/editor_app.py` |
| Host page (CM6 shell) | Only for user-facing affordances: show “Discard Draft” button when unsaved, call backend to discard, auto-restore cached content before opening file, display status message (“Restored unsaved edits from crash/draft”). All persistence already happened server-side. | `app/apps/file_editor_cm6/main.js` (pending relocation into vendored NiceGUI per new directive) |
| Crash Detection | Compare cached `run_id` vs current `TE_RUN_ID`. If different, label restore as crash recovery. If same but disk file is older, treat as “draft carryover”. Run metadata also records shell IDs to trace specific worker crashes. | Stored metadata + UI messaging |

**Next Actions (Backend-Only Focus)**

1. Keep persistence/write logic strictly inside NiceGUI’s Python layer; expose a Python hook for “discard draft” that clears the cache server-side (no direct browser API required).  
2. Move any necessary UI prompts into the NiceGUI page itself, vendoring scripts under `app/static/vendor/nicegui/...` so the iframe can surface restore/clear buttons without touching outer CM6 JS.  
3. Update documentation/tests to reflect that crash recovery is automatic and drafts persist until explicitly saved or discarded.

---

_End of plan._
