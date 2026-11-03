# 0.2.357 tracker

## First priority: second editor area — 2026-11-02

This takes precedence over the older intake below. Concrete design, source
findings and validation scope: PLAN.md, "First priority: second editor area".

- [x] User approves read-only investigation and planning only. Record independent
  group membership, shared cross-client tab sets, client-specific foreground,
  desktop browser support and secondary extension-panel hosting requirements.
- [x] Confirm desktop mismatch: secondary host/vertical handle span terminal
  row; terminal/horizontal handle span only primary column. Electron overlay
  consumes measured host bounds with zoom.
- [x] Confirm one shared document membership today, with separate client
  foregrounds; secondary historical descriptor is not a persisted tab set.
  Plan editor-group ownership, not cloned document/draft/WBA state machines.
- [x] Confirm ordinary desktop browser exclusion is an explicit mobile/layout
  gate. Monaco already mounts inline; outer page isolation cannot be removed
  safely without addressing non-disposable working-editor providers.
- [x] Identify extension panel/view distinction and surface/presentation identity
  as rehosting boundaries. Keep native Electron overlays and webview isolation.
- [x] S1 approved and implemented (2026-11-03): secondary host and vertical
  divider stop at grid line 4; terminal and horizontal handle span columns 2/3.
  Keep desktop horizontal hitbox inside terminal row so the native secondary
  WebContentsView cannot cover it. Mobile geometry and side rails unchanged.
  Existing host ResizeObserver/native placement path follows the new rectangle;
  no JS/backend/state changes or native rebuild. Regression demonstrated failing
  old spans before the fix. Fourteen focused layout/terminal/lifecycle tests pass;
  frontend and WBA strict no-Any typechecks report zero findings/diagnostics;
  node build.mjs and git diff --check pass. Existing Node module-type warning
  remains visible; no source suppression. Generated tracked bundles unchanged.
- [x] User live acceptance: "Its fixed" (2026-11-03). Desktop layout accepted;
  no separate exhaustive mode/zoom matrix is claimed by this confirmation.
- [ ] S2 approve typed backend group contract/migration and lifetime semantics;
  implement primary/secondary membership with existing client foregrounds.
- [ ] S2 secondary tab bar and direct Explorer-to-secondary open; close one
  group's tab without closing the other group's document. Validate model
  ownership union, draft/save consent, revisions and multi-client races.
- [ ] S3 ordinary desktop browser host and shared presentation behavior;
  separately qualify any iframe-removal/provider-disposal refactor. Browser
  storage is not authoritative opened-file state.
- [ ] S4 extension-created secondary panels as tabs and sidebar transfer;
  preserve surface identity, live state, messages, readiness, focus/visibility,
  retained contexts, disposal, native reparenting and project/WBA generation.
- [ ] Later-slice strict type/build/tests and grouped live acceptance on
  Electron/desktop browser/mobile, multi-client foreground, close/open,
  project switch/cold restore/reconnect and historical/extension content.

Initial intake was planning-only; S1 source/build scope was subsequently
approved above. No asset publication, shared restart, APK update or new live
acceptance is claimed. Remaining state/browser/extension slices need approval.

## First priorities — user intake 2026-10-31

These precede all older work below. Keep room for further user priorities.

### 1. WBA experimental native AOT

- [x] Read root SKILL.md completely and inspect WBA build/entrypoint. Current
  local Bun 1.3.14 has no advertised AOT compiler; ordinary --compile is not AOT.
- [x] User approves a separately pinned VPS toolchain and isolated trial; no
  global upgrade, production launch replacement, runtime restart or APK build.
- [x] Verify compatible toolchain/version and attempt true native AOT with
  retained diagnostics; audit runtime-relative imports and required assets.
- [x] Check executable behavior/relocation and source/JIT controls where feasible;
  report compatibility failures honestly, without broad casts or exclusions.
