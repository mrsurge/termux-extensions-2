# 0.2.354 consolidated release tracker

Updated 2026-10-15; planning checkpoint `2e77c843`. See PLAN.md for the cut line.
Old unchecked boxes are evidence to reconcile, not automatic release tasks.

## First after release

- [x] Record user-requested browser-engine reuse proposal at repository root:
  `ELECTROMUX_ENGINE_REUSE_PROPOSAL.md` (2026-10-16).
- [ ] Begin its read-only EdgeJS/host capability audit first after release;
  implementation, browser forks and replacement of embedded Node remain unapproved.

## Current approvals and evidence

- [x] User approved read-only audit and documentation consolidation.
- [x] User explicitly defers ALS pipe/intent migration to next version.
- [x] Draft projection/context/chrome/selective Save live accepted; 2a392d77 pushed.
- [x] Minimal diagnostic Quick Fix live accepted explicitly by user; 2e77c843 pushed.
- [x] Theme cold restoration/watcher and hover-link changes have recorded user
  acceptance in their owning tracker; do not reopen as missing implementations.
- [x] Search OOM correction has explicit user live acceptance in search_memory.
- [x] User confirms startup/build group checked out: Electron cold/cached/cancel,
  fresh editable startup and no-op mypyc fingerprint rebuild, except missing
  selected artifact failure captured below. This is user-reported, not a new
  agent run or an inferred exhaustive device/key matrix.
- [x] Existing Sidebar app workflow/CM6 persistence/mobile sticky/dock acceptance
  matrix already records the completed user walkthrough (sidebar_app_intents).
- [x] Existing release README already documents Gboard 18+; historical checkbox
  does not mean another implementation is needed.
- [x] All built-in app entry scripts/templates already declared in common asset
  manifest; minified app outputs and shared-resource trees are source-confirmed.
- [x] Read existing Gecko APK without rebuilding; GECKO_SIZE_AUDIT.md records size
  categories and libxul ELF evidence. No device/runtime or artifact was changed.

## Remaining release work — execute in this order

- [x] Approved keyboard follow-up: suppress digit-only absolute previews while
  actual relative gutters are active; j/k preview and Enter absolute acceptance
  remain. Guarded Monaco bundle hook leaves vendored sources unchanged.
- [x] Cursor presentation follow-up: existing file-open transaction retains at
  most 100 per-file cursor positions per client/store, clamps on restore, keeps
  scroll restoration separate, and respects explicit line/column navigation.
  Desktop opens and keyboard-triggered Explorer/tab cycling focus/restore;
  mobile touch tree opens keep focus=false. No cross-reload cursor persistence,
  backend protocol change, mypyc rebuild or runtime transition added.
- [x] Follow-up checks: 46 targeted tests, 2 selected transport open/jump tests,
  TypeScript check, Monaco bootstrap and final host build pass. Broad transport suite has
  38 pass/4 TextMate fixture failures (missing location.search), outside this
  edit scope; do not report the whole suite green.
- [x] User live acceptance (2026-10-17): relative preview and desktop/keyboard
  cursor-restoration follow-up working; requests commit/push. No agent runtime
  restart or client publication performed; cross-reload persistence remains out
  of scope.

- [x] R1 source audit: entrypoints, literal static dependency graph, computed
  icon families and pinned ALS inventory checked; two proven gaps fixed with
  approval. See STATIC_ASSET_AUDIT.md for limits, matrix and focused test evidence.
- [ ] R1: confirm executing-client requests and final generated asset freshness;
  source closure tests are not a live network capture or publication.
- [ ] R1: publish matched assets and verify slow-connection multi-app Sidebar
  delivery from native-local bytes; dynamic requests remain intentional.
- [x] R2 planning clarification (2026-10-16): optimize downloadable APK size;
  include useLegacyPackaging=true compressed native-library candidate, accepting
  installation-time extraction as a tradeoff. Documentation change only approved.
- [x] Record follow-up reuse after Gecko proves the pattern: eventual standalone
  and Termux shared-UID forms should share a renderer/packaging policy, with
  variant-specific identity/signing/integration; no renderer migration approved.
- [x] R2: review pinned Gecko loader/manifest and approve/implement staging-only
  native compression switch with two same-source builds; R8/debug/release unchanged.
