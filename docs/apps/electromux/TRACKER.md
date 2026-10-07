# Electromux tracker

Plan: [PLAN.md](PLAN.md). Proposal: [onboarding draft](../../../electromux-onboarding-draft.md).

## Planning

- [x] Clarify Electron-like Android hosting; remove generated HTML/srcdoc design.
- [x] Create local `feature/electromux-host` branch, preserving the draft edit.
- [x] Record separate framework-agnostic repo, sample-first and test-first direction.
- [x] Clarify additional APK identity: coexist with, not replace, existing clients.
- [x] Name the additional consumer app **TE2 Termux**; Electromux remains the host/library.
- [x] Inspect current Cefrium, Electron controller and installer reference paths.
- [x] Record source revisions and initial extraction inventory.
- [x] Investigate Tasker direct service versus public RUN_COMMAND execution.
- [x] Record signing/UID, private IPC and installer/build-wait contract baseline.
- [x] Approve `~/knowhere/electromux`, private `mrsurge/electromux`, and initial scaffold.

## Independent sample

- [ ] Prove final APK signing/shared UID and supported Termux execution adapter.
- [ ] Prove authenticated session-scoped local IPC on both devices.
- [ ] Define lifecycle, protocol, asset and consumer adapter interfaces.
- [ ] Implement minimal backend/helper/host/sample with no TE2 dependency.
- [ ] Pass protocol/lifecycle/browser/install automated tests.
- [ ] Pass ordinary on-device install/launch acceptance on Motorola and Pixel.
- [ ] Record failure, upgrade, rollback, shutdown and recovery acceptance.

## Additional TE2 host

- [x] Approve Desktop-parity POC direction and reusable branding/custom routes.
- [x] Inventory Desktop request/event APIs and actual reusable JS/TS modules.
- [x] Implement independent native-owned descriptor/request/reply-event foundation.
- [ ] Complete consumer/platform adapters and unsolicited event lifecycle without Node/Electron leakage.
- [ ] Prove new TE2 Termux remote-only client before local launch integration.
- [ ] Adapt owned local framework/stdin-FD3 control and desktop startup policies.
- [ ] Complete per-feature Desktop parity matrix and both-device lifecycle gates.
- [ ] Publish approved working POC, then stabilize reusable host/library interfaces.

- [ ] Approve pinned submodule or Gradle/Maven integration.
- [ ] Add a separate Electromux-based app/build target with a distinct application ID.
- [ ] Reuse generic reference patterns behind interfaces, preserving existing clients.
- [ ] Verify side-by-side installation and independent host settings/lifecycle.
- [ ] Cover TE2 launch/install source-build waiting and ownership semantics.
- [ ] Preserve local assets/OTA and existing remote-framework behavior.
- [ ] Pass regression and exact-installed-asset live acceptance.

## Evidence and constraints

Initial source inspection: current Cefrium source declares sharedUserId under
application, not manifest; validate merged APK and actual UID rather than assume
it establishes the proposed identity. Termux execution/helper IPC remains new
work. Electron controller has distinct stdin/FD3 control and health-discovery
contracts; TE2 worker readiness remains pipe-owned. No implementation or device
acceptance is claimed by this planning checkpoint.

The investigated baseline in PLAN.md selects Tasker-style direct service
execution for the first shared-UID sample, not public RUN_COMMAND by accident.
Current TE2 Cefrium also has a consumer-specific UID placeholder and development
key, so this requires a new independent sample identity. Helper-owned filesystem
AF_UNIX IPC is proposed; actual service/socket access remains a physical gate.

## Independent scaffold checkpoint (2026-10-06)

Local repo: `/home/mrsurge/knowhere/electromux`. GitHub owner: `mrsurge`;
visibility: private. No TE2 submodule is added in this slice.
The independent scaffold implements bounded control framing, real Unix-socket
helper/backend lifecycle, detach/reconnect and correlated sample responses.
Ten standard-library unittest cases pass. Android/Cefrium Gradle task discovery
passes with pinned AGP 9.4.0, Gradle 9.7.1 and Cefrium 0.9.0.