- [x] Measure qualified candidates in isolated matched trials (receipts below).
  Platform adoption and live runtime acceptance remain separate.

Initial trial evidence (VPS /mnt/vdb/te2-wba-aot-20261031; frozen source
920322c2; no production edits/activation):

- Official stable Bun 1.4.4+38afee6c8 matches its published download checksum,
  but lacks `bun compile`; `build --compile --aot` accepts an invalid TS type
  assignment and emits an ordinary bundle. Do not label that artifact native AOT.
- Official canary 1.4.4-canary.1+da867c60b exposes the actual compiler. Download
  metadata/asset ID and SHA256 are retained under toolchain/canary. Root SKILL.md
  is used directly, not installed or edited. Its stable-version assumption needs
  this qualification; do not globally upgrade a working Bun installation.
- `bun check --aot src/server/server.ts`: exit 0, no type errors in 142 files.
  `bun build --compile --aot src/server/server.ts --outfile <artifacts>/wba-aot`:
  exit 0, 83,291,112 bytes; compiler reports 452 ms bundling / 5.317 s compilation,
  build ID 67b0e215cf867279d67319cfa0438ab0. This is build output, not benchmarking.
- Warnings: interpreted dynamic regular expressions, optional supports-color
  resolution, and debug-only Buffer.concat built-in mutation. Do not suppress
  diagnostics or claim all dependency execution is native.
- Unchanged generated dist under the same canary passes structured startup,
  MessagePack te2.ping, HTTP health, browser codec and Socket.IO client assets,
  and clean EOF. Raw TS also starts/pings but its browser codec .mjs URL fails
  because it is a generated dist asset. No live code-server/exthost connection
  was attempted; these are isolated process/asset smoke checks only.
- Relocated AOT exits before startup: missing
  /monaco_editor/themes/vendored/github/dark-default.json. JIT executable
  (141,163,176 bytes) exits on runtime-relative vendor/picomatch import. Actual
  serialized WBA pipe values are concatenated MessagePack, not length-prefixed;
  the first probe's framing assumption was corrected in smoke-results-v2.json.
- [x] Next approval: minimal manifest/asset and dependency-resolution packaging
  strategy for compiled WBA; retain the normal dist launch as the control and
  preserve browser-served resources. No runtime source changes made in this trial.

Packaging follow-up (2026-11-01):

- [x] User approves isolated embedded-assets/build-root recipe and relocation
  checks, without production source or launcher edits. Follow root SKILL.md's
  AOT/JIT distinction and retain pinned canary da867c60b; no global tool changes.
- [x] Explicit app-level --root plus --asset inputs fix the AOT theme/resource
  layout. Inputs: shipped dark-default.json, generated messagepack-codec.mjs,
  vendor/picomatch and vendor/node_socketio/node_modules. Stage an identical copy
  of the generated codec under src/protocol solely in the disposable build
  checkout because the TS entrypoint's browser resource URL resolves there.
  Do not edit generated JS or embed installed user themes/extensions/workspaces.
- [x] AOT v3 compiles successfully: 85,777,384 bytes (about 81.8 MiB), SHA256
  57d08b1d33e2dd26da44b5f5eb0ad5993075b1738852e6876cbc038c7c262762,
  build ID 5e5135698642b45e27db8fd71df62e2c. Compiler reports 936 ms bundling /
  9.43 s compilation (shell elapsed 10.417 s); not a controlled performance study.
- [x] Copy executable to a separate artifact directory and temporarily hide
  only the owned disposable source checkout; restore it through an EXIT trap.
  AOT still passes startup, concatenated-MessagePack pipe ping, real Socket.IO
  WebSocket binary ping, HTTP health, both browser runtime assets and clean EOF.
  Served codec/client SHA256 match generated-dist control bytes. No source-tree
  fallback is needed for those checks; unrelated dependency trees were not hidden.
