# 0.2.355 corrective release tracker

Updated 2026-10-19. PLAN.md owns execution order and protected paths. Historical
acceptance and user notes remain in ../release_0_2_354/TRACKER.md unchanged.

## Accepted source slices

- [x] Electron New Project/floating-picker fix: user live acceptance; focused
  regressions, real isolated Electron handoff cycles, TS checks/builds pass.
- [x] TE2 Termux accessibility scaling: user accepts Chromium Android
  HostZoomMap path; rejected CSS and Cefrium wrapper trials are not release inputs.
- [x] Retain Cefrium 0.9.0: newer library exceeds the user's no-growth policy.
- [x] Identify required framework version rebuild; editor-worker/mypyc reuse
  remains conditional on source/ABI/receipt validation.

## Execution gates

- [x] Record corrective release scope and deferred cleanup exclusions.
- [x] Concrete version/checkpoint/remote build approval: user approves .355
  alignment, commit/push and Debian/Pixel builds; stop for grouped acceptance.
- [ ] Align .355 package/framework/Electron/APK identities and source checkpoint.
- [ ] Verify remote source/toolchain/cache state and available storage.
- [ ] Linux wheel built, under decimal 100 MB, private Python and receipts valid.
- [ ] Android wheel built, under decimal 100 MB, native receipts valid.
- [ ] Fresh joint TE2/ALS/FWS install and runtime checks on both platforms.
- [ ] User wheel acceptance group.
- [ ] Current shared seed published and all three staging APKs audited.
- [ ] User APK acceptance group.
- [ ] Final clean-source/tag provenance and exact final artifacts revalidated.
- [ ] Release approval, PyPI publication and digest verification.
- [ ] Existing draft transitioned to .355 with final APK/template/installers and
  checksum inventory; GitHub publication only after explicit release approval.
- [ ] Post-publication Debian cleanup inventory/dry run, protected/live exclusions
  verified, obsolete copies removed and recovered space recorded.

## Baseline / constraints

Debian read-only inspection: approximately 109 GiB free. Pixel USB serial
48011FDAS00817; SSH reachable, repo ~/mrselect6, approximately 6.6 GiB free.
These are observations, not reserved space; recheck before heavy work.

Published .354 wheels and ALS .139/FWS .65 stay immutable. GitHub .354 is still
draft. No .355 artifact, tag, publication or cleanup has occurred at tracker creation.

Existing broad test:dialogs source-gate has an unrelated false-positive failure
(28/29 pass); do not claim the broad gate green or suppress it. Focused accepted
dialog regressions and actual Electron handoff checks pass; predecessor tracker
retains details. Unrelated research_handoff.md and ty.toml remain unstaged.

Pre-checkpoint verification: Code TE2 and Electron strict TS checks/builds pass;
16 focused dialog tests pass, real Electron picker completes three handoffs,
chrome protocol and 42 scale/layout samples pass. An initial test invocation
incorrectly requested an uninstalled tsx loader; the actual plain-node MJS tests
then pass. Shared seed refreshed to .355: 445 files, approximately 43 MiB.
Authored-source whitespace checks pass (generated host bundle excluded).
