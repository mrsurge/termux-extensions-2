# TE2 Termux packaging trial — 2026-10-16

Source checkpoint 2e77c843. User approved a Termux-staging-only DEX compression
trial/build and artifact checks, not installation, data clearing or publication.
This follows accepted Gecko native compression and corrected R8 builds; it is
not a renderer migration or modification to the generic Electromux source.

## Existing packaging

android/termux/settings.gradle.kts selects the real android/cefrium/build.gradle.kts.
That shared build already sets jniLibs.useLegacyPackaging=true, and staging
already enables R8/resource shrinking. Native compression is therefore not a new
change for this client. Preserve CEF's noCompress dat/pak/bin policy pending a
separate direct-loading/mmap review.

Existing October 12 APK (not a current-source candidate): 201,751,603 bytes.
Its six native libraries total 316,546,000 raw / 118,475,817 ZIP bytes. libcef is
219,351,704 raw / 90,120,637 ZIP; libnode is 87,657,320 / 25,961,161. Both already
use Deflate. Eleven DEX entries occupy 47,878,304 bytes stored/uncompressed.

## Approved change and validation

Only termuxConsumer staging sets variant.packaging.dex.useLegacyPackaging=true.
The comparison opt-out is -Pte2.termux.compressDex=false. Ordinary Cefrium and
debug/release packaging remain unchanged; existing native/R8 policy is retained.
Keep old APK and same-source uncompressed baseline separately before building
the compressed candidate. Do not attribute unrelated source changes versus the
October APK to compression savings.

Use existing AGP 9.4/Gradle 9.7.1/JDK 25 lane and checksum-pinned Node SDK/NDK.
Recover explicit public GitHub-Termux test credentials from upstream rather than
inheriting an unrelated signer; verify certificate/shared UID on the final APK.
No credentials are committed. Compare exact DEX/native/asset payload hashes,
ZIP methods/sizes, signatures and alignment. Record remaining device acceptance.

DEX compression changes install/loading storage tradeoffs, not Java/Kotlin code
semantics. It is separate from R8 optimization and native-library extraction.
Do not claim faster startup or lower runtime RAM from APK size alone.

The current-source baseline emits existing CEF-generated final R-field warnings
under optimized resource shrinking, Chromium dynamic-module identifier warnings
and a SingleWebsiteSettings.getPermissionPreference type-check warning. These
occur with DEX compression disabled, not as a result of the packaging switch.
They are not suppressed or declared harmless; this scoped trial does not change
CEF's generator, keep rules or resource shrinking. Retain a live-acceptance gate
and investigate separately if a corresponding runtime failure is observed.

## Gecko warning disposition

User accepts leaving Gecko's Kotlin/R8 metadata warning unresolved and visible
for now, after corrected APK device acceptance. No warning suppression or
toolchain change is authorized. Native compression and the confirmed fixed JSON
collision are independent issues. Keep toolchain alignment in deferred work.

## Results

Same-source baseline succeeds in 9m; the compression-only rebuild succeeds in
36s (129 of 134 tasks up-to-date, including R8). Current compiler is R8 9.4.14.

| Measurement | DEX stored | DEX compressed |
| --- | ---: | ---: |
| APK bytes | 201,752,643 | 169,465,787 |
| DEX count | 11 | 11 |
| DEX raw bytes | 47,878,888 | 47,878,888 |
| DEX ZIP bytes | 47,878,888 | 15,592,050 |
| Native raw bytes | 316,546,000 | 316,546,000 |
| Native ZIP bytes | 118,475,817 | 118,475,817 |

Measured saving: 32,286,856 bytes / 16.0% of APK. ZIP names match, and streaming
SHA-256 comparison confirms every extracted entry is identical, including DEX,
native libraries, resources and assets. This isolates ZIP packaging, not another
R8 change or omitted files. CEF dat/pak/bin policy and ordinary Cefrium unchanged.

Final APK passes apksigner v2 verification and zipalign -c -P 16 4. AAPT2 confirms
package com.termux.extensions.te2termux, sharedUserId=com.termux and
extractNativeLibs=true. Certificate SHA-256 is
b6da01480eefd5fbf2cd3771b8d1021ec791304bdd6c4bf41d3faabad48ee5e1,
matching the public GitHub-Termux test lane and prior accepted consumer identity.
ZIP alignment alone does not prove ELF or physical-device runtime compatibility.