- [x] Preserve honest JIT controls: v2 still fails on runtime-relative picomatch;
  v3 additionally rejects duplicate codec basenames during embedding. No passing
  JIT-standalone baseline or AOT throughput/memory advantage is claimed. Ordinary
  generated-dist control under the same Bun passes the checked protocol/assets.
- [ ] Full isolated code-server/exthost integration, installed-theme switching,
  extension/webview behavior, debug-flag behavior and representative load tests
  before adoption. Current smoke checks do not connect to a real code-server.
- [ ] Approve any needed JIT/source compatibility or production packaging changes
  separately; existing runtime launch remains untouched. No APK/OTA, Rust/mypyc
  rebuild, shared restart, version bump, commit or push in this packaging trial.

Receipts on VPS: /mnt/vdb/te2-wba-aot-20261031/embedded-20261101-v3 and
relocated-20261101 (smoke-results-v2.json, build logs, hashes and executable).
Recipe: wba-embedded-assets-v3.sh; relocation driver: wba-isolate-executable.sh.
The initial embedded-20261101 attempt found /usr/bin/time absent; retained its
exit-127 logs, then used Bash time in v2/v3 without installing system packages.

#### Live AOT trial and webview binary protocol correction — 2026-11-01

- [x] User reports ordinary/UI extensions working well and fast with the AOT
  candidate; Codex stalls/reloads at intro. Current FWS WBA PID 1072812 is the
  AOT executable; no agent restart. This is user live integration evidence,
  not full extension compatibility or a controlled speed/memory comparison.
- [x] Trace Codex's `unknown special value: ["bytes",{}]` to our wrapper codec:
  VS Code sends Uint8Array type ID 2; constructor-name lookup returns ArrayBuffer.
  Reproduce the exact diagnostic in ordinary Node from actual wrapper source;
  confirm pre-AOT source has the same mismatch. Do not attribute it to AOT or
  claim readiness/reload symptoms fully explained before live retest.
- [x] User approves canonical numeric typed-array IDs both directions, tests and
  replacement candidate. Preserve offsets/lengths, shared backing buffers and
  bare ArrayBuffers; retain JSON-only mode and reject invalid references.
- [x] Three new regressions exercise all 11 typed-array IDs and Codex's exact
  bytes shape. VPS focused suite: 28 pass, zero failures after supplying the
  existing validated Python venv on PATH for the cross-language test. Preserve
  the first failed test log (missing `python`), no test exclusions/suppressions.
  Full host/WBA build and strict no-Any frontend/WBA gates pass. Only generated
  webview-runtime.mjs changes; host.js remains unchanged. No OTA/APK change.
- [x] Rebuild native AOT with unchanged pinned canary/embedding recipe: build ID
  e3e989aff8d9123dba1bdd1eaad30f16; 85,756,904 bytes; SHA256
  c4f9f720b0da28ac00b1d1bab3509e8f5b966e8f0419f922353123a76ccf84a4.
  Isolated startup, pipe ping, binary Socket.IO ping, HTTP/browser asset hashes
  and EOF checks pass. VPS receipts: binary-view-fix-20261101 under trial root.
- [x] Download to ignored .codex-scratch/wba-aot-local/wba-aot-c4f9f720 and verify
  hash/executable mode; update only the temporary shellspec command. Keep old
  binary running and intact. Command uses absolute checkout path because
  ctx:REPO_ROOT resolves to the compiled mypyc domain, not the editable checkout.
  Generated WBA module imported unchanged from VPS. No runtime restart/commit/push.
- [ ] User fresh-WBA launch and Codex intro/reload/binary-message acceptance.

#### Server codec, matched benchmark, and missing Bun engine — 2026-11-01

- [x] Server-only msgpackr codec: root native-capable entry with bundled JS
  fallback; browser codec remains @msgpack/msgpack. Preserve standard maps,
  binary view bounds, undefined omission and numeric int64 behavior. Corrected
  an initial BigInt regression found by interoperability tests. Native addon
  availability is observable; native extraction is not shipped into wheels by
  this change. Four Node/Bun native/fallback configurations passed 33 tests each.
  VPS receipts: server-codec-trial-20261101-v3 under the existing AOT trial root.
