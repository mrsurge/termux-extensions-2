# 0.2.354 candidate build evidence

## Linux candidate started 2026-10-18

- Pushed source: `1c8f05055a333288d01a86d595c13dc6c8b4acd6`.
- Source date epoch: `1792345366`.
- Host: `root@100.74.145.70` (Debian x86_64).
- Isolated root: `/root/.cache/te2-release-build/candidate-0.2.354-1c8f0505`.
  `source/` is an exact git archive, mounted read-only as `/input`;
  `work/` contains compiler caches/intermediates and `output/` final candidates.
  Existing `/home/mrsurge/termux-extensions-2` is untouched.
- Container: `te2-linux-candidate-0.2.354-1c8f0505`.
- Builder tag: `te2-linux-wheel:candidate-0.2.354-1c8f0505`.
- Builder image: `sha256:a9cc5bf581bfdb1f100751ee19d28639817b005e51d55ac3b3d7fcf23e78e649`.
  Full inspect receipt: `builder-image.json`; build log: `builder.log`.
- Existing pinned `release/linux-wheel/Dockerfile` and entrypoint, with
  CPython 3.14.6, Rust 1.94.0, uv 0.11.26, mypy 2.3.0, private runtime closure.
- Container limits: 2 CPUs, 6 GiB RAM; `CARGO_BUILD_JOBS=2`, `MAX_JOBS=2`.
- Build environment: `TE2_RELEASE_COMMIT` is the full source SHA above;
  `TE2_RELEASE_TAG=0.2.354`, `TE2_RELEASE_PLATFORM_TAG=manylinux_2_28_x86_64`,
  `TE2_RELEASE_MINIMUM_GLIBC=2.28`, `SOURCE_DATE_EPOCH` as above,
  `TE2_RELEASE_BUILDER_IMAGE` is the immutable image SHA above.
- Container is detached and retained for logs/exit inspection, without automatic
  deletion/download of its outputs. Inspect using `docker inspect` and
  `docker logs` over root SSH. First observed state: running, Rust dependencies
  downloading/compiling, no OOM. Remote free space was about 137 GiB before build.

The current Docker recipe independently compiles framework, worker and mypyc;
no reused-domain wheel input was supplied. This is a separate release candidate,
not replacement of accepted local binaries.

### Completed build inspection

Container exited 0 at `2026-10-18T18:01:33.798273759Z`, without OOM.
The builder's validation passed: GLIBC ceiling 2.28, manylinux_2_28_x86_64,
no unresolved external or blacklisted libraries, and server version 0.2.354 with
ferrous-framework-native/native-mcp. Setuptools package-discovery warnings remain
visible; their existence is not runtime acceptance or proof of missing assets.

| Output | Bytes | SHA-256 |
| --- | ---: | --- |
| `te2-0.2.354-py3-none-manylinux_2_28_x86_64.whl` | 98,410,861 | `1ecd681ab1cbe12025a8795aebe5c2535e5f5242b01944707656b46c837e0a69` |
| `te2-0.2.354.tar.gz` | 21,226,976 | `d4c77d157d18ec016db8451251b5505573af292d4573e3d5edd90a7c08fe7300` |

The wheel clears the 100,000,000-byte policy by 1,589,139 bytes. Output metadata
marks it publication-eligible, which is a build-policy result, not permission to
publish. Remote filesystem still has about 134 GiB free.

Remote artifact hashes (paths below `work/`):

- `cargo-target/release/te2-server` (stripped by recipe):
  `f87bc29cf5e90ce9737b630b99b39c5928f9b0fb538908011a04d5390adb7c68`
- `cargo-target/release/code-te2-worker` (stripped by recipe):
  `c49789c8928f4d0351782a83ab22919eaee0644a0de67b66ea35a2bd0801e79e`
- `code-te2-domain/lib/4f4895aa51dbbf1d0e79__mypyc.cpython-314-x86_64-linux-gnu.so`:
  `503cd1fd2e9a8f568357cae29bfc4538fccdf482eba4bee7df871dfa0fec6bda`

