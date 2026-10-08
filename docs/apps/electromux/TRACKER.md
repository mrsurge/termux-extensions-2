# Electromux tracker

## Unrelated Electron calculator foundation (2026-10-08)

- [x] Independent manifest/main-window/menu adapter foundation and 30 passing runtime tests.
- [x] Document main-window-only scope, explicit unsupported behavior and remaining gates.
- [x] Actual Electron entrypoint/preload/native calculator source integration.
- [x] Actual pinned main/preload Node probe runs without application source edits;
  scoped adapters/deferred context menus are documented, not hidden no-ops.
- [x] All 31 TE2 consumer regressions pass with existing APIs unchanged.
- [x] Isolated full-duplex native effect driver and calculator APK source/build gate.
- [x] TE2 Termux comparison: native tests/compile pass; no existing Binder API changed.
- [ ] Installed calculator rendering/preload/menu/lifecycle live acceptance.
- [x] Razr USB renderer/arithmetic smoke: content visible and `2 + 3 = 5` verified;
  fixed AAPT inventory omission and file-origin locale fetch failure.

Standalone calculator APK installed; no TE2 runtime change. See independent
`vendor/electromux/docs/ELECTRON_CALCULATOR_POC.md`.

## Android input / DevTools settings parity (2026-10-08)

- [x] Add IME composition workaround, Dev tools run profiles, and Dev tools debug checkboxes.
- [x] Reuse native Android settings keys/defaults; immediate save, confirmed-value restoration on failure.
- [x] Exact packaged-page save lane accepts only four declared real booleans.
- [x] Service settings-change notification updates Termux Activity Inspector policy immediately, without page reload/endpoint mutation.
- [x] Browser regressions and ordinary Cefrium compile/JVM tests pass.
- [x] Final Termux JVM checks/debug assembly and approved in-place Razr installation.
- [x] User live acceptance: all three toggles/current behavior working well.

IME uses the existing service/UI IPC context-switching policy. DevTools shares
Cefrium's Inspector runtime and run-profile/debug target filtering; no new CDP
transport, embedded Node Inspector or generic Electromux API is introduced.
APK bundling is required; editor OTA does not update these launcher controls.
Validation: 31 browser/actor regressions, Termux and ordinary Cefrium JVM/compile
checks pass. ADB in-place installation succeeded; app storage preserved, no
agent launch/toggle or framework restart. APK SHA-256
`48e76eb306e2b49bfc351e6ae2c0ec0cfb6abdfa31fea70adfc8ef2fd2419aae`;
packaged settings checksum matches source
`779f0d18df5e9df0f5c260514daa0719ded86bf23308e77683c79280f212a29d`.

## TE2 consumer installer slice (2026-10-08)

- [x] Termux-native missing-executable/manual-config eligibility and strict consent.
- [x] Fixed published installer download; bounded progress and exact owned-group cancellation.
- [x] Post-exit executable rediscovery, no automatic Start/endpoint selection.
- [x] Launcher/Settings card reuse and exact native method allowlists.
- [x] Strict TS bundle/check, 30 Node/browser regressions, Termux/runtime JVM tests and Kotlin compilation.
- [x] Reconcile stale helper/embedded integration status; reusable runtime unchanged.
- [x] Approved debug APK assembly/in-place Razr deployment; storage preserved.
- [x] Preliminary device installer UI/success acceptance on existing Razr Termux userspace.
- [x] User live acceptance: fresh cold Termux userspace with no preinstalled dependencies installs flawlessly.
- [ ] Explicit real installation success/failure/cancel acceptance in a suitable test userspace.