- [x] User requested actual AOT versus interpreted WBA, not codecs alone.
  First matched comparison passed nine runs, but incorrectly omitted the
  required optional Bun engine. Preserve that receipt as standard-engine-only;
  do not claim it measured the intended Bun transport.
- [x] Implement @socket.io/bun-engine 0.1.2 as an optional dependency, bundled
  separately for installed runtime use and included by the AOT source graph.
  Bun selects it automatically; Node, absent module, or TE2_WBA_BUN_ENGINE=0
  use standard Engine.IO. A present but broken engine is fatal, not a silent
  fallback. Startup beacon and /health report socketEngine.
- [x] Native Bun listener shares the exact HTTP dispatcher with Node, including
  webview compression/ETags, browser resources and pipe-only method guards.
  Socket namespace, identity validation, client rooms, MessagePack and buffer
  limits remain unchanged. No extra HTTP/WebSocket proxy is introduced.
- [x] Direct-WebSocket test exposed our old UDS factory overwriting the native
  WebSocket global, so WebSocket.OPEN was undefined and the Bun engine silently
  skipped sends. Remove only that global mutation; the code-server adapter
  already constructs UdsWebSocket directly. Initial drain hypothesis was wrong;
  discard its workaround. Add regression for preservation of native WebSocket.
- [x] Full frontend build and both strict no-Any typechecks pass. Node/Bun tests
  cover actual native engine, disabled/missing fallback, HTTP/resource codec,
  binary RPC, rejected identity, reconnect, clean EOF and compression/ETags.
  Final suite: Node 41 pass / one Bun-only skip; Bun 42 pass. A broken installed
  module must fail startup; Node must never import it. Preserve failed
  harness/diagnostic attempts; no test suppression added.
- [x] Rebuild true native AOT with pinned canary da867c60b and embedded assets.
  Compare AOT-native/AOT-standard/Bun-TS-native/Bun-TS-standard/Node-dist,
  three fresh processes each with rotating order and identical msgpackr JS
  fallback. All 15 complete with expected engine telemetry and clean exit.
  AOT-native median startup beacon 15.7 ms, initial RSS 34,852 KiB, post-load
  RSS 47,236 KiB; Bun-native 77.4 ms / 52,196 / 76,520 KiB; Node-dist
  125.5 ms / 77,388 / 101,372 KiB. Socket RPC/s medians: 3,159 / 3,369 /
  3,165 respectively. Native versus standard is mixed (AOT-standard 3,395,
  Bun-standard 3,113), not a proven universal network speedup.
  These are short localhost Python-client/ping tests without code-server/LSP,
  not disk-cache-cold startup or sustained production capacity. Separate codec
  AOT measurements also show slower small diagnostics despite large-data wins.
- [x] User acceptance of a newly selected WBA containing both codec and Bun
  engine changes. User approved selecting 032ea097 in the temporary shellspec;
  executable mode and SHA256 verified. No worker/framework restart performed.
  No mypyc/Rust/frontend OTA/APK change
  is required for this server-only WBA integration. User reports works and fast;
  checkpoint/Pixel PoC now tracked in docs/apps/wba_bun_aot/TRACKER.md.
- [x] Pixel Termux native compile and isolated protocol test with user's
  ~/bun-binary pass. Source checkpoint be6d7a5c on feature/0.2.357-wba-bun-aot;
  visible ~/te2-android workspace. Full receipts and pending live activation:
  docs/apps/wba_bun_aot/TRACKER.md. No installed runtime replacement or APK build.

