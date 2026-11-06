# 0.2.357 tracker

## Git push upstream projection refresh — 2026-11-05

- [x] Replace frontend-triggered post-push refresh with a worker-lifetime pipe
  completion bridge and existing backend GitSnapshotChanged publication. Success
  invalidates the original repository cache; active matching generations refresh
  even without Explorer clients. Stale results cannot retarget a new project.
  Pull/clone behavior and dirty-submodule decorations remain unchanged.
- [x] 13 Python tests (real pipe ingress, no Explorer connection, project/generation
  fencing, nested workspace routing, shutdown and fresh dirty-submodule snapshot
  publication), 7 focused frontend tests, strict Python extra/no-Any checks,
  frontend/WBA no-Any gates and frontend build pass.
- [ ] Live upstream-projection acceptance after Python worker and frontend refresh.
  The changed runtime/listener modules are lazy interpreted imports, absent from
  the inspected active compiled inventory; no new mypyc build or Rust rebuild is
  required. User confirms the push succeeds after correcting ALS origin to HTTPS;
  automatic upstream/decorations refresh is not separately confirmed. External
  shell pushes remain watcher/manual-refresh territory, not these notifications.

## First priority: second editor area — 2026-11-02

This takes precedence over the older intake below. Concrete design, source
findings and validation scope: PLAN.md, "First priority: second editor area".

- [x] Initial investigation/planning recorded. User's 2026-11-04 clarification
  supersedes shared cross-client primary/secondary tab groups: one backend shared
  opened-document set, per-client area placement/order/foreground, unknown
  placement defaulting to primary. No duplicate tab within either area.
- [x] Confirm desktop mismatch: secondary host/vertical handle span terminal
  row; terminal/horizontal handle span only primary column. Electron overlay
  consumes measured host bounds with zoom.
- [x] Confirm one shared document membership today, with separate client
  foregrounds; secondary historical descriptor is not a persisted tab set.
  Reuse document authority and client presentation state, not cloned
  document/draft/WBA state machines.
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
- [x] Record close contract: remove one of two local presentations locally;
  closing the last local presentation requests global document closure across
  all clients, regardless of other-client placement/counts. Disconnect never
  closes documents. Derive 0/1/2 from explicit placement flags, not client totals.
- [x] Record unified desktop/mobile behavior: shared File menu targets the
  last-focused editor area; no redundant secondary hamburger. Extension panels
  need no editor File menu; disable inapplicable editor actions for panel tabs.
- [x] Record terminal-drawer focus/extra-key pattern reuse and mobile regression:
  extra-key ownership sticks to secondary after focus returns to primary.
  Outer working-editor iframe removal is an explicit lifecycle prerequisite
  for unified same-DOM menu/focus integration, not an assumed tab-bar side effect.
- [ ] S2 approve typed shared-document/per-client-placement contract, migration
  and validated backend close semantics; implement through existing state owners.
- [x] S2a foundation approved/implemented (2026-11-04), **not live cut over**:
  editor_open_state.py supplies immutable typed shared document membership and
  per-logical-client ordered primary/secondary placements, revision-fenced close
  transitions and validated JSON persistence. Duplicate tabs within an area are
  idempotent; direct secondary admission defaults other clients to primary;
  reconnect retains known placement. One-of-two close is local; last-local close
  removes all clients' presentations even when another client has two. Disconnect
  is not a mutation. Capacity rejects new clients without evicting existing ones.
- [x] ProjectSidecar read/set helpers add a dormant editor_open_state field.
  Lazy migration derives current legacy MRU membership/revision without disk
  mutation; persisted S2 membership is independent of the 12-entry MRU. Store
  checks revision/canonical project paths; existing lock/reload/save owns the
  transaction. No live legacy reader/writer/RPC/WBA behavior switched yet.
- [x] 37 targeted state/persistence/legacy-open/secondary-content tests pass;
  strict mypy plus extra/disallow-Any checks pass on editor_open_state.py,
  project_sidecar.py and test_editor_open_state.py. This is a scoped typing gate,
  not a whole-tree claim. New module mypyc C generation passes (two extension
  targets); no native compilation/activation, frontend/OTA build or restart.
- [x] S2b approved/implemented: explicit immutable renderer-to-logical-client
  association, atomic open/close/bootstrap/restore membership and targeted area
  projections. Close checks project generation and membership revision. Local
  closes retain the shared document; last-local closes publish DocumentClosed
  globally. Draft content survives tab closure. Reopened documents reject delayed
  close publication. Gecko secondary identity queries target their parent even
  when requesting its primary ID. Electron supplies the parent ID explicitly.
- [ ] S2b live acceptance: refresh Python worker (interpreted or new activated
  mypyc build), frontend and Electron client. No shared framework restart or
  Android/OTA publication performed. Secondary tabs/container/focus remain below.
- [ ] S2b **live failure reported 2026-11-04; not accepted**: opening
  pyproject.toml only in a client's second editor correctly opens it in other
  clients' primary editors, but closing that second-editor presentation leaves
  the initiating client with zero open files while the other clients retain
  pyproject.toml. The last-local close must close every presentation in every
  client. Reload also fails to project a backend-open file into primary when
  that client has no corresponding presentation. Trace both paths before
  claiming the shared-membership/placement cutover correct; the automated tests
  did not cover this failing live sequence. User requested recording only in
  this pass, not an editor-behavior fix. Iframe removal and extra-key focus
  routing are still unimplemented.
