# Termux native Code TE2 candidate workflow

## Next-release PyPI installer path

Normal source-installer execution now passes the release version to the Python
installer on both targets. GitHub supplies checksum-verified release metadata
and installer code, not a Termux wheelhouse archive. Termux stages PyPI wheels
with `pip --isolated install --only-binary=te2,agent-log-server,framework-shells,uvloop-te2 --target ... te2==VERSION`,
verifies packaged runtime/loop selection, then reuses managed activation,
rollback and uninstall. Explicit local offline payloads retain their old path.
This does not change already-published installers.

The current bootstrap routes Termux by the verified selected release version:
before 0.2.354, download/check/extract that release's legacy archive and invoke
its matching installer; from 0.2.354 onward, use PyPI staging. Explicit modern
tags still use PyPI, and `latest` pointing to an older release still uses its
archive. Legacy uninstall/rollback do not download the archive. Linux keeps its
matching-release installer route, and its import smoke requires only common
runtime modules, not the retired FastAPI dependency.

The user has validated the upcoming source dependencies: no costly native builds,
and any remaining small source builds take roughly ten seconds or less. Absence
of an Android wheel alone is not a release blocker. Public TE2 0.2.353 retains
the old dependency metadata and is not this tested source set. ALS's stale
watchfiles requirement is removed. The installer allows source builds for small
dependencies but requires prebuilt TE2/ALS/FWS/uvloop-te2; their missing wheels
fail before activation rather than starting expensive runtime/uvloop builds.
Cleaned ALS publication remains separate.
Regenerate the legacy lock from a verified target closure, not pip freeze; the
old schema/MCP lock is not consumed by the new PyPI path.

New-path prerequisites omit python-cryptography and unused Bun. Retain Node 24,
npm, build-essential for node-pty first use, Git, libarchive and libgit2. Runtime
markers select uvloop-te2 on Android/aarch64 and uvloop on Linux/x86_64; the
private Linux CPython domain also has its own uvloop requirement. The archive
builder below remains available for explicit offline work.

This supplements the existing audited Termux archive builder. It does not
publish, activate a developer snapshot, or restart a framework.

Use ordinary system CPython 3.14 on physical Android/AArch64. The native worker
links Termux's system libpython; it does not bundle the private Linux interpreter.
The TE2 wheel is therefore `cp314-cp314-android_24_arm64_v8a`, not `py3-none-any`.
Keep compiler tools (mypy/mypyc and their compiler dependencies) separate from
the installed runtime wheelhouse. Prove runtime dependencies using the actual
installed group, not merely compiler metadata.

## Build and materialize

From the synchronized checkout, build the independent worker and framework with
their locked dependencies, then compile a new domain snapshot without activation:

```bash
PYO3_PYTHON="$(command -v python)" cargo build --locked --release \
  --manifest-path framework/native_editor_worker/Cargo.toml --bin code-te2-worker
cargo build --locked --release --manifest-path framework/rust/Cargo.toml \
  --package te2-server --features ferrous-framework-native
MAX_JOBS=1 python -B scripts/probe_code_te2_mypyc.py build \
  --output "$HOME/.cache/te2-termux-native-candidate/domain"
python -B release/termux/build_native_wheel.py \
  --snapshot "$HOME/.cache/te2-termux-native-candidate/domain" \
  --worker framework/native_editor_worker/target/release/code-te2-worker \
  --server framework/rust/target/release/te2-server \
  --output "$HOME/.cache/te2-termux-native-candidate/wheel"
```

Outputs must be new directories. Preserve Cargo/compiler intermediates. If
ccache cannot execute, report the failure and explicitly choose `NO_CACHE=1`
for the compilation; do not silently switch off caching or upgrade live system
libraries. Paths above assume no external `CARGO_TARGET_DIR`; use the actual
selected artifact paths when the build environment overrides it.

The wheel materializer checks the source/library fingerprints, ABI, resource
inventory and complete Node vendor roots. Without `--release-tag`, the receipt
marks `publicationEligible: false`. Production assembly requires `--release-tag
<version>`, the matching version tag at clean source HEAD, and a matching compiled
snapshot. No command here uploads artifacts. Build the production archive without
`--allow-dirty-first-party`; retain the receipt and independent installed checks.

## Publication transport

For .354+ public metadata, use `release/build_public_release.py --pypi` with
`--version`, matching `--tag` / `--source-commit`, `--agent-log-server-version`
and `--framework-shells-version`. Include wheels/APKs/template ZIP with repeated
`--asset`. This emits both installer scripts, release-manifest.json and SHA256SUMS
without an obsolete Termux wheelhouse. Source/tag identity and clean eligibility
checks still apply; component versions describe tested release evidence, not
normal dependency pins. Legacy `--termux-archive` mode remains available.

Run publishing tools in an isolated environment: inherited developer
`PYTHONPATH` can make a system Twine command import development dependencies.
Keep publication tooling separate from the installed TE2 runtime.

If large uploads repeatedly fail over a slow connection, an explicitly approved
remote publisher can use the exact accepted artifacts without rebuilding them.
The Debian validation host can serve this role. Verify SHA-256 before transfer,
on the publisher, and against PyPI/GitHub's published metadata. Reuse a remote
artifact only after its hash matches; do not retransmit an already verified copy.
Pass credentials only to the ephemeral uploader process through encrypted SSH
stdin; never save tokens in remote configuration, command arguments, or logs.

Resume only missing release assets, preserving verified uploads. Stage GitHub
uploads in a draft, then publish as a normal release with an alpha title and
Latest status after the entire manifest/checksum inventory is verified. A draft
used for upload staging is not a prerelease. In the 0.2.353 workflow, local PyPI
uploads returned HTTP 500 and GitHub's bulk upload returned HTTP 408; identical
hash-checked artifacts uploaded successfully from Debian. This establishes a
working publication route, not the exact cause of the local failures.

## Archive and installation acceptance

Replace only TE2's old wheel in a copied locked wheelhouse. Reuse matching audited
dependency wheels; do not indiscriminately copy pip's cache (which contains
different ABIs and API floors). Build the existing `build_release.py` archive
with exact first-party provenance and `--allow-dirty-first-party` for a
nonpublication candidate. This flag always makes the archive nonpublishable.
The archive now requires and validates the native worker/domain set on Termux.

Audit AArch64 ELF dependencies/API floor, all compiled imports, Socket.IO and the
actual WBA entrypoint, and intentional reader shutdown. Then use the existing
installer on the Motorola acceptance device, replacing prior managed test builds
only after inspecting ownership/process state. Preserve project/config/draft
data; do not clear Termux app data. User live acceptance must include editor,
terminal, intelligence and extension install/uninstall recovery. APK seed/OTA
publication remains separate from the Python wheel installation.

## Release file budget

Release packages omit source maps, backup files and deprecated Monaco assets;
editable source files remain untouched. Keep full runtime Node build trees,
grammars and fonts. Wheel assembly/finalization rejects files at or above
100,000,000 bytes before upload. Linux's private interpreter retains only the
versioned libpython runtime library, not its identical unversioned linker alias.
Trimmed copies of previously built wheels are validation candidates only: they
must regenerate native inventories and the outer RECORD, pass installed target
checks, and never silently replace an immutable tag's publication provenance.
