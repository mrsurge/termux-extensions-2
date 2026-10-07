# TE2 Termux consumer target

Separate Android application: `com.termux.extensions.te2termux`, launcher label
**TE2 Termux**. This is the remote-only integration checkpoint toward full
Termux/Electromux desktop parity, not a replacement for Cefrium or Gecko.

`settings.gradle.kts` selects the actual Cefrium build definition. The target
compiles the same Cefrium activity/application and shared Android runtime sources;
it does not copy those classes. Its manifest owns its identity and manifest-level
`com.termux` shared UID. Full local launch/stdin-FD3/environment/ownership parity
is still planned; no local framework is launched by this checkpoint.

The `bundleTermuxShell` task copies the actual `desktop_client/android_shell/`
browser sources into generated `electromux_shell/` APK assets. Only the generated
HTML entrypoints select the consumer bootstrap. The native handler serves an
exact allowlist at `/android-shell/`, before the editor OTA tree, so an ordinary
editor OTA cannot overwrite the consumer shell or silently fetch it upstream.
Missing declared shell assets fail locally. Editor/application assets continue
using the established APK-seed/OTA path and existing loopback relay.

The bootstrap injects the remote gateway adapter before importing Desktop's
launcher/settings modules. It rejects non-loopback hosting and disables interim
local/startup/update controls, including async control re-enablement. Endpoint,
bookmarks, catalog and app actions reuse the existing Android gateway/service.
Sidebar preferences and second-editor bridge continue through the same native
implementation; source reuse is not physical parity acceptance.

## Source validation

Use the existing Cefrium JDK 25 / SDK 37 toolchain, at least 2 GB free disk:

```sh
cd android/termux
./gradlew compileDebugKotlin testDebugUnitTest
```

The wrapper delegates to Cefrium's pinned wrapper, selecting this independent
project. It does not enter the Gecko Gradle build. SDK/JDK paths and signing
secrets are local environment, never source.

APK assembly/install requires separate approval and explicit external
`ELECTROMUX_KEYSTORE`, `ELECTROMUX_STORE_PASSWORD`, `ELECTROMUX_KEY_ALIAS` and
`ELECTROMUX_KEY_PASSWORD`. The signer must match the actual installed Termux
signer/shared UID; default Android debug signing is deliberately rejected for
APK tasks. Credentials or the public sample test key are not committed here.
Matching signer, merged manifest/provider behavior, installed UID and both-device
acceptance remain gates. No APK or device change is implied by compilation.

The independently tested generic Electromux helper/descriptor APIs remain in
`mrsurge/electromux`. This consumer checkpoint reuses TE2's mature Android host
as approved by the integrated-POC-first plan; generic host extraction and local
helper integration are not claimed complete. See
`docs/apps/electromux/PLAN.md` and `TRACKER.md` at repository root.
