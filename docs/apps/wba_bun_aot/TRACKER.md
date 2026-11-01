# WBA native AOT tracker

- [x] User live-accepts latest Linux binary with server msgpackr and optional
  Bun engine: works and is fast. No universal throughput claim inferred.
- [x] Linux source/build and strict frontend/WBA no-Any gates pass. Focused
  suite: Node 41 pass + one Bun-only skip; Bun 42 pass. Fifteen matched engine
  trials pass. Detailed receipts/limits: release_0_2_357/TRACKER.md.
- [x] User approves new branch/checkpoint/push and visible Pixel clone/build,
  isolated dependencies, no global package changes or installed-runtime switch.
- [x] Pixel inspection: ~/te2-android empty, ~179 GiB available; Bun
  1.4.4-canary.1+cee9dd927 exposes actual AOT flags; Node 24.22.1,
  Python 3.14.8, Android Clang 21.1.8, aarch64. SSH alias supplied by user:
  u0_a346@pixel-9-pro-xl:11234 (actual HOME is Termux home).
- [x] Commit/push feature/0.2.357-wba-bun-aot at be6d7a5c; exclude local shellspec path,
  user scratch reports/config/APKs/root SKILL.md and all binaries/caches.
- [x] Clone branch into ~/te2-android/termux-extensions-2 and provision only
  project-scoped npm/Python dependencies as necessary.
- [x] AOT control rejects an invalid type; valid minimal AOT runs on device.
- [x] Strict gates/focused tests and native WBA build with embedded assets.
- [x] Isolated executable startup, pipe ping, browser assets, native Bun
  Socket.IO binary ping and clean EOF; retain failures and artifact hashes.
- [x] Report Android artifact size/linkage and exact next activation gate.
- [ ] User live Android code-server/exthost/theme/webview acceptance, if adopted.

No APK packaging, mypyc/Rust rebuild, release or runtime replacement implied.

## Pixel receipts — 2026-11-01

Visible output root: ~/te2-android/wba-aot-poc. Source inputs be6d7a5c,
Bun 1.4.4-canary.1+cee9dd927, host-native Android/aarch64. Normal (non-profile)
Bun used. No global package installation, framework/worker restart or activation.
Project npm dependencies installed with npm ci --ignore-scripts; cache is under
tools/npm-cache, TMPDIR under tmp. Existing Python modules used for interop tests.

- Invalid control: TS2322, nonzero exit. Valid native control builds and prints
  42 on-device. No JIT substitute or --aot-allow-code-from-disk escape hatch.
- Full frontend build passes; both owned frontend/WBA no-Any typechecks pass.
  AOT check: no type errors in 163 files. Build reports 2.078 s bundle /
  20.772 s compile; this is not a controlled performance benchmark.
- AOT build ID 4402fdb2e2df85a24bc5e20a41fbe8a0. Artifact:
  ~/te2-android/wba-aot-poc/artifacts/wba-aot, 150,752,392 bytes (143.8 MiB).
  gzip -9 stream: 72,722,188 bytes (69.4 MiB); no strip/trim experiment applied.
  SHA256 d3233ab50a16abac1de7d02d8c7c24fd014798ab0133748465dd2cb79bfb375b.
- ELF64 AArch64 PIE, NEEDED only libc.so, libm.so, libdl.so; no extra Termux
  libpython/libnode/libc++ shared-library edge. This qualifies this Pixel/Termux
  environment, not every Android API level or APK integration.
- Isolated probe from state/probe-Td0qsw passes startup, native Bun engine
  telemetry, standard MessagePack pipe ping, HTTP health, embedded browser
  codec/client assets, real binary Socket.IO RPC and EOF exit 0. Native msgpackr
  extraction unavailable; bundled JS fallback works. No real code-server/LSP.
- Node suite: 41 pass + one Bun-only skip. Initial Bun suite: 41 pass / one
  simulated webview-resume fixture failure, reproduced alone. Its 100 zero-delay
  ticks expired in 40–80 ms before filesystem-backed reconstruction settled.
  Test-only wall-clock deadline fixes the wait without relaxing assertions or
  changing runtime code. Final full suite: Node 41 pass + one skip, Bun 42 pass;
  local Linux Node webview suite also 15/15 pass. Original failed logs retained.
- Logs under logs/: bun-revision.txt, source-commit.txt, build.log, typecheck.log,
  aot-check.log, aot-build.log, invalid-control.log, valid-control-build.log,
  node-tests-final.log, bun-tests-final.log, elf-header.txt, elf-dynamic.txt,
  artifact.sha256. Probe JSON remains in state/probe-Td0qsw/result.json.
- Next gate: explicitly select this binary for a disposable or user-approved
  Pixel WBA and test real intelligence/extensions/themes/webviews. Do not
  silently replace the installed worker or the live desktop AOT selection.
