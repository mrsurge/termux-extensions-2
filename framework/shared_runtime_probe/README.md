# Shared runtime packaging PoC

Continuation is deferred to **0.2.357**. This remains an isolated PoC, not a
production integration. Planning/status: ../../docs/apps/release_0_2_357/PLAN.md
and TRACKER.md; .356 retains the historical experiment evidence.

**Current intended candidate: stripped C-ABI `cdylib`**, clarified by the user
after the initial ordinary Rust-dylib control. The positive stripped comparison
is below; do not treat the earlier Rust-dylib result as rejection of cdylibs.

Isolated, Linux x86_64 only. This is a **build and shipped-size** experiment,
not a request-speed optimization, production worker migration or stable Rust ABI.
Two concrete consumers exercise one implementation of Tokio/Hyper HTTP + gzip
through either static `rlib` or runtime-linked Rust `dylib`. Each process owns
its own runtime; shared code does not share process state. PyO3 is not duplicated
between the real framework/editor binaries and is intentionally not added here.

Both workspaces use the same implementation and dependency versions. The driver
requires the exact recorded Rust compiler and identical generated lockfiles.
The shared package includes its Rust standard-library `.so`, not only smaller
executables. `$ORIGIN/../lib` supports the staged bin/lib layout without a caller
LD_LIBRARY_PATH. No production source, lockfile, selector, artifact or pipe changes.

Run from repository root (output must be new):

```sh
.jitenv/bin/python -B framework/shared_runtime_probe/measure.py \
  --output .codex-scratch/shared-runtime-probe
```

Builds are offline, use separate retained targets and cached crate sources,
and stop only their own process group if free disk drops below 1 GiB (2 GiB
required before each build). No caches are cleared. Results include all shipped
files, ELF dependencies, ZIP bytes, one target-cold build and a no-op rebuild.
This is not a cold toolchain/download benchmark or a production size estimate.

For an implementation-change comparison, patch only the isolated copied
`source/src/runtime.rs` revision constant, then rerun with `--resume --label
implementation-change`. The driver never edits production or tracked probe code.
Compare which consumers Cargo actually recompiles, not assumed dynamic-link
incrementality. Keep raw logs and receipts. Both staged consumers must pass the
same HTTP/gzip roundtrip before a result is accepted.

Validate relocation and library-only replacement using disposable copies:

```sh
.jitenv/bin/python -B framework/shared_runtime_probe/validate.py \
  --initial .codex-scratch/shared-runtime-probe/initial \
  --changed .codex-scratch/shared-runtime-probe/implementation-change \
  --output .codex-scratch/shared-runtime-probe/relocated
```

## First result — 2026-10-25

Rust 1.95.0 (59807616e), Linux x86_64, default release optimization without LTO.
Both dependency locks are byte-identical (30 packages). No production binaries
were changed. Raw receipts/logs and copied source are under the named scratch
root above; source patches change only the copied private revision from 1 to 2.

| Complete distribution / build | Static | Rust dylib |
| --- | ---: | ---: |
| Raw bytes | 3,476,056 | 7,684,976 |
| ZIP bytes, level 6 | 1,329,608 | 2,364,484 |
| Target-cold, cached-source build | 22.78 s | 24.28 s |
| Private implementation change | 5.51 s | 6.01 s |
| No-op build, coarse polling | ~0.25 s | ~0.25 s |

The shared package is about **78% larger compressed** in this small fixture.
Its two executables are ~9 KB each, but runtime is 2,248,464 bytes and required
Rust std is 5,418,488 bytes. Omitting std would produce a misleading result.
This does not estimate net savings for TE2's much larger real binaries.

Both static executables change after the private implementation update; both
shared executables and std remain byte-identical, with only the shared runtime
changing. Cargo still schedules the consumer package in both modes. There is
no demonstrated build-time win; these are single sequential samples with cached
crate sources, not repeated clean-build statistics. Static consumers already
share one Cargo workspace here, unlike production's independent workspaces.

Four initial and four changed static/shared consumer runs pass identical
HTTP/gzip checks. Validation also passes relocated loading with no LD_LIBRARY_PATH
and cwd=/, explicit loader failure with the runtime missing, and library-only
replacement serving revision 2 through unchanged revision-1 consumers. This
qualifies only the same-toolchain private-implementation edit, not general Rust
ABI compatibility. The existing duplicate-source/two-bin Cargo warning is visible.

