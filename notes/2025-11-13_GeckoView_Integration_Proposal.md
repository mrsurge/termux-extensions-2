# GeckoView Native Display Layer - Integration Proposal

**Date:** November 13, 2025  
**Project:** Termux Extensions 2  
**Status:** Proposal - Awaiting Approval

---

## Executive Summary

Integrate GeckoView-based Android application as a native display layer for the existing Termux-based framework, creating a dual-run architecture where execution remains in Termux Python while display is handled by a native Android WebView container.

---

## Project Structure

```
mrselect/  (directory name - kept as-is)
├── app/                          # Existing Python framework (unchanged)
├── android/                      # NEW: GeckoView Android app
│   ├── app/                      # Android app module
│   │   ├── src/main/
│   │   │   ├── java/com/termux/extensions/
│   │   │   │   ├── MainActivity.kt
│   │   │   │   ├── GeckoViewManager.kt
│   │   │   │   └── NativeBridge.kt
│   │   │   ├── res/
│   │   │   │   ├── values/
│   │   │   │   │   └── strings.xml
│   │   │   │   ├── layout/
│   │   │   │   │   └── activity_main.xml
│   │   │   │   └── mipmap-xxxhdpi/
│   │   │   │       └── ic_launcher.png (from app/static/icon.png)
│   │   │   └── AndroidManifest.xml
│   │   └── build.gradle.kts
│   ├── gradle/wrapper/
│   │   ├── gradle-wrapper.jar
│   │   └── gradle-wrapper.properties
│   ├── build.gradle.kts
│   ├── settings.gradle.kts
│   ├── gradlew
│   ├── gradlew.bat
│   └── .gitignore
├── app/apps/native_bridge/       # NEW: Python bridge endpoint app
│   ├── manifest.json
│   ├── main.py                   # REST/WebSocket endpoints
│   └── bridge_handler.py         # Android ↔ Termux protocol
└── scripts/
    └── build_android.sh          # NEW: Gradle build wrapper
```

---

## Architecture Overview

### Dual-Run Model

**Execution Layer (Termux):**
- Existing FastAPI framework continues running on-device in Termux
- All business logic, file operations, process management stays in Python
- Framework runs on localhost:8088 as it does now
- Zero changes to existing apps/extensions

**Display Layer (Native Android App):**
- GeckoView-based Android application
- Acts as a native WebView container displaying framework's UI
- Loads `http://127.0.0.1:8088` on startup
- Uses GeckoView's native bridge for Android ↔ JavaScript communication

**Bridge Component:**
- New `native_bridge` app in framework
- Provides REST/WebSocket API endpoints
- Handles bidirectional communication between GeckoView and Termux backend

---

## Communication Flow

```
┌─────────────────────────────────────────────┐
│  GeckoView Android App (Native)             │
│  "Termux Extensions"                        │
│  ┌────────────────────────────────────┐     │
│  │ WebView: http://127.0.0.1:8088     │     │
│  │ (Your existing framework UI)       │     │
│  └─────────────┬──────────────────────┘     │
│                │                            │
│  ┌─────────────▼──────────────────────┐     │
│  │ window.Android (JavaScript Bridge) │     │
│  │ - openFile(), shareText(), etc.    │     │
│  └─────────────┬──────────────────────┘     │
│                │                            │
│  ┌─────────────▼──────────────────────┐     │
│  │ NativeBridge.kt (Kotlin)           │     │
│  │ - Handles Android OS calls         │     │
│  │ - Makes HTTP/WS to localhost:8088  │     │
│  └─────────────┬──────────────────────┘     │
└────────────────┼────────────────────────────┘
                 │ HTTP/WebSocket
                 ▼
┌─────────────────────────────────────────────┐
│  Termux - FastAPI Framework (8088)          │
│  ┌────────────────────────────────────┐     │
│  │ native_bridge app                  │     │
│  │ - /api/native/* endpoints          │     │
│  │ - WebSocket /ws/native             │     │
│  └────────────┬───────────────────────┘     │
│               │                             │
│  ┌────────────▼───────────────────────┐     │
│  │ File operations, services, etc.    │     │
│  └────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
```

### Example Flow

```
JavaScript (in GeckoView) → window.Android.openFile()
→ Native Bridge (Kotlin) → HTTP POST /api/native/filesystem/open
→ Python handler → Returns file descriptor/path
→ Native Bridge → GeckoView JavaScript callback
```

---

## Configuration Details

### Android Application

**Package Information:**
- Package Name: `com.termux.extensions`
- Application Name: `Termux Extensions`
- Short Name: `TE2`

**SDK Requirements:**
- Min SDK: 24 (Android 7.0) - GeckoView requirement
- Target SDK: 34 (Android 14)
- Compile SDK: 34

**Dependencies:**
- GeckoView: Release channel (stable)
- Kotlin: 1.9+
- AndroidX Core KTX
- AndroidX AppCompat

