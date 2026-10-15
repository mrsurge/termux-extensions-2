# Desktop build startup tracker

- [x] Locate original Desktop deferral and mobile compatibility behavior.
- [x] Confirm five-second Desktop hello timeout precedes bootstrap build finish.
- [x] User approved build progress/cancel and exit-driven failure semantics.
- [x] Implement early bootstrap progress, Desktop wait ordering and usable Cancel.
- [x] Targeted Python: 39 passed (progress, native bootstrap, identity/discovery).
- [x] Electron strict typecheck, 122 tests and compile passed.
- [x] Electromux source bundles and 19 shared-shell/consumer tests passed,
  including real subprocess cancellation and external ownership preservation.
- [x] New progress helper passes `ty check`; `git diff --check` passes.
- [ ] Live editable cold-build/cached/release/cancel acceptance after separately
  approved runtime/client activation.

Unrelated dependency-release edits and user files are preserved. No shared
runtime restart, APK build, release publication or commit/push in this slice.

The launcher waits for hello before health polling even with older bootstrap
versions. New progress events are optional feedback, not readiness authority.
The regression explicitly keeps Start unresolved while clicking Cancel, and
checks that a nonzero build-process exit retains its status without health probes.