Preserved artifacts under .codex-scratch/termux-dex-compression (TMPDIR when set):

- te2-termux-staging-dex-stored.apk SHA-256:
  18aafecdf1803ef664fdce777284ddab08a34cfd997918f6ea3b34e811ff63d4
- te2-termux-staging-dex-compressed.apk SHA-256:
  1cbf6e64fb180abfc4bf29fca30dbf831da1900609640423d4e86d6778b73ad8
- baseline-20261012.apk and its original mapping are preserved separately.
- current-mapping/ retains the matching mapping.txt and configuration.txt for
  both same-code comparison APKs. Do not use the original October mapping.

Normal android/termux/build/outputs/apk/staging/te2-termux-staging.apk now contains
the compressed candidate. Existing version metadata and editor seed remain;
this is not final release asset publication. The embedded consumer/backend
bundling tasks ran normally. Generic Electromux tracked source stayed clean.
Free disk was about 12 GB initially / 8.6 GB after builds and retained artifacts;
no cache cleanup, installation, data clearing or publication occurred. Live
acceptance was pending at build handoff. On 2026-10-16 the user closed the APK
Deflate steps as done and selected reuse of this pattern for ordinary Cefrium's
shared base. This does not claim the Termux-only DEX switch has been widened or
that final release artifacts have been published. Source whitespace check passes.

Build with the existing SDK/NDK/Node and explicit verified public-test signing
environment; from android/termux:

```bash
./gradlew assembleStaging -Pte2.termux.compressDex=false --console=plain --max-workers=2
./gradlew assembleStaging --console=plain --max-workers=2
```

## ALS seed refresh and approval JavaScript inspection

User found ALS styling missing on the compression-test APK. ZIP inspection
confirmed that its reused October editor_static seed contained only the ALS
wrapper, not apps/als_rs/frontend at all. Source inventory/mapping tests alone
did not prove APK publication. The actual currently served OTA ZIP contains 150
snapshot files (148 static plus provenance/license), including hash-matching
codex_agent.css (80,480 bytes, SHA-256
307123c86284c610c2d092374628ae2e54bf85baf0b3c6c0695bd6813573c264)
and font CSS; the current OTA archive was not missing those files.

User approved scripts/bundle_gecko_assets.sh seed refresh and Termux rebuild,
without installation/data clearing. All 444 generated seed files were verified
byte-for-byte inside the final APK, with no stale/omitted seed entries. All 148
ALS static files additionally match their pinned manifest hashes. Build succeeds
in 54s; 12 focused asset regressions, v2 signature and ZIP alignment pass.

New UI-test candidate: .codex-scratch/termux-dex-compression/te2-termux-staging-refreshed-assets.apk
(TMPDIR convention unchanged), 171,083,173 bytes, SHA-256:
0564ee4f65462a08a3cd81f6d1203256c074d9c8a42d3d8f2ae7ab7ce63732a8

The added complete ALS snapshot changes bytes versus the earlier compression
comparison; do not attribute this difference to DEX packaging. Old candidates
remain preserved. The refreshed shared seed also feeds future Gecko/Cefrium
assemblies, but those APKs were not rebuilt here. Same-version on-device assets
are deliberately not reseeded by APK update: use the existing explicit forced
OTA flow for this test without clearing data. No forced update was performed by
the agent. Final release version/ALS dependency alignment remains a later gate.

Extension approval UI is split: core approval/request-card runtime lives inside
the pinned ALS frontend bundle; Codex's extension-owned renderer is declared as
ui/request_cards/codex_ext_request_card.js and served at
/api/app/als-rs/proxy/api/extensions/codex-ext/assets/ui/request_cards/codex_ext_request_card.js.
This is intentionally outside /proxy/static interception: installed extension
resources remain owner/version controlled, not silently replaced by a frontend
snapshot. Live read-only fetch via the exact ALS console worker returns HTTP 200,
text/javascript and 34,644 bytes with renderRequestCard export. Performance
entries show it was requested through that route. No extension UI code or sibling
ALS source was modified or executed by this diagnostic fetch. Bundling extension
resources needs a separate version/invalidation contract, not a broad API mapping.

Authored-source whitespace check passes with generated editor_static excluded.
The copied host.js inherits trailing whitespace inside generated bundle lines;
do not trim/reformat it independently of its source artifact/hash. APK-vs-seed
and ALS provenance hash checks above are the relevant publication checks.
