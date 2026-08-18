# TE2 Cefrium Android Client

`android/cefrium` is an isolated Android application module for evaluating the
Cefrium CEF runtime against TE2. GeckoView in `android/app` remains the primary
Android implementation.

The module is isolated because the `com.cefrium` Gradle plugin generates
Chromium resource classes for every variant in the module that applies it.
Keeping it in `:cefrium` prevents those generated resources and the large CEF
runtime from entering Gecko builds.

## Build

The module pins the Cefrium SDK and Gradle plugin to `0.7.0`, targets arm64, and
requires Android API 29 or newer.

Check free space before starting Gradle and stop if less than 2 GB is available:

```bash
df -Pk .
cd android
./termux-sdk-env.sh ./gradlew :cefrium:testDebugUnitTest :cefrium:assembleDebug
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
`127.0.0.1` origin owned by the shared `AndroidFrameworkRelay`:

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
access. App pages carry an explicit `te2_renderer=cefrium` marker. An
exact-relay-origin query handler provides stable native client identity and
validated Run Profile surface registration without waiting for Gecko-only
WebExtension APIs.

Tools overlay visibility and the selected tab persist in Android-owned state.
Console and a persistent Processes browser are supported; Processes loads the
relay-owned `/fws` page. Remote-app health uses the same three-consecutive-
authoritative-failures rule as GeckoView, while transport or invalid-payload
failures preserve the current app.

The high-level Cefrium wrapper does not expose CDP, but the bundled Chromium
runtime includes an application-private `DevToolsServer`. Cefrium relays that
abstract-domain socket through a dynamic loopback-only listener, discovers page
targets through one browser control channel, and routes the selected flattened
session to the persistent Inspector browser through `cefriumQuery`. The native
target picker and selected target are Android-owned; framework sockets are not
part of this CDP path. UI IPC remains connected for focus signals, but this
implementation does not reflect into Chromium internals to install Gecko's
native `InputConnection` wrapper.
Browser-side Monaco and xterm Android input behavior must be validated on a
device before deciding whether a public Cefrium integration point is needed.

Cefrium omits Chromium's selection ActionMode host callback. A narrow
same-package `WebContents` shim installs a callback that delegates to Chromium's
own `ActionModeCallbackHelper` and enables its SurfaceControl magnifier. Native
selection commands remain renderer-owned; they are not reproduced in
JavaScript.

Run Profile `devRuntime` surfaces are validated and retained by exact
`surfaceId`, but Cefrium reports `cachePolicy=false` and
`consoleInjection=false`. Run Target listeners bypass `AndroidFrameworkRelay`,
and Cefrium's public API cannot mutate response headers or inject into an exact
cross-origin child frame. Do not replace those missing APIs with a partial HTTP
parser in the byte-for-byte relay.

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

Physical-device Inspector lifecycle, selection actions/magnifier, keyboard,
file picking, media, and renderer recovery remain device-validation items.