Follow-up deployment: ADB `install -r` succeeded on Razr without clearing storage.
APK SHA-256 `fafc017c246431d96124e1c51037834a6d776781a99fa42d387cfb12654a5952`
(359,966,869 bytes); embedded entry checksum matches the current built bundle
`bfad978f07f326b3b1c6cfbfd1306c34fe481bedc1c477a35c62100c4fcb2318`.
Signer remains the public Termux GitHub test certificate. App opening and real
installer acceptance were left to the user; the agent performed no installer
execution, framework restart or publication. User subsequently uninstalled TE2
and reported installation working. Record preliminary existing-userspace success,
not proof of fresh Termux setup or device failure/cancellation coverage.
Subsequent user test confirmed a fresh cold Termux installation with no
preinstalled dependencies works flawlessly. Fresh-userspace bootstrap/install
success is now accepted; real-device failure/cancellation coverage stays separate.

## Embedded TE2 service integration (2026-10-08)

- [x] Local checkpoint: root `4e3ab515`, nested `11ef6c8`.
- [x] Generic private-service AIDL request/event client with process-retained engine.
- [x] TE2 immutable entry declaration and installed Termux UID/signature checks.
- [x] Replace TE2 runtime's helper/external-Node calls; preserve native page/selection guards.
- [x] Termux-only Node packaging, nested TS build inputs and stale generated actor cleanup.
- [x] Strict runtime checks/build and 24 Node tests; 15 TE2 actor/browser regressions.
- [x] Integrated Termux JVM tests, Node runtime JVM tests and debug APK assembly.
- [x] Ordinary Cefrium compile/JVM tests without Node SDK or module dependency.
- [x] Approved in-place Razr installation; storage preserved and app opened.
- [x] Embedded service boot/PID separation and installed entry checksum verified.
- [x] User local/remote/lifecycle live acceptance.
- [x] User stopped the previous run and restarted; new embedded implementation works.
- [x] User confirmed remote switching working.
- [x] User confirmed Cancel and lifecycle behavior working properly.
- [ ] Process separation/memory and crash/death recovery evidence.

The approved debug APK is installed on Razr without data reset or asset OTA.
UI PID 26331 and embedded Node PID 26413 are separate; Node loads its native shim.
The existing framework PID 16864 survived installation/opening. Saved automatic
startup connected to local and opened Code TE2; no manual Start/Stop or shared
framework termination occurred. Old helper/actor processes remain untouched.
User local restart, Cancel, lifecycle and remote switching acceptance pass.

## Embedded Node runtime prerequisite (2026-10-08)

- [x] Inventory existing Python helper/framing/demo and TE2 Node actor roles.
- [x] Record embedded Node + strict TS direction; Python is not intended host glue.
- [x] Review fogtape Node 24 full candidate and document prerelease/ABI/lifecycle limits.
- [x] Obtain concrete artifact-inspection/sample implementation approval.
- [x] Pin/checksum archive and actual ARM64 library + headers; inspect linkage/16 KB alignment.
- [x] Independent sample source, strict TS bundle/process IPC tests, nine JVM transport tests and APK assembly.
- [x] Independent native Android boot, Ping/filesystem and events on Motorola Razr.
- [x] Fix Service recreation to retain a process-owned engine; explicit Binder errors.
- [x] Activity reopen, Service destruction/recreation and explicit process-stop/reopen device gates.
- [x] Razr separate shared-UID proof: installed matching signer/UID, direct Termux child/env/FD3 and group cancellation.
- [ ] Repeat execution lane on other supported devices/signing families; broader crash recovery.
- [ ] Migrate generic Python supervisor/protocol to TS without weakening guarantees.
  - [x] Native-selected TS consumer-host and owned-child operation foundation;
    strict tests and independent Razr execution/cancellation pass.
  - [x] Long-lived diagnostic readiness/status/stop and declared unsolicited
    events, bounded writer tests, independent Razr lifecycle acceptance.
  - [x] Consumer-selected readiness/stop and bounded streaming output primitives;
    host output regressions and updated independent Razr lifecycle pass.
  - [x] Existing TE2 actor factory extraction and direct/stdin-stdout parity tests.
  - [x] Typed embedded request parameters and TE2 native consumer selection;
    preserve exact-document authorization, then repeat Android lifecycle acceptance.
    - [x] Generic typed parameter DTO validation and APK-owned native entry/method/event declaration.
    - [x] TE2 embedded entry bundle and host private-FD fixture lifecycle/parity tests.
    - [x] TE2 package/build-input wiring and PersistentNetworkService adapter migration.
      Isolated embedded service device acceptance passed; see current checkpoint above.
