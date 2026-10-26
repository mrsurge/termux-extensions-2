# 0.2.357 plan

## Shared Rust runtime libraries

User defers this work from .356 on 2026-10-25. Target final product size,
duplicated build work and developer ergonomics, not request-speed claims.
No production integration, build, version bump or publication is authorized
by this scheduling decision.

Preserve the isolated source and methodology in
../../../framework/shared_runtime_probe/README.md and historical evidence in
../release_0_2_356/TRACKER.md (O5). The equally stripped C-ABI cdylib fixture
reduced total ZIP bytes from 1,136,342 to 902,159 (~20.6%), with library-only
private implementation updates. Initial build times were essentially tied.
These are small synthetic fixture results, not production savings estimates.
The earlier ordinary Rust-dylib control was larger and is not the intended design.

## Continuation gates

1. Approve a bounded production candidate/API after auditing actual duplicated
   linked code. PyO3 is worker-only, not a shared framework dependency.
2. Specify versioned C ABI, buffer/handle ownership, panic/error boundaries,
   library identity and relocation. A compiler pin does not stabilize Rust ABI.
3. Qualify dependency/Ferrous alignment and platform-specific compiler/toolchain
   policy; preserve Linux private Python versus Termux system ABI boundaries.
4. Design manifests, fingerprints and receipts so private implementation changes
   rebuild the library without rebuilding compatible consumers. The PoC driver
   demonstrates this policy; production bootstrap does not implement it yet.
5. Measure complete compressed wheel/native payloads and clean/incremental
   builds; validate loaders, missing/wrong libraries and compatible replacement
   on Linux and Termux before adoption or release.

Direct search/FS/Git operations reuse is a separate potential stage, not implied
by shared packaging. Preserve authoritative framework state, authorization and
scheduling; do not create competing owners. Runtime activation and live acceptance
remain explicit gates after any separately approved implementation.