Receipts: /mnt/vdb/te2-wba-aot-20261031/bun-engine-trial-20261101
(logs/, artifacts/wba-aot, comparison/{summary,runtime-results}.json).
Build/test driver: qualify-bun-engine.sh; comparison: benchmark-wba-modes.py.
Isolated npm dependencies live in that trial's deps/, not the shared build tree.
Final source rebuild and 15-run confirmation: comparison-final/, with startup
engine assertions; all pass. Final AOT: 86,739,944 bytes, SHA256
032ea0972125ada08ad277b32827e1408ad6bbcb005129aea3dcd237a1d2b16e.
Copied and checksum-verified locally as ignored
.codex-scratch/wba-aot-local/wba-aot-bun-engine-032ea097; subsequently selected
in the shellspec at the user's request, without launching/restarting it.
Final Socket.IO medians remain close: AOT-native 3,108 RPC/s versus standard
3,078; Bun-native 3,154 versus standard 3,255. Do not claim a universal engine win
from short Python-driven ping trials. Running-process replacement remains user-owned.

### 2. Main interface and app-shell favicon

- [x] Initial source audit: index.html and app_shell.html have manifest and
  apple-touch-icon links but no explicit standard favicon declaration.
- [ ] Complete route/icon metadata audit and approve implementation.
- [ ] Reuse launcher/app metadata icons with safe URLs and a TE2 fallback;
  validate browser requests and bundled/OTA client routing.

### 3. Client settings bookmark creation

- [x] Initial audit: Electron copies desktop_client/android_shell; its bookmark
  creator is in a separate section with a permanent name input.
- [ ] Audit all client/native settings and existing generic text-entry dialogs.
- [ ] Approve/implement creation button below host/port/Connect with name entry
  through the shared generic text dialog; retain saved bookmarks and host APIs.
- [ ] Validate narrow/wide layout, save/cancel/validation errors and all clients;
  separately approve Android assets/builds and collect live acceptance.

## Fail-closed built-in asset routing

- [x] User defers broader hardening from .356 on 2026-10-27; the exact codex-ext
  alias fix stays in .356. Not a current-release blocker.
- [ ] Audit client routing and define manifest-backed local-only asset ownership
  versus dynamic/backend routes, including redirected ESM/local asset origins.
- [ ] Approve and implement fail-closed missing/unmapped built-in assets across
  Gecko, Cefrium, TE2 Termux and Electron without breaking genuine proxy traffic.
- [ ] Test real URL mappings, missing files and wrong aliases; assert zero upstream
  fetches on asset failures and continued proxying of dynamic APIs/sockets.
- [ ] Obtain client runtime acceptance; no implementation approved by scheduling.

## Code TE2 pipe concurrency — O2 continuation

- [x] Record user-requested deferral from .356 on 2026-10-26; preserve completed
  boundary optimizations and user-reported sub-second 6,000+ file search acceptance.
- [ ] Establish an actual workload/queue-pressure or responsiveness need before
  resuming; not an automatic next task or a .356 release blocker.
- [ ] Audit reusable framework scheduler process/thread/queue machinery and
  Code TE2 Python intake/handler ownership; distinguish transport from processing.
- [ ] Approve a bounded design with ordering, cancellation and memory limits.
- [ ] Implement only if justified, compare end-to-end responsiveness and obtain
  live acceptance. No transport replacement or multiprocessing adoption implied.

## Shared-library continuation

- [x] Record user-requested deferral from .356; preserve PoC source and results.
- [x] Isolated Linux stripped cdylib comparison and boundary/loader checks
  completed under .356; see framework/shared_runtime_probe/README.md and
  ../release_0_2_356/TRACKER.md for evidence and limitations.
- [ ] Approve concrete production API/consumer scope.
- [ ] Qualify ABI, toolchain/dependency alignment and platform loader policy.
- [ ] Implement approved manifest/fingerprint/packaging integration.
- [ ] Measure actual total artifact savings and rebuild behavior.
- [ ] Validate Linux and Termux artifacts and obtain live acceptance.

No production integration or release approval is implied by this backlog.