- [x] Integrate existing TE2 consumer actor; repeat local/remote/lifecycle acceptance.
- [x] Remove Python/external Node host prerequisites and resume installer UI.

Embedded TE2 integration is live accepted and pushed (`b41c05a8`/`396e935`).
Installer source/build proof is recorded above; real installation is not yet
accepted. See PLAN for APK hashes and validation boundaries. The remaining
generic legacy Python SDK migration and broader crash-recovery gates are separate.
The pending Windows wrapper line-ending normalization is approved for the next
commit; it is not an outstanding functional issue.

## Connection/bookmark/Android settings (2026-10-07)

- [x] Explicit full-width mobile Framework host; Port/Connect below.
- [x] One-time native Localhost seed, no endpoint switch or repeated recreation.
- [x] Shared bookmark connection/save/delete adapter regression.
- [x] Consumer-only keep-alive/permission/power settings UI and native actions.
- [x] Activation refresh preserves drafts and disposes listeners.
- [x] Termux/ordinary Cefrium compile/JVM tests and browser checks.
- [x] Approved APK assembly/install on Razr, preserving storage.
- [x] User live validation of connection/bookmark/Android settings.
- [x] Follow-up removes keep-alive Save button and persists checkbox changes immediately;
  pending writes disable the control and failed writes restore the confirmed value.
- [x] Follow-up APK assembled and installed in place on Razr; signer verified.
- [x] User live validation of immediate-save behavior on Razr.
- [ ] Later independent ADB/CDP/console evaluation workflow (no framework required).

The missing-field root cause is unproven; source/APK declared it and runtime CDP
was disabled. The layout change must be judged live, not from the static CSS test.
Installer integration and remote run-profile/clipboard acceptance stay separate.

Debug APK SHA-256:
`74cf7294155110187590c98ca5720db5b71f09388c6cb0fabe6a78c3e6b9a6ea`.
Termux-compatible signer verified and the new Android settings module is bundled.
In-place Razr installation succeeded; no app/framework launch or storage clearing
was performed by the agent. User live acceptance passed.

The user accepted that settings APK. Immediate-save follow-up APK SHA-256:
`d425ee1ac64aa354b639de70f9443b2a5c503ed669b0554dcd87f9ee6d9790ab`.
Seven browser regressions and APK assembly pass; installed with preserved data
and no agent launch. User immediate-save live acceptance passed on 2026-10-07.

## Stale helper endpoint recovery (2026-10-07)

- [x] Preserve and inspect failing Razr state; verify errno 111, no helper/actor,
  persisted attempted session and new APK launcher URL.
- [x] Generic lifetime endpoint lease and refused-socket-only recovery.
- [x] Native bounded connect recovery before handshake; no mutation retry.
- [x] Helper instance identity fences actor initialization after replacement.
- [x] Visible failed-state card/explicit Reconnect rather than hidden card.
- [x] 15 Python helper tests, 5 browser tests, Termux Kotlin/JVM compile/tests.
- [x] Approved APK build/install preserving failing storage.
- [x] User cold-start recovery test without clearing data; reports working.

Recovery APK SHA-256 `6ac089c36ad8530ab97e6f682dc75d7b7c11bb3ca50a617ce529da141b7acce5`
matches the installed Razr APK. Existing Termux-compatible signer verified;
packaged helper includes recovery/lease code. After installation, session
`98d5f49300b5`, `attempted=true` and its stale socket are still present. The agent
did not launch the app/framework or clear storage. User live acceptance passed
on 2026-10-07; resume the deferred connection/Android settings plan next.