All differ from the pre-build accepted baseline below. Do not label that a
reproducibility failure or runtime failure: version/toolchain/strip differences
must be separated, and the user's matching-source build comparison is pending.
Fresh Debian venv installation and runtime/group acceptance are not yet performed.

## Pre-build accepted local comparison baseline

Captured before the user runs a matching local build; paths are immutable cache
selections observed from the running processes/snapshot at capture time.

| Component | SHA-256 |
| --- | --- |
| Framework `framework/build/bin/3ab0963fe3d02b3eec23f8e1/release/te2-server` under `~/.cache/te2` | `530aa6d816630696a4fcd046f0b5a77be9d5451bfb13e9172e7cb0dcbf5d9bd3` |
| Worker `code_te2/build/bin/184cc4447e387a0075046bfc/release/code-te2-worker` under `~/.cache/te2` | `c320a030fc6a1555b7e844cd6ceed4cc3e9a5a27398df4856b037674b52ce874` |
| Mypyc `4f4895aa51dbbf1d0e79__mypyc.cpython-314-x86_64-linux-gnu.so` | `d1960e8ce47c3a071cc330861b934fe8450c1a8128ac314eaa5a120151da7ddb` |

Snapshot: `~/.cache/te2/code_te2/build/mypyc-snapshots/domain-d9e48a4b046fa05be560c9e9346d3fee9f64b02f532eb19e94e74ac51e11e4da`.
Its toolchain receipt records system CPython 3.14.4/GCC 15.2.0, not the container's
3.14.6/toolchain. Main mypyc library references at most GLIBC 2.14. This does not
prove private-runtime compatibility or byte-identical independent compilation.
The old framework reports .353; a .354 framework cannot retain that old hash.

Compare the user's new same-source outputs separately from this prior accepted
baseline. Compare raw artifacts with raw artifacts and final packaged artifacts
after strip/RPATH/auditwheel rewriting; do not conflate expected packaging changes
with source drift. Equal hashes prove equal bytes; unequal hashes require
toolchain/source/ELF/provenance analysis before any reproducibility claim.

## Linux install-only validation and local comparison

Fresh isolated Debian system-Python 3.13.5 venv retained at
`/root/.cache/te2-release-acceptance/0.2.354-1c8f0505-linux/venv`.
The exact archived `remote-acceptance.py --install-only` completed successfully:
packaged server selection stayed in that venv, private Python 3.14.6 loaded all
143 compiled modules, and installed Node v24.16.0 imported Socket.IO and the real
WBA entry. `te2 --version` reports `te2-server 0.2.354`. No shared framework was
started or stopped. This is install/import validation, not GUI live acceptance.

Dependency closure **fails the release goal**: unconstrained pip resolves public
ALS 0.2.132, whose old requirements install FWS 0.0.64 plus FastAPI/FastMCP/
Pydantic/cryptography and other removed dependencies. TE2 does not pin those
versions; the old ALS metadata pulls them back. Preserve the test environment
for evidence; do not treat passing imports as clean dependency acceptance or fix
this by silently restoring TE2 pins. Clean ALS wheel publication/adoption must
precede final fresh-install validation.

User's `te2 --build-only` produced local cached framework
`~/.cache/te2/framework/build/bin/2b5f3be706fce105e6b60f26/release/te2-server`,
reporting .354 and SHA-256
`e977ef2bf19206ff34636cd2e58892f2dcbd6bc9db335713d4cc00b04bd13734`.
Its hash differs from the stripped remote manylinux server. Local editor worker
and selected mypyc snapshot remain the prior cached artifacts listed above.
Local and remote mypyc receipts report the **same source digest**
`d9f0d39e80c89caf7ad71c14e99d3370b75e44437414ff12df6c5d442441c291`
and mypy 2.3.0, but different Python/toolchain identities (local 3.14.4 versus
remote 3.14.6). Binary byte equality is not established; matching startup source
and successful private imports are established separately.

## Remaining gates

### Pixel native-build preflight and approved cleanup

