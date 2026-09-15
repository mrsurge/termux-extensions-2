# TE2 Cefrium Android Client

`android/cefrium` is an isolated Android application module for evaluating the
Cefrium CEF runtime against TE2. GeckoView in `android/app` remains the primary
Android implementation.

The module is isolated because the `com.cefrium` Gradle plugin generates
Chromium resource classes for every variant in the module that applies it.
Keeping it out of the `:app` build also prevents the large CEF runtime from
entering Gecko builds.

## Build

The module pins the Cefrium SDK and Gradle plugin to `0.8.0`, targets arm64, and
requires Android API 29 or newer.

**`0.8.0` is a required move, not a choice.** The Cefrium Maven registry
(`https://codeberg.org/api/packages/cefrium/maven`) only ever serves the latest
release; `0.7.1` has been pruned and no longer resolves
(`Plugin [id: 'com.cefrium', version: '0.7.1'] was not found`). Cefrium is beta
with limited maintainer bandwidth and does not keep old versions installable, so
this module must track whatever is current upstream.

**`:cefrium` is no longer a subproject of the root `android/` Gradle build.**
Cefrium `0.8.0` ships Chromium 152's Java 25 (class-file 69) bytecode, which
requires **AGP 9.4+ / Gradle 9.7.1+ / JDK 25 / compileSdk 37**. Gradle resolves
one version per plugin id for an entire build, so `:cefrium` cannot request AGP
9.4 while `:app` (GeckoView, still AGP 8.9.1) stays on the classpath at 8.9.1 in
the same invocation -- confirmed by reproducing it: `Error resolving plugin
[id: 'com.android.application', version: '9.4.0'] > ... already on the
classpath with a different version (8.9.1)`. `android/cefrium` is therefore its
own root Gradle project now, with its own wrapper (Gradle 9.7.1) and its own
`settings.gradle.kts`; it still compiles the shared `android/app/src/main`
sources via relative `sourceSets` (see "Toolchain notes" below for a real trap
in that setup under AGP 9's built-in Kotlin).

Check free space before starting Gradle and stop if less than 2 GB is available:

```bash
df -Pk .
cd android/cefrium
export JAVA_HOME=<a JDK 25 install>      # e.g. Temurin 25; javac must read class-69
export ANDROID_HOME=<an SDK with platforms;android-37 + build-tools;37.0.0>
./gradlew testDebugUnitTest assembleDebug
```

The debug APK is written to:

```text
android/cefrium/build/outputs/apk/debug/cefrium-debug.apk
```

## Toolchain notes (0.8.0 migration)

Migrating this module from `0.7.1`/AGP 8.9.1 to `0.8.0`/AGP 9.4.0 surfaced a
few non-obvious traps, recorded here so nobody has to rediscover them:

- **AGP 9 built-in Kotlin needs an explicit `kotlin.srcDir`, not just
  `java.srcDir`.** This module reuses `android/app/src/main/java` via
  `sourceSets["main"]` (see `build.gradle.kts`). Under the old
  `org.jetbrains.kotlin.android` plugin, registering that path with
  `java.srcDir(...)` was enough -- KGP fed Android's `java.srcDirs` to the
  Kotlin compiler too. AGP 9's built-in Kotlin support does **not** do that:
  without also calling `kotlin.srcDir("../app/src/main/java")`, the shared
  `.kt` files are silently excluded from compilation, and every symbol they
  define (e.g. `PersistentNetworkService`, `AndroidDevRuntimeSurface`) shows up
  as "Unresolved reference" scattered across `MainActivity.kt` and friends --
  with zero errors reported *in* the missing files themselves, since they were
  never fed to the compiler at all. This is easy to misdiagnose as many small
  compile bugs instead of one root cause.
- **`android:extractNativeLibs` in the manifest is gone; use
  `packaging { jniLibs { useLegacyPackaging = true } }`** in the build script
  (already the case here) -- AGP 9 rejects the manifest attribute outright.
- Do **not** `exclude group: 'org.jspecify'` anywhere in `configurations` --
  newer `androidx` artifacts need it, and AGP 9 consumers that inherited an old
  exclusion (e.g. copy-pasted from a pre-0.8.0 Cefrium sample) will fail
  resource/annotation processing.
- `compose-bom` needs bumping to a release that ships `compileSdk 37`-compatible
  artifacts (this module uses `2026.08.00`); an older BOM pinned for
  `compileSdk 36` will not resolve cleanly against the new SDK level.
- The parent `android/gradle.properties`'s
  `android.aapt2FromMavenOverride=/data/data/com.termux/files/usr/bin/aapt2` is
  Termux-on-device-only and does not apply to this standalone build (see this
  module's own `gradle.properties`) -- building from a desktop host with that
  override in scope fails looking for a nonexistent binary.

### Reliance on Cefrium internals (not public API)

Two integration points in this module reach past Cefrium's public
`com.cefrium.*` surface. They still work against `0.8.0`, but neither is a
documented, versioned contract, so a future Cefrium release could silently
break them without a deprecation notice:

- **`com/cefrium/Te2CefriumBrowserAccess.kt`** declares itself in Cefrium's own
  `com.cefrium` package specifically to reach `CefriumBrowser`'s
  package-private `getWebContents()` and `connectWebContentsInternal()` (the
  SDK source marks `getWebContents()` "Package-private -- internal use only,
  not part of the public API"). Used to wire up the native selection
  ActionMode/magnifier via `CefriumSelectionIntegration.kt` and Chromium's own
  `org.chromium.content_public.browser.ActionModeCallbackHelper`.
- **`CefriumDevToolsRuntime.kt`** imports `org.chromium.chrome.browser.DevToolsServer`
  directly -- a Chromium/Chrome-layer class bundled in the AAR, not a Cefrium
  API, that Cefrium itself only uses internally for its own DevTools bridging.

If Cefrium ever wants to formalize either surface (a supported selection/
ActionMode integration hook, or a supported way to reach an app-scoped
DevTools/CDP endpoint), this module is the concrete external use case to design
against. Filed upstream as SDK feedback alongside this migration.

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