See OUTSTANDING_ISSUES for evidence and remaining fail-closed cases. These source
changes include the nested Electromux repo; publish its source/pin separately
when committing. Preserve unrelated nested build-environment changes.

## Automatic startup and launcher isolation (2026-10-07)

- [x] Electron-shaped startup settings through the exact-document native bridge.
- [x] Private persisted startup configuration; preserve omitted fields on save.
- [x] One-shot native entry startup parallel with renderer initialization.
- [x] Selected readiness, navigation/disposal fences and remote-only attach.
- [x] Separate APK `/electromux-shell/` namespace with legacy URL migration.
- [x] Browser regressions and Termux/ordinary Cefrium source build checks.
- [x] Assemble/install separately approved APK without clearing storage.
- [x] User reports the installed startup/settings slice working live.
- [ ] Separate explicit editor OTA/upgrade preservation stress validation.

Settings/install follow-up is deferred for a newly reported major bug; see
[OUTSTANDING_ISSUES.md](OUTSTANDING_ISSUES.md). Documentation only was approved.

Approved debug APK assembly and in-place Razr installation succeeded, preserving
storage and without launching the app/framework. APK SHA-256:
`4a1343a1a793bf5362ef359d8e5b9aef5c6528098fbc91f1662722e6dafe4cb8`.
Signer remains the existing Termux-compatible
`b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1`.
Bundled bootstrap includes native startup settings; user live acceptance is pending.

No live acceptance is inferred from source checks. Earlier disabled-startup
entries below describe preceding checkpoints; owned-framework exit parity remains
a separate follow-up. The missing-card incident's root cause remains unconfirmed.

Plan: [PLAN.md](PLAN.md). Proposal: [onboarding draft](../../../electromux-onboarding-draft.md).

## Release-compatible mobile launch wait (2026-10-07)

- [x] Record mobile-first compatibility direction and Desktop deferral in PLAN.
- [x] Remove mobile's redundant `--build-only` preparation; launch normally once.
- [x] Wait without startup deadline, show latest bootstrap stdout line, retain
  stderr diagnostics and existing readiness authority.
- [x] Add Cancel sending SIGTERM only to the owned launch; fence late readiness.
- [x] Synthetic release-compatible/delayed startup, progress, cancellation and
  ownership regressions; real installed release acceptance remains pending.
- [x] Build/rebundle/install approved APK; user confirms local launch works after
  manually clearing app storage (launcher asset isolation remains a follow-up).
- [ ] Later Desktop wheel update with equivalent semantics.
- [ ] Later bootstrap structured build events and phase-specific deadlines.

Source validation: seven real-process actor tests, fourteen shared controller
tests (including late-hello cancellation and readiness beyond Desktop's attempt
limit), four browser suites including the actual Cancel UI, Electron and actor
strict typechecks, actor bundling, and Termux Kotlin/JVM build checks pass.
Startup failure also covers control-pipe closure/EPIPE without crashing the
actor. No bootstrap/server edits, installed-device changes or publication.
Prior preparation entries describe the superseded separate-build source.

APK assembly and in-place installation completed on Motorola Razr 2024
(`motorola-razr-2024-xt2453v:5555`) on 2026-10-07. Installed APK SHA-256 equals
the built artifact: `cdfc50858753ae3d48eb3d9bbe6a96e5a932e253b4044948dee76730490f6c62`.
Signer is the existing Termux-compatible `b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1`;
shared UID remains `com.termux/10517`. Bundled actor hash matches its source build.
Agent installation preserved app data and did not launch the app/framework.
User subsequently cleared app storage because the framework launch card was
missing; it returned and local launch worked. This is conditional live acceptance
of launch behavior, not proof that upgrade/OTA launcher preservation works.

Next slice: automatic local launch/preferred app plus launcher asset isolation.
Investigate the user's OTA-poisoning hypothesis without assuming the cause.
Either a client-aware unified Android launcher or a separate APK-owned self-hosted
launch location is acceptable; choose from the actual relay/materialization
source. Test APK upgrade/editor OTA without storage clearing and retain ordinary
Cefrium/Gecko behavior. Do not treat clearing storage as the product fix.