- [x] R2 compression-only builds and artifact checks: 205,044,149 -> 108,413,133
  bytes, 47.1% smaller. Same entries; every payload except AndroidManifest.xml
  hash-identical. Both v2 signatures and ZIP alignment pass; packaged extraction
  flag confirmed true for compressed APK. See GECKO_SIZE_AUDIT.md.
- [x] User installed the compressed Gecko candidate and reports using it with
  normal operation working fine (2026-10-16). This accepts the tested install/
  launch/use path, not an exhaustive update, device or cold-start timing matrix.
- [x] R2: user approves staging R8/resource-shrinking build trial; existing
  optimized release rules retained, comparison opt-out added; debug/release intact.
- [x] R2 R8 candidate builds in 2m33s: 108,413,133 -> 101,573,686 bytes;
  DEX raw 23,402,844 -> 3,926,452 bytes (3 files -> 1). Signature/alignment pass;
  native payloads and frontend assets unchanged (DEX baseline profiles regenerated).
- [x] R2 compatibility decision: R8 8.9.32 reports Kotlin metadata parsing
  warning with Kotlin 2.2.10; official table lists R8 8.10.21 for Kotlin 2.2.
  User accepts leaving this warning unresolved for now after corrected APK live
  acceptance. Do not suppress it; toolchain alignment is deferred, not a release
  blocker by itself. No startup/RAM improvement is claimed.
- [x] Razr R8 trial rejected: startup crashes at GeckoBundle -> JSONObject.wrap
  (2026-10-16 06:21:02/06:21:04 device logs). Mapping identifies h3.c as bundled
  org.json.JSONObject; runtime dependencyInsight traces old json:20090211 through
  Socket.IO/Engine.IO. That JAR lacks wrap; this is distinct from metadata warning.
- [x] User approves narrow Socket.IO org.json exclusion/rebuild, retaining JVM
  test dependency. Runtime dependencyInsight now reports no org.json:json.
- [x] Rebuilt JSON-excluded APK/mapping verified: no packaged org.json DEX class
  definitions, JSONObject.wrap reference targets platform org.json, signatures/
  alignment pass; runtime JSON absent and JVM-test JSON retained. 101,569,222 bytes.
- [x] User confirms corrected gecko-staging-r8-platform-json.apk works on the
  device (2026-10-16); no agent install/data clearing performed. Separate Kotlin
  metadata warning and unmeasured startup/RAM effects remain.
  Original compression-only APK remains accepted and separately preserved.
- [x] TE2 Termux audit: native .so compression already enabled; old APK confirms
  Deflate libcef/libnode. User approves a separate Termux-staging-only DEX
  compression trial/build, leaving existing R8/CEF data/ordinary Cefrium intact.
- [x] TE2 Termux same-source baseline/candidate: 201,752,643 -> 169,465,787
  bytes (32,286,856 saved, 16.0%). Every extracted ZIP payload hash-identical;
  DEX stored -> Deflate. Signatures/alignment and GitHub-Termux certificate /
  com.termux shared UID verified. Baseline 9m, packaging-only rebuild 36s.
- [x] User closes APK Deflate work as done (2026-10-16), including TE2 Termux
  DEX compression. No agent installation/publication performed; existing CEF
  resource-generation warnings retained.
- [x] Record user direction to reuse the TE2 Termux compression pattern for
  ordinary Cefrium, which shares its base build. This is the selected approach,
  not a claim that Cefrium's currently Termux-guarded DEX switch is already enabled.
- [x] ALS packaging gap confirmed in the compression-test APK: stale October
  APK seed contained wrapper only, not frontend/CSS. Actual served OTA archive
  contains the complete snapshot and hash-matching CSS/fonts.
- [x] User approves shared seed refresh/rebuilt Termux APK plus approval-JS
  inspection. Existing bundler publishes current 444-file seed; rebuilt APK
  verifies all seed hashes and all 148 ALS static files. Signature/alignment and
  12 asset regressions pass. No installation, data clearing or client OTA issued.
- [ ] Live test refreshed-assets APK; same-version local tree requires explicit
  force-update rather than assuming APK update reseeds. New candidate supersedes
  the stale-seed compression test for UI testing; see TERMUX_COMPRESSION_AUDIT.md.
- [x] R2 APK Deflate comparison/implementation closed by user: same-source
  packaging measurements, payload equivalence and signature/alignment evidence
  recorded separately from R8 savings. No exhaustive ABI/page-size or timing
  matrix is implied; final matched release artifact checks remain under R5.
