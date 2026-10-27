# Electromux parity and VPS release procedure

User-approved staging/investigation, 2026-10-27. No production build, install,
runtime restart, version change, TE2-main merge, tag, push or publication is
authorized by this staging slice. Source is authoritative; this does not reopen
deferred optimizations in PLAN.md or discard user notes in TRACKER.md.

## Source and work roots

- Initial TE2 source: `d36faac4`, branch maintenance/0.2.356-startup-recovery.
  Metadata still says 0.2.355; freeze coherent 0.2.356 metadata later, not now.
- TE2 Electromux pin: `2976c4f9b80655d4783eee43cf9b8c978fe55e97`.
- Standalone `/home/mrsurge/knowhere/electromux` main was clean at `9922abf` and
  has been fast-forwarded to that existing pin. No downgrade, new commit, push
  or TE2 gitlink change. Develop generic behavior there, then explicitly update
  TE2's pinned consumer; never import a neighboring checkout at build/runtime.
- Debian: `mrsurge@100.74.145.70`; isolated root
  `/mnt/vdb/te2-release-0.2.356/{sources,toolchains,caches,artifacts,logs,acceptance,tmp,receipts}`.
  Initial mount availability: 233 GiB. Preserve existing home checkouts, all
  `.codex` directories, `/home/mrsurge/geckotron`, the active framework and
  `/home/mrsurge/joint-stable-0.2.354-als-0.2.139`.
- Pixel acceptance target: `pixel-9-pro-xl:5555`, ARM64, about 198 GiB free in
  /data at inspection. Installed Termux, Gecko and TE2 Termux are present.
  No install, app-data clear, uninstall or framework restart implied.

All compilation, bundling and packaging runs on the VPS. Device execution is
acceptance only. Do not silently move Android wheel compilation to the Pixel.

## Immediate blocker: ALS approval assets

User cannot reliably see approval prompts in Gecko; include this gate before
parity implementation or release candidate acceptance. Do not claim the asset
finding alone proves every missing-prompt symptom.

- ALS's core approvals UI is compiled into static/dist/codex_agent.js, but the
  Codex manifest additionally declares the dynamically imported module
  `ui/request_cards/codex_ext_request_card.js` under extensions/codex_ext.
- Its actual proxied request URL is
  `/api/app/als-rs/proxy/api/extensions/codex/assets/ui/request_cards/codex_ext_request_card.js`.
  Before this fix, TE2 vendoring inventoried only ALS's Rust static tree and asset
  interceptors only aliased its `/static/` tree. The request-card file was missing
  from the local snapshot and was not intercepted. The module renders
  command/file approvals, item/tool/requestUserInput, agent-pty/ask-user, tool
  calls and MCP elicitation.
- The installed Pixel Gecko APK has an older 149-resource ALS seed and lacks the
  module. It has not been replaced. The regenerated VPS seed has 447 files
  (43 MiB), with all 151 ALS resource hashes verified and no source maps.
- User-approved fix implemented: vendor this declared module with exact source/hash
  provenance; map only its immutable asset URL to the local snapshot, not the
  entire `/api/extensions/` tree. Keep schemas, configuration, approvals RPC,
  authentication and conversation state backend-owned and uncached.
- Cover Gecko's WebExtension, shared native asset alias/server, Cefrium/Termux,
  Electron mappings, OTA required-file validation and final APK entry hashes.
  Source .map files remain excluded. Approval rendering/sending must be verified
  on the Pixel, including multiple questions, cancel/reopen and page reload.
- Validation passes: four Node asset/alias tests, five Python vendor/provenance
  tests, six Gecko JVM alias/required-file tests, and strict mypy plus disallow-any
  checks for the two changed Python files. This is not a whole-tree typing claim.
- Source routing/vendor/test edits and VPS seed generation are approved and done.
  APK assembly/install and final APK hash/device checks remain a later gate.
  OTA alone cannot add the new native/WebExtension interception rule to an old APK.

VPS staging receipts distinguish the clean source baseline from the approved
uncommitted overlay. Baseline verification covers 6,538 TE2 tracked blobs and
136 Electromux blobs in both copies. Node 24, JDK 25, Android SDK/NDK and the
hash-matched pinned Node SDK are staged; validation Python 3.14 and jq are isolated.
About 227 GiB remained on /mnt/vdb after seed/JVM validation. No production APK,
wheel, installation, runtime restart or publication was performed by this slice.

## Current Electron surface matrix

This is a source-backed family/method inventory, not equal feature counts or a
claim of Electron compatibility. TE2 Termux's native functionality must not be
mistaken for use of the calculator's compatibility facade.