Pixel USB serial `48011FDAS00817` is connected through ADB/astermux. Actual TE2
checkout is `~/mrselect6`, clean at 6437ab40; ALS worktree symlink points to
`~/downloads/agent_log_server`, at d95bcb3 with a modified Ferrous submodule and
untracked scratch data. Do not overwrite those ALS changes during source sync.
Pixel initially had 3.2 GiB free. User approved removing only Gradle caches/tmp,
app/Cefrium generated intermediates/tmp/kotlin/generated and project Gradle caches.
Cleanup completed and free space is now about 13 GiB. APK/mapping outputs, SDKs,
signing files, Cargo caches, source, `.release` and active mypyc snapshots remain.
No framework or app worker was stopped. Pixel Python is 3.14.6, Rust/Cargo 1.98.1
(aarch64-linux-android), Clang 21.1.8 (Android24), ccache 4.14.1. Available RAM at
inspection was about 3.6 GiB; choose build concurrency from current headroom.
User's cross-compilation alternative means **Termux x86_64 Docker on x86_64 Debian
targeting aarch64/Bionic**, not emulated ARM Termux. It remains a qualification
option, distinct from the now-practical native Pixel build lane. No container
provisioning or Pixel source update/build was performed in this cleanup step.

### Pixel native builds launched

User approves native Pixel builds and explicitly chooses **8 jobs**, knowing
Android may reclaim background applications under pressure. Stages are sequential:
framework -> editor worker -> mypyc -> TE2 wheel -> ALS server/MCP/wheel.
Root: `~/.cache/te2-release-build/native-0.2.354-als-0.2.139/`; build PID 4405,
started 2026-10-18T19:36:26Z under its own setsid/nohup group. Inspect `stage`,
`build.log`, final `exit-status`, and any `disk-stop`. A 10-second watchdog stops
only that owned build group below 2 GiB free. No active runtime is restarted or
selector activated. Native copies are stripped separately from mutable Cargo
outputs; accepted artifacts remain untouched.
TE2 isolated checkout is exact 1c8f0505; ALS is 64f54cd plus the approved stable
.139/private-runtime edits, with dirty provenance retained. ALS's isolated Ferrous
pin is 4cdf5db; the original Pixel ALS checkout at d95bcb3 and its 673c156 Ferrous
selection remain unchanged. Existing TE2 framework/editor Cargo target caches and
Termux mypyc cache are reused, while ALS has independent candidate Cargo caches.
Native compile jobs/MAX_JOBS are both 8. Candidate wheel outputs are not public
release artifacts yet: TE2 has no release tag, and ALS source is dirty.
All final wheels must pass strict <100,000,000-byte checks. Native Termux wheel
installation/import/live acceptance is a separate group from the APKs on Debian.

First attempt exited 134 at 19:54:38Z after framework (4m30s), worker (49.86s)
and mypyc compilation completed. Snapshot publication failed EACCES on FICLONE;
no wheels were produced. User approved Android-only ordinary-copy publication.
Helper/README/regressions are patched locally and in the isolated Pixel source;
28 tests pass/one skip on both desktop and Pixel. Real copy errors still abort,
and desktop reflink behavior is unchanged. Existing Cargo artifacts/cache remain.
Resume PID 18113 started 19:58:34Z from mypyc, reusing the same compiler cache
8fb788f5f41fbe679a41ff07. Current log is `build-resume.log`; first `build.log`,
`exit-status.first-attempt` and original PID receipt are preserved. Disk remains
about 13 GiB; guard and 8-job sequential stage policy are unchanged. TE2 source
is now dirty only for this approved publication-helper/test/doc correction;
final source provenance/publication gating must reflect it.