- [x] R3 concrete scope approved/implemented: root palette rn + Enter toggles
  persisted relative line numbers (current state shown), e + Enter opens/focuses
  Explorer; :8:k / :8:j and optional :column provide logical-line relative jumps.
  Explorer arrows/Home/End/Space/Enter reuse click actions, Ctrl+F focuses name
  search, Shift+Tab from first tree row reaches search, first Escape dismisses
  active search and next returns editor focus. Ctrl+Shift+Comma/Period cycles
  displayed file tabs left/right with wrap, missing-file and in-flight guards.
  Sidebar shortcuts beyond existing behavior are not included in this bounded
  user-selected matrix. No Electron/native changes required by source checks.
- [x] R3 source validation: 37 focused frontend tests, 9 backend service tests,
  TypeScript checking, Monaco bootstrap and host builds passed. No native client publication/live acceptance
  implied. Persisted preference needs matching mypyc activation/worker refresh.
- [x] R3 user reports current keyboard slice testing well (2026-10-16) and
  requests commit/push after the inline-diff/input follow-ups. Focused source
  regressions cover the implemented matrix; this is not an exhaustive claim
  across every platform/key layout or final release artifact.
- [x] R3 live follow-up: user observes Go to Line replacing relative gutter
  with absolute numbers. Pinned upstream explicitly does this; approved guarded
  bundle transform removes only that block, preserving preview/accept/cancel
  lifecycle. Root rn/e entries moved after stock entries. Eleven focused tests
  pass, including pinned-source transform guards and root ordering.
- [x] R3 follow-up accepted in current user testing; no additional backend/mypyc
  change is needed for gutter preservation or ordering.
- [x] User-approved inline-diff presentation guard: creation and live preference
  projection convert relative to absolute gutters without mutating saved choice;
  hidden gutters stay hidden and plain recreation reapplies relative choice.
  Seven keyboard tests and TypeScript check pass; host rebuilt, publication separate.
- [x] Cefrium shortcut capture: trusted 229 keydown -> insertText(g) beforeinput/
  input -> 229 keyup -> synthetic Ctrl+G -> editor blur -> quick-input focus.
  User-approved adapter fix claims cancelable armed-Ctrl ASCII insertText before
  textarea mutation, replays existing command in a fenced microtask and consumes
  matching 229 keyup; one-shot Shift yields to this Ctrl transaction. No generic
  letter blacklist, document rollback, terminal changes or Android fork edits.
  Twenty-three focused mobile/keyboard tests pass using actual vendored helper;
  temporary probe disposed and test-only Quick Fix draft cleared with permission.
- [x] User reports early Ctrl-input claim and inline-diff guard testing well and
  approves checkpoint commit/push (2026-10-16). Targeted tests include Ctrl+G,
  Ctrl+Shift+O, ordinary-input bypass and locked Ctrl; exhaustive Gecko/device
  parity remains a final artifact check, not inferred from this live report.
- [ ] R4: investigate/fix missing automatic editable mypyc artifact selection.
  User error: native Python import FileNotFoundError for domain-a7f57a2.../manifest.json
  after deleting the selected build/pin. Rebuild+activate recovered. Distinguish
  missing auto-selection from explicit selection or corrupted packaged payload.
- [ ] R4: fix terminal profiles Array.isArray narrowing with malformed fixtures.
- [ ] R4: triage stale retired-Python mount and suppressed-preview MRU assertions;
  record known pre-existing failures accurately, without restoring old architecture.
- [ ] R5: verify cleaned ALS native wheel publication and choose compatible TE2
  pin/locks; preserve already-published FWS 0.2.65 rather than release it twice.
- [ ] R5: fresh target dependency closure, exclusive optional uvloop distributions,
  ordinary CPython/private runtime/native ABI, libarchive.file_reader smoke.
- [ ] R5: matched Linux/Termux wheels (<100,000,000 bytes), assets and staging APKs.
- [ ] R5: Debian and Android fresh-install/version/worker/WBA/console/MCP/app checks.
- [ ] R5: separately approve merge/tag/publication; verify uploaded hashes.

## Acceptance still needing bounded confirmation

These are not blanket unimplemented features. Ask only about cases that remain
relevant after final packaging; do not count unrun stress experiments as bugs.

- [ ] Latest all-client ALS static interception/publication, especially Electron
  and Gecko; Cefrium functional acceptance is already documented.
- [ ] Settings and Archive Manager ordinary-worker/frontend acceptance after
  migration; Archive Create/Add/Test capability gaps are separate deferred work.