## API-declared mobile chrome (2026-10-07)

- [x] Approved reusable Electromux API plus TE2 Termux adapter source/build scope.
- [x] Generic `ChromeSurfaceSpec`/`ChromeSurfaceHost` declaration and disposal test.
- [x] Separate packaged Cefrium toolbar; exact-page/document query authorization.
- [x] Mobile HTML/CSS buttons and Electron-shaped request/subscription bridge.
- [x] Reuse existing native Home/Reload/Recents/Lock/Quit/Tools handlers.
- [x] Browser startup coalescing, action/state/disposal and asset-generation tests.
- [x] Final source/build validation: TE2 Termux and ordinary Cefrium
  `compileDebugKotlin testDebugUnitTest`, generic host tests, browser regression,
  generated chrome/bridge asset inspection and whitespace checks pass.
- [x] Electromux API published at `9922abf`; TE2 submodule updated to that pin.
- [x] TE2 source checkpoint `bf17e8fc` pushed on `feature/electromux-host`.
- [x] Approved debug APK assembly succeeded; signature and packaged chrome verified.
- [x] First toolbar APK installed in place on Pixel; user live acceptance passed.
- [x] Approved layout polish: Home/Reload left, Recents/Quit/Tools right, no Lock.
- [x] Updated browser regression checks actual HTML actions and right-group CSS.
- [x] Polished APK rebuild/signature and packaged five-button layout checks pass.
- [x] User installed polished APK and confirmed the revised toolbar works.
- [ ] Extra-browser startup/memory comparison.

Source/build work made no framework lifecycle change, release or version bump.
The first APK was installed separately; the user installed the polished APK.
Ordinary Cefrium keeps its native header; native tools panel contents
are outside this replacement scope.

The initial APK was subsequently installed successfully on the Pixel without
clearing app data. User confirmed working. The requested layout polish is a
consumer-only HTML/CSS/JS change; no Electromux API or native action contract
changes are required.

Polished APK at the same output path has SHA-256
`32e1ff191c69e0d58dd9c2f206ee401e4563ae4890e4ee4834b20595ad971647`,
with the same verified signer. Rebuild succeeded; the user installed it and
confirmed live acceptance on 2026-10-07.

APK: `android/termux/build/outputs/apk/debug/te2-termux-debug.apk`.
SHA-256: `d207ef89c9ee48acc55f0e472822aea31806c9dc4eb86cbc982352f1a88b49d1`.
Signer SHA-256: `b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1`
(existing GitHub-Termux-compatible test signer). APK contains chrome HTML/CSS/JS
and the generic browser bridge, with the expected script entrypoints. This is
the earlier APK's build evidence; subsequent installation and live acceptance
are recorded above. Inherited submodule `android/gradlew.bat` line-ending changes remain
unstaged and untouched.

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

Checkpoint: TE2 `721ead5d` and independent `2644e07`, local only/not pushed.

## Independent provisioning and runtime service slice

- [x] Generic native HelperInstallSpec/HelperProvisioner, optional bundled backend
  declaration, private bounded package/session materialization.
- [x] Generic RuntimeOwner separates serial requests and disposable renderer observers.
- [x] Private non-sticky independent sample service owns transport/protocol;
  Activity/page recreation detaches only its page, not helper/backend ownership.
- [x] 27 JVM tests, 22 Python tests, browser regression and Android Kotlin compilation.
- [ ] Physical sample lifecycle/reconnect acceptance; separately approved APK build/install.
- [ ] TE2 adapter integration with its existing PersistentNetworkService/relay,
  exact APK-owned launch pages and Desktop configuration/settings flow.

Independent source-only scope. TE2 Android sources, installed assets, signing,
devices and shared runtime are unchanged. Service background survival is not
guaranteed; destruction disconnects, never sends backend Stop/Shutdown or retries
an uncertain launch. See independent docs/CONTRACT.md for the current contract.