Conclusion at this initial stage: runtime linking works and can localize
distributed artifact changes, but the ordinary Rust-dylib recipe does **not**
meet the two-consumer size or build-time goal. Do not adopt it as-is. The user
subsequently clarified/approved the narrow exported C-ABI cdylib below, to avoid a
separately shipped Rust std and broad Rust exports; compare against the same
static baseline and account for all client code. No Rust type/allocator/Future
may silently cross that boundary. Alternatively align production dependencies
and build-cache/workspace strategy independently of runtime linking.

## Intended variant — stripped C-ABI cdylib

`ffi/` builds the same implementation as a symbol-stripped cdylib with exactly
two exports: `te2_probe_abi_version` and `te2_probe_run_v1`. The versioned header
accepts bounded UTF-8 and caller-owned byte buffers; no Rust ownership, allocator,
Future, runtime handle or unwinding crosses the ABI. The operation is synchronous
for this fixture, creating/dropping its runtime internally; this is not a proposed
production server lifecycle. Normal Rust consumers keep their own statically
linked std; the cdylib's std stays internal and no Rust std `.so` ships.

```sh
.jitenv/bin/python -B framework/shared_runtime_probe/measure_ffi.py \
  --output .codex-scratch/shared-runtime-cdylib
```

The static baseline is rebuilt with **the same strip=symbols** as the cdylib and
FFI consumers, not compared against the earlier unstripped symbol tables.
Registry dependencies match between the baseline and cdylib. Release O3/no LTO,
same pinned compiler, sources and ZIP level 6. Consumer fingerprints cover the
source/header/compiler/flags; the fixture's explicit build recipe intentionally
does not rebuild a consumer for a private implementation-only library change.
Production bootstrap does not yet have that dependency/invalidation contract.

| Complete distribution / build | Stripped static | Stripped cdylib + clients |
| --- | ---: | ---: |
| Raw bytes | 2,545,728 | 1,955,600 |
| ZIP bytes | 1,136,342 | 902,159 |
| Target-cold, cached-source build | 23.53 s | 23.65 s |
| Private implementation change | 6.01 s | 5.26 s |
| Recompiled consumers after private change | 2 | 0 |

Net ZIP saving is **234,183 bytes (~20.6%)**, raw saving ~23.2%. Each shared
Rust consumer is 348,184 bytes and the library is 1,259,232 bytes. The version-2
library alone changes; consumer hashes are identical. Initial builds are
effectively tied in this single sample; no robust timing claim is justified.
The ergonomic result is an explicit library-only rebuild/update path, not
unmodified Cargo automatically figuring out stable ABI compatibility.

Validation passes:

- Initial/changed static/shared Rust consumer HTTP/gzip output parity.
- Unit test for ABI version, null/invalid UTF-8 rejection, output capacity and
  successful result delivery; strict mypy for all three Python drivers.
- A C program compiled against the supplied header successfully calls the same
  library, confirming the boundary is not secretly a Rust-type dependency.
- Relocation with cwd=/ and no LD_LIBRARY_PATH, missing-library failure,
  incompatible ABI rejection before operation execution, and library-only
  update through unchanged consumers. ELF dependency checks reject libstd `.so`;
  dynamic symbol check admits only the two declared exports.

For reproduction, patch only copied `source/src/runtime.rs` from revision 1 to 2
and rerun measure_ffi.py with `--resume --label implementation-change`. Compile
the test-only incompatible library with rustc `--crate-type cdylib` from
`ffi/incompatible.rs`, then invoke validate.py with `--library
libte2_probe_runtime_ffi.so --incompatible <test-library-path>` and the matching
initial/changed/output paths. C smoke source is src/consumer_c.c. Measurements
and logs are under .codex-scratch/shared-runtime-cdylib; artifacts are isolated.

Conclusion: this **stripped cdylib** shape meets the tiny fixture's shipped-size
goal and enables intentional implementation-only rebuilds. It does not establish
savings for real TE2 networking/Ferrous, cold/incremental production build times,
Android/Bionic or Python compatibility. Do not ship or move production code yet.
Next integration proposal must choose a concrete shared API, align required
dependency/features, pin/receipt per-target artifacts, define versioned ABI and
SONAME/loader ownership, and preserve compiler caches/worker lifecycles. A source
crate or broad reexports alone do not eliminate executable code duplication.

Adoption gates: repeatable net compressed savings, meaningful rebuild ergonomics,
dependency/features/compiler alignment, matched artifact receipts and relocation/
missing-library failure tests; Linux wheel and Termux/Bionic must be qualified
separately. Rust `dylib` is a matched-set experiment, not a stable public ABI;
a versioned C facade with opaque handles is a separate design if needed.
