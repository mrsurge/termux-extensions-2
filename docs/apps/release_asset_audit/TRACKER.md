# Release asset audit tracker

2026-10-17: historical audit/artifact evidence only; the single current
pre-release checklist is docs/apps/release_0_2_354/TRACKER.md. The latest ALS
149-resource/445-file OTA seed verification is recorded there and in the
Sidebar tracker evidence, not a claim that final release APKs were rebuilt.

Current release scope: ../release_0_2_354/PLAN.md, R1 static dependency/mapping
closure and R2 Gecko staging optimization. See its TRACKER.md for pending gates
and GECKO_SIZE_AUDIT.md for the read-only old-APK baseline. Historical published
artifact acceptance below does not validate a newly built release candidate.

## ALS proxy static assets — additional slice

User reports ALS working after Cefrium staging build/packaging repair. Treat this
as functional acceptance on the tested client, not proof of Electron/Gecko
publication or every asset's executing provenance. ALS embeds/serves its frontend
in Rust; clients intercept the pinned static bytes while dynamic HTML and runtime
transport configuration remain ALS-owned and proxied.

- [x] User approved static snapshot/provenance and routing across all four clients.
- [x] Inventory actual ALS resources; distinguish wrapper and proxied frontend.
- [x] Vendor 148 ALS 0.2.132 static files, source/served hashes, commit and license.
- [x] Add full OTA/APK tree, required core files and static-prefix mappings.
- [x] Preserve proxy rewrite semantics/dynamic ownership; Gecko local-origin
  aliases, WASM MIME and no-store handling.
- [x] Final isolated validation and source/publication handoff documented.
- [ ] Rebuild Electron/Android clients, publish matching assets and live validate
  ALS in Sidebar; no assembly/deployment occurs in this source slice.

Snapshot: 5,058,704 raw asset bytes (~4.82 MiB), plus provenance/license. ALS source
checkpoint: 2a7bf78d00024cfdfd4a5175f445e9db70bb9303; no nested-repo edits. Dynamic
pages retain runtime transport settings; APIs/sockets/user extension assets are
not intercepted. Provenance is not a runtime compatibility handshake.
Contract: app/apps/als_rs/README.md.

Validation: five vendor/projection Python tests, eight cross-client/built-in Node
tests, three real Electron asset-mapping tests and four isolated shared Android/
Cefrium Kotlin/JUnit route tests pass. Electron typecheck and vendor script ty
pass. Existing package/asset Python run: 22 pass; one pre-existing retired Python
Code TE2 mount assertion fails as documented below (not changed by this slice).
Follow-up: that historical assertion is now aligned with native serving/domain
ownership; current validation is in release_0_2_354/TRACKER.md, R4 cleanup.
Installed ALS 0.2.132 raw static files match all 148 source snapshot hashes.
Measured Deflate ZIP for the ALS snapshot alone: 1,597,583 bytes (~1.52 MiB);
this is not a measured APK/wheel size change. No APK/OTA/seed publication occurred.
The system Kotlin compiler was too old for existing trailing commas; cached
Kotlin 2.4.10 compiled the real shared/Cefrium route sources and JUnit tests.

## Earlier acceptance

- [x] Read-only investigation and concrete cleanup/publication approvals.
- [x] APK compression inventory/Deflate savings estimate.
- [x] Remove 397 confirmed unused source files; preserve `.map` files.
- [x] Stale Highlight.js packaging exclusion and regression tests.
- [x] Code TE2 frontend typecheck/build; 14 focused snippet/diff tests pass.
- [x] README version/download references updated from 0.2.352 to 0.2.353.
- [x] Android wheel copied Pixel → local → Debian; exact accepted SHA256 verified.
- [x] Twine metadata check and upload succeeded using isolated Debian tooling.
- [x] Verify published PyPI digest and platform-specific pip selection.
- [x] Final package/native-runtime regressions: 50 pass.

The asset-route suite has one pre-existing failure:
`test_main_mounts_only_resources_from_editor_http_boundary` asserts
`TE2_ASGI_APP = build_code_te2_asgi_app(` is in `main.py`, but HEAD already moved
HTTP/Socket.IO ownership to the Rust native worker. Do not restore retired Python
serving to satisfy this stale assertion; test modernization is deferred to the
next FastAPI-dependency cleanup workstream. Other 53 tests in that run passed.

No native APK compression settings, accepted artifacts, installed environments or
running frameworks/workers were changed. Earlier uncommitted mypyc tooling changes
and unrelated user files remain preserved.

Published PyPI SHA256 matches the accepted Android wheel exactly:
`884d2620872913ff9f90b287c4f0fe44de37d37c1c6addb1cb9fdbe81a5bed9d`.
Existing Linux wheel/sdist digests are unchanged. Pip dry-run on isolated Debian
publisher selects the Android cp314 wheel for android_24_arm64_v8a/CPython 3.14,
and the manylinux wheel for Linux x86-64/CPython 3.13. No package installation
took place. PyPI index propagation initially returned older listings; fresh
metadata and a subsequent Android dry-run verified successful publication.

### Cefrium packaging verification — 2026-10-13

User-built staging APK MD5 `0cff595f426ed21d3f45bb6f6492119b` was a valid ZIP
but lacked AndroidManifest.xml and resources.arsc. Optimized-resource metadata
referenced a missing resources-staging-optimize.ap_; the earlier shrunk archive
contained the manifest. Original output disappearance cause is not established.
Approved incremental standalone assembleStaging with JDK 25 and explicit SDK
regenerated resource output and packaging, reusing Kotlin/Java compilation but
rerunning R8. Build succeeded in 5m22s (10 tasks executed, 43 up-to-date).
Final APK includes manifest/resources and passes apksigner v2 verification;
MD5 `5e60ef57991b26c643bad93ee61525a2`, approximately 166 MiB.
No source configuration edits, asset-seed publication, installation, uninstallation
or runtime restart. Device installation/live acceptance remains pending. Repeated
final-R resource-shrinking warnings are user-confirmed normal build output; their
time/size impact was not measured.
