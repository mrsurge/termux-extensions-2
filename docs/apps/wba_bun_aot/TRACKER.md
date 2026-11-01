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
- [ ] Commit/push feature/0.2.357-wba-bun-aot; exclude local shellspec path,
  user scratch reports/config/APKs/root SKILL.md and all binaries/caches.
- [ ] Clone branch into ~/te2-android/termux-extensions-2 and provision only
  project-scoped npm/Python dependencies as necessary.
- [ ] AOT control rejects an invalid type; valid minimal AOT runs on device.
- [ ] Strict gates/focused tests and native WBA build with embedded assets.
- [ ] Isolated executable startup, pipe ping, browser assets, native Bun
  Socket.IO binary ping and clean EOF; retain failures and artifact hashes.
- [ ] Report Android artifact size/linkage and exact next activation gate.
- [ ] User live Android code-server/exthost/theme/webview acceptance, if adopted.

No APK packaging, mypyc/Rust rebuild, release or runtime replacement implied.