The sample identity is `dev.mrsurge.electromux.sample`, not TE2 Termux's final
application ID. The sample page explicitly disables its pending Start control.
No APK compilation/installation, Termux execution-service wiring or native
socket/bridge acceptance is claimed. Repository licensing, pinned source
submodule, robust transport deadlines/concurrency and installer integration
remain tracked in the independent repo's `docs/TRACKER.md`.

## Native launch adapter checkpoint (2026-10-06)

The independent sample now checks installed Termux UID, signing certificates and
service availability before explicitly dispatching the native-configured
`python --version` diagnostic to TermuxService. No page/incoming Intent controls
the executable or arguments. Native UI distinguishes dispatch from completion;
completion observation and the page/helper bridge remain pending.

Android source compilation and 3 JVM launch-contract tests passed; all 10 Python
regressions passed. No APK assembly, signing-key acquisition, installation or
device changes were performed. Signed shared-UID/service-start acceptance is
still a physical-device gate, not established by these tests.

The next gate is defined in the independent repo's
`docs/DEVICE_LAUNCH_PROCEDURE.md`: inspect the installed Termux signer/UID,
select a matching external key, approve signed sample build/install, verify
diagnostic completion, then repeat on the second device. No ADB device was
visible when this procedure was recorded; reconnect before proceeding. No
Termux wipe, existing TE2 APK replacement or public RUN_COMMAND fallback.

Pixel diagnostic gate progressed on 2026-10-06: signed arm64 sample assembled
and installed alongside existing clients, matching Termux certificate and actual
UID 10321. Native identity checks pass and bundled page renders. Diagnostic
dispatch succeeds, but available logs do not prove command completion; that
gate remains open. Next scope is a narrow correlated completion observer before
the page/helper bridge. Exact APK hash/device evidence is in the independent
Electromux `docs/TRACKER.md`; Termux/user data were not reset.

The Pixel completion blocker is now closed by the correlated non-exported
PendingIntent observer: stdout `Python 3.14.6`, empty stderr, exit code 0.
Termux's `err=-1` is its Activity.RESULT_OK success sentinel. Six JVM and ten
Python tests pass; the updated signed arm64 sample is installed on Pixel.
See the independent tracker for exact APK hash and bounded acceptance evidence.
No helper/backend readiness or Motorola acceptance follows from this diagnostic;
the next slice is authenticated filesystem socket/native bridge integration.

Authenticated helper bridge implementation is now in the independent sample:
bundled Python provisioning, exact-page/fixed-method policy, native credentials,
bounded framed socket requests and explicit detach/stop/shutdown. Twelve Python
tests, nine JVM tests, bundled-page JS regression and signed assembly pass.
Pixel bridge acceptance remains pending: the first Connect was rejected before
provisioning; a diagnostic follow-up APK is installed, but the device locked
before its rejection code could be inspected. Keep this distinct from the
already accepted diagnostic execution callback. Independent tracker carries
the current investigation; shared TE2 runtime and existing clients are unchanged.

Pixel native helper bridge is now physically accepted after registering Cefrium
0.9.0's native callback target through its public loading-state listener. Exact
trusted-page policy remains intact. Connect/Start/Ping, retained-PID detach and
reconnect, Stop and authenticated Shutdown passed; owned helper/backend and
socket were cleaned up. Session directory/token/socket modes were 0700/0600/0600.
Thirteen Python tests, nine JVM tests and bundled-page JS checks pass. Independent
tracker records corrected APK hash and the idle-expiry/manual-reconnect detail.
Motorola repeat, lifecycle stress, installer and TE2 consumer remain separate.

## Desktop API / consumer bridge foundation

- [x] Prove actual Desktop host module reuse via injected platform adapter.
- [x] Cover existing Electron parent request/navigation/state behavior unchanged.
- [x] Wire native gateway/bootstrap and disable unavailable remote-only settings in new target.

Source/test reuse seam passes `node tests/electromux_desktop_reuse.test.mjs` and
113 Electron regressions. New adapter is not yet loaded by any native client;
no asset publication, APK or live acceptance is claimed. This follow-up remains
uncommitted after the requested pushed checkpoint.

## Separate native consumer source checkpoint

