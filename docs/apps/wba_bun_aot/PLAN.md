# WBA Bun native-AOT PoC

Branch: feature/0.2.357-wba-bun-aot. Experimental, not a deployment cutover.

1. Checkpoint accepted Linux WBA codec, optional Bun engine and webview fixes.
   Preserve the local absolute shellspec override uncommitted; repository launch
   remains the portable Node command. No version bump or release publication.
2. Clone the branch into Pixel ~/te2-android/termux-extensions-2. Keep outputs,
   dependency tools, logs and state visible under ~/te2-android/wba-aot-poc.
   Use ~/bun-binary/bun, not bun-profile; do not replace global tools/runtime.
3. Verify actual AOT type enforcement with a small control, then check/build
   the current typed WBA with the same shipped-asset recipe used on Linux.
   Native Android/aarch64 is a distinct target; never substitute a glibc binary
   or ordinary JIT executable and label it native AOT.
4. Run typed frontend/WBA gates, focused Node/Bun regressions, then isolated
   compiled startup, pipe, HTTP/assets, Bun-engine binary Socket.IO and EOF.
   Retain toolchain revision, source commit, build logs, ELF dependencies,
   executable bytes/hash and failures. Full code-server/LSP integration and
   runtime activation remain separate user gates; no APK build is authorized.

Recipe: `bash scripts/build_wba_aot.sh /path/to/bun /visible/output-directory`.
Probe: `node scripts/probe_wba_aot.mjs /path/to/wba-aot /visible/output-directory`.
Dependencies must already be installed in the app's isolated project tree.
Only shipped fallback theme/browser runtime assets are embedded; installed
extensions/themes remain external. Native msgpackr extraction is optional.
