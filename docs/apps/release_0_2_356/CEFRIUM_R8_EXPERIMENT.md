# Isolated Cefrium staging comparison

User-approved VPS-only experiment, 2026-10-27. This does not authorize changing
the production Cefrium pin, installing APKs, publishing, or restarting TE2.

Use 0.13.0-or-newer as the user's known R8-fixed baseline; test current 0.15.0
against the existing 0.9.0 release evidence. Do not confuse the version carrying
the fix with the current candidate. Upstream release notes and actual packaged
consumer rules are evidence, not a substitute for our own staging result.

## Isolation and controls

- Work only under /mnt/vdb/te2-release-0.2.356/experiments/cefrium-r8.
- Clean TE2 checkpoint 747cfd12 is the experiment's source baseline. Keep the
  Electromux consumer migration separate so it cannot skew results.
- Compare ARM64 Cefrium staging, identical frontend seed and compression, R8
  enabled, optimized default configuration and resource shrinking enabled.
- Record exact plugin/SDK coordinates, artifact hashes, source patches, AGP/JDK,
  native/DEX compressed and uncompressed bytes, APK bytes, signatures/manifests,
  merged R8 configuration and any available quantitative analyzer reports.
- R8 shrinks Java/Kotlin DEX; it cannot shrink libcef.so. Report both separately
  to show whether DEX/resource savings offset native-library growth.
- Do not remove keep rules merely to improve a size number. New origin-policy
  API adaptations must preserve existing exact-document checks, loopback relay
  behavior, iframe console/debug use, inspector and lifecycle/scaling guards.
- If old 0.9.0 dependencies cannot be reconstructed from their exact cached
  artifacts/metadata, label the old APK as historical evidence, not a newly
  reproduced controlled baseline. Never silently substitute another old SDK.

## Current findings / gates

- Production source remains pinned to plugin/SDK 0.9.0, AGP 9.4.0, JDK 25.
- The 0.9.0 SDK consumer rules contain `-keep class org.chromium.** { *; }`.
- The configured registry and Maven Central returned 404 for the old plugin
  marker; the registry also returned 404 for old SDK/plugin POMs. Copied local
  cached SDK/plugin identities are preserved in VPS receipts, not synthesized
  as new published Maven metadata. Read-only Gradle cache reuse has not yet
  resolved the old plugin marker.
- Current 0.15.0 Maven Central SDK metadata is available. Its origin-policy API
  is a required migration seam; do not bypass it with unrestricted anyOrigin.
- [x] Produce isolated candidate and record required source/API adaptations.
- Candidate 0.15.0 downloaded from Maven Central, SHA256
  68a68fac6f36158ca9915725d9dc2c455cc9fa2add763ffd0fdf6a58d81abaed.
  The isolated source patch changes plugin/SDK pins and supplies required
  loopback QueryOriginPolicy, retaining subframe support on the main surface.
- Preliminary AAR ARM64 libcef.so entry: old 219,351,704 raw / 89,845,347
  compressed bytes; candidate 227,019,416 raw / 93,405,789 compressed bytes.
  Native compressed premium is 3,560,442 bytes (about 3.40 MiB). These are AAR
  entry figures, not final APK measurements or proof of R8 savings.
- Initial candidate compile failed at existing CefriumDevToolsRuntime.kt:263,
  265, 270, 1304. Chromium DevToolsServer now requires PrefService plus an
  explicit security parameter. SDK CefriumProfile exposes no public PrefService
  accessor. The user separately approved the candidate-only direct JNI adapter:
  use the shipped init/enable/destroy bindings, preserve the old Java wrapper's
  allowDebugPermission=false and TE2's existing explicit debug gate. No null/test
  preferences or disabled inspector. JVM test checks owned handle disposal and
  security flag; actual JNI/CDP operation still requires physical acceptance.
- Upstream shallow v0.15.0 checkout at experiments/cefrium-r8/upstream-0.15,
  exact commit efa20aee9aa67d99af7d52077d718221b41bdcc3. Source and packaged
  bytecode confirm the bindings. All experimental edits are saved as three
  patches in the experiment receipts directory, not applied to production source.
- Old pinned native/consumer validation did succeed using the exact cached
  artifacts via an invocation-only flat-directory init script with explicit AAR
  type; it does not restore vanished upstream Maven metadata.
- [x] Complete minified staging build and component/total size comparison.
- [x] Inspect merged R8 rules and quantitative analyzer output. Both builds emit
  keep-radius protobuf; supplied analyzer results and rule impacts are retained
  in receipts/baseline-r8-analysis.txt and candidate-r8-analysis.txt. Scores mean
  freedom from keep constraints, not measured execution speed or bytes removed.
- [x] Verify manifest, ARM64-only native inventory, all 447 seed-file hashes,
  approval renderer inclusion, no source maps, and valid intended development
  signatures. Both APKs retain package/version metadata of checkpoint 747cfd12;
  they are experiments, not new public release artifacts. Candidate JVM suite:
  71 passing tests including native-adapter policy test, no device JNI execution.
- [ ] Resolve/qualify generated Chromium R-field optimized-resource-shrinker
  warnings before promotion. Both controls emit warnings; upstream 0.15 plugin
  CefriumPlugin.groovy:291-293 still generates final fields. Do not claim this is
  fixed by the broad Chromium keep-rule improvement or by ordinary AGP flags.
- [ ] User decides whether candidate merits physical device validation.
- [ ] Promote only after size evidence and runtime acceptance; otherwise retain
  0.9.0 and preserve the experiment as deferred evidence.

## Matched measurements (binary MiB)

| Metric | 0.9.0 control | 0.15.0 candidate |
| --- | ---: | ---: |
| APK bytes | 174,947,836 | 142,572,801 |
| APK MiB | 166.84 | 135.97 |
| DEX files | 11 | 1 |
| DEX bytes (stored uncompressed) | 47,836,228 | 10,072,208 |
| ARM64 libcef.so bytes in APK | 90,120,637 | 93,694,296 |
| Optimization freedom score | 18.48% | 88.19% |
| Obfuscation freedom score | 18.53% | 86.98% |
| Shrinking freedom score | 18.55% | 86.91% |

Net APK saving: 32,375,035 bytes = 30.8752 MiB (18.5055%). DEX reduction is
37,764,020 bytes, offsetting 3,573,659 extra compressed native bytes plus other
SDK/resource changes. This does not promise a 50 MiB saving against every older
APK: debug/staging and historical frontend inventories are different controls.

Control SHA256: 85d8ba494fed707ea2a2016c8e2a54757cdf2b0285237648641ebb86253e23fe.
Candidate SHA256: 99661996569b605efe65af633aa5de53ec607adef3cd713e572403b97a75f1b4.
Machine-readable APK/asset measurements: receipts/{baseline,candidate}-apk.json.
No APK was installed, no production SDK pin changed, and no runtime restarted.
