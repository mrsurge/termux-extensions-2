# 0.2.356 maintenance tracker

## Current release package ledger — frozen source 920322c2

This ledger supersedes the earlier candidate artifact hashes below. Source fixes
and portable-home behavior are user live-accepted; exact rebuilt package checks
are recorded separately. Release 0.2.356 is now merged, tagged and published;
the production Android wheel receipt below supersedes the validation-only hash.

- [x] Commit/push 920322c236d81cce892d921fa91103b3c1937886 with accepted home
  defaults and matching generated host/Android seed. User changes/untracked files
  preserved; private rpw.txt remains locally excluded, never read or staged.
- [x] Linux resource repack reuses hash-checked server/worker binaries and the
  existing verified compiled-domain restore path. Native source diff is empty;
  no Cargo or mypyc compilation. Wheel: 99,528,427 bytes; SHA256
  255a7712411fff99ba6702eff79295ab02ffa5d75aca3895d6e11bd70c7c5ac7.
  Fresh acceptance/linux-920322c2 venv passes all 150 module imports, WBA,
  integrity/reinstall, framework health and eight-app discovery; pip check and
  FWS native pipe/uvloop selection pass with ALS 0.2.140 and FWS 0.2.65.
- [x] Pixel Android resource repack also uses the existing native binaries/domain.
  Wheel: 50,433,643 bytes; SHA256
  f44a4427ea2797a43120078676bfbfd0789ebf79455daebe58f5b4dac58fd04d.
  Fresh acceptance-920322c2-venv passes 150 modules, actual WBA, native FWS pipe,
  uvloop, ALS MCP 38 tools/one resource/EOF, dependency consistency and retired
  stack absence. Wheel and receipts copied/hash-verified on VPS. This remains
  validation-only until the existing clean-tag production-assembly guard is met.
- [x] Inspect actual contents of both wheels: Home/~ JSON, shared picker and both
  ordinary/compiled-domain host bundle copies match frozen-source SHA256 hashes.
  Neither wheel contains source maps; both are below 100,000,000 bytes.
  Artifacts: artifacts/final-{linux,android}-920322c2 under the VPS release root;
  portable-home-inventory.json records actual ZIP resources, not source assumptions.
- [x] Final VPS staging APK unit/assembly gates and signature/manifest/ARM64/
  447-file seed checks pass. Artifact root: artifacts/final-apks-920322c2.
  Gecko: 103,220,749 bytes; SHA256
  549682191d2f8b282a0db2a2eb4f2e1cba6511b33068e19b2e86ba360e46d592.
  Cefrium: 142,577,489 bytes; SHA256
  acd3df95b889e8587ab7858320012341eacf2ec5805dafd68d697838659be44e.
  Termux: 165,546,792 bytes; SHA256
  36389315a23d49338fde5643934c1a0f13971e2bf126ee55ba036b30f90b8846.
  ALS approval renderer present, zero source maps, expected development/public
  Termux signers. Keep R8 maps and complete logs; no new optimization experiment.
- [x] Final Termux homefix APK copy-only delivery to Pixel Downloads as
  te2-0.2.356-termux-staging-homefix-arm64.apk. Transfer uses a .partial file;
  SHA256 is verified on-device before rename. No installation/storage clear;
  existing accepted APK copy preserved.
- [x] Build second-root app template ZIP directly from frozen Git tree: exactly
  six tracked source files under proxy_shell_wrapper/, no build/cache/user files.
  artifacts/final-extras-920322c2/te2-second-root-app-template.zip; SHA256
  db94d45f2f21d2a3e2e5d10a167b583eb24d41cb233931c6da5b3b6a468515e7.
- [x] User approves proceeding through final release gates after the wheel
  acceptance status recap. Record automated wheel checks separately from the
  earlier user APK/source acceptance; no new GUI acceptance is invented.
- [x] Fast-forward origin/main to cae18996 (accepted source plus receipt-only
  commit); annotated 0.2.356 tag points at frozen source 920322c2. Existing
  validation-only wheel is preserved, not relabeled.
- [x] Production Android wheel rematerialized on Pixel from the same native
  binaries/domain with --release-tag 0.2.356 and clean source/tag guard. Wheel:
  50,433,629 bytes; SHA256
  dbef3c8f976a58beabca400a45d0a75b66158200e1edfac4e0753575951cd14d.
  publicationEligible=true; server/worker hashes unchanged. Separate fresh
  acceptance-production-venv passes 150 compiled-module imports, actual WBA,
  native FWS pipe, uvloop, ALS MCP 38 tools/one resource/EOF, pip check and
  retired-dependency absence. Pixel workspace remains under ~/projects/.
- [x] Assemble clean-tag public manifest/installers, both wheels, three accepted
  APK resource packages and second-root template. All local SHA256SUMS pass.
  VPS artifacts/public-0.2.356; provenance/acceptance receipts retained under
  artifacts/production-android and receipts/. No shared runtime replacement.
- [x] Publish both wheels to PyPI; public PyPI JSON sizes/hashes match the exact
  qualified wheels. Publish GitHub 0.2.356 as latest with ten assets including
  manifest, checksums and installers. No source distribution is uploaded to PyPI.
  https://pypi.org/project/te2/0.2.356/
  https://github.com/mrsurge/termux-extensions-2/releases/tag/0.2.356
- [x] Stream all ten actual public GitHub downloads through SHA256 and compare
  against local release bytes; all pass. Public PyPI filename set, sizes and
  hashes also match both release wheels. Receipt:
  artifacts/public-0.2.356-verification.json on VPS. Release tag remains frozen;
  final publication receipts are a documentation-only follow-up commit.

## Platform-agnostic filesystem home defaults — 2026-10-28

- [x] User confirms preceding APKs live accepted before this asset-only follow-up.
  Preserve that native acceptance; do not infer acceptance of newly changed assets.
- [x] User approves portable home defaults without native changes. Seed Home -> '~'
  in app/static/bookmarks.json; existing persisted bookmarks remain untouched.
  Code TE2's fallback now uses '~'; keep home-relative paths backend-resolvable,
  including parents above home, rather than generating /~ or guessing Termux paths.
  Remove shared picker's Termux parent special cases. File Explorer's existing
  Path.home()/project-CWD defaults already work and require no backend change.
- [x] 42 focused picker/path/open/project-modal/startup tests pass on VPS; frontend
  and WBA strict gates report zero Any findings/compiler diagnostics. Rebuild host
  bundles and all 447 Android seed assets on VPS, import unchanged generated output.
  No Rust/Python/native changes, binary rebuild, shared restart or APK install.
- [x] User confirms portable-home changes live tested and working. Final
  wheel/APK resource repackaging can reuse completed native artifacts; updated
  seed alone is not a rebuilt APK. Publication remains gated separately.

## Termux final APK cache/toolbar correction — 2026-10-28

- [x] Inspect the Pixel using its own ALS acceptance venv and installed TE2
  PYTHONPATH, not the desktop console. APK-seeded host.js is SHA256 d2f4982b…
  (6,861,239 bytes), but default browser fetch returns b456fc6d… (6,854,349
  bytes), matching the older installed .355 server. The identical URL with
  cache:no-store returns the new seed. Responses had one-year immutable caching;
  the old server's ?v=0.2.354 does not identify the APK/OTA asset revision.
