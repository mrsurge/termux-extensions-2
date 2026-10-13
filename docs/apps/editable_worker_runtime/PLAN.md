# Editable worker runtime consistency

## Goal

CLI and TE2 Termux launches must not fight over cached native editor workers.
Fresh source installs must remain usable before explicit mypyc compilation,
without relaxing packaged release validation or changing pipe-facing ownership.

## Source findings

- `framework/bootstrap/bootstrap.py` fingerprints worker source, compiler flags,
  Rust toolchain and Python identity separately from the framework server.
- Worker publication previously pruned every other fingerprint. Different host
  environments could therefore repeatedly evict one another; the exact user
  device environment difference has not yet been captured.
- Fingerprinting included the Python invocation pathname, even though the linked
  runtime/ABI is the relevant native artifact identity.
- Bootstrap unconditionally supplied the default mypyc path, whose absent
  manifest fails in `mypyc_overlay.install`. The Rust worker already supports
  interpreted imports when that environment value is empty.
- Source bootstrap already builds for its native architecture. Release installer
  prebuilt-platform restrictions are a different contract.

## Implementation and validation

1. Retain immutable worker fingerprint variants; do not alter framework pruning.
2. Key Python identity by runtime base prefix/version and ABI/library properties,
   not invocation aliases. Preserve actual compiler flag/toolchain distinctions.
3. Select interpreted domain only for an absent default editable selector.
   Preserve explicit values and broken selections; leave release resolution strict.
4. Document local-architecture source prerequisites and explicit mypyc build,
   activation and restart semantics in README/native worker guide.
5. Regression-test alternating environments, interpreter aliases, changed ABI,
   absent/present/broken/explicit snapshots and packaged refusal behavior.

No Android/native client edits, APK builds, device mutation, runtime restarts,
automatic mypyc compilation, publication or releases are part of this slice.
Retained binary cache garbage collection remains explicit future work; do not
restore unconditional pruning that can delete another framework's selected path.

## Unified manifest-driven follow-up (supersedes build identity above)

The first slice retained distinct environment-derived worker keys. User reported
that APK launch still attempted unwanted builds, and requested the framework's
working source cache policy be applied rank-and-file to workers.

- Framework declaration: `framework/bootstrap/native_build.json`.
- App-local discovery: built-in `app/apps/*/native_build.json`; Code TE2 owns its
  declaration. Retire the central `app/native_worker_builds.json` registry.
- Shared implementation: manifest validation, framework-source-v2 fingerprint,
  cache/target/bin resolution, Cargo command/profile/features, lock, source-change
  fence and atomic publication. Preserve exact prior framework key bytes/paths.
- Declare Cargo path/package/bin, source base (`framework` or owning `app`), output environment key, cache/target/published
  directories, source/shared input patterns and Python ABI requirement in JSON.
- Inherited compiler flags, rustc textual version and interpreter aliases do not
  affect the key, matching the current framework policy. Use explicit force-build
  for intentional compiler changes. Genuine Python ABI mismatch invalidates a
  compatibility receipt, not the source key; missing receipt triggers one build.
- Retain binary selections so another framework's exported path stays usable.
- Keep source-only builds separate from strict packaged payload resolution,
  missing-mypyc interpreted domain selection and explicit mypyc activation.
- Regression proof: old framework fingerprint parity and reuse without receipt,
  APK/CLI environment alternation builds once, real ABI mismatch rebuilds, source
  changes invalidate, manifest escapes/owner mismatches fail, package inclusion,
  dry-run/identity queries don't build, compiled release resolver remains strict.

## Platform wheels

PyPI accepts multiple platform-tagged wheels for one project/version and applies
its default upload limit per file, not to the sum of a release's wheels. A
meta-package is not needed solely to split Android and manylinux artifacts.
Official references: [compatibility tags](https://packaging.python.org/en/latest/specifications/platform-compatibility-tags/)
and [storage limits](https://docs.pypi.org/project-management/storage-limits/).

The Pixel retains the 0.2.353 production Android wheel, 48,653,226 bytes, tagged
`cp314-cp314-android_24_arm64_v8a`. Read-only comparison confirms its tag appears
in that device's supported pip tags. This does not prove all Termux versions use
the same tags, nor authorize replacing an existing artifact. Transfer/upload and
publication are separate from this source-build implementation slice.
