# Editable worker runtime tracker

- [x] Read-only source investigation and implementation approval.
- [x] Preserve worker build variants and reuse equivalent interpreter aliases.
- [x] Fresh editable missing-mypyc interpreted-domain selection.
- [x] Preserve explicit/broken selections and strict release payload contract.
- [x] README source-build and mypyc workflow documentation.
- [x] Targeted bootstrap/build regression validation: 28 tests pass.
- [ ] User CLI ↔ TE2 Termux editable launch acceptance.
- [ ] Fresh editable interpreted-domain live acceptance.

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
- [ ] Pixel one-build and APK ↔ CLI reuse live acceptance.

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