**App Icon:**
- Source: `/app/static/icon.png` (8.2KB, 192x192 from PWA)
- Placement: `mipmap-xxxhdpi/ic_launcher.png`
- Note: Other densities (mdpi, hdpi, xhdpi, xxhdpi) to be generated later

**Startup Behavior:**
- Loads `http://127.0.0.1:8088` on launch
- Full-screen GeckoView activity
- No browser chrome/address bar

### Native Bridge (Phase 1 Features)

**JavaScript → Native:**
- `window.Android.getDeviceInfo()` - Returns device/OS info JSON
- `window.Android.showToast(message)` - Display Android toast notification
- `window.Android.handleBackButton(callback)` - Hardware back button handler
- `window.Android.callNative(method, params)` - Generic bridge call

**Native → JavaScript:**
- Event injection for app lifecycle (pause/resume)
- Notification callbacks
- Intent result callbacks

### Python Bridge App (Phase 1)

**Manifest:**
```json
{
  "name": "Native Bridge",
  "id": "native_bridge",
  "icon_emoji": "🔗",
  "version": "0.1.0",
  "description": "Android ↔ Termux communication bridge",
  "entrypoints": {
    "backend_blueprint": "main.py"
  }
}
```

**REST Endpoints:**
- `GET /api/native/info` - Device/environment information
- `POST /api/native/toast` - Trigger Android toast from Python
- `POST /api/native/filesystem/open` - File picker integration (Phase 2)
- `POST /api/native/share` - Share intent (Phase 2)

**WebSocket:**
- `WebSocket /ws/native` - Bidirectional event channel
- Protocol: JSON-RPC style messages
- Use cases: Real-time notifications, lifecycle events, background tasks

---

## Implementation Phases

### Phase 1: Android Scaffolding (1-2 hours)

**Tasks:**
1. Delete vestigial `build/` directory
2. Create `android/` project structure with Gradle
3. Add GeckoView dependency (from Mozilla Maven)
4. Create `MainActivity.kt` with basic GeckoView setup
5. Copy PWA icon to `mipmap-xxxhdpi/`
6. Configure `AndroidManifest.xml` with permissions
7. Test APK builds successfully with `./gradlew assembleDebug`

**Success Criteria:**
- APK builds without errors
- App installs on Android device
- GeckoView loads and displays localhost:8088
- No crashes on launch

---

### Phase 2: Native Bridge Setup (2-3 hours)

**Tasks:**
1. Implement `NativeBridge.kt` with `@JavascriptInterface` annotations
2. Register bridge object as `window.Android` in GeckoView
3. Implement 4 initial bridge methods (see above)
4. Add HTTP client for Native → Python communication
5. Test JavaScript → Native calls work

**Success Criteria:**
- `window.Android` object accessible from web console
- `getDeviceInfo()` returns valid JSON
- `showToast()` displays Android toast
- Back button handler fires callback

---

### Phase 3: Python Bridge App (2-3 hours)

**Tasks:**
1. Create `app/apps/native_bridge/` directory
2. Write `manifest.json` with app metadata
3. Implement `main.py` with FastAPI router
4. Create `/api/native/info` endpoint
5. Add WebSocket handler at `/ws/native`
6. Create `bridge_handler.py` for message protocol
7. Test Native → Python → Native round-trip

**Success Criteria:**
- Bridge app appears in framework apps list
- `/api/native/info` returns device data
- WebSocket connection established from Android
- Bidirectional messages work

---

### Phase 4: Feature Implementation (Ongoing)

**Future Features:**
1. **File Picker Integration**
   - Native Android file picker
   - Returns file paths/URIs to framework
   - Permission handling for storage access

2. **Share Intent Handling**
   - Share text/files to other Android apps
   - Receive shared content from other apps

3. **Notification API**
   - Android native notifications from framework
   - Notification actions/callbacks

4. **Hardware Button Handling**
   - Back button (already in Phase 2)
   - Volume buttons (media controls)
   - Menu button

5. **Camera/Media Access**
   - Camera capture via native API
   - Photo library access
   - Video recording

6. **App Lifecycle Events**
   - Pause/resume detection
   - Background/foreground transitions
   - Memory pressure warnings

---

## Key Design Decisions

### 1. GeckoView vs WebView
**Choice:** GeckoView  
**Rationale:**
- Better web standards support (newer JS/CSS features)
- Extension capabilities (can load Firefox extensions)
- More predictable cross-device behavior
- Active development by Mozilla

### 2. No Code Duplication
**Principle:** Android app is just a container  
**Rationale:**
- All UI stays in existing web apps
- No need to rewrite features in Kotlin
- Framework remains the single source of truth
- Easier maintenance

### 3. Graceful Degradation
**Principle:** Apps work in browser AND GeckoView  
**Implementation:**
```javascript
if (window.Android) {
    // Use native bridge
    window.Android.openFile();
} else {
    // Fallback to web file input
    document.getElementById('file-input').click();
}
```