- [x] Follow-up semantic repair implemented (2026-11-04), pending live test:
  the actual secondary close RPC now closes all secondary-area working-file
  presentations atomically, retaining local primary copies and globally closing
  last-local files. Revision/project fences reject stale closes. Both mobile
  and Electron header closes commit backend membership before hiding; detached
  Electron window X asks its renderer to run the same transaction rather than
  silently disposing it. In-flight close notifications cannot dispose that
  renderer before its RPC acknowledgement. Restore repairs an existing empty
  primary foreground when its placement has a valid backend-open file. Persisted
  draft contents and disk contents survive document closure.
- [x] Semantic-repair automated gate: 59 backend tests, strict extra/no-Any
  checks on the three touched Python modules/tests, 30 focused frontend tests,
  frontend/WBA no-Any checks and build, Electron typecheck/127 tests/compile pass.
- [ ] First live gate: refresh worker/frontend/Electron; repeat secondary-only
  open -> secondary close -> all clients empty -> reload; repeat primary+secondary
  local ownership -> secondary close retains primary; repeat remote open into
  an already-empty client's primary and reload. Existing stale placement from
  the failed old close must also be checked, not assumed repaired by new close
  routing. No new mypyc activation, shared runtime restart or OTA publication.
- [x] Orphaned-secondary restore repair implemented after live Pixel inspection:
  README.md was globally open but assigned only to that client's secondary,
  with both working foregrounds empty and a hidden frame displaying No file open.
  On the bound secondary's boot-snapshot request, backend reconciliation now
  rehomes those orphaned assignments to primary and seeds its empty foreground.
  Global membership, other clients' placements, existing primary foregrounds and
  document lifetime are unchanged. Valid secondary foregrounds and active/pending
  historical content block recovery. Content guard and sidecar mutation have no
  intervening await; revision/generation fencing and targeted foreground
  publication preserve restore/open races and an already-booted primary.
- [x] Recovery gate: 64 backend tests pass, including the actual boot-snapshot
  route, exact orphaned state, idempotence, valid working view, pending/active
  history and stale project generation. Strict extra/no-Any checks pass on six
  changed modules/tests. This follow-up is Python-only: requires matching mypyc
  build/activation and worker refresh, not another frontend/OTA publication.
- [ ] Live orphaned-state acceptance remains open. No saved client/project
  state was cleared and no live runtime was restarted during investigation/fix.
- [x] 2026-11-05 live close receipt: user updated runtime/assets, opened a
  document only in mobile secondary with no other files open, then closed it.
  Read-only inspection confirmed backend revision 4259 has zero global documents,
  empty primary/secondary placements for all three stored logical clients and
  cleared foregrounds for those clients. The sole console-connected main page
  had no tabs or secondary frame. Other clients were disconnected: their stored
  state was verified, not their rendered UI. This accepts that global-close
  scenario, not the still-pending iframe/focus work or every restore scenario.
- [ ] Combined foundation approved: after semantic gate, replace one-shot
  m_editor_app.ts/global boot state and fixed DOM-ID ownership with explicit
  instance-scoped working-editor lifecycle and safe shared model/provider
  ownership; remove the mobile/browser secondary working iframe. Historical and
  extension isolation and Electron native detach/overlay remain. Unify active-area
  focus/extra-key ownership before secondary tab UI. Current source still uses
  the working iframe; these lifecycle/focus changes are not yet implemented.
- [x] 2026-11-06 first lifecycle prerequisite: replace import-time editor boot
  and window snapshot/mention/readiness mailboxes with an explicit typed boot
  function and retained mount promise. Repeated mount is idempotent; a second
  same-realm mount fails before DOM mutation while provider/model ownership is
  still page-scoped. Failed partial boot is not silently retried. Host-action,
  keyboard and UI-layout owners now expose idempotent teardown, reject rebinding,
  and fence late callbacks; pagehide uses those disposers. This is not complete
  editor disposal or shared provider/model ownership. Existing iframe isolation,
  Electron overlays, shared document authority and WBA protocol are unchanged.
- [x] Explorer card menu, file-tab menu and File-menu wording now consistently
  read "Open in Second Window" (remove "a").
- [x] First prerequisite automated gate: 68 focused boot/keyboard/mobile-key/tab/
  theme/history tests pass; frontend and WBA checks report zero Any findings and
  compiler diagnostics; frontend build passes. Three unrelated terminal-menu
  tests still expect frontend destination selection and fail against the unchanged
  backend-owned terminal route; the full menu suite is not claimed green.
- [x] Live prerequisite accepted 2026-11-06: user reports everything seems to be
  working after this change. No exhaustive additional mode matrix is claimed.
  No Python/mypyc/Rust rebuild or shared runtime restart needed; Android
  bundled-asset publication not performed. Continue with shared
  provider/model and DOM ownership before iframe removal, focus fix and tabs.