- [x] Add standalone `android/termux` identity/manifest using the existing Cefrium build/source.
- [x] Generate actual Desktop shell resources with consumer-only bootstrap.
- [x] Serve consumer assets from APK before editor OTA; retain existing editor asset ownership.
- [x] Compile target and pass 9 JVM, 58 existing Cefrium, 113 Electron and browser regressions.
- [x] Inspect merged debug identity/shared UID/private runtime/provider boundary.
- [ ] Separately approve signed assembly/install and remote-only live acceptance.
- [ ] Add full local execution/launch environment/ownership/stdin-FD3/startup parity.
- [ ] Physically verify Sidebar settings and second-editor parity on both devices.

No APK was assembled or installed. Explicit Termux-compatible signing is required
for APK tasks; target/service/renderer source reuse does not establish installed
signing/UID, lifecycle or full Desktop parity. Local controls remain disabled only
for this interim checkpoint. Source and documentation are uncommitted.

The independent `docs/DESKTOP_API_INVENTORY.md` maps 21 launcher requests,
28 separately guarded app-view commands, event/dialog APIs and portable source
candidates. Its sample now uses native-owned consumer descriptors and registered
handlers with bounded browser request/reply and disposable reply-event listeners.
Android compilation, 11 JVM tests, 13 Python tests and browser regressions pass.
Actual Desktop-source reuse, unsolicited events and the remote-only TE2 Termux
target are next integration gates. No new APK/device or TE2 runtime change,
commit/push or publication is claimed by this slice.

## Pixel signed consumer validation (2026-10-06)

Supersedes the source-only checkpoint's uncommitted/no-assembly status: source
checkpoint `78fabd36` is pushed on `feature/electromux-host`. The user approved
signed debug assembly and installation on Pixel only, with no Termux reset,
existing client replacement, or shared framework restart.

- [x] Recover official GitHub Termux public test signing configuration; confirm
  installed Termux and candidate certificate SHA-256 match
  `b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1`.
- [x] Assemble `android/termux` debug successfully (36 seconds), arm64-only,
  separate ID `com.termux.extensions.te2termux`, label TE2 Termux, 237 MiB.
- [x] Verify APK-owned Desktop shell inventory and consumer bootstrap in index.html.
- [x] Complete ADB installation and verify shared UID `10321`, matching Termux.
- [ ] Verify remote launcher/settings and obtain user live acceptance.

Candidate: `android/termux/build/outputs/apk/debug/te2-termux-debug.apk`.
SHA-256: `ee5511b8e949902e29e9a41d7d5999c35dff509845b7999cc6ab5f79e26947b5`.
Signing material remains in ignored local state, not source. No publication.

Launcher renders and the user started the existing local framework; catalog
connects. App navigation currently produces a blank content area (reproduced
with File Explorer); this blocks live acceptance. No framework restart/reset
was performed. Investigate native app-shell navigation/asset readiness separately
from signing: package install and launcher rendering succeeded.

Future parity requirement: generic Electromux native window management and
decorator/chrome APIs should deliver the Electron-style experience. The reused
Jetpack header buttons are interim, not the final window API/design. This is
future work, not part of the current remote-only validation/fix scope.

### Fresh APK seed correction

The user confirmed Android OTA repaired app loading. Source inspection found
the bundle manifest already includes `app/static/js`; the APK seed was stale,
not the manifest. Ran the existing `scripts/bundle_gecko_assets.sh`, publishing
217 files / 40 MiB at version `0.2.352`, then assembled the signed consumer APK
(incremental Gradle build: 3 seconds). Verified all five literal app-shell static
script/module dependencies exist; the APK's `te_guarded_navigation.mjs` checksum
matches source. No source-level navigation or worker change was needed.

Corrected APK SHA-256:
`7ceaabcb055dd45a422b3bc91658b46492341ec282bfb0207f2fa3bfee1d1ab3`.
Signing certificate remains the installed Termux GitHub test certificate.

Installed on Pixel, cleared only `com.termux.extensions.te2termux` with explicit
user approval, and relaunched. No OTA was invoked. Launcher connected to the
existing framework and File Explorer rendered its toolbar, home path and
directory listing from fresh app storage. The shared framework was not restarted;
Termux, Cefrium and Gecko data were not cleared. This resolves the reproduced
blank app-shell bootstrap failure; broad UI/parity acceptance remains separate.

