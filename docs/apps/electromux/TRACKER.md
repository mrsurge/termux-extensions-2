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
