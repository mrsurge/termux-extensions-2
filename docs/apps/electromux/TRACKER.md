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
- [ ] Approve concrete independent repo location and prototype implementation.

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
