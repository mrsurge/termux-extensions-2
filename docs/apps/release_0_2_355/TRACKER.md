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

### Termux scale lifecycle follow-up

- [x] User reports lost scale on foreground; approve read-only investigation,
  then approve native Termux-only implementation/tests/docs, NO APK builds.
- [x] Inspect actual pinned 0.9.0 SDK signatures/bytecode: resume sets page
  visibility; repeated pinch-disable injects viewport JS. Current early-success
  controller lacked renderer/surface observers. No live reset trace captured.
- [x] Implement pre-visibility scale restoration and surface/WebContents-owned
  reattachment callbacks, queued-work fences and listener disposal. Other
  renderer behavior/background policy retained; no CSS/global host zoom.
- [x] New source-wiring guards pass; five pure lifecycle-admission unit tests added.
- [x] Further investigation identifies conflicting host-scoped zoom writes:
  auxiliary toolbar/tools restore 100% after main scale. User approves existing
  private-context isolation for Termux auxiliary UI only; main persistence and
  other APK contexts remain unchanged. Wiring guards cover all three auxiliary
  creation sites and unchanged main context. See PLAN.md's Chromium reference.
- [x] Compile final shared/Termux Kotlin against pinned Cefrium 0.9.0 and run
  JVM tests without assembly: Cefrium 67, Termux consumer 29, Electromux host 29,
  Node runtime 18; zero failures/errors/skips. Existing deprecation warnings
  remain. Remote isolated unit tree contains NO APK outputs.
  Logs: /root/.cache/te2-android-build/zoom-unit-0.2.355-final.log and
  zoom-termux-unit-0.2.355.log. Source guards/chrome tests and 42 desktop geometry
  samples pass, but are not Android background/foreground visual acceptance.
- [x] User live acceptance: zoom lifecycle fix works. Subsequent explicit
  acceptance covers all three APKs and both wheel candidates; no exhaustive
  device matrix beyond that user acceptance is inferred.

### Wheels / APKs / publication

- [x] Record corrective release scope and deferred cleanup exclusions.
- [x] Concrete version/checkpoint/remote build approval: user approves .355
  alignment, commit/push and Debian/Pixel builds; stop for grouped acceptance.
- [x] Align .355 package/framework/Electron/APK identities and source checkpoint:
  `6ce09cddf3faeab678d94ba7ca285d1baa3fba8b`, pushed to main. Only unrelated
  research_handoff.md and ty.toml were left untracked.
- [x] Verify remote source/toolchain/cache state and available storage. Both
  fresh source-0.2.355 trees match the checkpoint; old working installs untouched.
- [x] Linux candidate built, 98,413,121 bytes; private Python and receipts valid.
- [x] Android candidate built, 49,429,596 bytes; native receipts valid.
- [x] Fresh joint TE2/ALS/FWS installed checks on both platforms: 143 compiled
  imports, actual Socket.IO/WBA entry, target-exclusive uvloop, FWS native pipe,
  ALS native MCP 38 tools/one resource/clean EOF. No retired dependency closure.
  Exact hashes, native comparisons, paths and scope are in BUILD_STATUS.md.
- [x] User wheel acceptance group: explicit “All accepted” response.
- [x] All three staging APKs built/audited with latest native lifecycle/context
  correction and .355 seed. Desktop copies proceed below; no installs/publication.
- [x] User APK acceptance group: explicit “All accepted” response.
- [x] Final clean-source/tag provenance and exact final artifacts revalidated:
  tag .355 at 499d2014, both publication-eligible wheels, all native ELF hashes
  unchanged from accepted .355 candidates, fresh installed checks repeated.
  1,159 APK executable/asset source files match tag. BUILD_STATUS.md owns hashes.
- [x] Release approval, PyPI publication and digest verification: user approves
  publication; both final wheels visible on PyPI with exact accepted hashes.
- [x] Existing draft transitioned to .355 with final APK/template/installers and
  checksum inventory; GitHub publication only after explicit release approval.
  Now public, normal Latest release; all eleven public downloads were streamed
  and SHA-256 checked against staging. Latest installer redirects to .355 and
  its downloaded bytes match. Prior .354 wheels/tags remain unchanged.
