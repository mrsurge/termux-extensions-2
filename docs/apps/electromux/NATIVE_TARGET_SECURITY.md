# Best Practices and Security Alignment Update: separate native consumer

Scope: TE2 Termux remote-only source checkpoint, 2026-10-06. This is a targeted
component/launch review, not a comprehensive Chromium or network security audit.

## Impact and priority

High: the future local-execution host must not accidentally ship with a signer
incompatible with Termux or expose its runtime service. Medium: browser-side
configuration must not imply native authority or leak consumer assets upstream.

## Files and implementation

- `android/termux/src/main/AndroidManifest.xml`: distinct app identity, manifest-level
  shared UID, non-exported persistent service, exported launcher Activity only.
  No new command receiver, provider, intent-redirection action or deep-link input.
- `android/cefrium/build.gradle.kts`: new-target APK tasks require explicit external
  signing configuration. Existing Cefrium signing behavior remains unchanged.
- `android/cefrium/.../TermuxShellAssets.kt` and `MainActivity.kt`: native allowlist
  serves packaged consumer files; unknown/missing shell assets return local errors.
- `desktop_client/android_shell/electromux-bootstrap.js`: loopback-only consumer
  bootstrap; narrow existing gateway, no interpreter/executable input.
- `electromux-platform.js`: allowlisted app routes and same-relay navigation;
  unsupported startup/mutations fail rather than report fake completion.
- `PersistentNetworkService.kt`: new package is correctly identified as Cefrium;
  no new exported service or runtime transport.

No new runtime dependency, permission-sensitive execution API or PendingIntent
was added. Existing Activity launches no nested incoming Intent; `onCreate`
constructs its configured runtime and does not deserialize caller launch commands.
No `singleTop` or new `onNewIntent` path is introduced. Same-UID apps are trusted
siblings, not an isolation boundary; signing/UID must be proven on installed APKs.

## Key implementation diff

```diff
+<manifest xmlns:android="http://schemas.android.com/apk/res/android"
+    android:sharedUserId="com.termux">
+    <queries><package android:name="com.termux" /></queries>
+    <application android:name=".CefriumApplication"
+        android:allowBackup="false" android:label="TE2 Termux">
+        <activity android:name=".MainActivity" android:exported="true">
+            <!-- MAIN / LAUNCHER only; no command/deep-link intent filter -->
+        </activity>
+        <service android:name=".PersistentNetworkService" android:exported="false" />
+    </application>
+</manifest>
```

The actual manifest retains the established network/foreground-service
permissions and renderer options; the excerpt highlights the new component
boundary rather than reproducing unrelated configuration.

## Verification and limitations

Target JVM tests check build identity, manifest-level UID, private service,
asset-path escapes and actual-source asset generation. Browser tests check
native-origin bootstrap, unsupported controls, gateway DTO unwrapping and event
disposal. Existing Cefrium/Electron regressions protect unchanged paths.
APK assembly/install, installed signer/UID, provider startup, lifecycle and
device-side behavior are not accepted by these source tests.

The generated debug merged manifest was additionally inspected: distinct
`com.termux.extensions.te2termux` identity, root `com.termux` shared UID, private
PersistentNetworkService and private `com.termux.extensions.te2termux.cefriuminit`
provider. Existing debug-only NativeDebugReceiver is reused with its DUMP
permission; no new command receiver is introduced. This merge evidence does not
prove installed signing/UID or provider startup on a physical device.
