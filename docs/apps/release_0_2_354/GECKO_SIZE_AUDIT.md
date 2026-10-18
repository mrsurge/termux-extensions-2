# Gecko staging size audit — 2026-10-15

## 1. Configuration

This section records the original audit baseline; later approved trials/results
are below. Current staging defaults to compression and R8 trial settings.

- AGP 8.9.1/JDK 17 lane. Staging is non-debuggable but explicitly has
  isMinifyEnabled=false and no resource shrinking. Release enables R8 with
  proguard-android-optimize.txt but has no isShrinkResources=true.
- No android.enableR8.fullMode=false opt-out was found. The optional optimized
  resource-shrinking flag is not set. No toolchain migration is proposed before
  this release; a separately approved staging optimization is the bounded path.
- No keepDebugSymbols/doNotStrip rule was found. Existing arm64 Gecko staging
  excludes the Vulkan validation layer. Inspect the final APK, not only Gradle
  configuration, before attributing savings to stripping.

## 3. Optimization summary

Existing APK: android/app/build/outputs/apk/gecko/staging/app-gecko-staging.apk,
mtime 2026-10-12. It predates current source and is only a size baseline.

| Category | Uncompressed bytes | ZIP payload bytes |
| --- | ---: | ---: |
| Native libraries (12) | 166,800,200 | 166,800,200 |
| Assets (952) | 64,134,973 | 28,525,838 |
| DEX (3) | 23,401,748 | 8,366,278 |
| Other entries | 1,206,453 | 999,862 |

Total APK including archive overhead: 205,044,077 bytes / 195.5 MiB.
libxul.so alone: 147,057,776 bytes, stored without ZIP compression. ELF inspection
found .dynsym (83,472 bytes) and .gnu_debuglink (20 bytes), but no .symtab,
.strtab or .debug* sections. This supports an already-stripped libxul, not a
claim that every native library has been independently audited.

Optimization/shrinking/obfuscation scores are not measured: staging did not run
R8 and no new optimized APK/configuration analysis was generated. R8 can target
DEX/resources, not the Gecko ELF engine. DEX's current ~8.0 MiB ZIP contribution
is an upper bound on eliminating that entire category, not a predicted saving.

## 4. Keep rules evaluation

### Named msgpack MessageBufferU / MessageBufferBE classes

- Keeps: two explicitly named implementation classes and their members; no
  quantitative item count was generated.
- Action: retain for the initial optimized candidate. Source comments identify
  class-name-based selection. Validate real MessagePack transport/reflection
  before proposing narrower rules; blanket AndroidX/Kotlin/Gecko keeps are not
  present in the app rules and should not be added speculatively.
- Existing dontwarn java.beans/okhttp/okio/sun.nio.ch entries suppress diagnostics;
  they are not blanket keep rules and do not themselves disable shrinking.

## 5. Native ZIP compression candidate — added 2026-10-16

User prioritizes downloaded release APK size over installed footprint. Evaluate
packaging.jniLibs.useLegacyPackaging=true for Gecko staging, alongside but
measured separately from R8/resource shrinking. This replaces the earlier
compression-investigation deferral; no Gradle edits or build are approved yet.

Modern AGP defaults to uncompressed/page-aligned .so entries when minSdk >= 23
and packaging is unset. Those can load directly from the APK without an extracted
copy. Legacy packaging requests ZIP-compressed libraries and installation-time
extraction. Stripping removes symbols; ZIP compression is independent and can
still reduce already-stripped libxul substantially, with actual savings unmeasured.