## Reusable host consumption prerequisite (2026-10-07)

- [x] Read-only TE2 integration inventory: reuse PersistentNetworkService and the
  injected Desktop browser-platform seam, not a new lifecycle/relay stack.
- [x] Independent internal `android/host` library; sample consumes it directly.
- [x] Generic host has no sample/TE2/Cefrium imports; sample ping and diagnostics
  stay outside the generic Termux transport/launcher.
- [x] AAR generic assets and sample merged assets match source; no sample/Cefrium
  classes in library. 29 JVM tests, 23 Python tests, browser checks, AAR assembly,
  sample Kotlin compilation and asset merge pass.
- [x] Independent source pushed at `d45788b`; exact Git submodule pin under
  `vendor/electromux`, consumed only by TE2 Termux as `:electromux-host`.
- [x] Pinned consumer validation: all 26 host-library and 9 TE2 Termux JVM
  tests pass; TE2 Termux Kotlin compilation and existing Cefrium Kotlin
  compilation pass. No APK assembled or installed.
- [x] Generic descriptor admits native-declared exact loopback document URLs;
  queries/fragments, remote origins and undeclared paths remain rejected.
- [ ] Apply exact APK-owned launcher/settings authorization in the TE2 adapter.
- [ ] Native selected-endpoint synchronization between actor and existing Android
  settings/relay authority; remote endpoint selection must remain independent
  of owned local framework state.
- [ ] TE2 runtime adapter and independently approved APK/device acceptance.

TE2 Android build configuration now consumes the pinned library. No device or
shared runtime mutation. Library packaging is an internal build
boundary, not public SDK stabilization or Electron-subset compatibility acceptance.

Manual integration is approved: reuse PersistentNetworkService for the native
helper/actor, guarded launcher configuration/start/attach/stop and state events,
and native selected-endpoint synchronization. Automatic startup/preferred-app
behavior, APK installation and physical acceptance remain separate gates.

## Manual native local-control slice (2026-10-07)

### Pixel install and state-handoff follow-up

Signed debug APK installed in place on Pixel with shared UID 10321 and official
Termux GitHub test signer; no app data was cleared by the agent. User subsequently
cleared TE2 Termux data and tested Start. Inspection found its exact actor-owned
bootstrap/server live and `/api/health` healthy, despite a stale Starting card.
Settings/back recovered Running and Stop. Full lifecycle acceptance remains open.

- [x] Add actor-session/revision ordering for replies and events.
- [x] Add single-flight visible/native-settled-page state reconciliation.
- [x] Browser regressions cover late acknowledgement, stale events, actor-session
  reset, activation coalescing and teardown; real actor tests cover revisions.
- [x] Install follow-up APK and obtain user live acceptance of the state fix.

Follow-up APK SHA-256:
`8a09e507c0c49afc80c77e34cd986ecaf76696b27d543b966a602742ec90d460`.
Installed in place with matching Termux signer/shared UID 10321; its packaged
actor checksum matches the generated source build. The existing framework kept
the same instance ID and bootstrap/server PIDs throughout installation. Launcher
reopened showing Running locally, In Use and Stop; user confirmed working.
Six actor tests, browser ordering/activation/disposal regressions, strict actor
typecheck, 16 Termux + 26 host JVM tests and Cefrium compilation/tests pass.
Broader remote-selection, lifecycle and automatic-startup parity gates remain.

No shared framework stop/restart, process-discovery layer or mutation replay is
part of this follow-up. Retained old actors cannot gain new revision metadata
from APK installation alone; their existing processes remain untouched.

- [x] Optional runtime seam owned by PersistentNetworkService; installed only by
  TE2 Termux. Existing Cefrium uses inert adapters; Gecko has no host dependency.
- [x] Native immutable helper/Node actor provisioning, consumer-only launcher
  config root without changing framework child config/data roots.
