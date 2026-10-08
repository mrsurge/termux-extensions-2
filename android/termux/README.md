# TE2 Termux consumer target

Separate Android application: `com.termux.extensions.te2termux`, launcher label
**TE2 Termux**. This is an Electromux-based local/remote Android client, not a
replacement for Cefrium or Gecko.

**The current APK is compatible only with the GitHub debug build of Termux,
signed with Termux's public test key. F-Droid and Google Play Termux builds are
not compatible with this signing/shared-UID lane.**

## Preview installation

Install/open the compatible Termux build once, then install/open the TE2 Termux
preview APK. With no existing TE2 executable or manually configured command/venv,
the launcher and Settings local-framework card offer **Install**. Confirm to run
the published `latest/download/install-te2` script inside Termux; the app shows
progress and supports cancellation. On success, executable discovery is repeated.
Choose **Start** separately, or select a remote framework URL/bookmark; installing
does not automatically start the framework or retarget a remote connection.
Cancellation can leave partial changes and does not promise rollback.

Fresh Termux userspace installation and local/remote controls have user live
acceptance. The minified staging APK is also user live-accepted on Razr.
The client is still a development preview; its accepted staging APK is available
as `te2-0.2.352-termux-staging-arm64.apk` in the existing 0.2.352 GitHub release.
Neither wheel was changed for this work: framework/assets remain
0.2.352; the installer consumes the existing release and follows future `latest`
releases. Exact build hashes and scoped acceptance are recorded in
`docs/apps/electromux/TRACKER.md`.

## Hosting and source ownership

`settings.gradle.kts` selects the actual Cefrium build definition. The target
compiles the same Cefrium activity/application and shared Android runtime sources;
it does not copy those classes. Its manifest owns its identity and manifest-level
`com.termux` shared UID. Manual local launch/stdin-FD3/environment/ownership
behavior uses the actual Desktop controller through an APK-bundled embedded Node
actor. The reusable Electromux runtime remains framework-independent; TE2's
installer and framework policy live in `desktop_client/electromux/`.

The `bundleTermuxShell` task copies the actual `desktop_client/android_shell/`
browser sources into generated `electromux_shell/` APK assets. Only the generated
HTML entrypoints select the consumer bootstrap. The native handler serves an
exact allowlist at `/electromux-shell/`, before the editor OTA tree, so an ordinary
editor OTA cannot overwrite the consumer shell or silently fetch it upstream.
Missing declared shell assets fail locally. Editor/application assets continue
using the established APK-seed/OTA path and existing loopback relay.

The bootstrap injects the remote gateway adapter before importing Desktop's
launcher/settings modules. It rejects non-loopback hosting. Startup settings use
the exact-document native bridge; asset-update controls remain disabled here. Endpoint,
bookmarks, catalog and app actions reuse the existing Android gateway/service.
Sidebar preferences and second-editor bridge continue through the same native
implementation; source reuse is not physical parity acceptance.

## Source validation

The consumer-only Android settings section exposes the existing active-session
keep-alive notification/power policy, current permission/CPU/Wi-Fi lock state,
and native system-settings actions. The keep-alive checkbox saves immediately
on change without a separate Save button. Returning refreshes only that section,
preserving unsaved connection values. A native one-time Localhost bookmark seed
does not change the endpoint or recreate a user-deleted preset. New launcher
modules are APK-owned and need an APK update, not editor OTA alone.

Automatic local launch and preferred-app selection reuse Electron's settings
fields through the native exact-document bridge. They persist in private
`electromux_startup` preferences, not random-origin browser storage. Explicit
fresh app entry starts the local controller parallel with UI loading; preferred
app navigation waits selected readiness. Reload/recreation does not replay it.
Legacy launcher URLs migrate to `/electromux-shell/` without clearing app data.
Installed startup/settings and local/remote behavior have user live acceptance;
individual lifecycle/device gates remain recorded in the tracker.

Initialize the pinned generic host source before configuring this target:

```sh
git submodule update --init vendor/electromux
```

Only TE2 Termux consumes its internal `:electromux-host` Android library. Existing
Cefrium and Gecko targets do not depend on that library. The pin is a build
prerequisite; source checks alone do not establish installed runtime acceptance.

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
acceptance must be checked for each deployment. No APK or device change is implied
by compilation. For the minified size-validation lane, run `./gradlew assembleStaging`;
it uses R8/resource shrinking and the same explicitly selected signing identity.

The independently tested generic Electromux host/runtime APIs remain in
`mrsurge/electromux`, pinned here under `vendor/electromux`. This consumer reuses
TE2's mature Android host and portable Desktop controller. See
`docs/apps/electromux/PLAN.md` and `TRACKER.md` at repository root.

## Manual local controls

PersistentNetworkService owns the embedded-client transport and bounded request/event
lanes. Activity navigation only detaches its document subscription. Destruction
disconnects without implicitly stopping the retained helper/actor/framework.
Manual Stop uses the Desktop controller and cannot stop external frameworks.

Only the exact native-served `/electromux-shell/index.html` and `settings.html`
documents can invoke local config/state/start/stop/use. Other same-origin app
pages, query/fragment variants and remote documents have no such authority.
Credentials, child environment and backend declarations are native-owned. Identity
verification still requires the installed Termux shared UID and signature.

Gradle builds/bundles the actual Node actor and Desktop browser modules. The
`:electromux-node` library embeds Node 24 in the APK; `TermuxNodeService` runs it
in the private `:electromux_node` process. It does not use the historical Python
helper or an external Termux Node executable to run the host actor. Its entrypoint
is materialized into app-owned no-backup storage. Launcher configuration is stored at
`~/.config/te2/te2-termux/desktop-local-framework.json`. Its separate configuration
root does not change the launched framework's own config/data roots. Framework
Python/Node and other dependencies belong to the Termux installation and are
supplied by the standard installer; they are distinct from the APK's host runtime.

The native service supplies the selected upstream endpoint to the actor. Only
explicit Start/Use advances local selection intent; observation/reconnect cannot
retarget the relay. A user-selected remote endpoint during startup wins. Events
use native service state for the actual selected endpoint, not actor speculation.
Source build preparation returns a prompt acknowledgement and remains asynchronous
before FD3 framework readiness. No uncertain mutation is replayed.

Automatic framework/preferred-app selection is implemented. Complete Electron
API parity is not claimed; remaining lifecycle/compatibility gates and publication
work are tracked separately. Consumer launcher assets are APK-owned, while
editor/application assets retain the existing APK-seed/OTA mechanism.
