# Android Build/Variant/Compile Checklist (TE2)

Goal: full Android project setup in Code CM6 — discover/configure build files, manage variants/source sets, and eventually build APKs on-device.

## Scope / Baseline
- Target editor: Code CM6 (NiceGUI iframe + main server + app worker).
- Android LSP uses Gradle-backed diagnostics (kotlin-android LSP bridge).
- Config SSOT: `.code_cm6/lang/android/android_build_config.json`.

---

## Current State (Implemented)

### Config + Discovery
- Android config modal exists with Gradle + SDK + build flags.
- Backend discovery reads:
  - `settings.gradle(.kts)`
  - `build.gradle(.kts)` (root + module)
  - `gradle.properties`
  - `local.properties`
  - `gradle/libs.versions.toml`
- Android config data is persisted into `.code_cm6/lang/android/android_build_config.json` (SSOT).
- Autodetect snapshot is stored under the same config file.

### Variants (Read-only)
- Variant list is detected from module Gradle files.
- Variant dropdown is JS (no native dropdowns).

### Source Set Creation (Partial)
- “Add Source Set” UI exists.
- Creates `src/<name>/` under **module root** (e.g., `android/app/src/<name>/`).
- Optional: create `java/`, `kotlin/`, `res/`, `AndroidManifest.xml`.
- Name is auto-sanitized (`-` → `_`).
- **Note:** this does *not* add buildTypes/flavors to Gradle, so it won’t show as a variant yet.

---

## Planned / Needed (Next Steps)

### A) Variant Creation (Gradle-aware)
1) UI action: “Add Variant” (buildType or flavor) with:
   - name
   - type: buildType vs flavor
   - optional flavor dimension
   - optional signing or minify flags
2) Backend: write into module `build.gradle(.kts)`:
   - buildTypes { create("newType") { ... } }
   - productFlavors { create("newFlavor") { ... } }
   - flavorDimensions if missing
3) Optional: auto-create matching source set directories.
4) Refresh variants list post‑write.

### B) Build/Compile (Gradle Task Execution)
1) UI actions:
   - Sync / Refresh Gradle (already exists for diagnostics)
   - Build APK / Assemble variant
2) Backend:
   - Run Gradle via `gradlew` using configured project root + module
   - Track progress via spinner/toast
   - Capture logs to sidecar
3) Output location:
   - Show where APK landed (e.g., `app/build/outputs/apk/...`)

### C) Environment Configuration
1) `local.properties` support (sdk.dir)
2) Termux tooling:
   - `android.aapt2FromMavenOverride`
   - JDK/JRE path handling
3) Optional:
   - Detect missing `gradlew` and offer to create/wrap
   - Detect missing SDK build-tools / platforms

### D) Validation / Guardrails
- Ensure all Android operations are constrained to the configured Android root + module.
- Never mutate non‑Android projects.
- Confirm before writing to Gradle files.

---

## Open Questions / Decisions

1) **Gradle edit strategy:**
   - Regex patching vs structured parse (Kotlin DSL vs Groovy).
   - Minimum safe edits for buildTypes/flavors.

2) **Variant taxonomy:**
   - Should “Add Variant” auto‑create buildType + flavor, or separate actions?

3) **Build pipeline:**
   - Should builds run inside app worker or in main server shells?
   - Where to store build logs (sidecar vs fws logs)?

4) **APK install:**
   - Are we targeting on‑device install or just build output?

5) **Android LSP root:**
   - Confirm variant + module configuration should be per Android root only.

---

## Short-Term Checklist (Actionable)
- [ ] Add “Add Variant” UI with buildType/flavor choices.
- [ ] Implement Gradle file update helpers for new buildType/flavor.
- [ ] Add post‑write re‑detect (variants + source sets).
- [ ] Add “Build APK” UI action with task selection.
- [ ] Add build task runner w/ progress + logs.