### 4. Localhost Binding
**Principle:** Android app always connects to 127.0.0.1:8088  
**Rationale:**
- Framework must be running in Termux first
- No remote/network access (security)
- Simple deployment model

---

## Build Integration

### Gradle Configuration

**Root `build.gradle.kts`:**
```kotlin
plugins {
    id("com.android.application") version "8.2.0" apply false
    id("org.jetbrains.kotlin.android") version "1.9.20" apply false
}
```

**App `build.gradle.kts`:**
```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.termux.extensions"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.termux.extensions"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("org.mozilla.geckoview:geckoview:121.0.20231211074323")
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
```

### Build Script (`scripts/build_android.sh`)

```bash
#!/data/data/com.termux/files/usr/bin/bash

cd "$(dirname "$0")/../android"

echo "Building Termux Extensions Android app..."
./gradlew assembleDebug

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "APK location: android/app/build/outputs/apk/debug/app-debug.apk"
else
    echo "Build failed!"
    exit 1
fi
```

---

## Permissions

### AndroidManifest.xml Permissions

**Phase 1 (Minimal):**
```xml
<uses-permission android:name="android.permission.INTERNET" />
```

**Phase 2+ (Feature-dependent):**
```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

---

## Testing Strategy

### Phase 1 Testing
1. Build APK in Termux: `cd android && ./gradlew assembleDebug`
2. Install APK: `adb install -r app/build/outputs/apk/debug/app-debug.apk`
3. Start framework in Termux: `bash scripts/run_framework.sh`
4. Launch Android app
5. Verify framework UI loads in GeckoView

### Phase 2 Testing
1. Open web console in GeckoView
2. Test `window.Android.getDeviceInfo()`
3. Test `window.Android.showToast("Hello from web")`
4. Test back button handling

### Phase 3 Testing
1. Start framework with native_bridge app
2. Test `curl http://localhost:8088/api/native/info`
3. Connect WebSocket from Android
4. Send test messages both directions

---

## Future Enhancements

### Potential Extensions

1. **GeckoView Extensions Support**
   - Load Firefox extensions
   - Ad blocking (uBlock Origin)
   - Custom user scripts

2. **Custom URL Schemes**
   - `termux-extensions://` URLs
   - Deep linking from other apps

3. **Background Services**
   - Keep framework running in background
   - Wake locks for long-running tasks

4. **Multi-Window Support**
   - Split-screen mode
   - Picture-in-picture for video

5. **WebExtension API**
   - Framework apps can register as WebExtensions
   - Access to browser APIs

---

## Icon Management

### Current State
- Source: `/app/static/icon.png` (8.2KB, 192x192)
- Implementation: Copy to `mipmap-xxxhdpi/ic_launcher.png`
- Status: Works for high-DPI devices

### Future Work (TODO)
Generate additional densities:
- `mipmap-mdpi/ic_launcher.png` - 48x48
- `mipmap-hdpi/ic_launcher.png` - 72x72
- `mipmap-xhdpi/ic_launcher.png` - 96x96
- `mipmap-xxhdpi/ic_launcher.png` - 144x144

**Script placeholder:** `scripts/generate_android_icons.sh`

---

## Approval Checklist

### Phase 1 Deliverables
- [ ] Delete `build/` directory
- [ ] Create `android/` project structure
- [ ] Configure Gradle with GeckoView dependency
- [ ] Copy icon.png to mipmap-xxxhdpi
- [ ] Create MainActivity.kt with GeckoView setup
- [ ] Configure AndroidManifest.xml
- [ ] Create build script
- [ ] Test APK builds successfully

### Phase 2 Deliverables
- [ ] Implement NativeBridge.kt
- [ ] Register window.Android object
- [ ] Implement 4 initial bridge methods
- [ ] Test JavaScript → Native calls

### Phase 3 Deliverables
- [ ] Create native_bridge app directory
- [ ] Write manifest.json
- [ ] Implement REST endpoints
- [ ] Implement WebSocket handler
- [ ] Test Native → Python → Native round-trip

---

## Questions & Decisions

### Resolved
1. ✅ **Project name:** Termux Extensions 2 (TE2)
2. ✅ **Package name:** `com.termux.extensions`
3. ✅ **Icon source:** Use existing PWA icon
4. ✅ **Icon strategy:** Copy as-is to xxxhdpi (Option B)
5. ✅ **Android project location:** Inside `mrselect/android/`

### Pending
1. ⏳ **APK signing:** Debug only for now? Or configure release signing?
2. ⏳ **GeckoView channel:** Release (stable) vs Nightly (bleeding edge)?
3. ⏳ **Initial permissions:** Just INTERNET, or add storage upfront?

---

**Status:** Ready for implementation pending final approval  
**Estimated Time:** 5-8 hours for Phases 1-3  
**Next Step:** Execute Phase 1 upon approval
