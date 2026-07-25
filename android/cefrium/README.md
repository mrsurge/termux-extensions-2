# TE2 Cefrium Android Client

`android/cefrium` is an isolated Android application module for evaluating the
Cefrium CEF runtime against TE2. GeckoView in `android/app` remains the primary
Android implementation.

The module is isolated because the `com.cefrium` Gradle plugin generates
Chromium resource classes for every variant in the module that applies it.
Keeping it in `:cefrium` prevents those generated resources and the large CEF
runtime from entering Gecko builds.

## Build

The module pins the Cefrium SDK and Gradle plugin to `0.6.3`, targets arm64, and
requires Android API 29 or newer.

Check free space before starting Gradle and stop if less than 3 GB is available:

```bash
df -Pk .
cd android
./linux-sdk-env.sh ./gradlew :cefrium:testDebugUnitTest :cefrium:assembleDebug
```

The debug APK is written to:

```text
android/cefrium/build/outputs/apk/debug/cefrium-debug.apk
```

## Runtime Shape

The app reuses the Android-owned launcher, Settings, asset manager,
Framework-Shell console, UI IPC client, diagnostics, and persistent-network
service from `android/app/src/main`.

Cefrium always loads TE2 through one dynamically allocated
`127.0.0.1` origin owned by `CefriumFrameworkRelay`:

```text
Cefrium
  -> stable localhost origin
       -> /android-shell and /android-api: handled locally
       -> declared installed editor assets: served locally
       -> other HTTP and SSE: streamed to the configured TE2 target
       -> WebSocket upgrades: tunneled byte-for-byte to TE2
```

Changing the framework address retargets the relay without changing the
browser origin. Existing connections are closed so Socket.IO and other clients
reconnect against the new target. Redirects that point back to the configured
TE2 origin are rewritten to the localhost origin. This keeps Chromium secure
context behavior available without weakening its security model for arbitrary
HTTP sites.

Only paths declared by `CefriumAssetRoutes` are served from the installed
asset tree. The list mirrors Gecko's asset-extension inventory. Dynamic API,
Socket.IO, terminal, and app-worker traffic always passes through the relay.

## Native Integration

The activity provides the shared launcher and Settings UI, native
Home/Reload/Recents/Lock/Quit/Tools controls, app-scoped quit, native context
menus, trusted-localhost clipboard permission, file-picker result forwarding,
renderer recovery, lifecycle pause/resume, native diagnostics, and TE2 console
access.

The public Cefrium SDK does not expose the CDP transport required by TE2's
native Inspector, so the Inspector tab reports that limitation. UI IPC remains
connected for focus signals, but this implementation does not reflect into
Chromium internals to install Gecko's native `InputConnection` wrapper.
Browser-side Monaco and xterm Android input behavior must be validated on a
device before deciding whether a public Cefrium integration point is needed.

## Validation Baseline

The desktop Android build environment has verified:

- Cefrium unit tests, including local routing, HTTP forwarding, redirect
  rewriting, relay retargeting, and raw upgraded-socket streaming
- `:cefrium:assembleDebug`
- unchanged Gecko unit tests and `:app:assembleGeckoDebug`
- merged manifest inclusion of `CefriumInitProvider`, 40 sandbox processes,
  and 3 privileged processes
- arm64-only native packaging
- Android build-tools 36 16 KB ZIP alignment
- `PT_LOAD` alignment of `0x4000` or greater for every packaged native library

Physical-device rendering, keyboard/touch behavior, context menus, clipboard,
file picking, media, and renderer recovery remain device-validation items.