## Local-control backend foundation

- [x] Checkpoint corrected fresh-install asset seed (`f45576f6`, local commit).
- [x] Investigate actual Desktop controller/config and generic sample helper.
- [x] Bundle standalone TE2 Node actor reusing Desktop sources, no Electron dependency.
- [x] Generic helper supports private native-declared backend argv/cwd/env/deadline.
- [x] Separate actor/framework readiness; build-only preparation precedes FD3 timeout.
- [x] Four actor tests: >5s build, FD3/owned shutdown/duplicate start, external
  ownership, failed preparation, and signal-during-build cleanup.
- [x] Desktop typecheck/113 regressions and actor strict TypeScript check.
- [x] Independent generic helper suite: 14 Python tests.
- [x] Generic helper Session -> actual bundled Node actor config/shutdown smoke.
- [ ] Native provisioning/authorization, host-neutral state events, relay sync/service wiring.
- [ ] New APK/Pixel local lifecycle acceptance (not approved by this backend slice).

Build: `node desktop_client/electromux/build.mjs`; test:
`node --test tests/electromux_local_backend.test.mjs`.
No runtime fetching, native publication, framework restart, release/tag or live
framework launch occurred. Backend slice is uncommitted in TE2 and independent
Electromux repositories. See actor README for limitations.

## Asynchronous state transport prerequisite

- [x] Single generic backend reader correlates replies and separates id-less events.
- [x] Authenticated hello opts into events; request-only clients remain compatible.
- [x] Bounded 16-frame connection writer disconnects slow consumers without stopping backend.
- [x] Detach discards events; reconnect explicitly reads authoritative state.
- [x] TE2 actor emits/coalesces local-framework-state, including build/operation completion.
- [x] Four actor lifecycle tests await state events instead of polling.
- [x] Generic helper/protocol suite: 20 tests, including interleaving,
  EOF-after-reply, invalid event correlation, bounded overflow, partial writes
  and authenticated reconnect.
- [x] Actor rebuild and strict TypeScript check; both repository diff checks.
- [ ] Kotlin socket reader/event subscription and persistent-service wiring.
- [ ] APK assembly and Pixel local lifecycle acceptance (separate approval).

No Android source, APK, device state, shared framework, tags or releases changed.
Changes remain uncommitted in both repositories.

Checkpoint: TE2 `79aaca83`, independent Electromux `fdfb3f1` commit the backend
and helper-event foundations locally (not pushed by this checkpoint).

## Generic Kotlin transport follow-up

- [x] Reusable FrameCodec/FramedTransport under Electromux host package.
- [x] Adapt sample HelperClient with optional native-declared events, disabled by default.
- [x] Seven JVM transport regressions and Android Kotlin compilation.
- [ ] Renderer event delivery and persistent-service ownership.
- [ ] TE2 provisioning, exact APK-owned page bridge, endpoint synchronization.
- [ ] APK/device acceptance, separately approved.

Source-only follow-up in independent Electromux; no TE2 Android edits or runtime
restart. Installed clients remain unchanged. Independent docs/CONTRACT.md owns
the native transport contract. Generic native changes are not yet checkpointed.

## Document-fenced renderer event delivery

- [x] Generic browser receiveEvent accepts only declared, current-document events.
- [x] Native RendererEventGate fences requests/replies/events to exact current page and generation.
- [x] Sample opts into helper events, emits independent sample.state frames and
  delivers quoted JSON through a bounded UI-post lane.
- [x] Native navigation disconnects client without stopping retained helper/backend.
- [x] 22 JVM tests, 21 Python tests, browser regressions and Kotlin compilation pass.
- [ ] APK/device validation of actual callback ordering/reload/event delivery.
- [ ] TE2 generic provisioning, persistent service and relay endpoint integration.

Source-only slice; no installed client assets, APKs, device state, shared framework,
signing, launch authority or release changed. Changes remain uncommitted.
Electron-subset compatibility will require an unrelated user-selected small
Electron app's almost-drop-in build/behavior acceptance after the TE2 POC.