- [x] User approves local-asset no-store responses, a persisted migration gate
  using real Chromium reloadBypassingCache (not Cefrium's ordinary Reload),
  toolbar spacing and three-second two-tap Quit. Preserve app data/IndexedDB,
  backend Git authority and the running framework; no wheel/runtime change.
- [x] Toolbar action/lifecycle tests and four existing Git-init regressions pass.
  Shared relay real-HTTP asset-replacement test and six Cefrium refresh-gate
  tests pass in their complete native suites. First Termux unit build failed
  on duplicate generated R classes in class JARs; a clean Termux build-output
  retry passes all unit tasks in 55 seconds without Gradle/dependency changes.
  Logs: cache-fix-{gecko,cefrium,termux}-unit.log and
  cache-fix-termux-unit-clean.log on the VPS; preserve the failed attempt.
- [x] Regenerate the 447-file Android seed on the VPS and import it unchanged.
  Toolbar files are separately generated by bundleTermuxShell, not editor OTA.
- [x] Corrected Termux staging APK assembled on VPS (3m 28s); 165,546,792 bytes
  / 157.88 MiB, SHA256
  56bbd7488e659cea5eed9221bfeaa480a64224b717aa725ae89bccd8d9a399b7.
  Signature matches Termux GitHub lane; package/version/ARM64-only libraries,
  all 447 seed hashes and generated toolbar hashes verified. Native suite totals:
  Gecko 101, Cefrium 77, Termux 30 plus Electromux host 29 / Node 19; zero failures.
  Artifact/receipts: artifacts/cache-fix-termux under the VPS release root.
- [x] User changes delivery to copy-only before leaving. Stream APK to Pixel
  /sdcard/Download/te2-0.2.356-termux-staging-arm64.apk; on-device SHA256 matches.
  No installation, data clear or framework restart. Pixel framework was already
  absent at read-only recheck, so live console validation was not performed.
- [x] User subsequently reports APKs live passed, before the portable-home slice.
  Record user behavioral acceptance, not a new independently measured browser
  fetch/hash observation. Source/seed/APK inventory hashes remain separate evidence.
- [x] Earlier status correction: no TE2 Android wheel build existed on Pixel
  during APK testing; only ALS had been built. Do not conflate those workflows.
- [x] User authorizes native Pixel or Termux-container wheel build (2026-10-28).
  Select native Pixel, visible ~/projects/te2-0.2.356-release, isolated compiler
  environment/toolchain and no global upgrades or installed-runtime restart.
  Read-only preflight: 192 GiB free, system Python 3.14.8, reusable isolated ALS
  Rust 1.99.1 works with its own library path. rpw.txt is locally git-excluded;
  its contents are not read and privilege escalation is not used.
- [x] Checkpoint/push source 6505d322; clone exact revision into the new visible
  Pixel workspace. Detached build PID 25824 starts dependency provisioning, then
  framework/editor Cargo builds, mypyc snapshot and validation wheel, four jobs.
  Build and fresh acceptance use different venvs, no developer activation.
  Logs/stage/exit receipts stay under that workspace; no APK auto-install.
- [x] Pixel compiler provisioning passes: isolated mypy 2.3.0, Maturin and
  ast-serialize build/import successfully with explicit system-libpython linking.
  Actual TE2 framework Cargo compilation has begun; editor/mypyc/wheel remain
  queued, not complete. Detached acceptance watcher starts only after build.exit=0,
  using system libraries and its own clean venv. Build/acceptance recipes are
  mirrored to VPS receipts; no installed TE2 runtime is replaced.
- [x] Pixel native build completes with exit 0, validation Android wheel
  50,432,178 bytes / SHA256
  997b0e315799b205c566ed7046e7eabeb406f8addcf894c7d117f96d1fc6bffb.
  Separate fresh acceptance exits 0: all 150 compiled modules, actual WBA import,
  FWS native pipe/uvloop, ALS MCP 38 tools/one resource/EOF and no retired stack.
  Candidate is from 6505d322, before the home-default resource-only change.
  No developer runtime activation or publication. Reuse binaries for resource repack.
- [x] Refresh Linux wheel from clean 6505d322 on VPS using verified prior domain
  reuse (matching complete source digest/ABI/native hashes/imports). Wheel size
  99,526,963 bytes, 473,037 bytes below PyPI limit; SHA256
  f7453e11dcc635a4126fe98a7e14b6e67aced6fe615d848caf9613ddaf0e68a3.
  Bundled Python 3.14.6, manylinux_2_28 audit, zero external/blacklisted native
  libraries. Artifact root: artifacts/final-linux-6505d322. New fresh acceptance
  is separate from the preceding 9b6888 candidate; no publication performed.
- [x] Refreshed 6505d322 wheel passes its own fresh VPS venv acceptance: compiled
  150-module imports, WBA/Socket.IO, server-integrity corruption/reinstall test,
  framework health/version and eight built-ins. Native FWS pipe, uvloop selection,
  latest ALS/FWS dependency resolution and pip consistency pass in that venv.
  Receipt: acceptance/linux-6505d322/acceptance-result.json; complete install /
  startup log: logs/linux-6505d322-acceptance.log. Shared runtimes untouched.
- [x] Linux 9b6888 wheel candidate (99,526,422 bytes) installs in a fresh VPS
  Python 3.13 venv, independently loads bundled Python 3.14.6 and all 150 mypyc
  modules, and imports the actual packaged WBA/Socket.IO with Node 24.16.0.
  ALS 0.2.140/FWS 0.2.65/uvloop 0.23.0 resolve together; pip check passes,
  native FWS pipe imports and FWS selects uvloop. No retired dependency stack.
  The old acceptance helper rejected worker-selection diagnostics preceding
  --print-command's binary path. Narrowly accept only those absolute-path
  diagnostics; two valid/four invalid parser cases pass. Runtime unchanged.
  Receipts: acceptance/linux-9b6888-native-import and linux-9b6888-acceptance-v2.log.
- [x] Separate fresh Linux startup acceptance passes: intentional packaged-server
  corruption is rejected, wheel reinstall restores it, isolated framework reports
  health/version 0.2.356 and discovers all eight built-ins. Own test process is
  stopped; no shared runtime touched. Receipt: acceptance/linux-9b6888-startup/
  acceptance-result.json and linux-9b6888-startup-acceptance.log. This qualifies
  the existing 9b6888 wheel, not a newer source-freeze/repack or live GUI acceptance.

## Final source freeze and release builds — 2026-10-27

Final native gate follow-up: the first Gecko suite had relay immediate-port-reuse
and sidebar eviction timing failures. Both passed in isolation, but the complete
rerun reproduced eviction (relay passed). Logs: final-gecko-full-suite-failure.log
and final-gecko-isolated-tests.log under the VPS release logs. User approves a
targeted sidebar fix: strictly increasing persisted update timestamps, with a
fixed/backwards-clock regression, unchanged schema and 32-partition bound.
No relay change or test exclusion is authorized/implied by this fix.
The patched complete Gecko Debug native suite passes (100 tests, zero failures),
including frozen-clock and backwards-clock eviction/refresh assertions. Schema,
32-project limit, client/framework/project partitioning and relay source unchanged.

- [x] User approves adopting the tested Cefrium 0.15 changes into production,
  syncing TE2 metadata/assets to 0.2.356 and ALS snapshot to published 0.2.140,
  committing/pushing the dependency before TE2, and final VPS APK/Linux builds.
  Stop for grouped acceptance before TE2 publication; no shared runtime restart.
- [x] Production source carries the matched 0.15 SDK/plugin pins, explicit
  query-origin policies and tested native inspector wrapper/security guard.
  Preserve the approved codex-ext asset alias repair in every final client.
- [x] Refresh ALS snapshot and generated release assets on VPS; import generated
  outputs. ALS 0.2.140 / source 3137509 / 151 resources; Android seed 447 files,
  version 0.2.356. Source and seeded host/terminal/ALS/console assets synchronized.
  Frontend/WBA strict no-Any gate, Electron typecheck, five cross-client route
  tests, five Electron mapper tests, ten vendor tests and 17 installer tests pass.
  Stale vendor fixtures were corrected for the mandatory approval module and
  new companion version; no production guard was relaxed to pass those tests.
  Changed Python fixture passes strict mypy with disallow-any-expr/explicit;
  this is a targeted test check, not a new whole-tree typing claim.
- [x] Publish tested Electromux b62eb6c on release/te2-0.2.356 before TE2 push.
  Upstream main advanced independently to e263289; preserve it unchanged and do
  not silently add untested upstream behavior or force-push.
- [x] Final release source pushed as 9b6888abb39be385589dbaddebdd27d1f4c0ea12.
  Fresh VPS checkout is clean; pinned Electromux b62eb6c is remotely reachable.
- [x] All final VPS APK unit/assembly gates pass. Version code 20356, expected
  package identities/signatures, ARM64-only libraries and all 447 asset hashes
  verified; no seeded source maps. Artifacts: /mnt/vdb/te2-release-0.2.356/artifacts/final-apks/.
  Gecko: 103,220,817 bytes / 98.44 MiB / SHA256
  45d022b029fd7f9ca861ad33b72d4db0af9f28adaab88c3ea64e2079b8801158.
  Cefrium: 142,575,821 bytes / 135.97 MiB / SHA256
  cf6e1c4047c8da027fc5ab3ab210f60d2e8e40815b441d12d4b7423e42404ed0.
  TE2 Termux: 165,543,164 bytes / 157.87 MiB / SHA256
  be5de6822b5a4a540694d6cc358ae2449b3745a8b6f1fe86b90582eb1518e3c5.
- [x] User approves grouped Pixel updates. Stream all three verified APKs through
  pv/ADB in place; three Success results, installed version names/code verified.
  No app-data clear or shared-framework restart. Final live acceptance pending.
- [ ] Exact-source Linux private-Python 3.14 wheel below 100,000,000 bytes and
  fresh wheel venv joint ALS/FWS validation. Build root linux-0.2.356/work and
  final-linux artifacts are on /mnt/vdb. The reused manylinux image's ccache
  3.7.7 cannot accept per-target stats_log configuration; preserve failed log and
  resume via existing NO_CACHE=1, not a source/compiler/package-version change.
- [ ] Grouped final APK acceptance, separate wheel acceptance, then TE2 main
  merge/tag/GitHub/PyPI publication. Native Android wheel route is a separate gate.

## ALS RS 0.2.140 companion release preparation

- [x] User approves stable Python/Cargo version synchronization, source checkpoint,
  VPS build/tests and Linux private-Python wheel; stop before tags/uploads and
  Android build-route selection. ALS source checkpoint 3137509, Ferrous 4cdf5db.
- [x] Frontend typecheck/rebuild (no tracked drift), four subagent UI tests,
  35 focused Python tests and all 180 Rust tests pass on the VPS.
- [x] Linux manylinux wheel: 57,348,437 bytes / 54.69 MiB; SHA256
  1e10fbe276ab38171ee49b843bc07f418446e945b2d2a013198dd08c679f71c7.
  Twine/auditwheel and separate fresh Python 3.14 container / Python 3.13 Debian
  venv checks pass: MCP 38 tools/one resource, EOF cleanup, actual bundled Python
  3.14.6 libpython, dependency consistency and no retired dependency stack.
- [x] User approves isolated Pixel build and dependencies after device wipe:
  system Python 3.14.8, locally extracted Rust 1.99.1, four jobs, no global installs.
  Versioned API-24 C/C++ flags resolve fresh Termux headers rejecting unversioned
  targets; build exit 0. Twenty-six target Python tests pass.
- [x] Android ALS wheel: 9,794,152 bytes / 9.34 MiB; SHA256
  2f71db6948b0cddce439b2f4a1ea2738448de89de9540b6d8e27cfd7aeccdd70.
  Fresh Termux acceptance venv passes native MCP 38 tools/one resource/EOF,
  system Python ABI, uvloop-te2, FWS native pipe and retired dependency absence.
  Copied/hash-verified on VPS under als-0.2.140/android; Twine passes. No installed
  developer environment or shared runtime replaced; no publication yet.
- [x] User requires visible project folders for device builds. Move the entire
  Pixel ALS workspace to ~/projects/als-0.2.140-release, update build scripts and
  refresh its venvs; completed wheel checksum unchanged. Keep future release
  workspaces visible rather than placing them under the device's .cache root.
- [x] User confirms ALS live acceptance on desktop and Termux and authorizes
  publication of both validated 0.2.140 wheels. Joint TE2 validation is separate.
- [x] Add official Termux codex package/executable to managed installer
  prerequisites and manual README instructions; remove the npm workaround.
  All 17 Termux installer regression tests pass.
- [x] Publish both ALS wheels to PyPI 0.2.140 and verify public SHA-256 hashes
  match the accepted Linux/Android artifacts above. TE2 merge/publication remains
  separate from the companion ALS release.

## Live approval routing correction — 2026-10-27

Broader fail-closed built-in asset routing is deferred by the user to .357 to
preserve this release schedule; see ../release_0_2_357/PLAN.md and TRACKER.md.
Keep this release's exact alias correction; do not expand into relay hardening.

- [x] User reports Gecko APK working, then identifies raw-JSON approval cards.
  Read-only console inspection of als:RP9w.AJIP confirms intact requestUserInput
  questions but generic fallback. Actual ESM URL uses extension ID codex-ext;
  the initially tested codex alias was wrong. Native local-origin import gets
  404 although the same module's bundled storage path returns 200.
- [x] Add exact codex-ext alias to Gecko WebExtension, shared Android server/relay
  and desktop inventory; keep the old codex alias and leave other extension APIs
  dynamic. Regression covers the captured failed URL and negative dynamic routes.
  Five cross-client Node tests, five actual Electron mapper tests and Electron
  typecheck pass; source inclusion alone was not adequate runtime proof.
- [x] Rebuild/install Gecko correction (1m 44s, 103,220,625 bytes; SHA256
  f2dff5a7cf9000675b82cd30af8e6df4f166843065449879a3e6039d1e150d4c).
  All 447 seed hashes and signature verified; expected codex-ext WebExtension
  route is present in the actual APK. In-place installation succeeds, no data clear.
- [x] Real Gecko worker als:RP9w.w1DM loads the actual codex-ext module from its
  new local asset origin with HTTP 200 / application/javascript / 34,618 bytes.
  Existing ALS 0.2.140 approval DOM now has both labeled choices, free-text input
  and Send, rather than JSON/Accept/Decline. No new approval, submission or shared
  framework/harness restart performed. Human response submission is not inferred.
- [ ] Carry corrected shared aliases into final Cefrium/Termux release APKs.

## Active consumer migration and isolated Cefrium R8 experiment — 2026-10-27

- [x] Checkpoint/push ALS approval asset and release-staging work as 747cfd12;
  no version bump, APK assembly/install or release publication.
- [x] User approves consuming upstream Electromux APIs in TE2 Termux, not another
  compatibility layer. Persistent service must retain framework ownership when
  an activity detaches; the calculator's UI-bound service is not a replacement.
- [x] Implement generic persistent consumer state + Electron effect/ACK seam
  upstream and a TE2 Home/Reload consumer migration. Internal framework-app Quit
  deliberately retains its existing semantics; it is not Electron app.quit.
  Native refusal/timeouts cannot terminate the persistent framework actor; failed
  window ownership retires without replay and requires a new explicit intent.
- [x] Upstream strict TS check and all 44 runtime tests pass, including unchanged
  pinned original calculator main/preload. TE2 strict consumer TS check and all
  20 navigation/framework-lifecycle/real FD/ACK tests pass on the VPS.
- [x] Updated native service/AIDL and TE2 Android sources compile; complete
  Termux Debug unit suite and generic host/Node suites pass. Vanished 0.9.0
  metadata required an invocation-only cache recovery init script (exact hashed
  old plugin JAR/SDK AAR, explicit AAR type, no synthesized Maven POM or version
  substitution). This is not proof of clean online dependency reproducibility.
- [x] Real FD coverage verifies concurrent build-state delivery, native ACK,
  failed/detached native window without stopping the owned framework, new-intent
  reattachment, and actual channel EOF cleanup. Calculator behavior is unchanged.
- [x] Upstream local checkpoint b62eb6c and explicit TE2 working-tree pin update.
  Upstream remains unpublished; TE2 migration is included in this checkpoint. Publish
  dependency before any consumer commit is pushed with this new gitlink.
- [ ] Grouped APK physical Home/Reload/reattach plus framework lifecycle
  acceptance. TE2 Termux parity staging candidates now assembled on the VPS;
  user-requested Pixel test follows, not production SDK adoption.
- [x] User approves a separate VPS Cefrium staging/R8 experiment. User identifies
  version 13 as R8-fixed; latest 0.15.0 is candidate, not an adopted production pin.
  See CEFRIUM_R8_EXPERIMENT.md. The initial experiment excluded installation;
  subsequent user approval authorizes Pixel candidate testing, not production adoption.
- [x] Controlled standalone Cefrium staging comparison: 166.84 → 135.97 MiB
  (30.88 MiB / 18.5% smaller); DEX 45.62 → 9.61 MiB, 11 → 1 files. Real keep-radius
  analysis, valid signatures/manifests/ARM64 and identical 447 asset hashes verified.
  Candidate-only query policy/JNI inspector adapter approved and 71 JVM tests pass.
- [x] Matched TE2 Termux builds include committed parity changes and embedded Node:
  163.18 → 157.88 MiB (5.31 MiB / 3.253% smaller). All 78 JVM tests pass; signatures,
  correct Termux package, ARM64 libraries and all 447 seed hashes verified. Candidate
  toolbar needs an additional loopback-only query policy; saved in experiment receipts.
- [x] Install verified TE2 Termux 0.15 parity candidate on Pixel in place with
  `adb install -r`; success, no app-data clear.
- [x] User TE2 Termux candidate acceptance: “Its working” after the correct
  parity/0.15 APK installation. Earlier standalone installation is not this acceptance.
- [x] Build/verify Gecko staging on VPS with JDK 21 / its separate AGP8 build:
  unit tests and assembly pass (1m 47s), 103,220,517 bytes / 98.44 MiB. Correct
  package/signature, ARM64-only libraries and all 447 seed hashes verified,
  including ALS approval JS; no source maps. Receipt: receipts/gecko-staging-apk.json.
- [x] User installs initial verified Gecko staging and reports “It's working fine.”
  Later approval-route defect and corrected APK/live DOM verification are recorded
  separately above; broad acceptance did not establish approval rendering.
- [ ] Generated-R optimized-resource-shrinker warning qualification, physical
  inspector/lifecycle/scaling/assets acceptance, and explicit adoption decision.
  Preserve production 0.9.0 pin; this remains separate from consumer migration.

## VPS release staging / Electromux and approval assets — 2026-10-27

- [x] User selects current checkout, VPS /mnt/vdb for all build/package work,
  Pixel pixel-9-pro-xl:5555 for acceptance; Electromux, not Electrobun.
- [x] Clean standalone Electromux main fast-forwarded from 9922abf to existing
  TE2 pin 2976c4f; no new commit/push/gitlink change or downgrade.
- [x] Document source-backed 11-family matrix, bounded bridge proposal and
  separate API/build/device/publication gates in ELECTROMUX_PARITY_AND_RELEASE.md.
- [x] Inspect /mnt/vdb (233 GiB initially available), default toolchain mismatch,
  reusable Android tools and existing Docker root-disk storage. Pixel connected.
- [x] Verify baseline VPS sources: 6,538 TE2 tracked blobs and 136 Electromux
  blobs (standalone and pinned consumer), honoring declared CRLF attributes.
  Node 24/JDK 25/Android SDK/NDK and pinned Node SDK staged under /mnt/vdb;
  isolated Python 3.14 validation environment and jq available. Baseline and
  subsequent uncommitted overlay receipts are separate; not publication candidates.
- [x] Find ALS approval gap: Codex request-card JS is outside vendored static
  inventory/interception; main static bundle alone is insufficient. Existing APK
  seed is older than the pinned ALS assets. Symptom causality not fully proven.
- [x] Approve and implement exact-module vendor/routing/required-file/test fix; keep
  schemas/config/RPC dynamic, never cache an entire extension API prefix.
- [x] Regenerate seed on VPS: 447 files, 43 MiB, all 151 ALS resource hashes
  verified including approval renderer; source maps excluded. Four Node tests,
  five Python vendor/provenance tests and six Gecko JVM tests pass; strict mypy
  with disallow-any checks passes for the two changed Python files.
- [x] Build approved APK candidates and verify all 447 seeded asset hashes,
  including approval module/core bundle/CSS, in Gecko, Cefrium and Termux APKs.
  New interception rules require the APK update, not just OTA. Candidate device
  acceptance and production SDK adoption remain separate gates above.
- [ ] Pixel approval acceptance: question choices/freeform, submit, cancel/reopen,
  page reload, command/file approvals and no stale module/core mixed generation.
- [ ] Approve concrete Electron-compatible bridge subset and regression scope;
  preserve native service/FWS/readiness ownership and independent calculator.
- [ ] Prove VPS Android wheel lane before full native builds; no silent Pixel
  compilation fallback. Group APK and wheel acceptance separately before release.

## Mobile terminal selection handle handedness — 2026-10-26

- [x] Shared terminal helper uses left-facing start and right-facing end bulbs,
  retaining existing cell anchors, stems and touch-target dimensions. Endpoint
  styling/accessible labels swap when a physical handle crosses its peer.
- [x] Code TE2/standalone helper copies remain identical; File Explorer consumes
  the Code TE2 helper. Touch selection regressions cover shapes and crossing.
  All 29 terminal touch tests pass, including actual endpoint crossing.
- [x] User confirms handles look and work correctly; retain the existing stem
  for now as a visual offset indicator. Further touch-target offset changes are
  deferred, not implemented. Helpers are served separately,
  so no JS bundle rebuild is required. No backend change, APK build or Android
  seed publication performed; existing OTA/bundle inventory paths are unchanged.

## Extension dependency warnings / plain comparison reset — 2026-10-26

- [x] Uninstall dependency refusals name the blocking extension and tell the user
  to uninstall dependents first. Full stdout/stderr stays in worker logs rather
  than RPC/toast text; unrecognized failures point to those logs with the exit code.
- [x] History status menu offers `Plain editor | Plain editor @HEAD`, separated
  vertically. Original action preserves the reference; @HEAD uses the existing
  host backend mode/ref intent to reset HEAD and disable diff display. Neither
  action replaces document contents.
- [x] 18 Python marketplace/uninstall tests and three comparison/frontend tests
  pass. Strict mypy plus disallow-any checks pass for the two changed Python
  files; frontend/WBA typecheck reports zero Any findings/diagnostics. Bundles rebuilt.
- [ ] User live acceptance after activating backend and updated frontend assets.
  No agent-triggered runtime restart, mypyc build or Android asset publication.

## ALS compact sub-agent activity / vendored snapshot — 2026-10-26

- [x] ALS correction checkpoint b77e7d5 includes bounded shell/MCP/tool activity,
  throttled prose, running fallback, non-sticky headers and completion anchoring.
- [x] User confirms concurrent live activity works while the parent reads README.
  Full iframe child transcripts remain deferred in ALS's SUBAGENT_ACTIVITY_PLAN.md.
- [x] TE2 vendored assets refreshed: 150 hashes verified and three proxy/intercept/
  OTA contract tests pass. APK build, runtime restart and publication not performed.

## Termux installer execution-environment refresh — 2026-10-26

- [x] Source audit: prerequisite installation previously skipped installed but
  stale Termux support packages and used apt -y without dpkg conffile policy.
- [x] User approves targeted installed `termux-*` refresh plus core/exec/tools,
  explicit packaged-configuration replacement, fresh login handoff, mocked tests
  and release planning. No device upgrade or Android modification is approved.
- [x] Read installed names/status through dpkg-query; no apt-display parsing or
  installer dependency on ripgrep. Refresh metadata and reinstall/upgrade selected
  packages with `--force-confnew`/`--force-confask`; retain checked apt failures.
- [x] Replace the installer process through packaged Termux login before ABI/Node
  validation and acquiring the lock. Preserve quoted arguments; internal handoff
  flag prevents recursion. Uninstall/rollback and Linux do not enter this flow.
- [x] No-Python shell bootstrap requests core support with explicit confnew policy.
- [x] Local validation: 52 installer/release/native-source tests and 6 subtests
  pass; shell syntax and strict mypy on the installer pass. Package operations
  and login handoff are mocked, not live Termux acceptance.
- [ ] Device acceptance from stale Termux login/profile/package state: updated
  support libraries, fresh child environment, Node launch, installation and repeat
  invocation. Fresh-install and cancellation/failure behavior also need acceptance.
- [ ] Separately qualify Electromux's hardcoded legacy LD_PRELOAD library against
  current Termux packaging; no client/API/Android edits in this installer slice.

## Owned frontend/WBA no-Any cleanup — 2026-10-25

- [x] User approves compiler-backed explicit/inferred audit, owned-source cleanup,
  WBA resolution/diagnostic fixes, enforcement, AGENTS rules and bundle validation.
- [x] Replace 81 explicit Any type nodes in host controllers/globals; fix inferred
  propagation from JSON, Array.isArray, DOM callbacks, IDB, dynamic imports and
  Socket.IO defaults. Host console bridge is now TypeScript.
- [x] WBA source imports actual TS implementations; AST-based build rewrite emits
  .mjs runtime module specifiers without rewriting webview document strings.
  Fix all 106 former WBA diagnostics; missing MainThreadLanguageFeatures pin 26
  verified against local pinned Code OSS actor order (Console 13/Diagnostics 16).
- [x] npm run typecheck gates both projects: zero owned-source explicit/inferred
  Any findings and zero compiler diagnostics. Negative fixtures cover nested
  aliases, arrays/maps, parameters, class members/returns, assertions and inferred
  JSON/untyped-call results; checked unknown remains allowed.
- [x] Copied upstream/adapted internals unchanged; owned consumed values remain
  audited. SCM source-integrity and isolated installed WBA fixture pass.
- [x] Focused checker/console/SCM/isolated-WBA run: 29 pass. Settings/quick-fix/
  webview/multi-client/run-profile run: 35 pass. Production bundles rebuilt.
- [x] Broad initial sweep: 866 pass, 20 fail, one skipped. Two cleanup-related
  fixture/integrity issues repaired; other 18 failures reproduced against HEAD
  in .codex-scratch/typing-baseline.ky91yu. Baseline startup-preparation fixture
  additionally needs app/android_editor_assets_bundle.json for exact assertion;
  its fixed import-count assertion now includes the typed value helper.
- [x] Final broad sweep after rebuild: 889 tests, 871 pass, 17 baseline failures,
  one skipped. No newly failing tests remain. Python webview/sidebar regressions:
  14 pass. Baseline failures remain test debt, not a whole-suite green claim.
- [x] User reports all tested working and approves commit/push (2026-10-25).
  Live acceptance covers the resulting cleanup and accumulated extension fixes.
  Agent did not restart the shared runtime or publish Android assets.

## Restored extension surface readiness — 2026-10-25

- [x] JSON Crack cold-open fix accepted live by user.
- [x] Saved extension URL slots are eager but previously bypassed app readiness.
  Preserve their presentation state; admission now comes from process-local,
  per-project/per-host WBA surface confirmation, never persisted readiness.
- [x] Gate embedded, native Electron and detached surface mounting; reset
  admission on adapter reset/non-authoritative disconnect snapshots and publish
  readiness changes even when disk membership is unchanged.
- [x] Initial WBA snapshots cannot prune restored slots before primary activation
  completes. Partial activation admits available views without waiting for others.
- [x] 33 focused Node tests and 14 Python tests pass; frontend typecheck/build
  and strict typing of both changed Python owners pass.
- [x] User accepts the tested snapshot and approves commit/push (2026-10-25).
  Agent did not restart the shared runtime or publish Android assets.

## Webview startup, file links and icons — 2026-10-25

- [x] User approves read-only source/Electron inspection, then all three fixes.
- [x] Confirm premature unfenced head-bridge ready and missing generic link-click
  forwarding against local Code OSS. JSON Crack has its own React-ready handshake;
  do not claim its partial-layout cause is established from this source alone.
- [x] Live image checks: Markdown Sidebar fetches nonexistent $(markdown), and
  Code Visualizer fetches absent media/icon.png; both return HTTP 500.
- [x] User reports warm JSON Crack window refresh fixes rendering; cold creation
  versus warm refresh is the live comparison, not yet acceptance of this patch.
- [x] Implement document-load readiness, bidirectional incarnation fences,
  bootstrap HTML-revision admission and loading overlay handoff. Preserve startup
  journal/reconnect behavior without arbitrary timers or extension-source patches.
- [x] Implement guarded file-link navigation through exact-client existing owner;
  extension-handled links/fragments remain untouched, commands require policy.
- [x] Implement ThemeIcon projection and missing-image package-icon fallback;
  retain package icon through existing management manifest merge/sanitization.
- [x] Frontend typing/build pass; 61 focused Node regressions and 13 Python tests
  pass. Strict mypy passes both changed Python owners. Whole-WBA typecheck
  retains the same 106 pre-existing diagnostics versus an in-memory HEAD-source
  comparison (no new diagnostics), not a clean whole-WBA typing claim.
- [x] User reports tested working and approves the resulting snapshot for
  commit/push (2026-10-25); JSON Crack cold-open success was separately confirmed.

## Editor properties / Markdown preview sync — 2026-10-25

- [x] Read-only Electron inspection confirms registered bridge/eval with forwarding
  enabled; current Monaco has a real viewport distinct from cursor position.
- [x] Source diagnosis: Markdown TopmostLineMonitor listens to visible-range
  changes; TE2 sends only initial ranges and later selection-only updates.
- [x] User approves bounded visible-range, multi-selection and resolved-option
  event projection using the existing typed WBA lane and local Code OSS source.
- [x] Implement typed, bounded, independently deduplicated properties projection
  with exact-client/path/generation and lifecycle guards.
- [x] Frontend typecheck/build and new WBA editor-state contract strict typing
  pass; 49 focused frontend/WBA/client/webview regressions pass. Whole-WBA
  typecheck has 106 existing diagnostics: in-memory HEAD-client comparison
  produces the same 106 with no new/resolved diagnostics. This is not a clean
  whole-WBA typing claim. Local Code OSS reference is ../code-server/lib/vscode.
- [x] Read-only live Monaco inspection verifies actual resolved cursor/line-number
  enum values and model originalIndentSize getter match the new projection.
- [ ] Activate matching host assets and restart WBA with explicit permission.
- [ ] Live acceptance: editor↔Markdown preview scroll/selection, options,
  file switches/reconnect and multiple clients without cross-target effects.

## App-agnostic framework / manifest refresh

- [x] User clarifies Refresh means reread manifests and remap app entrypoints/
  routes, especially second-root apps—not indiscriminate worker restarts.
- [x] Read-only audit confirms existing framework/Electron/Android/Termux buttons
  reach POST /api/apps/reload; registry reload is live, but SioRouteIndex and
  physical Engine.IO mounts remain startup-owned. No refresh was invoked.
- [x] Explain worker selection: common native manifest/fingerprint/cache selector
  is reusable; bootstrap discovery is built-in-only and Code TE2 domain/package
  policy is bespoke. Frozen bootstrap environment is not live binary resolution.
- [x] User requires app-agnostic production framework behavior and approves a
  broader audit/staged plan. Inventory real production identity/import/path
  coupling separately from inline test fixtures in FRAMEWORK_AGNOSTIC_AUDIT.md.
- [x] Record Stage A generic native declaration/no-build selection, Stage B atomic
  catalog/routes/launch-context refresh, Stage C app-owned policy migration and
  Stage D source guardrails/isolated acceptance. No runtime source edits/builds,
  worker/framework restart, APK publication, version bump or commit in this audit.
- [x] Resolve/approve the concrete cross-language generic selection contract;
  reuse existing fingerprint/receipt logic rather than duplicate it in Rust.
- [x] Implement individually approved slices with neutral second-root/native
  fixtures, failure rollback, active-owner survival and permission parity.
- [x] User reports live acceptance of pipe actions, intents and Embedded App
  Presentation State after source work. This records user-run validation, not an
  agent-observed deployment/profiling claim or permission for another restart.

This design gate precedes the deferred network RPC slice. Existing uncommitted
PyO3 work and user's shellspec/report/untracked files remain preserved.

### Approved bootstrap slice — 2026-10-22

- [x] User separately approves configured-root discovery, generic typed no-build
  selection and app-owned runtime preparation. No Rust refresh wiring, native/
  full mypyc build, restart, Android change, version bump or commit.
- [x] Discovery follows configured TE2_SERVER_APP_ROOTS in registry order,
  including second roots and manifest ID/directory-name differences. First app
  wins, including when it has no native declaration; shadowed providers are not
  loaded. Distinct apps cannot overwrite one environment export key.
- [x] select_native_build exposes executable/receipt/fingerprint/compatibility/
  usability through the existing shared selection policy, without publication.
- [x] Code TE2 declares runtimeProvider in its own native manifest. App-owned
  native_runtime.py retains editable selector/force overrides, packaged private
  Python/ABI validation and no Cargo fallback. Bootstrap contains no Code TE2
  identity/import/environment literals. Failed preparation leaves caller env
  unchanged (already completed explicit builds are not rolled back).
- [x] Focused bootstrap/private-runtime/identity/discovery suites: 92 tests pass,
  including two independent packaged providers and no-build receipt/force parity.
  Strongest strict/extra/all-Any Code TE2 audit passes 248 source files; the new
  provider and shared contract independently pass the same policy. A supplemental
  bootstrap-only strict check reports six pre-existing issues in CLI shutdown/
  subprocess handling and a redundant manifest cast, not a clean-bootstrap claim.
- [x] Select and implement the Rust-facing read-only owner/receipt exchange (A2).
- [x] Implement separately approved B atomic registry/routes/future-launch-context
  refresh in source. Runtime adoption remains separately gated; A1/A2/B source
  changes do not update the currently running framework.

Existing setuptools wheel deprecation warning remains visible. Native builds,
activation, live refresh and client publication were not performed.

### Stage A2 — private selector contract

- [x] User approves private read-only selection owner plus typed Rust client and
  tests; subsequently approves focused Cargo unit-test compilation, not a
  production binary build/publication or runtime restart.
- [x] Bootstrap issues bounded 64 KiB source/profile/runtime preparation context;
  app-owned provider setup remains explicit preparation only. Read-only selector
  rechecks current declarations/fingerprint/ABI receipts and packaged executable
  digest, returning ready/build_required/preparation_required without building.
- [x] Existing runtime sidecar mounts capability-protected, no-store private
  endpoint with typed 4 KiB request/1 MiB response bounds. No caller-supplied
  roots/env/profile, no arbitrary provider execution, no full environment echo.
  Single-flight admission survives requester cancellation; manifest SystemExit
  cannot terminate its event loop. Missing old-peer context fails explicitly.
- [x] Rust client requires supplied key/numeric-loopback HTTP and disables
  environment proxies, redirects and retries. Strict response schema/IDs/keys,
  profile/status and bounded streaming reads; no lifecycle or reload caller yet.
- [x] Python grouped owner/discovery/bootstrap/private-runtime/identity/sidecar
  tests: 102 pass. Includes declaration mutation during preparation refusing
  a misleading fresh receipt; caller environment remains untouched. New shared
  contract/owner pass strongest strict/extra/all-Any.
- [x] Focused Rust tests: 3 pass under --no-default-features, including isolated
  HTTP capability/request shape and redirect refusal (one request, no follow).
  Full Code TE2 strongest audit: 248 source files pass. Existing no-feature Rust
  dead-code/unused warnings remain visible; no production artifact was published.

Stage B below implements atomic registry/routes/launch selection publication and
isolated concurrency/owner-survival tests. The A2 generation remains a selection
projection digest, not a filesystem transaction or catalog commit.

### Checkpoint and Stage B — 2026-10-22

- [x] User requests checkpoint: 6eb74ed6 commits completed ingress and A1/A2
  source/docs/tests. No version bump or push. User shellspec overrides and
  untracked reports remain excluded/preserved. B changes are subsequent work.
- [x] User emphasizes that app initialization and intent policy belong to the
  replaceable manifest configuration, not framework app-name branches; approves
  concrete Stage B implementation and isolated tests, not runtime activation.
- [x] AppCatalog groups registry/entrypoints/raw intent policy, referenced socket
  JSON and shellspec YAML, native declaration proofs and native selection under
  one immutable Arc generation. Configuration reads are bounded (1 MiB/file,
  4,096 files/16 MiB inventory); genuine I/O failures reject refresh.
- [x] Existing HTTP and native MCP reload now share candidate construction,
  declaration/proof rechecks and one catalog publication. Concurrent refresh is
  rejected; a launch read permit stays inside its blocking task even if the
  caller cancels. Startup retains broken-app catalog visibility but cannot
  install unsafe socket mounts through a lenient fallback.
- [x] Dynamic HTTP/upgrade dispatch uses the captured route rather than fixed
  startup Axum mounts. Canonical/declared-alias app prefixes and legacy *_ws
  aliases are guarded; protected framework/proxy surfaces, encoded/dot paths,
  collisions and cross-owner overlaps reject the candidate.
- [x] Launch uses the captured shellspec and current native selection; prepared
  native values remain defaults, preserving explicit shellspec/app overrides and
  existing framework-forced launch identity. No global environment mutation,
  source build or old-executable fallback on missing preparation.
- [x] Refresh no longer replaces running-app ownership from a discovery scan.
  Return/event summary adds generation, added/changed/removed, restart_required
  and native_status while retaining count. No workers are stopped/restarted.
- [x] Real isolated HTTP + upgraded WebSocket test covers add/change/remove,
  removed alias reachability, old connection/owner survival and invalid-candidate
  rollback. Further tests cover source/reference mutation, second roots, intent
  policy changes/errors, source bundled-app compatibility, protected routes,
  launch environment precedence and actual overlapping refresh admission.
- [x] Final full Rust suites: default features 248 pass / 5 opt-in ignored;
  no-default-features 204 pass / 5 ignored. Python owner/bootstrap/private-runtime/
  identity/sidecar group remains 102 passing tests. No new Any/type suppressions.
  Candidate scan and final recheck own their admission guards across blocking
  work, so HTTP cancellation cannot permit overlapping unfinished scans/spawns.
Activation contract: A1/A2 bootstrap/bridge and B server are adopted together;
B alone needs no Android/OTA/client source change or new mypyc rebuild. The
later user-reported App IPC acceptance is recorded below, not a new validation
phase. No agent-triggered shared-runtime transition occurred during source edits.

Test nuance: placing TMPDIR inside this Git checkout makes three existing
non-repository fixtures discover the parent TE2 .git. User explicitly approves
/home/mrsurge/knowhere/.te2-catalog-tests for isolated full-suite TMPDIR; no Git
production behavior or unrelated test source was changed to hide those failures.
Existing opt-in test skips stay visible. B alone did not remove app-specific
policy; the separately approved Stage C source migration is recorded below.

### Stage C — 2026-10-22

- [x] User approves framework/app policy changes and isolated tests; explicitly
  chooses to defer shared-runtime validation until after this source work.
- [x] Add bounded fail-closed AppPolicy and manifest declarations for intent
  callers, unique shortcut provider, exact CORS, explicit alias-state migration
  and exact-parent workbench diagnostics. Catalog validates before publication.
- [x] Replace generated Python WBA relay code with a structured authenticated
  exact-target pipe operation and app-owned handler. Public MCP interface stays
  compatible; no arbitrary app Python import remains in framework source.
- [x] Reuse bundle-manifest version owner from the Rust service-worker handler,
  without modifying frontend assets or generating/publicizing new bundles.
- [x] Production app-ID audit: remaining built-in names outside frontend assets
  are test fixtures; filesystem pipe origin_name was also confirmed test-only.
- [x] Final Rust suites: 252 pass default features; 207 pass without default
  features; five existing opt-in tests ignored in each. Existing no-feature
  unused/dead-code warnings remain visible. Python group: 126 pass (existing
  setuptools bdist_wheel deprecation warning). Stronger strict/extra/all-Any
  Code TE2 check: 248 source files pass. Targeted rustfmt and diff checks pass.
  New tests cover receiver permission rejection, provider absence/ambiguity,
  invalid declarations/foreign migration aliases, exact CORS path/origin matching,
  data-only WBA relay, disabled diagnostics and off-loop correlated replies.
- [x] Stage D neutral-fixture/source-policy guardrails implemented with explicit
  user approval, including retired editor alias removal from framework fixtures.
  Launcher now owns a neutral fixture, not a real app shellspec dependency.
  Manifest-derived Rust-source guard passes (two Python tests); no runtime module
  or test block excluded. User-specified identity grep returns zero hits.
- [x] Stage D full Rust suites after neutral fixture replacement: default 252
  passed; no-default 207 passed; five opt-in ignored in each. Nine focused Python
  source-guard/structured-debug tests pass. Existing no-default warnings remain.
  Removed the newly unused test-only shellspec reader; real app bootstrap and
  shellspec contract coverage remains outside framework crates in Python tests.
- [x] User reports all pipe actions, intents and app presentation-state behavior
  working and considers validation complete. No extra validation phase is queued.
  The agent did not perform a runtime transition during source/docs edits.
  Deployment contract remains matched framework/bridge preparation plus Code TE2
  domain/mypyc adoption when selected; acceptance is not automatic publication.

### Reference consolidation — 2026-10-22

- [x] User approves documentation-only CODE_TE2.md update: declarative app IPC/
  catalog refresh/native selection, Embedded App Presentation State terminology,
  original-byte ingress and structured WBA diagnostics. Correct related obsolete
  central-native-registry, mandatory-scratch-domain, FastAPI fallback and dependency
  descriptions; retain stable numbered sections and app-owned compatibility data.
- [x] Finish targeted source-path/reference, stable section-number and diff checks.
  Documentation-only: no build, runtime transition, publication or version change.

## Mypyc live target progress

- [x] User-approved observation-only progress on the existing build command:
  generated C target inventory, flushed completed/total stdout lines after
  successful compiler returns, and explicitly labeled up-to-date extensions.
- [x] Preserve detailed build.log, existing concurrency/cache policy, failed-target
  semantics and verified-snapshot reuse. Restore compiler callback on failure.
- [x] Focused workflow suite: 31 passed, one opt-in compiler benchmark skipped;
  covers serial/parallel callbacks, duplicate source names across extensions,
  redirected compiler output, cache skips and compiler failure.
- No full compilation, artifact activation, native build, runtime restart or
  client publication performed for this slice.

### Cache labels and reported post-compile validation failure

- [x] User approves per-target ccache labels for future builds. Isolated stats
  logs and official JSON statistics distinguish hit/miss/uncached/unknown without
  global counter resets, cache deletion, timing guesses or environment races.
  Setuptools call/spawn compatibility and failure-safe callback restoration stay
  covered; up-to-date extension skips remain separate from cache hits.
- [x] Inspect latest cache `0cb157597c9ecb8a2d5436cb/build.log`: compiler/linker
  reached completion; original validator stderr was inherited, not retained
  there. Re-import retained compiled outputs in disposable roots to reproduce:
  `TypeError: @runtime_checkable can be only applied to protocol classes`,
  at native_socketio.NativeEventHandler. No rebuild/activation for diagnosis.
- [x] User separately approves correction: extract NativeEventHandler and
  QueueSizeReader to interpreted native_runtime_contracts.py; keep Socket.IO
  and diagnostics-metrics implementation modules compiled. No weakened typing.
- [x] Focused grouped regressions: 70 passed, one opt-in compiler benchmark
  skipped. Includes real isolated ccache miss→hit and actual build_ext labeling,
  malformed/missing/failed observations and interleaved context isolation.
- [x] Separate two-module real mypyc fixture passes compilation/import and
  runtime Protocol checks (12.14 seconds). Full strict/extra/all-Any Code TE2
  audit passes all 247 source files. Full editor snapshot rebuild/activation
  remains unperformed; no worker/framework restart, OTA or native build.
- Existing cache statistics show 769 hits/4,891 misses across historical builds,
  0.4/1.0 GiB used. These cumulative counters cannot identify the last build's
  hits; the new per-target reports provide that evidence on future builds.

## Compiled cutover live probe and DTO correction — 2026-10-21

- [x] User's shellspec workaround is preserved as user work. Confirm replacement
  Code TE2 worker `frs_1792595806125_3267904_7_7` reports 146 overlay modules,
  has nonempty CODE_TE2_MYPYC_DIR and maps the snapshot's shared mypyc/native_worker
  libraries. Earlier force=0 alone still had an empty selector and no mappings.
- [x] Exact ALS log at 16:15:56 shows `file.open` with line=59/column=1 and full
  qualified presentation proof. Pipe returns `appIntent.failed: ValidationError:
  Expected type, got int - at $.column`; delivery itself did not silently drop.
- [x] Disposable imports of the active snapshot reproduce erased msgspec fields:
  nullable coordinates/identity strings become runtime `type`. User approves
  moving three DTO definitions to already-interpreted sidebar_rpc_contract.py,
  keeping the host dispatcher compiled and strict unknown-field/type admission.
- [x] Actual compiled first-call dispatch exposes an additional package-import
  reference that remains None unless cwd.get initialized it. User separately
  approves direct lazy module import, preserving the owner and load timing.
- [x] Real three-module mypyc fixture passes (26.47 seconds): correct runtime DTO
  identity, integer/default/null coordinates, qualified strings, rejection of
  malformed fields and file.open→existing owner without a prior CWD request.
- [x] Focused source/workflow suites: 97 pass, one opt-in compiler benchmark
  skipped. Full strict/extra/all-Any check passes all 247 Code TE2 files.
- [ ] New mypyc snapshot build/activation and Code TE2 worker refresh/live diff
  link acceptance. No full build, snapshot activation, restart or publication
  performed by agent. No ALS rebuild/frontend/OTA needed for this receiver fix.
- [ ] Separate ALS frontend Markdown link parsing issue: `/absolute/path#L198`
  was treated as a same-origin HTTP URL. User explicitly distinguishes this
  from the intent failure; no frontend fix or ALS edits performed in this slice.

## Current work order

1. Startup/HTTP initialization: user live accepted 2026-10-20, complete.
2. Framework-pipe intents and Embedded App Presentation State (O1): user reports
   working; Any cleanup and app-agnostic refresh follow-up are source-complete.
3. O2 byte-ingress/native-type slices N1–N5: source complete and user live
   accepted, including N5 search coverage on 2026-10-24. Async bridge production
   adoption remains separately gated; remaining Code TE2-side multiprocessing,
   multithreading and event queuing is deferred to .357 (2026-10-26).
4. Git-init footer is user accepted/committed. Connected-but-quiet console policy
   is implemented. Cefrium socket fix awaits user's APK test. User defers ALL
   remaining console/MCP work (2026-10-25); see end-of-tracker backlog.
5. User suspends O3 pipe socket routing indefinitely (2026-10-25); raw/zero-copy
   pipe codec flattening is deferred to next-version investigation. No automatic
   resumption or .356 transport/codec implementation. Async-runtime findings may
   be reviewed independently; production adoption remains unapproved.

Validation belongs within each work phase, never a replacement for actual work.

## O2 — conversion/allocation overhead: delivered slices and deferred continuation

- [x] User prioritizes this after the Sidebar/typing checkpoint; approves plan/
  tracker edits and read-only source investigation before runtime changes.
- [x] Map framework pipe, socket submit/ACK, FWS and WBA seams in native_worker.py,
  pipe_codec.py and native worker code_te2.rs/values.rs. Current typed schemas
  do not make the recursive Python/Rust value conversion disappear.
- [x] Identify a bounded first candidate: every WBA push is re-encoded solely
  for payload_bytes telemetry, even when diagnostics metrics are disabled.
  Trace all uses: accounting is metrics-only, not a queue-size admission guard.
- [x] Obtain concrete approval, then gate counting serialization at intake on
  the existing metrics policy. Keep enabled-mode accounting, event ordering,
  coalescing and wire/validation contracts unchanged. O9 stays deferred.
- [x] Test disabled mode never invokes counting encode; enabled mode preserves
  byte counts; replies/startup and push delivery retain existing behavior.
  Run focused WBA/Python tests and strict typing; no native/full mypyc build or
  activation/restart without separate approval.
- [x] Focused WBA codec, diagnostics telemetry/coalescing, shell-adoption and
  intelligence-startup regressions: 24 tests/two subtests pass. Full strongest
  strict/extra/all-Any check passes all 247 Code TE2 source files. No native/full
  mypyc build, activation, restart, publication or commit performed.
- [ ] Matching interpreted worker refresh or new compiled mypyc build/activation
  and worker refresh, followed by live WBA/diagnostics acceptance. No Rust worker,
  frontend or OTA change is required by this Python-only gate.
- [x] Separately approve/build/run isolated graph/buffer boundary probe using
  existing native converters/guards and real Python envelope projection. Five
  valid fixtures pass in interpreted and existing compiled modes; ten invalid
  inputs reject. Strict helper typing and locked/offline release example build
  pass. Exact modes/results/commands: BOUNDARY_PROBE.md.
- [x] Record mixed result rather than cut over: inbound control/nested improves,
  binary regresses; outbound gains largely disappear with compiled projection.
  Plain msgspec accepts sets the current converter rejects; datetime rejection
  stage/messages differ. No complete semantic parity or end-to-end/RSS gain.
- [x] User approves inbound-only framework-pipe implementation/tests; generated
  search/Git responses are the stated target. Capture original bounded bytes
  under the existing native decoder, direct typed decode to the existing router;
  preserve error replies and synchronous dispatch order. Outbound/WBA unchanged.
- [x] Real Rust→Python dispatch passes interpreted and newly compiled two-module
  modes: 181 schema/value/error-message cases, 20 matching dispatch events,
  corruption/handler failure stops and no replay. 19 focused Python tests/two
  subtests pass; strongest no-Any check passes all 247 Code TE2 source files.
  Explicit strongest typing also passes pipe_codec and native_worker; strict
  probe/test helper checks pass. Native check/decoder/full-worker tests recorded
  in BOUNDARY_PROBE.md. No full domain mypyc build or live transition.
- [x] Measure original-frame acquisition: compiled search/Git fixture conversion
  ~24% lower, binary ~20% slower, wide roughly unchanged/slightly slower.
  BOUNDARY_PROBE.md records exact table/modes and uncontrolled system-load caveat.
- [x] User reports rebuilding matching native/domain artifacts and successful
  runtime adoption for the framework-pipe slice. User further reports searches
  through roughly 6,000 files without prior stutters/hangs. This is qualitative
  live acceptance, not independently verified artifact provenance or measured
  speedup/backpressure. No agent-initiated restart/publication performed.
- [x] Defer search benchmark repair at user request; do not rebuild an old-tag
  baseline solely to quantify the already accepted qualitative improvement.
  MessagePack as the benchmark's cause remains a user hypothesis, not diagnosis.
- [x] Audit WBA/network ingress: WBA backend control pipe and generic network
  Backend.call convert native graphs; direct WBA browser sockets bypass Python.
  Source paths and distinct follow-up boundaries: INGRESS_AUDIT.md.
- [x] User approves WBA-first: shared native framer returns exact validated frames
  to Python msgspec decoder before unchanged reply/push handling. Preserve native
  bounds, EOF/replacement/batch-error behavior; no outbound/direct-socket changes.
- [x] WBA focused regressions: 22 tests/two subtests pass, including small actual
  mypyc adapter build. Strongest no-Any checking passes all 247 Code TE2 files.
  Native full-worker tests: 44 pass. Real PyO3 stream→adapter→stdout-consumer
  probe passes source and compiled adapter paths. Subsequent codegen coverage
  also checks the compiled stdout consumer; full-domain rebuild stays separate.
- [x] Real-stream local probe records ~23%/~37% lower compiled diagnostics/reply
  conversion; binary-heavy fixture ~8% slower. Preserve all scope/copy/guard/load
  caveats and exact reproduction in INGRESS_AUDIT.md; no live WBA speedup claimed.
- [ ] Prepare/adopt matching native worker and full domain/mypyc for this **new**
  WBA slice, with explicit lifecycle approval and live diagnostics/backend-RPC
  validation. Prior framework-pipe acceptance does not accept this later change.
  No frontend/OTA/Node/WBA source publication needed; no activation performed.
- [x] Develop/approve the distinct network MessagePack RPC handoff using original
  validated payload bytes plus native socket context; retain current handlers,
  admission, ACK/error/cancel and direct-proxy behavior. Source now implemented;
  detailed scope and parity boundaries are in INGRESS_AUDIT.md.
- [x] Preserve native parse/framing guards, original bytes, separate SocketRef
  identity and prior wrapper conversion budget. Reuse existing Future/admission
  code, with no uncertain replay or frontend/wire/outbound migration.
- [x] Real source and three-module mypyc submit/Future/namespace parity passes;
  real-PyO3 probe passes 24 cases in each mode and reports actual .py/.so modules.
  This is isolated synthetic dispatch, not live socket/profiling acceptance.
- [x] Final native full-worker tests: 49 pass, including wrapper depth/node
  budget parity and original-frame/codec guard regressions. Source/three-module
  mypyc parity tests: 2 pass; existing editor/UI RPC and inbound-router group:
  18 pass. Strongest strict/extra/all-Any Code TE2 check: 249 source files pass.
  Probe/test helpers pass strict mypy; targeted formatting/diff checks pass.
- [x] User reports everything working after testing the new network slice and
  requests commit/push. Record user-run live acceptance, not independently
  measured throughput or agent-observed artifact provenance. No frontend/OTA/
  framework build is required by this slice; the agent performed no transition.
- [x] Record user-requested mypyc-native-type pass immediately after PyO3
  optimization: hot reusable records, numeric loops and repeated dictionary
  accesses with clear benefits, not eliminating all PyObjects.
- [x] After boundary measurements, identify/approve bounded native-type candidates
  and verify compiled/interpreted behavior plus actual cost reduction. Keep
  runtime-inspected DTO/Protocol contracts compatible; no blanket rewrite.

### Async bridge feasibility — 2026-10-23

2026-10-25 review: confirmed the isolated async-completion probe was actually
implemented/tested, not just a docs skim. Production still parks in spawn_blocking
around concurrent Future.result(120.0); worker pins PyO3 0.28.3 and probe uses
pyo3-async-runtimes 0.28.0. Probe source/compiled × asyncio/uvloop parity and
thread-wait occupancy findings below remain isolated evidence, not production
or Android adoption. User asks applicability review; no new runtime edits/tests.

- [x] User requests pyo3-asyncio/uvloop usefulness investigation, then chooses
  Record findings only. Runtime and dependencies remain unchanged.
- [x] Upstream docs/0.28 manifest support uvloop and explicit loop/context binding;
  pyo3-async-runtimes 0.28 is the candidate matching the worker's PyO3 0.28.3.
  This is upstream evidence, not TE2/private-runtime/Android qualification.
- [x] Identify actual candidate: replace the parked spawn_blocking Future.result
  wait with awaitable completion while retaining existing domain-loop ownership,
  typed byte boundaries and accepted-work admission. Concurrent Future adaptation
  needs qualification; no proven speedup or shared-loop/GIL-removal claim.
- [x] Separately approve an isolated existing-path versus async-bridge probe on
  asyncio and uvloop, including cancellation/timeout/shutdown/context/codegen and
  bounded-concurrency costs, before choosing production dependency/runtime edits.
  Full design/evidence is in PLAN.md, Async bridge feasibility. Native-type audit
  remains scheduled; no automatic reprioritization by this research entry.

### Native-record and async-completion probes — 2026-10-23

- [x] User chooses Probe both; isolated crate/fixtures and documentation only.
  No production edits/dependency changes, runtime restart or activation.
- [x] Inspect actual generated C: PendingPush counters still use dictionary/
  generic integer operations; NativeSocketServer already has native fields.
- [x] Extract real queue AST, change only its private record representation;
  compare full outputs/coalescing barriers and cancellation/clear/reuse in source
  and real mypyc. Final compiled reductions 8.5–12.1% for queue-only fixtures;
  traced allocation peak ~64 KiB lower, not a process-memory/speedup claim.
- [x] Async source/mypyc × asyncio/uvloop: owning loop/context, result/error,
  deadlines, caller-drop permit retention and overload pass; bridge pending
  shutdown/stale-loop rejection passes. Occupancy during wait falls 1/16/64→0;
  latency mixed and short-call overhead remains, not a demonstrated global win.
- [x] Strict mypy for three probe Python files; isolated Rust release builds and
  formatting; production source/dependencies and user files preserved.
- [x] User subsequently approves N1 native queue record plus isolated RPC probes;
  see expanded stages below. Async bridge production adoption remains separate.
  Full domain/Android/private-runtime adoption and real lifecycle/transport
  parity are still gates.
  See DOMAIN_OPTIMIZATION_PROBE.md for exact methodology, evidence and limits.

## Expanded native-type stages — 2026-10-23

- [x] User requests cross-surface audit; clarifies traffic priority and UI-cache
  inclusion. Record N1–N5 inventory/order in NATIVE_TYPES_AUDIT.md.
- [x] Concrete approval: implement measured private WBA record; isolated editor/
  Explorer/host RPC metadata and direct-delivery comparisons; update docs only
  beyond N1. No runtime transition/full build/other production cutover.
- [x] N1 source native fields, missing-URI/counter regression; diagnostics/WBA/
  bootstrap tests 17 passed plus 2 subtests; stronger all-Any audit 249 files.
  Actual current queue-class/function AST passes source and real mypyc parity.
- [x] RPC metadata: 51 cases per source/compiled mode; direct delivery: 16 per
  mode. Small-message metadata gains modest/mixed; eliminating the temporary
  context map has the stronger local signal, but wide-decode cases are mixed.
  No whole-network/application performance claim. Probe Python strict checks pass.
- [x] N2a approved/implemented direct typed delivery through existing registered
  namespace trigger, retaining guard/decode and general lifecycle delivery.
  No Rust/queue/Future/wire/outbound/client changes. Thirteen tests pass including
  actual three-module mypyc submit/Future/adapter and error/cancellation parity;
  stronger audit passes 249 files. Updated production-AST microprobe passes 16
  cases per source/compiled mode, not a live network benchmark.
- [x] N2b common parsed metadata allocation reduction: qualified and separately
  approved frozen-schema reuse, without a new native intermediate/schema split.
  Source implementation is complete; full-domain adoption/live gates stay below.
- [x] N3 qualification and separately approved diagnostics safe-copy/type slice
  implemented. Broader event-header conversion deferred on measured evidence;
  source qualification is not runtime adoption. See the comparison below.
- [x] N4 retained-cache source slice qualified/implemented; live gate below.
- [x] N5 search source/codegen qualification and build-only inventory coverage;
  preserve shared DTO/codec owners and runtime lazy loading. Adoption gates below.
- [x] N5 user reports the resulting build working normally on 2026-10-24 and
  requests commit/push. No independent compiled-provenance inspection performed.
  Standalone Terminal projection remains independently deferred.
- [x] N1/N2a user-built full-domain activation and live acceptance. User reports
  hot reload working, then confirms normal behavior and requests commit/push.
  Read-only verification: live worker PID 3590304 maps the compiled group plus
  native_worker/WBA modules from domain-35fb05ee0e41585e84d9ab34d34babbd7c7faa99bd128c29521447b90a1e7d18;
  selector integrity/source fingerprint reports current, FORCE_INTERPRETED=0.
  Reflection is disabled; no eval, additional build or runtime restart performed.
  This proves compiled activation, not a measured end-to-end performance gain.

## N2b complete common-parser comparison — 2026-10-23

- [x] Initial approval covers isolated comparison/test/docs only; subsequent
  approval covers the bounded source change below. Running worker is untouched.
- [x] Trace shared helper into editor/Explorer/host AND Sidebar; preserve actual
  editor-only compiled contract coverage plus interpreted schema/error islands.
- [x] Initial frozen metadata dataclass relocation compiles but fails import
  (KeyError: object); preserve evidence and do not adopt an annotation workaround.
- [x] Ordinary public-read-only native record and refined validated-schema reuse
  pass 34 output/error cases per lane: 136 per source and compiled-editor mode.
  Whitespace, frozen attributes, spoof fields, original input and ID distinctions
  are checked; final lane projections/policy remain unchanged.
- [x] Nine-sample complete-parser comparison: refined reuse gives ~20–28% lower
  small-request parser cost with decode; native intermediate gains smaller.
  Wide decode dominates and results are not a live network/app speedup claim.
  Probe strict mypy passes. Tool/evidence/limits: COMMON_RPC_PROBE.md.
- [x] Approve bounded production schema reuse/common-helper edit and real lane
  regressions/codegen. No full-domain build/activation/restart/commit included.
- [x] Reuse validated frozen schema with read-only request_id/has_id; retain
  private wire fields and legacy dataclass constructor. Whitespace normalization
  alone replaces the frozen instance; all validation and lane policy is unchanged.
- [x] 28 focused tests plus three subtests pass, including actual two-module
  editor-contract codegen and the existing three-module submit/Future fixture.
  Real production lane comparison covers 136 outcomes per source/compiled-editor
  mode against the explicitly reconstructed pre-N2b baseline, including errors.
  Stronger strict/extra/all-Any mypy passes 249 files; probe strict mypy and
  git diff --check pass. Initial fixture failures were isolation ordering and
  single-module codegen/helper layout, corrected in test setup without product
  fallbacks or schema changes. No live runtime was touched.
- [x] Rerun the complete three-way probe after production adoption: all four
  lanes pass 34 cases in each source/compiled-editor mode, retaining the old
  dataclass baseline. Evidence: ignored
  .codex-scratch/common-rpc-parser-production-20261023.log and generated sources.
- [x] User reports everything working normally and requests a local commit.
  Functional live acceptance is recorded; no additional build/restart or
  independent compiled-provenance inspection was performed by the agent.

## N3 event headers and diagnostics qualification — 2026-10-23

- [x] User approves isolated source/mypyc comparisons for both targets, parity
  tests and plan/tracker updates only. No production change/full-domain build,
  activation/restart/commit. Preserve the three user-owned untracked files.
- [x] Trace event dictionary fan-out across 17 modules including its owner;
  inspect diagnostics normalization, bounded cache, owner-clear and aggregate
  projection, plus FileTabDiagnostics. Existing domain manifest includes bus/tab
  projection, not lazy-loaded diagnostics_bridge; no build coverage change made.
- [x] Generate real bus variants and extracted diagnostics processing/cache/
  aggregate variants; source parity includes metrics/queue drain/shutdown and
  generation rejection with synthetic consumers, owner clear, resource clearing,
  malformed marker filtering, project pruning and cache cap/tie ordering.
- [x] Explicit ownership counterexample rejects wholesale marker-copy removal:
  published marker mutation would reach the retained cache. Qualify dict.copy
  over normalized cache markers as the behavior-preserving alternative, keeping
  nested-value sharing unchanged. See EVENT_DIAGNOSTICS_PROBE.md.
- [x] Two complete timing runs plus a final source/actual-codegen parity rerun;
  final run also checks payload-map isolation/nested sharing. Isolated source
  regression and probe strict mypy pass; git diff --check passes. Evidence is
  retained under .codex-scratch/n3-events-diagnostics[-v2/-v3]-20261023*.
  Safe dict.copy reduces interpreted aggregation cost ~13–32% in the local
  fixtures; native record alone is mixed. Event-header gains are small/mixed
  relative to the broad consumer migration. No live speedup/activation claim.
- [x] User separately approves diagnostics-only production change: retain
  dictionary-backed internal TypedDict record, direct trusted fields, detached
  shallow marker copies and unchanged ingestion/wire/owner/project behavior.
- [x] Full-module codegen exposes pre-existing del project_root in an async
  function; user explicitly approves replacing it with _ = project_root. No
  production inventory expansion/eager import or runtime policy change.
- [x] Actual diagnostics+metrics two-module codegen and source tests exercise
  real debounce and bus publication (no patched compiled-local callbacks),
  marker/input ownership, malformed filtering, clear/resource/project behavior,
  metrics enabled and 500-entry eviction. All 16 focused tests pass, including
  existing storm/latency/projection scheduling tests. Stronger 249-file audit
  and probe strict mypy pass. No new Any or unchecked production casts.
- [x] User reports the resulting code working normally and approves commit/push.
  Functional live acceptance recorded; no additional agent-led build, selector
  change, restart, OTA or compiled-provenance inspection was performed.

## N4 retained-cache qualification and source slice — 2026-10-23

- [x] User approves comparisons, unused diff size/stringification removal,
  detached Git status-copy optimization, draft-index metadata probe and tests/
  docs. No full-domain build, activation/restart, commit or push included.
- [x] Selected manifest and native CPyType/CPyDef symbols confirm existing diff,
  draft-diff and Git snapshot dataclasses already compile natively. Preserve
  them; do not add wrapper allocations. User drafts check reports zero.
- [x] Remove only unused DiffCacheEntry.size and its full payload repr. Status
  projections use dict(...) to preserve detached maps and existing dict[str,str]
  contract over Literal-valued cached maps without an invariance cast.
- [x] Source/compiled isolated comparisons preserve keys/TTL/dirty/invalidation
  and copy ownership. Large synthetic miss avoids ~3.35 MB temporary formatting;
  6,000-path status copies improve local lookup samples. Exact timings and scope
  limits: RETAINED_CACHE_PROBE.md, ignored n4-caches[-v2]-20261023 evidence.
- [x] Draft-index dict/native hit comparison shows negligible/mixed gain;
  retain the existing TypedDict, locks, TTL, sidecar and set-sharing behavior.
- [x] Two actual production-module source/codegen tests pass, using a three-
  module group and only external pipe stubs. Regressions cover exact expiry,
  base/root/path keys, invalidation, Unicode, no unused repr, provider failure,
  detached cached/fresh maps, dirty cache and unchanged draft diff guards.
  Eighteen grouped historical/project/probe tests plus five subtests pass;
  stronger strict/extra/all-Any audit passes 249 files; probe strict mypy passes.
- [x] User reports the local build passing live validation and approves commit/
  push. No agent-led full-domain build, selector change, runtime restart, OTA
  or independent compiled-provenance inspection was performed.
- [x] Termux build tooling seam isolated by user outputs: Python 3.14.8,
  mypy 2.4.0/ast_serialize 0.13.1; extension NEEDED entries omit libpython while
  libpython3.14.so exports PyExc_TypeError. User confirms import and resumed
  build work after a backed-up patchelf --add-needed libpython3.14.so repair.
  No compiler-cache deletion, Rust/Python downgrade or TE2 source workaround.
  Original build-linkage omission remains unexplained; reinstall may overwrite
  the local repair. Troubleshooting: framework/native_editor_worker/README.md.

## After the cutover — Code TE2 Any audit

- [x] Record user-provided root mypy_typecheck_errors.txt as the seed for the
  large strict/extra/all-Any-disallow typing pass. Preserve the report unchanged;
  it is currently untracked user work, not a generated file to remove.
- [x] Reconstruct the requested strict/extra/all-Any invocation against the new
  source with mypy 2.3.0/CPython 3.14.4; the original command/version are absent
  from the preserved report and cannot be claimed exactly reproduced. Initial
  baseline: 323 diagnostics/75 files, 297 outside tests and 26 in tests.
- [x] Investigate and obtain staged cleanup approval; prioritize typed callback,
  event/DTO, service and worker boundaries without Any/cast/suppression escapes.
- [x] First source slice: native FWS callbacks, namespace/editor/terminal transport,
  task lifecycle and lazy project/Git hooks. Eleven production modules pass
  stronger flags. Full check now reports 215 diagnostics/65 files: 189 outside
  tests, 26 in tests. Detailed command/scope: TYPING_AUDIT.md.
- [x] Grouped Python regressions: 163 tests and 15 subtests pass. Two stale
  prior-cutover project assertions now include the existing before_switch=None
  argument; production guards are unchanged. git diff --check and native-file
  rustfmt --check pass. No runtime/compilation/asset publication performed.
- [x] User separately approves fixing the discovered single-vs-list `skipSid`
  native delivery gap, with regression source but no rebuild/restart. Python
  adapters and native filter align; native test execution/activation remain open.
- [x] User approves first-slice checkpoint and continuation: local 039e38bf,
  no push/version bump. Preserve the three unrelated untracked user files.
- [x] Continue remaining DTO/event/state, build-helper and test-fixture groups;
  distinguish library-stub/unused-expression inference from actual dynamic DTOs.
- [x] Full strict/extra/all-Any command: zero issues in all 246 Code TE2 source
  files, including Python tests/build helpers. New root typed-ingress regressions
  independently pass the same flags. No Any/cast/ignore escapes or weaker policy.
- [x] Final combined owner regressions: 337 tests, 20 subtests pass. Validate
  valid/invalid legacy overlay ingress without importing native code, existing
  build command resolution, ASGI resources, state/diagnostic/History projections,
  draft/autosave/routing guards and terminal/marketplace fixtures. See TYPING_AUDIT.md.
- [ ] Separately approved native test compilation and mypyc build validation,
  activation and user live checks. The previously added Rust exclusion-list
  test remains source-only; stronger mypy success is not mypyc build success.

User reports interpreted modules running well. No compiled activation, frontend
publication or original-report edits; typing work does not authorize build-policy
changes, commits or restarts. Native/mypyc compilation is intentionally deferred.

## Startup recovery

- [x] Read-only investigation and concrete frontend scope approved.
- [x] Keep existing wire method/DTO and backend installation authority.
- [x] Startup-specific 60-second deadline; explicit waiting/retry/stop recovery.
- [x] Remove initial-failure fallthrough into a duplicate prerequisite request.
- [x] Strict TS and host build pass; 12 boot tests and five targeted real
  transport/host tests pass. Fake-clock test keeps the actual snapshot request
  alive past eight seconds, accepts unchanged old-server MessagePack, then
  verifies expiry at 60 seconds. Small hostState-only reads retain eight seconds.
- [ ] Broader transport suite: four unrelated TextMate fixtures fail because
  their mock window lacks location.search (unchanged production TextMate path).
  Two initial boot fixture omissions of required spinnerSetStep were corrected;
  no production dependency was made optional to accommodate tests.
- [x] User reports live startup validation is complete and passes (2026-10-20).
  No further publication/reload or repeated acceptance is an outstanding gate for
  this accepted slice; exact activated-artifact provenance was not separately audited.

## Pre-IPC Electron DevTools affordance

- [x] User approves button beside Home, detached DevTools, persisted visibility
  default off, tests/build/docs. No WBA change or Electron restart requested.
- [x] Implement main-process action with alive-target and enabled guards;
  app view first, launcher fallback. Button between Home and Reload.
- [x] Persist Show DevTools button in existing desktop settings; reflect saves
  in the title bar immediately. Shared native Android settings hide/omit option.
- [x] Strict Electron TypeScript, compile and 18 focused settings/DevTools tests pass.
- [x] Full Electron unit suite: 126 passed, zero failures/skips.
- [x] User live acceptance: “looking good”; requests checkpoint commit/push.

No version bump, editor/backend change, runtime restart or asset publication in
this affordance slice; native Electron relaunch is required, not editor OTA.

## Early language HTTP projection

- [x] User approves native route + backend projection + frontend early prefetch,
  with explicit 404 fallback to existing RPC. Release focus: drop-in optimizations.
- [x] Small no-store backend-owned status; no full snapshot/runtime start.
- [x] Begin HTTP before Explorer namespace; prepare intelligence before full
  snapshot, never seed partial UI preferences. Existing RPC remains supported.
- [x] Four HTTP tests cover unchanged projection, 404 caching per page, network/
  503/401/JSON/oversize errors and abort deadline with no implicit fallback.
- [x] 13 boot tests pass including real HTTP-before-Explorer/WBA-before-full-state
  ordering and 404 equivalent RPC fallback; no double WBA readiness on same mode.
- [x] Nine backend language tests pass including small projection isolation and
  unavailable error propagation. Strict mypy passes both changed Python files.
- [x] Three native HTTP/resource tests pass, including no-store success and
  503-not-404 backend failure. Cargo formatting passes. Validation compiled only
  test artifacts in the existing environment-selected Cargo cache; no activation.
- [x] Final strict TS and host build pass; 17 combined boot/HTTP tests and five
  targeted MessagePack/host transport checks pass. Existing module-type build
  warning remains visible. Authored-source whitespace check passes.
- [x] User reports the new initialization work passes live validation. This closes
  the live gate, not a claim of agent-collected timing or deployment hashes.

Branch: maintenance/0.2.356-startup-recovery. Existing .355 release-receipt edits
and unrelated untracked research_handoff.md/ty.toml preserved. No version bump,
runtime restart, mypyc/APK build, commit or publication requested. Native Cargo
test compilation is validation only and does not activate a production worker.

## Phases 2 and 3 — actual implementation workstreams

- [ ] Phase 2 / O1: source-backed framework-pipe/Sidebar IPC intent design,
  especially ALS <-> Code TE2; bounded implementation approval then delivery.
- [x] Phase 3 / O2 disposition: boundary slices delivered/live accepted; remaining
  Code TE2-side process/thread concurrency and queues deferred to .357. Historical
  design below is not an active implementation gate for .356.

Their testing/acceptance belongs within these phases; neither is implemented or
approved for blanket changes merely because the order is now recorded.

### O1 first slice — generic relay and backend app facts

- [x] User approves framework broker foundation and CWD/restore-state migration
  for Terminal/File Explorer/File Editor; ALS/mentions documented for next slice.
- [x] Extend the existing owned route/correlation registry with app.rpc.call and
  manifest service/version/caller/method policy. Framework derives source identity;
  target semantics remain app-owned, with no replay/socket fallback.
- [x] Code TE2 dispatches app.rpc.deliver on its existing bounded domain-loop
  adapter. Reuse CWD snapshot and Sidebar ledger/global projection owners.
  State publication requires an existing owned slot/token/URL and cannot activate
  clients, create slots or manufacture Sidebar registrations.
- [x] Replace the transient Python Sidebar socket helpers. Terminal/File Editor
  opt into existing HTTP-plus-pipe worker mode with outbound-only dispatch hooks;
  HTTP readiness, frontend sockets and terminal brokers remain unchanged.
- [x] Rust broker tests: 11 pass, including version/caller/method policy, opaque
  relay/correlation/error, pending limits, disconnect, timeout and late replies.
  Cargo formatting passes; target cache retained. This is test compilation only.
- [x] Final Python regression set: 195 pass across broker, app actions/ASGI,
  tabs, lifecycle, ordinary-worker and pipe tests. Isolated HTTP-plus-stdio worker
  proof passes: real HTTP action emits app.rpc.call, then consumes the correlated
  pipe reply. No live framework/ordinary app workers were restarted.
- [x] Strict mypy passes five broker/service/CWD files. Broader check additionally
  reports two unchanged baseline issues: terminal/backend.py dict.pop(None) type
  and File Editor's FileEditorError implicit re-export. Not new broker failures;
  no unrelated typing cleanup was included. Existing inactive-presentation test
  expectation now follows accepted document-open admission, with no behavior change.
- [x] Source-backed contract/limits and following ALS/mention acceptance semantics
  recorded in ../sidebar_app_intents/APP_RPC.md and CODE_TE2.md; repo memory synced.
- [x] User reports interpreted Code TE2 source and updated framework are working
  (2026-10-21), and requests checkpoint then ALS cutover. This records reported
  acceptance, not an agent audit of artifact provenance or compiled activation.
- [ ] New ordinary
  app workers, followed by CWD/new-tab, navigation/restore, cross-client state and
  closed-slot live acceptance. No host rebuild, OTA/APK, ALS cutover or shared
  framework restart authorized/performed in this slice.
- [ ] Next separately scoped ALS slice: readiness pipe dispatch/correlation,
  exact presentation/conversation proof and owner acceptance receipts; retain
  existing mention content policy and no uncertain insertion replay.

### ALS cutover investigation / plan recording — 2026-10-21

- [x] User chooses investigation before runtime activation, then approves recording
  the complete plan, explicitly retaining standalone socket integration with no
  socket fallback in framework pipe mode. No ALS implementation/restart approved.
- [x] Read sibling ALS AGENTS.md in full; source survey covers framework_pipe,
  lib/state/http startup, sidebar_ipc, ui_rpc, authenticated MCP IPC and UI client.
  Preserve sibling untracked dist/ and TE2 research_handoff.md/ty.toml.
- [x] Record full operation/event inventory, including project actions, CWD/focus,
  state publication, agent-review and three MCP draft methods—not only file opens
  and mentions. Existing frontend sockets and semantic owners remain in charge.
- [x] Record source-backed seams: readiness-only pipe needs async dispatch and
  request correlation; project open/create lack file-open's caller proof; socket
  peer checks cannot be replaced with fake registrations; control byte/deadline
  defaults need qualification for full draft/review and consent-bound operations.
- [x] User requires no new any/Any types: concrete DTOs, validated unknown/object
  ingress, no assertions/suppressions masking untyped boundaries. Existing broader
  typing laundry list remains separate unless a touched boundary requires repair.
- [x] Implementation stages, tests, mixed-version/standalone policy and activation
  gates documented in ../sidebar_app_intents/APP_RPC.md. No new test/build claims
  or acceptance inferred from this read-only investigation/planning pass.
- [x] Concrete Stage A edit/validation approval, then ALS bounded pipe foundation.
- [x] Qualify bulk/control limits and consent deadlines; approve Stage B semantic
  cutover with parity tests and any necessary caller-proof frontend changes.
- [ ] Joint ALS activation/publication and grouped live validation when connected
  model is ready. TE2 interpreted/new-framework acceptance is recorded above;
  ALS semantic pipe routing is implemented at source, not installed/live accepted.

### ALS Stage A — bidirectional pipe foundation

- [x] User approves typed envelopes/errors, bounded intake/dispatch/writer,
  request correlation, AppState startup wiring and isolated tests/docs. No new
  dependencies/any types, semantic exports, installation/restart, commit or push.
- [x] ALS framework_pipe is split into controller, protocol DTOs and runtime.
  Existing --stdio client is installed before build_router starts its CWD task;
  CWD and other Sidebar operations intentionally retain their existing lane.
- [x] Reader matches reply ID/correlation/opId while admitted async handlers may
  await reverse calls. Typed delivery/source validation, one-time handler binding,
  ten-second control-handler deadline and retained opId/project metadata.
- [x] Bound 16 pending outbound / 16 queued-running inbound calls; 64 KiB control
  params checked before queueing; incoming work reserves a 2 MiB encoded budget.
  Writer is 32 queued frames plus one write, sharing a 2 MiB budget. Output frames
  and serialized received control replies are capped at 1 MiB. These are not bulk
  draft/consent-operation budgets for Stage B.
- [x] Dedicated stdout writer acknowledges readiness after write/flush. EOF/error/
  close releases pending calls/admission and clears handler capture cycles; late
  replies are ignored. Required output failure closes; oversized result can emit
  a small error without reexecuting its handler. Completed tasks are drained.
- [x] ALS full Rust library suite: 172 pass, including 17 framework-pipe tests.
  No any/Any/dyn Any or new suppressions in changed Rust source; generic payload
  Value remains transport-only. Compiler warnings remain visible: existing
  embedded-python-adapter cfg plus dormant Stage A API/metadata dead-code warnings
  until semantic binding, not a claim of a warning-free production build.
- [x] Existing bootstrap regressions: 14 pass. TE2 wrapper pipe-readiness contract:
  one passes. Source packaging/fingerprinting already recurses into new .rs modules;
  no new package/build path was introduced. Scoped rustfmt/diff checks pass.
- [x] Final fresh debug native binary stdio regression after all source edits:
  six tests/two subtests pass using the exact Cargo output selected through
  ALS_TEST_SERVER_BIN. Readiness/HTTP serving, EOF, malformed input, unsupported
  request, occupied listener, SIGTERM and standalone behavior pass. With bootstrap
  and TE2 wrapper checks, 21 Python tests pass. No installed/active runtime changed.
- [x] User approves Stage B across TE2/ALS: existing operation owners, exact
  client/conversation routing, project caller proof, bounded bulk/deadline policies
  and regression builds. Installation, runtime restarts, pushes and new dependencies
  are excluded. Checkpoint: TE2 99ca2547; ALS 976a7a4, local only.
- [x] Stage B semantic owner wiring implemented at source; joint activation and
  live acceptance remain separate. Approved source work is not live traffic proof.

### ALS Stage B — receiver-policy prerequisite

- [x] Add generic receiver-declared, per-method request/reply/deadline limits;
  defaults stay 64 KiB/1 MiB/15 seconds. Validated ceilings are 8 MiB and 180
  seconds; unknown/undeclared policy keys and caller overrides reject.
- [x] Bound aggregate admitted serialized request/reply allowances to 32 MiB
  on each source and target route, retaining 16 outstanding calls and existing
  writer/frame limits. No waiting byte queue or mutation retry is introduced.
- [x] Final Rust broker suite: 15 tests pass, including unchanged defaults,
  method-scoped policy/caller-override denial, invalid bounds, shared byte
  saturation/release, self-calls, target-rejection rollback and complete UTF-8
  envelope sizing without content truncation. Scoped rustfmt/diff checks pass.
- [x] Qualify default versus full-model shapes: draft state carries content,
  diff and optional disk text; review can contain several source models. Selected
  8 MiB request/reply profiles and 60-second broker waits replace inadequate
  control budgets. UTF-8 fixtures above 1 MiB remain intact; oversized whole
  operations reject before delivery where known. This is synthetic qualification,
  not proof every possible project fits. Physical 32 MiB pipe framing is unchanged.
- [x] Bind actual TE2/ALS semantic owners and replace framework-mode socket
  traffic. Preserve standalone Socket.IO and no fallback/replay in pipe mode.

### ALS Stage B — semantic cutover source and validation

- [x] ALS chooses its backend transport from explicit --stdio, including CWD,
  state, file/edit/project, review and the existing three MCP draft operations.
  Closed pipes never construct a Sidebar socket. Startup CWD hydration follows
  the actual readiness write/flush, and failed listener binds emit no app calls.
- [x] Bind inbound mention/CWD/project/focus/review to existing AppState and UI
  owners. Require framework-derived Code TE2 source and explicit conversation
  for mentions; receipts expose owner operation/queued state, not render ACKs.
  Shutdown closes admission/reverse waiters before adapter/domain shutdown.
- [x] TE2 dispatches actual owners without fabricated SIDs; project caller proof
  is rechecked after switch-lock waits. ALS UI/backend preserve that same proof.
  Project UI/native/broker waits align at 190/185/180 seconds. Unknown outcomes
  never trigger retries. Minimal project facts omit unrelated boot snapshots.
- [x] Managed route inspection distinguishes absent apps from starting/stale
  routes. Reverse review excludes its originating app. Pipe mentions use exact
  client/slot/incarnation/conversation and never fall through to socket emission
  on timeout. Projection failures remain best-effort, not mutation retries.
- [x] Preserve full mention paths and reject excessive identity lengths instead
  of truncating IDs. Frontend sockets, terminal streams and native mappings remain.
- [x] Final focused Python suite: 157 pass, including the minimal-project-notice
  regression. Strict mypy passes seven
  production modules without new Any/cast/suppression escapes.
- [x] ALS full Rust library suite: 178 pass, including explicit-pipe CWD/status,
  closed-pipe no-socket behavior, actual bound composer/draft ownership, source
  denial, UTF-8 bulk receipts and pre-enqueue request/limit rejection.
- [x] ALS npm typecheck (including lint) and frontend build pass; 21 frontend
  file/project routing and project-control tests pass. No native-client reload.
- [x] Fresh isolated ALS debug binary: 20 native-stdio/bootstrap Python tests
  and two subtests pass, including readiness-first CWD, no framework HTTP/socket
  calls in stdio mode, EOF/corruption, listener failure, SIGTERM and standalone.
  Final post-shutdown-fence rebuild/recheck also passes the same 20 tests/two
  subtests. No installed runtime was used or replaced.
- [x] User approves local checkpoints and provenance-pinned ALS frontend snapshot
  refresh, without push/install/restart/OTA/version bump.
- [x] ALS checkpoint 3cc5e9f, then refresh the provenance-pinned frontend snapshot:
  149 resources verified with source/served hashes and --check. No dirty-source
  bypass, source maps in the snapshot, runtime publication or asset URL change.
  Ten ALS/native asset-mapping tests pass after updating their stale expected
  snapshot metadata from the previously vendored .138 to current ALS .139;
  no package version was bumped by this work.
- [ ] Approve matching framework/domain/ALS installation and exact worker refresh,
  plus native-client asset publication/reload. No active runtime changed so far.
- [ ] Grouped user live acceptance: multiple clients/conversations, in/out-of-root
  file opens, project switches/consent, mentions, review/MCP drafts and standalone.

2026-10-21: user reports Code TE2 running interpreted and working well; prioritize
the typing audit before another build. Agent performs no runtime transition.

Current changes are source-only. No version bump, installation, shared restart,
OTA/APK publication or push was performed. Existing compiler cfg/dead-code
warnings remain visible, without suppression. Preserve unrelated reports/dist.

## Phase 4 — native debug / staged built-in bridge policy

### Resumed — built-in bridge policy first (2026-10-25)

- [x] User narrows next native-debug item: ordinary connected/quiet console eval
  is sufficient; retain it. Add TE2 MCP access to native Cefrium CDP for page
  failures/errors. Gecko replacement debugging is on user's separate branch.
- [x] Read-only source audit: existing MCP eval routes to exact native Android
  worker without page JavaScript; current allowlist exposes state only (plus
  asset update/telemetry clear). Inspector's sendProtocol is tied to its own
  session and is not yet a correlated external CDP request owner.
- [ ] Approve bounded native targets/eval/error-read command design over existing
  control lane, with exact target/document epochs, independent inspector session,
  bounded local error capture and no continuous network forwarding/eval replay.
  No source changes during user's ongoing APK build; another APK is needed if
  this native API slice is implemented.

- [x] Updated framework live status returns enabled:false/new_app_pages; exact
  main_page:dA2Q eval confirms active/connected:true and forwarding:false.
  Console identity/control works while quiet; no logging policy mutation used.
- [x] ADB Razr native diagnosis: base te2_cefrium_devtools_remote is occupied by
  another app SELinux context; Cefrium PID 8695 binds Chromium's fallback
  te2_cefrium_devtools_remote_8695. Relay hits base and logs connectto denials,
  reset/EOF discovery failures. Direct ADB GET against PID socket returns
  /json/version and /json/list with Code TE2/inspector targets. Removed both
  temporary exact forwards; no app restart/debugger resume/settings mutation.
- [x] User approves bounded Android source fix: derive server prefix and relay
  name from same process identity; no legacy cross-app fallback. Pure naming
  tests cover matching pair, distinct processes and invalid PID. Expose name in
  existing native debug snapshot. Shared Cefrium/Termux source, not Gecko.
- [x] JDK25/SDK37 offline testDebugUnitTest with exact Endpoint test filter:
  production Kotlin/Java and unit-test compilation pass; 3 endpoint tests pass.
  First invocation lacked ANDROID_HOME; repeated with explicit existing SDK.
  No APK assembled/installed. Existing deprecation warnings remain visible.
- [x] User confirms Cefrium CDP socket fix live validated after rebuilt APK
  installation (2026-10-25). This closes the inspector fix acceptance, not all
  deferred native debugger/MCP features or an independent Termux APK test.

  Subsequent user build failed installation: staging APK SHA256
  31f69d2eb1231b143046a18999efe159fd06ec5470f63e9eb93e48039d43c9d1
  lacked AndroidManifest.xml/resources.arsc. Optimized-resource metadata named
  absent resources-staging-optimize.ap_; preceding binary shrunk archive retained
  both entries, matching the recorded 2026-10-13 failure. Root output-removal
  cause remains unknown; not a signing diagnosis.

  User approves incremental recovery only: JDK25/existing SDK offline
  assembleStaging --no-daemon --max-workers=2 succeeds in 5m29s, reusing source
  compilation and rerunning R8/resource optimization/package. No clean, source/
  setting changes, asset reseed or install. New SHA256
  4db25163e2da4526db8425b99de1282a3f93d67b84bab949c61e94c350283814.
  Manifest/resource entries present; unzip integrity, apksigner v2 and zipalign
  -P16/4 pass. Signer SHA256
  500d5fbd6f4cb3ff755fd2fc2d23f78750d0cc14755615dc4d0b451f6335e34d.
  Existing R8 final-ID warnings persist. Free disk ~3.1 GiB after build; no cache
  cleanup. APK remains at android/cefrium/build/outputs/apk/staging/cefrium-staging.apk;
  user subsequently confirms inspector/CDP live acceptance. It is not inferred
  merely from those artifact verification checks.

- [x] User approves implementation of default-off bridges, independent console
  flag and page-lifetime escape hatch first; concrete approval covers TE2-owned
  Code TE2/Terminal/File Explorer plus CLI/bootstrap, tests/builds/docs only.
- [x] CLI `--debug-console` / `--no-debug-console`, `TE2_DEBUG_CONSOLE`, and
  runtime-debug OR policy are independent of the Rust build profile and native
  runtime-eval capability. Explicit CLI zero overrides inherited console flag.
- [x] Existing app_bootstrap transports the effective policy before app import;
  no per-frame policy fetch, URL override or console connection is needed.
- [x] User corrects initial connection gating: always register/connect/serve eval
  and preserve worker identity; gate only console/error forwarding before
  serialization. `enable()` / `disable()` / `status().forwarding` control logging
  without tearing down identity/control. Pending loaders finish registration
  quietly when disabled; single flight and retry remain.
- [x] User approves runtime `te2 console logging on|off|status`: bounded native
  JSON endpoint, startup-seeded atomic new-page policy, no environment mutation,
  persistence, replay or broadcast. Explicit runtime off overrides launch seed.
  Existing app-bootstrap delivers policy; existing pages retain eval control.
- [x] Revised actual-bridge regression suite: 10 pass, including quiet registration,
  actual eval-driven logging, disable-preserved connection and pending-loader
  registration. Previous test totals below describe the earlier source pass.
- [x] Revised validation: 23 Python flag/CLI/help/source tests; 3 Rust policy
  tests including actual HTTP mutation admission/status; 26 bridge/identity/
  app-shell tests; 5 host/Sidebar transport tests; Terminal 28 and File Explorer
  145 frontend tests. All three frontend typechecks/builds pass. Runtime CLI
  failures reject malformed/oversized replies and submit only once. Existing
  Rust feature-disabled and Node module-type warnings remain visible.
- [ ] Revised connected/quiet runtime activation and live acceptance. Earlier user
  acceptance covered default-disconnected behavior only; flag test was deferred.
- [x] Read-only native Cefrium trace: inspector/client ready but controlConnected
  false, zero native browser targets, status starting; main browser ready. Native
  discovery errors are only logcat-visible at this step; no ADB device connected.
  This does not prove page console registration caused CDP failure. Native
  control discovery is separate; no Android fix/restart/settings change performed.
- [x] Three caller entrypoints use the opt-in wrapper; generic/user-app and
  run-profile initConsoleBridge calls, native Android control and server console
  relay remain unchanged. Preserve existing differences between bridge copies;
  only the new policy implementation is identical.
- [x] New policy/relay/identity/app-shell group: 26 tests pass; Python flag/help/
  app-agnostic source group: 16 pass. Terminal's 28 tests and File Explorer's
  145 frontend tests pass. Three frontend typechecks/builds pass; existing Node
  module-type warning remains visible. File Explorer mock gains the new export;
  the extracted app-shell fixture gains window for the new policy assignment.
- [x] Two focused Rust tests pass with --no-default-features in the retained
  framework/rust/target cache: effective flag policy and app-bootstrap field.
  This is not full-feature runtime adoption; existing feature-disabled warnings
  remain visible. No Code TE2 domain/mypyc build or client transition performed.
- [x] Wider socket/startup group: 50 pass, 5 unrelated fixtures remain failing:
  four previously recorded TextMate fixtures and the extracted host-boot factory
  missing createLanguageBootstrapRequest. Their product sources were untouched;
  no broad suite-pass claim or unrelated repair. Logs under
  .codex-scratch/console-policy/{focused,wider,file-explorer}.log. Source diff
  whitespace check passes excluding generated host.js (embedded multiline string
  whitespace must not be stripped as source formatting).
- [x] Final UI-IPC/Sidebar/boot-snapshot transport subset passes after the final
  optional-bridge exception-fencing adjustment; host typecheck/build repeated.
- [ ] User-approved matching framework adoption and asset publication/reload;
  verify quiet ordinary boot, each flag, manual enable/disable, reconnect and
  run-profile/user-app parity. No runtime transition/OTA/APK build/commit yet.
- [ ] ALS upstream producer plus vendored snapshot adoption, separately approved.
- [ ] Native CDP/RDP-to-MCP discovery/evaluation with exact client/run/frame/
  document identity; preserve existing Chii GUI and native control discovery.
- [ ] Client-local disk history: max 500 records per client run, bounded bytes/
  previews, no retained in-memory log list, on-demand remote retrieval. Browser
  cache alone is not durable history. No logger/retention code implemented yet.

### Earlier planning and superseded deferrals

- [x] User explicitly defers this again on 2026-10-24 in favor of the Explorer
  Git-init affordance bug; do not automatically resume after its acceptance.
- [x] User approves read-only investigation; confirms implementation is NOT now.
  Initial placement immediately after startup was superseded: user requires two
  actual work phases first (intents, then concurrency/queuing).
- [x] Confirm both TE2 bridge copies serialize all hooked log levels; central
  console appends/broadcasts them. Find backend runtime_debug bootstrap metadata
  and existing console:registered reply as potential policy channel.
- [x] User supersedes filtering-only direction: first-party framework apps leave
  console bridge; native on-device debugging/logging serves internal tools.
  Bridge remains available for developer/user apps. User requests PLAN ONLY now.
- [x] Record Cefrium CDP and user-identified Gecko CHI interface; actual protocol/
  bindings/parity remain unverified until the deferred investigation.
- [ ] Inventory existing native debug APIs and socket/MCP pathways; qualify
  authenticated remote-client access and exact target/context lifecycle.
- [ ] Define Electron/generic-browser and older APK/server compatibility before
  removing any first-party bridge registration. No implicit reinjection fallback.
- [ ] Inventory all framework/ALS/native/Node producers and imports; scope ALS
  upstream source/snapshot updates independently, preserve developer wrappers.
- [ ] Approve concrete implementation/cutover when this phase is resumed.
- [ ] Prove native discovery/eval/on-demand logs, disconnect/detach fences and
  bounded transfer, then remove first-party bridge wiring at source.
- [ ] Prove developer bridge discovery/log/eval remains working and internal
  automatic bridge traffic is absent; approve builds/publication/live acceptance.

Earlier warn/error filtering and registration-policy findings remain investigation
history, not the current implementation plan. No console/native code changed.

## O5 isolated build/space PoC — deferred to 0.2.357

User defers continuation on 2026-10-25. Completed evidence below is preserved;
remaining design/integration gates now belong to ../release_0_2_357/TRACKER.md.

- [x] User approves audit then two-consumer shared-library proof; explicitly
  targets build/space/product-size/developer ergonomics, not request speed.
- [x] Audit independent framework/worker locks: 224 shared package names,
  138 exact common identities (not linked-byte attribution). Tokio/Hyper/
  Engine.IO/Ferrous revisions differ; PyO3 is editor-worker-only. User confirms
  additive Ferrous compatibility; no production pin or source changes.
- [x] User approves exact cleanup: obsolete .354 APK comparison directories and
  inspection JAR removed; recovery log compressed losslessly, retaining active
  selections, snapshots, compiler caches, current APK/mapping and wheel artifacts.
  Free disk rises ~3.0 to 6.3 GiB; log falls ~325 to 6.3 MiB. Nested scratch
  directories are tiny and were not indiscriminately removed.
- [x] Isolated fixture source at framework/shared_runtime_probe; same concrete
  Tokio/Hyper/gzip implementation, two consumers, matching dependency locks,
  compiler gate, retained separate build targets and own-process disk guard.
  Package accounting includes Rust std dylib and ELF dependency checks.
- [x] Linux isolated comparison complete: static raw 3,476,056 / ZIP 1,329,608
  bytes; shared raw 7,684,976 / ZIP 2,364,484 including 5,418,488-byte Rust std.
  Shared total ~78% larger compressed in this small fixture. Target-cold builds
  22.78/24.28 s and private-change builds 5.51/6.01 s (static/shared); no observed
  build-time win. Single samples/cached sources, not production size estimates.
- [x] Private-change update leaves both shared executable hashes/std identical;
  only shared runtime changes. Cargo still schedules both consumer packages.
  Initial/updated HTTP-gzip roundtrips pass; relocated no-LD_LIBRARY_PATH runs,
  explicit missing-runtime failure and library-only replacement pass. Both Python
  drivers pass strict mypy; same-source/two-bin Cargo warning remains visible.
- [x] Reject adoption of this plain Rust-dylib recipe as-is on measured goals.
  Results/method/limitations: framework/shared_runtime_probe/README.md; receipts
  in .codex-scratch/shared-runtime-probe/{initial,implementation-change}/results.json.
  Build outputs use ~130 MiB; free disk remains ~6.2 GiB after cleanup/probe.
- [x] User clarifies intended **stripped cdylib**, approves isolated corrected
  variant. Both baseline and candidate strip symbols equally; same registry
  dependencies/concrete HTTP-gzip implementation. Only ABI-version and bounded
  UTF-8/caller-owned-buffer exports; no Rust type/ownership/Future crosses.
- [x] Stripped static raw 2,545,728 / ZIP 1,136,342 bytes versus cdylib+two Rust
  clients raw 1,955,600 / ZIP 902,159: net ZIP saving 234,183 bytes (~20.6%).
  No dynamic Rust std dependency. Initial cached-source builds 23.53/23.65 s,
  private-change builds 6.01/5.26 s, single samples not robust timing estimates.
- [x] Corrected recipe rebuilds library only for private changes; two consumer
  hashes remain identical and no consumer compilation occurs. This is fixture
  build-driver ABI invalidation, not existing production bootstrap behavior.
- [x] C header smoke, Rust unit byte-boundary test, static/shared/changed output,
  relocated no-LD_LIBRARY_PATH loading, explicit missing-library failure,
  pre-execution ABI mismatch rejection and library-only replacement all pass.
  Dynamic exports exactly two; three Python drivers pass strict mypy. Receipts:
  .codex-scratch/shared-runtime-cdylib/{initial,implementation-change}/results.json.
- [x] Move the remaining shared-library design/integration work to .357 at the
  user's request; retain the PoC without production adoption.
- Deferred: decide whether measured net size/build ergonomics justify further work.
  No production adoption, pin alignment, search/Git/FS mainlining, pipe change,
  framework restart, Android/wheel publication or performance claim implied.

## Optimization agenda intake (O1–O8; schedule above)

Initially recorded while user tested initialization (now accepted). PLAN.md O1–O8 owns
scope, relationships and gates; unchecked entries below mean investigations are
not done, not failed acceptance or approval to implement all items.

- [x] Preserve the user's complete optimization agenda in this release plan.
- [ ] O1: Framework-pipe intents / Sidebar IPC consolidation, especially
  ALS <-> Code TE2; reconcile earlier deferred work and exact-client ownership.
- [x] O2 disposition: DTO/PyO3 boundary slices delivered/live accepted; remaining
  Code TE2-side multiprocessing/multithreading and event queuing moved to .357.
  User reports 6,000+ files searched with all needle-in-a-haystack results in
  under one second. User-observed, not a controlled benchmark; no further .356
  optimization required. See ../release_0_2_357/TRACKER.md.
- [ ] O3: Transparent socket routing through pipe DTO envelopes, avoiding
  network proxy hops where measurements justify it. User suspends indefinitely
  on 2026-10-25; not an active/next investigation.
- [ ] O4: FlatBuffers / Cap'n Proto pipe codec comparison and compatibility proof.
  Raw/zero-copy codec flattening is explicitly next-version work, not .356.
- [ ] O5: Shared Rust source/runtime libraries, binary/build savings and direct
  pre-envelope *ops DTO reuse without duplicating framework authority.
  Deferred to .357; see ../release_0_2_357/PLAN.md and TRACKER.md.
- [ ] O6: Selected critical localhost streams over Node IPC on desktop/mobile,
  with explicit local capability and preserved remote paths; WBA candidate.
- [ ] O7: Frontend Cap'n Proto packed-stream proof over Socket.IO binary frames;
  initialization/CRUD first candidate, WBA/schema suitability still undecided.
- [ ] O8: WBA raw-socket/internal-client-ID experiment, ALS history pattern
  comparison, and separately measured MessagePack/compression trade-offs.
- [x] O9 intake: trace early provider registration/resync traffic, distinct from
  TextMate/Markdown. Full replay broadcasts and full snapshot hydration are both
  present. Source evidence and correctness gates recorded in PLAN.md.
- [ ] O9: approve/implement document-relevant, per-client provider publication
  with lazy hydration and bounded replay/snapshot behavior; preserve full registry.
  User explicitly defers WBA work when moving to Sidebar/intent work; not next.
- [ ] Choose next bounded investigation and obtain implementation approval only
  after source-backed design/evidence; no codec/library/transport cutover yet.

No new builds, dependency changes, cross-repo edits, runtime transitions, commits
or publication performed by this documentation-only intake.

## Additional repair — Aria Downloader (later)

- [x] User reports app is pretty broken; record repair for .356.
- [x] User explicitly selects record for later, not immediate investigation.
  IPC remains next; later placement is not yet chosen.
- [ ] Resume with current-source/runtime triage and a concrete repair plan;
  historical 502/stale-shell issues are leads only.
- [ ] Approve and implement bounded fixes, regression tests and live acceptance.

No Aria source/log investigation, restart or download/shell mutation performed.

## Sidebar/intent intake — after accepted checkpoint

Current source inventory (not a completed migration):

- Terminal backend: sidebar.cwd.get and sidebar.window.state.update; own transient
  Socket.IO client with register/call/disconnect in backend.py.
- File Explorer backend: same operations through app.libs.sidebar_rpc; durable
  tab/path/splash projection remains app-owned.
- File Editor backend: sidebar.window.state.update through app.libs.sidebar_rpc;
  file identity/validation remains app-owned.
- ALS Rust backend: sidebar_ipc.rs includes file open/edit, agent-edit publish/
  clear, project lookup/open/create and CWD/other integration; audit full surface
  before defining cutover scope. Source is sibling repo, no edits there yet.
- Code TE2 owns /sidebar_ipc; its host frontend also uses that namespace for
  registration/presentation/control. Preserve these frontend lanes separately
  from backend-to-backend transport retirement.
- Native Electron uses UI IPC (/ui_ipc), not a native /sidebar_ipc client.

No direct backend Sidebar IPC caller found in current Archive Manager/Aria source
survey. This is built-in source inventory, not a scan of user-installed apps.
Existing production framework app-intent pipe already handles selected document/
app/project/terminal intents; expand existing owners, not a new bus.

User authorizes checkpoint/push of accepted startup/DevTools work and planning/
release receipts. Preserve research_handoff.md and ty.toml unstaged. WBA remains
unchanged/deferred. Next: deepen the Sidebar/pipeline contract audit and propose
bounded implementation; no migration implementation or shared restart yet.

## Explorer Git-init footer repair — 2026-10-24

- [x] User approves read-only investigation, then frontend fix, ordering and
  transition regressions, typecheck/build and plan/tracker changes. No backend,
  restart, OTA or commit is authorized.
- [x] Source confirms backend status publishes isRepository correctly. Diff-base
  hydration shows Init for mode none, but the status notification unconditionally
  overwrote it with showInit=false, even immediately after applying its own
  embedded diff-base snapshot. Later independent hydration could restore it.
- [x] Status handler now passes status.isRepository === false to the existing
  footer controls helper. Retain repository detection, mutation ownership,
  confirmation, init RPC and existing project-path admission unchanged.
- [x] Four new actual-controller/DOM regressions fail before the source fix and
  pass after: base-first/status-first/embedded-base ordering, repeated snapshots,
  initialization to an empty repo, committed repo, foreign-project rejection,
  and confirmation/cancel through existing init RPC. Related grouped tests:
  19 passed. npm run typecheck and node build.mjs pass; existing module-type
  warning remains visible. No new dependencies or Any types.
- [x] User reports the fix working live and requests commit/push (2026-10-24).
  Record user acceptance, not independently inspected native asset provenance.
  No Rust/mypyc build is required; the agent performed no runtime transitions.

## N5 search build coverage — 2026-10-23

- [x] User approves actual-module codegen/lifecycle qualification followed by
  build-only inventory inclusion if parity passes; no full-domain build,
  activation, restart, commit, frontend or Terminal implementation changes.
- [x] Read-only inventory comparison: 175 startup modules become 178 with the
  search owner. Exactly two added modules compile (search_sessions and search);
  the third is the existing interpreted search_review schema contract.
- [x] Reuse existing typed session/cache records, PipeEnvelope, MessagePack
  encoder/decoder, pipe_runtime listener/pump and provider/RPC owners. No new
  DTO/schema/codec, eager runtime import or search behavior change.
- [x] Inventory and isolated snapshot validation both import the qualified
  build-only root; regression proves ordinary startup still omits the lazy
  modules and DTO/pipe runtime islands remain interpreted. Existing fingerprint,
  snapshot publication and cache policy are reused, not duplicated.
- [x] Source/actual two-module codegen qualification covers early-before-ACK
  ordering, wrong-root/generation/unknown-search filtering, incremental per-file
  append identity, Unicode/multiline/editTarget metadata, pagination, completion,
  error/cancel/disposal and name/changes/project-switch paths.
- [x] Focused grouped regressions: 80 passed, 1 skipped, 7 subtests passed.
  Final expanded N5 rerun: 3 passed, including fresh-process validation of the
  actual two-module compiled fixture through the production snapshot validator.
  Stronger strict/extra/all-Any audit passes 249 source files. Additional direct
  build-script mypy check reports only pre-existing missing setuptools stubs
  (import-untyped); no stub installation or policy suppression performed.
- [x] User reports the resulting build working normally on 2026-10-24 and
  requests commit/push. Record user-run live acceptance, not independently
  inspected compiled provenance or measured application speedup. The agent did
  not change selectors/workers/framework/clients. Terminal projection remains
  deferred below. Preserve all three user-owned untracked files.

## Deferred — standalone Terminal headless projection

- [x] Record user report: standalone Terminal is comparatively janky; consider
  misconfiguration/restoration before replacing its headless implementation.
- [x] Confirm source ownership: standalone uses xterm-headless/SerializeAddon;
  File Explorer owns a separate Node PTY worker and uses shared neutral Pyte
  checkpoint projection. Browser xterm.js is a separate component and stays.
- [ ] On separate approval, reproduce bounded output/resize/reload/reconnect
  sequences and audit headless configuration, serialized modes/cursor/colors and
  restore ordering. Identify a minimal fix if possible.
- [ ] If unresolved, qualify shared Pyte as the standalone headless projection,
  retaining app-owned shell/session/transport and direct live-output semantics;
  no cross-app backend reuse. Compare fidelity, resource cost and restore parity.
- [ ] Approve the selected bounded repair/replacement and its tests/live checks
  before implementation. Planning only; no runtime/source changes in this slice.

## Deferred — ALS renderer-owned Markdown file actions

- [x] Read-only live investigation: raw APP_RPC.md filesystem href/#L198 is
  correct; line-hash parser recognizes it and routing is bound. Native long-press
  menu shows normal origin-resolved .href, not the RPC destination.
- [x] User confirms ordinary Markdown file-link clicks now open correctly;
  distinguish this from the corrected compiled pipe receiver schema issue.
- [x] User explicitly chooses end-of-plan deferral; no ALS frontend/source,
  build, vendored snapshot, OTA or runtime changes performed for this item.
- [ ] On separate approval, classify file links during rendering and emit
  explicit path/line/column file actions using existing own-backend RPC only on
  activation. Preserve web URLs, streaming/final/replay parity, accessibility and
  exact-client proof; prevent misleading localhost link-menu destinations.

## Deferred — shell profiles / command-palette execution / terminal focus

- [x] Record user request (2026-10-25), planning only; return to current
  logging/native-debug investigation afterward, without implementing this slice.
- [ ] Add shell-execution run-profile type using the existing built-in runner's
  editor-terminal execution path; reuse a running terminal or open/create one.
- [ ] Add current-file `%` / extensionless `%<` substitutions and trailing run
  arguments. User example: `gcc % -o %< && ./%<`. Qualify existing cwd, quoting,
  substitution/escaping and compound-command argument rules before implementing.
- [ ] Add command-palette shell-command entry using the same terminal path;
  execute only on explicit acceptance, never on preview or cancelled input.
- [ ] Reveal/focus the editor terminal whenever invoked by user intent, including
  existing open/run actions; wait for readiness without cross-client or
  background-restoration focus stealing.
- [ ] Obtain concrete implementation approval and validate reuse/create,
  substitutions/arguments, consent, cancellation/no-replay and desktop/mobile
  focus. No source edits/builds/runtime changes/publication in this intake.

## Deferred — Cefrium 0.13 staging comparison (before CDP work)

- [x] User places this trial near the end, BEFORE deferred CDP/MCP work;
  current validated 0.9 APK/socket fix stays in place. No upgrade/build now.
- [ ] Audit 0.13 dependencies, query-origin/subframe migration and inherited
  0.12 consumer R8 keep-rule fixes; preserve validated baseline APK/mapping.
- [ ] Approve bounded trial with sufficient disk or an approved build host.
  Compare same-source/settings compressed native/DEX/resources/total bytes and
  perform artifact/device checks. No assumed size win or packaging-root-cause fix.

## Deferred — remaining console / native-debug MCP work

- [x] User explicitly defers remaining console/MCP work on 2026-10-25; return
  to optimization agenda. Keep quiet registration/eval and socket fix in place.
- [x] User subsequently confirms Cefrium APK CDP fix live accepted; deferred
  native-debug/MCP features remain unimplemented and are not accepted by this.
- [ ] Resume native CDP MCP commands, ALS producer/snapshot migration, broader
  logging audit and client-local history only when separately reprioritized and
  approved. No new Android/API/history implementation now; Gecko belongs to
  user's other branch. Prior design/evidence remains in Phase 4 above.

## Deferred — native CEF DevTools transport (end of list)

- [x] User requests backlog-only placement on 2026-10-25; current process-owned
  socket/CDP relay fix remains the immediate implementation.
- [ ] Audit pinned Cefrium bindings for native CEF DevTools send/execute/observer
  APIs, then qualify browser/iframe/session routing, thread/lifecycle ownership
  and embedded inspector compatibility. This replaces transport, not CDP.
- [ ] Obtain separate implementation approval after feasibility review; no
  assumed performance gain, release gate, JNI work or APK build in this intake.

## Final candidate evaluation — GekkoTron

- [x] Record user-maintained desktop/mobile Electron/GeckoView port as the last
  candidate to assess before the upcoming release, after the other selected work.
  User says it may not be ready; this is not an adoption or release-blocker decision.
- [ ] On explicit resumption, inspect its current source/API and build readiness,
  compare existing client behavior, packaging size and lifecycle/security parity.
- [ ] Approve bounded trial/build/acceptance scope before replacing or adding any
  shipped client. If not ready, defer it rather than implicitly expanding release.
