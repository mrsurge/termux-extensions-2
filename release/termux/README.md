# Termux native Code TE2 candidate workflow

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
inventory and complete Node vendor roots. The candidate receipt always marks
`publicationEligible: false`. Production clean-tag assembly is a separate gate.

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
