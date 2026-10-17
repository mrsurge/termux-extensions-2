# Editable worker runtime tracker

Historical implementation/test evidence. Current pre-release status is maintained
once in docs/apps/release_0_2_354/TRACKER.md (2026-10-17 consolidation). The
2026-10-17 missing-auto-target/force-interpreted source correction and pending
live activation are recorded there; older evidence below remains historical.

- [x] Read-only source investigation and implementation approval.
- [x] Preserve worker build variants and reuse equivalent interpreter aliases.
- [x] Fresh editable missing-mypyc interpreted-domain selection.
- [x] Preserve explicit/broken selections and strict release payload contract.
- [x] README source-build and mypyc workflow documentation.
- [x] Targeted bootstrap/build regression validation: 28 tests pass.
- [x] User confirms CLI ↔ TE2 Termux no longer fight over native builds.
- [x] User confirms the startup group checked out, except the deleted selected
  mypyc artifact case recorded below; absence and broken selection differ.

## Evidence boundaries

The worker-only fingerprint/pruning interaction is source-confirmed. The exact
compiler/interpreter difference in the reported device launches is not confirmed.
The attached Motorola's read-only default cache lookup found no worker binaries;
no device state was changed and no process restarted. Local validation does not
constitute device acceptance. Existing unrelated repository changes are retained.

Validation: `python -B -m pytest -q
--basetemp=.codex-scratch/pytest-editable-worker
tests/test_native_worker_bootstrap.py tests/test_code_te2_local_mypyc_build.py
tests/test_framework_bootstrap_discovery.py` — 28 passed. The initial run exposed
two fixture assumptions about inherited worker environment variables; fixtures
now isolate the selectors from the actively running development environment.
No Rust or mypyc build, client publication, device mutation or runtime restart
was performed. Cache schema changes cause one new native worker publication on
next source startup; later equivalent launches reuse it. Existing fingerprints
are retained rather than automatically deleted.

## Unified manifest-driven build slice

- [x] Concrete implementation scope approved.
- [x] Framework manifest and Code TE2 app-local worker declaration.
- [x] Shared fingerprint/Cargo/cache/publication implementation.
- [x] Preserve exact old framework cache key/path and receipt-free reuse.
- [x] Replace launcher-dependent worker hashing with framework source policy.
- [x] Runtime/ABI compatibility receipts retain safety without alias-based keys.
- [x] Update source packaging declarations and retire central worker registry.
- [x] Document schema, force-build policy, source/release distinctions.
- [x] Regression suite: 85 tests pass; bootstrap `ty check` is clean.
- [x] Pixel one-build and APK ↔ CLI reuse live acceptance: user confirms neither environment fights for its own build.

New follow-up: user reports `editor rpc socket connect error` after this acceptance;
read-only Pixel worker/mypyc provenance and RPC connection diagnosis approved.
No rebuild, client publication or runtime restart authorized for this investigation.

Read-only diagnosis confirmed stale compiled-domain codec incompatibility: Pixel
selects `check-20261003-041412-1791000852406259745`, 136 compiled modules; recorded
source digest does not match current checkout. An isolated process loading that
exact overlay imports `frontend_rpc_codec` from its compiled `.so`: `msgpack-v1`
is accepted, `msgpack-gzip-v1` raises `unsupported_rpc_codec`, and `allow_gzip=True`
raises TypeError. Current frontend selects gzip; gzip auth support landed October
10 in `58244090`, after this October 3 snapshot. This explains editor namespace
connection rejection despite native HTTP/host IPC readiness. Rebuild/activate the
mypyc snapshot and start a fresh Code TE2 worker; no Rust/APK rebuild is needed
for this mismatch. No runtime was restarted during diagnosis.

Read-only Pixel wheel inspection: production 0.2.353 Android wheel exists under
`~/.cache/te2-release-build/0.2.353/wheelhouse-production/`, is 48,653,226 bytes,
and matches Pixel pip tags. No device builds, transfers, installs or uploads
performed. Source changes do not refresh active bootstrap processes or frameworks.

Validation includes native worker bootstrap, framework identity/discovery,
packaged Code TE2 runtime, local mypyc build helper and app-worker bootstrap.
One existing setuptools/wheel deprecation warning remains. Exact prior framework
fingerprint parity and cached binary reuse are independently tested. Alternating
compiler environments invokes Cargo once; ABI receipt mismatch rebuilds once,
then reuses. No Rust source was modified, and no native build was run.

## Compiler preflight and mypyc fingerprint slice

- [x] User confirms libc++ update to 30 resolved Pixel ccache startup.
- [x] User approves automatic uncached fallback for both missing and broken ccache.
- [x] Bounded executable startup probe, early diagnostics and explicit bypass.
- [x] Uncached mode bypasses user-supplied ccache compiler wrappers.
- [x] Content/toolchain/recipe fingerprinted immutable snapshot publication/reuse.
- [x] Exact-match reuse verifies metadata and library checksums before skipping compilation.
- [x] Read-only selected-snapshot status without extra startup hashing.
- [x] Documentation and regression coverage.
- [x] User confirms no-op fingerprinted rebuild acceptance on 2026-10-15;
  no full compilation run by the agent during release consolidation.

Targeted build/workflow/native-runtime regressions: 97 passed; opt-in real C
compiler benchmark skipped; one existing setuptools/wheel deprecation warning.
Type checks pass for all changed build tooling. Helper health logic lives under
framework/bootstrap, outside the inventoried app/libs domain, to avoid compiling
build-only tooling into Code TE2. No package operations, cache deletion, Pixel
deployment, full mypyc build or worker/framework restart was performed. User's
untracked ccache source/archive files remain untouched.

## Deleted selected mypyc artifact follow-up

- [x] User reports deleting a mypyc build/pin caused native Python import
  FileNotFoundError for domain-a7f57a2.../manifest.json; rebuild/activate recovered.
- [x] Source distinguishes no automatic selector (interpreted) from a retained
  broken/explicit selector (strict). The exact deleted-path provenance still
  needs investigation; no runtime repair was performed during consolidation.
- [ ] Investigate safe handling of a missing automatically selected editable
  artifact, preserving explicit selection and packaged integrity failures.

Current release scope and approvals: ../release_0_2_354/PLAN.md.
