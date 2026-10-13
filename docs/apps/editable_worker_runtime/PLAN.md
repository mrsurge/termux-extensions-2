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