- [ ] File Explorer directory-sync zero-input erasure/wake in a fresh terminal.
- [ ] Remaining Code Inspector/major UI/run-profile multi-client/lifecycle checks
  not already covered by explicit owning-document acceptance.
- [ ] Stop _setContext rejection spam and retain console registration after reload;
  source fix exists, but the specific log/lifecycle checks are not separately proven.
- [ ] Final release artifact installation/client matrix; older wheels/APKs cannot
  accept source changes introduced since those artifacts were built.

## Deferred, not part of this release

- ALS framework pipe: mentions editor -> framework -> ALS; file open/project
  changes ALS -> framework -> editor. Exact-client broker ownership and future
  FWS reconnectable UDS compatibility; no editor-presence dependency or fan-out.
- Existing 0.2.355 backend Sidebar IPC retirement beyond the accepted intents.
- Monaco graph reduction/GPU, general refactors/workspace edits, observability
  expansion, native diagnostic tooling and optimization/benchmark experiments.
- Aria 502/stale-shell investigation, socket/event/intent modernization; known
  unresolved behavior is not relabeled accepted/error-free.
- Archive intent/job/context-menu expansion and missing Create/Add/Test handlers.
- Electromux public-host/calculator expansion, exhaustive crash/failure matrices,
  opt-in legacy filesystem cleanup, broader platform/device acceptance.

## Owning plan/tracker index

The listed folders contain PLAN/IMPLEMENTATION_PLAN and TRACKER variants. Keep
technical history there; this checklist determines current release gating.

| Workstream under docs/apps/ | Disposition |
| --- | --- |
| draft_overlay | Accepted; separate pre-existing MRU test triage only |
| monaco_core | Quick Fix/theme/hover accepted; GPU/reduction deferred |
| search_memory | Accepted OOM correction |
| editable_worker_runtime | Startup/build accepted except new missing-artifact case |
| desktop_build_startup | User confirms startup group; implementation complete |
| dependency_trim | Source migration largely complete; compatible pins/clean install remain |
| release_asset_audit | R1/R2 current; old published artifact evidence preserved |
| desktop_deb_packaging | Historical releases; R5 governs new artifacts |
| client_runtime_polish | Historical implementation/acceptance; R5 new package validation |
| editor_loading | Accepted maintenance features; remaining audits/benchmarks deferred |
| sidebar_app_intents | Existing acceptance matrix complete; new archive/ALS work deferred |
| terminal_directory_sync | Implemented/committed; specific live erasure case to confirm |
| terminal | Earlier phase acceptance retained; broader multi-client cases verify/defer |
| vsix_explorer_changes | Marketplace accepted in user history; no blanket retry/failure proof |
| major_ui_changes | Source complete; reconcile old live-acceptance markers |
| code_inspector | Source complete; reconcile remaining context-menu/lifecycle cases |
| run_profile_refinements | Source complete; outstanding lifecycle acceptance to confirm |
| multi_model_and_tab_intellegence | Preserve earlier diagnostics acceptance; stress/backlog separate |
| source_control_graph | Implemented history work; broader diagnostics/theme backlog deferred |
| selected_commit_inline_diff | Preserve prior acceptance; extra timing/visual matrices deferred |
| cefrium_mobile_parity | Historical/client work; no broad diagnostics/renderer experiment now |
| gboard-android-ime-fixes | Historical IME ownership; current regression checks in R5 |
| experimental_android_terminal_interface | Experimental backlog, not release gating |
| framework_cleanup_and_ui_vsix | Preserve accepted framework boundary; cleanup/expansion deferred |
| native-js-modal-plan-tracker | Existing controls/history, not a new implementation task |
| backend_native_observability | Future diagnostics/profiling program, not release gating |
| electromux | Accepted TE2 consumer retained; generic-platform backlog deferred |
| pipe_plans-contracts-tracker | Contracts/history; no wholesale new protocol program this release |
| code_te2/OUTSTANDING_ISSUES.md | Startup source fix superseded; terminal-profile fix remains |
| code_te2/*SPRINT_PLAN / VSCODE_API_HARNESS_PLAN / SOME_ISSUES | Historical/user lists; not automatic release blockers |

docs/planning is retained design history, including stateful-window and old CM6
plans. Current app/state authority and the accepted Sidebar matrix supersede old
unchecked design steps. No user tracker is rewritten or cleared by consolidation.