- [x] Post-publication Debian cleanup inventory/dry run, protected/live exclusions
  verified, obsolete copies removed and recovered space recorded.
  User approves the bounded 22-directory deletion after the dry run. Rechecked
  exact paths, symlinks, .codex*/.git trees, process cmdline/environment/maps/
  cwd/exe/open FDs and running Docker mounts before deletion. No live references
  or protected descendants found. Actual free space increases 17,793,998,848
  bytes (16.6 GiB), to 117,056,737,280 bytes (109.0 GiB). All .355 final artifacts,
  build/Cargo/SDK caches, protected home joint-stable install and geckotron stay.

### Completed cleanup inventory — 2026-10-19

Only these 22 approved obsolete acceptance/test installations were removed:

- `/home/mrsurge/.cache/te2-release-acceptance/` children:
  `154c9e2ca2fc745a`, `0.2.350-fa4d09c2`, `e4db20c3c2f1677d`,
  `0.2.352-production`, `0.2.347-public`, `039879946ffac22f`,
  `public-0.2.338-5969579fa2034d5d`, `0.2.350-public`, `695a6911fa90099f`,
  `private-code-te2-0.2.352`, `1393f1868422bdd5`, `84e6db88357e776f`,
  `06bf65412f09bfde`, `0.2.349-public`.
- `/root/.cache/te2-release-acceptance/` children:
  `joint-stable-0.2.354-als-0.2.139`, `0.2.354-1c8f0505-linux`,
  `joint-0.2.354-als-private`. These are NOT the protected home install.
- `/home/mrsurge/.cache/` children: `te2-public-0.2.344`,
  `te2-public-0.2.345`, `te2-public-0.2.351-acceptance`.
- `/home/mrsurge/.cache/te2-release-0.2.342/` children:
  `public-curl-acceptance`, `linux-acceptance`.

Summed per-directory allocated size was 19,305,426,944 bytes (~18 GiB); actual
filesystem free-space delta is smaller, so do not report the sum as recovered
space. No broad cache/container pruning or further build-tree cleanup performed.

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

## Running candidate builds

- Debian container `te2-linux-candidate-0.2.355`, image
  `sha256:a9cc5bf581bfdb1f100751ee19d28639817b005e51d55ac3b3d7fcf23e78e649`;
  outputs `/root/.cache/te2-release-build/candidate-0.2.355/output`.
  Two Cargo jobs, 6 GiB container ceiling, retained predecessor Cargo caches.
  Candidate identity `validation-0.2.355-6ce09cdd`, publicationEligible=false.
  Domain donor is the published Linux .354 wheel (SHA-256 in .354 BUILD_STATUS).
- Pixel owned build PID initially 18766; log
  `~/.cache/te2-release-build/candidate-0.2.355/build.log`, terminal result
  `exit-status` in that directory. Four Cargo jobs and owned-process-group disk
  watchdog stops below 2 GiB free. Domain restore already verified/imported all
  143 compiled modules before framework compilation. Donor is the published
  Android .354 wheel, hash verified. Raw editor-worker source tree is unchanged.
- Neither build changes the running framework or selectors. No tag, upload,
  APK install or Debian cleanup has happened. The earlier APK-build hold was
  superseded by explicit approval below; no install/publication is implied.

## APK execution — renewed approval 2026-10-19

User approves all three staging targets on Debian, actual payload/signature/
alignment audits and Downloads copies. Exact native correction source hashes
match the isolated remote unit-source-0.2.355-zoom tree. No source commit/tag or
device install is requested by this build approval; retain source patch/hash
evidence with these test artifacts.

Output: /root/.cache/te2-android-build/staging-0.2.355-zoom/.
Termux builds first, then ordinary Cefrium; Gecko uses separate AGP/Gradle with
compatible JDK 21 (Debian has no openjdk-17 package). Android platform 36 added
for Gecko, platform 37/Cefrium and its JDK 25 remain unchanged. Two Gradle workers,
3 GiB JVM heap, sequential builds; no Cargo/R8 concurrency. Native asset mapping
tests pass 9/9. Initial free space 106 GiB, approximately 104 GiB during R8.