References: [AGP native packaging defaults](https://developer.android.com/reference/tools/gradle-api/8.9/com/android/build/api/variant/JniLibsApkPackaging)
and [native extraction behavior](https://developer.android.com/guide/topics/manifest/application-element#extractNativeLibs).

Review native loading assumptions and manifest overrides first. After concrete
approval, compare same-source candidates, verify actual compressed ZIP entries,
signing/alignment and ABI/page-size compatibility, then test installation,
upgrades and cold startup. Report extraction/storage costs without treating them
as the optimization objective. Do not alter/recompress the signed artifact or
automatically apply the policy to Cefrium/TE2 Termux.

### Approved compression-only trial

User approved staging-only configuration and two same-source APK builds on
2026-10-16, without installation/publication. R8/debug/release settings remain
unchanged so the native compression effect is isolated. The staging variant
sets useLegacyPackaging through AGP's variant API; the comparison override is
-Pte2.gecko.compressNativeLibs=false (default true for staging).

Read-only loader review: app source uses GeckoRuntime.create and has no direct
System.load/nativeLibraryDir/APK-path override. The pinned GeckoView 144 AAR
manifest has no extractNativeLibs override. Inspection of its GeckoLoader class
shows System.loadLibrary and Android BaseDexClassLoader.findLibrary, including
normal filesystem loading paths. This supports the trial, not guaranteed device
compatibility. No hand-stripping or SDK/AGP migration is included.

The old October 12 APK is retained separately under the named workspace scratch
gecko-native-compression directory. Current candidates use existing APK-seed
assets and are packaging comparisons, not final release asset acceptance.

### Compression-only results

Both same-source builds succeeded (uncompressed 1m53s, compressed incremental
21s). Kotlin/Java/DEX/assets were up-to-date in the second build. R8 is still off.

| Measurement | Uncompressed baseline | Compressed candidate |
| --- | ---: | ---: |
| APK bytes | 205,044,149 | 108,413,133 |
| Native uncompressed bytes | 166,800,200 | 166,800,200 |
| Native ZIP payload bytes | 166,800,200 | 70,247,396 |
| libxul ZIP payload bytes | 147,057,776 | 61,566,792 |
| .so ZIP method | Stored (0) | Deflate (8) |
| extractNativeLibs | false | true |

Download reduction: 96,631,016 bytes (47.1%; approximately 92.2 MiB). This is a
measured compression result, not an R8 estimate. All 12 native libraries retain
identical decompressed bytes. ZIP entry names match exactly, and streaming
SHA-256 comparison of every entry finds only AndroidManifest.xml changed.
Both APKs pass apksigner v2 verification and zipalign -c -P 16 4. AAPT2 confirms
the compressed APK's extraction flag. ZIP alignment is not proof of ELF 16 KiB
compatibility or real-device startup; install/update/cold-start gates remain.

Artifacts under .codex-scratch/gecko-native-compression (or TMPDIR when set):

- gecko-staging-uncompressed.apk SHA-256:
  6a795e591c091138947221e37a2c260d2ba86116706241d66a12a44d7d46d1b4
- gecko-staging-compressed.apk SHA-256:
  b916e8e7c6ffb16f8885514e1cb2af1fe7fd47ac71337cb4adc79f3cc47bc401
- baseline-20261012.apk preserved SHA-256:
  dfeb004bda122546cab1dc8c19b8f42077856dcd8ac19c8ba7122ee1fa8f11de

Build commands from android/ (existing Linux SDK/JDK helper):

```bash
./linux-sdk-env.sh ./gradlew :app:assembleGeckoStaging -Pte2.gecko.compressNativeLibs=false --console=plain --max-workers=2
./linux-sdk-env.sh ./gradlew :app:assembleGeckoStaging --console=plain --max-workers=2
```

The normal Gradle output currently contains the compressed candidate; named
scratch copies preserve both comparisons. They retain existing 0.2.353 metadata
and old seed assets: no version bump/publication/final release claim. No device
was installed or modified. Disk preflight was 13 GB free, completion about 12 GB;
no cache cleanup was performed. Further APK targets await separate loader review.

### User live acceptance — 2026-10-16

User confirms installing the compressed candidate and actively using it, with
normal operation working fine. The tested installation/launch/use path passes.
No startup timing, extraction-storage measurement, exhaustive update scenario,
16 KiB device coverage or other-renderer acceptance is inferred from this report.
The earlier no-install statement describes agent actions before user validation.

## 6. R8/resource shrinking trial — 2026-10-16

User approved a staging-only optimization/resource-shrinking switch, build and
artifact checks without installation/publication. Staging defaults to optimized;
-Pte2.gecko.optimize=false is its opt-out. Native compression stays enabled.
Existing proguard-android-optimize.txt, two named msgpack keeps and Gecko's
consumer JNI/reflection rules are retained. No blanket app keeps or global
optimization disables were introduced; no toolchain migration performed.

| Measurement | Accepted compressed baseline | R8 trial |
| --- | ---: | ---: |
| APK bytes | 108,413,133 | 101,573,686 |
| DEX count | 3 | 1 |
| DEX raw bytes | 23,402,844 | 3,926,452 |
| DEX ZIP bytes | 8,366,996 | 1,848,680 |
| Native ZIP bytes | 70,247,396 | 70,247,396 |

Additional APK saving: 6,839,447 bytes (6.3%). Build succeeded in 2m33s.
Both native and frontend asset payloads are hash-identical to the accepted
compressed baseline; only assets/dexopt/baseline.prof and baseline.profm differ
within the assets tree, as expected when DEX profiles are regenerated. APK v2
signature and zipalign -c -P 16 4 pass; extractNativeLibs remains true. The 12
focused asset regressions pass. This is not device/runtime performance evidence.

Trial artifact: .codex-scratch/gecko-native-compression/gecko-staging-r8.apk
(TMPDIR replaces .codex-scratch when set), SHA-256:
1bcee6e7c06a8dbb3deebf3ee8abd032095b130d85323dfdca461d4732cb0858

Preserved sibling r8-mapping/ contains mapping.txt, configuration.txt, usage.txt,
seeds.txt and resources.txt. Retain the exact mapping with this APK. The original
accepted compressed APK remains separately preserved. Normal Gradle output is
now the R8 trial, still with old seed assets/version metadata, not a final release.

### Compatibility warning / release gate

R8 warned that Kotlin metadata parsing failed. mapping.txt identifies compiler
8.9.32; project Kotlin is 2.2.10. Android's compatibility table lists R8 8.10.21
for Kotlin 2.2: [official compatibility table](https://developer.android.com/build/kotlin-support).
Do not equate build/signature success with metadata/runtime compatibility.
Resolve or obtain an explicit decision on this warning before release acceptance;
no toolchain change or warning suppression is currently approved.

Subsequent user disposition after corrected-APK live acceptance: defer this
warning/toolchain alignment for now, leaving diagnostics visible. It is no longer
a standalone release blocker by user decision, and is not claimed fixed.

The skill-guided keep-rule audit found no need to add broad app/library keeps;
Gecko's own broad org.mozilla.geckoview consumer rule is intentionally retained,
not experimentally narrowed. Quantitative R8 configuration scores are not
available from this compiler run and are not invented. Startup/memory benefits
require measurement; no app was installed or benchmarked by the agent.

### Razr startup crash: bundled platform-JSON collision

The user installed the R8 trial and reports immediate force-close. Read-only ADB
crash-buffer inspection of motorola-razr-2024-xt2453v:5555 shows repeated
2026-10-16 06:21:02/06:21:04 NoSuchMethodError for static
wrap(Ljava/lang/Object;)Ljava/lang/Object; on h3.c, from GeckoBundle through
WebExtension.Port.portMessage. Exact trial mapping identifies h3.c as
org.json.JSONObject. Pinned GeckoBundle bytecode calls JSONObject.wrap; the
resolved org.json:json:20090211 JAR has no wrap method.

Gradle dependencyInsight confirms both Socket.IO 2.1.1 and Engine.IO 2.1.0 bring
this old JSON JAR into geckoStagingRuntimeClasspath. R8 rewrites references to
the bundled implementation rather than Android's platform JSONObject. This is
concrete evidence for this crash, not evidence that the separate Kotlin metadata
warning caused it. Do not add keeps for a method absent from the bundled JAR.

User approved excluding org.json:json on the app's Socket.IO dependency and
rebuilding without installing/clearing data. JVM-only testImplementation remains.
The corrected runtime dependency report has no org.json:json. Further artifact
checks and fresh device acceptance remain pending; the first R8 APK is rejected.

Corrected build succeeds in 1m52s. Runtime dependencyInsight has no org.json:json;
geckoStagingUnitTestRuntimeClasspath still includes its explicit test dependency.
Inspection of actual DEX class definitions finds no org.json definitions and
confirms the method reference Lorg/json/JSONObject;.wrap; R8 mapping likewise has
no bundled org.json classes. APK v2 verification and ZIP alignment pass. Installed
Razr base.apk SHA-256 matches the rejected first R8 artifact exactly, ruling out
an unrelated installed build for the captured stack trace.

Corrected artifact: .codex-scratch/gecko-native-compression/gecko-staging-r8-platform-json.apk
(TMPDIR convention unchanged), 101,569,222 bytes, SHA-256:
175625a348ad0550edc800321ad4bce76d1d509c730251dfaa3c7dbb36e962fa

Its exact reports/mapping are preserved in sibling r8-platform-json-mapping/;
the original failing trial and accepted compression-only APK remain preserved.
The Kotlin metadata warning persists unchanged and is separately tracked, not
suppressed or claimed fixed. Fresh Razr validation is pending; no installation,
data clearing or user application launch was performed by the agent.

User subsequently confirms the corrected APK works on the device (2026-10-16).
This accepts the reported launch/use path, not a measured startup/RAM gain or
blanket metadata compatibility proof. Focused production-source inspection found
no Kotlin-reflection/reflective-serialization calls; kotlin-reflect is debug-only,
and the corrected trial mapping contains no kotlin.reflect.jvm.internal or
kotlinx.serialization class definitions. That lowers the apparent metadata-reader
exposure, but does not identify every class that triggered R8's warning.