- [x] Exact packaged launcher/settings URL/method/document authorization, bounded
  native/page event delivery and renderer-generation fencing.
- [x] Manual configuration, state, start/attach/use/stop through actual Desktop
  controller; source preparation acknowledges promptly before FD3 readiness.
- [x] Remote selection stays native-owned; refresh cannot select local, new local
  intent is single-use, and a different current endpoint rejects stale retargeting.
- [x] Actual Desktop launcher/settings reuse enables manual controls while keeping
  automatic startup/preferred-app and asset-update controls disabled.
- [x] Source validation: 15 TE2 Termux + 26 host JVM tests, 58 Cefrium tests,
  Gecko compilation/tests, 113 Electron tests and Electron/actor strict typechecks.
  Six real-process actor tests and browser bootstrap/platform regressions pass.
- [x] Generated shell/actor and merged generic helper/browser assets verified.
- [ ] APK assembly/install and manual local/remote lifecycle acceptance on Pixel.
- [ ] Automatic startup/preferred app and owned-framework exit parity.

No device state, shared framework, release/version or TE2 Git commit changed.
Existing Gradle warnings remain. Gecko needed only a command-line Linux AAPT2
override for the checkout's existing Termux-specific local build setting; no
build environment was edited or staged.

## Minified staging size lane (2026-10-08)

- [x] Keep embedded Node; replacement engines are deferred.
- [x] Existing TE2 Termux staging: R8 and resource shrinking, non-debuggable,
  same public Termux-compatible signing identity and unchanged version.
- [x] Independent calculator staging added with optimized R8 defaults and
  resource shrinking; same local signer/app ID/version as its debug baseline.
- [x] Both APKs assembled; signing and 16 KB ZIP alignment checks pass.
- [x] Calculator APK contains all 66 declared domain resources and runtime entries.
- [x] User installed TE2 Termux staging via `adb push` and confirmed it works
  on Razr (2026-10-08): TE2 staging is live-accepted.
- [ ] Calculator staging live validation deferred by the user; build/resource,
  signing and alignment checks pass, but no staging runtime acceptance claimed.

| APK | Debug MiB | Staging MiB | Debug DEX MiB | Staging DEX MiB |
| --- | ---: | ---: | ---: | ---: |
| TE2 Termux | 343.29 | 192.88 | 105.91 | 45.66 |
| Calculator | 224.52 | 175.88 | 79.94 | 43.95 |

TE2 staging is 202,251,525 bytes, SHA-256
`5bc9f77fe99782f90b5e29311045629e707d5da9bfc19748b9ce94f03bbc205a`;
asset seed is 0.2.352. Its ZIP overhead dropped from 77.58 to 0.70 MiB.
Calculator staging is 184,420,778 bytes, SHA-256
`40da8f9f2b4d8d19f4cf05ef7892a207d48d0a4b99b38ffa45785517c89e437c`.
The native runtime payload remains unchanged; staging compression also reduces
packed native-library size. Calculator's default 2 GB R8 heap failed; a local
command-line 6 GB retry passed in 6m09s. No SDK/JDK/signing environment was committed.

R8 warns about Cefrium final generated resource IDs and optional Chrome class-name
resolution. Preserve mapping/configuration/usage reports; successful assembly is
not proof of live JNI/menu/resource behavior. Source/Gradle caches and APKs were
preserved; user-approved cleanup removed only both apps' debug merged/stripped
native intermediates. Stop builds if free disk approaches 500 MB. TCP ADB stalled
during the first TE2 install attempt. After reconnection, the retry still stalled:
TCP acknowledged only about 5.6 MB with heavy retransmissions and minute-long
response gaps. Cancelled only the local installer client; no storage reset or
framework restart. The user subsequently uploaded/installed TE2 staging using
`adb push` and confirmed it works. This resolves TE2's installation/acceptance
gate; calculator staging acceptance remains deferred, not blocked on this transfer.
