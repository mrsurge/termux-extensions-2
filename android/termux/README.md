# TE2 Termux consumer target

Separate Android application: `com.termux.extensions.te2termux`, launcher label
**TE2 Termux**. This is the manual local/remote integration checkpoint toward full
Termux/Electromux desktop parity, not a replacement for Cefrium or Gecko.

`settings.gradle.kts` selects the actual Cefrium build definition. The target
compiles the same Cefrium activity/application and shared Android runtime sources;
it does not copy those classes. Its manifest owns its identity and manifest-level
`com.termux` shared UID. Manual local launch/stdin-FD3/environment/ownership
behavior uses the actual Desktop controller through a native-provisioned Node actor.
Physical local launch acceptance remains pending.

The `bundleTermuxShell` task copies the actual `desktop_client/android_shell/`
browser sources into generated `electromux_shell/` APK assets. Only the generated
HTML entrypoints select the consumer bootstrap. The native handler serves an
exact allowlist at `/android-shell/`, before the editor OTA tree, so an ordinary
editor OTA cannot overwrite the consumer shell or silently fetch it upstream.
Missing declared shell assets fail locally. Editor/application assets continue
using the established APK-seed/OTA path and existing loopback relay.

The bootstrap injects the remote gateway adapter before importing Desktop's
launcher/settings modules. It rejects non-loopback hosting and disables interim
automatic-startup/update controls, including async control re-enablement. Endpoint,
bookmarks, catalog and app actions reuse the existing Android gateway/service.
Sidebar preferences and second-editor bridge continue through the same native
implementation; source reuse is not physical parity acceptance.

## Source validation

Initialize the pinned generic host source before configuring this target:

```sh
git submodule update --init vendor/electromux
```

Only TE2 Termux consumes its internal `:electromux-host` Android library. Existing
Cefrium and Gecko targets do not depend on that library. The pin is a build
prerequisite; source checks do not establish installed local-framework acceptance.

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
`mrsurge/electromux`, pinned here under `vendor/electromux`. This consumer checkpoint reuses TE2's mature Android host
as approved by the integrated-POC-first plan; generic host extraction and local
helper integration is source-implemented but not yet physically accepted. See
`docs/apps/electromux/PLAN.md` and `TRACKER.md` at repository root.

## Manual local controls

PersistentNetworkService owns the helper transport and bounded request/event
lanes. Activity navigation only detaches its document subscription. Destruction
disconnects without implicitly stopping the retained helper/actor/framework.
Manual Stop uses the Desktop controller and cannot stop external frameworks.

Only the exact native-served `/android-shell/index.html` and `settings.html`
documents can invoke local config/state/start/stop/use. Other same-origin app
pages, query/fragment variants and remote documents have no such authority.
Credentials, helper argv and backend declarations are native-owned. Identity
verification still requires the installed Termux shared UID and signature.

Gradle builds/bundles the actual Node actor and Desktop browser modules. The AAR
provides the generic helper and browser bridge. Native provisioning publishes
them under Termux's `~/.cache/te2-electromux`; launcher configuration is stored at
`~/.config/te2/te2-termux/desktop-local-framework.json`. Its separate configuration
root does not change the launched framework's own config/data roots. Node and
ordinary Python must already be installed in Termux.

The native service supplies the selected upstream endpoint to the actor. Only
explicit Start/Use advances local selection intent; observation/reconnect cannot
retarget the relay. A user-selected remote endpoint during startup wins. Events
use native service state for the actual selected endpoint, not actor speculation.
Source build preparation returns a prompt acknowledgement and remains asynchronous
before FD3 framework readiness. No uncertain mutation is replayed.

Automatic framework/preferred-app launch, owned-framework app-exit behavior,
consumer-shell OTA and physical recreation/reconnect tests are later parity gates.
