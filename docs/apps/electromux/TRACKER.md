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
