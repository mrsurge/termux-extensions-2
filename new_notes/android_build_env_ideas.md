# Android Build Environment Ideas

**Created:** 2024-12-24
**Status:** Parking lot for future features

Ideas that came up during planning but aren't in the core POC/MVP/Alpha path.

---

## Version Pinning / Rollback Support

**Problem:** Android blocks downgrades. If you build with `versionCode=2`, you can't reinstall `versionCode=1` without uninstalling first.

**Idea:** Configurable version strategy so builds match installed version, enabling seamless reinstalls.

```yaml
android_build:
  version_strategy: "match_installed"  # or "increment" or "fixed:42"
```

**Implementation sketch:**
```python
async def get_version_code(strategy: str, package_name: str) -> int:
    if strategy == "match_installed":
        installed = await get_installed_version_code(package_name)
        return installed or 1
    elif strategy == "increment":
        return await get_installed_version_code(package_name) + 1
    elif strategy.startswith("fixed:"):
        return int(strategy.split(":")[1])
    return 1

# Inject via gradle property:
# ./gradlew assembleDebug -PversionCode=42
```

**Gradle side** (build.gradle.kts):
```kotlin
val versionCodeOverride: String? by project
android {
    defaultConfig {
        versionCode = versionCodeOverride?.toIntOrNull() ?: 1
    }
}
```

---

## Shadow Build Mode (Unsaved Changes)

**Problem:** Default is save-then-build. But sometimes you want to test unsaved experimental changes.

**Idea:** Advanced modal checkbox: "Build from workspace (include unsaved changes)"

- Uses shadow workspace for APK build instead of real project
- APK reflects dirty buffers
- Warning: APK won't match disk state

---

## LSP Spec Abstraction

**Problem:** Currently LSP servers are hardcoded in `LSP_COMMANDS` dict. Each new server needs code changes.

**Idea:** Declarative `lsp_spec.yaml` after we've built 4-5 servers and see the common shape:

```yaml
servers:
  python:
    command: ["pyright-langserver", "--stdio"]
    languages: [python]
    
  kotlin-android:
    command: ["python3", "-m", "app.apps.file_editor_cm6.android_lsp"]
    languages: [kotlin]
    workspace_root_override: android/
    cache_dirs:
      gradle: ${ctx:PROJECT_ROOT}/.gradle
```

**Status:** Wait until pattern emerges from repetition.

---

## Ideas to Add

<!-- Add new ideas below this line -->