ADB/run-as resume published a valid 143-module snapshot but its compiler process
then aborted during native process teardown. Matching Android crash PID 18121
shows Scudo heap-header corruption in libcrypto.so.3 OPENSSL_cleanup through
__cxa_finalize/exit, not OOM or failed compiled-import validation. Do not suppress
SIGABRT or claim the compiler exited successfully. Initial FICLONE failure and
this subsequent teardown failure are distinct.
User suggests Termux APK/session environment mismatch. APK shell/sshd preload
libtermux-exec-ld-preload.so; astermux's libtermux-exec.so is an identical symlink
alias, so the name difference alone does not prove cause. Twelve small OpenSSL/
compiler-import probes exit 0 under both baseline and APK-like env. Real cached
build through APK-started SSH (u0_a321@xrsurges-pixel-9-pro-xl:11234) succeeds,
validates all 143 modules and exits 0 (20:18:33Z, ~49s build). Exact environment/
process difference remains unisolated; no package/allocator/abort workaround.
Validated snapshot: `domain-ssh-probe`; probe receipts: `ssh-probe.log/.exit`.
Resume packaging via SSH PID 20702 at 20:19:04Z, log `build-ssh.log`, starting
te2-wheel with that snapshot then ALS. 8 jobs, disk watchdog and isolated source/
active-runtime protections remain. Older failure logs/status/PIDs are retained.

SSH packaging completes TE2 Android wheel:
`te2-0.2.354-cp314-cp314-android_24_arm64_v8a.whl`, **49,426,707 bytes**,
SHA-256 `52d986b9feeab46261cb543c423b2181100c8be9fca4da55a9d5d823b1c7420c`.
Native server hash 88851527dc01f874a5a2366b13ea62d9fca606399beabc07f61f7041bd04b86c;
worker hash 3c74cf1da70c9cf86ce0c9200b4fbcd2eddda07c58df413d43545c7798f7cd5f.
This is candidate assembly, not installed runtime/live Android acceptance.
ALS then stops exit 101 because a freshly built serde build-script executable
cannot execute (ETXTBSY/Text file busy); no source/runtime change is attributed.
Single cached ALS-only retry via SSH starts PID 22125 at 20:20:07Z, log
`build-als-retry.log`, preserving prior TE2 wheel and failure logs. Original SSH
failure receipt is `exit-status.ssh-als-first`. Disk remains about 12 GiB and the
owned-group disk guard remains active; no repeated automatic retry loop added.

ALS retry completes successfully at 20:27:09Z. Android ALS wheel is
`agent_log_server-0.2.139-cp314-none-android_24_arm64_v8a.whl`, **9,596,571 bytes**
(9.15 MiB), SHA-256
`1e2f3820633948e8c80c244cfd731163b4940521a533d3e676ba62df4efdd8f9`.
Both Android wheels clear the strict byte limit. All build stages exit 0.
Joint fresh Pixel venv at build root `validation-venv` installs TE2 .354,
ALS .139, FWS .65 and uvloop-te2 .23.0.post1; uv pip check passes (43 packages).
Installed smoke exits 0: 143/143 compiled module imports, complete WBA/Socket.IO
entry import, native FWS pipe extension load, uvloop.Loop selection, native MCP
initialize/38 tools/one resource and clean EOF. Retired dependency stack absent.
Logs/status: `validation.log` and `validation.exit`; check uses isolated state,
does not start or stop a shared framework. Disk is about 10 GiB free.
User selects **I'll launch it** for the remaining device live gate. Prepared
`launch-live.sh` in build root; it uses the candidate venv, separate state under
`~/.cache/t354-live`, loopback port 18089 and venv-first PATH. No framework was
launched by the agent. User must point a client at that candidate URL and confirm
integrated acceptance; PyPI uploads/tags remain unperformed.

User subsequently confirms **all Termux validations passed** against the wheel
candidate. This closes Android/Termux wheel live acceptance, separately from APK
validation and final clean-provenance/publication gates. Live launcher roots are
TE2_{CONFIG,DATA,CACHE,RUNTIME}_HOME under ~/.cache/t354-live/{config,data,cache,runtime},
XDG_{CONFIG,DATA,CACHE}_HOME under ~/.cache/t354-live/xdg/{config,data,cache},
XDG_RUNTIME_DIR under ~/.cache/t354-live/xdg/runtime, and
FRAMEWORK_SHELLS_BASE_DIR under ~/.cache/t354-live/fws. Native APK assets/app-owned
settings are not these Python/framework state roots.