| Desktop family | Electromux current implementation | TE2 Termux current lane / gap |
| --- | --- | --- |
| app | limited lifecycle/metadata, whenReady, quit; relaunch throws | consumer/service-owned lifecycle, not shared Electron entry |
| BrowserWindow | one main window, loadURL/loadFile/close, focus/all lookup | Cefrium main/auxiliary surfaces managed by TE2 adapters; no generic multi-window parity |
| WebContentsView | no exported compatible family | native chrome attachment/embedded views, not this API |
| Menu | template/application menu and native acknowledgement | consumer's custom toolbar/actions; calculator exercises actual generic menu facade |
| screen | no compatible export | Android metrics/viewport adapters; no desktop display/work-area contract |
| session | no compatible export | native browser contexts, relay/assets and permissions, not Electron Session API |
| protocol | no compatible export | native loopback asset routing, not protocol.handle/register contract |
| webFrameMain | no compatible export | renderer/document fences; no compatible frame traversal API |
| ipcMain | no compatible export | ConsumerHost dispatch, native page methods and private FD transport |
| ipcRenderer | no compatible export | ElectromuxBridge request/on/dispose plus TE2 platform adapter |
| contextBridge | no compatible export | native query injection/exact-document gate; do not claim Electron isolated-world semantics |

Electromux also exposes limited nativeTheme, which is not one of the desktop
client's current 11 runtime imports. MainWindow.webContents provides basic
back/forward/reload. Unsupported APIs/options must fail explicitly, not silently
report success or weaken navigation/document/method authorization.

Source anchors: desktop_client/electron/src/preload/*.ts and main/index.ts;
vendor/electromux/runtime/src/electron-{main,compat,manifest}.ts;
android/termux/src/main/java/com/termux/extensions/{TermuxChromeSurface,TermuxLocalFrameworkRegistration}.kt;
desktop_client/android_shell/electromux-{bootstrap,platform}.js;
desktop_client/electromux/{embedded-entry,local-framework-consumer}.ts.

## Proposed first API implementation gate

After asset repair, investigate a shared, typed request/reply and disposable
event subscription subset with Electron-shaped ipcRenderer/ipcMain contracts.
Reuse existing correlated frames, declared methods/events, exact document
authorization and native service ownership. TE2 supplies channel/application
policy; generic Electromux must contain no TE2 routes, names or framework code.

Do not implement contextBridge as a page-global assignment and call that isolated
world compatibility. Qualify actual Cefrium world/preload support before adding
that contract. Do not switch TE2 to the calculator's main-only window lane,
remove the existing launch/readiness gates, change WBA/FWS transport, or add a
new supervisor as a shortcut. Present concrete API signatures, caller/receiver
mapping, unavailable capabilities and tests before production edits.

Use the real calculator as an independent compatibility regression and TE2
Termux as the lifecycle/integration regression. Host tests are not device
acceptance. Preserve install/start/cancel/stop, remote switching, bookmarks,
asset updates, notification flow, scaling/resume, second editor and sidebar
behavior; no unsupported detached-window equivalence claim.

## VPS setup and build gates

1. Stage exact clean-commit source archives plus the pinned Electromux tree.
   Verify Git blob/mode identities and record source SHA; do not copy user
   untracked reports, local caches or secrets into source snapshots. Overlay
   subsequently approved patches with explicit receipt updates. Final packaging
   must use a clean frozen source/tag receipt, not this mutable staging tree.
2. Reuse copies of the existing Node 24, JDK25, Android SDK37/NDK28 and pinned
   nodejs-mobile SDK under /mnt/vdb. Record/verify identities and libnode hash.
   New Gradle, npm, uv, Cargo, temp and output roots belong on /mnt/vdb.
   The default VPS Node20/JDK21/Python3.13 are not the Android/private-Python
   release toolchain. Gecko's separate AGP8/JDK17-compatible lane stays separate
   from Cefrium/Termux's AGP9/JDK25 build.
3. Existing Docker root is /var/lib/docker on the nearly full root filesystem.
   Reuse existing builder images where valid; bind compilation outputs and caches
   onto /mnt/vdb. Provision isolated Docker storage there if new layers/images
   are needed; do not relocate/restart the daemon hosting Redroid or prune it.
   Preserve the pinned manylinux/private CPython3.14 recipe and ELF validation.
4. Before full Android wheel work, prove VPS-only Bionic ARM64 Rust + CPython3.14/
   mypyc cross-build/import suitability. NDK target support alone does not prove
   Python ABI/sysconfig/native dependency correctness. Any fallback needs a user
   decision; current scope does not authorize Pixel compilation.
5. After approval, regenerate all frontend/WBA/ALS seeds, run strict/no-Any gates,
   then separate Gradle unit/staging lanes. ARM64 APKs retain intended signing
   identities, native compression and R8 rules. Validate manifest, signature,
   native libraries, complete asset inventory/hash/routes, and embedded Node
   entrypoint before grouped Pixel install/live acceptance.
6. Freeze coherent versions/source identity and checkpoints, then produce Linux
   and Android wheels in isolated roots. Validate <100,000,000 bytes per wheel,
   runtime ABI/dependency closure and independent venv/device acceptance. Do not
   infer Android acceptance from a Linux cross-link result or Linux venv.
7. Ask for final release authorization after grouped acceptance. Merge/tag/push,
   GitHub assets and PyPI uploads are explicit later gates; do not reuse .355
   version numbers for changed public artifacts. README release/version/known-
   issue wording and exact dependency minimums must match the final candidate.

Build jobs and memory limits must account for other VPS workloads; serialize
resource-heavy builds. Monitor both /mnt/vdb and root free space. Do not remove
existing build trees or accepted installations as routine staging cleanup.