Termux staging succeeds (6m54s). APK 171,096,575 bytes, SHA-256
`7e1cfbd5600c4a92229c8ddc85a3fbf2e958d98520b64843c745e54c1be22608`.
Audit passes: exact 445-file .355 seed with no extras, actual APK version 20355 /
1.0.8-r0.2.355-termux, expected public GitHub-Termux certificate, APK v2 signature,
16 KiB zipalign, compressed ARM64 native libraries/DEX and exact toolbar assets.
Matching R8 mapping retained (SHA-256
321a04165f111d55e76dd000188a0fa1cae31efbbb23efa9e2e3f39b517e72d7).
Source APK is ready for user foreground/scale acceptance, not yet live accepted.
Termux copy completed in desktop Downloads with the exact verified checksum.

Cefrium staging succeeds (6m22s), 174,937,188 bytes, SHA-256
`ee4f8c00553a4f443d8217f295acdb03a5a728f2f17dfb902a9246eb7d44d1cf`.
Same actual seed/signature/alignment/native compression audit passes, 67 JVM
tests retained; mapping SHA-256
`e38738afb6071ef2c5af082a844f47e46afd13edaa96c042d7b57ae001754be9`.
Initial copy step expected te2-cefrium-staging.apk but Gradle emits
cefrium-staging.apk; corrected artifact copy without rebuilding/changing bytes.
Gecko starts separately using the installed compatible JDK 21 rather than the
unavailable JDK 17. No APK installations or releases performed.

Gecko staging succeeds (6m1s), 103,203,101 bytes, SHA-256
`aab5e6b893e21ff3679d9d61ef486d03644cc452f2c229600ffb65aaedb1b6d7`.
99 JVM tests pass. Actual APK audits verify v2 signature, expected development
certificate, 16 KiB ZIP alignment, all 445 seed bytes/no extras, correct .355
version/code, ARM64-only native libraries with Deflate compression. Mapping
SHA-256 `3caf47ec3d23da5665d635cf4591d8307e062b414881258a2d7a9b9825461b27`.
Existing Kotlin/R8 metadata warning remains accepted/deferred, not suppressed.
AGP could not further strip upstream Gecko native libraries; packaged prebuilt
bytes are retained, not claimed newly stripped. No toolchain/runtime migration.

Cefrium and Gecko desktop Downloads copies are checksum-verified, as is Termux.
Termux 163.2 MiB, Cefrium 166.8 MiB, Gecko 98.4 MiB (binary units).
Remote audit JSON and exact mapping files remain in staging-0.2.355-zoom.
Disk remains approximately 96 GiB free; no cleanup of old releases performed.

## Finalization approval / installer closure

User approves source commit/push, .355 version tag and final clean-tag wheel
packages/receipts, stopping before public uploads. Installer scripts remain
release assets with manifest/checksums. The runtime installer already supports
PyPI for .354+ and legacy archives for earlier versions; only the public manifest
builder still required an obsolete archive. Separately approved --pypi assembly
mode records exact tested ALS/FWS versions, requires matching clean source/tag
for eligibility, and omits the unused modern archive while preserving old mode.
Regression group passes 50 tests plus four subtests, including legacy/current
bootstrap routing and public checksums. No install/runtime code changed.

Finalization completed: commit 499d2014aec6b646e4e09ae038a9502872754a79 and
annotated tag 0.2.355 pushed. Final wheel sizes: Linux 98,413,110 bytes; Android
49,429,574 bytes. Both clean-tag receipts publicationEligible=true. All 163 Linux
and 146 Android ELF files equal accepted .355 candidates; both fresh joint venv
checks and ALS native discovery/EOF pass again. No native recompilation needed.

Public upload staging is local to Debian only:
/root/.cache/te2-release-build/final-wheels-0.2.355/public/. Nine hashed assets
(two installers, two wheels, sdist, three APKs, template ZIP), release-manifest.json
and SHA256SUMS. All checksum lines/manifest records verify. Actual generated
bootstrap --help smoke passes Linux and emulated Termux routing with file://
release metadata, validating scripts/checksums without installing or apt/PyPI
mutations. Legacy/current routing regression group passed 50 tests/four subtests.
Public uploads/draft changes/publication remain pending permission; .354 draft
and published .354 wheels remain untouched. Cleanup has not started.