- [x] S2b automated: backend integration/state/legacy tests and focused frontend
  identity/tab/lifecycle tests pass; frontend and WBA strict no-Any checks/build
  pass. Electron strict checks and unit suite pass. Four existing TextMate
  transport fixtures still use the retired full-grammar request instead of the
  chunk protocol; that wider suite is not green and is not claimed as passing.
- [ ] S2 secondary tab bar/direct Explorer-to-secondary open; unique tabs per
  area, unknown remote placement -> primary, restore/reconnect reconciliation.
  Test local presentation removal versus global last-local close, other-client
  dual placement, disconnect, draft/save/cancel and stale open/close revisions.
- [ ] S3 ordinary desktop browser support and one responsive outer pane/tab
  container; implement safe outer working-editor iframe removal with explicit
  provider/global/editor identity/disposal ownership. Preserve historical and
  extension isolation and native Electron overlay/detach behavior.
- [ ] S3 shared mobile/desktop File menu active-area targeting with menu-focus
  retention, stale target guards and extension-panel action policy.
- [ ] S3 reuse terminal drawer's focus/modifier/extra-key ownership for primary
  and secondary; fix secondary -> primary key routing and verify sticky/consumed
  modifiers, file switches, pane close/hide and terminal transitions.
- [ ] S4 extension-created secondary panels as tabs and sidebar transfer;
  preserve surface identity, live state, messages, readiness, focus/visibility,
  retained contexts, disposal, native reparenting and project/WBA generation.
- [ ] Later-slice strict type/build/tests and grouped live acceptance on
  Electron/desktop browser/mobile, multi-client placement/foreground, close/open,
  project switch/cold restore/reconnect and historical/extension content.

Initial intake was planning-only; S1 source/build scope was subsequently
approved above and live-accepted. User approves this 2026-11-04 plan/tracker
revision only. No asset publication, shared restart, APK update or additional
live acceptance is claimed. Remaining implementation slices need approval.

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

## Consolidated terminal and app-install UX

Canonical active scope: matching section in this release's PLAN.md. Only the
deferred shell-execution section is carried from .356, not the entire old plan.

- [x] Transfer shell-execution profile, `%` / `%<` example, trailing arguments,
  command-palette execution and terminal-focus requirements without losing notes.
- [x] Add explicit `.desktop`-style `%f` field-code support to that scope.
- [x] Record Termux login shells inheriting a venv prompt without the matching
  active environment; cause not yet diagnosed. Preserve explicit environment use.
- [x] Record terminal profile/setup modal: exec/command, arguments, shell/login,
  sizes; audit persistence/defaults and existing per-surface preferences first.
- [x] Clarify second-root app backend already exists; missing work is install/
  open UX for app files/ZIPs, not reimplementing second-root discovery/lifecycle.
- [ ] Audit login-shell environment and prompt setup; approve/fix the specific
  inheritance issue and test real shell/Python/PATH identity on Termux/Linux.
- [ ] Audit and approve terminal profile modal schema, persistence/defaults and
  backend-owned application across supported terminal surfaces; implement/test.
- [ ] Audit current run-profile substitution/dispatch, define supported field
  codes/quoting and implement approved shell profile plus palette command entry.
- [ ] Validate terminal reuse/create/readiness, trailing args, acceptance/cancel,
  run/save/draft guards and exact-client terminal focus on desktop/mobile.
- [ ] Audit existing package/archive/picker/launcher integration; approve the
  install UX and package-validation/atomic-install/registry-refresh contract.
- [ ] Implement user-consented file/ZIP app installation and open flow; test
  invalid packages, path traversal, duplicate/update/cancel/error behavior and
  existing second-root app compatibility. Obtain live acceptance separately.

## Wheel-bundled native Node dependencies

- [x] Record user requirement: bundle node-pty and other required/native Node
  dependencies (including server MessagePack acceleration where supported) with
  wheels so ordinary installs do not depend on runtime npm/build behavior.
- [x] Record Pixel-native build path: upstream Android prebuilds not required.
  Existing isolated node-pty build loads and runs a real PTY on Node 26.13.0;
  detailed receipt: docs/apps/wba_bun_aot/TRACKER.md. Not yet a wheel payload or
  evidence of Node 24 compatibility. Preserve experimental WBA AOT artifacts.
- [ ] Audit all shipped Node/native consumers, wrappers/support files/licenses,
  supported platforms, shared libraries and Node-API/module-ABI contracts.
- [ ] Approve release-time build/packaging/materialization changes. Build Termux
  addons natively on Pixel and Linux addons in the Linux wheel build environment.
- [ ] Qualify Node 24 baseline and any additionally supported runtimes; bundle
  tested artifacts with manifest/fingerprint-based compatibility selection.
- [ ] Remove runtime npm installation/building for supported wheel paths; clear
  mismatch errors and explicitly opt-in editable/source build fallback only.
- [ ] Validate clean installed wheels without network/npm/compiler: native load,
  real PTY lifecycle and MessagePack interoperability/optional acceleration.
- [ ] Check wheel publication sizes and obtain joint Linux/Termux acceptance.

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