User reports comprehensive live integrated acceptance of the remote joint Linux
TE2 .354 / ALS private-runtime .139.dev2 / FWS .65 stack. This closes that live
group, not Android or publication gates. User approves ALS package 0.2.139 stable
metadata and a stable wheel rebuild with isolated smoke checks. Preserve the
accepted joint venv; prepare a new stable validation environment. No tags/uploads.

Stable ALS **0.2.139** rebuild completed in container
`als-linux-private-0.2.139-stable`, exit 0. Wheel is **56,739,875 bytes**
(54.11 MiB), SHA-256
`cd373da2ade305baf849b9c08c3e9dfe14fa68f98d361764c3da1528bf1b9ca6`.
Remote output: ALS build root `output/stable139/`; local copy:
`.codex-scratch/als-private-wheel-0.2.139/`. Native server/MCP binaries and all
private-runtime files match live-accepted dev2 r4 byte-for-byte. Common payload
diff is only server manifest package_version; outer dist-info changes version.
Fresh local venv and separate Debian joint stable venv pass full inventory,
native MCP initialize/38 tools/one resource, clean EOF, actual bundled libpython
mapping and dependency checks. Debian joint root:
`/root/.cache/te2-release-acceptance/joint-stable-0.2.354-als-0.2.139/`.
Packaged `als-rs --build-only` succeeds without source compilation;
`te2 --version` reports .354. Accepted dev2 live environment is untouched.
Stable version metadata is prepared but source edits remain uncommitted; wheel
records source_dirty=true. Clean provenance, tags and publication remain separate.

### ALS dependency candidate follow-up

ALS source checkpoint is 64f54cd (0.2.139.dev2), not publicly uploaded. Its pinned
Ferrous submodule 4cdf5db75c6ade7f078e5e95637c75a6525cf163 is initialized in
the isolated Debian source. Server compilation passed. User supersedes the extra
cp313 candidate: use uv CPython 3.14 and bundle private libpython/stdlib/runtime
dependencies, keeping Android/editable behavior unchanged. New ALS packaging
edits are currently dirty relative to that checkpoint and recorded as such.
The original cp314 wheel is diagnostic, not accepted: auditwheel removed its
libpython link. Private-runtime candidates retain that link explicitly, repair
other ELF dependencies and refresh file/binary inventories. Final validation must
include a fresh venv on this development device and strict <100,000,000 bytes.
Remote root: /root/.cache/als-release-build/candidate-0.2.139.dev2;
accepted diagnostic build container: als-linux-private-0.2.139-dev2-r4. Existing build caches,
live runtimes, source drafts and dist artifacts are preserved. No publication.

The r4 private ALS wheel completed exit 0 and measures **56,739,963 bytes**
(54.11 MiB), 43,260,037 bytes below the strict 100,000,000-byte limit. SHA-256:
`ec13d5e09164f920dafcfd04ea0699635fa52eba1204ca8c88549e78d077c442`.
It is retained locally under `.codex-scratch/als-private-wheel-0.2.139.dev2/r4/`.
Fresh local venv uses outer Python 3.14.4 and loads bundled 3.14.6; native MCP
initialize/tools/list/resources/list return 38 tools/one resource and clean EOF
shutdown. Full private inventory verifies, isolated child /proc maps confirm the
bundled libpython, and uv pip check passes. Container no-deps install also proves
private dependencies suffice. Joint clean TE2 .354 + ALS candidate install on
Debian Python 3.13.5 passes MCP discovery, dependency compatibility and .354
server identity with FWS .65 and no retired FastAPI/FastMCP/MCP/Pydantic/crypto
stack. TE2-owned HTTPX remains intentional. Root:
`/root/.cache/te2-release-acceptance/joint-0.2.354-als-private/`.
The earlier r3 wheel failed local interpreter startup: strip-after-patchelf
corrupted Python PIE dynamic metadata; r4 leaves its pre-stripped relocatable
interpreter intact. Failed candidates are not accepted/publishable artifacts.
ALS source changes remain uncommitted relative to 64f54cd and candidate provenance
honestly records source_dirty=true; stable release/clean provenance remains gated.

