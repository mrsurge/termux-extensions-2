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
2. **Session state awareness:** capture current file, scroll position, and unsaved edits so NiceGUI can restore instantly when Gecko reconnects.
3. **Document cache:** keep an on-disk per-project cache (maybe sqlite or JSON) for fast reopen + offline fallback.
4. **Crash/WebSocket recovery:** detect disconnects, queue unsent edits, and replay once the bridge reconnects; surface state in UI.

---

_End of plan._
