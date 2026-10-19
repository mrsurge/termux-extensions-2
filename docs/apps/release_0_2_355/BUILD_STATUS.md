# 0.2.355 candidate wheel evidence

2026-10-19; source `6ce09cddf3faeab678d94ba7ca285d1baa3fba8b`.
These are validation candidates, not tagged/published final artifacts.
Published .354 artifacts remain unchanged. The earlier APK hold was superseded
by user approval for all three staging builds/audits and desktop copies only.

| Target | Wheel bytes | SHA-256 |
| --- | ---: | --- |
| Linux x86_64 | 98,413,121 | `52d57619d962964242561d97b3121c934b31f79500f817f756db86af4dd0714f` |
| Android ARM64 | 49,429,596 | `d3c553fbe17554a167ec7548dde3fd92cf1efba929b73d4cfd5839b78c0f0935` |

Both are strictly below PyPI's 100,000,000-byte ceiling. Linux wheel tag is
py3-none-manylinux_2_28_x86_64; Android is cp314-cp314-android_24_arm64_v8a.

## Locations / provenance

Debian: `/root/.cache/te2-release-build/candidate-0.2.355/`.
Linux output wheel, sdist and audit receipts are in `output/`; fresh installed
joint environment is `venv/`. Container `te2-linux-candidate-0.2.355` exited 0,
no OOM. Pinned image:
`sha256:a9cc5bf581bfdb1f100751ee19d28639817b005e51d55ac3b3d7fcf23e78e649`.
Build receipt explicitly says publicationEligible=false and
releaseTag=validation-0.2.355-6ce09cdd. GLIBC ceiling 2.28, no unbundled external
ELF dependencies in the native platform audit.

Pixel: `~/.cache/te2-release-build/candidate-0.2.355/`; wheel in `wheel/dist/`,
fresh installed joint environment in `venv/`. Build and validation exited 0.
Build used APK-started Termux SSH and a 2 GiB free-space stop guard, four Cargo
jobs. The original `~/mrselect6` checkout and running install were not changed.
Both builders used separate clean source-0.2.355 checkouts at the exact source
commit. Accepted native and compiler caches were retained.

Framework binary SHA-256:

- Linux: `4db6358f79f141b6304bf79b079fe6533c8c4a1bff398181ae24ff09794d39f0`
- Android: `e59130d4ba0e0b512f76ab0f0a4f1450907b3012080ce38ba3ddabfb6bd2989f`

ELF comparison against published .354 wheels: only te2-server differs. All 162
other Linux native files and all 145 other Android native files are byte-identical,
including editor workers and mypyc groups. Linux's ordinary build recipe invoked
Cargo for the unchanged worker; resulting shipped bytes still match exactly.
Restoration validates full startup source/ABI/hashes and imports the compiled
group before publication. This is verified reuse, not a reproducibility claim.

## Installed checks — passed, not user live acceptance

- Fresh normal pip resolution installs TE2 .355 candidate with ALS .139/FWS .65;
  pip check passes. No FastAPI, FastMCP, Python MCP SDK, Pydantic/core,
  cryptography or watchfiles in either installed dependency closure.
- Linux outer CPython 3.13.5 selects private editor CPython 3.14.6; Android uses
  system CPython 3.14.6. All 143 compiled modules import on both targets.
- Both outer and editor loops select uvloop: vanilla .23.0 Linux versus
  uvloop-te2 .23.0.post1 Android. FWS native pipe module loads as .so.
- Actual installed Socket.IO and WBA entry import: Linux Node v24.16.0,
  Pixel Node v25.8.0. No framework or user project is started by these probes.
- te2 --version reports te2-server 0.2.355 on both targets.
- ALS native MCP stdio initialize/tools/resources/EOF passes: 38 tools, one
  resource and clean exit. Additional Linux ALS verifier confirms its private
  libpython is actually loaded and its private dependency closure remains clean.
- Linux wheel's seven critical host/dialog/consumer-shell/version assets match
  checkpoint bytes exactly. Shared source seed contains 445 files at .355.

Logs: qualification.log, install.log and (Linux) als-private-qualification.log
under each candidate root. Linux output/build-metadata.json owns its complete
package/native receipt. Pixel wheel/build-metadata.json owns Android provenance.

## Remaining gates

User wheel live acceptance, final clean tag/source receipts and final packaging
are pending. APK builds are recorded below; no APK installation, PyPI upload,
GitHub publication or Debian cleanup has occurred. Protected paths and after-publication-only cleanup
are in PLAN.md. Do not remove or upgrade the protected .354 joint environment.

## APK staging candidates — 2026-10-19

Source checkpoint plus approved uncommitted Android zoom correction. Remote
isolated source: /root/.cache/te2-android-build/unit-source-0.2.355-zoom.
Outputs/logs/individual audit JSON, R8 mappings and native-source.patch retained
under /root/.cache/te2-android-build/staging-0.2.355-zoom. This patch plus newly
added lifecycle gate/test files is not a final committed/tagged release receipt.

| APK | Bytes | SHA-256 |
| --- | ---: | --- |
| TE2 Termux | 171,096,575 | `7e1cfbd5600c4a92229c8ddc85a3fbf2e958d98520b64843c745e54c1be22608` |
| Cefrium | 174,937,188 | `ee4f8c00553a4f443d8217f295acdb03a5a728f2f17dfb902a9246eb7d44d1cf` |
| Gecko | 103,203,101 | `aab5e6b893e21ff3679d9d61ef486d03644cc452f2c229600ffb65aaedb1b6d7` |

All actual APKs pass ZIP integrity, exact 445-file .355 seed/no extras,
versionCode 20355/versionName .355, expected target signing certificate and v2
signature, 16 KiB ZIP alignment, ARM64-only compressed native payloads. Termux
also verifies compressed DEX, embedded actor and exact APK-owned chrome assets.
Gecko JVM tests 99 pass; Cefrium 67, Termux 29 (plus Electromux host 29/Node18).
Existing resource-ID and Kotlin/R8 metadata warnings remain visible. Further
upstream Gecko native stripping was unavailable, not silently claimed successful.

Desktop destination: /home/mrsurge/Downloads/te2-0.2.355-<target>-staging-arm64.apk.
All three desktop copies are complete and checksum-verified against remote APKs.
User subsequently confirms zoom lifecycle works and explicitly accepts all
three APKs plus both wheel candidates. Final clean-tag provenance/repackaging
and public publication remain separate gates.