1. Linux build completion, size/platform/provenance audit and comparison.
2. Fresh isolated Debian venv acceptance, then Linux wheel live-validation handoff.
3. Android/Termux wheel lane and separate validation handoff.
4. All three staging APKs as one validation group.

The preceding sections record candidate-stage evidence. Final publication below
supersedes their pending source/tag/upload gates; old candidates remain unchanged.

## Final wheel publication — 2026-10-18

User approves commits, tags and public PyPI publication while GitHub remains a
draft pending all three APKs. Tagged TE2 source is
`76b1f84e2a1a3b41480a1a0a5de02ef378bb94dc` (`0.2.354`); tagged ALS source is
`d10a16c87ab36efbca1a541f37e750cb584b0279` (`0.2.139`). Both source branches
and annotated tags are pushed. Final wheels are assembled from clean isolated
checkouts, not the dirty candidate trees. No native compilation was repeated.
Pixel snapshot restore uses the existing SHA-verified reuse helper to rebase
absolute source paths, compare startup sources and import all 143 modules.

| Published wheel | Bytes | SHA-256 |
| --- | ---: | --- |
| `te2-0.2.354-py3-none-manylinux_2_28_x86_64.whl` | 98,412,666 | `62402b9ea26f0242f7e8cff7f478bf5ef9de90a39a9cc1d820ab35be27e365a7` |
| `te2-0.2.354-cp314-cp314-android_24_arm64_v8a.whl` | 49,428,489 | `bcd2aa879ef8686694b3e9f3bd9588609e608fe5a05592406f8ec7b0fb968a7f` |
| `agent_log_server-0.2.139-py3-none-manylinux_2_28_x86_64.whl` | 56,739,877 | `0409d0f0d51ca7985dc90a425e815d866fb1d443de4b2dcdd75b55eb37753ee8` |
| `agent_log_server-0.2.139-cp314-none-android_24_arm64_v8a.whl` | 9,596,571 | `14c317cb96f28e1dfe8278dc2aad9506e64f44e5fb780891a36fb140690cfbeb` |

All wheels pass Twine checks and the strict byte budget. Every ELF member is
byte-identical to its accepted candidate: TE2 Linux 163 / Android 146; ALS Linux
25 / Android 2. This is accepted-to-final payload equality, not a claim that
different build hosts/toolchains independently produce identical binaries.
Linux private-runtime platform audit passes; Android TE2 receipt explicitly
reports publicationEligible=true and empty sourceDirty.

Final local-wheel and fresh **PyPI-only** joint installs pass on Debian system
Python 3.13.5 and Pixel system Python 3.14.6. Default resolution selects TE2 .354,
ALS .139 and FWS .65 with target-exclusive uvloop .23 / uvloop-te2 .23.post1.
Pip/uv dependency checks pass (45 Linux / 43 Android distributions), all compiled
editor imports and real installed WBA imports pass, FWS native pipe/uvloop loads,
ALS MCP discovers 38 tools/one resource and closes cleanly. Linux verifies its
bundled CPython/libpython 3.14.6. No retired web/schema/MCP/crypto distributions
are installed. Pixel PyPI builds only the permitted small pyyaml/msgpack/msgspec
dependencies; preparation completes in 8.4 seconds, not large native builds.

Artifacts/receipts: Debian `/root/.cache/te2-release-build/final-wheels/` and
Pixel `~/.cache/te2-release-build/final-termux-wheels/`. Each retains isolated
local-wheel and PyPI venvs/smoke outputs plus native-comparison JSON. ALS uploads
precede TE2 through isolated Debian Twine; credentials passed only through SSH
stdin to an ephemeral process. PyPI JSON confirms every published digest matches
the table above. Existing developer/shared frameworks were not restarted.

TE2 GitHub release `0.2.354` is **draft**, not Latest/public. The separate template
ZIP is attached and its downloaded SHA-256 matches
`835b679580f4590c549b3ebc45a57aff107871054a0efd49442cb1a82ca5958d`.
All three APK assemblies/grouped acceptance, final release assets/installers and
checksum inventory, and final GitHub publication remain pending. Wheels are
already public; no source distribution was uploaded in this wheel-only slice.
